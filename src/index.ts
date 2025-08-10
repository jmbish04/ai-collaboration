import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
  WorkflowNamespace,
} from "cloudflare:workers";

import {
  DurableObject,
  DurableObjectNamespace,
  D1Database,
} from "@cloudflare/workers-types";
import { handleMCP } from "./mcp";
import { handleProjects } from "./routes/projects";
export { ProjectCoordinator } from "./durable-objects/ProjectCoordinator";

declare global {
  const WebSocketPair: any;
}

interface Env {
  WEBSOCKET_DO: DurableObjectNamespace;
  WORKFLOW_LIVE: WorkflowNamespace;
  PROJECT_COORDINATOR: DurableObjectNamespace;
  AI_COLLABORATION_DB: D1Database;
}

const startTime = Date.now();

/**
 * Durable Object that broadcasts JSON payloads to all connected WebSocket
 * clients. It is accessed via the Worker at `GET /ws` for upgrades and
 * accepts `POST` requests with `{id, message}` payloads for broadcasting.
 */
export class WebSocketDO implements DurableObject {
  sockets = new Set<WebSocket>();
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.env = env;
  }

  /**
   * Handles WebSocket upgrades and broadcast posts.
   *
   * - `GET /ws` with `Upgrade: websocket` establishes a streaming connection
   *   that will receive messages sent to this DO.
   * - `POST /ws` with JSON `{id, message}` broadcasts the payload to all
   *   connected clients.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.sockets.add(server);
      server.accept();
      server.addEventListener("close", () => this.sockets.delete(server));
      return new Response(null, {
        status: 101,
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
        },
        webSocket: client,
      });
    }

    const { id, message } = (await request.json()) as {
      id: string;
      message: string;
    };
    this.sockets.forEach(
      (ws) =>
        ws.readyState === WebSocket.OPEN &&
        ws.send(
          JSON.stringify({ id, message, time: new Date().toISOString() }),
        ),
    );
    return new Response("OK");
  }
}

/**
 * Example workflow that logs progress through a series of timed steps.
 * The workflow streams log messages through the `WebSocketDO` so clients
 * can observe execution in real time.
 */
export class WorkFlowLive extends WorkflowEntrypoint<Env> {
  private stub = this.env.WEBSOCKET_DO.get(
    this.env.WEBSOCKET_DO.idFromName("broadcast"),
  );
  private q = Promise.resolve();

  /**
   * Entry point executed by the workflow runtime. Emits log messages over the
   * broadcast Durable Object while stepping through four sequential actions.
   */
  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const log = (message: string) =>
      (this.q = this.q.then(async () => {
        await this.stub.fetch("http://internal/", {
          method: "POST",
          body: JSON.stringify({
            id: event.instanceId,
            message,
          }),
        });
      }));

    try {
      await log("Starting workflow...");
      await step.sleep("sleep for 1 second", "1 second");
      await step.do("step1", async () => {
        await log("Processing step 1...");
        return true;
      });
      await step.sleep("sleep for 1 second", "2 second");
      await step.do("step2", async () => {
        await log("Processing step 2...");
        return true;
      });
      await step.sleep("sleep for 1 second", "3 second");
      await step.do("step3", async () => {
        await log("Processing step 3...");
        return true;
      });
      await step.sleep("sleep for 1 second", "4 second");
      await step.do("step4", async () => {
        await log("Processing step 4...");
        if (Math.random() > 0.75) throw new Error("Random failure!");
        return true;
      });
      await step.sleep("sleep for 1 second", "1 second");
      await log("Workflow complete!");
      return { success: true };
    } catch (error: any) {
      console.error(error);
      await log(`Workflow failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Main request router for the Worker.
 *
 * Routes:
 * - `GET /health` – returns health status.
 * - `GET /metrics` – returns uptime.
 * - `GET /ws` – WebSocket broadcast upgrades handled by `WebSocketDO`.
 * - `POST /api/workflow` & `GET /api/workflow/:id` – trigger and inspect example workflow runs.
 * - `/api/projects/{id}/state` – forwards to a `ProjectCoordinator` DO returning project state.
 * - `/api/projects/{id}/agents|tasks|messages` – forwards subpaths and query strings to the project DO.
 * - `/api/projects` – project CRUD persisted via D1 handled in `routes/projects`.
 * - `POST /mcp` – Model Context Protocol endpoint handled in `mcp.ts`.
 */
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/metrics") {
      return Response.json({ uptime: Date.now() - startTime });
    }
    if (url.pathname === "/ws") {
      const id = env.WEBSOCKET_DO.idFromName("broadcast");
      return env.WEBSOCKET_DO.get(id).fetch(req);
    }
    if (url.pathname === "/api/workflow") {
      const { id } = await env.WORKFLOW_LIVE.create({});
      return Response.json({ id });
    }
    if (url.pathname.startsWith("/api/workflow/")) {
      console.log("api/workflow/", url.pathname.split("/").pop());
      const id = url.pathname.split("/").pop();
      const workflow = await env.WORKFLOW_LIVE.get(id);
      return Response.json({ id, status: await workflow.status() });
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
    if (projectMatch) {
      const id = projectMatch[1];
      const subPath = `/${projectMatch[2]}`;
      const stub = env.PROJECT_COORDINATOR.get(
        env.PROJECT_COORDINATOR.idFromName(id),
      );
      const newUrl = new URL(req.url);
      newUrl.pathname = subPath;
      const newReq = new Request(newUrl.toString(), req);
      return stub.fetch(newReq);
    }
    if (url.pathname.startsWith("/api/projects")) {
      return handleProjects(req, env);
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      return handleMCP(req);
    }
    return new Response("Not found", { status: 404 });
  },
};
