import type { D1Database } from "@cloudflare/workers-types";
import { DatabaseService } from "../services/DatabaseService";
import { runMigrations } from "../services/migrations";

interface Env {
  AI_COLLABORATION_DB: D1Database;
}

/**
 * Handles CRUD operations for `/api/projects` endpoints backed by the D1
 * database.
 *
 * Routes:
 * - `GET /api/projects` – list all projects.
 * - `POST /api/projects` – create a project. Body: `{ name: string, description?, status? }`.
 * - `GET /api/projects/{id}` – retrieve a project by ID.
 * - `PUT /api/projects/{id}` – update project fields with JSON body.
 * - `DELETE /api/projects/{id}` – remove the project.
 */
export async function handleProjects(
  request: Request,
  env: Env,
): Promise<Response> {
  await runMigrations(env.AI_COLLABORATION_DB);
  const db = await DatabaseService.create(env.AI_COLLABORATION_DB);
  const url = new URL(request.url);
  const id = url.pathname.split("/")[3]; // /api/projects/:id

  try {
    if (request.method === "GET" && !id) {
      const projects = await db.listProjects();
      return Response.json(projects);
    }
    if (request.method === "POST" && !id) {
      const body = await request.json();
      const project = await db.createProject(body);
      return new Response(JSON.stringify(project), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "GET" && id) {
      const project = await db.getProject(id);
      if (!project) return new Response("Not found", { status: 404 });
      return Response.json(project);
    }
    if (request.method === "PUT" && id) {
      const body = await request.json();
      try {
        const project = await db.updateProject(id, body);
        if (!project) return new Response("Not found", { status: 404 });
        return new Response(JSON.stringify(project), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        if ((err as Error).message === "Invalid status") {
          return new Response("Invalid status", { status: 400 });
        }
        throw err;
      }
    }
    if (request.method === "DELETE" && id) {
      await db.deleteProject(id);
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
}
