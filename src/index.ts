import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  DurableObject,
  DurableObjectNamespace,
  DurableObjectState
} from '@cloudflare/workers-types';

interface WorkflowInstance {
  status(): Promise<unknown>;
}

interface WorkflowAPI {
  create(init: Record<string, unknown>): Promise<{ id: string }>;
  get(id: string): Promise<WorkflowInstance>;
}

interface Env {
  WEBSOCKET_DO: DurableObjectNamespace;
  WORKFLOW_LIVE: WorkflowAPI;
}

const startTime = Date.now();

/**
 * Durable Object: simple WebSocket broadcaster.
 * - Connect with GET /ws (Hono route below), which proxies the upgrade to this DO.
 * - POST JSON { id, message } to broadcast to all connected sockets.
 */
export class WebSocketDO implements DurableObject {
  private sockets = new Set<WebSocket>();
  // state is unused but kept for signature completeness
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();

      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));

      return new Response(null, {
        status: 101,
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade'
        },
        webSocket: client
      } as any);
    }

    // Broadcast message payload
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

// ----------------- Hono app (Worker router) -----------------

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
 * Note: This binds to your upstream service; not Cloudflare Workflows.
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

export default {
  fetch: app.fetch
};