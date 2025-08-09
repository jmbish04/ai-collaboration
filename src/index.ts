import { Hono } from 'hono';
import type { Context } from 'hono';

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

// Simple WebSocket broadcaster
export class WebSocketDO implements DurableObject {
  sockets = new Set<WebSocket>();
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.sockets.add(server);
      server.accept();
      server.addEventListener('close', () => this.sockets.delete(server));
      return new Response(null, {
        status: 101,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade'
        },
        webSocket: client
      });
    }

    const { id, message }: { id: string; message: string } = await request.json();
    this.sockets.forEach(ws =>
      ws.readyState === WebSocket.OPEN &&
      ws.send(JSON.stringify({ id, message, time: new Date().toISOString() }))
    );
    return new Response('OK');
  }
}

// Hono router for worker endpoints
const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c: Context<{ Bindings: Env }>) => c.json({ status: 'ok' }));
app.get('/metrics', (c: Context<{ Bindings: Env }>) => c.json({ uptime: Date.now() - startTime }));

app.get('/ws', (c: Context<{ Bindings: Env }>) => {
  const id = c.env.WEBSOCKET_DO.idFromName('broadcast');
  return c.env.WEBSOCKET_DO.get(id).fetch(c.req.raw);
});

app.post('/api/workflow', async (c: Context<{ Bindings: Env }>) => {
  const { id } = await c.env.WORKFLOW_LIVE.create({});
  return c.json({ id });
});

app.get('/api/workflow/:id', async (c: Context<{ Bindings: Env }>) => {
  const id = c.req.param('id');
  const workflow = await c.env.WORKFLOW_LIVE.get(id);
  const status = await workflow.status();
  return c.json({ id, status });
});

export default {
  fetch: app.fetch
};
