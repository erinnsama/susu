const API_BASE = "/api";

async function request(path, options) {
  const res = await fetch(API_BASE + path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!res.ok) throw new Error("API error " + res.status + " on " + path);
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listProjects: () => request("/projects"),
  addProject: (data) => request("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id, patch) => request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: "DELETE" }),
  listTasks: () => request("/tasks"),
  addTask: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, patch) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" })
};
