import { DurableObject } from "cloudflare:workers";

export interface Agent {
  id: string;
  name: string;
  role:
    | "frontend"
    | "backend"
    | "fullstack"
    | "devops"
    | "designer"
    | "tester";
  model: "chatgpt" | "claude" | "gemini" | "cursor" | "copilot" | "custom";
  status: "active" | "idle" | "working" | "blocked" | "offline";
  currentTask?: string;
  websocket?: WebSocket;
  lastSeen: number;
  capabilities: string[];
  preferences: Record<string, any>;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedTo?: string;
  status: "todo" | "in-progress" | "review" | "blocked" | "completed";
  priority: "low" | "medium" | "high" | "urgent";
  dependencies: string[];
  estimatedHours?: number;
  actualHours?: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface Message {
  id: string;
  agentId: string;
  type: "chat" | "status" | "code" | "file" | "system";
  content: string;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface ProjectSettings {
  maxAgents: number;
  allowCrossAgentChat: boolean;
  autoSaveInterval: number;
  notificationSettings: {
    onTaskComplete: boolean;
    onAgentJoin: boolean;
    onBlocker: boolean;
  };
  aiAssistance: {
    enabled: boolean;
    autoSuggestions: boolean;
    codeReview: boolean;
  };
}

export interface ProjectState {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "paused" | "completed" | "archived";
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  files: string[];
  context: Record<string, any>;
  messageHistory: Message[];
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
}

interface Env {}

/**
 * Durable Object that maintains collaborative project state including agents,
 * tasks and message history. All `/api/projects/{id}/*` routes are forwarded
 * here with the sub-path representing the resource.
 */
export class ProjectCoordinator extends DurableObject {
  private objectState: DurableObjectState;
  private state: ProjectState;
  private websockets: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.objectState = state;
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<any>("state");
      if (stored) {
        this.state = {
          ...stored,
          agents: new Map(stored.agents || []),
          tasks: new Map(stored.tasks || []),
        } as ProjectState;
      } else {
        this.state = {
          id: "",
          name: "",
          description: "",
          status: "planning",
          agents: new Map(),
          tasks: new Map(),
          files: [],
          context: {},
          messageHistory: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          settings: {
            maxAgents: 10,
            allowCrossAgentChat: true,
            autoSaveInterval: 30000,
            notificationSettings: {
              onTaskComplete: true,
              onAgentJoin: true,
              onBlocker: true,
            },
            aiAssistance: {
              enabled: true,
              autoSuggestions: true,
              codeReview: true,
            },
          },
        };
      }
    });
  }

  /**
   * Routes HTTP requests and WebSocket upgrades for project coordination.
   *
   * Supported REST endpoints relative to `/api/projects/{id}`:
   * - `GET /state` – full serialized project state.
   * - `GET /agents` – list agents.
   * - `GET /tasks?status=&tags=` – list tasks filtered by status or tags.
   * - `GET /messages?type=&limit=` – list messages with optional type filter
   * and limit.
   * - `GET /analytics` – project analytics summary.
   * - `POST /initialize` – initialize project state.
   * - `POST /agents` – register an agent.
   * - `POST /tasks` – create a task.
   * - `POST /messages` – append a message.
   * - `PUT /agents/:id` – update agent fields.
   * - `PUT /tasks/:id` – update a task.
   * - `PUT /context` – merge into project context.
   * - `DELETE /agents/:id` – remove an agent.
   * - `DELETE /tasks/:id` – delete a task.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    switch (request.method) {
      case "GET":
        return this.handleGet(url.pathname, url.searchParams);
      case "POST":
        return this.handlePost(url.pathname, request);
      case "PUT":
        return this.handlePut(url.pathname, request);
      case "DELETE":
        return this.handleDelete(url.pathname);
      default:
        return new Response("Method not allowed", { status: 405 });
    }
  }

  /**
   * Upgrades the request to a WebSocket connection for real-time updates.
   * Clients receive broadcast messages for project events and may send JSON
   * commands such as `agent.register` or `task.update`.
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.websockets.add(server);
    server.accept();

    server.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(event.data as string);
        await this.handleWebSocketMessage(message, server);
      } catch (e: any) {
        server.send(
          JSON.stringify({ type: "error", message: "Invalid message format: " + e.message })
        );
      }
    });

    server.addEventListener("close", () => {
      this.websockets.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Processes incoming WebSocket messages. Supported `type` values:
   * `agent.register`, `agent.update`, `task.create`, `task.update`,
   * `message.send`, and `context.update`.
   */
  private async handleWebSocketMessage(message: any, ws: WebSocket) {
    try {
      switch (message.type) {
        case "agent.register":
          // Check for required data
          if (!message.agent) throw new Error("Agent data is missing");
          await this.registerAgent(message.agent, ws);
          break;
        case "agent.update":
          // Add error handling for not found agent
          if (!message.agentId || !message.updates)
            throw new Error("Agent ID or updates are missing");
          try {
            await this.updateAgent(message.agentId, message.updates);
          } catch (e: any) {
            if (e.message.includes("not found")) {
              ws.send(JSON.stringify({ type: "error", message: "Agent not found" }));
              return;
            }
            throw e;
          }
          break;
        case "task.create":
          // Check for required data
          if (!message.task) throw new Error("Task data is missing");
          await this.createTask(message.task);
          break;
        case "task.update":
          // Add error handling for not found task
          if (!message.taskId || !message.updates)
            throw new Error("Task ID or updates are missing");
          try {
            await this.updateTask(message.taskId, message.updates);
          } catch (e: any) {
            if (e.message.includes("not found")) {
              ws.send(JSON.stringify({ type: "error", message: "Task not found" }));
              return;
            }
            throw e;
          }
          break;
        case "message.send":
          if (!message.message) throw new Error("Message data is missing");
          await this.sendMessage(message.message);
          break;
        case "context.update":
          if (!message.context) throw new Error("Context data is missing");
          await this.updateContext(message.context);
          break;
        default:
          ws.send(
            JSON.stringify({ type: "error", message: "Unknown message type" })
          );
      }
    } catch (e: any) {
      if (e.message.includes('not found') || e.message.includes('missing')) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: "An internal server error occurred." }));
        console.error(e);
      }
    }
  }

  /**
   * Responds to HTTP `GET` requests for project resources.
   *
   * - `/state` – returns `ProjectState`.
   * - `/agents` – returns array of `Agent`.
   * - `/tasks` – returns tasks filtered by optional `status` and comma-separated
   * `tags` query parameters.
   * - `/messages` – returns messages filtered by optional `type` and limited by
   * `limit` query parameter (most recent first).
   * - `/analytics` – derived statistics about agents and tasks.
   */
  private async handleGet(
    path: string,
    search: URLSearchParams,
  ): Promise<Response> {
    if (path === "/state") {
      return this.jsonResponse(this.serializeState());
    }
    if (path === "/agents") {
      return this.jsonResponse(Array.from(this.state.agents.values()));
    }
    if (path === "/tasks") {
      let tasks = Array.from(this.state.tasks.values());
      const status = search.get("status");
      if (status) {
        tasks = tasks.filter((t) => t.status === status);
      }
      const tags = search.get("tags");
      if (tags) {
        const tagSet = new Set(tags.split(","));
        tasks = tasks.filter((t) =>
          t.tags.some((tag) => tagSet.has(tag)),
        );
      }
      return this.jsonResponse(tasks);
    }
    if (path === "/messages") {
      let messages = this.state.messageHistory;
      const type = search.get("type");
      if (type) {
        messages = messages.filter((m) => m.type === type);
      }
      const limit = parseInt(search.get("limit") || "", 10);
      if (!Number.isNaN(limit)) {
        messages = messages.slice(-limit);
      }
      return this.jsonResponse(messages);
    }
    if (path === "/analytics") {
      return this.jsonResponse(await this.generateAnalytics());
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * Handles creation endpoints via HTTP `POST`.
   *
   * - `/initialize` – body: `Partial<ProjectState>` to seed a new project.
   * - `/agents` – body: `Partial<Agent>` to register an agent.
   * - `/tasks` – body: `Partial<Task>` to create a task.
   * - `/messages` – body: `Partial<Message>` to append a message.
   */
  private async handlePost(path: string, request: Request): Promise<Response> {
    const data = await request.json();
    if (path === "/initialize") {
      await this.initializeProject(data);
      return this.jsonResponse({ success: true });
    }
    if (path === "/agents") {
      const agent = await this.registerAgent(data);
      return this.jsonResponse(agent);
    }
    if (path === "/tasks") {
      const task = await this.createTask(data);
      return this.jsonResponse(task);
    }
    if (path === "/messages") {
      await this.sendMessage(data);
      return this.jsonResponse({ success: true });
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * Handles update endpoints via HTTP `PUT`.
   *
   * - `/agents/:id` – body: `Partial<Agent>` fields to update.
   * - `/tasks/:id` – body: `Partial<Task>` fields to update.
   * - `/context` – body: object merged into `state.context`.
   */
  private async handlePut(path: string, request: Request): Promise<Response> {
    const data = await request.json();
    const parts = path.split("/");
    if (parts[1] === "agents" && parts[2]) {
      try {
        await this.updateAgent(parts[2], data);
        return this.jsonResponse({ success: true });
      } catch (e) {
        if (e instanceof Error && e.message.includes('not found')) {
          return new Response('Not found', { status: 404 });
        }
        throw e;
      }
    }
    if (parts[1] === "tasks" && parts[2]) {
      try {
        await this.updateTask(parts[2], data);
        return this.jsonResponse({ success: true });
      } catch (e) {
        if (e instanceof Error && e.message.includes('not found')) {
          return new Response('Not found', { status: 404 });
        }
        throw e;
      }
    }
    if (path === "/context") {
      await this.updateContext(data);
      return this.jsonResponse({ success: true });
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * Handles deletion endpoints via HTTP `DELETE`.
   *
   * - `/agents/:id` – remove agent.
   * - `/tasks/:id` – remove task.
   */
  private async handleDelete(path: string): Promise<Response> {
    const parts = path.split("/");
    if (parts[1] === "agents" && parts[2]) {
      await this.removeAgent(parts[2]);
      return this.jsonResponse({ success: true });
    }
    if (parts[1] === "tasks" && parts[2]) {
      await this.deleteTask(parts[2]);
      return this.jsonResponse({ success: true });
    }
    return new Response("Not found", { status: 404 });
  }

  /**
   * Initializes project state from a partial payload. Invoked through
   * `POST /initialize`.
   */
  private async initializeProject(data: Partial<ProjectState>) {
    this.state = {
      ...this.state,
      ...data,
      id: data.id || crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.persistState();
    await this.broadcastToAll({
      type: "project.initialized",
      project: this.serializeState(),
    });
  }

  /**
   * Registers an agent via `POST /agents` or WebSocket `agent.register`.
   * Accepts partial `Agent` data and optionally the initiating socket which
   * is stored for future broadcasts.
   */
  private async registerAgent(
    agentData: Partial<Agent>,
    websocket?: WebSocket
  ): Promise<Agent> {
    const agent: Agent = {
      id: agentData.id || crypto.randomUUID(),
      name: agentData.name || "Unknown Agent",
      role: agentData.role || "fullstack",
      model: agentData.model || "custom",
      status: "active",
      lastSeen: Date.now(),
      capabilities: agentData.capabilities || [],
      preferences: agentData.preferences || {},
      currentTask: agentData.currentTask,
      websocket,
    };
    this.state.agents.set(agent.id, agent);
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({
      type: "agent.joined",
      agent: this.serializeAgent(agent),
    });
    if (websocket) {
      websocket.send(
        JSON.stringify({
          type: "welcome",
          projectState: this.serializeState(),
          agentId: agent.id,
        })
      );
    }
    return agent;
  }

  /**
   * Updates an existing agent's fields. Invoked through
   * `PUT /agents/:id` or WebSocket `agent.update`.
   */
  private async updateAgent(agentId: string, updates: Partial<Agent>) {
    const agent = this.state.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    Object.assign(agent, updates, { lastSeen: Date.now() });
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({
      type: "agent.updated",
      agentId,
      agent: this.serializeAgent(agent),
    });
  }

  /**
   * Removes an agent from the project. Triggered via
   * `DELETE /agents/:id`.
   */
  private async removeAgent(agentId: string) {
    const agent = this.state.agents.get(agentId);
    if (!agent) return;
    this.state.agents.delete(agentId);
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({ type: "agent.left", agentId });
  }

  /**
   * Creates a new task using fields supplied via `POST /tasks` or WebSocket
   * `task.create`.
   */
  private async createTask(taskData: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: taskData.id || crypto.randomUUID(),
      title: taskData.title || "Untitled Task",
      description: taskData.description || "",
      status: taskData.status || "todo",
      priority: taskData.priority || "medium",
      dependencies: taskData.dependencies || [],
      tags: taskData.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assignedTo: taskData.assignedTo,
      estimatedHours: taskData.estimatedHours,
      actualHours: taskData.actualHours,
    };
    this.state.tasks.set(task.id, task);
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({ type: "task.created", task });
    return task;
  }

  /**
   * Applies updates to an existing task. Triggered via `PUT /tasks/:id` or
   * WebSocket `task.update`.
   */
  private async updateTask(taskId: string, updates: Partial<Task>) {
    const task = this.state.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    Object.assign(task, updates, { updatedAt: Date.now() });
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({ type: "task.updated", taskId, task });
    if (updates.status === "completed") {
      await this.notifyTaskCompletion(task);
    }
    if (updates.status === "blocked") {
      await this.notifyTaskBlocked(task);
    }
  }

  /**
   * Deletes a task from the project. Invoked via `DELETE /tasks/:id`.
   */
  private async deleteTask(taskId: string) {
    this.state.tasks.delete(taskId);
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({ type: "task.deleted", taskId });
  }

  /**
   * Appends a message to project history. Called via `POST /messages` or
   * WebSocket `message.send`. Only the last 1000 messages are retained.
   */
  private async sendMessage(messageData: Partial<Message>) {
    const message: Message = {
      id: messageData.id || crypto.randomUUID(),
      agentId: messageData.agentId || "system",
      type: messageData.type || "chat",
      content: messageData.content || "",
      metadata: messageData.metadata,
      timestamp: Date.now(),
    };
    this.state.messageHistory.push(message);
    if (this.state.messageHistory.length > 1000) {
      this.state.messageHistory = this.state.messageHistory.slice(-1000);
    }
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({ type: "message.new", message });
  }

  /**
   * Merges the supplied object into shared project context. Invoked via
   * `PUT /context` or WebSocket `context.update`.
   */
  private async updateContext(contextUpdates: Record<string, any>) {
    Object.assign(this.state.context, contextUpdates);
    this.state.updatedAt = Date.now();
    await this.persistState();
    await this.broadcastToAll({
      type: "context.updated",
      context: this.state.context,
    });
  }

  /**
   * Broadcasts a JSON-serializable message to all connected WebSocket
   * clients. Broken sockets are cleaned up automatically.
   */
  private async broadcastToAll(message: any) {
    const str = JSON.stringify(message);
    for (const ws of this.websockets) {
      try {
        ws.send(str);
      } catch {
        this.websockets.delete(ws);
      }
    }
  }

  /**
   * Persists the current `ProjectState` to Durable Object storage.
   */
  private async persistState() {
    const serializable = {
      ...this.state,
      agents: Array.from(this.state.agents.entries()),
      tasks: Array.from(this.state.tasks.entries()),
    } as any;
    await this.objectState.storage.put("state", serializable);
  }

  /**
   * Produces a JSON-serializable representation of the project state.
   * WebSocket references are stripped from agents.
   */
  private serializeState() {
    return {
      ...this.state,
      agents: Array.from(this.state.agents.values()).map((a) =>
        this.serializeAgent(a)
      ),
      tasks: Array.from(this.state.tasks.values()),
    };
  }

  /**
   * Serializes an `Agent` by omitting the WebSocket reference, suitable for
   * storage or API responses.
   */
  private serializeAgent(agent: Agent) {
    const { websocket, ...rest } = agent;
    return rest;
  }

  /**
   * Generates simple aggregate metrics about current agents and tasks.
   * Returned by `GET /analytics`.
   */
  private async generateAnalytics() {
    const agents = Array.from(this.state.agents.values());
    const tasks = Array.from(this.state.tasks.values());
    return {
      agents: {
        total: agents.length,
        active: agents.filter((a) => a.status === "active").length,
        byRole: agents.reduce((acc, a) => {
          acc[a.role] = (acc[a.role] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        byModel: agents.reduce((acc, a) => {
          acc[a.model] = (acc[a.model] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      tasks: {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === "completed").length,
        inProgress: tasks.filter((t) => t.status === "in-progress").length,
        blocked: tasks.filter((t) => t.status === "blocked").length,
        byPriority: tasks.reduce((acc, t) => {
          acc[t.priority] = (acc[t.priority] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      productivity: {
        messagesPerHour: this.calculateMessageRate(),
        averageTaskTime: this.calculateAverageTaskTime(),
        completionRate:
          tasks.length > 0
            ? tasks.filter((t) => t.status === "completed").length / tasks.length
            : 0,
      },
    };
  }

  /**
   * Calculates the number of messages posted in the last hour.
   */
  private calculateMessageRate(): number {
    const hourAgo = Date.now() - 3600000;
    const recent = this.state.messageHistory.filter((m) => m.timestamp > hourAgo);
    return recent.length;
  }

  /**
   * Computes the average `actualHours` for tasks marked as completed.
   */
  private calculateAverageTaskTime(): number {
    const completed = Array.from(this.state.tasks.values()).filter(
      (t) => t.status === "completed" && t.actualHours
    );
    if (completed.length === 0) return 0;
    const total = completed.reduce(
      (sum, t) => sum + (t.actualHours || 0),
      0
    );
    return total / completed.length;
  }

  /**
   * Sends a system message announcing task completion when enabled by
   * notification settings.
   */
  private async notifyTaskCompletion(task: Task) {
    if (!this.state.settings.notificationSettings.onTaskComplete) return;
    await this.sendMessage({
      type: "system",
      content: `🎉 Task "${task.title}" has been completed!`,
      metadata: { taskId: task.id, event: "task_completed" },
    });
  }

  /**
   * Sends a system message alerting that a task is blocked when enabled by
   * notification settings.
   */
  private async notifyTaskBlocked(task: Task) {
    if (!this.state.settings.notificationSettings.onBlocker) return;
    await this.sendMessage({
      type: "system",
      content: `⚠️ Task "${task.title}" is blocked and needs attention.`,
      metadata: { taskId: task.id, event: "task_blocked" },
    });
  }

  /**
   * Helper for returning JSON responses with `Content-Type` header set.
   */
  private jsonResponse(data: any): Response {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
