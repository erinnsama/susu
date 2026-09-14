# ERINSAMA待辦清單 — schedule.erinsama.com

Cloudflare Worker（靜態前端 + `/api/*`）＋ D1 資料庫，網域 `schedule.erinsama.com`，
存取權限交給 Cloudflare Access（只有 wwrinkz@gmail.com 能用一次性登入碼進來）。

手機推播提醒沿用原本已驗證過的 Claude 排程，改成用 Cloudflare Access Service Token
呼叫這裡的 `/api/tasks`，不是靠這個 Worker 自己發推播。

## 首次設定（只需做一次）

1. 安裝相依套件：
   ```
   npm install
   ```
2. 登入 Cloudflare（會開瀏覽器讓妳登入）：
   ```
   npx wrangler login
   ```
3. 建立 D1 資料庫，把印出來的 `database_id` 貼進 `wrangler.toml`：
   ```
   npx wrangler d1 create schedule-db
   ```
4. 套用資料表結構：
   ```
   npm run db:migrate:remote
   ```
5. 部署：
   ```
   npm run deploy
   ```
   第一次部署會先給一個 `*.workers.dev` 網址，`wrangler.toml` 裡已經設定
   `schedule.erinsama.com` 的自訂網域，只要這個網域的 DNS 是在同一個 Cloudflare 帳號上，
   `wrangler deploy` 會自動處理好網域綁定。
6. 到 Cloudflare Zero Trust（one.dash.cloudflare.com）啟用一次（選 team 名稱、接受條款），
   然後設定 Access：
   - 一個 Application 管 `schedule.erinsama.com/*`：政策只允許 email `wwrinkz@gmail.com`
     用一次性登入碼（One-time PIN）進入。
   - 另一個 Application 管 `schedule.erinsama.com/api/*`：政策允許一個 Service Token
     （給 Claude 排程用，不用人登入）。

## 開發時本機測試

```
npm run dev
```
會用本機的 D1 影子資料庫，不會動到正式資料。

## 資料匯入

已把原本 Claude Artifact 版本裡的 22 筆任務轉成 `migrations/0002_seed_from_artifact.sql`
（若尚未產生，請見對話紀錄或請 Claude 重新產生），用：
```
npx wrangler d1 execute schedule-db --remote --file=migrations/0002_seed_from_artifact.sql
```
