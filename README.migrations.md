# Database Migrations

## 2025-08-11 Agents Cascade

Adds `ON DELETE CASCADE` to `agents.project_id` so agents are removed automatically when their parent project is deleted.

### Steps
1. Create `agents_new` table with cascading foreign key.
2. Copy data from existing `agents` table.
3. Drop old `agents` table.
4. Rename `agents_new` to `agents`.

Run migrations with:
```bash
npx wrangler d1 migrations apply ai-collaboration-db
```

## 2025-08-11 Tasks Cascade

Adds `ON DELETE CASCADE` to `tasks.project_id` so tasks are removed automatically when their project is deleted.

### Steps
1. Create `tasks_new` table with cascading foreign key.
2. Copy data from existing `tasks` table.
3. Drop old `tasks` table.
4. Rename `tasks_new` to `tasks`.
