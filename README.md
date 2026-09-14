# ERINSAMA待辦清單 — schedule.erinsama.com

Cloudflare Worker（靜態前端 + `/api/*`）＋ D1 資料庫，網域 `schedule.erinsama.com`。

進站要先用 **Email 一次性登入碼**（Cloudflare Access One-time PIN）驗證身分，
只有白名單信箱進得來。Worker 自己也會再驗一次 Access 簽發的憑證，
所以就算 Access 設定被改壞，資料也不會直接對外開放。

手機推播提醒沿用原本已驗證過的 Claude 排程，改成用 Cloudflare Access Service Token
呼叫這裡的 `/api/tasks`，不是靠這個 Worker 自己發推播。

---

## 部署步驟（照順序做完就能用）

### 1. 安裝與登入

```
npm install
npx wrangler login
```

### 2. 建立資料庫

```
npx wrangler d1 create schedule-db
```

把印出來的 `database_id` 貼到 `wrangler.toml` 的 `[[d1_databases]]` 裡。
（目前已填 `499b3c15-70bb-4e20-bcc0-3bb8699029b7`，沿用舊的就不用改。）

### 3. 建立資料表與匯入既有任務

```
npm run db:migrate:remote
```

`migrations/` 底下有兩個檔案，這個指令會一次做完：

| 檔案 | 作用 |
| --- | --- |
| `0001_init.sql` | 建 `projects`、`tasks` 兩張表 |
| `0002_seed_from_artifact.sql` | 匯入原本 Artifact 版本的 1 個專案 + 22 筆任務 |

種子檔用的是 `INSERT OR IGNORE`，重複執行不會出錯、也不會產生重複資料。
要改種子內容就編輯 `scripts/gen-seed.mjs` 後跑 `npm run seed:gen` 重新產生。

### 4. 設定 Cloudflare Access（Email 登入）

到 [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → Zero Trust
（第一次會要妳選一個 team 名稱並接受條款）。

建立 **一個** Self-hosted Application：

- **Application domain**：`schedule.erinsama.com`（路徑留空，整個網域都保護）
- **Policy 1 — 給自己用**
  - Action：`Allow`
  - Include：`Emails` → 妳的信箱
  - 登入方式留 One-time PIN（Email 收驗證碼）
- **Policy 2 — 給 Claude 排程用**
  - Action：`Service Auth`
  - Include：`Service Token` → 選一個新建的 Service Token
  - （Service Token 在 Zero Trust → Access → Service Auth 建立，
    建完會給 `Client ID` 與 `Client Secret`，只會顯示一次，記得存好）

> ⚠️ **不要**像早期規劃那樣，另外開一個只保護 `schedule.erinsama.com/api/*`、
> 只允許 Service Token 的 Application。Access 會以「路徑最精確的 App」為準，
> 那樣一來瀏覽器登入後打 `/api/*` 會被判定沒有權限，整個網站的資料都讀不出來。
> **兩條 Policy 放在同一個 Application** 才會人跟排程都通。

### 5. 把 Access 資訊填回 `wrangler.toml`

在 Application 的設定頁找到 **Application Audience (AUD) Tag**，填進 `[vars]`：

```toml
[vars]
ACCESS_TEAM_DOMAIN = "妳的team名稱.cloudflareaccess.com"
ACCESS_AUD = "那一長串 AUD Tag"
```

允許登入的信箱**不放在 wrangler.toml**（這個 repo 是公開的），
改存成 Worker secret：

```
echo "你的信箱@gmail.com" | npx wrangler secret put ALLOWED_EMAILS
```

這三個沒填的話，正式環境的 `/api/*` 會一律回 500 並提示尚未設定——
這是刻意的，避免部署上去卻忘了設定，等於資料庫對全世界開放。

### 6. 部署

```
npm run deploy
```

`wrangler.toml` 已經設定 `schedule.erinsama.com` 為自訂網域，
只要這個網域的 DNS 在同一個 Cloudflare 帳號底下，部署時會自動綁好。

`workers_dev = false` 也已經設定好，所以不會有一個沒被 Access 保護的
`*.workers.dev` 網址在外面繞過 Email 登入。

> 部署前建議先跑一次 `npm run test:access`，確認登入把關是好的。

### 7. 確認有沒有成功

打開 `https://schedule.erinsama.com/api/health`，應該會看到：

```json
{"ok":true,"time":"...","accessConfigured":true,"database":"ok"}
```

- `accessConfigured` 是 `false` → 回到步驟 5
- `database` 不是 `ok` → 回到步驟 3

接著打開 `https://schedule.erinsama.com`，會先跳 Access 的 Email 登入，
輸入信箱收驗證碼進來之後，右上角會顯示登入的信箱與「登出」。

---

## 給 Claude 排程呼叫

帶上 Service Token 的兩個 header 就能讀資料，不需要人登入：

```
curl https://schedule.erinsama.com/api/tasks \
  -H "CF-Access-Client-Id: <Client ID>" \
  -H "CF-Access-Client-Secret: <Client Secret>"
```

Service Token 只能讀（GET），不能新增或修改——排程只需要讀待辦來發提醒，
限制成唯讀的話，token 萬一外流也不會被改資料。

好用的查詢參數：

| 參數 | example | 說明 |
| --- | --- | --- |
| `status` | `?status=todo,doing` | 只取特定狀態，逗號分隔 |
| `projectId` | `?projectId=emo-blast` | 只取某個專案 |
| `dueBefore` | `?dueBefore=2026-09-20` | 只取這天（含）以前到期的 |

例如「今天以前該做完卻還沒做完的」：

```
/api/tasks?status=todo,doing&dueBefore=2026-09-14
```

---

## 開發時本機測試

```
npm run db:migrate:local   # 只需第一次
npm run dev
```

本機用的是 D1 的影子資料庫，不會動到正式資料。

`npm run dev` 會帶 `--env dev`，用的是 `wrangler.toml` 最底下那段 `[env.dev]`，
裡面設了 `DEV_NO_AUTH = "1"` 跳過 Access 驗證（不然本機根本沒辦法收登入信）。
`npm run deploy` 不會帶 `--env`，所以這個旗標不會上到正式站。

### 測試

```
npm run test:access   # 驗證登入把關（不需要開伺服器）
npm run smoke         # 打一輪 API（要先開著 npm run dev）
```

`test:access` 會自己產一組金鑰假裝是 Cloudflare，確認過期、
別人簽的、別的應用程式的、不在白名單的憑證都會被擋下來。

---

## API 一覽

所有回應都是 JSON，失敗時是 `{"error": "中文訊息"}`。

| Method | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/health` | 健康檢查，不需登入 |
| GET | `/api/me` | 目前登入者 |
| GET | `/api/projects` | 專案列表 |
| POST | `/api/projects` | 新增專案 `{name, color, archived}` |
| PATCH | `/api/projects/:id` | 修改專案 |
| DELETE | `/api/projects/:id` | 刪除專案，**底下任務一併刪除** |
| GET | `/api/tasks` | 任務列表，支援上面的查詢參數 |
| GET | `/api/tasks/:id` | 單一任務 |
| POST | `/api/tasks` | 新增任務 `{title, projectId, status, dueDate, priority, notes}` |
| PATCH | `/api/tasks/:id` | 修改任務（只送要改的欄位） |
| DELETE | `/api/tasks/:id` | 刪除任務 |

`status` 只能是 `todo` / `doing` / `done`，
`priority` 只能是 `low` / `normal` / `high`，
`dueDate` 是 `YYYY-MM-DD` 或 `null`。
