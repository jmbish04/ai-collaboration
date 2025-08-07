# AI Collaboration Worker - Development Prompt

## Project Overview
Create a comprehensive Cloudflare Worker that serves as a centralized API hub for AI agents to manage memory, status tracking, and various cloud services. This worker should be production-ready with proper error handling, logging, and monitoring capabilities.

## Core Requirements

### 1. Data Layer - Full CRUD Operations
- **KV Binding**: Complete key-value storage operations (GET, PUT, DELETE, LIST)
- **D1 Binding**: Full relational database CRUD with proper SQL query handling
- **R2 Bucket Binding**: Object storage operations (upload, download, delete, list)

### 2. Advanced Service Integration
- **Durable Objects**: Implement stateful operations for session management
- **Workflows & Queues**: Create and manage asynchronous task processing
- **Email Routing**: Receive emails via Cloudflare Email Routing and provide response capabilities
- **Workers AI**: Integrate text generation and processing capabilities
- **Workers Embeddings**: Text-to-vector conversion services
- **Vectorize**: Document storage and semantic search functionality with full CRUD operations

### 3. SPA Management System
- **Dynamic SPA Creation**: Generate Single Page Applications using Tailwind CSS
- **R2 Storage**: Save SPA assets to R2 buckets
- **Worker Proxy**: Serve SPAs through worker frontend with URL parameter-based key routing
- **Asset Management**: Handle static file serving and caching

### 4. Monitoring & Observability
- **Live Workflow Integration**: Utilize existing live-workflow template for real-time monitoring
- **Status Tracking**: Comprehensive logging of all operations
- **Error Handling**: Robust error management with proper HTTP status codes
- **Performance Metrics**: Track response times and resource usage

## Technical Specifications

### Architecture Requirements
- **RESTful API Design**: Clear endpoint structure following REST principles
- **Authentication**: Implement API key or token-based authentication
- **Rate Limiting**: Prevent abuse with configurable rate limits
- **CORS Support**: Enable cross-origin requests for AI agent access
- **Content Validation**: Input sanitization and validation

### API Endpoints Structure
```
/api/v1/kv/          # KV operations
/api/v1/d1/          # Database operations
/api/v1/r2/          # Object storage
/api/v1/do/          # Durable Objects
/api/v1/workflows/   # Workflow management
/api/v1/queues/      # Queue management
/api/v1/email/       # Email operations
/api/v1/ai/          # AI services
/api/v1/vectorize/   # Vector operations
/api/v1/spa/         # SPA management
/health              # Health check endpoint
/metrics             # Performance metrics
```

### Error Handling Standards
- Consistent error response format
- Proper HTTP status codes
- Detailed error messages for debugging
- Request ID tracking for traceability

### Security Considerations
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- Secure header configuration
- Environment variable management

## Deliverables
1. Complete Cloudflare Worker codebase
2. Wrangler configuration file
3. Database schema (D1)
4. API documentation
5. Deployment scripts
6. Testing suite
7. Monitoring dashboard integration
