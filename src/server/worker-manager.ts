import {
  type ChildProcess,
  exec,
  type SpawnOptions,
  spawn,
} from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  ExecutionResult,
  JSONSchemaProperty,
  MCPConfig,
  MCPInstance,
  MCPPrompt,
  MCPTool,
} from '../types/mcp.js'
import { isCommandBasedConfig } from '../types/mcp.js'
import type { WorkerCode } from '../types/worker.js'
import {
  MCPConnectionError,
  MCPIsolateError,
  WorkerError,
} from '../utils/errors.js'
import logger from '../utils/logger.js'
import {
  getCachedSchema,
  getIsolationConfigForMCP,
  saveCachedSchema,
  type WorkerIsolationConfig,
} from '../utils/mcp-registry.js'
import { ProgressIndicator } from '../utils/progress-indicator.js'
import { formatWranglerError } from '../utils/wrangler-formatter.js'
import { SchemaConverter } from './schema-converter.js'

/**
 * Cached schema data for an MCP
 */
interface CachedMCPSchema {
  tools: MCPTool[]
  prompts?: MCPPrompt[]
  typescriptApi: string
  configHash: string // Hash of the config to detect changes
  cachedAt: Date
}

// Note: Client._transport is private, so we use type assertions through unknown
// when accessing it

/**
 * Error with build error flag
 */
interface BuildError extends Error {
  isBuildError?: boolean
}

/**
 * Context for error formatting
 */
interface ErrorContext {
  mcpId: string
  port: number
  userCode?: string
}

export class WorkerManager {
  private instances: Map<string, MCPInstance> = new Map()
  private mcpProcesses: Map<string, ChildProcess> = new Map()
  private mcpClients: Map<string, Client> = new Map() // Store MCP clients for communication
  private wranglerProcesses: Set<ChildProcess> = new Set() // Track all Wrangler processes for cleanup
  private schemaConverter: SchemaConverter
  private wranglerAvailable: boolean | null = null
  // Cache schemas by MCP name + config hash
  private schemaCache: Map<string, CachedMCPSchema> = new Map()
  // RPC server for Workers to call MCP tools
  private rpcServer: HttpServer | null = null
  private rpcPort: number = 0
  private rpcServerReady: Promise<void> | null = null
  // Cached worker entry point (determined once at startup)
  private cachedWorkerEntryPoint: string | null = null
  // Project root directory (where wrangler.toml is) - cached
  private projectRoot: string | null = null

  constructor() {
    this.schemaConverter = new SchemaConverter()
    this.projectRoot = this.findProjectRoot()
    this.startRPCServer()
  }

  /**
   * Find the project root by looking for wrangler.toml or package.json
   * This ensures we always spawn Wrangler from the correct directory
   * Starts from the directory where this file is located, not process.cwd()
   */
  private findProjectRoot(): string {
    // Get the directory where this source file is located
    // This works even when the MCP server is started from a different directory
    const currentFile = fileURLToPath(import.meta.url)
    let currentDir = dirname(currentFile)

    // Walk up from src/server/worker-manager.ts to find project root
    // We need to go up 2 levels: src/server -> src -> project root
    const maxDepth = 10 // Safety limit
    let depth = 0

    while (depth < maxDepth) {
      if (
        existsSync(join(currentDir, 'wrangler.toml')) ||
        existsSync(join(currentDir, 'package.json'))
      ) {
        logger.debug(
          {
            projectRoot: currentDir,
            cwd: process.cwd(),
            sourceFile: currentFile,
          },
          'Found project root',
        )
        return currentDir
      }

      const parentDir = resolve(currentDir, '..')
      if (parentDir === currentDir) {
        break // Reached filesystem root
      }
      currentDir = parentDir
      depth++
    }

    // Fallback: try process.cwd() as last resort
    logger.warn(
      {
        cwd: process.cwd(),
        sourceFile: currentFile,
        searchedFrom: dirname(currentFile),
      },
      'Could not find project root (wrangler.toml or package.json), using cwd as fallback',
    )
    return process.cwd()
  }

  /**
   * Start HTTP RPC server for Workers to call MCP tools
   * Workers make HTTP requests to this server to execute MCP tools
   */
  private startRPCServer(): void {
    if (this.rpcServer) {
      return // Already started
    }

    this.rpcServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        // CORS headers for development
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        if (req.method !== 'POST' || req.url !== '/mcp-rpc') {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
          return
        }

        try {
          let body = ''
          for await (const chunk of req) {
            body += chunk.toString()
          }

          const { mcpId, toolName, input } = JSON.parse(body)

          if (!mcpId || !toolName) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing mcpId or toolName' }))
            return
          }

          // Get MCP client and call tool
          const client = this.mcpClients.get(mcpId)
          if (!client) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                error: `MCP client not found for ID: ${mcpId}`,
              }),
            )
            return
          }

          logger.debug({ mcpId, toolName, input }, 'RPC: Calling MCP tool')

          // Call the tool using MCP SDK
          const result = await client.callTool({
            name: toolName,
            arguments: input || {},
          })

          // Extract the actual tool result from the MCP SDK response
          // The MCP SDK returns a result with a content array, where each item has type and text/data
          // We need to extract and parse the actual data
          let toolResult: unknown = result

          // If result has content array, extract the first text content
          if (result && typeof result === 'object' && 'content' in result) {
            const content = (
              result as { content?: Array<{ type?: string; text?: string }> }
            ).content
            if (Array.isArray(content) && content.length > 0) {
              const firstContent = content[0]
              if (firstContent.type === 'text' && firstContent.text) {
                try {
                  // Try to parse as JSON if it looks like JSON
                  const text = firstContent.text.trim()
                  if (text.startsWith('{') || text.startsWith('[')) {
                    toolResult = JSON.parse(text)
                  } else {
                    toolResult = text
                  }
                } catch {
                  // If parsing fails, use the text as-is
                  toolResult = firstContent.text
                }
              } else {
                // Use the content item as-is if it's not text
                toolResult = firstContent
              }
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result: toolResult }))
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          const errorStack = error instanceof Error ? error.stack : undefined
          logger.error(
            { error: errorMessage, stack: errorStack },
            'RPC: Error calling MCP tool',
          )
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              success: false,
              error: errorMessage,
              stack: errorStack,
            }),
          )
        }
      },
    )

    // Find an available port
    this.rpcServerReady = new Promise((resolve) => {
      this.rpcServer?.listen(0, '127.0.0.1', () => {
        const address = this.rpcServer?.address()
        if (address && typeof address === 'object') {
          this.rpcPort = address.port
        }
        resolve()
      })
    })
  }

  /**
   * Get the RPC server URL for Workers to use
   */
  private async getRPCUrl(): Promise<string> {
    if (this.rpcServerReady) {
      await this.rpcServerReady
    }
    return `http://127.0.0.1:${this.rpcPort}/mcp-rpc`
  }

  /**
   * Generate a hash of the MCP config for caching
   */
  public hashConfig(mcpName: string, config: MCPConfig): string {
    const configString = JSON.stringify({ mcpName, config })
    return createHash('sha256')
      .update(configString)
      .digest('hex')
      .substring(0, 16)
  }

  /**
   * Get cache key for an MCP
   */
  private getCacheKey(mcpName: string, config: MCPConfig): string {
    return `${mcpName}:${this.hashConfig(mcpName, config)}`
  }

  /**
   * Calculate schema size in characters for a tool
   */
  private calculateToolSchemaSize(tool: MCPTool): number {
    return JSON.stringify(tool).length
  }

  /**
   * Estimate tokens from character count
   * For JSON/structured data, ~3.5 chars per token is a reasonable approximation
   * This is more accurate than per-call estimates since we're measuring actual schema sizes
   */
  private estimateTokens(chars: number): number {
    // Conservative estimate: JSON/structured data typically tokenizes at ~3-4 chars/token
    // Using 3.5 as a middle ground for schema data (JSON with descriptions)
    return Math.round(chars / 3.5)
  }

  /**
   * Calculate schema efficiency metrics
   */
  private calculateSchemaMetrics(
    tools: MCPTool[],
    toolsCalled: string[],
  ): {
    total_tools_available: number
    tools_used: string[]
    schema_size_total_chars: number
    schema_size_used_chars: number
    schema_utilization_percent: number
    schema_efficiency_ratio: number
    schema_size_reduction_chars: number
    schema_size_reduction_percent: number
    estimated_tokens_total?: number
    estimated_tokens_used?: number
    estimated_tokens_saved?: number
  } {
    const totalTools = tools.length
    const toolsUsedSet = new Set(toolsCalled)
    const toolsUsed = Array.from(toolsUsedSet)

    // Calculate total schema size (all tools)
    const schemaSizeTotal = tools.reduce(
      (sum, tool) => sum + this.calculateToolSchemaSize(tool),
      0,
    )

    // Calculate schema size for tools actually used
    const schemaSizeUsed = tools
      .filter((tool) => toolsUsedSet.has(tool.name))
      .reduce((sum, tool) => sum + this.calculateToolSchemaSize(tool), 0)

    // Calculate metrics
    const schemaUtilizationPercent =
      schemaSizeTotal > 0 ? (schemaSizeUsed / schemaSizeTotal) * 100 : 0

    const schemaEfficiencyRatio =
      schemaSizeUsed > 0 ? schemaSizeTotal / schemaSizeUsed : 0

    const schemaSizeReduction = schemaSizeTotal - schemaSizeUsed
    const schemaSizeReductionPercent =
      schemaSizeTotal > 0 ? (schemaSizeReduction / schemaSizeTotal) * 100 : 0

    // Estimate tokens based on actual schema sizes
    // More accurate than per-call estimates since we're measuring real data
    const estimatedTokensTotal = this.estimateTokens(schemaSizeTotal)
    const estimatedTokensUsed = this.estimateTokens(schemaSizeUsed)
    const estimatedTokensSaved = estimatedTokensTotal - estimatedTokensUsed

    return {
      total_tools_available: totalTools,
      tools_used: toolsUsed,
      schema_size_total_chars: schemaSizeTotal,
      schema_size_used_chars: schemaSizeUsed,
      schema_utilization_percent:
        Math.round(schemaUtilizationPercent * 100) / 100,
      schema_efficiency_ratio: Math.round(schemaEfficiencyRatio * 100) / 100,
      schema_size_reduction_chars: schemaSizeReduction,
      schema_size_reduction_percent:
        Math.round(schemaSizeReductionPercent * 100) / 100,
      estimated_tokens_total: estimatedTokensTotal,
      estimated_tokens_used: estimatedTokensUsed,
      estimated_tokens_saved: estimatedTokensSaved,
    }
  }

  /**
   * Get security metrics for the current execution
   */
  private getSecurityMetrics(): {
    network_isolation_enabled: boolean
    process_isolation_enabled: boolean
    isolation_type: string
    sandbox_status: string
    security_level: string
    protection_summary: string[]
  } {
    // Currently all security features are enabled
    // In the future, network isolation may be conditional based on allowlist
    const networkIsolationEnabled = true // globalOutbound: null
    const processIsolationEnabled = true // Worker isolates
    const isolationType = 'worker_isolate'
    const securityLevel = 'high'

    const protectionSummary: string[] = []
    if (networkIsolationEnabled) {
      protectionSummary.push('Network isolation (no outbound access)')
    }
    if (processIsolationEnabled) {
      protectionSummary.push('Process isolation (separate Worker)')
    }
    protectionSummary.push('Code sandboxing (isolated execution)')

    return {
      network_isolation_enabled: networkIsolationEnabled,
      process_isolation_enabled: processIsolationEnabled,
      isolation_type: isolationType,
      sandbox_status: 'active',
      security_level: securityLevel,
      protection_summary: protectionSummary,
    }
  }

  /**
   * Load MCP tool schema only (without spawning full process)
   * Used for transparent proxy mode to discover available tools
   * Returns cached schema if available, otherwise fetches and caches it
   */
  async loadMCPSchemaOnly(
    mcpName: string,
    config: MCPConfig,
  ): Promise<MCPTool[]> {
    const cacheKey = this.getCacheKey(mcpName, config)
    const configHash = this.hashConfig(mcpName, config)

    // Check cache first
    const cached = this.schemaCache.get(cacheKey)
    if (cached && cached.configHash === configHash) {
      logger.debug(
        { mcpName, cacheKey, toolCount: cached.tools.length },
        'Using cached MCP schema for transparent proxy',
      )
      return cached.tools
    }

    // Not cached - need to fetch schema
    // Create temporary client to fetch schema
    let client: Client | null = null
    let transport: StdioClientTransport | StreamableHTTPClientTransport | null =
      null

    try {
      if (isCommandBasedConfig(config)) {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        })
      } else {
        // URL-based MCP: use HTTP transport
        const url = new URL(config.url)
        const transportOptions: {
          requestInit?: RequestInit
        } = {}

        // Add custom headers if provided
        // OAuth tokens are passed via config.headers as "Authorization: Bearer <token>"
        // When OAuth flow completes, the token should be added to the MCP config headers
        if (config.headers) {
          transportOptions.requestInit = {
            headers: config.headers,
          }
          // Debug: log headers being passed (mask sensitive values)
          const maskedHeaders = Object.fromEntries(
            Object.entries(config.headers).map(([k, v]) => [
              k,
              k.toLowerCase().includes('auth') ? `${v.substring(0, 15)}...` : v,
            ]),
          )
          logger.info(
            { mcpName, url: config.url, headers: maskedHeaders },
            'loadMCPSchemaOnly: passing headers to StreamableHTTPClientTransport',
          )
        }

        transport = new StreamableHTTPClientTransport(url, transportOptions)
      }

      client = new Client(
        {
          name: 'mcpguard',
          version: '0.1.0',
        },
        {
          capabilities: {},
        },
      )

      // Connect to fetch schema
      await client.connect(transport, { timeout: 10000 })

      // Fetch tools
      const toolsResponse = await client.listTools()

      logger.info(
        { mcpName, toolCount: toolsResponse.tools.length },
        `loadMCPSchemaOnly: received ${toolsResponse.tools.length} tools`,
      )

      // Convert to MCPTool format
      const tools: MCPTool[] = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: (tool.inputSchema.properties || {}) as Record<
            string,
            JSONSchemaProperty
          >,
          required: tool.inputSchema.required || [],
        },
      }))

      // Cache the schema
      const typescriptApi = this.schemaConverter.convertToTypeScript(tools)
      this.schemaCache.set(cacheKey, {
        tools,
        typescriptApi,
        configHash,
        cachedAt: new Date(),
      })

      logger.info(
        { mcpName, cacheKey, toolCount: tools.length },
        'Fetched and cached MCP schema for transparent proxy',
      )

      return tools
    } catch (error: unknown) {
      // Check for authentication errors (401/403) which may indicate OAuth is required
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const isAuthError = /401|403|Unauthorized|Forbidden/i.test(errorMessage)

      if (isAuthError) {
        logger.warn(
          { error, mcpName },
          'Authentication failed for MCP - may require OAuth or valid Authorization header',
        )
      } else {
        logger.warn(
          { error, mcpName },
          'Failed to fetch MCP schema for transparent proxy',
        )
      }
      // Return empty array on error - transparent proxy will skip this MCP
      return []
    } finally {
      // Clean up temporary client and transport
      if (client) {
        try {
          await client.close()
        } catch (error: unknown) {
          logger.debug({ error }, 'Error closing temporary MCP client')
        }
      }
      if (transport) {
        try {
          await transport.close()
        } catch (error: unknown) {
          logger.debug({ error }, 'Error closing temporary MCP transport')
        }
      }
    }
  }

  /**
   * Load MCP prompt schema only (without spawning full process)
   * Used for transparent proxy mode to discover available prompts
   * Returns cached prompts if available, otherwise fetches and caches them
   */
  async loadMCPPromptsOnly(
    mcpName: string,
    config: MCPConfig,
  ): Promise<MCPPrompt[]> {
    const cacheKey = this.getCacheKey(mcpName, config)
    const configHash = this.hashConfig(mcpName, config)

    // Check cache first
    const cached = this.schemaCache.get(cacheKey)
    if (cached && cached.configHash === configHash && cached.prompts) {
      logger.debug(
        { mcpName, cacheKey, promptCount: cached.prompts.length },
        'Using cached MCP prompts for transparent proxy',
      )
      return cached.prompts
    }

    // Not cached - need to fetch prompts
    // Create temporary client to fetch prompts
    let client: Client | null = null
    let transport: StdioClientTransport | StreamableHTTPClientTransport | null =
      null

    try {
      if (isCommandBasedConfig(config)) {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        })
      } else {
        // URL-based MCP: use HTTP transport
        const url = new URL(config.url)
        const transportOptions: {
          requestInit?: RequestInit
        } = {}

        // Add custom headers if provided
        if (config.headers) {
          transportOptions.requestInit = {
            headers: config.headers,
          }
        }

        transport = new StreamableHTTPClientTransport(url, transportOptions)
      }

      client = new Client(
        {
          name: 'mcpguard',
          version: '0.1.0',
        },
        {
          capabilities: {},
        },
      )

      // Connect to fetch prompts
      await client.connect(transport, { timeout: 10000 })

      // Fetch prompts
      const promptsResponse = await client.listPrompts()

      // Convert to MCPPrompt format
      const prompts: MCPPrompt[] = promptsResponse.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      }))

      // Update cache with prompts (preserve existing tools if cached)
      const existingCache = this.schemaCache.get(cacheKey)
      this.schemaCache.set(cacheKey, {
        tools: existingCache?.tools || [],
        typescriptApi: existingCache?.typescriptApi || '',
        prompts,
        configHash,
        cachedAt: new Date(),
      })

      logger.info(
        { mcpName, cacheKey, promptCount: prompts.length },
        'Fetched and cached MCP prompts for transparent proxy',
      )

      return prompts
    } catch (error: unknown) {
      // Check for authentication errors (401/403) which may indicate OAuth is required
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const isAuthError = /401|403|Unauthorized|Forbidden/i.test(errorMessage)

      if (isAuthError) {
        logger.warn(
          { error, mcpName },
          'Authentication failed for MCP prompts - may require OAuth or valid Authorization header',
        )
      } else {
        logger.warn(
          { error, mcpName },
          'Failed to fetch MCP prompts for transparent proxy',
        )
      }
      // Return empty array on error - transparent proxy will skip this MCP
      return []
    } finally {
      // Clean up temporary client and transport
      if (client) {
        try {
          await client.close()
        } catch (error: unknown) {
          logger.debug({ error }, 'Error closing temporary MCP client')
        }
      }
      if (transport) {
        try {
          await transport.close()
        } catch (error: unknown) {
          logger.debug({ error }, 'Error closing temporary MCP transport')
        }
      }
    }
  }

  /**
   * Load an MCP server into a Worker isolate
   */
  async loadMCP(mcpName: string, config: MCPConfig): Promise<MCPInstance> {
    const mcpId = randomUUID()
    const cacheKey = this.getCacheKey(mcpName, config)

    // Log config without sensitive environment variables
    const safeConfig = isCommandBasedConfig(config)
      ? {
          command: config.command,
          args: config.args,
          envKeys: config.env ? Object.keys(config.env) : undefined,
        }
      : { url: config.url }
    logger.info({ mcpId, mcpName, config: safeConfig }, 'Loading MCP server')

    try {
      // Step 1: Check cache first - if we have cached schema, we can skip process initialization wait
      const cached = this.schemaCache.get(cacheKey)
      const configHash = this.hashConfig(mcpName, config)
      const hasCachedSchema = cached && cached.configHash === configHash

      // Check persistent cache if not in memory
      if (!hasCachedSchema) {
        const persistentCached = getCachedSchema(mcpName, configHash)
        if (persistentCached) {
          // Load into in-memory cache
          this.schemaCache.set(cacheKey, {
            tools: persistentCached.tools as MCPTool[],
            typescriptApi:
              persistentCached.typescriptApi ||
              this.schemaConverter.convertToTypeScript(
                persistentCached.tools as MCPTool[],
              ),
            configHash: persistentCached.configHash,
            cachedAt: new Date(persistentCached.cachedAt),
          })
          logger.info(
            { mcpId, mcpName, toolCount: persistentCached.toolCount },
            'Loaded MCP schema from persistent cache',
          )
        }
      }

      // Re-check cache after loading from persistent
      const cachedAfterLoad = this.schemaCache.get(cacheKey)
      const hasCachedSchemaAfterLoad =
        cachedAfterLoad && cachedAfterLoad.configHash === configHash

      // Step 2: If we have cached schema and it's a command-based MCP, we still need a process for execution
      // URL-based MCPs don't spawn processes - they use HTTP connections
      if (hasCachedSchemaAfterLoad && isCommandBasedConfig(config)) {
        const mcpProcess = await this.startMCPProcess(config, true)
        this.mcpProcesses.set(mcpId, mcpProcess)
      }

      // Step 3: Get schema and TypeScript API (from cache or fetch)
      let tools: MCPTool[]
      let prompts: MCPPrompt[]
      let typescriptApi: string

      if (hasCachedSchemaAfterLoad) {
        // Use cached schema and TypeScript API
        logger.info({ mcpId, mcpName, cacheKey }, 'Using cached MCP schema')
        tools = cachedAfterLoad?.tools
        prompts = cachedAfterLoad?.prompts || []
        typescriptApi = cachedAfterLoad?.typescriptApi
      } else {
        // Step 4: Connect to MCP server and fetch schema using real MCP protocol
        const schema = await this.fetchMCPSchema(mcpName, config, mcpId)
        tools = schema.tools
        prompts = schema.prompts

        // Step 5: Convert schema to TypeScript API
        typescriptApi = this.schemaConverter.convertToTypeScript(tools)

        // Cache the schema and TypeScript API
        this.schemaCache.set(cacheKey, {
          tools,
          prompts,
          typescriptApi,
          configHash: this.hashConfig(mcpName, config),
          cachedAt: new Date(),
        })
        logger.debug(
          {
            mcpId,
            mcpName,
            cacheKey,
            toolCount: tools.length,
            promptCount: prompts.length,
          },
          'Cached MCP schema',
        )

        // Also save to persistent cache
        saveCachedSchema({
          mcpName,
          configHash: this.hashConfig(mcpName, config),
          tools,
          prompts,
          toolNames: tools.map((t) => t.name),
          promptNames: prompts.map((p) => p.name),
          toolCount: tools.length,
          promptCount: prompts.length,
          // typescriptApi omitted to save disk space (can regenerate if needed)
          cachedAt: new Date().toISOString(),
        })
      }

      // Step 5: Create Worker isolate configuration
      const workerId = `worker-${mcpId}`
      // Worker code will be generated on-demand when executing code

      // Step 6: Store instance metadata
      const instance: MCPInstance = {
        mcp_id: mcpId,
        mcp_name: mcpName,
        status: 'ready',
        worker_id: workerId,
        typescript_api: typescriptApi,
        tools,
        prompts,
        created_at: new Date(),
        uptime_ms: 0,
      }

      this.instances.set(mcpId, instance)

      logger.info(
        { mcpId, mcpName, cached: !!cached },
        'MCP server loaded successfully',
      )

      return instance
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      logger.error({ error, mcpId, mcpName }, 'Failed to load MCP server')

      // Cleanup on failure - kill MCP process
      const mcpProcess = this.mcpProcesses.get(mcpId)
      if (mcpProcess) {
        try {
          await this.killMCPProcess(mcpProcess)
        } catch (error: unknown) {
          logger.warn(
            { error, mcpId },
            'Error killing MCP process during load failure',
          )
        }
        this.mcpProcesses.delete(mcpId)
      }

      throw new MCPConnectionError(
        `Failed to load MCP server: ${errorMessage}`,
        { mcpName, error },
      )
    }
  }

  /**
   * Execute TypeScript code in a Worker isolate
   */
  async executeCode(
    mcpId: string,
    code: string,
    timeoutMs: number = 30000,
  ): Promise<ExecutionResult> {
    const instance = this.instances.get(mcpId)

    if (!instance) {
      throw new WorkerError(`MCP instance not found: ${mcpId}`)
    }

    if (instance.status !== 'ready') {
      throw new WorkerError(`MCP instance not ready: ${instance.status}`)
    }

    logger.info(
      { mcpId, codeLength: code.length },
      'Executing code in Worker isolate',
    )

    const startTime = Date.now()

    try {
      const result = await this.executeInIsolate(
        mcpId,
        code,
        timeoutMs,
        instance,
      )

      const executionTime = Date.now() - startTime

      // Calculate schema efficiency metrics
      const toolsCalled = result.metrics?.tools_called || []
      const schemaEfficiency = this.calculateSchemaMetrics(
        instance.tools,
        toolsCalled,
      )

      // Get security metrics
      const security = this.getSecurityMetrics()

      logger.info({ mcpId, executionTime }, 'Code executed successfully')

      return {
        success: true,
        output: result.output,
        result: result.result,
        execution_time_ms: executionTime,
        metrics: {
          mcp_calls_made: result.metrics?.mcp_calls_made ?? 0,
          tools_called: result.metrics?.tools_called,
          schema_efficiency: schemaEfficiency,
          security,
        },
      }
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime

      logger.error({ error, mcpId, executionTime }, 'Code execution failed')

      // Calculate schema efficiency metrics even on failure (no tools called)
      const schemaEfficiency = this.calculateSchemaMetrics(instance.tools, [])
      const security = this.getSecurityMetrics()

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      // Extract error details if it's an MCPIsolateError (includes WorkerError)
      // WorkerError extends MCPIsolateError, so this should catch it
      let errorDetails: unknown
      if (error instanceof MCPIsolateError) {
        errorDetails = error.details
        logger.debug(
          { mcpId, hasDetails: !!errorDetails },
          'Extracted error details from MCPIsolateError',
        )
      } else if (error instanceof WorkerError) {
        // Fallback check - WorkerError should be caught by MCPIsolateError check above
        // but this ensures we get the details
        errorDetails = error.details
        logger.debug(
          { mcpId, hasDetails: !!errorDetails },
          'Extracted error details from WorkerError',
        )
      } else {
        logger.debug(
          { mcpId, errorType: error?.constructor?.name },
          'Error is not an MCPIsolateError or WorkerError',
        )
      }

      return {
        success: false,
        error: errorMessage,
        execution_time_ms: executionTime,
        metrics: {
          mcp_calls_made: 0,
          tools_called: [],
          schema_efficiency: schemaEfficiency,
          security,
        },
        error_details: errorDetails,
      }
    }
  }

  /**
   * Unload an MCP server and clean up resources
   */
  async unloadMCP(mcpId: string): Promise<void> {
    logger.info({ mcpId }, 'Unloading MCP server')

    const instance = this.instances.get(mcpId)
    if (!instance) {
      throw new WorkerError(`MCP instance not found: ${mcpId}`)
    }

    // Close MCP client connection
    const client = this.mcpClients.get(mcpId)
    if (client) {
      try {
        // Get transport from client and close it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientWithTransport = client as unknown as {
          _transport?: { close?: () => Promise<void> }
        }
        const transport = clientWithTransport._transport
        if (transport && typeof transport.close === 'function') {
          await transport.close()
        }
      } catch (error: unknown) {
        logger.warn({ error, mcpId }, 'Error closing MCP client transport')
      }
      this.mcpClients.delete(mcpId)
    }

    // Kill MCP process and wait for it to terminate
    const mcpProcess = this.mcpProcesses.get(mcpId)
    if (mcpProcess) {
      try {
        await this.killMCPProcess(mcpProcess)
      } catch (error: unknown) {
        logger.warn({ error, mcpId }, 'Error killing MCP process during unload')
      }
      this.mcpProcesses.delete(mcpId)
    }

    // Remove instance
    this.instances.delete(mcpId)

    logger.info({ mcpId }, 'MCP server unloaded')
  }

  /**
   * Get all loaded MCP instances
   */
  listInstances(): MCPInstance[] {
    return Array.from(this.instances.values()).map((instance) => ({
      ...instance,
      uptime_ms: Date.now() - instance.created_at.getTime(),
    }))
  }

  /**
   * Get a specific MCP instance
   */
  getInstance(mcpId: string): MCPInstance | undefined {
    const instance = this.instances.get(mcpId)
    if (instance) {
      return {
        ...instance,
        uptime_ms: Date.now() - instance.created_at.getTime(),
      }
    }
    return undefined
  }

  /**
   * Get MCP instance by name
   */
  getMCPByName(mcpName: string): MCPInstance | undefined {
    const instances = this.listInstances()
    return instances.find((instance) => instance.mcp_name === mcpName)
  }

  /**
   * Get MCP client for direct protocol calls (e.g., getPrompt)
   */
  getMCPClient(mcpId: string): Client | undefined {
    return this.mcpClients.get(mcpId)
  }

  /**
   * Clear the in-memory schema cache for a specific MCP
   * This forces a re-fetch of tools on the next connection
   * Note: This only clears the in-memory cache; persistent cache is managed separately
   * @param mcpName The name of the MCP to clear cache for
   * @returns Number of cache entries cleared
   */
  clearSchemaCache(mcpName: string): number {
    let cleared = 0
    // Schema cache keys are in format "mcpName:configHash"
    for (const cacheKey of this.schemaCache.keys()) {
      if (cacheKey.startsWith(`${mcpName}:`)) {
        this.schemaCache.delete(cacheKey)
        cleared++
      }
    }
    if (cleared > 0) {
      logger.info(
        { mcpName, clearedEntries: cleared },
        'Cleared in-memory schema cache for MCP',
      )
    }
    return cleared
  }

  // Private helper methods

  private async startMCPProcess(
    config: MCPConfig,
    hasCachedSchema: boolean = false,
  ): Promise<ChildProcess> {
    // Only command-based configs can spawn processes
    // URL-based configs use HTTP transport and don't need process spawning
    if (!isCommandBasedConfig(config)) {
      throw new MCPConnectionError(
        'URL-based MCP configurations use HTTP transport and do not spawn processes. Process tracking is only for command-based MCPs.',
      )
    }

    return new Promise((resolve, reject) => {
      // On Windows, npx resolves to npx.cmd which spawn() can execute directly
      // On Unix, npx is a regular executable
      let command = config.command
      const args = config.args || []

      if (process.platform === 'win32' && command === 'npx') {
        command = 'npx.cmd'
      }

      logger.info(
        {
          platform: process.platform,
          originalCommand: config.command,
          resolvedCommand: command,
          args: args,
          envKeys: Object.keys(config.env || {}),
          hasCachedSchema,
        },
        'Spawning MCP process',
      )

      let mcpProcess: ChildProcess
      let initialized = false

      try {
        // On Windows, .cmd files need shell: true to execute properly
        // In test environment, redirect stderr to suppress MCP server startup logs
        const isTestEnv =
          process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
        const spawnOptions: SpawnOptions = {
          env: { ...process.env, ...config.env },
          stdio: isTestEnv
            ? ['pipe', 'pipe', 'ignore'] // Suppress stderr in tests
            : ['pipe', 'pipe', 'pipe'], // Normal mode: pipe stderr for logging
        }

        if (process.platform === 'win32') {
          spawnOptions.shell = true
        }

        logger.debug({ spawnOptions }, 'Spawning with options')

        mcpProcess = spawn(command, args, spawnOptions)

        logger.info(
          {
            pid: mcpProcess.pid,
            command,
            args: args.slice(0, 5), // First 5 args for brevity
          },
          `MCP process spawned: PID ${mcpProcess.pid}`,
        )

        // If we have cached schema, we don't need to wait for initialization
        // Just give the process a moment to start, then resolve
        if (hasCachedSchema) {
          // Wait a short time for process to start, then resolve
          setTimeout(() => {
            if (mcpProcess && !mcpProcess.killed) {
              initialized = true
              resolve(mcpProcess)
            } else {
              reject(new MCPConnectionError('MCP process failed to start'))
            }
          }, 500)
          return
        }

        // Without cached schema, we need to wait for the process to be ready
        // MCP servers communicate via JSON-RPC, so we wait for any stdout output
        // (which indicates the process is running and ready to communicate)
        if (mcpProcess.stdout) {
          mcpProcess.stdout.on('data', (data: Buffer) => {
            const output = data.toString()
            logger.debug({ output }, 'MCP stdout')

            // MCP servers output JSON-RPC messages - any output means it's ready
            if (!initialized) {
              initialized = true
              // Give it a moment to fully initialize
              setTimeout(() => resolve(mcpProcess), 200)
            }
          })
        }

        // In test mode, stderr is redirected to 'ignore', so we don't need to handle it
        // In normal mode, we listen to stderr for initialization detection and logging
        if (!isTestEnv && mcpProcess.stderr) {
          mcpProcess.stderr.on('data', (data: Buffer) => {
            const stderrOutput = data.toString()
            logger.debug({ error: stderrOutput }, 'MCP stderr')
            // Some MCP servers output initialization info to stderr
            // If we see output, the process is at least running
            if (!initialized && stderrOutput.trim().length > 0) {
              initialized = true
              setTimeout(() => resolve(mcpProcess), 200)
            }
          })
        }

        mcpProcess.on('error', (error: Error) => {
          const errnoError = error as NodeJS.ErrnoException
          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              code: errnoError.code,
              errno: errnoError.errno,
              syscall: errnoError.syscall,
              command,
              args,
            },
            'MCP process spawn error',
          )
          reject(
            new MCPConnectionError(
              `Failed to start MCP process: ${error.message}`,
            ),
          )
        })

        // Track when MCP process exits naturally
        mcpProcess.on('exit', (code, signal) => {
          logger.debug(
            { pid: mcpProcess.pid, code, signal, command },
            'MCP process exited naturally',
          )
        })

        // Timeout for initialization
        // Note: MCP servers may not output anything until we send an initialize request
        // So we use a shorter timeout and assume the process is ready if it's still running
        setTimeout(() => {
          if (!initialized) {
            // If process is still running, assume it's ready (even without output)
            // This handles MCP servers that wait for initialization requests
            if (mcpProcess && !mcpProcess.killed && mcpProcess.pid) {
              logger.info(
                { pid: mcpProcess.pid },
                'MCP process ready (timeout - assuming ready)',
              )
              initialized = true
              resolve(mcpProcess)
            } else {
              reject(
                new MCPConnectionError(
                  'MCP process initialization timeout - process not running',
                ),
              )
            }
          }
        }, 2000) // Reduced to 2s since we can use cached schemas
      } catch (spawnError: unknown) {
        const errorMessage =
          spawnError instanceof Error ? spawnError.message : 'Unknown error'
        const errorCode = (spawnError as NodeJS.ErrnoException)?.code
        const errorErrno = (spawnError as NodeJS.ErrnoException)?.errno
        const errorSyscall = (spawnError as NodeJS.ErrnoException)?.syscall
        logger.error(
          {
            error: errorMessage,
            code: errorCode,
            errno: errorErrno,
            syscall: errorSyscall,
            command,
            args,
          },
          'Failed to spawn MCP process (catch block)',
        )
        reject(
          new MCPConnectionError(
            `Failed to spawn MCP process: ${errorMessage}`,
          ),
        )
      }
    })
  }

  private async fetchMCPSchema(
    mcpName: string,
    config: MCPConfig,
    mcpId: string,
  ): Promise<{ tools: MCPTool[]; prompts: MCPPrompt[] }> {
    logger.info({ mcpId, mcpName }, 'Fetching MCP schema using real protocol')

    try {
      // Create MCP client with appropriate transport based on config type
      let transport: StdioClientTransport | StreamableHTTPClientTransport

      if (isCommandBasedConfig(config)) {
        // Command-based MCP: use stdio transport (spawns process)
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        })
      } else {
        // URL-based MCP: use HTTP transport (connects to remote endpoint)
        const url = new URL(config.url)
        const transportOptions: {
          requestInit?: RequestInit
        } = {}

        // Add custom headers if provided
        if (config.headers) {
          transportOptions.requestInit = {
            headers: config.headers,
          }
          // Debug: log headers being passed (mask sensitive values)
          const maskedHeaders = Object.fromEntries(
            Object.entries(config.headers).map(([k, v]) => [
              k,
              k.toLowerCase().includes('auth') ? `${v.substring(0, 15)}...` : v,
            ]),
          )
          logger.info(
            { mcpId, mcpName, url: config.url, headers: maskedHeaders },
            'URL-based MCP: passing headers to StreamableHTTPClientTransport',
          )
        } else {
          logger.info(
            { mcpId, mcpName, url: config.url },
            'URL-based MCP: no custom headers configured',
          )
        }

        transport = new StreamableHTTPClientTransport(url, transportOptions)
      }

      const client = new Client(
        {
          name: 'mcpguard',
          version: '0.1.0',
        },
        {
          capabilities: {},
        },
      )

      // Connect to the MCP server (this handles initialization automatically)
      const connectStartTime = Date.now()
      await client.connect(transport, { timeout: 10000 }) // 10 second timeout for initialization
      const connectTime = Date.now() - connectStartTime
      logger.info(
        { mcpId, mcpName, connectTimeMs: connectTime },
        'MCP client connected',
      )

      // Store client for later use (e.g., executing tools)
      this.mcpClients.set(mcpId, client)

      // For command-based MCPs, track the spawned process
      if (isCommandBasedConfig(config)) {
        // Get the actual process from the transport
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transportWithProcess = transport as unknown as {
          _process?: ChildProcess
        }
        const process = transportWithProcess._process
        if (process) {
          // Update our process map with the actual process
          this.mcpProcesses.set(mcpId, process)

          if (process.pid) {
            logger.info(
              {
                pid: process.pid,
                command: config.command,
                args: (config.args || []).slice(0, 5),
                mcpId,
                mcpName,
              },
              `MCP process spawned via StdioClientTransport: PID ${process.pid}`,
            )
          }
        }
      } else {
        // URL-based MCPs don't spawn processes - they use HTTP connections
        logger.info(
          { mcpId, mcpName, url: config.url },
          'MCP connected via StreamableHTTPClientTransport',
        )
      }

      // List tools from the MCP server
      const listToolsStartTime = Date.now()
      const toolsResponse = await client.listTools()
      const listToolsTime = Date.now() - listToolsStartTime

      // Log tool count at info level to help diagnose issues
      logger.info(
        {
          mcpId,
          mcpName,
          toolCount: toolsResponse.tools.length,
          listToolsTimeMs: listToolsTime,
          toolNames: toolsResponse.tools.slice(0, 5).map((t) => t.name), // First 5 tools for debugging
        },
        `Fetched ${toolsResponse.tools.length} tools from MCP server`,
      )

      // Convert MCP SDK tool format to our MCPTool format
      const tools: MCPTool[] = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          properties: (tool.inputSchema.properties || {}) as Record<
            string,
            JSONSchemaProperty
          >,
          required: tool.inputSchema.required || [],
        },
      }))

      // List prompts from the MCP server
      const listPromptsStartTime = Date.now()
      let prompts: MCPPrompt[] = []
      try {
        const promptsResponse = await client.listPrompts()
        const listPromptsTime = Date.now() - listPromptsStartTime
        logger.debug(
          {
            mcpId,
            mcpName,
            promptCount: promptsResponse.prompts.length,
            listPromptsTimeMs: listPromptsTime,
          },
          'Fetched prompts from MCP server',
        )

        // Convert MCP SDK prompt format to our MCPPrompt format
        prompts = promptsResponse.prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        }))
      } catch (error: unknown) {
        // Some MCPs may not support prompts - that's okay
        logger.debug(
          { mcpId, mcpName, error },
          'MCP does not support prompts or prompts fetch failed',
        )
      }

      return { tools, prompts }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      logger.error({ error, mcpId, mcpName }, 'Failed to fetch MCP schema')
      throw new MCPConnectionError(
        `Failed to fetch MCP schema: ${errorMessage}`,
        { mcpName, error },
      )
    }
  }

  private async generateWorkerCode(
    mcpId: string,
    tools: MCPTool[],
    _typescriptApi: string, // Not used in worker code (causes strict mode syntax errors), kept for API compatibility
    userCode: string,
    isolationConfig?: WorkerIsolationConfig,
  ): Promise<WorkerCode> {
    // Get RPC server URL for parent Worker to call (via Service Binding)
    const rpcUrl = await this.getRPCUrl()

    const allowedHostsRaw = isolationConfig?.outbound.allowedHosts ?? null
    const allowLocalhost = isolationConfig?.outbound.allowLocalhost ?? false
    const allowedHosts =
      Array.isArray(allowedHostsRaw) && allowedHostsRaw.length > 0
        ? allowedHostsRaw
            .map((h) => String(h).trim().toLowerCase())
            .filter((h) => h.length > 0)
        : []

    // Network access is controlled via globalOutbound (set to FetchProxy when enabled).
    // When enabled, we wrap fetch() to add allowlist headers that FetchProxy reads.
    // When disabled, globalOutbound is null and fetch() will not be available.
    const networkEnabled = allowLocalhost || allowedHosts.length > 0

    // Note: The main fetch wrapper is defined at module level (see modulePrelude below)
    // For network-disabled case, globalOutbound is null and fetch() won't be available
    // No wrapper needed - user will get Cloudflare's native error message

    // Generate MCP binding stubs that use Service Binding instead of fetch()
    // The Service Binding (env.MCP) is provided by the parent Worker via ctx.exports
    // This allows dynamic workers to remain fully isolated (globalOutbound: null)
    logger.debug(
      { mcpId, toolCount: tools.length, toolNames: tools.map((t) => t.name) },
      'Generating MCP binding stubs',
    )
    const mcpBindingStubs = tools
      .map((tool) => {
        // Escape tool name for use in template string
        const escapedToolName = tool.name.replace(/'/g, "\\'")
        return `    ${tool.name}: async (input) => {
      // Call MCP tool via Service Binding (no fetch() needed - native RPC)
      // The Service Binding is provided by the parent Worker and bridges to Node.js RPC server
      return await env.MCP.callTool('${escapedToolName}', input || {});
    }`
      })
      .join(',\n')

    logger.debug(
      { mcpId, bindingStubsPreview: mcpBindingStubs.substring(0, 500) },
      'Generated MCP binding stubs',
    )

    // Dynamic Worker code that executes user code
    // This Worker is spawned via the Worker Loader API
    // Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/
    // Note: TypeScript API definitions are not included here as they cause syntax errors in strict mode.
    // Type definitions are only needed for IDE/type checking, not at runtime.
    // Following Cloudflare's Code Mode pattern: https://blog.cloudflare.com/code-mode/
    // Uses Service Bindings for secure MCP access (no fetch() needed - true isolation)
    // User code is embedded directly as executable JavaScript (no escaping needed)
    logger.debug(
      {
        codeLength: userCode.length,
        preview: userCode.substring(0, 200),
      },
      'Embedding user code in worker script',
    )

    // Build worker script using string concatenation to avoid esbuild parsing issues
    // We can't mix template literals with string concatenation, so we use all string concatenation
    //
    // IMPORTANT: The fetch wrapper is placed at MODULE LEVEL (not inside the fetch handler)
    // This ensures it runs before the Cloudflare runtime can freeze globalThis.fetch
    const modulePrelude = networkEnabled
      ? '// MCPGuard: Fetch wrapper at module level to intercept before runtime freezes fetch\n' +
        `const __mcpguardAllowedHosts = ${JSON.stringify(allowedHosts.join(','))};\n` +
        `const __mcpguardAllowLocalhost = ${allowLocalhost ? '"true"' : '"false"'};\n` +
        'const __mcpguardOriginalFetch = globalThis.fetch;\n' +
        'const __mcpguardFetchWrapper = async (input, init) => {\n' +
        '  const headers = new Headers(init?.headers || {});\n' +
        '  headers.set("X-MCPGuard-Allowed-Hosts", __mcpguardAllowedHosts);\n' +
        '  headers.set("X-MCPGuard-Allow-Localhost", __mcpguardAllowLocalhost);\n' +
        '  const response = await __mcpguardOriginalFetch(input, { ...init, headers });\n' +
        '  if (response.status === 403) {\n' +
        '    try {\n' +
        '      const body = await response.clone().json();\n' +
        '      if (body.error && body.error.startsWith("MCPGuard network policy:")) {\n' +
        '        throw new Error(body.error);\n' +
        '      }\n' +
        '    } catch (e) {\n' +
        '      if (e.message && e.message.startsWith("MCPGuard network policy:")) {\n' +
        '        throw e;\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '  return response;\n' +
        '};\n' +
        '// Override globalThis.fetch at module level\n' +
        'globalThis.fetch = __mcpguardFetchWrapper;\n\n'
      : ''

    const workerScript =
      '// Dynamic Worker that executes AI-generated code\n' +
      '// This Worker is spawned via Worker Loader API from the parent Worker\n' +
      (networkEnabled
        ? '// Network access enabled with domain allowlist enforcement\n'
        : '// Uses Service Bindings for secure MCP access (globalOutbound: null enabled)\n') +
      modulePrelude +
      'export default {\n' +
      '  async fetch(request, env, ctx) {\n' +
      '    const { code, timeout = 30000 } = await request.json();\n' +
      '    \n' +
      '    // Capture console output\n' +
      '    const logs = [];\n' +
      '    const originalLog = console.log;\n' +
      '    const originalError = console.error;\n' +
      '    const originalWarn = console.warn;\n' +
      '\n' +
      '    console.log = (...args) => {\n' +
      "      logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));\n" +
      '    };\n' +
      '\n' +
      '    console.error = (...args) => {\n' +
      "      logs.push('ERROR: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));\n" +
      '    };\n' +
      '\n' +
      '    console.warn = (...args) => {\n' +
      "      logs.push('WARN: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));\n" +
      '    };\n' +
      '\n' +
      '    let mcpCallCount = 0;\n' +
      '    const toolsCalled = new Set();\n' +
      '    let result;\n' +
      '\n' +
      '    try {\n' +
      '      // Create MCP binding implementation using Service Binding (env.MCP)\n' +
      '      // The Service Binding is provided by the parent Worker and allows secure MCP access\n' +
      '      // without requiring fetch() - enabling true network isolation (globalOutbound: null)\n' +
      '      // Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/\n' +
      '      const mcpBinding = {\n' +
      mcpBindingStubs +
      '\n' +
      '      };\n' +
      '\n' +
      '      // Create MCP proxy to track calls and tool names\n' +
      '      // Also provide better error messages when a tool is not found\n' +
      '      const mcp = new Proxy(mcpBinding, {\n' +
      '        get(target, prop) {\n' +
      '          const original = target[prop];\n' +
      "          if (typeof original === 'function') {\n" +
      '            return async (...args) => {\n' +
      '              mcpCallCount++;\n' +
      '              toolsCalled.add(String(prop));\n' +
      '              return await original.apply(target, args);\n' +
      '            };\n' +
      '          }\n' +
      '          // Tool not found - provide helpful error message\n' +
      "          // Skip special properties like 'then' (for await) and Symbol properties\n" +
      "          if (prop !== 'then' && typeof prop !== 'symbol') {\n" +
      "            const availableTools = Object.keys(target).join(', ');\n" +
      '            throw new Error(`Tool "${String(prop)}" not found. Available tools: ${availableTools || \'none\'}`);\n' +
      '          }\n' +
      '          return original;\n' +
      '        },\n' +
      '      });\n' +
      '\n' +
      '      // Execute the user-provided code\n' +
      '      // The user code is embedded directly in this Worker module as executable statements\n' +
      '      // Each execution gets a fresh Worker isolate via Worker Loader API\n' +
      '      // Note: Function constructor and eval() are disallowed in Workers (CSP), so code must be embedded directly\n' +
      '      const executeWithTimeout = async () => {\n' +
      "        // User code is embedded below - it has access to 'mcp' and 'env'\n" +
      '        // fetch() is our wrapped version (set at module level)\n' +
      '        // User code embedded below\n' +
      userCode +
      '\n' +
      '      };\n' +
      '\n' +
      '      const timeoutPromise = new Promise((_, reject) => \n' +
      "        setTimeout(() => reject(new Error('Execution timeout')), timeout)\n" +
      '      );\n' +
      '\n' +
      '      result = await Promise.race([executeWithTimeout(), timeoutPromise]);\n' +
      '\n' +
      '      return new Response(JSON.stringify({\n' +
      '        success: true,\n' +
      "        output: logs.join('\\\\n'),\n" +
      '        result: result !== undefined ? result : null,\n' +
      '        metrics: {\n' +
      '          mcp_calls_made: mcpCallCount,\n' +
      '          tools_called: Array.from(toolsCalled),\n' +
      '        },\n' +
      '      }), {\n' +
      "        headers: { 'Content-Type': 'application/json' },\n" +
      '      });\n' +
      '    } catch (error) {\n' +
      '      return new Response(JSON.stringify({\n' +
      '        success: false,\n' +
      '        error: error.message,\n' +
      '        stack: error.stack,\n' +
      "        output: logs.join('\\\\n'),\n" +
      '        metrics: {\n' +
      '          mcp_calls_made: mcpCallCount,\n' +
      '          tools_called: Array.from(toolsCalled),\n' +
      '        },\n' +
      '      }), {\n' +
      '        status: 500,\n' +
      "        headers: { 'Content-Type': 'application/json' },\n" +
      '      });\n' +
      '    } finally {\n' +
      '      // Restore console methods\n' +
      '      console.log = originalLog;\n' +
      '      console.error = originalError;\n' +
      '      console.warn = originalWarn;\n' +
      '    }\n' +
      '  }\n' +
      '};\n'

    return {
      compatibilityDate: '2025-06-01',
      mainModule: 'worker.js',
      modules: {
        'worker.js': workerScript,
      },
      env: {
        // MCP_ID and MCP_RPC_URL are used by the parent Worker to create the Service Binding
        // The parent Worker will replace these with the actual Service Binding (env.MCP)
        MCP_ID: mcpId,
        MCP_RPC_URL: rpcUrl,
        // NETWORK_ENABLED flag tells parent Worker to create FetchProxy as globalOutbound
        // The allowlist itself is passed via headers from the dynamic worker
        NETWORK_ENABLED: networkEnabled ? 'true' : 'false',
      },
      // Network isolation configuration:
      // - null: Complete isolation - fetch() will not be available (default)
      // - FetchProxy: Controlled access - parent Worker sets globalOutbound to FetchProxy
      //
      // The parent Worker (runtime.ts) will override this with FetchProxy when NETWORK_ENABLED=true.
      // FetchProxy enforces the allowlist and proxies allowed requests.
      // When NETWORK_ENABLED=false, globalOutbound stays null (no fetch).
      // MCP access is always provided via Service Binding (env.MCP) regardless of network config.
      globalOutbound: null,
    }
  }

  private async executeInIsolate(
    mcpId: string,
    code: string,
    timeoutMs: number,
    instance: MCPInstance,
  ): Promise<{
    output: string
    result?: unknown
    metrics?: ExecutionResult['metrics']
  }> {
    // If we've already determined Wrangler is unavailable, throw error immediately
    if (this.wranglerAvailable === false) {
      throw new WorkerError(
        'Wrangler is required for Worker execution but is not available.\n' +
          'Please install Wrangler to enable code execution in isolated Worker environments:\n' +
          '  npm install -g wrangler\n' +
          '  or ensure npx can access wrangler: npx wrangler --version',
      )
    }

    // Try to use Wrangler Worker Loader API
    // Wrangler provides the actual Cloudflare Worker isolation environment
    try {
      return await this.executeWithWrangler(mcpId, code, timeoutMs, instance)
    } catch (error: unknown) {
      // Check if this is a "Wrangler not found" error (ENOENT from spawn)
      // Only catch actual spawn ENOENT errors, not Wrangler execution errors
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorCode = (error as NodeJS.ErrnoException)?.code

      // More specific detection: only ENOENT errors that mention spawn or the command
      const isSpawnENOENT =
        errorCode === 'ENOENT' ||
        (errorMessage.includes('ENOENT') &&
          (errorMessage.includes('spawn') ||
            errorMessage.includes('Failed to spawn') ||
            errorMessage.includes('npx') ||
            errorMessage.includes('npx.cmd')))

      // If Wrangler spawn failed (command not found), mark as unavailable
      if (isSpawnENOENT && this.wranglerAvailable === null) {
        this.wranglerAvailable = false
        logger.error(
          { mcpId, error: errorMessage, errorCode },
          'Wrangler spawn failed - command not found',
        )
        throw new WorkerError(
          'Wrangler is required for Worker execution but is not available.\n' +
            'Wrangler provides the Cloudflare Worker isolation environment needed for safe code execution.\n' +
            'Please install Wrangler:\n' +
            '  npm install -g wrangler\n' +
            '  or ensure npx can access wrangler: npx wrangler --version\n\n' +
            `Error details: ${errorMessage}`,
        )
      }

      // For other errors (e.g., build errors, timeout, path errors), re-throw
      // These are actual execution failures, not availability issues
      logger.error(
        { mcpId, error: errorMessage, errorCode, isSpawnENOENT },
        'Wrangler execution error (not spawn failure)',
      )
      throw error
    }
  }

  /**
   * Determine the correct Worker runtime entry point based on environment
   * Checks once and caches the result (includes one-time file existence check)
   *
   * TODO: Once we see the logged absolute path, hardcode it here to remove file system checks
   *
   * Detection priority:
   * 1. NODE_ENV environment variable (set to 'development' in MCP config for dev mode)
   * 2. Process argv detection (running via tsx)
   * 3. Default to production (dist/worker/runtime.js)
   */
  private getWorkerEntryPoint(): string {
    // Return cached value if already determined
    if (this.cachedWorkerEntryPoint !== null) {
      return this.cachedWorkerEntryPoint
    }

    const cwd = process.cwd()

    // Check NODE_ENV (can be set in MCP config: env: { NODE_ENV: 'development' })
    const nodeEnv = process.env.NODE_ENV
    const isNodeEnvDev = nodeEnv === 'development'
    const isNodeEnvProd = nodeEnv === 'production'

    // Lightweight detection: check if running via tsx
    const isRunningViaTsx =
      process.argv[1]?.includes('tsx') ||
      process.argv[0]?.includes('tsx') ||
      process.argv[1]?.includes('src/server/index.ts') ||
      process.argv[1]?.includes('src\\server\\index.ts')

    // Determine if we're in dev mode
    const isDevMode = isNodeEnvDev || (!isNodeEnvProd && isRunningViaTsx)

    // Check which file actually exists (one-time check, then cached)
    const devPath = join(cwd, 'src', 'worker', 'runtime.ts')
    const prodPath = join(cwd, 'dist', 'worker', 'runtime.js')
    const devExists = existsSync(devPath)
    const prodExists = existsSync(prodPath)

    // Determine entry point: prefer dev if in dev mode and file exists, otherwise use prod if exists
    let entryPoint: string
    if (isDevMode && devExists) {
      entryPoint = 'src/worker/runtime.ts'
    } else if (prodExists) {
      entryPoint = 'dist/worker/runtime.js'
    } else if (isDevMode) {
      // Dev mode but file doesn't exist - use dev path anyway (might be path issue)
      entryPoint = 'src/worker/runtime.ts'
      logger.warn(
        { devPath, prodPath, cwd },
        'Dev entry point file not found, using dev path anyway',
      )
    } else {
      // Production mode but file doesn't exist - use prod path anyway
      entryPoint = 'dist/worker/runtime.js'
      logger.warn(
        { devPath, prodPath, cwd },
        'Production entry point file not found, using prod path anyway',
      )
    }

    // Cache the result
    this.cachedWorkerEntryPoint = entryPoint

    logger.info(
      {
        entryPoint,
        isDevMode,
        nodeEnv,
        isRunningViaTsx,
        devExists,
        prodExists,
        cwd,
      },
      'Determined Worker entry point (cached)',
    )

    return entryPoint
  }

  private async executeWithWrangler(
    mcpId: string,
    code: string,
    timeoutMs: number,
    instance: MCPInstance,
  ): Promise<{
    output: string
    result?: unknown
    metrics?: ExecutionResult['metrics']
  }> {
    // Initialize progress indicator (declare outside try for catch access)
    const progress = new ProgressIndicator()
    const isCLIMode = process.env.CLI_MODE === 'true'

    let wranglerProcess: ChildProcess | null = null
    const port = Math.floor(Math.random() * 10000) + 20000 // Random port 20000-29999

    // Collect stdout/stderr for debugging (declare outside try block for catch access)
    let wranglerStdout = ''
    let wranglerStderr = ''

    try {
      // Step 1: Our MCP - Generate worker code with user code embedded
      if (isCLIMode) {
        progress.updateStep(0, 'running')
      }
      const isolationConfig = getIsolationConfigForMCP(instance.mcp_name)
      const workerCode = await this.generateWorkerCode(
        mcpId,
        instance.tools,
        instance.typescript_api,
        code,
        isolationConfig,
      )

      // Determine npx command based on platform
      const isWindows = process.platform === 'win32'
      const npxCmd = isWindows ? 'npx.cmd' : 'npx'

      // Step 1 complete: Our MCP
      if (isCLIMode) {
        progress.updateStep(0, 'success')
      }

      // Step 2: Wrangler - Start dev server for parent Worker
      if (isCLIMode) {
        progress.updateStep(1, 'running')
      }
      logger.debug(
        { mcpId, port },
        'Starting Wrangler dev server for parent Worker',
      )

      // Determine the correct entry point based on environment (dev vs prod)
      const baseEntryPoint = this.getWorkerEntryPoint()

      // CRITICAL: Always use project root as CWD when spawning Wrangler
      // Test script showed that relative paths only work when CWD is the project root
      // When MCP server runs from a different directory, process.cwd() won't be the project root
      const wranglerCwd = this.projectRoot || process.cwd()
      const entryPointPath = resolve(wranglerCwd, baseEntryPoint)
      const entryPointExists = existsSync(entryPointPath)

      // Use relative path from project root (test showed this works when CWD is project root)
      const entryPointForWrangler = baseEntryPoint

      logger.info(
        {
          mcpId,
          port,
          baseEntryPoint,
          entryPointForWrangler,
          wranglerCwd,
          entryPointPath,
          entryPointExists,
          actualCwd: process.cwd(),
          projectRoot: this.projectRoot,
        },
        'Spawning Wrangler - using project root as CWD',
      )

      // Verify the entry point exists before spawning
      if (!entryPointExists) {
        const error = new Error(
          `Worker entry point not found at project root.\n` +
            `  - Project root: ${wranglerCwd}\n` +
            `  - Entry point: ${baseEntryPoint}\n` +
            `  - Full path: ${entryPointPath}\n` +
            `  - Exists: ${entryPointExists}`,
        )
        logger.error(
          { error, wranglerCwd, baseEntryPoint, entryPointPath },
          'Entry point not found',
        )
        throw error
      }

      // Build Wrangler command args
      // Pass entry point directly on command line - wrangler.toml only needs worker_loaders binding
      const wranglerArgs: string[] = [
        'wrangler',
        'dev',
        entryPointForWrangler,
        '--local',
        '--port',
        port.toString(),
      ]

      // Spawn Wrangler process
      // Note: spawn doesn't throw synchronously - errors come through 'error' event
      wranglerProcess = spawn(npxCmd, wranglerArgs, {
        cwd: wranglerCwd, // CRITICAL: Use project root, not process.cwd()
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,
      })

      // Handle spawn errors (e.g., npx/wrangler not found)
      // This is different from Wrangler execution errors (which come through stderr)
      let spawnError: Error | null = null
      let errorHandled = false
      wranglerProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (errorHandled) return // Prevent double handling
        spawnError = error
        errorHandled = true
        logger.error(
          {
            error: error.message,
            code: error.code,
            command: npxCmd,
            args: wranglerArgs,
            cwd: wranglerCwd,
          },
          'Wrangler spawn error - command may not be found',
        )
      })

      // Track Wrangler process for cleanup
      if (wranglerProcess?.pid) {
        this.wranglerProcesses.add(wranglerProcess)

        logger.info(
          {
            pid: wranglerProcess.pid,
            port,
            mcpId,
            command: npxCmd,
            args: wranglerArgs,
          },
          `Wrangler process spawned: PID ${wranglerProcess.pid} on port ${port}`,
        )

        // Remove from tracking set when process exits
        const trackedProcess = wranglerProcess
        trackedProcess.on('exit', (code, signal) => {
          this.wranglerProcesses.delete(trackedProcess)
          logger.debug(
            { pid: trackedProcess.pid, code, signal },
            'Wrangler process exited',
          )
        })
      }

      if (wranglerProcess?.stdout) {
        wranglerProcess.stdout.on('data', (data: Buffer) => {
          const output = data.toString()
          wranglerStdout += output
          logger.debug({ output }, 'Wrangler stdout')
        })
      }

      if (wranglerProcess?.stderr) {
        wranglerProcess.stderr.on('data', (data: Buffer) => {
          const output = data.toString()
          wranglerStderr += output
          logger.debug({ output }, 'Wrangler stderr')
        })
      }

      // Wait for Wrangler to be ready
      await new Promise<void>((resolve, reject) => {
        // Check if spawn failed immediately (e.g., command not found)
        if (spawnError) {
          const spawnErrnoError = spawnError as NodeJS.ErrnoException
          const isENOENT =
            spawnErrnoError.code === 'ENOENT' ||
            spawnError.message.includes('ENOENT')
          if (isENOENT) {
            reject(
              new Error(
                `Failed to spawn Wrangler: ${spawnError.message}\n` +
                  `Command: ${npxCmd} ${wranglerArgs.join(' ')}\n` +
                  `This usually means npx or wrangler is not installed or not in PATH.`,
              ),
            )
            return
          }
          // Other spawn errors - still reject but don't classify as "not found"
          reject(spawnError)
          return
        }

        const timeout = setTimeout(() => {
          const error = new Error(
            'Wrangler dev server failed to start within 10 seconds',
          )
          reject(error)
        }, 10000)

        let ready = false
        let checkCount = 0
        const maxChecks = 50

        const checkReady = async () => {
          checkCount++
          try {
            const response = await fetch(`http://localhost:${port}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workerId: `mcp-${mcpId}-${Date.now()}`,
                workerCode: {
                  compatibilityDate: '2025-06-01',
                  mainModule: 'test.js',
                  modules: {
                    'test.js':
                      'export default { fetch: () => new Response("ok") }',
                  },
                },
                executionRequest: { code: '// health check', timeout: 1000 },
              }),
              signal: AbortSignal.timeout(500),
            })
            if (response.ok || response.status === 500) {
              ready = true
              clearTimeout(timeout)
              if (isCLIMode) {
                progress.updateStep(1, 'success')
              }
              resolve()
            } else if (checkCount < maxChecks) {
              setTimeout(checkReady, 200)
            }
          } catch (error: unknown) {
            if (
              checkCount < maxChecks &&
              !(error instanceof Error && error.name?.includes('AbortError'))
            ) {
              setTimeout(checkReady, 200)
            } else if (checkCount >= maxChecks) {
              clearTimeout(timeout)
              const errorMessage =
                error instanceof Error ? error.message : 'Unknown error'
              const healthCheckError = new Error(
                `Wrangler health check failed after ${maxChecks} attempts. Last error: ${errorMessage}`,
              )
              reject(healthCheckError)
            }
          }
        }

        setTimeout(checkReady, 1000)

        if (wranglerProcess?.stdout) {
          wranglerProcess.stdout.on('data', (data: Buffer) => {
            const output = data.toString()
            if (
              (output.includes('Ready') ||
                output.includes('ready') ||
                output.includes('Listening')) &&
              !ready
            ) {
              ready = true
              clearTimeout(timeout)
              if (isCLIMode) {
                progress.updateStep(1, 'success')
              }
              setTimeout(() => resolve(), 500)
            }
          })
        }

        // Handle process errors (including spawn errors that fire after Promise starts)
        wranglerProcess?.on('error', (error: NodeJS.ErrnoException) => {
          if (errorHandled) return // Already handled by spawnError handler
          errorHandled = true
          clearTimeout(timeout)
          // Check if this is a spawn ENOENT error (command not found)
          const isENOENT =
            error.code === 'ENOENT' || error.message.includes('ENOENT')
          if (isENOENT) {
            reject(
              new Error(
                `Failed to spawn Wrangler: ${error.message}\n` +
                  `Command: ${npxCmd} ${wranglerArgs.join(' ')}\n` +
                  `This usually means npx or wrangler is not installed or not in PATH.`,
              ),
            )
          } else {
            reject(new Error(`Wrangler process error: ${error.message}`))
          }
        })

        wranglerProcess?.on('exit', (code, signal) => {
          if (!ready && code !== null && code !== 0) {
            clearTimeout(timeout)
            const hasBuildError =
              wranglerStderr.includes('Build failed') ||
              wranglerStderr.includes('build failed') ||
              wranglerStderr.includes('✗ Build failed')
            const hasWorkerLoadersError =
              wranglerStderr.includes('worker_loaders') ||
              wranglerStdout.includes('worker_loaders')

            if (hasWorkerLoadersError) {
              const error = new Error(
                'Worker Loader API configuration error. The "worker_loaders" field may not be supported in your Wrangler version.\n' +
                  'Please ensure you have Wrangler 3.50.0 or later, or check the Wrangler documentation for the correct configuration format.\n' +
                  'Error details: ' +
                  (wranglerStderr || wranglerStdout)
                    .split('\n')
                    .find((line) => line.includes('worker_loaders')) ||
                  'Unknown error',
              )
              const buildError = error as BuildError
              buildError.isBuildError = true
              reject(buildError)
            } else if (hasBuildError) {
              const error = new Error(
                'TypeScript compilation failed. Check the error details below.',
              ) as BuildError
              error.isBuildError = true
              reject(error)
            } else {
              const error = new Error(
                `Wrangler process exited with code ${code} (signal: ${signal})`,
              ) as Error & { code?: number; signal?: string | null }
              error.code = code ?? undefined
              error.signal = signal ?? undefined
              reject(error)
            }
          }
        })
      })

      // Step 3: Target MCP - Execute code via Worker Loader API
      if (isCLIMode) {
        progress.updateStep(2, 'running')
      }
      logger.debug(
        { mcpId, codeLength: code.length },
        'Executing code via Worker Loader API',
      )

      // Generate a unique worker ID for this execution
      // Using hash of code + mcpId to enable caching when same code is executed
      const workerId = `mcp-${mcpId}-${createHash('sha256').update(`${mcpId}-${code}`).digest('hex').substring(0, 16)}`

      const response = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId,
          workerCode,
          executionRequest: {
            code,
            timeout: timeoutMs,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (isCLIMode) {
          progress.updateStep(2, 'failed')
          progress.showFinal(2)
        }
        throw new Error(
          `Worker execution failed: ${response.status} ${errorText}`,
        )
      }

      const result = (await response.json()) as {
        success: boolean
        output?: string
        result?: unknown
        error?: string
        metrics?: {
          mcp_calls_made: number
        }
      }

      // Clean up - wait for process to terminate on Windows
      if (wranglerProcess) {
        await this.killWranglerProcess(wranglerProcess)
        wranglerProcess = null
      }

      // Step 3 complete: Target MCP execution successful
      if (isCLIMode) {
        progress.updateStep(2, 'success')
        progress.showFinal()
      }

      const metrics: ExecutionResult['metrics'] = result.metrics
        ? {
            mcp_calls_made: result.metrics.mcp_calls_made ?? 0,
            tools_called: (result.metrics as ExecutionResult['metrics'])
              .tools_called,
          }
        : {
            mcp_calls_made: 0,
          }

      return {
        output: result.output || '',
        result: result.result,
        metrics,
      }
    } catch (error: unknown) {
      // Determine which step failed
      let failedStep = -1
      const isCLIMode = process.env.CLI_MODE === 'true'
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorIsBuildError =
        (error as { isBuildError?: boolean })?.isBuildError === true

      if (isCLIMode) {
        // Check for build/compilation errors first (these happen during Wrangler phase)
        const hasWorkerLoadersError =
          (wranglerStderr?.includes('worker_loaders') ||
            wranglerStdout?.includes('worker_loaders') ||
            errorMessage.includes('worker_loaders')) ??
          false
        const hasBuildError =
          wranglerStderr.includes('Build failed') ||
          wranglerStderr.includes('build failed') ||
          wranglerStderr.includes('✗ Build failed') ||
          errorMessage.includes('TypeScript compilation failed') ||
          errorMessage.includes('compilation failed') ||
          errorIsBuildError

        // Check error message to determine failure point
        if (
          hasWorkerLoadersError ||
          hasBuildError ||
          errorMessage.includes('Wrangler process') ||
          errorMessage.includes('Wrangler dev server') ||
          errorMessage.includes('health check') ||
          errorMessage.includes('Wrangler process exited')
        ) {
          failedStep = 1 // Wrangler failed (build or startup)
          progress.updateStep(1, 'failed')
        } else if (
          errorMessage.includes('Worker execution failed') ||
          errorMessage.includes('execute') ||
          (errorMessage.includes('fetch') && errorMessage.includes('localhost'))
        ) {
          failedStep = 2 // Target MCP execution failed
          progress.updateStep(2, 'failed')
        } else {
          failedStep = 0 // Our MCP failed (unlikely but possible)
          progress.updateStep(0, 'failed')
        }
        progress.showFinal(failedStep)
      }

      // Format and display the error nicely
      // Include user code in context for build errors to help with troubleshooting
      const context: ErrorContext = {
        mcpId,
        port,
      }

      // Add user code to context if it's a build error (helps with troubleshooting)
      const isWorkerLoadersError =
        wranglerStderr?.includes('worker_loaders') ||
        wranglerStdout?.includes('worker_loaders')
      const isBuildError =
        wranglerStderr?.includes('Build failed') ||
        wranglerStderr?.includes('build failed') ||
        wranglerStderr?.includes('✗ Build failed')
      if ((isBuildError || isWorkerLoadersError) && code) {
        context.userCode = code
      }

      console.error(
        '\n' +
          formatWranglerError(
            error instanceof Error ? error : new Error(String(error)),
            wranglerStdout || '',
            wranglerStderr || '',
            context,
          ) +
          '\n',
      )

      // Only log to structured logger in non-CLI mode or verbose mode
      // In CLI mode, the formatted error above is sufficient
      const isVerbose =
        process.argv.includes('--verbose') || process.argv.includes('-v')
      if (!isCLIMode || isVerbose) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error(
          {
            error: errorMsg,
            stack: errorStack,
            mcpId,
            port,
          },
          'Wrangler execution error',
        )
      }

      // Clean up on error - wait for process to terminate
      if (wranglerProcess) {
        await this.killWranglerProcess(wranglerProcess)
      }

      // Include Wrangler output in error details for debugging
      // Mark as fatal - Wrangler execution failures prevent code execution entirely
      throw new WorkerError(`Wrangler execution failed: ${errorMessage}`, {
        wrangler_stdout: wranglerStdout || '',
        wrangler_stderr: wranglerStderr || '',
        exit_code: (error as { code?: number })?.code,
        mcp_id: mcpId,
        port,
        fatal: true, // Wrangler failures are fatal - cannot execute code without Worker runtime
      })
    }
  }

  /**
   * Kill a process and all its children (process tree)
   * On Windows, uses taskkill to kill the process tree
   * On Unix, uses SIGTERM/SIGKILL with process group
   */
  private async killProcessTree(pid: number): Promise<void> {
    if (!pid) {
      return
    }

    return new Promise<void>((resolve) => {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to kill the process tree
        // /F = force kill, /T = kill child processes, /PID = process ID
        exec(`taskkill /F /T /PID ${pid}`, () => {
          // Ignore errors - process might already be dead
          resolve()
        })
      } else {
        // On Unix, try SIGTERM first, then SIGKILL
        // Use process group to kill children
        try {
          process.kill(-pid, 'SIGTERM')
          setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL')
            } catch {
              // Process might already be dead
            }
            resolve()
          }, 1000)
        } catch {
          // Process might already be dead
          resolve()
        }
      }
    })
  }

  /**
   * Kill a Wrangler process and wait for it to terminate
   * Wrangler spawns child processes, so we need to kill the entire process tree
   */
  private async killWranglerProcess(proc: ChildProcess): Promise<void> {
    if (!proc || proc.killed) {
      return
    }

    const pid = proc.pid
    if (!pid) {
      return
    }

    logger.info({ pid }, `Killing Wrangler process tree: PID ${pid}`)

    // Remove from tracking set
    this.wranglerProcesses.delete(proc)

    // Kill the process tree (including child processes)
    await this.killProcessTree(pid)

    // Also try the standard kill method as a fallback
    try {
      proc.kill('SIGTERM')
    } catch {
      // Process might already be dead
    }

    // Wait for process to fully terminate
    await new Promise<void>((resolve) => {
      if (proc.killed) {
        resolve()
        return
      }

      proc.on('exit', () => resolve())

      // Force kill after 3 seconds if it doesn't exit
      setTimeout(() => {
        if (proc && !proc.killed && proc.pid) {
          try {
            // Try killing the tree again with SIGKILL
            this.killProcessTree(proc.pid).catch(() => {
              // Ignore errors
            })
          } catch {
            // Process might already be dead
          }
        }
        resolve()
      }, 3000)
    })
  }

  /**
   * Kill an MCP process and wait for it to terminate
   * MCP processes might also spawn children, so kill the process tree
   */
  private async killMCPProcess(proc: ChildProcess): Promise<void> {
    if (!proc || proc.killed) {
      return
    }

    const pid = proc.pid
    if (!pid) {
      return
    }

    logger.info({ pid }, `Killing MCP process tree: PID ${pid}`)

    // Kill the process tree (in case MCP spawned children)
    await this.killProcessTree(pid)

    // Also try the standard kill method as a fallback
    try {
      proc.kill('SIGTERM')
    } catch {
      // Process might already be dead
    }

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      if (proc.killed) {
        resolve()
        return
      }

      proc.on('exit', () => resolve())
      setTimeout(() => {
        if (proc && !proc.killed && proc.pid) {
          try {
            // Try killing the tree again with SIGKILL
            this.killProcessTree(proc.pid).catch(() => {
              // Ignore errors
            })
          } catch {
            // Process might already be dead
          }
        }
        resolve()
      }, 2000)
    })
  }

  /**
   * Clean up all resources (RPC server, MCP clients, processes)
   * Called during graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.debug('Shutting down WorkerManager...')

    // Close RPC server
    if (this.rpcServer) {
      await new Promise<void>((resolve) => {
        this.rpcServer?.close(() => {
          logger.debug('RPC server closed')
          resolve()
        })
        // Force close after 2 seconds
        setTimeout(() => {
          resolve()
        }, 2000)
      })
      this.rpcServer = null
    }

    // Close all MCP clients and kill processes
    const cleanupPromises: Promise<void>[] = []
    for (const [mcpId, client] of this.mcpClients.entries()) {
      cleanupPromises.push(
        (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clientWithTransport = client as unknown as {
              _transport?: { close?: () => Promise<void> }
            }
            const transport = clientWithTransport._transport
            if (transport && typeof transport.close === 'function') {
              await transport.close()
            }
          } catch (error: unknown) {
            logger.warn({ error, mcpId }, 'Error closing MCP client')
          }
        })(),
      )
    }

    // Kill all MCP processes
    for (const [mcpId, proc] of this.mcpProcesses.entries()) {
      cleanupPromises.push(
        (async () => {
          try {
            await this.killMCPProcess(proc)
          } catch (error: unknown) {
            logger.warn({ error, mcpId }, 'Error killing MCP process')
          }
        })(),
      )
    }

    // Kill all Wrangler processes
    const wranglerProcesses = Array.from(this.wranglerProcesses)
    for (const proc of wranglerProcesses) {
      cleanupPromises.push(
        (async () => {
          try {
            await this.killWranglerProcess(proc)
          } catch (error: unknown) {
            logger.warn({ error }, 'Error killing Wrangler process')
          }
        })(),
      )
    }

    // Wait for all cleanup to complete (with timeout)
    await Promise.race([
      Promise.all(cleanupPromises),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])

    // Clear all maps
    this.mcpClients.clear()
    this.mcpProcesses.clear()
    this.wranglerProcesses.clear()
    this.instances.clear()
    this.schemaCache.clear()

    logger.debug('WorkerManager shutdown complete')
  }
}
