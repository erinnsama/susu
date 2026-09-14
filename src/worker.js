import { handleProjects } from "./api/projects.js";
import { handleTasks } from "./api/tasks.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/projects")) {
      return handleProjects(request, env, url);
    }
    if (url.pathname.startsWith("/api/tasks")) {
      return handleTasks(request, env, url);
    }

    return new Response("Not found", { status: 404 });
  }
};
