import { writeFileSync } from "node:fs";

const projects = [
  { id: "emo-blast", name: "EMO Blast", color: "#DE5D83", archived: 0 }
];

const tasks = [
  { id: "budget", title: "【Project:EMO】發行預算大表", status: "todo", priority: "normal", notes: "第一版（含全地區版本）→ 二版 → 確認版" },
  { id: "icon", title: "ICON（紅藍）", status: "done", priority: "normal", notes: "" },
  { id: "store-kv", title: "商店包裝：KV", status: "done", priority: "normal", notes: "含主視覺、Google 刊頭、內頁；不限一套" },
  { id: "store-images", title: "商店圖（上線後，差多語系）", status: "todo", priority: "normal", notes: "與 Lynn 共同；概念呈現規劃 → 確認後派單" },
  { id: "ad-landing", title: "廣告投放頁", status: "doing", priority: "high", notes: "驗收中" },
  { id: "ip-plan", title: "IP聯動規劃", status: "todo", priority: "normal", notes: "與 Lynn 共同；時程待決策，四區整體規劃、台灣區詳細規劃" },
  { id: "ip-tw-fangfang", title: "IP聯動－台灣．方坊", status: "doing", priority: "high", notes: "與 Lynn 共同；合約已簽回，遊戲置入合作已執行中" },
  { id: "ip-jp", title: "IP聯動－日本", status: "todo", priority: "normal", notes: "合約已提供，IP方審查中；待確認合作展開時間" },
  { id: "ip-kr", title: "IP聯動－韓國", status: "todo", priority: "normal", notes: "合約IP方審查中，遊戲置入合作已交稿；待確認企劃IP執行節點" },
  { id: "ending-cut", title: "通用 Ending Cut", status: "todo", priority: "normal", notes: "上線後" },
  { id: "video-frame", title: "通用影片框", status: "done", priority: "normal", notes: "上線前後" },
  { id: "material-preheat", title: "買量素材－事前預熱（大方向）", status: "todo", priority: "normal", notes: "確認素材大方向與各階段組數；台/美/日/韓四區分別規劃中" },
  { id: "material-launch", title: "買量素材－上線（大方向）", status: "todo", priority: "normal", notes: "確認素材大方向與各階段組數；台/美/日/韓四區分別規劃中" },
  { id: "ad-copy", title: "通用廣告文案", status: "todo", priority: "normal", notes: "確認大方向" },
  { id: "test5", title: "【五測】九月：菲美韓測試", status: "doing", priority: "high", notes: "素材發包→初稿→反饋→終稿→菲律賓/美韓素材測試→起量→報告整理。（一～四測皆已確定完成）" },
  { id: "buy-ads-setup", title: "買量廣告：帳號創建與台美日韓執行", status: "todo", priority: "normal", notes: "META/GOOGLE帳號、AF串接、投放頁串接確定；台/美/日/韓四區執行" },
  { id: "kol-battle", title: "KOL：60分鐘實況主紓壓大亂鬥", status: "todo", priority: "normal", notes: "與 Lynn 共同；確認主題方向與擬邀名單，四區後續執行" },
  { id: "koc-game", title: "KOC-遊戲型：KOL名單", status: "todo", priority: "normal", notes: "與 Lynn 共同" },
  { id: "koc-illust", title: "KOC-插畫型：IP合作提名", status: "todo", priority: "normal", notes: "與 Lynn 共同" },
  { id: "partnership", title: "異業合作諮詢", status: "todo", priority: "normal", notes: "與 Nina 共同；初擬名單（含猿聲）→蒐集合作方式資料→內部確認→寄信" },
  { id: "featured-ios", title: "推薦版位－iOS", status: "todo", priority: "normal", notes: "與 Lynn 共同；簡報內提，需補遊戲介紹/預算/發行時間，經行銷執行企劃調整" },
  { id: "featured-gp", title: "推薦版位－GooglePlay", status: "todo", priority: "normal", notes: "與 Lynn 共同；簡報內提" }
];

function esc(s) {
  return String(s).replace(/'/g, "''");
}

const base = new Date("2026-09-14T00:00:00.000Z").getTime();
let lines = [];

projects.forEach((p, i) => {
  const ts = new Date(base + i * 1000).toISOString();
  lines.push(
    `INSERT OR IGNORE INTO projects (id, name, color, archived, created_at, updated_at) VALUES ('${esc(p.id)}', '${esc(p.name)}', '${esc(p.color)}', ${p.archived}, '${ts}', '${ts}');`
  );
});

tasks.forEach((t, i) => {
  const ts = new Date(base + (i + 1) * 1000).toISOString();
  lines.push(
    `INSERT OR IGNORE INTO tasks (id, title, project_id, status, due_date, priority, notes, created_at, updated_at) VALUES ('${esc(t.id)}', '${esc(t.title)}', 'emo-blast', '${esc(t.status)}', NULL, '${esc(t.priority)}', '${esc(t.notes)}', '${ts}', '${ts}');`
  );
});

writeFileSync(new URL("../migrations/0002_seed_from_artifact.sql", import.meta.url), lines.join("\n") + "\n");
console.log("wrote", tasks.length + projects.length, "rows");
