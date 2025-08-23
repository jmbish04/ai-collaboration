import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
  WorkflowNamespace,
} from 'cloudflare:workers';
import type {
  DurableObject,
  DurableObjectNamespace,
  DurableObjectState,
  D1Database,
} from '@cloudflare/workers-types';
import { handleMCP } from './mcp';
import { handleProjects } from './routes/projects';
export { ProjectCoordinator } from './durable-objects/ProjectCoordinator';

// Consolidated interface for all bindings used across both branches
interface Env {
  WEBSOCKET_DO: DurableObjectNamespace;
  // Using WorkflowNamespace as the type, which is compatible with WorkflowAPI
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
  private sockets = new Set<WebSocket>();
  // state is unused but kept for signature completeness
  constructor(_state: DurableObjectState, _env: Env) {}

  /**
   * Handles WebSocket upgrades and broadcast posts.
   *
   * - `GET /ws` with `Upgrade: websocket` establishes a streaming connection
   * that will receive messages sent to this DO.
   * - `POST /ws` with JSON `{id, message}` broadcasts the payload to all
   * connected clients.
   */
  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade handling from both branches (consolidated)
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      // Add error and close listeners from the main branch
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));

      this.sockets.add(server);

      return new Response(null, {
        status: 101,
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
        webSocket: client,
      } as any);
    }

    // Broadcast message payload logic from main branch
    try {
      const { id, message }: { id: string; message: string } = await request.json();
      const payload = JSON.stringify({ id, message, time: new Date().toISOString() });
      for (const ws of this.sockets) {
        try {
          // @ts-ignore - Workers' WebSocket has OPEN numeric state
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
        } catch {
          this.sockets.delete(ws);
        }
      }
      return new Response('OK');
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }
  }
}

/**
 * Example workflow that logs progress through a series of timed steps.
 * The workflow streams log messages through the `WebSocketDO` so clients
 * can observe execution in real time.
 */
export class WorkFlowLive extends WorkflowEntrypoint<Env> {
  private stub = this.env.WEBSOCKET_DO.get(
    this.env.WEBSOCKET_DO.idFromName('broadcast')
  );
  private q = Promise.resolve();

  /**
   * Entry point executed by the workflow runtime. Emits log messages over the
   * broadcast Durable Object while stepping through four sequential actions.
   */
  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const log = (message: string) =>
      (this.q = this.q.then(async () => {
        await this.stub.fetch('http://internal/', {
          method: 'POST',
          body: JSON.stringify({
            id: event.instanceId,
            message,
          }),
        });
      }));

    try {
      await log('Starting workflow...');
      await step.sleep('sleep for 1 second', '1 second');
      await step.do('step1', async () => {
        await log('Processing step 1...');
        return true;
      });
      await step.sleep('sleep for 1 second', '2 second');
      await step.do('step2', async () => {
        await log('Processing step 2...');
        return true;
      });
      await step.sleep('sleep for 1 second', '3 second');
      await step.do('step3', async () => {
        await log('Processing step 3...');
        return true;
      });
      await step.sleep('sleep for 1 second', '4 second');
      await step.do('step4', async () => {
        await log('Processing step 4...');
        if (Math.random() > 0.75) throw new Error('Random failure!');
        return true;
      });
      await step.sleep('sleep for 1 second', '1 second');
      await log('Workflow complete!');
      return { success: true };
    } catch (error: any) {
      console.error(error);
      await log(`Workflow failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// ----------------- Hono app (Worker router) -----------------
// Adopt the Hono routing structure from the main branch and add all routes.

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c: Context<{ Bindings: Env }>) =>
  c.json({ status: 'ok' })
);

app.get('/metrics', (c: Context<{ Bindings: Env }>) =>
  c.json({ uptime: Date.now() - startTime })
);

/**
 * WebSocket endpoint. Hono proxies the request to the DO which performs the upgrade.
 */
app.get('/ws', (c: Context<{ Bindings: Env }>) => {
  const id = c.env.WEBSOCKET_DO.idFromName('broadcast');
  const stub = c.env.WEBSOCKET_DO.get(id);
  return stub.fetch(c.req.raw);
});

/**
 * Create a new workflow instance via the bound WORKFLOW_LIVE API.
 */
app.post('/api/workflow', async (c: Context<{ Bindings: Env }>) => {
  const { id } = await c.env.WORKFLOW_LIVE.create({});
  return c.json({ id });
});

/**
 * Get workflow status via the bound WORKFLOW_LIVE API.
 */
app.get('/api/workflow/:id', async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param('id');
  const workflow = await c.env.WORKFLOW_LIVE.get(id);
  const status = await workflow.status();
  return c.json({ id, status });
});

/**
 * Routes for the ProjectCoordinator Durable Object from the codex branch.
 * Use `app.all` so that any HTTP method is proxied through to the DO.
 */
app.all('/api/projects/:id/:subpath{.*}', async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param('id');
  const subPath = c.req.param('subpath');
  const stub = c.env.PROJECT_COORDINATOR.get(
    c.env.PROJECT_COORDINATOR.idFromName(id)
  );
  const newUrl = new URL(c.req.url);
  newUrl.pathname = `/${subPath}`;
  const newReq = new Request(newUrl.toString(), c.req.raw);
  return stub.fetch(newReq);
});

/**
 * Routes for project CRUD operations from the codex branch.
 */
app.all('/api/projects', (c: Context<{ Bindings: Env }>) => {
  return handleProjects(c.req.raw, c.env);
});
app.all('/api/projects/:id', (c: Context<{ Bindings: Env }>) => {
  return handleProjects(c.req.raw, c.env);
});

/**
 * Route for Model Context Protocol endpoint from the codex branch.
 */
app.post('/mcp', async (c: Context<{ Bindings: Env }>) => {
  return handleMCP(c.req.raw);
});

// Fallback for not found pages
app.all('*', (c: Context<{ Bindings: Env }>) => {
    return new Response('Not found', { status: 404 });
});

export default {
  fetch: app.fetch,
};
