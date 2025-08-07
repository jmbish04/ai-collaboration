# AI Collaboration Worker - Development Setup

## Prerequisites

- Node.js 20+ 
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with Workers enabled

## Initial Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/jmbish04/ai-collaboration.git
   cd ai-collaboration
   npm install
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Create required resources:**
   ```bash
   # Create KV namespaces
   wrangler kv:namespace create "AI_MEMORY"
   wrangler kv:namespace create "AI_STATUS"
   
   # Create R2 buckets
   wrangler r2 bucket create ai-collaboration-storage
   wrangler r2 bucket create spa-assets
   
   # Create D1 database
   wrangler d1 create ai-collaboration-db
   
   # Create Vectorize index
   wrangler vectorize create ai-documents --dimensions=1536 --metric=cosine
   
   # Create Queues
   wrangler queues create email-processing
   wrangler queues create task-processing
   ```

4. **Update wrangler.toml with your resource IDs**

5. **Set up secrets:**
   ```bash
   wrangler secret put OPENAI_API_KEY
   wrangler secret put WEBHOOK_SECRET
   wrangler secret put JWT_SECRET
   wrangler secret put SLACK_WEBHOOK_URL
   ```

6. **Run database migrations:**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

## Development Workflow

### Local Development
```bash
# Start development server
npm run dev

# Run with specific environment
wrangler dev --env staging
```

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run integration tests
npm run test:integration
```

### Code Quality
```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Check TypeScript types
npm run type-check

# Format code
npm run format
```

### Database Management
```bash
# Apply migrations
npm run db:migrate

# Seed database
npm run db:seed

# Execute custom SQL
wrangler d1 execute ai-collaboration-db --file=./custom-query.sql
```

### Deployment
```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production

# View logs
npm run logs
```

## Environment Variables

### Required Secrets
- `OPENAI_API_KEY` - OpenAI API key for AI services
- `WEBHOOK_SECRET` - Secret for webhook validation
- `JWT_SECRET` - Secret for JWT token signing
- `SLACK_WEBHOOK_URL` - Slack webhook for notifications

### Configuration Variables
- `ENVIRONMENT` - Current environment (development/staging/production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)
- `API_VERSION` - API version prefix
- `MAX_REQUEST_SIZE` - Maximum request body size
- `RATE_LIMIT_REQUESTS` - Number of requests per window
- `RATE_LIMIT_WINDOW` - Rate limit window in seconds

## Project Structure
```
src/
├── handlers/          # Route handlers
├── services/          # Business logic
├── models/           # Data models
├── middleware/       # Custom middleware
├── utils/           # Utility functions
├── types/           # TypeScript types
├── durable-objects/ # Durable Object classes
└── index.ts         # Main entry point

migrations/          # D1 database migrations
tests/              # Test files
docs/               # Documentation
.github/            # GitHub workflows and templates
```

## API Documentation

The API follows RESTful conventions with the following base structure:
- `/api/v1/kv/` - Key-Value operations
- `/api/v1/d1/` - Database operations  
- `/api/v1/r2/` - Object storage
- `/api/v1/do/` - Durable Objects
- `/api/v1/workflows/` - Workflow management
- `/api/v1/queues/` - Queue management
- `/api/v1/email/` - Email operations
- `/api/v1/ai/` - AI services
- `/api/v1/vectorize/` - Vector operations
- `/api/v1/spa/` - SPA management

## Monitoring

### Health Checks
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status

### Metrics
- `GET /metrics` - Prometheus-style metrics
- Performance data available in Cloudflare Analytics

### Logging
All operations are logged with structured JSON format including:
- Request ID for traceability
- Performance metrics
- Error details
- User context (when available)

## Troubleshooting

### Common Issues

1. **KV/D1/R2 binding errors**: Verify resource IDs in wrangler.toml
2. **Authentication failures**: Check API tokens and secrets
3. **CORS errors**: Verify CORS configuration in middleware
4. **Rate limiting**: Check current limits and usage

### Debug Commands
```bash
# View worker logs in real-time
wrangler tail

# Check resource bindings
wrangler dev --inspect

# Test specific endpoints
curl -X GET https://your-worker.your-domain.workers.dev/health
```