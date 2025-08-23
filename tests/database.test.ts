import { describe, it, expect } from 'vitest';
import { DatabaseService } from '../src/services/DatabaseService';

class MockDB {
  last: { query: string; params: any[] } | null = null;
  prepare(query: string) {
    const self = this;
    return {
      bind(...params: any[]) {
        self.last = { query, params };
        return {
          async run() {},
        };
      },
    };
  }
}

describe('DatabaseService.updateProject', () => {
  it('updates only provided fields', async () => {
    const db = new MockDB();
    const svc = new DatabaseService(db as any);
    (svc as any).getProject = async () => ({ id: '1', name: 'old', description: 'desc', status: 'planning', createdAt: 0, updatedAt: 0 });
    await svc.updateProject('1', { name: 'new' });
    expect(db.last?.query).toBe('UPDATE projects SET name=?, updated_at=unixepoch() WHERE id=?');
    expect(db.last?.params).toEqual(['new', '1']);
  });

  it('sets description to null when provided', async () => {
    const db = new MockDB();
    const svc = new DatabaseService(db as any);
    (svc as any).getProject = async () => ({ id: '1', name: 'old', description: 'desc', status: 'planning', createdAt: 0, updatedAt: 0 });
    await svc.updateProject('1', { description: null });
    expect(db.last?.query).toBe('UPDATE projects SET description=?, updated_at=unixepoch() WHERE id=?');
    expect(db.last?.params).toEqual([null, '1']);
  });

  it('returns project unchanged when no fields provided', async () => {
    const db = new MockDB();
    const svc = new DatabaseService(db as any);
    const project = { id: '1', name: 'old', description: 'desc', status: 'planning', createdAt: 0, updatedAt: 0 };
    (svc as any).getProject = async () => project;
    const result = await svc.updateProject('1', {});
    expect(result).toBe(project);
    expect(db.last).toBeNull();
  });
});
