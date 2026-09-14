import { json, nowIso, genId } from "../lib/util.js";

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

export async function handleTasks(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","tasks", id?]
  const id = parts[2];
  const db = env.DB;

  if (request.method === "GET" && !id) {
    const { results } = await db.prepare("SELECT * FROM tasks ORDER BY created_at ASC").all();
    return json(results.map(rowToTask));
  }

  if (request.method === "POST" && !id) {
    const body = await request.json();
    if (!body.title) return json({ error: "title is required" }, 400);
    const tid = genId();
    const ts = nowIso();
    await db
      .prepare(
        `INSERT INTO tasks (id, title, project_id, status, due_date, priority, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tid,
        body.title,
        body.projectId || null,
        body.status || "todo",
        body.dueDate || null,
        body.priority || "normal",
        body.notes || "",
        ts,
        ts
      )
      .run();
    return json({ id: tid }, 201);
  }

  if (request.method === "PATCH" && id) {
    const body = await request.json();
    const fields = [];
    const values = [];
    for (const key in PATCHABLE) {
      if (body[key] !== undefined) {
        fields.push(`${PATCHABLE[key]} = ?`);
        values.push(body[key]);
      }
    }
    if (!fields.length) return json({ ok: true });
    fields.push("updated_at = ?");
    values.push(nowIso(), id);
    await db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE" && id) {
    await db.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
