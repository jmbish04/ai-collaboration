-- Rebuild agents table with ON DELETE CASCADE
PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;

CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO agents_new SELECT * FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

COMMIT;
