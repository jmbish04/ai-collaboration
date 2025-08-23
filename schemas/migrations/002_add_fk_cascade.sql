BEGIN TRANSACTION;
PRAGMA foreign_keys=OFF;

-- Create new tables with FK constraints
CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'planning',
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Copy data
INSERT INTO projects_new SELECT * FROM projects;
INSERT INTO agents_new   SELECT * FROM agents;
INSERT INTO tasks_new    SELECT * FROM tasks;

-- Swap
ALTER TABLE projects RENAME TO projects_old;
ALTER TABLE projects_new RENAME TO projects;
ALTER TABLE agents RENAME TO agents_old;
ALTER TABLE agents_new RENAME TO agents;
ALTER TABLE tasks RENAME TO tasks_old;
ALTER TABLE tasks_new RENAME TO tasks;

DROP TABLE projects_old;
DROP TABLE agents_old;
DROP TABLE tasks_old;

PRAGMA foreign_keys=ON;
COMMIT;
