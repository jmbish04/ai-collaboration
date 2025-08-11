import assert from 'node:assert';
import worker from '../src/index';
import openapi from '../schemas/openapi.json';

class D1Stub {
  projects = new Map<string, any>();
  prepare(query: string) {
    const self = this;
    const q = query.trim().toUpperCase();
    const exec = (params: any[]) => ({
      async run() {
        if (q.startsWith('INSERT INTO PROJECTS')) {
          self.projects.set(params[0], {
            id: params[0],
            name: params[1],
            description: params[2],
            status: params[3] ?? 'planning',
            created_at: Math.floor(Date.now()/1000),
            updated_at: Math.floor(Date.now()/1000),
          });
        } else if (q.startsWith('UPDATE')) {
          const id = params.pop();
          const p = self.projects.get(id);
          if (p) {
            const assignments = q.substring(q.indexOf('SET')+4, q.indexOf('WHERE')).split(',').map(s=>s.trim());
            let i=0;
            for (const assign of assignments) {
              const [field, expr] = assign.split('=');
              const key = field.trim().toLowerCase();
              if (expr.includes('?')) {
                p[key] = params[i++];
              } else if (key === 'updated_at') {
                p.updated_at = Math.floor(Date.now()/1000);
              }
            }
            if (!assignments.some(a=>a.split('=')[0].trim().toLowerCase()==='updated_at')) {
              p.updated_at = Math.floor(Date.now()/1000);
            }
          }
        } else if (q.startsWith('DELETE FROM PROJECTS')) {
          self.projects.delete(params[0]);
        }
        return { success: true } as any;
      },
      async all<T>() {
        if (q.includes('WHERE')) {
          const proj = self.projects.get(params[0]);
          return { results: proj ? [proj as T] : [] } as any;
        }
        return { results: Array.from(self.projects.values()) as T[] } as any;
      }
    });
    return {
      bind(...params: any[]) {
        return exec(params);
      },
      all<T>() {
        return exec([]).all<T>();
      }
    };
  }
}

async function main() {
  assert(openapi.paths);
  const env: any = {
    AI_COLLABORATION_DB: new D1Stub(),
    PROJECT_COORDINATOR: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: async (_req: Request) =>
          id === 'missing'
            ? new Response('Not found', { status: 404 })
            : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      }),
    },
  };

  // create project without read-only fields
  let res = await worker.fetch(
    new Request('http://localhost/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    }),
    env,
  );
  assert.equal(res.status, 201);
  const proj = await res.json();

  // update project
  res = await worker.fetch(
    new Request(`http://localhost/api/projects/${proj.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'updated' }),
    }),
    env,
  );
  assert.equal(res.status, 200);

  // get project
  res = await worker.fetch(new Request(`http://localhost/api/projects/${proj.id}`), env);
  assert.equal(res.status, 200);

  // get missing project
  res = await worker.fetch(new Request('http://localhost/api/projects/missing'), env);
  assert.equal(res.status, 404);

  // delete project
  res = await worker.fetch(
    new Request(`http://localhost/api/projects/${proj.id}`, { method: 'DELETE' }),
    env,
  );
  assert.equal(res.status, 204);

  // agents happy path
  res = await worker.fetch(
    new Request('http://localhost/api/projects/abc/agents'),
    env,
  );
  assert.equal(res.status, 200);

  // agents 404
  res = await worker.fetch(
    new Request('http://localhost/api/projects/missing/agents'),
    env,
  );
  assert.equal(res.status, 404);

  // tasks happy path
  res = await worker.fetch(
    new Request('http://localhost/api/projects/abc/tasks'),
    env,
  );
  assert.equal(res.status, 200);

  // tasks 404
  res = await worker.fetch(
    new Request('http://localhost/api/projects/missing/tasks'),
    env,
  );
  assert.equal(res.status, 404);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
