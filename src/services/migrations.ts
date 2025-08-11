import type { D1Database } from '@cloudflare/workers-types';
import sql002 from '../../schemas/migrations/002_add_fk_cascade.sql?raw';

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { id: '002_add_fk_cascade', sql: sql002 },
];

/**
 * Run pending SQL migrations. Each migration is executed once and tracked in
 * the `__migrations` table.
 */
export async function runMigrations(db: D1Database): Promise<void> {
  await db
    .prepare('CREATE TABLE IF NOT EXISTS __migrations (id TEXT PRIMARY KEY)')
    .run();
  const { results } = await db
    .prepare('SELECT id FROM __migrations')
    .all<{ id: string }>();
  const done = new Set(results?.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    const statements = m.sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements) {
      await db.prepare(s).run();
    }
    await db
      .prepare('INSERT INTO __migrations (id) VALUES (?1)')
      .bind(m.id)
      .run();
  }
}
