import { json, nowIso, genId, readJson, badRequest } from "../lib/util.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#DE5D83";

function rowToProject(r) {
  return { id: r.id, name: r.name, color: r.color, archived: !!r.archived };
}

function validate(body, { partial }) {
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return "專案名稱不能空白";
    if (name.length > 40) return "專案名稱不能超過 40 字";
  }
  if (body.color !== undefined && !HEX_COLOR.test(String(body.color))) {
    return "顏色格式要是 #RRGGBB";
  }
  return null;
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
    const body = await readJson(request);
    if (!body) return badRequest("請求內容不是合法的 JSON");
    const problem = validate(body, { partial: false });
    if (problem) return badRequest(problem);

    const pid = genId();
    const ts = nowIso();
    const color = body.color || DEFAULT_COLOR;
    const name = String(body.name).trim();
    await db
      .prepare("INSERT INTO projects (id, name, color, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(pid, name, color, body.archived ? 1 : 0, ts, ts)
      .run();
    return json({ id: pid, name, color, archived: !!body.archived }, 201);
  }

  if (request.method === "PATCH" && id) {
    const body = await readJson(request);
    if (!body) return badRequest("請求內容不是合法的 JSON");
    const problem = validate(body, { partial: true });
    if (problem) return badRequest(problem);

    const existing = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "找不到這個專案" }, 404);

    const fields = [];
    const values = [];
    if (body.name !== undefined) { fields.push("name = ?"); values.push(String(body.name).trim()); }
    if (body.color !== undefined) { fields.push("color = ?"); values.push(body.color); }
    if (body.archived !== undefined) { fields.push("archived = ?"); values.push(body.archived ? 1 : 0); }
    if (fields.length) {
      fields.push("updated_at = ?");
      values.push(nowIso(), id);
      await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
    }
    const row = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
    return json(rowToProject(row));
  }

  if (request.method === "DELETE" && id) {
    const existing = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "找不到這個專案" }, 404);

    // 底下的任務一起刪掉，用 batch 送出去，不會刪到一半卡住留下孤兒任務
    await db.batch([
      db.prepare("DELETE FROM tasks WHERE project_id = ?").bind(id),
      db.prepare("DELETE FROM projects WHERE id = ?").bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: "不支援的操作" }, 405);
}
