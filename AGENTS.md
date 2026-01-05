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
npm install              # Install dependencies
npm run build            # Build TypeScript to JavaScript
npm run dev              # Development mode (MCP server via stdio)
npm run cli              # Interactive CLI (add -v for verbose)
npm run lint             # Check code quality
npm run lint:fix         # Auto-fix linting issues
npm run check            # Run all checks (lint + format)
npm test                 # Run all tests with Vitest
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests
npm run test:security    # Run security tests
npm run test:mcp [name]  # Test MCP server directly (bypasses Worker)
npm run worker:dev       # Start Wrangler dev server
npm run benchmark        # Run GitHub MCP comparison benchmark
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Set `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub MCP testing
3. Set `LOG_LEVEL=info` (or `debug` for verbose output)

## Architecture Overview

### Core Components

1. **Server Layer** (`src/server/`): `mcp-handler.ts` (MCP protocol), `worker-manager.ts` (Worker isolates), `schema-converter.ts` (TypeScript API generation), `metrics-collector.ts`
2. **Worker Runtime** (`src/worker/runtime.ts`): Parent Worker using Worker Loader API to spawn dynamic child Workers
3. **VSCode Extension** (`vscode-extension/`): React-based UI for MCP management, token savings visualization, security testing
4. **CLI** (`src/cli/index.ts`): Interactive command-line interface for MCP management
5. **Types** (`src/types/`): `mcp.ts` (MCPTool, MCPConfig), `worker.ts` (WorkerCode)
6. **Utilities** (`src/utils/`): `config-manager.ts`, `validation.ts`, `logger.ts`, `errors.ts`

### Data Flow: Code Execution

1. User calls `call_mcp` with TypeScript code
2. Code validated for security (no `eval`, `require`, `process`, etc.)
3. `WorkerManager.generateWorkerCode()` creates Worker script with MCP binding stubs
4. Parent Worker spawns dynamic child Worker with `globalOutbound: null`
5. User code calls `mcp.toolName()` → stubs call `env.MCP.callTool()` (Service Binding)
6. MCPBridge (in parent Worker) → `fetch()` to Node.js RPC server → MCP SDK Client → MCP process
7. Results flow back through Service Binding to user code

### Data Flow: MCP Loading

1. Check schema cache (keyed by `mcp_name` + config hash)
2. If not cached: connect MCP SDK Client, fetch tools, convert to TypeScript API, cache
3. Store MCP Client for later Service Binding calls
4. Return instance info with usage examples

## Key Implementation Details

### VSCode Extension

- **Optimistic Updates**: UI updates immediately, backend confirms
- **Component Hierarchy**: `App.tsx` → `MCPCard` (controlled expansion) → Config sections
- **Key Features**: Token savings assessment, connection diagnostics, security testing, context window visualization

### CLI Commands

`status`, `savings`, `guard/unguard <mcp>`, `load`, `test`, `diagnose`, `execute`, `list`, `saved`, `delete`, `schema`, `unload`, `conflicts`, `metrics`, `help`, `exit`

### Security Model

1. **Code Validation** (`src/utils/validation.ts`): Pre-execution checks reject dangerous patterns
2. **Network Isolation**: Dynamic workers have `globalOutbound: null` - true network isolation
3. **V8 Isolate Sandboxing**: Each execution runs in disposable isolate

**Blocked patterns**: `require()`, `eval()`, `process.`, `import()`, `__dirname`, filesystem operations

### Service Bindings & Network Architecture

**CRITICAL PRINCIPLE**: MCPGuard's core purpose is **isolation**. Dynamic workers MUST have `globalOutbound: null`. This is NOT negotiable.

**Components**:
- **MCPBridge Service Binding**: Provides `env.MCP.callTool(toolName, input)` for MCP tool access
- **FetchProxy Service Binding**: Provides controlled `fetch()` when network access is enabled
- **RPC Server**: HTTP server on localhost bridging Workers to MCP SDK Clients

**Three-Layer Network Access Enforcement** (when network enabled via settings):

1. **Layer 1: Runtime Isolation** - Dynamic workers ALWAYS have `globalOutbound: null`. `globalThis.fetch` does NOT exist natively.

2. **Layer 2: Module-Level Fetch Wrapper** - When network enabled, `generateWorkerCode()` injects a wrapper that:
   - Uses `Object.defineProperty` to define `globalThis.fetch`
   - Adds `X-MCPGuard-Allowed-Hosts` and `X-MCPGuard-Allow-Localhost` headers
   - Delegates to `env.FETCH_PROXY.fetch()` Service Binding

3. **Layer 3: FetchProxy Service Binding** - Runs in parent Worker (has network access):
   - Reads allowlist from headers
   - Enforces rules (exact match, wildcard `*.github.com`, localhost blocking)
   - Returns 403 JSON error if blocked, otherwise proxies via parent's `fetch()`

**Flow**:
```
User code → fetch wrapper → adds headers → env.FETCH_PROXY.fetch() → 
FetchProxy (parent Worker) → allowlist check → real fetch() or 403
```

**IMPORTANT FOR AI ASSISTANTS**: 
- **NEVER** change `globalOutbound` from `null` - it MUST stay `null`
- **NEVER** assume `globalThis.fetch` exists in dynamic workers
- **ALWAYS** use the three-layer approach for network access
- **UNDERSTAND** that Cloudflare Workers only support `globalOutbound: null` or a Fetcher binding - there is NO `'allow'` option

### Config Management

Imports MCP configs from IDE config files in priority order:
1. Claude Code: `~/.config/claude/claude_desktop_config.json`
2. GitHub Copilot: `~/.github-copilot/apps.json`
3. Cursor: `~/.cursor/User/globalStorage/mcp.json`

### Wrangler Integration

- Parent Worker: `src/worker/runtime.ts` with Worker Loader API
- Dev Server: Started on random port (20000-29999) via `npx wrangler dev`
- Dynamic Workers: Generated per execution with embedded user code

## Testing Patterns

- **Unit Tests** (`tests/unit/`): Individual components in isolation
- **Integration Tests** (`tests/integration/`): Full MCP loading and execution workflows
- **Security Tests** (`tests/security/`): Code validation and security boundary enforcement
- **Direct MCP Testing**: `npm run test:mcp [name]` to test without Worker execution

## Common Development Tasks

### Adding a New MCP Tool Handler
1. Define tool schema in `mcp-handler.ts` `ListToolsRequestSchema` handler
2. Add case to `CallToolRequestSchema` handler switch
3. Implement handler method
4. Add Zod schema to `src/types/mcp.ts` if needed

### Modifying Code Validation Rules
Edit `src/utils/validation.ts` → `validateTypeScriptCode()`. Add dangerous patterns to regex checks.

### Changing Worker Code Generation
Edit `WorkerManager.generateWorkerCode()` in `src/server/worker-manager.ts`.
- Generated code must be valid JavaScript (no TypeScript-only syntax)
- Worker binding stubs call `env.MCP.callTool(toolName, input)`
- Service Binding injected by parent Worker via `workerCode.env`

## Important Constraints

### Windows Compatibility
- Use `npx.cmd` instead of `npx` on Windows (`process.platform === 'win32'`)
- Set `shell: true` for spawn on Windows for `.cmd` files

### TypeScript in Generated Workers
- Do NOT include TypeScript-only syntax in generated Worker code
- Type definitions are for IDE/type checking only, not runtime

### MCP Client Lifecycle
- One `Client` instance per loaded MCP, stored in `mcpClients` Map
- Client must be properly closed on unload (transport cleanup)

## IDE Configuration

Add to your IDE's MCP config:
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

- Use `-v` flag with CLI for debug logs
- Set `LOG_LEVEL=debug` in `.env` for detailed logging
- Use `npm run test:mcp` to isolate MCP connection issues
- Check RPC server logs for tool call failures

## Code Style

- TypeScript strict mode, Biome for linting/formatting
- Pino for structured logging (no `console.log` in non-CLI code)
- Zod for runtime validation
- Async/await preferred, custom error types at boundaries
