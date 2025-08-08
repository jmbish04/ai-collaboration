import worker from '../src/index';
import { describe, it, expect } from 'vitest';

const env = {} as any;

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
});
