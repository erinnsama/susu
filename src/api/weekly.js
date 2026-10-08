import { json, nowIso, readJson, badRequest, isIsoDate } from "../lib/util.js";

function rowToReport(r) {
  return { weekStart: r.week_start, finalText: r.final_text, updatedAt: r.updated_at };
}

export async function handleWeekly(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","weekly", weekStart?]
  const weekStart = parts[2];
  const db = env.DB;

  if (request.method === "GET" && !weekStart) {
    const { results } = await db.prepare("SELECT * FROM weekly_reports ORDER BY week_start DESC").all();
    return json(results.map(rowToReport));
  }

  if (request.method === "PUT" && weekStart) {
    if (!isIsoDate(weekStart)) return badRequest("週起始日格式要是 YYYY-MM-DD");
    const body = await readJson(request);
    if (!body) return badRequest("請求內容不是合法的 JSON");
    const text = String(body.finalText == null ? "" : body.finalText);
    if (text.length > 5000) return badRequest("內容不能超過 5000 字");
    const ts = nowIso();
    await db
      .prepare(
        `INSERT INTO weekly_reports (week_start, final_text, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(week_start) DO UPDATE SET final_text = excluded.final_text, updated_at = excluded.updated_at`
      )
      .bind(weekStart, text, ts)
      .run();
    return json({ weekStart, finalText: text, updatedAt: ts });
  }

  return json({ error: "不支援的操作" }, 405);
}
