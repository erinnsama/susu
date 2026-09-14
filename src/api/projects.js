import { json, nowIso, genId } from "../lib/util.js";

function rowToProject(r) {
  return { id: r.id, name: r.name, color: r.color, archived: !!r.archived };
}

export async function handleProjects(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","projects", id?]
  const id = parts[2];
  const db = env.DB;

  if (request.method === "GET" && !id) {
    const { results } = await db.prepare("SELECT * FROM projects ORDER BY created_at ASC").all();
    return json(results.map(rowToProject));
  }

  if (request.method === "POST" && !id) {
    const body = await request.json();
    if (!body.name) return json({ error: "name is required" }, 400);
    const pid = genId();
    const ts = nowIso();
    await db
      .prepare("INSERT INTO projects (id, name, color, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(pid, body.name, body.color || "#DE5D83", body.archived ? 1 : 0, ts, ts)
      .run();
    return json({ id: pid, name: body.name, color: body.color || "#DE5D83", archived: !!body.archived }, 201);
  }

  if (request.method === "PATCH" && id) {
    const body = await request.json();
    const fields = [];
    const values = [];
    if (body.name !== undefined) { fields.push("name = ?"); values.push(body.name); }
    if (body.color !== undefined) { fields.push("color = ?"); values.push(body.color); }
    if (body.archived !== undefined) { fields.push("archived = ?"); values.push(body.archived ? 1 : 0); }
    if (!fields.length) return json({ ok: true });
    fields.push("updated_at = ?");
    values.push(nowIso(), id);
    await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE" && id) {
    await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
