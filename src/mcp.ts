export interface MCPRequest {
  method: string;
  params?: Record<string, unknown>;
}

export async function handleMCP(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as MCPRequest;
    switch (payload.method) {
      case "ping":
        return json({ result: "pong" });
      case "listTools":
        return json({ tools: ["ping"] });
      default:
        return json({ error: `Unknown method: ${payload.method}` }, 400);
    }
  } catch {
    return json({ error: "Invalid MCP request" }, 400);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
