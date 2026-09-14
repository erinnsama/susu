import { json, nowIso, genId, readJson, isIsoDate, badRequest } from "../lib/util.js";

const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["low", "normal", "high"];

const PATCHABLE = {
  title: "title",
  projectId: "project_id",
  status: "status",
  dueDate: "due_date",
  priority: "priority",
  notes: "notes"
};

function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    status: r.status,
    dueDate: r.due_date,
    priority: r.priority,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/** 回傳錯誤訊息字串，沒問題就回 null */
function validate(body, { partial }) {
  if (!partial || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) return "任務名稱不能空白";
    if (title.length > 120) return "任務名稱不能超過 120 字";
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return `status 只能是 ${STATUSES.join(" / ")}`;
  }
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) {
    return `priority 只能是 ${PRIORITIES.join(" / ")}`;
  }
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== "" && !isIsoDate(body.dueDate)) {
    return "截止日期格式要是 YYYY-MM-DD";
  }
  if (body.notes !== undefined && String(body.notes || "").length > 500) {
    return "備註不能超過 500 字";
  }
  return null;
}

async function projectExists(db, id) {
  if (!id) return true;
  const row = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
  return Boolean(row);
}

export async function handleTasks(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","tasks", id?]
  const id = parts[2];
  const db = env.DB;

  if (request.method === "GET" && !id) {
    // 給 Claude 排程用的篩選：?status=todo&projectId=xxx&dueBefore=2026-09-20
    const where = [];
    const binds = [];
    const status = url.searchParams.get("status");
    if (status) {
      const wanted = status.split(",").filter((s) => STATUSES.includes(s));
      if (!wanted.length) return badRequest(`status 只能是 ${STATUSES.join(" / ")}`);
      where.push(`status IN (${wanted.map(() => "?").join(",")})`);
      binds.push(...wanted);
    }
    const projectId = url.searchParams.get("projectId");
    if (projectId) {
      where.push("project_id = ?");
      binds.push(projectId);
    }
    const dueBefore = url.searchParams.get("dueBefore");
    if (dueBefore) {
      if (!isIsoDate(dueBefore)) return badRequest("dueBefore 格式要是 YYYY-MM-DD");
      where.push("due_date IS NOT NULL AND due_date <= ?");
      binds.push(dueBefore);
    }
    const sql =
      "SELECT * FROM tasks" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY created_at ASC";
    const { results } = await db.prepare(sql).bind(...binds).all();
    return json(results.map(rowToTask));
  }

  if (request.method === "GET" && id) {
    const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "找不到這個任務" }, 404);
    return json(rowToTask(row));
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    if (!body) return badRequest("請求內容不是合法的 JSON");
    const problem = validate(body, { partial: false });
    if (problem) return badRequest(problem);
    if (!(await projectExists(db, body.projectId))) return badRequest("指定的專案不存在");

    const tid = genId();
    const ts = nowIso();
    await db
      .prepare(
        `INSERT INTO tasks (id, title, project_id, status, due_date, priority, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tid,
        String(body.title).trim(),
        body.projectId || null,
        body.status || "todo",
        body.dueDate || null,
        body.priority || "normal",
        body.notes || "",
        ts,
        ts
      )
      .run();
    const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(tid).first();
    return json(rowToTask(row), 201);
  }

  if (request.method === "PATCH" && id) {
    const body = await readJson(request);
    if (!body) return badRequest("請求內容不是合法的 JSON");
    const problem = validate(body, { partial: true });
    if (problem) return badRequest(problem);
    if (body.projectId !== undefined && !(await projectExists(db, body.projectId))) {
      return badRequest("指定的專案不存在");
    }

    const existing = await db.prepare("SELECT id FROM tasks WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "找不到這個任務" }, 404);

    const fields = [];
    const values = [];
    for (const key in PATCHABLE) {
      if (body[key] === undefined) continue;
      fields.push(`${PATCHABLE[key]} = ?`);
      if (key === "title") values.push(String(body[key]).trim());
      else if (key === "dueDate") values.push(body[key] || null);
      else if (key === "projectId") values.push(body[key] || null);
      else values.push(body[key]);
    }
    if (fields.length) {
      fields.push("updated_at = ?");
      values.push(nowIso(), id);
      await db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
    }
    const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
    return json(rowToTask(row));
  }

  if (request.method === "DELETE" && id) {
    const res = await db.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
    if (res.meta && res.meta.changes === 0) return json({ error: "找不到這個任務" }, 404);
    return json({ ok: true });
  }

  return json({ error: "不支援的操作" }, 405);
}
