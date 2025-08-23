import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
  WorkflowEntrypoint: class {},
  WorkflowEvent: class {},
  WorkflowStep: class {},
  WorkflowNamespace: class {}
}));
import worker from '../src/index';
import { ProjectCoordinator } from '../src/durable-objects/ProjectCoordinator';
import { DatabaseService } from '../src/services/DatabaseService';

class D1Stub {
  projects = new Map<string, any>();
  agents = new Map<string, any>();
  tasks = new Map<string, any>();
  fk = false;
  prepare(query: string) {
    const self = this;
    const q = query.trim().toUpperCase();

    const exec = (params: any[]) => ({
      async run() {
        if (q.startsWith('PRAGMA FOREIGN_KEYS=ON')) {
          self.fk = true;
        } else if (q.startsWith('PRAGMA FOREIGN_KEYS=OFF')) {
          self.fk = false;
        } else if (q.startsWith('EXPLAIN')) {
          // no-op
        } else if (q.startsWith('INSERT INTO PROJECTS')) {
          self.projects.set(params[0], {
            id: params[0],
            name: params[1],
            description: params[2],
            status: params[3] ?? 'planning',
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
          });
        } else if (q.startsWith('INSERT INTO AGENTS')) {
          self.agents.set(params[0], {
            id: params[0],
            project_id: params[1],
            name: params[2],
          });
        } else if (q.startsWith('INSERT INTO TASKS')) {
          self.tasks.set(params[0], {
            id: params[0],
            project_id: params[1],
            title: params[2],
          });
        } else if (q.startsWith('UPDATE')) {
          const p = self.projects.get(params.pop());
          if (p) {
            const updates: Record<string, any> = {};
            const fields = q
              .substring(q.indexOf('SET') + 4, q.indexOf('WHERE'))
              .split(',')
              .map((s) => s.trim().split('=')[0].toLowerCase());

            fields.forEach((field, index) => {
              if (index < params.length) updates[field] = params[index];
            });
            for (const [key, value] of Object.entries(updates)) {
              p[key] = value;
            }

            p.updated_at = Math.floor(Date.now() / 1000);
          }
        } else if (q.startsWith('DELETE FROM PROJECTS')) {
          self.projects.delete(params[0]);
          if (self.fk) {
            for (const [id, a] of Array.from(self.agents.entries())) {
              if (a.project_id === params[0]) self.agents.delete(id);
            }
            for (const [id, t] of Array.from(self.tasks.entries())) {
              if (t.project_id === params[0]) self.tasks.delete(id);
            }
          }
        }
        return { success: true } as any;
      },
      async all<T>() {
        if (q.startsWith('SELECT ID, NAME')) {
          if (q.includes('WHERE')) {
            const proj = self.projects.get(params[0]);
            return { results: proj ? [proj as T] : [] } as any;
          }
          return { results: Array.from(self.projects.values()) as T[] } as any;
        }
        return { results: [] as T[] } as any;
      },
    });
    return {
      bind(...params: any[]) {
        return exec(params);
      },
      all<T>() {
        return exec([]).all<T>();
      },
    };
  }
}

let env: any;
let doStubFetch: any;
beforeEach(() => {
  doStubFetch = vi.fn(async (req: Request) =>
    new Response(
      JSON.stringify({
        path: new URL(req.url).pathname,
        method: req.method,
        search: new URL(req.url).search,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    ),
  );
  env = {
    AI_COLLABORATION_DB: new D1Stub(),
    PROJECT_COORDINATOR: {
      idFromName: vi.fn(() => 'id'),
      get: vi.fn(() => ({ fetch: doStubFetch })),
    },
  };
});

describe('worker', () => {
  it('returns ok on /health', async () => {
    const res = await worker.fetch(new Request('http://localhost/health'), env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('reports uptime on /metrics', async () => {
    const res = await worker.fetch(new Request('http://localhost/metrics'), env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });

  it('responds to MCP ping', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        body: JSON.stringify({ method: 'ping' })
      }),
      env
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result).toBe('pong');
  });

  it('creates, lists, and updates projects with timestamps', async () => {
    const create = await worker.fetch(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'test project' })
      }),
      env
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(typeof created.createdAt).toBe('number');
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.status).toBe('planning');

    const list = await worker.fetch(new Request('http://localhost/api/projects'), env);
    const projects = await list.json();
    expect(projects.length).toBe(1);
    expect(projects[0].createdAt).toBe(created.createdAt);
    expect(projects[0].status).toBe('planning');

    const update = await worker.fetch(
      new Request(`http://localhost/api/projects/${created.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'active' })
      }),
      env
    );
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated.status).toBe('active');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('forwards agent operations to the ProjectCoordinator DO', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/projects/123/agents', {
        method: 'POST',
        body: JSON.stringify({ name: 'Agent 1' }),
      }),
      env,
    );
    expect(doStubFetch).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.path).toBe('/agents');
    expect(body.method).toBe('POST');
  });

  it('forwards query strings to the ProjectCoordinator DO', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/projects/123/tasks?status=todo&tags=foo,bar'),
      env,
    );
    expect(doStubFetch).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.path).toBe('/tasks');
    expect(body.search).toBe('?status=todo&tags=foo,bar');
  });

  it('forwards additional subpaths like context, analytics, and initialize', async () => {
    let res = await worker.fetch(
      new Request('http://localhost/api/projects/123/context', {
        method: 'PUT',
        body: JSON.stringify({ foo: 'bar' })
      }),
      env,
    );
    expect(doStubFetch).toHaveBeenCalledOnce();
    let body = await res.json();
    expect(body.path).toBe('/context');
    expect(body.method).toBe('PUT');

    res = await worker.fetch(
      new Request('http://localhost/api/projects/123/analytics'),
      env,
    );
    expect(doStubFetch).toHaveBeenCalledTimes(2);
    body = await res.json();
    expect(body.path).toBe('/analytics');
    expect(body.method).toBe('GET');

    res = await worker.fetch(
      new Request('http://localhost/api/projects/123/initialize', {
        method: 'POST',
        body: JSON.stringify({})
      }),
      env,
    );
    expect(doStubFetch).toHaveBeenCalledTimes(3);
    body = await res.json();
    expect(body.path).toBe('/initialize');
    expect(body.method).toBe('POST');
  });
});

describe('ProjectCoordinator filtering', () => {
  const createDO = () => {
    const storage = new Map<string, any>();
    const state: any = {
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: any) => {
          storage.set(key, value);
        },
      },
      blockConcurrencyWhile: async (fn: () => any) => {
        await fn();
      },
    };
    return new ProjectCoordinator(state, {} as any);
  };

  it('limits and filters messages', async () => {
    const pc = createDO();
    await pc.fetch(
      new Request('http://do/messages', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'a1', type: 'chat', content: 'hello' }),
      }),
    );
    await pc.fetch(
      new Request('http://do/messages', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'a2', type: 'status', content: 'ok' }),
      }),
    );
    await pc.fetch(
      new Request('http://do/messages', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'a3', type: 'chat', content: 'bye' }),
      }),
    );
    const res = await pc.fetch(
      new Request('http://do/messages?limit=1&type=chat'),
    );
    const messages = await res.json();
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('bye');
  });

  it('filters tasks by tags and status', async () => {
    const pc = createDO();
    await pc.fetch(
      new Request('http://do/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 't1', tags: ['foo'], status: 'todo' }),
      }),
    );
    await pc.fetch(
      new Request('http://do/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 't2', tags: ['bar'], status: 'in-progress' }),
      }),
    );
    await pc.fetch(
      new Request('http://do/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 't3', tags: ['foo', 'baz'], status: 'todo' }),
      }),
    );
    const res = await pc.fetch(
      new Request('http://do/tasks?tags=foo,bar&status=todo'),
    );
    const tasks = await res.json();
    expect(tasks.length).toBe(2);
    const titles = tasks.map((t: any) => t.title).sort();
    expect(titles).toEqual(['t1', 't3']);
  });
});

describe('DatabaseService.updateProject', () => {
  let db: DatabaseService;
  let d1: D1Stub;

  beforeEach(() => {
    d1 = new D1Stub();
    db = new DatabaseService(d1 as any);
  });

  it('updates only specified fields', async () => {
    await db.createProject({ id: 'p1', name: 'n', description: 'd', status: 'planning' });
    const updated = await db.updateProject('p1', { status: 'active' });
    expect(updated?.status).toBe('active');
    expect(updated?.name).toBe('n');
    expect(updated?.description).toBe('d');
  });

  it('sets description to null when provided', async () => {
    await db.createProject({ id: 'p2', name: 'n', description: 'd', status: 'planning' });
    await db.updateProject('p2', { description: null });
    expect(d1.projects.get('p2').description).toBeNull();
  });

  it('returns current project when no fields supplied', async () => {
    await db.createProject({ id: 'p3', name: 'n', description: 'd', status: 'planning' });
    const before = await db.getProject('p3');
    const result = await db.updateProject('p3', {});
    expect(result).toEqual(before);
  });
});