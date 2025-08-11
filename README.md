# AI Collaboration Worker

This project provides a Cloudflare Worker that acts as a lightweight **Model Context Protocol (MCP)** tool for AI agents. It now includes a project management API backed by Cloudflare D1 and a `ProjectCoordinator` Durable Object for per-project state. Monitoring routes (`/health` and `/metrics`), a workflow demo, and an `/mcp` endpoint for simple MCP messages like `ping` remain available.

## Deployment

1. Install dependencies
   ```bash
   npm install
   ```
2. Login to Cloudflare
   ```bash
   npx wrangler login
   ```
3. Create the D1 database (only once)
   ```bash
   npx wrangler d1 create ai-collaboration-db
   npx wrangler d1 execute ai-collaboration-db --file=./schemas/database.sql
   ```
4. Deploy the worker
   ```bash
   npm run deploy
   ```
   The `wrangler.toml` file configures Durable Objects and other bindings required by the worker. Adjust it as needed for your account.

## Development

Run the worker locally using Wrangler:
```bash
npm run dev
```

Lint the source code with ESLint:
```bash
npm run lint
```

## Testing

Unit tests are executed with [Vitest](https://vitest.dev/):
```bash
npm test
```
Tests cover basic MCP interactions and project CRUD endpoints.

## License

MIT
