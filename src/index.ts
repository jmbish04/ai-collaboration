import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep
} from "cloudflare:workers";

import {
  DurableObject,
  DurableObjectNamespace,
  Request
} from '@cloudflare/workers-types';
import { Hono } from 'hono';

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

// Simple workflow with logging
export class WorkFlowLive extends WorkflowEntrypoint<Env> {
  private stub = this.env.WEBSOCKET_DO.get(
    this.env.WEBSOCKET_DO.idFromName('broadcast')
  );
  private q = Promise.resolve();

  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const log = (message: string) => this.q = this.q.then(async () => {
      await this.stub.fetch('http://internal/', {
        method: 'POST',
        body: JSON.stringify({
          id: event.instanceId,
          message
        })
      });
    });

    try {
      await log('Starting workflow...');
      await step.sleep("sleep for 1 second", "1 second");
      await step.do('step1', async () => { await log('Processing step 1...'); return true; });
      await step.sleep("sleep for 1 second", "2 second");
      await step.do('step2', async () => { await log('Processing step 2...'); return true; });
      await step.sleep("sleep for 1 second", "3 second");
      await step.do('step3', async () => { await log('Processing step 3...'); return true; });
      await step.sleep("sleep for 1 second", "4 second");
      await step.do('step4', async () => {
        await log('Processing step 4...');
        if (Math.random() > 0.75) throw new Error('Random failure!');
        return true;
      });
      await step.sleep("sleep for 1 second", "1 second");
      await log('Workflow complete!');
      return { success: true };
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      await log(`Workflow failed: ${message}`);
      return { success: false, error: message };
    }
  }
}

// Hono router for worker endpoints
const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/metrics', (c) => c.json({ uptime: Date.now() - startTime }));

app.get('/ws', (c) => {
  const id = c.env.WEBSOCKET_DO.idFromName('broadcast');
  return c.env.WEBSOCKET_DO.get(id).fetch(c.req.raw);
});

app.post('/api/workflow', async (c) => {
  const { id } = await c.env.WORKFLOW_LIVE.create({});
  return c.json({ id });
});

app.get('/api/workflow/:id', async (c) => {
  const id = c.req.param('id');
  const workflow = await c.env.WORKFLOW_LIVE.get(id);
  const status = await workflow.status();
  return c.json({ id, status });
});

export default {
  fetch: app.fetch
};
