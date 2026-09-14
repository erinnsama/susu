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

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: "owner@example.com" };
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

await expect("正常信箱可以進來", req(await makeToken({ ...basePayload, email: "owner@example.com" })),
  (r) => r.ok && r.identity.type === "user" && r.identity.email === "owner@example.com");

await expect("大小寫不同的信箱也認得", req(await makeToken({ ...basePayload, email: "Owner@Example.COM" })),
  (r) => r.ok);

await expect("不在白名單的信箱擋掉", req(await makeToken({ ...basePayload, email: "someone@else.com" })),
  (r) => !r.ok && r.status === 403);

await expect("沒有憑證擋掉", req(null),
  (r) => !r.ok && r.status === 401);

await expect("亂寫的憑證擋掉", req("not-a-valid-jwt"),
  (r) => !r.ok && r.status === 401);

await expect("別人簽的憑證擋掉", req(await makeToken({ ...basePayload, email: "owner@example.com" }, attacker.privateKey)),
  (r) => !r.ok && r.status === 401);

await expect("過期的憑證擋掉", req(await makeToken({ ...basePayload, email: "owner@example.com", exp: now - 10 })),
  (r) => !r.ok && r.status === 401);

await expect("別的應用程式的憑證擋掉", req(await makeToken({ ...basePayload, aud: ["別人的aud"], email: "owner@example.com" })),
  (r) => !r.ok && r.status === 403);

await expect("偽造來源的憑證擋掉", req(await makeToken({ ...basePayload, iss: "https://壞人.cloudflareaccess.com", email: "owner@example.com" })),
  (r) => !r.ok && r.status === 403);

await expect("Service Token 認得出來", req(await makeToken({ ...basePayload, common_name: "claude-排程" })),
  (r) => r.ok && r.identity.type === "service");

// ACCESS_AUD 沒填時：仍要驗簽章與信箱，只是不檢查 aud
const noAudEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "", ALLOWED_EMAILS: "owner@example.com" };
async function expectNoAud(name, request, predicate) {
  const result = await authenticate(request, noAudEnv);
  if (predicate(result)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, JSON.stringify(result)); }
}
await expectNoAud("沒填 AUD 時，別的 App 的憑證會被接受（已知的降級）",
  req(await makeToken({ ...basePayload, aud: ["另一個app"], email: "owner@example.com" })), (r) => r.ok);
await expectNoAud("沒填 AUD 時，別人簽的憑證仍然擋掉",
  req(await makeToken({ ...basePayload, email: "owner@example.com" }, attacker.privateKey)), (r) => !r.ok);
await expectNoAud("沒填 AUD 時，不在白名單的信箱仍然擋掉",
  req(await makeToken({ ...basePayload, email: "someone@else.com" })), (r) => !r.ok && r.status === 403);
await expectNoAud("沒填 AUD 時，過期憑證仍然擋掉",
  req(await makeToken({ ...basePayload, email: "owner@example.com", exp: now - 10 })), (r) => !r.ok);

// 連 team domain 都沒設定時，正式環境要擋下來
const unconfigured = await authenticate(req(null), { ALLOWED_EMAILS: "" });
if (!unconfigured.ok && unconfigured.status === 500) { pass++; console.log("  ✓ 沒設定 team domain 時回 500 而不是放行"); }
else { fail++; console.log("  ✗ 沒設定 team domain 時回 500 而不是放行", JSON.stringify(unconfigured)); }

const devMode = await authenticate(req(null), { DEV_NO_AUTH: "1" });
if (devMode.ok) { pass++; console.log("  ✓ 本機開發模式可以跳過驗證"); }
else { fail++; console.log("  ✗ 本機開發模式可以跳過驗證", JSON.stringify(devMode)); }

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
