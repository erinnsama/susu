/**
 * 用 Cloudflare API 建立 Access Application 與兩條 Policy，並印出 AUD Tag。
 * 可以重複執行：已經存在的東西會沿用，不會重複建立。
 *
 * 需要一個有 Access 權限的 API Token（wrangler login 的憑證沒有這個權限，
 * 用它呼叫會拿到 0 筆的空清單而不是錯誤訊息，看起來像什麼都沒建）。
 *
 * 建 Token：Cloudflare 首頁右上角 → My Profile → API Tokens → Create Token
 *   → Custom token，權限給：
 *     Account | Access: Apps and Policies | Edit
 *     Account | Access: Service Tokens    | Read
 *
 * 用法（PowerShell）：
 *   $env:CF_API_TOKEN="貼上token"; node scripts/setup-access.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ACCOUNT_ID = "27148ee705fa6140b8985774063084ff";
const HOSTNAME = "schedule.erinsama.com";
const APP_NAME = "ERINSAMA待辦清單";
const ALLOWED_EMAIL = "wwwrinkz@gmail.com";

function findToken() {
  // 優先用有 Access 權限的 API Token
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN;
  console.warn("！沒有設定 CF_API_TOKEN，改用 wrangler 的登入憑證——");
  console.warn("  它沒有 Access 權限，清單會一律回 0 筆（不是真的沒東西）。");
  return findWranglerToken();
}

function findWranglerToken() {
  const candidates = [
    join(process.env.APPDATA || "", "xdg.config", ".wrangler", "config", "default.toml"),
    join(homedir(), ".wrangler", "config", "default.toml"),
    join(process.env.XDG_CONFIG_HOME || "", ".wrangler", "config", "default.toml")
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  }
  throw new Error("找不到 wrangler 的登入憑證，請先執行 npx wrangler login");
}

const token = findToken();

async function api(path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await res.json();
  if (!body.success) {
    const messages = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`${options.method || "GET"} ${path} 失敗 → ${messages || res.status}`);
  }
  return body.result;
}

// 1. 確認登入方式裡有 One-time PIN（Email 驗證碼）
const idps = await api("/access/identity_providers");
const otp = idps.find((i) => i.type === "onetimepin");
console.log(
  otp
    ? "✓ 一次性登入碼（One-time PIN）已啟用"
    : "！帳號裡沒有看到 One-time PIN，稍後在 Zero Trust → Access controls → Access settings 確認登入方式"
);

// 2. 找 Service Token
const serviceTokens = await api("/access/service_tokens");
if (!serviceTokens.length) throw new Error("帳號裡沒有 Service Token，請先在後台建立一個");
const serviceToken = serviceTokens[0];
console.log(`✓ 找到 Service Token：${serviceToken.name}`);

// 3. 建立（或沿用）Application
const apps = await api("/access/apps");
let app = apps.find((a) => a.domain === HOSTNAME);
if (app) {
  console.log(`✓ 已經有保護 ${HOSTNAME} 的 Application，沿用它`);
} else {
  app = await api("/access/apps", {
    method: "POST",
    body: JSON.stringify({
      name: APP_NAME,
      domain: HOSTNAME,
      type: "self_hosted",
      session_duration: "24h",
      app_launcher_visible: true,
      auto_redirect_to_identity: false
    })
  });
  console.log(`✓ 已建立 Application：${HOSTNAME}`);
}

// 4. 掛上兩條 Policy
const policies = await api(`/access/apps/${app.id}/policies`);

async function ensurePolicy(name, payload) {
  if (policies.some((p) => p.name === name)) {
    console.log(`✓ Policy「${name}」已存在`);
    return;
  }
  await api(`/access/apps/${app.id}/policies`, { method: "POST", body: JSON.stringify({ name, ...payload }) });
  console.log(`✓ 已建立 Policy「${name}」`);
}

await ensurePolicy("本人信箱登入", {
  decision: "allow",
  precedence: 1,
  include: [{ email: { email: ALLOWED_EMAIL } }]
});

await ensurePolicy("Claude 排程（Service Token）", {
  decision: "non_identity",
  precedence: 2,
  include: [{ service_token: { token_id: serviceToken.id } }]
});

// 5. 印出要填進 wrangler.toml 的 AUD（這不是機密，是應用程式識別碼）
console.log("\n──────────────────────────────────────");
console.log("ACCESS_AUD =", app.aud);
console.log("──────────────────────────────────────");
