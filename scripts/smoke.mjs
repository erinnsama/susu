/**
 * 對著本機 `npm run dev` 打一輪 API，確認新增/修改/刪除都正常。
 * 用法：先開一個終端機跑 npm run dev，再跑 npm run smoke
 */
const BASE = process.env.BASE || "http://localhost:8787";

let pass = 0;
let fail = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const health = await call("GET", "/api/health");
check("健康檢查回 200", health.status === 200, health);
check("資料庫連得上", health.data.database === "ok", health.data);

const proj = await call("POST", "/api/projects", { name: "煙霧測試專案", color: "#3E7FC4" });
check("建立專案", proj.status === 201, proj);
const pid = proj.data.id;

const badColor = await call("POST", "/api/projects", { name: "壞顏色", color: "紅色" });
check("顏色格式錯誤擋下來", badColor.status === 400, badColor);

const task = await call("POST", "/api/tasks", {
  title: "煙霧測試任務",
  projectId: pid,
  status: "todo",
  dueDate: "2026-09-20",
  priority: "high",
  notes: "測試用"
});
check("建立任務", task.status === 201, task);
check("建立任務回傳完整內容", task.data.title === "煙霧測試任務" && task.data.dueDate === "2026-09-20", task.data);
const tid = task.data.id;

const badStatus = await call("POST", "/api/tasks", { title: "壞狀態", status: "不存在" });
check("狀態不合法擋下來（不是 500）", badStatus.status === 400, badStatus);

const badDate = await call("POST", "/api/tasks", { title: "壞日期", dueDate: "2026/09/20" });
check("日期格式錯誤擋下來", badDate.status === 400, badDate);

const noTitle = await call("POST", "/api/tasks", { title: "   " });
check("空白標題擋下來", noTitle.status === 400, noTitle);

const ghostProject = await call("POST", "/api/tasks", { title: "鬼專案", projectId: "不存在的專案" });
check("不存在的專案擋下來", ghostProject.status === 400, ghostProject);

const moved = await call("PATCH", `/api/tasks/${tid}`, { status: "doing" });
check("更新任務狀態", moved.status === 200 && moved.data.status === "doing", moved);

const filtered = await call("GET", "/api/tasks?status=doing");
check("依狀態篩選", filtered.status === 200 && filtered.data.some((t) => t.id === tid), filtered.status);

const due = await call("GET", "/api/tasks?dueBefore=2026-09-30");
check("依到期日篩選（給排程用）", due.status === 200 && due.data.some((t) => t.id === tid), due.status);

const missing = await call("PATCH", "/api/tasks/根本沒有這個id", { status: "done" });
check("改不存在的任務回 404", missing.status === 404, missing);

const delProject = await call("DELETE", `/api/projects/${pid}`);
check("刪除專案", delProject.status === 200, delProject);

const orphan = await call("GET", `/api/tasks/${tid}`);
check("專案底下的任務一併刪掉", orphan.status === 404, orphan);

const notFound = await call("GET", "/api/亂打的路徑");
check("不存在的 API 路徑回 404", notFound.status === 404, notFound);

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
