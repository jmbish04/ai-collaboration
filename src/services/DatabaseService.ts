import type { D1Database } from "@cloudflare/workers-types";
import type { Project } from "../types/Project";

interface DBProject {
  id: string;
  name: string;
  description: string | null;
  status: Project["status"];
  created_at: number;
  updated_at: number;
}

function mapProject(row: DBProject): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status ?? "planning",
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

export class DatabaseService {
  constructor(private db: D1Database) {}

  async listProjects(): Promise<Project[]> {
    const { results } = await this.db
      .prepare(
        "SELECT id, name, description, status, created_at, updated_at FROM projects",
      )
      .all<DBProject>();
    return (results ?? []).map(mapProject);
  }

  async getProject(id: string): Promise<Project | null> {
    const { results } = await this.db
      .prepare(
        "SELECT id, name, description, status, created_at, updated_at FROM projects WHERE id=?1",
      )
      .bind(id)
      .all<DBProject>();
    return results && results[0] ? mapProject(results[0]) : null;
  }

  async createProject(data: {
    id?: string;
    name: string;
    description?: string;
    status?: Project["status"];
  }): Promise<Project> {
    const id = data.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?1, ?2, ?3, IFNULL(?4,'planning'), unixepoch(), unixepoch())",
      )
      .bind(id, data.name, data.description ?? null, data.status ?? null)
      .run();
    const project = await this.getProject(id);
    if (!project) throw new Error("Failed to load created project");
    return project;
  }

  async updateProject(
    id: string,
    data: { name?: string; description?: string | null; status?: Project["status"] },
  ): Promise<Project | null> {
    const fields: string[] = [];
    const values: any[] = [];

    if ("name" in data) {
      fields.push("name=?");
      values.push(data.name);
    }
    if ("description" in data) {
      fields.push("description=?");
      values.push(data.description);
    }
    if ("status" in data) {
      fields.push("status=?");
      values.push(data.status);
    }

    if (fields.length === 0) {
      return await this.getProject(id);
    }

    fields.push("updated_at=unixepoch()");
    const sql = `UPDATE projects SET ${fields.join(", ")} WHERE id=?`;
    values.push(id);
    await this.db.prepare(sql).bind(...values).run();
    return await this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM projects WHERE id=?1").bind(id).run();
  }
}
