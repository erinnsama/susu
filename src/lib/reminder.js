/** Asia/Taipei 沒有 DST，固定 UTC+8，直接位移計算今天日期即可 */
export function taipeiToday() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export async function findDueTasks(env, today) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, due_date FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date ASC"
  )
    .bind(today)
    .all();
  return results;
}

/** 回傳推播文字（400 字內、純文字），沒有任何逾期/今天到期的任務就回 null */
export function composeReminderMessage(rows, today) {
  const overdue = rows.filter((r) => r.due_date < today).map((r) => r.title);
  const dueToday = rows.filter((r) => r.due_date === today).map((r) => r.title);
  if (!overdue.length && !dueToday.length) return null;

  const segments = [];
  if (overdue.length) segments.push({ label: "已逾期", items: overdue });
  if (dueToday.length) segments.push({ label: "今天到期", items: dueToday });

  let remaining = 4;
  const parts = segments.map((seg) => {
    const take = seg.items.slice(0, remaining);
    remaining -= take.length;
    return `${seg.label}：${take.join("、")}`;
  });

  const totalShown = 4 - remaining;
  const totalCount = overdue.length + dueToday.length;
  const suffix = totalCount > totalShown ? `...等${totalCount}筆` : "";
  return parts.join("｜") + suffix;
}
