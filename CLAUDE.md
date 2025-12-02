# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Guard is a meta-MCP server that provides secure, isolated execution of Model Context Protocol (MCP) servers using Cloudflare Workers isolates and code mode execution. It acts as a wrapper around other MCP servers, enabling AI agents to execute TypeScript code that calls MCP tools, resulting in massive efficiency gains (50-90% token reduction) compared to traditional tool calling.

**Key Architecture Concepts:**
- **Code Mode Execution**: AI agents write TypeScript code that calls MCP tools, rather than making individual tool calls. This reduces context window usage dramatically.
- **Worker Isolates**: User code executes in disposable Cloudflare Workers isolates with complete network isolation and no filesystem access.
- **Service Bindings**: Dynamic workers use Service Bindings (via WorkerEntrypoint) to securely access MCP tools without requiring fetch(), enabling true network isolation (globalOutbound: null).
- **Schema Caching**: MCP tool schemas are cached by config hash to speed up repeated loads.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Development mode (MCP server via stdio)
npm run dev

# Interactive CLI for testing
npm run cli

# Linting and formatting
npm run lint          # Check code quality
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format code with Biome
npm run check         # Run all checks
npm run check:fix     # Run all checks and auto-fix

# Testing
npm test              # Run all tests with Vitest
npm run test:unit     # Run unit tests only
npm run test:integration  # Run integration tests
npm run test:security # Run security tests

# MCP testing
npm run test:mcp [mcp-name]  # Test MCP server directly (bypasses Worker execution)

# Worker development
npm run worker:dev    # Start Wrangler dev server

# Benchmarking
npm run benchmark     # Run GitHub MCP comparison benchmark
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Set `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub MCP testing
3. Set `LOG_LEVEL=info` (or `debug` for verbose output)

**Important**: The GitHub MCP server requires `GITHUB_PERSONAL_ACCESS_TOKEN` as the environment variable name. See [GitHub MCP Server docs](https://github.com/github/github-mcp-server).

## Architecture Overview

### Core Components

1. **Server Layer** (`src/server/`)
   - `mcp-handler.ts`: Main MCP server implementation, handles MCP protocol requests
   - `worker-manager.ts`: Manages Worker isolates, spawns MCP processes, handles execution
   - `schema-converter.ts`: Converts MCP tool schemas to TypeScript API definitions
   - `metrics-collector.ts`: Tracks performance metrics and token savings

2. **Worker Runtime** (`src/worker/`)
   - `runtime.ts`: Parent Worker that uses Worker Loader API to spawn dynamic child Workers
   - Child Workers are generated dynamically with embedded user code and MCP bindings

3. **VSCode Extension** (`vscode-extension/`)
   - `src/extension/`: Extension backend (Node.js)
     - `index.ts`: Extension entry point and activation
     - `webview-provider.ts`: Manages webview panel, message passing, config I/O
     - `config-exporter.ts`: Exports configs to/from IDE config files
   - `src/webview/`: Extension frontend (React)
     - `App.tsx`: Main UI component, manages expansion state
     - `components.tsx`: Reusable UI components (MCPCard, CollapsibleSection, etc.)
     - `hooks.ts`: React hooks for state management and message passing
     - `types.ts`: TypeScript type definitions shared between frontend/backend

4. **CLI** (`src/cli/`)
   - `index.ts`: Interactive CLI for testing MCP loading, code execution, and configuration

5. **Types** (`src/types/`)
   - `mcp.ts`: MCP-related types (MCPTool, MCPConfig, MCPInstance, etc.)
   - `worker.ts`: Worker-related types (WorkerCode, execution requests)

6. **Utilities** (`src/utils/`)
   - `config-manager.ts`: Manages MCP configs, imports from IDE config files
   - `validation.ts`: Input validation and security checks for TypeScript code
   - `logger.ts`: Pino-based structured logging
   - `errors.ts`: Custom error types
   - `env-selector.ts`: Interactive environment variable selection
   - `wrangler-formatter.ts`: Formats Wrangler errors for CLI display

### Data Flow: Code Execution

1. **User Request**: User calls `call_mcp` tool with `mcp_id` and TypeScript code
2. **Validation**: `MCPHandler` validates code for security (no `eval`, `require`, `process`, etc.)
3. **Worker Code Generation**: `WorkerManager.executeCode()` calls `generateWorkerCode()` which creates:
   - User code embedded directly in Worker script
   - MCP binding stubs (functions that call `env.MCP.callTool(toolName, input)`)
   - Console output capture and metrics tracking
   - `env` configuration with `MCP_ID` and `MCP_RPC_URL` (used by parent Worker)
4. **Wrangler Startup**: Wrangler dev server starts (parent Worker with Worker Loader API binding)
5. **Service Binding Creation**: Parent Worker (`runtime.ts`) creates MCPBridge Service Binding:
   - Calls `ctx.exports.MCPBridge({ props: { mcpId, rpcUrl } })`
   - Injects MCPBridge as `env.MCP` into dynamic Worker configuration
6. **Dynamic Worker Spawn**: Parent Worker spawns dynamic child Worker via Worker Loader API
   - Dynamic Worker receives `env.MCP` (MCPBridge Service Binding instance)
   - Dynamic Worker has `globalOutbound: null` (true network isolation)
7. **Code Execution**: Child Worker executes user code
   - User code calls MCP tools via generated stubs: `await mcp.toolName(input)`
   - Stubs internally call `env.MCP.callTool(toolName, input)` (Service Binding method call)
8. **Service Binding Bridge**: MCPBridge Service Binding receives the call
   - Runs in parent Worker context (has network access)
   - Uses `fetch()` to POST to Node.js RPC server: `POST http://localhost:{port}/mcp-rpc`
   - Request body: `{ mcpId, toolName, input }`
9. **RPC Server Execution**: Node.js RPC server (`WorkerManager.startRPCServer()`)
   - Retrieves MCP SDK Client from `mcpClients` Map using `mcpId`
   - Calls `client.callTool({ name: toolName, arguments: input })`
10. **MCP Execution**: MCP SDK Client communicates with MCP process via stdio
11. **Results Flow Back**:
    - MCP process → MCP SDK Client → RPC server response → MCPBridge fetch response
    - MCPBridge returns result → Service Binding return value → Dynamic Worker receives result
    - Dynamic Worker completes execution → Parent Worker receives response → Node.js receives result
12. **Metrics & Response**: Metrics recorded (MCP calls made, tokens saved) and results returned to user

### Data Flow: MCP Loading

1. User calls `connect` with `mcp_name` and `mcp_config`
2. Check schema cache (keyed by `mcp_name` + config hash)
3. If cached: spawn MCP process quickly, use cached schema
4. If not cached:
   - Create `StdioClientTransport` with MCP config
   - Connect MCP SDK `Client` to MCP server
   - Call `client.listTools()` to fetch schema
   - Convert schema to TypeScript API with `SchemaConverter`
   - Cache schema and TypeScript API
5. Store MCP Client for later Service Binding calls
6. Generate usage examples and return instance info
7. Optionally auto-save config to IDE config file

## Key Implementation Details

### VSCode Extension Architecture

The VSCode extension uses modern React patterns for optimal UX:

**State Management**:
- **Optimistic Updates**: Frontend updates UI immediately before backend responds
  - `hooks.ts:saveMCPConfig()` updates local state instantly
  - Backend only sends full update if `isGuarded` changed (computed from IDE config)
  - Eliminates flashing/re-rendering of components
- **Controlled Components**: MCPCard expansion state managed by parent (App.tsx)
- **Message Passing**: Extension backend ↔ Webview via `postMessage`/`window.addEventListener`

**Component Hierarchy**:
```
App.tsx (expansion state: Set<string>)
  └─ MCPCard (controlled isExpanded prop)
      ├─ Header (click handler checks target.closest('[data-config-section]'))
      └─ Config Sections (when expanded)
          ├─ CollapsibleSection (data-config-section="true")
          │   ├─ NetworkConfigSection (local state + optimistic update)
          │   └─ FileSystemConfigSection (local state + optimistic update)
          └─ Save buttons wrapped in divs with stopPropagation
```

**Event Propagation**:
- CollapsibleSections marked with `data-config-section="true"`
- MCPCard header checks `target.closest('[data-config-section]')` to ignore clicks in config areas
- Save buttons wrapped in divs with `onClick={(e) => e.stopPropagation()}`
- Prevents clicks from bubbling to parent card header

**Performance**:
- Optimistic updates eliminate ~200-500ms perceived latency
- No full server list refresh on config save (was causing flashing)
- React keys stable (`server.name`) to prevent component re-mounting

### Security Model

Three layers of security:
1. **Code Validation** (`src/utils/validation.ts`): Pre-execution checks reject dangerous patterns
2. **Network Isolation**: Dynamic workers configured with `globalOutbound: null` - true network isolation enabled
3. **V8 Isolate Sandboxing**: Each execution runs in disposable isolate

**Blocked patterns**: `require()`, `eval()`, `process.`, `import()`, `__dirname`, filesystem operations

### Service Bindings Architecture

The architecture uses Service Bindings to enable dynamic workers to call MCP tools without network access:

**Components**:
- **MCPBridge Service Binding** (`src/worker/runtime.ts`): WorkerEntrypoint class that provides the `callTool(toolName, input)` method
  - Instantiated by parent Worker via `ctx.exports.MCPBridge({ props: { mcpId, rpcUrl } })`
  - Receives method calls from dynamic workers (native RPC - no serialization needed)
  - Internally uses `fetch()` to call the Node.js RPC server (parent Worker has network access)
- **RPC Server** (`WorkerManager.startRPCServer()`): HTTP server on localhost (random port)
  - Endpoint: `POST /mcp-rpc` with `{ mcpId, toolName, input }`
  - Receives fetch requests from MCPBridge in parent Worker
  - Uses `Map<mcpId, Client>` to route requests to the correct MCP SDK Client
  - Calls `client.callTool()` to execute MCP tools via stdio
- **Worker Binding Stubs** (generated in `WorkerManager.generateWorkerCode()`):
  - Functions that call `env.MCP.callTool(toolName, input)`
  - `env.MCP` is the MCPBridge Service Binding injected by parent Worker
  - Example: `env.MCP.callTool('search_repositories', { query: 'cloudflare' })`

**Complete Flow**:
1. Dynamic Worker → calls `env.MCP.callTool()` (Service Binding method call - no fetch needed)
2. MCPBridge Service Binding (in parent Worker) → receives the call via WorkerEntrypoint
3. MCPBridge → uses `fetch()` to POST to Node.js RPC server (parent Worker can use fetch)
4. RPC Server → routes to MCP SDK Client → calls MCP process via stdio
5. Results flow back through: MCP process → RPC response → MCPBridge → Service Binding return value → Dynamic Worker

**Key Benefits**:
- Dynamic workers use Service Bindings (native method calls) - no `fetch()` needed
- True network isolation (`globalOutbound: null`) enabled for dynamic workers
- Only parent Worker and MCPBridge use `fetch()` to call Node.js RPC server
- Follows Cloudflare's recommended Service Bindings pattern for Worker-to-Worker communication

### Schema Caching

- **Cache Key**: `${mcpName}:${hash(mcpName + config)}`
- **Cached Data**: `{ tools, typescriptApi, configHash, cachedAt }`
- **Benefits**: Skip MCP process initialization wait, instant loads for repeated configs

### Config Management

Imports MCP configs from IDE config files in priority order:
1. Claude Code: `~/.config/claude/claude_desktop_config.json`
2. GitHub Copilot: `~/.github-copilot/apps.json`
3. Cursor: `~/.cursor/User/globalStorage/mcp.json`

Saves configs with `${VAR_NAME}` placeholders for environment variables.

### Wrangler Integration

- **Parent Worker**: `src/worker/runtime.ts` (uses Worker Loader API)
- **Config**: `wrangler.toml` with `[[worker_loaders]]` binding
- **Dev Server**: Started on random port (20000-29999) via `npx wrangler dev`
- **Health Check**: Polls dev server with test Worker until ready
- **Dynamic Workers**: Generated per execution with embedded user code

## Testing Patterns

### Unit Tests (`tests/unit/`)
Test individual components in isolation (schema converter, validators, etc.)

### Integration Tests (`tests/integration/`)
Test full MCP loading and execution workflows

### Security Tests (`tests/security/`)
Test code validation and security boundary enforcement

### Direct MCP Testing
Use `npm run test:mcp [mcp-name]` to test MCP servers directly without Worker execution. Useful for verifying MCP config and authentication.

## Common Development Tasks

### Adding a New MCP Tool Handler

1. Define tool schema in `mcp-handler.ts` `ListToolsRequestSchema` handler
2. Add case to `CallToolRequestSchema` handler switch statement
3. Implement handler method (e.g., `handleNewTool()`)
4. Add Zod schema to `src/types/mcp.ts` if needed
5. Update tests

### Modifying Code Validation Rules

Edit `src/utils/validation.ts` → `validateTypeScriptCode()`. Add new dangerous patterns to the regex checks or string searches.

### Changing Worker Code Generation

Edit `WorkerManager.generateWorkerCode()` in `src/server/worker-manager.ts`.

**Important Notes**:
- The generated code must be valid JavaScript (no TypeScript-only syntax)
- Worker binding stubs call `env.MCP.callTool(toolName, input)` where `env.MCP` is the MCPBridge Service Binding
- The Service Binding is injected by the parent Worker (not generated in worker code)
- `workerCode.env` contains `MCP_ID` and `MCP_RPC_URL` which parent Worker uses to create MCPBridge
- See `src/worker/runtime.ts` for how parent Worker creates and injects the Service Binding

### Adding New Error Types

1. Add to `src/utils/errors.ts`
2. Update `MCPHandler.getSuggestedAction()` with helpful error message
3. Update `getExecutionErrorSuggestion()` for execution errors

## Important Constraints

### Windows Compatibility

- Use `npx.cmd` instead of `npx` on Windows (`process.platform === 'win32'`)
- Set `shell: true` for spawn on Windows for `.cmd` files
- Handle process termination carefully (processes may not exit cleanly)

### TypeScript in Generated Workers

- Do NOT include TypeScript-only syntax in generated Worker code (causes strict mode errors)
- Type definitions are for IDE/type checking only, not runtime
- User code is embedded as-is (assumes valid JavaScript/TypeScript)

### Network Access in Workers

- **Dynamic Workers**:
  - Have `globalOutbound: null` configured - true network isolation
  - Cannot use `fetch()` or make any network requests
  - Access MCP tools via Service Binding (`env.MCP.callTool()`) - native method calls only
  - No HTTP requests, no serialization overhead for Service Binding calls
- **Parent Worker** (`src/worker/runtime.ts`):
  - Has network access enabled (can use `fetch()`)
  - Hosts the MCPBridge Service Binding (WorkerEntrypoint)
  - MCPBridge internally uses `fetch()` to call Node.js RPC server
- **MCPBridge Service Binding**:
  - Runs in parent Worker context (has network access)
  - Provides secure bridge between dynamic workers and Node.js RPC server
  - Dynamic workers call `env.MCP.callTool()` → MCPBridge receives method call → uses `fetch()` internally
- **Node.js RPC Server**:
  - HTTP server on localhost (random port 20000-29999)
  - Only accessible from parent Worker (localhost-only binding)
  - Bridges Cloudflare Workers to MCP SDK Clients
- **True Isolation**: Dynamic workers are fully isolated from the network - can only access MCP via Service Binding, no direct network access possible

### MCP Client Lifecycle

- One `Client` instance per loaded MCP, stored in `mcpClients` Map
- Client must be properly closed on unload (transport cleanup)
- Client spawns and manages MCP process via `StdioClientTransport`

## Current Limitations

As noted in README:

1. **Worker Execution**: Real Wrangler execution is implemented but may fall back to simulation if Wrangler unavailable
2. **MCP Schema Fetching**: Real MCP protocol communication is implemented via MCP SDK

These are no longer "mocked" - the implementation is complete but gracefully degrades if dependencies are missing.

## IDE Configuration

MCP Guard can be used as an MCP server itself. Add to your IDE's MCP config:

```json
{
  "mcpServers": {
    "mcpguard": {
      "command": "node",
      "args": ["D:/mcpguard/dist/server/index.js"]
    }
  }
}
```

## Debugging Tips

- Use `--verbose` or `-v` flag with CLI for debug logs
- Set `LOG_LEVEL=debug` in `.env` for detailed logging
- Check Wrangler output in CLI (captured and formatted)
- Use `npm run test:mcp` to isolate MCP connection issues
- Check RPC server logs for tool call failures
- Use `list_available_mcps` to verify MCP loaded correctly

## Code Style

- TypeScript strict mode enabled
- Biome for linting and formatting (not ESLint/Prettier)
- Structured logging with Pino (no `console.log` in non-CLI code)
- Zod for runtime validation
- Async/await preferred over callbacks
- Error handling: throw custom error types, catch and format at boundaries
