/**
 * 驗證 src/lib/access.js 真的擋得住偽造的登入憑證。
 * 自己產一組 RSA 金鑰假裝是 Cloudflare Access，把公鑰餵給模組驗證。
 * 用法：npm run test:access
 */
const { subtle } = globalThis.crypto;

const TEAM = "erinsama.cloudflareaccess.com";
const AUD = "aud-tag-1234567890";

const pair = await subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);
const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
publicJwk.kid = "test-key";
publicJwk.alg = "RS256";

// 另一組金鑰，用來模擬「簽章是別人簽的」
const attacker = await subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeToken(payload, key = pair.privateKey) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = await subtle.sign("RSASSA-PKCS1-v1_5", key, data);
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

// 攔截對 Cloudflare 取公鑰的請求
globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "content-type": "application/json" } });
  }
  throw new Error("預期外的 fetch: " + url);
};

const { authenticate } = await import("../src/lib/access.js");

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: "wwrinkz@gmail.com" };
const now = Math.floor(Date.now() / 1000);
const basePayload = { aud: [AUD], iss: `https://${TEAM}`, exp: now + 3600, iat: now };

function req(token) {
  const headers = token ? { "Cf-Access-Jwt-Assertion": token } : {};
  return new Request("https://schedule.erinsama.com/api/tasks", { headers });
}

let pass = 0;
let fail = 0;
async function expect(name, request, predicate) {
  const result = await authenticate(request, env);
  if (predicate(result)) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, JSON.stringify(result));
  }
}

await expect("正常信箱可以進來", req(await makeToken({ ...basePayload, email: "wwrinkz@gmail.com" })),
  (r) => r.ok && r.identity.type === "user" && r.identity.email === "wwrinkz@gmail.com");

await expect("大小寫不同的信箱也認得", req(await makeToken({ ...basePayload, email: "WWRinkz@Gmail.com" })),
  (r) => r.ok);

await expect("不在白名單的信箱擋掉", req(await makeToken({ ...basePayload, email: "someone@else.com" })),
  (r) => !r.ok && r.status === 403);

await expect("沒有憑證擋掉", req(null),
  (r) => !r.ok && r.status === 401);

await expect("亂寫的憑證擋掉", req("not-a-valid-jwt"),
  (r) => !r.ok && r.status === 401);

await expect("別人簽的憑證擋掉", req(await makeToken({ ...basePayload, email: "wwrinkz@gmail.com" }, attacker.privateKey)),
  (r) => !r.ok && r.status === 401);

await expect("過期的憑證擋掉", req(await makeToken({ ...basePayload, email: "wwrinkz@gmail.com", exp: now - 10 })),
  (r) => !r.ok && r.status === 401);

await expect("別的應用程式的憑證擋掉", req(await makeToken({ ...basePayload, aud: ["別人的aud"], email: "wwrinkz@gmail.com" })),
  (r) => !r.ok && r.status === 403);

await expect("偽造來源的憑證擋掉", req(await makeToken({ ...basePayload, iss: "https://壞人.cloudflareaccess.com", email: "wwrinkz@gmail.com" })),
  (r) => !r.ok && r.status === 403);

await expect("Service Token 認得出來", req(await makeToken({ ...basePayload, common_name: "claude-排程" })),
  (r) => r.ok && r.identity.type === "service");

// 沒設定 Access 時，正式環境要擋下來
const unconfigured = await authenticate(req(null), { ALLOWED_EMAILS: "" });
if (!unconfigured.ok && unconfigured.status === 500) { pass++; console.log("  ✓ 沒設定 Access 時回 500 而不是放行"); }
else { fail++; console.log("  ✗ 沒設定 Access 時回 500 而不是放行", JSON.stringify(unconfigured)); }

const devMode = await authenticate(req(null), { DEV_NO_AUTH: "1" });
if (devMode.ok) { pass++; console.log("  ✓ 本機開發模式可以跳過驗證"); }
else { fail++; console.log("  ✗ 本機開發模式可以跳過驗證", JSON.stringify(devMode)); }

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
