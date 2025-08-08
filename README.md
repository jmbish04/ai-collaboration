# AI Collaboration Worker

This project provides a Cloudflare Worker that acts as a lightweight MCP tool for AI agents. It exposes basic monitoring routes (`/health` and `/metrics`) and a workflow demo using Cloudflare Workflows and Durable Objects.

## Deployment

1. Install dependencies
   ```bash
   npm install
   ```
2. Login to Cloudflare
   ```bash
   npx wrangler login
   ```
3. Deploy the worker
   ```bash
   npm run deploy
   ```

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

Unit tests are executed with [Vitest](https://vitest.dev/).
```bash
npm test
```

The tests include simple checks for the `/health` and `/metrics` endpoints.

## License

MIT
