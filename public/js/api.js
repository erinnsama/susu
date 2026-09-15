const API_BASE = "/api";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      ...options
    });
  } catch {
    throw new ApiError("連不上伺服器，請確認網路連線", 0);
  }

  if (!res.ok) {
    // Worker 回的錯誤訊息是 JSON；Cloudflare Access 擋下來時可能回 HTML 登入頁
    let message = "";
    try {
      const data = await res.clone().json();
      message = data && data.error ? data.error : "";
    } catch {
      message = "";
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(message || "登入已過期，請重新登入", res.status);
    }
    throw new ApiError(message || `伺服器錯誤（${res.status}）`, res.status);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request("/me"),
  health: () => request("/health"),
  config: () => request("/config"),
  listProjects: () => request("/projects"),
  addProject: (data) => request("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id, patch) => request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: "DELETE" }),
  listTasks: () => request("/tasks"),
  addTask: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, patch) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
  pushSubscribe: (subscription) => request("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  pushUnsubscribe: (endpoint) => request("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  pushTest: () => request("/push/test", { method: "POST" })
};
