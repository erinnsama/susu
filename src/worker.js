import { authenticate } from "./lib/access.js";
import { json } from "./lib/util.js";
import { handleProjects } from "./api/projects.js";
import { handleTasks } from "./api/tasks.js";
import { handlePush } from "./api/push.js";
import { taipeiToday, findDueTasks, composeReminderMessage } from "./lib/reminder.js";
import { sendPushToAll } from "./lib/push-send.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return serveAsset(request, env);
    }

    try {
      return await handleApi(request, env, url);
    } catch (err) {
      // 沒有這層的話，D1 還沒建表之類的狀況會直接噴 Cloudflare 的 1101 錯誤頁，
      // 前端只會看到一個看不懂的失敗。
      console.error("API error", err && err.stack ? err.stack : err);
      return json({ error: "伺服器發生錯誤：" + (err && err.message ? err.message : String(err)) }, 500);
    }
  },

  // 每天固定時間由 Cloudflare 觸發（見 wrangler.toml [triggers]），
  // 跟前端、Claude 排程都無關，直接在 Cloudflare 內部查 D1、發 Web Push。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyReminder(env));
  }
};

async function runDailyReminder(env) {
  const today = taipeiToday();
  const rows = await findDueTasks(env, today);
  const message = composeReminderMessage(rows, today);
  if (!message) {
    console.log("今天沒有逾期或到期的任務，不推播", today);
    return;
  }
  const outcomes = await sendPushToAll(env, { title: "待辦清單GO!", body: message });
  console.log("每日提醒推播結果", today, message, JSON.stringify(outcomes));
}

async function handleApi(request, env, url) {
  // 健康檢查不需要登入，綁完網域可以直接用它確認 Worker 與 D1 有沒有活著
  if (url.pathname === "/api/health") {
    return json(await healthCheck(env));
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // Service Token 是給 Claude 排程讀待辦用的，不讓它碰到寫入
  if (auth.identity.type === "service" && request.method !== "GET") {
    return json({ error: "Service Token 只能讀取資料" }, 403);
  }

  if (url.pathname === "/api/me") {
    return json(auth.identity);
  }
  if (url.pathname === "/api/config") {
    return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
  }
  if (url.pathname === "/api/projects" || url.pathname.startsWith("/api/projects/")) {
    return handleProjects(request, env, url);
  }
  if (url.pathname === "/api/tasks" || url.pathname.startsWith("/api/tasks/")) {
    return handleTasks(request, env, url);
  }
  if (url.pathname.startsWith("/api/push/")) {
    return handlePush(request, env, url, auth);
  }
  return json({ error: "沒有這個 API 路徑" }, 404);
}

async function healthCheck(env) {
  const result = {
    ok: true,
    time: new Date().toISOString(),
    accessConfigured: Boolean(env.ACCESS_TEAM_DOMAIN),
    audPinned: Boolean(env.ACCESS_AUD),
    emailAllowlist: Boolean(env.ALLOWED_EMAILS),
    database: "ok"
  };
  try {
    await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks").first();
  } catch (err) {
    result.ok = false;
    result.database = "資料表尚未建立或無法連線：" + (err && err.message ? err.message : String(err));
  }
  return result;
}

async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
