import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  type ExecuteCodeRequest,
  ExecuteCodeRequestSchema,
  type JSONSchemaProperty,
  LoadMCPRequestSchema,
  type MCPConfig,
  type MCPInstance,
  type MCPTool,
} from '../types/mcp.js'
import { ConfigManager } from '../utils/config-manager.js'
import { MCPConnectionError, MCPIsolateError } from '../utils/errors.js'
import logger from '../utils/logger.js'
import { validateInput, validateTypeScriptCode } from '../utils/validation.js'
import { MetricsCollector } from './metrics-collector.js'
import { WorkerManager } from './worker-manager.js'

export class MCPHandler {
  private server: Server
  private workerManager: WorkerManager
  private metricsCollector: MetricsCollector
  private configManager: ConfigManager
  // Cache for discovered MCP tools (for transparent proxy mode)
  private discoveredMCPTools: Map<string, MCPTool[]> = new Map()

  constructor() {
    this.server = new Server(
      {
        name: 'mcpguard',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.workerManager = new WorkerManager()
    this.metricsCollector = new MetricsCollector()
    this.configManager = new ConfigManager()

    this.setupHandlers()
  }

  /**
   * Namespace a tool name with its MCP name
   * Format: {mcpName}::{toolName}
   */
  private namespaceToolName(mcpName: string, toolName: string): string {
    return `${mcpName}::${toolName}`
  }

  /**
   * Parse a namespaced tool name back to MCP name and tool name
   * Returns null if not namespaced
   */
  private parseToolNamespace(
    namespacedName: string,
  ): { mcpName: string; toolName: string } | null {
    const parts = namespacedName.split('::')
    if (parts.length === 2) {
      return { mcpName: parts[0], toolName: parts[1] }
    }
    return null
  }

  /**
   * Discover all configured MCPs from IDE config
   * Returns map of MCP name to config and status
   */
  private async discoverConfiguredMCPs(): Promise<
    Map<
      string,
      {
        config: MCPConfig
        source: 'cursor' | 'claude-code' | 'github-copilot'
        status: 'active' | 'disabled'
      }
    >
  > {
    const allMCPs = this.configManager.getAllConfiguredMCPs()
    const mcpMap = new Map<
      string,
      {
        config: MCPConfig
        source: 'cursor' | 'claude-code' | 'github-copilot'
        status: 'active' | 'disabled'
      }
    >()

    for (const [name, entry] of Object.entries(allMCPs)) {
      mcpMap.set(name, entry)
    }

    return mcpMap
  }

  /**
   * Ensure MCP tools are loaded for a specific MCP (lazy loading)
   * Only loads if not already loaded
   */
  private async ensureMCPToolsLoaded(mcpName: string): Promise<void> {
    // If already loaded, skip
    if (this.discoveredMCPTools.has(mcpName)) {
      return
    }

    // Load this specific MCP's tools
    const configuredMCPs = await this.discoverConfiguredMCPs()
    const entry = configuredMCPs.get(mcpName)
    if (!entry) {
      return // MCP not configured
    }

    try {
      // Resolve environment variables
      const resolvedConfig = this.configManager.resolveEnvVarsInObject(
        entry.config,
      ) as MCPConfig

      // Load schema only (no process spawn)
      const tools = await this.workerManager.loadMCPSchemaOnly(
        mcpName,
        resolvedConfig,
      )

      if (tools.length > 0) {
        this.discoveredMCPTools.set(mcpName, tools)
        logger.debug(
          { mcpName, toolCount: tools.length },
          'Lazy-loaded MCP tools for transparent proxy',
        )
      }
    } catch (error: unknown) {
      logger.warn(
        { error, mcpName },
        'Failed to lazy-load MCP tools for transparent proxy',
      )
      // Don't throw - just log and continue
    }
  }

  /**
   * Load tool schemas from all configured MCPs (for transparent proxy)
   * Uses hybrid loading: schemas eagerly, processes lazily
   * NOTE: This is NOT called by default for efficiency - tools are loaded lazily instead
   */
  private async loadAllMCPTools(): Promise<void> {
    const configuredMCPs = await this.discoverConfiguredMCPs()

    // Load schemas for all configured MCPs in parallel
    const schemaPromises = Array.from(configuredMCPs.entries()).map(
      async ([mcpName, entry]) => {
        try {
          // Resolve environment variables
          const resolvedConfig = this.configManager.resolveEnvVarsInObject(
            entry.config,
          ) as MCPConfig

          // Load schema only (no process spawn)
          const tools = await this.workerManager.loadMCPSchemaOnly(
            mcpName,
            resolvedConfig,
          )

          if (tools.length > 0) {
            this.discoveredMCPTools.set(mcpName, tools)
            logger.debug(
              { mcpName, toolCount: tools.length },
              'Loaded MCP tools for transparent proxy',
            )
          }
        } catch (error: unknown) {
          logger.warn(
            { error, mcpName },
            'Failed to load MCP tools for transparent proxy',
          )
          // Continue with other MCPs even if one fails
        }
      },
    )

    await Promise.allSettled(schemaPromises)
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing available tools')

      // DO NOT eagerly load all MCP tools - this defeats token efficiency!
      // Instead, load schemas lazily when tools are actually called via transparent proxy
      // This way, the IDE only sees MCPGuard's tools in the context window
      // Individual MCP tools are loaded on-demand when execute_code is used or
      // when a namespaced tool (e.g., github::search_repositories) is called
      // await this.loadAllMCPTools() // DISABLED for efficiency

      // Start with MCPGuard's own tools
      const mcpGuardTools = [
        {
          name: 'load_mcp_server',
          description:
            'Manually load an MCP server into a secure isolated Worker environment for code mode execution. Usually not needed - execute_code will auto-load MCPs when needed. Use this if you need to pre-load an MCP or load with a custom configuration. Can use a saved configuration or load with a new configuration. Automatically saves the configuration unless auto_save is false.',
          inputSchema: {
            type: 'object',
            properties: {
              mcp_name: {
                type: 'string',
                description:
                  'Unique identifier for this MCP instance (alphanumeric, hyphens, underscores only)',
              },
              mcp_config: {
                type: 'object',
                description:
                  'MCP server connection configuration. Required if use_saved is false. Can use $' +
                  '{VAR_NAME} syntax for environment variables.',
                properties: {
                  command: {
                    type: 'string',
                    description:
                      'Command to launch the MCP server (e.g., "npx", "node", "python")',
                  },
                  args: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Arguments for the MCP server command',
                  },
                  env: {
                    type: 'object',
                    description:
                      'Environment variables for the MCP server. Use $' +
                      '{VAR_NAME} syntax to reference .env variables.',
                  },
                },
                required: ['command'],
              },
              use_saved: {
                type: 'boolean',
                description:
                  'If true, load configuration from saved configs instead of using mcp_config. Default: false',
                default: false,
              },
              auto_save: {
                type: 'boolean',
                description:
                  'If true, automatically save the configuration after loading. Default: true',
                default: true,
              },
            },
            required: ['mcp_name'],
          },
        },
        {
          name: 'execute_code',
          description: `PRIMARY tool for interacting with MCPs. Auto-loads MCPs from IDE config if needed. Use this instead of calling MCP tools directly. All MCP operations should go through this tool for secure isolation and efficiency.

The executed code receives two parameters:
1. 'mcp' - An object containing all available MCP tools as async functions
2. 'env' - Worker environment variables (contains MCP_ID and other bindings)

Usage pattern:
- Call MCP tools: await mcp.toolName({ param1: value1, param2: value2 })
- Output results: console.log(JSON.stringify(result, null, 2))
- Handle errors: try/catch blocks around MCP calls
- Chain operations: const result1 = await mcp.tool1({...}); const result2 = await mcp.tool2({...})

Example:
\`\`\`typescript
// Search for repositories (MCP auto-loads if not already loaded)
const repos = await mcp.search_repositories({ query: 'typescript', page: 1 });
console.log('Found repositories:', JSON.stringify(repos, null, 2));

// Create an issue
const issue = await mcp.create_issue({
  owner: 'owner',
  repo: 'repo',
  title: 'New Issue',
  body: 'Issue description'
});
console.log('Created issue:', JSON.stringify(issue, null, 2));
\`\`\`

The 'mcp' object is automatically generated from the MCP's tool schema. Each tool is an async function that takes an input object matching the tool's inputSchema and returns a Promise with the tool's result.

Use console.log() to output results - all console output is captured and returned in the response.

IMPORTANT: Provide either mcp_name (to auto-load from IDE config) or mcp_id (if already loaded). Using mcp_name is recommended as it automatically loads the MCP when needed.`,
          inputSchema: {
            type: 'object',
            properties: {
              mcp_id: {
                type: 'string',
                description:
                  'UUID of the loaded MCP server (returned from load_mcp_server). Use if MCP is already loaded. Otherwise, use mcp_name to auto-load.',
              },
              mcp_name: {
                type: 'string',
                description:
                  'Name of the MCP server from IDE config (e.g., "github", "filesystem"). Auto-loads the MCP if not already loaded. Use search_mcp_tools to discover available MCPs.',
              },
              code: {
                type: 'string',
                description: `TypeScript code to execute. The code receives 'mcp' and 'env' as parameters.
                  
Example code structure:
\`\`\`typescript
// Access MCP tools via the 'mcp' parameter
const result = await mcp.toolName({ param: value });
console.log(JSON.stringify(result, null, 2));
\`\`\`

The code runs in an isolated Worker environment with no network access. All MCP communication happens through the 'mcp' binding object.`,
              },
              timeout_ms: {
                type: 'number',
                description:
                  'Execution timeout in milliseconds (default: 30000, max: 60000)',
                default: 30000,
              },
            },
            required: ['code'],
          },
        },
        {
          name: 'list_available_mcps',
          description:
            'List all MCP servers currently loaded in Worker isolates. Returns a list with MCP IDs, names, status, and tool counts. Use get_mcp_by_name to find a specific MCP by name. Note: MCPs are auto-loaded when execute_code is called with mcp_name, so this shows actively loaded MCPs.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_mcp_by_name',
          description:
            'Find a loaded MCP server by its name. Returns the MCP ID and basic information for quick lookup. This is more efficient than calling list_available_mcps and searching manually.',
          inputSchema: {
            type: 'object',
            properties: {
              mcp_name: {
                type: 'string',
                description:
                  'Name of the MCP server to find (the name used when loading the MCP)',
              },
            },
            required: ['mcp_name'],
          },
        },
        {
          name: 'get_mcp_schema',
          description:
            'Get the TypeScript API definition for a loaded MCP server',
          inputSchema: {
            type: 'object',
            properties: {
              mcp_id: {
                type: 'string',
                description: 'UUID of the loaded MCP server',
              },
            },
            required: ['mcp_id'],
          },
        },
        {
          name: 'unload_mcp_server',
          description:
            'Unload an MCP server and clean up its Worker isolate. Optionally remove from saved configurations.',
          inputSchema: {
            type: 'object',
            properties: {
              mcp_id: {
                type: 'string',
                description: 'UUID of the loaded MCP server to unload',
              },
              remove_from_saved: {
                type: 'boolean',
                description:
                  'If true, also remove the MCP configuration from the IDE config file (Claude Code or Cursor). Default: false',
                default: false,
              },
            },
            required: ['mcp_id'],
          },
        },
        {
          name: 'get_metrics',
          description:
            'Get performance metrics and statistics for MCP operations',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'import_cursor_mcps',
          description:
            'Refresh/import MCP configurations from IDE configuration file (Claude Code, GitHub Copilot, or Cursor). Automatically discovers config location or uses provided path. Checks IDEs in priority order.',
          inputSchema: {
            type: 'object',
            properties: {
              cursor_config_path: {
                type: 'string',
                description:
                  'Optional: Path to IDE config file. If not provided, will search default locations for Claude Code, GitHub Copilot, and Cursor.',
              },
            },
          },
        },
        {
          name: 'search_mcp_tools',
          description:
            'Search and discover MCP servers configured in your IDE. Returns all configured MCPs (except mcpguard) with their status and available tools. Use this to find which MCPs are available before calling execute_code. Implements the search_tools pattern for progressive disclosure - discover tools on-demand rather than loading all definitions upfront.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Optional search term to filter by MCP name or tool name. If not provided, returns all configured MCPs.',
              },
              detail_level: {
                type: 'string',
                enum: ['summary', 'tools', 'full'],
                description:
                  'Level of detail to return. summary: just MCP names and status. tools: includes tool names. full: includes full tool schemas (only for loaded MCPs). Default: summary',
                default: 'summary',
              },
            },
          },
        },
        {
          name: 'disable_mcps',
          description:
            'Disable MCP servers in your IDE configuration. This prevents the IDE from loading all their tools into the context window unnecessarily, maximizing efficiency and ensuring all tool calls route through MCPGuard\'s secure isolation. Can disable specific MCPs or all MCPs except mcpguard.',
          inputSchema: {
            type: 'object',
            properties: {
              mcp_names: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Array of MCP names to disable. If not provided or empty, disables all MCPs except mcpguard.',
              },
            },
          },
        },
      ]

      // Return only MCPGuard's own tools for efficiency
      // Individual MCP tools are loaded lazily when:
      // 1. execute_code is called with mcp_name (auto-loads that specific MCP)
      // 2. A namespaced tool is called (e.g., github::search_repositories) - loads that MCP on-demand
      // This ensures the IDE context window only contains MCPGuard's tools, not all MCP tools
      const aggregatedTools: Array<{
        name: string
        description: string
        inputSchema: {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      }> = [...mcpGuardTools]

      // Transparent proxy tools are NOT included in listTools for efficiency
      // They are loaded on-demand when actually called
      // This is the key efficiency gain: only load what you use!

      logger.debug(
        {
          mcpGuardToolsCount: mcpGuardTools.length,
          totalToolsCount: aggregatedTools.length,
          note: 'MCP tools are loaded lazily on-demand for efficiency',
        },
        'Returning MCPGuard tools (MCP tools loaded lazily)',
      )

      return {
        tools: aggregatedTools,
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      logger.info({ tool: name, args }, 'Tool called')

      try {
        // Check if this is a namespaced tool (transparent proxy mode - lazy loading)
        const namespace = this.parseToolNamespace(name)
        if (namespace) {
          // Lazy load: fetch schema for this MCP if not already loaded
          await this.ensureMCPToolsLoaded(namespace.mcpName)
          return await this.routeToolCall(
            namespace.mcpName,
            namespace.toolName,
            args,
          )
        }

        // Handle MCPGuard's own tools
        switch (name) {
          case 'load_mcp_server':
            return await this.handleLoadMCP(args)

          case 'execute_code':
            return await this.handleExecuteCode(args)

          case 'list_available_mcps':
            return await this.handleListMCPs()

          case 'get_mcp_by_name':
            return await this.handleGetMCPByName(args)

          case 'get_mcp_schema':
            return await this.handleGetSchema(args)

          case 'unload_mcp_server':
            return await this.handleUnloadMCP(args)

          case 'get_metrics':
            return await this.handleGetMetrics()

          case 'import_cursor_mcps':
            return await this.handleImportCursorConfigs(args)

          case 'search_mcp_tools':
            return await this.handleSearchMCPTools(args)

          case 'disable_mcps':
            return await this.handleDisableMCPs(args)

          default: {
            // Check if this might be a namespaced tool that was called without namespace
            // Try to discover which MCP has this tool by checking configured MCPs
            const configuredMCPs = await this.discoverConfiguredMCPs()
            for (const [mcpName, entry] of configuredMCPs.entries()) {
              // Lazy load this MCP's tools to check
              await this.ensureMCPToolsLoaded(mcpName)
              const tools = this.discoveredMCPTools.get(mcpName)
              if (tools?.some((t) => t.name === name)) {
                throw new MCPIsolateError(
                  `Tool "${name}" requires namespace. Use "${mcpName}::${name}" instead.`,
                  'UNKNOWN_TOOL',
                  404,
                  {
                    tool_name: name,
                    suggested_name: `${mcpName}::${name}`,
                    mcp_name: mcpName,
                  },
                )
              }
            }
            throw new MCPIsolateError(
              `Unknown tool: ${name}`,
              'UNKNOWN_TOOL',
              404,
            )
          }
        }
      } catch (error: unknown) {
        logger.error({ error, tool: name }, 'Tool execution failed')

        if (error instanceof MCPIsolateError) {
          // Check if this is a fatal error (should stop execution)
          const isFatal =
            error.code === 'UNSUPPORTED_CONFIG' ||
            error.code === 'MCP_CONNECTION_ERROR' ||
            (error.details && typeof error.details === 'object' && 'fatal' in error.details && error.details.fatal === true)

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error_code: error.code,
                    error_message: error.message,
                    suggested_action: this.getSuggestedAction(error.code, name),
                    context: {
                      tool: name,
                      status_code: error.statusCode,
                    },
                    details: error.details,
                    fatal: isFatal,
                    // Add explicit instruction for fatal errors
                    ...(isFatal
                      ? {
                          instruction:
                            'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.',
                        }
                      : {}),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          }
        }

        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        const errorStack = error instanceof Error ? error.stack : undefined
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error_code: 'INTERNAL_ERROR',
                  error_message: 'Internal server error',
                  suggested_action:
                    'Check logs for details. If the error persists, try reloading the MCP server.',
                  context: {
                    tool: name,
                    original_error: errorMessage,
                  },
                  details: {
                    stack: errorStack,
                  },
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        }
      }
    })
  }

  private async handleLoadMCP(args: unknown) {
    if (
      !args ||
      typeof args !== 'object' ||
      !('mcp_name' in args) ||
      typeof args.mcp_name !== 'string'
    ) {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const {
      mcp_name,
      mcp_config,
      use_saved = false,
      auto_save = true,
    } = args as {
      mcp_name: string
      mcp_config?: unknown
      use_saved?: boolean
      auto_save?: boolean
    }

    let configToUse: MCPConfig

    // Get config from saved configs if use_saved is true
    if (use_saved) {
      const savedConfig = this.configManager.getSavedConfig(mcp_name)
      if (!savedConfig) {
        throw new MCPIsolateError(
              `No saved configuration found for MCP: ${mcp_name}. Use search_mcp_tools to see available MCPs.`,
          'NOT_FOUND',
          404,
        )
      }
      // URL-based MCPs are now supported via StreamableHTTPClientTransport
      // No early rejection needed - they will be handled by the transport layer
      configToUse = savedConfig
    } else {
      // Validate and use provided config
      if (!mcp_config) {
        throw new MCPIsolateError(
          'mcp_config is required when use_saved is false',
          'INVALID_INPUT',
          400,
        )
      }
      const validated = validateInput(LoadMCPRequestSchema, {
        mcp_name,
        mcp_config,
      })
      configToUse = validated.mcp_config
    }

    // Resolve environment variables in config
    const resolvedConfig = this.configManager.resolveEnvVarsInObject(
      configToUse,
    ) as MCPConfig

    const startTime = Date.now()
    const instance = await this.workerManager.loadMCP(mcp_name, resolvedConfig)
    const loadTime = Date.now() - startTime

    this.metricsCollector.recordMCPLoad(instance.mcp_id, loadTime)

    // Auto-save if enabled (saves to Cursor's config file)
    if (auto_save && !use_saved) {
      try {
        this.configManager.saveConfig(mcp_name, configToUse)
      } catch (error: unknown) {
        logger.warn({ error, mcp_name }, 'Failed to auto-save MCP config')
      }
    }

    // Generate usage example based on available tools
    const usageExample = this.generateUsageExample(instance.tools)
    const exampleCode = this.generateExampleCode(instance.tools)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              mcp_id: instance.mcp_id,
              mcp_name: instance.mcp_name,
              status: instance.status,
              tools_count: instance.tools.length,
              typescript_api: instance.typescript_api,
              available_tools: instance.tools.map((t) => t.name),
              load_time_ms: loadTime,
              usage_example: usageExample,
              example_code: exampleCode,
              config_saved: auto_save && !use_saved,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleExecuteCode(args: unknown) {
    let validated: ExecuteCodeRequest & { timeout_ms: number }
    try {
      const result = validateInput(ExecuteCodeRequestSchema, args)
      validated = {
        ...result,
        timeout_ms: result.timeout_ms ?? 30000,
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorDetails =
        error && typeof error === 'object' && 'errors' in error
          ? (error as { errors?: unknown }).errors || error
          : error
      throw new MCPIsolateError(
        `Invalid input: ${errorMessage}`,
        'VALIDATION_ERROR',
        400,
        { validation_errors: errorDetails },
      )
    }

    // Validate code for security
    try {
      validateTypeScriptCode(validated.code)
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      throw new MCPIsolateError(
        `Code validation failed: ${errorMessage}`,
        'SECURITY_ERROR',
        403,
        { code_length: validated.code.length },
      )
    }

    // Handle auto-loading if mcp_name is provided
    let mcpId: string
    let instance = this.workerManager.getInstance(validated.mcp_id || '')

    if (validated.mcp_name) {
      // Check if MCP is already loaded
      const existingInstance = this.workerManager.getMCPByName(
        validated.mcp_name,
      )

      if (existingInstance) {
        mcpId = existingInstance.mcp_id
        instance = existingInstance
      } else {
        // Auto-load MCP from saved config
        const savedConfig = this.configManager.getSavedConfig(
          validated.mcp_name,
        )
        if (!savedConfig) {
          throw new MCPIsolateError(
            `MCP "${validated.mcp_name}" not found in IDE configuration. Use search_mcp_tools to see available MCPs.`,
            'NOT_FOUND',
            404,
            {
              mcp_name: validated.mcp_name,
              suggestion:
                'Use search_mcp_tools to discover configured MCPs, or use load_mcp_server to load a new MCP.',
            },
          )
        }

        // URL-based MCPs are now supported via StreamableHTTPClientTransport
        // No early rejection needed - they will be handled by the transport layer

        // Resolve environment variables
        const resolvedConfig = this.configManager.resolveEnvVarsInObject(
          savedConfig,
        ) as MCPConfig

        logger.info(
          { mcp_name: validated.mcp_name },
          'Auto-loading MCP for execute_code',
        )

        // Load the MCP
        const startTime = Date.now()
        try {
          const loadedInstance = await this.workerManager.loadMCP(
            validated.mcp_name,
            resolvedConfig,
          )
          const loadTime = Date.now() - startTime

          this.metricsCollector.recordMCPLoad(loadedInstance.mcp_id, loadTime)

          mcpId = loadedInstance.mcp_id
          instance = loadedInstance

          logger.info(
            {
              mcp_name: validated.mcp_name,
              mcp_id: mcpId,
              load_time_ms: loadTime,
            },
            'MCP auto-loaded successfully',
          )
        } catch (error: unknown) {
          // Re-throw MCPConnectionError with enhanced context
          if (error instanceof MCPConnectionError) {
            throw new MCPConnectionError(
              error.message,
              {
                mcp_name: validated.mcp_name,
                original_error: error.details,
                fatal: true,
              },
            )
          }
          throw error
        }
      }
    } else if (validated.mcp_id) {
      mcpId = validated.mcp_id
      instance = this.workerManager.getInstance(mcpId)
      if (!instance) {
        throw new MCPIsolateError(
          `MCP instance not found: ${mcpId}`,
          'NOT_FOUND',
          404,
          {
            mcp_id: mcpId,
            suggestion:
              'Use list_available_mcps or get_mcp_by_name to find the correct MCP ID, or use mcp_name instead to auto-load.',
          },
        )
      }
    } else {
      throw new MCPIsolateError(
        'Either mcp_id or mcp_name must be provided',
        'INVALID_INPUT',
        400,
      )
    }

    const result = await this.workerManager.executeCode(
      mcpId,
      validated.code,
      validated.timeout_ms ?? 30000,
    )

    this.metricsCollector.recordExecution(
      mcpId,
      result.execution_time_ms,
      result.success,
      result.metrics?.mcp_calls_made || 0,
    )

    // Enhance error response if execution failed
    if (!result.success) {
      // Check if this is a fatal error (e.g., MCP connection error, Wrangler execution failure)
      const errorMessage = result.error || ''
      const errorDetails = result.error_details
      const hasWranglerError =
        errorMessage.includes('Wrangler execution failed') ||
        errorMessage.includes('Wrangler process') ||
        errorMessage.includes('Wrangler dev server') ||
        (errorDetails &&
          typeof errorDetails === 'object' &&
          ('wrangler_stderr' in errorDetails || 'wrangler_stdout' in errorDetails))

      const isFatal =
        errorMessage.includes('MCP_CONNECTION_ERROR') ||
        errorMessage.includes('URL-based MCP') ||
        errorMessage.includes('cannot be loaded') ||
        hasWranglerError ||
        (errorDetails &&
          typeof errorDetails === 'object' &&
          'fatal' in errorDetails &&
          errorDetails.fatal === true)

      // Extract Wrangler error details for prominent display
      let wranglerError: {
        stderr?: string
        stdout?: string
        exit_code?: number
        formatted_error?: string
      } | null = null

      if (
        hasWranglerError &&
        errorDetails &&
        typeof errorDetails === 'object'
      ) {
        const stderr =
          'wrangler_stderr' in errorDetails
            ? String(errorDetails.wrangler_stderr)
            : ''
        const stdout =
          'wrangler_stdout' in errorDetails
            ? String(errorDetails.wrangler_stdout)
            : ''

        // Create a formatted, readable error message
        const formattedError = this.formatWranglerError(stderr, stdout)

        wranglerError = {
          stderr: stderr || undefined,
          stdout: stdout || undefined,
          exit_code:
            'exit_code' in errorDetails
              ? Number(errorDetails.exit_code)
              : undefined,
          formatted_error: formattedError,
        }
      }

      // Build simplified error response
      const errorResponse: {
        success: false
        error_code: string
        error_message: string
        suggested_action: string
        fatal: boolean
        instruction?: string
        wrangler_error?: typeof wranglerError
        execution_time_ms: number
      } = {
        success: false,
        error_code: 'EXECUTION_ERROR',
        error_message: result.error || 'Code execution failed',
        suggested_action: this.getExecutionErrorSuggestion(result.error),
        fatal: isFatal,
        execution_time_ms: result.execution_time_ms,
      }

      // Add Wrangler error prominently if present
      if (wranglerError) {
        errorResponse.wrangler_error = wranglerError
        // Also include formatted error in the main error message for better visibility
        if (wranglerError.formatted_error) {
          errorResponse.error_message = `${errorResponse.error_message}\n\n${wranglerError.formatted_error}`
        }
      }

      // Add explicit instruction for fatal errors
      if (isFatal) {
        errorResponse.instruction =
          'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.'
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorResponse, null, 2),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  }

  /**
   * Format Wrangler error output for better readability
   * Removes ANSI codes and structures the error message
   */
  private formatWranglerError(stderr: string, stdout: string): string {
    // Remove ANSI escape codes for cleaner output
    const cleanStderr = stderr.replace(/\u001b\[[0-9;]*m/g, '')
    const cleanStdout = stdout.replace(/\u001b\[[0-9;]*m/g, '')

    const parts: string[] = []

    if (cleanStderr.trim()) {
      parts.push('Wrangler Error Output:')
      parts.push('─'.repeat(50))
      parts.push(cleanStderr.trim())
    }

    if (cleanStdout.trim() && !cleanStdout.includes('wrangler')) {
      // Only include stdout if it's not just the wrangler banner
      parts.push('')
      parts.push('Wrangler Output:')
      parts.push('─'.repeat(50))
      parts.push(cleanStdout.trim())
    }

    return parts.join('\n')
  }

  private getExecutionErrorSuggestion(error?: string): string {
    if (!error) {
      return 'Review the code and try again. Check that all MCP tool calls are correct.'
    }

    const errorLower = error.toLowerCase()

    if (errorLower.includes('wrangler')) {
      if (errorLower.includes('missing entry-point') || errorLower.includes('entry-point')) {
        return 'Wrangler configuration error: Missing entry point. This is a fatal error - MCPGuard cannot execute code without a properly configured Worker runtime. Check that src/worker/runtime.ts exists and wrangler.toml is correctly configured.'
      }
      if (errorLower.includes('exited with code')) {
        return 'Wrangler execution failed. This is a fatal error - MCPGuard cannot execute code. Check the error_details for Wrangler stderr/stdout output to diagnose the issue. Common causes: missing dependencies, configuration errors, or Wrangler version incompatibility.'
      }
      return 'Wrangler execution error. This is a fatal error - MCPGuard cannot execute code. Check the error_details for detailed Wrangler output. Ensure Wrangler is installed (npx wrangler --version) and the Worker runtime is properly configured.'
    }

    if (errorLower.includes('timeout')) {
      return 'Execution timed out. Try increasing timeout_ms or optimizing the code to run faster.'
    }

    if (
      errorLower.includes('not defined') ||
      errorLower.includes('undefined')
    ) {
      return 'A variable or function is not defined. Check that all MCP tool calls use the correct tool names from the available_tools list.'
    }

    if (errorLower.includes('rpc') || errorLower.includes('binding')) {
      return 'MCP RPC binding error. The MCP server may not be ready or the RPC mechanism needs to be implemented.'
    }

    if (errorLower.includes('syntax')) {
      return 'Syntax error in the code. Review the TypeScript syntax and ensure all brackets, parentheses, and quotes are properly closed.'
    }

    return 'Review the error message and code. Ensure MCP tools are called correctly with the right parameters. Use get_mcp_schema to see the tool definitions.'
  }

  private async handleListMCPs() {
    const instances = this.workerManager.listInstances()

    // Create name-to-ID mapping for quick lookup
    const mcpNameToId: Record<string, string> = {}
    instances.forEach((instance) => {
      mcpNameToId[instance.mcp_name] = instance.mcp_id
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcps: instances.map((instance) => ({
                mcp_id: instance.mcp_id,
                mcp_name: instance.mcp_name,
                status: instance.status,
                uptime_ms: instance.uptime_ms,
                tools_count: instance.tools.length,
                created_at: instance.created_at.toISOString(),
              })),
              total_count: instances.length,
              mcp_name_to_id: mcpNameToId,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleGetSchema(args: unknown) {
    if (
      !args ||
      typeof args !== 'object' ||
      !('mcp_id' in args) ||
      typeof args.mcp_id !== 'string'
    ) {
      throw new MCPIsolateError(
        'mcp_id is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const { mcp_id } = args as { mcp_id: string }

    if (!mcp_id) {
      throw new MCPIsolateError(
        'mcp_id is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const instance = this.workerManager.getInstance(mcp_id)

    if (!instance) {
      throw new MCPIsolateError(
        `MCP instance not found: ${mcp_id}`,
        'NOT_FOUND',
        404,
      )
    }

    const commonPatterns = this.generateCommonPatterns(instance.tools)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcp_id: instance.mcp_id,
              mcp_name: instance.mcp_name,
              typescript_api: instance.typescript_api,
              tools: instance.tools,
              common_patterns: commonPatterns,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleGetMCPByName(args: unknown) {
    if (
      !args ||
      typeof args !== 'object' ||
      !('mcp_name' in args) ||
      typeof args.mcp_name !== 'string'
    ) {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const { mcp_name } = args as { mcp_name: string }

    if (!mcp_name) {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const instance = this.workerManager.getMCPByName(mcp_name)

    if (!instance) {
      throw new MCPIsolateError(
        `MCP not found with name: ${mcp_name}`,
        'NOT_FOUND',
        404,
      )
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcp_id: instance.mcp_id,
              mcp_name: instance.mcp_name,
              status: instance.status,
              tools_count: instance.tools.length,
              available_tools: instance.tools.map((t) => t.name),
              uptime_ms: instance.uptime_ms,
              created_at: instance.created_at.toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleUnloadMCP(args: unknown) {
    if (
      !args ||
      typeof args !== 'object' ||
      !('mcp_id' in args) ||
      typeof args.mcp_id !== 'string'
    ) {
      throw new MCPIsolateError(
        'mcp_id is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const { mcp_id, remove_from_saved = false } = args as {
      mcp_id: string
      remove_from_saved?: boolean
    }

    if (!mcp_id) {
      throw new MCPIsolateError(
        'mcp_id is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    // Get MCP name before unloading
    const instance = this.workerManager.getInstance(mcp_id)
    const mcpName = instance?.mcp_name

    await this.workerManager.unloadMCP(mcp_id)

    // Optionally remove from saved configs
    let configRemoved = false
    if (remove_from_saved && mcpName) {
      try {
        configRemoved = this.configManager.deleteConfig(mcpName)
      } catch (error: unknown) {
        logger.warn(
          { error, mcpName },
          'Failed to remove config from IDE config file',
        )
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server ${mcp_id} unloaded successfully`,
              config_removed: configRemoved,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleGetMetrics() {
    const metrics = this.metricsCollector.getMetrics()

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metrics, null, 2),
        },
      ],
    }
  }

  private getSuggestedAction(errorCode: string, toolName: string): string {
    const suggestions: Record<string, string> = {
      NOT_FOUND: `MCP not found. Use list_available_mcps to see loaded MCPs, or use get_mcp_by_name to find by name.`,
      INVALID_INPUT: `Invalid input provided. Check the tool's inputSchema for required parameters and their types.`,
      VALIDATION_ERROR: `Input validation failed. Review the error details and ensure all required fields are provided with correct types.`,
      WORKER_ERROR: `Worker execution error. The MCP may not be ready. Check the MCP status with list_available_mcps.`,
      MCP_CONNECTION_ERROR: `Failed to connect to MCP server. This is a fatal error - do not attempt alternative approaches. Verify the MCP configuration (command, args, env for command-based, or url, headers for URL-based) and ensure the MCP server is accessible.`,
      UNSUPPORTED_CONFIG: `This MCP configuration is not supported. Check the configuration format and ensure it matches the expected schema.`,
      SECURITY_ERROR: `Code validation failed. The code contains prohibited patterns. Review the code and remove any dangerous operations.`,
      UNKNOWN_TOOL: `Unknown tool: ${toolName}. Check available tools with list_available_mcps.`,
    }

    return (
      suggestions[errorCode] ||
      'Review the error details and try again. If the issue persists, check the logs.'
    )
  }

  private generateUsageExample(tools: MCPTool[]): string {
    if (tools.length === 0) {
      return 'No tools available.'
    }

    const firstTool = tools[0]
    const toolName = firstTool.name
    const params = firstTool.inputSchema.properties || {}
    const paramKeys = Object.keys(params).slice(0, 2) // Use first 2 params as example
    const exampleParams: Record<string, unknown> = {}

    paramKeys.forEach((key: string) => {
      const schema = params[key] as JSONSchemaProperty
      if (schema?.type === 'string') {
        exampleParams[key] = 'example_value'
      } else if (schema?.type === 'number') {
        exampleParams[key] = 1
      } else if (schema?.type === 'boolean') {
        exampleParams[key] = true
      }
    })

    return `To use this MCP, call execute_code with code like:

\`\`\`typescript
const result = await mcp.${toolName}(${JSON.stringify(exampleParams, null, 2)});
console.log(JSON.stringify(result, null, 2));
\`\`\`

Available tools: ${tools.map((t) => t.name).join(', ')}`
  }

  private generateExampleCode(tools: MCPTool[]): string {
    if (tools.length === 0) {
      return '// No tools available'
    }

    const firstTool = tools[0]
    const toolName = firstTool.name
    const params = firstTool.inputSchema.properties || {}
    const required = firstTool.inputSchema.required || []
    const paramKeys =
      required.length > 0
        ? required.slice(0, 2)
        : Object.keys(params).slice(0, 2)
    const exampleParams: Record<string, unknown> = {}

    paramKeys.forEach((key) => {
      const schema = params[key] as JSONSchemaProperty
      if (schema?.type === 'string') {
        exampleParams[key] = schema.description?.toLowerCase().includes('query')
          ? 'typescript'
          : 'example'
      } else if (schema?.type === 'number') {
        exampleParams[key] = 1
      } else if (schema?.type === 'boolean') {
        exampleParams[key] = true
      }
    })

    return `// Example: Call ${toolName} tool
const result = await mcp.${toolName}(${JSON.stringify(exampleParams, null, 2)});
console.log(JSON.stringify(result, null, 2));`
  }

  private generateCommonPatterns(tools: MCPTool[]): string[] {
    const patterns: string[] = []

    if (tools.length > 0) {
      patterns.push(
        `// Call a tool: const result = await mcp.${tools[0].name}({ ... });`,
      )
      patterns.push(
        `// Output results: console.log(JSON.stringify(result, null, 2));`,
      )
    }

    if (tools.length > 1) {
      patterns.push(
        `// Chain multiple calls: const r1 = await mcp.${tools[0].name}({...}); const r2 = await mcp.${tools[1].name}({...});`,
      )
    }

    patterns.push(
      `// Error handling: try { const result = await mcp.toolName({...}); } catch (error) { console.error('Error:', error.message); }`,
    )

    return patterns
  }

  private async handleDisableMCPs(args: unknown) {
    const typedArgs =
      args && typeof args === 'object'
        ? (args as { mcp_names?: string[] })
        : {}
    const { mcp_names } = typedArgs

    const configPath = this.configManager.getCursorConfigPath()
    if (!configPath) {
      throw new MCPIsolateError(
        'No IDE MCP configuration file found. Please add MCPGuard to your IDE config first.',
        'CONFIG_NOT_FOUND',
        404,
      )
    }

    const sourceName = this.configManager.getConfigSourceDisplayName()
    const result: {
      disabled: string[]
      alreadyDisabled: string[]
      failed: string[]
      mcpguardRestored: boolean
    } = {
      disabled: [],
      alreadyDisabled: [],
      failed: [],
      mcpguardRestored: false,
    }

    if (mcp_names && mcp_names.length > 0) {
      // Disable specific MCPs
      for (const mcpName of mcp_names) {
        if (mcpName.toLowerCase() === 'mcpguard') {
          continue // Skip mcpguard
        }

        if (this.configManager.isMCPDisabled(mcpName)) {
          result.alreadyDisabled.push(mcpName)
        } else if (this.configManager.disableMCP(mcpName)) {
          result.disabled.push(mcpName)
        } else {
          result.failed.push(mcpName)
        }
      }
    } else {
      // Disable all MCPs except mcpguard
      const disableResult = this.configManager.disableAllExceptMCPGuard()
      result.disabled = disableResult.disabled
      result.alreadyDisabled = disableResult.alreadyDisabled
      result.failed = disableResult.failed
      result.mcpguardRestored = disableResult.mcpguardRestored
    }

    const response: {
      success: boolean
      message: string
      source: string
      disabled: string[]
      alreadyDisabled: string[]
      failed: string[]
      mcpguardRestored: boolean
      note?: string
    } = {
      success: true,
      message: `MCPs disabled in ${sourceName} configuration`,
      source: sourceName,
      disabled: result.disabled,
      alreadyDisabled: result.alreadyDisabled,
      failed: result.failed,
      mcpguardRestored: result.mcpguardRestored,
    }

    if (result.disabled.length === 0 && result.alreadyDisabled.length === 0) {
      response.message = `All specified MCPs are already disabled in ${sourceName} config`
    }

    if (result.failed.length > 0) {
      response.note = `Some MCPs could not be disabled. They may not exist in the configuration.`
    }

    if (result.mcpguardRestored) {
      response.note = `${response.note ? response.note + ' ' : ''}MCPGuard was restored to active config.`
    }

    logger.info(
      {
        disabled: result.disabled,
        alreadyDisabled: result.alreadyDisabled,
        failed: result.failed,
        source: sourceName,
      },
      'MCPs disabled via disable_mcps tool',
    )

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    }
  }

  private async handleImportCursorConfigs(args: unknown) {
    const typedArgs =
      args && typeof args === 'object' && 'cursor_config_path' in args
        ? (args as { cursor_config_path?: string })
        : {}
    const { cursor_config_path } = typedArgs

    const result = this.configManager.importConfigs(cursor_config_path)
    const configPath = this.configManager.getCursorConfigPath()
    const configSource = this.configManager.getConfigSource()

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: result.errors.length === 0,
              imported_count: result.imported,
              errors: result.errors,
              config_path: configPath,
              config_source: configSource,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  /**
   * Route a tool call to the appropriate MCP through transparent proxy
   * Auto-loads MCP if needed and executes tool call in isolation
   */
  private async routeToolCall(
    mcpName: string,
    toolName: string,
    args: unknown,
  ) {
    logger.info(
      { mcpName, toolName },
      'Routing tool call through transparent proxy',
    )

    // Check if MCP is already loaded
    let instance = this.workerManager.getMCPByName(mcpName)

    if (!instance) {
      // Auto-load MCP from saved config
      const savedConfig = this.configManager.getSavedConfig(mcpName)
      if (!savedConfig) {
        throw new MCPIsolateError(
          `MCP "${mcpName}" not found in IDE configuration. Use search_mcp_tools to see available MCPs.`,
          'NOT_FOUND',
          404,
          {
            mcp_name: mcpName,
            suggestion:
              'Use search_mcp_tools to discover configured MCPs, or use load_mcp_server to load a new MCP.',
          },
        )
      }

      // URL-based MCPs are now supported via StreamableHTTPClientTransport
      // No early rejection needed - they will be handled by the transport layer

      // Resolve environment variables
      const resolvedConfig = this.configManager.resolveEnvVarsInObject(
        savedConfig,
      ) as MCPConfig

      logger.info(
        { mcp_name: mcpName },
        'Auto-loading MCP for transparent proxy tool call',
      )

      // Load the MCP
      const startTime = Date.now()
      try {
        instance = await this.workerManager.loadMCP(mcpName, resolvedConfig)
        const loadTime = Date.now() - startTime

        this.metricsCollector.recordMCPLoad(instance.mcp_id, loadTime)

        logger.info(
          {
            mcp_name: mcpName,
            mcp_id: instance.mcp_id,
            load_time_ms: loadTime,
          },
          'MCP auto-loaded for transparent proxy',
        )
      } catch (error: unknown) {
        // Re-throw MCPConnectionError with enhanced context
        if (error instanceof MCPConnectionError) {
          throw new MCPConnectionError(
            error.message,
            {
              mcp_name: mcpName,
              original_error: error.details,
              fatal: true,
            },
          )
        }
        throw error
      }
    }

    // Verify tool exists
    const tool = instance.tools.find((t) => t.name === toolName)
    if (!tool) {
      throw new MCPIsolateError(
        `Tool "${toolName}" not found in MCP "${mcpName}". Available tools: ${instance.tools.map((t) => t.name).join(', ')}`,
        'NOT_FOUND',
        404,
        {
          mcp_name: mcpName,
          tool_name: toolName,
          available_tools: instance.tools.map((t) => t.name),
        },
      )
    }

    // Generate TypeScript code to call the tool
    const argsJson = JSON.stringify(args || {})
    const code = `const result = await mcp.${toolName}(${argsJson});
console.log(JSON.stringify(result, null, 2));
return result;`

    // Execute through isolation
    logger.debug(
      { mcpName, toolName, mcp_id: instance.mcp_id },
      'Executing tool call in isolation',
    )

    const result = await this.workerManager.executeCode(
      instance.mcp_id,
      code,
      30000, // Default timeout
    )

    this.metricsCollector.recordExecution(
      instance.mcp_id,
      result.execution_time_ms,
      result.success,
      result.metrics?.mcp_calls_made || 0,
    )

    if (!result.success) {
      // Check if this is a fatal error (e.g., MCP connection error, Wrangler execution failure)
      const errorMessage = result.error || ''
      const errorDetails = result.error_details
      const hasWranglerError =
        errorMessage.includes('Wrangler execution failed') ||
        errorMessage.includes('Wrangler process') ||
        errorMessage.includes('Wrangler dev server') ||
        (errorDetails &&
          typeof errorDetails === 'object' &&
          ('wrangler_stderr' in errorDetails || 'wrangler_stdout' in errorDetails))

      const isFatal =
        errorMessage.includes('MCP_CONNECTION_ERROR') ||
        errorMessage.includes('URL-based MCP') ||
        errorMessage.includes('cannot be loaded') ||
        hasWranglerError ||
        (errorDetails &&
          typeof errorDetails === 'object' &&
          'fatal' in errorDetails &&
          errorDetails.fatal === true)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error_code: 'EXECUTION_ERROR',
                error_message: result.error || 'Tool execution failed',
                suggested_action: this.getExecutionErrorSuggestion(
                  result.error,
                ),
                context: {
                  mcp_name: mcpName,
                  tool_name: toolName,
                  mcp_id: instance.mcp_id,
                },
                execution_time_ms: result.execution_time_ms,
                metrics: result.metrics,
                output: result.output,
                error_details: result.error_details,
                fatal: isFatal,
                // Add explicit instruction for fatal errors
                ...(isFatal
                  ? {
                      instruction:
                        'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.',
                    }
                  : {}),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      }
    }

    // Parse result from output
    let parsedResult: unknown = result.output
    try {
      // Try to parse JSON from output
      const outputLines = result.output?.split('\n') || []
      for (const line of outputLines) {
        if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
          try {
            parsedResult = JSON.parse(line.trim())
            break
          } catch {
            // Continue trying other lines
          }
        }
      }
    } catch {
      // Use output as-is if parsing fails
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(parsedResult, null, 2),
        },
      ],
    }
  }

  private async handleSearchMCPTools(args: unknown) {
    const typedArgs =
      args && typeof args === 'object'
        ? (args as {
            query?: string
            detail_level?: 'summary' | 'tools' | 'full'
          })
        : {}
    const { query, detail_level = 'summary' } = typedArgs

    // Get all configured MCPs (excluding mcpguard, including disabled ones for transparency)
    const guardedConfigs = this.configManager.getGuardedMCPConfigs()
    const loadedInstances = this.workerManager.listInstances()
    const disabledMCPs = this.configManager.getDisabledMCPs()
    const configSource = this.configManager.getConfigSource()
    const configPath = this.configManager.getCursorConfigPath()

    // Build results
    const results: Array<{
      mcp_name: string
      status: 'loaded' | 'not_loaded' | 'disabled'
      config_source: 'cursor' | 'claude-code' | 'github-copilot'
      tools_count?: number
      tool_names?: string[]
      tools?: MCPTool[]
      mcp_id?: string
    }> = []

    for (const [mcpName, entry] of Object.entries(guardedConfigs)) {
      // Apply search filter if provided
      if (query) {
        const queryLower = query.toLowerCase()
        const nameMatches = mcpName.toLowerCase().includes(queryLower)

        // Check if any loaded tools match
        const loadedInstance = loadedInstances.find(
          (inst) => inst.mcp_name === mcpName,
        )
        const toolMatches =
          loadedInstance?.tools.some((tool) =>
            tool.name.toLowerCase().includes(queryLower),
          ) || false

        if (!nameMatches && !toolMatches) {
          continue
        }
      }

      const loadedInstance = loadedInstances.find(
        (inst) => inst.mcp_name === mcpName,
      )
      const isDisabled = disabledMCPs.includes(mcpName)

      const result: {
        mcp_name: string
        status: 'loaded' | 'not_loaded' | 'disabled'
        config_source: 'cursor' | 'claude-code' | 'github-copilot'
        tools_count?: number
        tool_names?: string[]
        tools?: MCPTool[]
        mcp_id?: string
      } = {
        mcp_name: mcpName,
        status: loadedInstance
          ? 'loaded'
          : isDisabled
            ? 'disabled'
            : 'not_loaded',
        config_source: entry.source,
      }

      if (loadedInstance) {
        result.mcp_id = loadedInstance.mcp_id
        result.tools_count = loadedInstance.tools.length

        if (detail_level === 'tools' || detail_level === 'full') {
          result.tool_names = loadedInstance.tools.map((t) => t.name)
        }

        if (detail_level === 'full') {
          result.tools = loadedInstance.tools
        }
      } else {
        result.tools_count = 0
        if (detail_level === 'tools' || detail_level === 'full') {
          result.tool_names = []
        }
      }

      results.push(result)
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcps: results,
              total_count: results.length,
              loaded_count: results.filter((r) => r.status === 'loaded').length,
              not_loaded_count: results.filter((r) => r.status === 'not_loaded')
                .length,
              disabled_count: results.filter((r) => r.status === 'disabled')
                .length,
              config_path: configPath,
              config_source: configSource,
              note: 'These MCPs are configured in your IDE. Disabled MCPs are guarded by MCPGuard and should be accessed through execute_code. Use execute_code with mcp_name to auto-load and use these MCPs.',
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    logger.info('MCP Guard server started')

    // Graceful shutdown handler
    const shutdown = async () => {
      logger.info('Shutting down gracefully...')

      try {
        // Close MCP server
        await Promise.race([
          this.server.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ])

        // Clean up WorkerManager resources
        await this.workerManager.shutdown()

        logger.info('Shutdown complete')
      } catch (error: unknown) {
        logger.error({ error }, 'Error during shutdown')
      } finally {
        process.exit(0)
      }
    }

    // Handle both SIGINT (Ctrl-C) and SIGTERM
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
}
