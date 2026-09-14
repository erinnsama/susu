/**
 * Cloudflare Access 驗證。
 *
 * Access 會在使用者通過 Email 一次性登入碼之後，於每個請求帶上一段 JWT
 * （header `Cf-Access-Jwt-Assertion`，或 cookie `CF_Authorization`）。
 * 這裡自己再驗一次簽章，好處是：就算哪天 Access 的 Application 設定被改壞、
 * 或有人直接打到 Worker 而沒有經過 Access，API 也不會裸奔。
 *
 * 需要兩個環境變數（設在 wrangler.toml 的 [vars]）：
 *   ACCESS_TEAM_DOMAIN  例如 "erinsama.cloudflareaccess.com"
 *   ACCESS_AUD          Access Application 的 Application Audience (AUD) Tag
 * 另外 ALLOWED_EMAILS 是允許登入的信箱（逗號分隔）。
 */

const CERTS_TTL_MS = 60 * 60 * 1000; // 公鑰快取一小時
const certsCache = new Map(); // teamDomain -> { keys, fetchedAt }

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
}

async function getKeys(teamDomain) {
  const cached = certsCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < CERTS_TTL_MS) return cached.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`無法取得 Access 公鑰 (${res.status})`);
  const body = await res.json();
  const keys = body.keys || [];
  certsCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

async function verifySignature(keys, token) {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  const header = decodeJson(headerB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBytes(sigB64);

  // kid 對得上就只試那把，對不上就全部試一遍（Access 會輪替金鑰）
  const candidates = keys.filter((k) => !header.kid || k.kid === header.kid);
  for (const jwk of candidates.length ? candidates : keys) {
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data)) return true;
    } catch {
      // 這把金鑰不合用，換下一把
    }
  }
  return false;
}

function readToken(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 回傳 { ok: true, identity } 或 { ok: false, status, error }。
 * identity = { type: "user" | "service", email?, name? }
 */
export async function authenticate(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;

  // 還沒設定 Access 變數時，只有本機 wrangler dev 放行，正式環境一律擋掉，
  // 免得部署上去卻忘了設定，等於整個資料庫對外開放。
  if (!teamDomain || !aud) {
    // 只認 DEV_NO_AUTH（由 npm run dev 帶入）。
    // 不能改用網址判斷是不是本機：wrangler dev 會照 wrangler.toml 的 routes
    // 模擬成 schedule.erinsama.com，看起來跟正式環境一模一樣。
    if (String(env.DEV_NO_AUTH) === "1" || env.DEV_NO_AUTH === true) {
      return { ok: true, identity: { type: "user", email: "dev@localhost", name: "本機開發" } };
    }
    return {
      ok: false,
      status: 500,
      error: "尚未設定 ACCESS_TEAM_DOMAIN / ACCESS_AUD，請見 README 步驟 5"
    };
  }

  const token = readToken(request);
  if (!token || token.split(".").length !== 3) {
    return { ok: false, status: 401, error: "缺少 Cloudflare Access 憑證，請重新登入" };
  }

  let payload;
  try {
    payload = decodeJson(token.split(".")[1]);
  } catch {
    return { ok: false, status: 401, error: "Access 憑證格式不正確" };
  }

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(aud)) return { ok: false, status: 403, error: "Access 憑證不屬於這個應用程式" };
  if (payload.iss !== `https://${teamDomain}`) return { ok: false, status: 403, error: "Access 憑證來源不正確" };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, status: 401, error: "登入已過期，請重新登入" };
  if (payload.nbf && payload.nbf > now + 60) return { ok: false, status: 401, error: "Access 憑證尚未生效" };

  const keys = await getKeys(teamDomain);
  if (!(await verifySignature(keys, token))) {
    return { ok: false, status: 401, error: "Access 憑證簽章驗證失敗" };
  }

  // Service Token（給 Claude 排程用）簽出來的 JWT 沒有 email，只有 common_name
  if (!payload.email && payload.common_name) {
    return { ok: true, identity: { type: "service", name: payload.common_name } };
  }

  const email = String(payload.email || "").toLowerCase();
  const allowed = parseList(env.ALLOWED_EMAILS);
  if (allowed.length && !allowed.includes(email)) {
    return { ok: false, status: 403, error: `${email} 沒有使用權限` };
  }

  return { ok: true, identity: { type: "user", email, name: email } };
}
