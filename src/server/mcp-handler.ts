import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  ExecuteCodeRequestSchema,
  LoadMCPRequestSchema,
  type MCPTool,
} from '../types/mcp.js'
import { ConfigManager } from '../utils/config-manager.js'
import { MCPIsolateError } from '../utils/errors.js'
import logger from '../utils/logger.js'
import { validateInput, validateTypeScriptCode } from '../utils/validation.js'
import { MetricsCollector } from './metrics-collector.js'
import { WorkerManager } from './worker-manager.js'

export class MCPHandler {
  private server: Server
  private workerManager: WorkerManager
  private metricsCollector: MetricsCollector
  private configManager: ConfigManager

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

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing available tools')

      return {
        tools: [
          {
            name: 'load_mcp_server',
            description:
              'Load an MCP server into a secure isolated Worker environment for code mode execution. Can use a saved configuration or load with a new configuration. Automatically saves the configuration unless auto_save is false.',
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
                    'MCP server connection configuration. Required if use_saved is false. Can use \\${VAR_NAME} syntax for environment variables.',
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
                        'Environment variables for the MCP server. Use \\${VAR_NAME} syntax to reference .env variables.',
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
            description: `Execute TypeScript code in a sandboxed Worker isolate with access to a loaded MCP server.

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
// Search for repositories
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

Use console.log() to output results - all console output is captured and returned in the response.`,
            inputSchema: {
              type: 'object',
              properties: {
                mcp_id: {
                  type: 'string',
                  description:
                    'UUID of the loaded MCP server (returned from load_mcp_server). Use list_available_mcps or get_mcp_by_name to find the MCP ID.',
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
              required: ['mcp_id', 'code'],
            },
          },
          {
            name: 'list_available_mcps',
            description:
              'List all MCP servers currently loaded in Worker isolates. Returns a list with MCP IDs, names, status, and tool counts. Use get_mcp_by_name to find a specific MCP by name.',
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
            name: 'list_saved_mcp_configs',
            description:
              "List all saved MCP configurations from Cursor's MCP configuration file",
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'save_mcp_config',
            description:
              "Save an MCP configuration to Cursor's MCP configuration file. Configurations are saved in JSONC format with environment variable placeholders.",
            inputSchema: {
              type: 'object',
              properties: {
                mcp_name: {
                  type: 'string',
                  description: 'Name of the MCP server configuration to save',
                },
                mcp_config: {
                  type: 'object',
                  description:
                    'MCP server configuration to save. Use \\${VAR_NAME} syntax for environment variables.',
                  properties: {
                    command: {
                      type: 'string',
                      description: 'Command to launch the MCP server',
                    },
                    args: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Arguments for the MCP server command',
                    },
                    env: {
                      type: 'object',
                      description:
                        'Environment variables. Use \\${VAR_NAME} syntax to reference .env variables.',
                    },
                  },
                  required: ['command'],
                },
              },
              required: ['mcp_name', 'mcp_config'],
            },
          },
          {
            name: 'delete_mcp_config',
            description:
              "Delete a saved MCP configuration from Cursor's MCP configuration file",
            inputSchema: {
              type: 'object',
              properties: {
                mcp_name: {
                  type: 'string',
                  description: 'Name of the MCP server configuration to delete',
                },
              },
              required: ['mcp_name'],
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
        ],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      logger.info({ tool: name, args }, 'Tool called')

      try {
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

          case 'list_saved_mcp_configs':
            return await this.handleListSavedConfigs()

          case 'save_mcp_config':
            return await this.handleSaveConfig(args)

          case 'delete_mcp_config':
            return await this.handleDeleteConfig(args)

          case 'import_cursor_mcps':
            return await this.handleImportCursorConfigs(args)

          default:
            throw new MCPIsolateError(
              `Unknown tool: ${name}`,
              'UNKNOWN_TOOL',
              404,
            )
        }
      } catch (error: any) {
        logger.error({ error, tool: name }, 'Tool execution failed')

        if (error instanceof MCPIsolateError) {
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
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          }
        }

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
                    original_error: error.message,
                  },
                  details: {
                    stack: error.stack,
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

  private async handleLoadMCP(args: any) {
    const { mcp_name, mcp_config, use_saved = false, auto_save = true } = args

    if (!mcp_name || typeof mcp_name !== 'string') {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    let configToUse: any

    // Get config from saved configs if use_saved is true
    if (use_saved) {
      const savedConfig = this.configManager.getSavedConfig(mcp_name)
      if (!savedConfig) {
        throw new MCPIsolateError(
          `No saved configuration found for MCP: ${mcp_name}. Use list_saved_mcp_configs to see available configs.`,
          'NOT_FOUND',
          404,
        )
      }
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
    const resolvedConfig =
      this.configManager.resolveEnvVarsInObject(configToUse)

    const startTime = Date.now()
    const instance = await this.workerManager.loadMCP(mcp_name, resolvedConfig)
    const loadTime = Date.now() - startTime

    this.metricsCollector.recordMCPLoad(instance.mcp_id, loadTime)

    // Auto-save if enabled (saves to Cursor's config file)
    if (auto_save && !use_saved) {
      try {
        this.configManager.saveConfig(mcp_name, configToUse)
      } catch (error: any) {
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

  private async handleExecuteCode(args: any) {
    let validated: any
    try {
      validated = validateInput(ExecuteCodeRequestSchema, args)
    } catch (error: any) {
      throw new MCPIsolateError(
        `Invalid input: ${error.message}`,
        'VALIDATION_ERROR',
        400,
        { validation_errors: error.errors || error },
      )
    }

    // Validate code for security
    try {
      validateTypeScriptCode(validated.code)
    } catch (error: any) {
      throw new MCPIsolateError(
        `Code validation failed: ${error.message}`,
        'SECURITY_ERROR',
        403,
        { code_length: validated.code.length },
      )
    }

    // Check if MCP exists
    const instance = this.workerManager.getInstance(validated.mcp_id)
    if (!instance) {
      throw new MCPIsolateError(
        `MCP instance not found: ${validated.mcp_id}`,
        'NOT_FOUND',
        404,
        {
          mcp_id: validated.mcp_id,
          suggestion:
            'Use list_available_mcps or get_mcp_by_name to find the correct MCP ID',
        },
      )
    }

    const result = await this.workerManager.executeCode(
      validated.mcp_id,
      validated.code,
      validated.timeout_ms,
    )

    this.metricsCollector.recordExecution(
      validated.mcp_id,
      result.execution_time_ms,
      result.success,
      result.metrics?.mcp_calls_made || 0,
    )

    // Enhance error response if execution failed
    if (!result.success) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error_code: 'EXECUTION_ERROR',
                error_message: result.error || 'Code execution failed',
                suggested_action: this.getExecutionErrorSuggestion(
                  result.error,
                ),
                context: {
                  mcp_id: validated.mcp_id,
                  mcp_name: instance.mcp_name,
                  code_length: validated.code.length,
                  timeout_ms: validated.timeout_ms,
                },
                execution_time_ms: result.execution_time_ms,
                metrics: result.metrics,
                output: result.output,
              },
              null,
              2,
            ),
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

  private getExecutionErrorSuggestion(error?: string): string {
    if (!error) {
      return 'Review the code and try again. Check that all MCP tool calls are correct.'
    }

    const errorLower = error.toLowerCase()

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

  private async handleGetSchema(args: any) {
    const { mcp_id } = args

    if (!mcp_id || typeof mcp_id !== 'string') {
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

  private async handleGetMCPByName(args: any) {
    const { mcp_name } = args

    if (!mcp_name || typeof mcp_name !== 'string') {
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

  private async handleUnloadMCP(args: any) {
    const { mcp_id, remove_from_saved = false } = args

    if (!mcp_id || typeof mcp_id !== 'string') {
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
      } catch (error: any) {
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
      MCP_CONNECTION_ERROR: `Failed to connect to MCP server. Verify the MCP configuration (command, args, env) and ensure the MCP server is accessible.`,
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
    const exampleParams: Record<string, any> = {}

    paramKeys.forEach((key: string) => {
      const schema = params[key]
      if (schema.type === 'string') {
        exampleParams[key] = 'example_value'
      } else if (schema.type === 'number') {
        exampleParams[key] = 1
      } else if (schema.type === 'boolean') {
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
    const exampleParams: Record<string, any> = {}

    paramKeys.forEach((key) => {
      const schema = params[key]
      if (schema.type === 'string') {
        exampleParams[key] = schema.description?.toLowerCase().includes('query')
          ? 'typescript'
          : 'example'
      } else if (schema.type === 'number') {
        exampleParams[key] = 1
      } else if (schema.type === 'boolean') {
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

  private async handleListSavedConfigs() {
    const savedConfigs = this.configManager.getSavedConfigs()

    const configs = Object.entries(savedConfigs).map(([name, entry]) => ({
      mcp_name: name,
      config: entry.config,
      source: entry.source,
    }))

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              configs,
              total_count: configs.length,
              config_path: this.configManager.getCursorConfigPath(),
              config_source: this.configManager.getConfigSource(),
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleSaveConfig(args: any) {
    const { mcp_name, mcp_config } = args

    if (!mcp_name || typeof mcp_name !== 'string') {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    if (!mcp_config || typeof mcp_config !== 'object') {
      throw new MCPIsolateError(
        'mcp_config is required and must be an object',
        'INVALID_INPUT',
        400,
      )
    }

    // Validate config structure
    if (!mcp_config.command) {
      throw new MCPIsolateError(
        'mcp_config.command is required',
        'INVALID_INPUT',
        400,
      )
    }

    this.configManager.saveConfig(mcp_name, mcp_config)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `MCP configuration '${mcp_name}' saved successfully`,
              config_path: this.configManager.getCursorConfigPath(),
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleDeleteConfig(args: any) {
    const { mcp_name } = args

    if (!mcp_name || typeof mcp_name !== 'string') {
      throw new MCPIsolateError(
        'mcp_name is required and must be a string',
        'INVALID_INPUT',
        400,
      )
    }

    const deleted = this.configManager.deleteConfig(mcp_name)

    if (!deleted) {
      const sourceName = this.configManager.getConfigSourceDisplayName()
      throw new MCPIsolateError(
        `MCP configuration '${mcp_name}' not found in ${sourceName} config file`,
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
              success: true,
              message: `MCP configuration '${mcp_name}' deleted successfully`,
              config_path: this.configManager.getCursorConfigPath(),
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  private async handleImportCursorConfigs(args: any) {
    const { cursor_config_path } = args || {}

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
      } catch (error: any) {
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
