import { json, nowIso, readJson, badRequest } from "../lib/util.js";
import { sendPushToAll } from "../lib/push-send.js";

export async function handlePush(request, env, url, auth) {
  if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
    const body = await readJson(request);
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return badRequest("subscription 格式不正確");
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_email, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_email = excluded.user_email`
    )
      .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, auth.identity.email || null, nowIso())
      .run();
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/subscribe" && request.method === "DELETE") {
    const body = await readJson(request);
    if (!body || !body.endpoint) return badRequest("缺少 endpoint");
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(body.endpoint).run();
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/test" && request.method === "POST") {
    if (auth.identity.type !== "user") return json({ error: "此功能僅限一般登入使用" }, 403);
    const outcomes = await sendPushToAll(env, {
      title: "待辦清單GO!",
      body: "🔔 這是一則測試推播，收到就代表設定成功！"
    });
    return json({ ok: true, outcomes });
  }

  return json({ error: "不支援的操作" }, 405);
}
