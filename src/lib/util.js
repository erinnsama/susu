export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function genId() {
  return crypto.randomUUID();
}
