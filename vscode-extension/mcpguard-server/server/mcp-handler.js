import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ExecuteCodeRequestSchema, LoadMCPRequestSchema, } from '../types/mcp.js';
import { ConfigManager } from '../utils/config-manager.js';
import { MCPConnectionError, MCPIsolateError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { cleanupSchemaCache, getCachedSchema } from '../utils/mcp-registry.js';
import { validateInput, validateTypeScriptCode } from '../utils/validation.js';
import { MetricsCollector } from './metrics-collector.js';
import { WorkerManager } from './worker-manager.js';
export class MCPHandler {
    server;
    workerManager;
    metricsCollector;
    configManager;
    discoveredMCPTools = new Map();
    discoveredMCPPrompts = new Map();
    constructor() {
        this.server = new Server({
            name: 'mcpguard',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
                prompts: {},
            },
        });
        this.workerManager = new WorkerManager();
        this.metricsCollector = new MetricsCollector();
        this.configManager = new ConfigManager();
        cleanupSchemaCache();
        this.setupHandlers();
    }
    parseToolNamespace(namespacedName) {
        const parts = namespacedName.split('::');
        if (parts.length === 2) {
            return { mcpName: parts[0], toolName: parts[1] };
        }
        return null;
    }
    async discoverConfiguredMCPs() {
        const allMCPs = this.configManager.getAllConfiguredMCPs();
        const mcpMap = new Map();
        for (const [name, entry] of Object.entries(allMCPs)) {
            mcpMap.set(name, entry);
        }
        return mcpMap;
    }
    async ensureMCPToolsLoaded(mcpName) {
        if (this.discoveredMCPTools.has(mcpName)) {
            return;
        }
        const configuredMCPs = await this.discoverConfiguredMCPs();
        const entry = configuredMCPs.get(mcpName);
        if (!entry) {
            return;
        }
        try {
            const resolvedConfig = this.configManager.resolveEnvVarsInObject(entry.config);
            const tools = await this.workerManager.loadMCPSchemaOnly(mcpName, resolvedConfig);
            if (tools.length > 0) {
                this.discoveredMCPTools.set(mcpName, tools);
                logger.debug({ mcpName, toolCount: tools.length }, 'Lazy-loaded MCP tools for transparent proxy');
            }
        }
        catch (error) {
            logger.warn({ error, mcpName }, 'Failed to lazy-load MCP tools for transparent proxy');
        }
    }
    async ensureMCPPromptsLoaded(mcpName) {
        if (this.discoveredMCPPrompts.has(mcpName)) {
            return;
        }
        const configuredMCPs = await this.discoverConfiguredMCPs();
        const entry = configuredMCPs.get(mcpName);
        if (!entry) {
            return;
        }
        try {
            const resolvedConfig = this.configManager.resolveEnvVarsInObject(entry.config);
            const prompts = await this.workerManager.loadMCPPromptsOnly(mcpName, resolvedConfig);
            if (prompts.length > 0) {
                this.discoveredMCPPrompts.set(mcpName, prompts);
                logger.debug({ mcpName, promptCount: prompts.length }, 'Lazy-loaded MCP prompts for transparent proxy');
            }
        }
        catch (error) {
            logger.warn({ error, mcpName }, 'Failed to lazy-load MCP prompts for transparent proxy');
        }
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            logger.debug('Listing available tools');
            const mcpGuardTools = [
                {
                    name: 'connect',
                    description: 'Manually connect to an MCP server and load it into a secure isolated Worker environment. Usually not needed - call_mcp will auto-connect when needed. Use this if you need to pre-connect to an MCP or connect with a custom configuration. Can use a saved configuration or load with a new configuration. Automatically saves the configuration unless auto_save is false.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mcp_name: {
                                type: 'string',
                                description: 'Unique identifier for this MCP instance (alphanumeric, hyphens, underscores only)',
                            },
                            mcp_config: {
                                type: 'object',
                                description: 'MCP server connection configuration. Required if use_saved is false. Can use $' +
                                    '{VAR_NAME} syntax for environment variables.',
                                properties: {
                                    command: {
                                        type: 'string',
                                        description: 'Command to launch the MCP server (e.g., "npx", "node", "python")',
                                    },
                                    args: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        description: 'Arguments for the MCP server command',
                                    },
                                    env: {
                                        type: 'object',
                                        description: 'Environment variables for the MCP server. Use $' +
                                            '{VAR_NAME} syntax to reference .env variables.',
                                    },
                                },
                                required: ['command'],
                            },
                            use_saved: {
                                type: 'boolean',
                                description: 'If true, load configuration from saved configs instead of using mcp_config. Default: false',
                                default: false,
                            },
                            auto_save: {
                                type: 'boolean',
                                description: 'If true, automatically save the configuration after loading. Default: true',
                                default: true,
                            },
                        },
                        required: ['mcp_name'],
                    },
                },
                {
                    name: 'call_mcp',
                    description: `PRIMARY tool for interacting with MCPs. Auto-connects to MCPs from IDE config if needed. Use this instead of calling MCP tools directly. All MCP operations should go through this tool for secure isolation and efficiency.

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
// Search for repositories (MCP auto-connects if not already connected)
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

IMPORTANT: Provide either mcp_name (to auto-connect from IDE config) or mcp_id (if already connected). Using mcp_name is recommended as it automatically connects to the MCP when needed.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mcp_id: {
                                type: 'string',
                                description: 'UUID of the connected MCP server (returned from connect). Use if MCP is already connected. Otherwise, use mcp_name to auto-connect.',
                            },
                            mcp_name: {
                                type: 'string',
                                description: 'Name of the MCP server from IDE config (e.g., "github", "filesystem"). Auto-connects to the MCP if not already connected. Use search_mcp_tools to discover available MCPs.',
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
                                description: 'Execution timeout in milliseconds (default: 30000, max: 60000)',
                                default: 30000,
                            },
                        },
                        required: ['code'],
                    },
                },
                {
                    name: 'list_available_mcps',
                    description: 'List all MCP servers currently connected in Worker isolates. Returns a list with MCP IDs, names, status, and tool counts. Use get_mcp_by_name to find a specific MCP by name. Note: MCPs are auto-connected when call_mcp is called with mcp_name, so this shows actively connected MCPs.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'get_mcp_by_name',
                    description: 'Find a connected MCP server by its name. Returns the MCP ID and basic information for quick lookup. This is more efficient than calling list_available_mcps and searching manually.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mcp_name: {
                                type: 'string',
                                description: 'Name of the MCP server to find (the name used when loading the MCP)',
                            },
                        },
                        required: ['mcp_name'],
                    },
                },
                {
                    name: 'get_mcp_schema',
                    description: 'Get the TypeScript API definition for a connected MCP server',
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
                    name: 'disconnect',
                    description: 'Disconnect from an MCP server and clean up its Worker isolate. Optionally remove from saved configurations.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mcp_id: {
                                type: 'string',
                                description: 'UUID of the loaded MCP server to unload',
                            },
                            remove_from_saved: {
                                type: 'boolean',
                                description: 'If true, also remove the MCP configuration from the IDE config file (Claude Code or Cursor). Default: false',
                                default: false,
                            },
                        },
                        required: ['mcp_id'],
                    },
                },
                {
                    name: 'get_metrics',
                    description: 'Get performance metrics and statistics for MCP operations',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'import_configs',
                    description: 'Refresh/import MCP configurations from IDE configuration file (Claude Code, GitHub Copilot, or Cursor). Automatically discovers config location or uses provided path. Checks IDEs in priority order.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cursor_config_path: {
                                type: 'string',
                                description: 'Optional: Path to IDE config file. If not provided, will search default locations for Claude Code, GitHub Copilot, and Cursor.',
                            },
                        },
                    },
                },
                {
                    name: 'search_mcp_tools',
                    description: 'Search and discover MCP servers configured in your IDE. Returns all configured MCPs (except mcpguard) with their status and available tools. Use this to find which MCPs are available before calling call_mcp. Implements the search_tools pattern for progressive disclosure - discover tools on-demand rather than loading all definitions upfront.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Optional search term to filter by MCP name or tool name. If not provided, returns all configured MCPs.',
                            },
                            detail_level: {
                                type: 'string',
                                enum: ['summary', 'tools', 'full'],
                                description: 'Level of detail to return. summary: just MCP names and status. tools: includes tool names. full: includes full tool schemas (only for loaded MCPs). Default: summary',
                                default: 'summary',
                            },
                        },
                    },
                },
                {
                    name: 'guard',
                    description: "Guard MCP servers by routing them through MCPGuard's secure isolation. This prevents the IDE from loading their tools into the context window unnecessarily, maximizing efficiency and ensuring all tool calls are protected. Can guard specific MCPs or all MCPs except mcpguard.",
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mcp_names: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of MCP names to disable. If not provided or empty, disables all MCPs except mcpguard.',
                            },
                        },
                    },
                },
            ];
            const aggregatedTools = [...mcpGuardTools];
            logger.debug({
                mcpGuardToolsCount: mcpGuardTools.length,
                totalToolsCount: aggregatedTools.length,
                note: 'MCP tools are loaded lazily on-demand for efficiency',
            }, 'Returning MCPGuard tools (MCP tools loaded lazily)');
            return {
                tools: aggregatedTools,
            };
        });
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
            logger.debug('Listing available prompts');
            const configuredMCPs = await this.discoverConfiguredMCPs();
            const guardedMCPs = [];
            for (const [mcpName, entry] of configuredMCPs.entries()) {
                if (entry.status === 'disabled') {
                    guardedMCPs.push(mcpName);
                }
            }
            const promptLoadPromises = guardedMCPs.map((mcpName) => this.ensureMCPPromptsLoaded(mcpName));
            await Promise.all(promptLoadPromises);
            const aggregatedPrompts = [];
            for (const mcpName of guardedMCPs) {
                const prompts = this.discoveredMCPPrompts.get(mcpName);
                if (prompts && prompts.length > 0) {
                    for (const prompt of prompts) {
                        let namespacedName = prompt.name;
                        if (!namespacedName.includes(':') &&
                            !namespacedName.includes('/')) {
                            namespacedName = `${mcpName}:${prompt.name}`;
                        }
                        else if (namespacedName.includes('/')) {
                            const parts = namespacedName.split('/');
                            if (parts.length === 2 && parts[0] === mcpName) {
                                namespacedName = `${parts[0]}:${parts[1]}`;
                            }
                            else {
                                namespacedName = `${mcpName}:${prompt.name}`;
                            }
                        }
                        aggregatedPrompts.push({
                            name: namespacedName,
                            description: prompt.description,
                            arguments: prompt.arguments,
                        });
                    }
                }
            }
            logger.debug({
                guardedMCPsCount: guardedMCPs.length,
                totalPromptsCount: aggregatedPrompts.length,
                promptNames: aggregatedPrompts.map((p) => p.name),
            }, 'Returning aggregated prompts from guarded MCPs');
            return {
                prompts: aggregatedPrompts,
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            logger.info({ tool: name, args }, 'Tool called');
            try {
                const namespace = this.parseToolNamespace(name);
                if (namespace) {
                    await this.ensureMCPToolsLoaded(namespace.mcpName);
                    return await this.routeToolCall(namespace.mcpName, namespace.toolName, args);
                }
                switch (name) {
                    case 'connect':
                        return await this.handleLoadMCP(args);
                    case 'call_mcp':
                        return await this.handleExecuteCode(args);
                    case 'list_available_mcps':
                        return await this.handleListMCPs();
                    case 'get_mcp_by_name':
                        return await this.handleGetMCPByName(args);
                    case 'get_mcp_schema':
                        return await this.handleGetSchema(args);
                    case 'disconnect':
                        return await this.handleUnloadMCP(args);
                    case 'get_metrics':
                        return await this.handleGetMetrics();
                    case 'import_configs':
                        return await this.handleImportCursorConfigs(args);
                    case 'search_mcp_tools':
                        return await this.handleSearchMCPTools(args);
                    case 'guard':
                        return await this.handleDisableMCPs(args);
                    default: {
                        const configuredMCPs = await this.discoverConfiguredMCPs();
                        for (const [mcpName] of configuredMCPs.entries()) {
                            await this.ensureMCPToolsLoaded(mcpName);
                            const tools = this.discoveredMCPTools.get(mcpName);
                            if (tools?.some((t) => t.name === name)) {
                                throw new MCPIsolateError(`Tool "${name}" requires namespace. Use "${mcpName}::${name}" instead.`, 'UNKNOWN_TOOL', 404, {
                                    tool_name: name,
                                    suggested_name: `${mcpName}::${name}`,
                                    mcp_name: mcpName,
                                });
                            }
                        }
                        throw new MCPIsolateError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL', 404);
                    }
                }
            }
            catch (error) {
                logger.error({ error, tool: name }, 'Tool execution failed');
                if (error instanceof MCPIsolateError) {
                    const isFatal = error.code === 'UNSUPPORTED_CONFIG' ||
                        error.code === 'MCP_CONNECTION_ERROR' ||
                        Boolean(error.details &&
                            typeof error.details === 'object' &&
                            'fatal' in error.details &&
                            error.details.fatal === true);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error_code: error.code,
                                    error_message: error.message,
                                    suggested_action: this.getSuggestedAction(error.code, name),
                                    context: {
                                        tool: name,
                                        status_code: error.statusCode,
                                    },
                                    details: error.details,
                                    fatal: isFatal,
                                    ...(isFatal
                                        ? {
                                            instruction: 'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.',
                                        }
                                        : {}),
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const errorStack = error instanceof Error ? error.stack : undefined;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error_code: 'INTERNAL_ERROR',
                                error_message: 'Internal server error',
                                suggested_action: 'Check logs for details. If the error persists, try reloading the MCP server.',
                                context: {
                                    tool: name,
                                    original_error: errorMessage,
                                },
                                details: {
                                    stack: errorStack,
                                },
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        });
        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            logger.info({ prompt: name, args }, 'Prompt requested');
            try {
                const parts = name.split(':');
                if (parts.length < 2) {
                    throw new MCPIsolateError(`Invalid prompt name format: ${name}. Expected format: mcpName:promptName`, 'INVALID_INPUT', 400);
                }
                const mcpName = parts[0];
                const actualPromptName = parts.slice(1).join(':');
                let instance = this.workerManager.getMCPByName(mcpName);
                if (!instance) {
                    const allMCPs = this.configManager.getAllConfiguredMCPs();
                    const mcpEntry = allMCPs[mcpName];
                    if (!mcpEntry) {
                        throw new MCPIsolateError(`MCP "${mcpName}" not found in IDE configuration. Use search_mcp_tools to see available MCPs.`, 'NOT_FOUND', 404, {
                            mcp_name: mcpName,
                            suggestion: 'Use search_mcp_tools to discover configured MCPs, or use connect to connect to a new MCP.',
                        });
                    }
                    if (mcpEntry.status === 'active') {
                        throw new MCPIsolateError(`MCP "${mcpName}" is unguarded and should be called directly by the IDE, not through MCPGuard. To use MCPGuard, first guard this MCP in your IDE configuration.`, 'UNGUARDED_MCP', 400, {
                            mcp_name: mcpName,
                            status: 'active',
                            suggestion: 'This MCP is not guarded. Either call its prompts directly, or guard it first using the VS Code extension or by moving it to _mcpguard_disabled in your IDE config.',
                        });
                    }
                    const resolvedConfig = this.configManager.resolveEnvVarsInObject(mcpEntry.config);
                    logger.info({ mcp_name: mcpName }, 'Auto-connecting MCP for prompt request');
                    const startTime = Date.now();
                    try {
                        const loadedInstance = await this.workerManager.loadMCP(mcpName, resolvedConfig);
                        const loadTime = Date.now() - startTime;
                        this.metricsCollector.recordMCPLoad(loadedInstance.mcp_id, loadTime);
                        instance = loadedInstance;
                        logger.info({
                            mcp_name: mcpName,
                            mcp_id: instance.mcp_id,
                            load_time_ms: loadTime,
                        }, 'MCP auto-loaded for prompt request');
                    }
                    catch (error) {
                        if (error instanceof MCPConnectionError) {
                            throw new MCPConnectionError(error.message, {
                                mcp_name: mcpName,
                                original_error: error.details,
                                fatal: true,
                            });
                        }
                        throw error;
                    }
                }
                const client = this.workerManager.getMCPClient(instance.mcp_id);
                if (!client) {
                    throw new MCPIsolateError(`MCP client not found for ID: ${instance.mcp_id}`, 'NOT_FOUND', 404);
                }
                logger.debug({ mcpName, promptName: actualPromptName, originalName: name, args }, 'Calling getPrompt on MCP client');
                let promptResponse;
                let lastError;
                try {
                    promptResponse = await client.getPrompt({
                        name: actualPromptName,
                        arguments: args,
                    });
                }
                catch (error) {
                    lastError = error;
                    const nameWithSlash = `${mcpName}/${actualPromptName}`;
                    try {
                        logger.debug({ mcpName, attemptedName: nameWithSlash }, 'Stripped name failed, trying with slash namespace');
                        promptResponse = await client.getPrompt({
                            name: nameWithSlash,
                            arguments: args,
                        });
                    }
                    catch (error2) {
                        lastError = error2;
                        try {
                            logger.debug({ mcpName, attemptedName: name }, 'Slash namespace failed, trying with colon namespace');
                            promptResponse = await client.getPrompt({
                                name: name,
                                arguments: args,
                            });
                        }
                        catch (_error3) {
                            throw lastError;
                        }
                    }
                }
                logger.info({ mcpName, promptName: actualPromptName }, 'Prompt retrieved successfully');
                if (promptResponse &&
                    typeof promptResponse === 'object' &&
                    ('description' in promptResponse || 'messages' in promptResponse)) {
                    return promptResponse;
                }
                return promptResponse;
            }
            catch (error) {
                logger.error({ error, prompt: name }, 'Prompt request failed');
                if (error instanceof MCPIsolateError) {
                    const isFatal = error.code === 'UNSUPPORTED_CONFIG' ||
                        error.code === 'MCP_CONNECTION_ERROR' ||
                        Boolean(error.details &&
                            typeof error.details === 'object' &&
                            'fatal' in error.details &&
                            error.details.fatal === true);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error_code: error.code,
                                    error_message: error.message,
                                    suggested_action: this.getSuggestedAction(error.code, name),
                                    context: {
                                        prompt: name,
                                        status_code: error.statusCode,
                                    },
                                    details: error.details,
                                    fatal: isFatal,
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const errorStack = error instanceof Error ? error.stack : undefined;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error_code: 'INTERNAL_ERROR',
                                error_message: 'Internal server error',
                                suggested_action: 'Check logs for details. If the error persists, try reloading the MCP server.',
                                context: {
                                    prompt: name,
                                    original_error: errorMessage,
                                },
                                details: {
                                    stack: errorStack,
                                },
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async handleLoadMCP(args) {
        if (!args ||
            typeof args !== 'object' ||
            !('mcp_name' in args) ||
            typeof args.mcp_name !== 'string') {
            throw new MCPIsolateError('mcp_name is required and must be a string', 'INVALID_INPUT', 400);
        }
        const { mcp_name, mcp_config, use_saved = false, auto_save = true, } = args;
        let configToUse;
        if (use_saved) {
            const savedConfig = this.configManager.getSavedConfig(mcp_name);
            if (!savedConfig) {
                throw new MCPIsolateError(`No saved configuration found for MCP: ${mcp_name}. Use search_mcp_tools to see available MCPs.`, 'NOT_FOUND', 404);
            }
            configToUse = savedConfig;
        }
        else {
            if (!mcp_config) {
                throw new MCPIsolateError('mcp_config is required when use_saved is false', 'INVALID_INPUT', 400);
            }
            const validated = validateInput(LoadMCPRequestSchema, {
                mcp_name,
                mcp_config,
            });
            configToUse = validated.mcp_config;
        }
        const resolvedConfig = this.configManager.resolveEnvVarsInObject(configToUse);
        const startTime = Date.now();
        const instance = await this.workerManager.loadMCP(mcp_name, resolvedConfig);
        const loadTime = Date.now() - startTime;
        this.metricsCollector.recordMCPLoad(instance.mcp_id, loadTime);
        if (auto_save && !use_saved) {
            try {
                this.configManager.saveConfig(mcp_name, configToUse);
            }
            catch (error) {
                logger.warn({ error, mcp_name }, 'Failed to auto-save MCP config');
            }
        }
        const usageExample = this.generateUsageExample(instance.tools);
        const exampleCode = this.generateExampleCode(instance.tools);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
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
                    }, null, 2),
                },
            ],
        };
    }
    async handleExecuteCode(args) {
        let validated;
        try {
            const result = validateInput(ExecuteCodeRequestSchema, args);
            validated = {
                ...result,
                timeout_ms: result.timeout_ms ?? 30000,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorDetails = error && typeof error === 'object' && 'errors' in error
                ? error.errors || error
                : error;
            throw new MCPIsolateError(`Invalid input: ${errorMessage}`, 'VALIDATION_ERROR', 400, { validation_errors: errorDetails });
        }
        try {
            validateTypeScriptCode(validated.code);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new MCPIsolateError(`Code validation failed: ${errorMessage}`, 'SECURITY_ERROR', 403, { code_length: validated.code.length });
        }
        let mcpId;
        let instance = this.workerManager.getInstance(validated.mcp_id || '');
        if (validated.mcp_name) {
            const existingInstance = this.workerManager.getMCPByName(validated.mcp_name);
            if (existingInstance) {
                mcpId = existingInstance.mcp_id;
                instance = existingInstance;
            }
            else {
                const allMCPs = this.configManager.getAllConfiguredMCPs();
                const mcpEntry = allMCPs[validated.mcp_name];
                if (!mcpEntry) {
                    throw new MCPIsolateError(`MCP "${validated.mcp_name}" not found in IDE configuration. Use search_mcp_tools to see available MCPs.`, 'NOT_FOUND', 404, {
                        mcp_name: validated.mcp_name,
                        suggestion: 'Use search_mcp_tools to discover configured MCPs, or use connect to connect to a new MCP.',
                    });
                }
                if (mcpEntry.status === 'active') {
                    throw new MCPIsolateError(`MCP "${validated.mcp_name}" is unguarded and should be called directly by the LLM, not through MCPGuard. To use MCPGuard isolation, first guard this MCP in your IDE configuration.`, 'UNGUARDED_MCP', 400, {
                        mcp_name: validated.mcp_name,
                        status: 'active',
                        suggestion: 'This MCP is not guarded. Either call its tools directly, or guard it first using the VS Code extension or by moving it to _mcpguard_disabled in your IDE config.',
                    });
                }
                const resolvedConfig = this.configManager.resolveEnvVarsInObject(mcpEntry.config);
                logger.info({ mcp_name: validated.mcp_name }, 'Auto-connecting MCP for call_mcp');
                const startTime = Date.now();
                try {
                    const loadedInstance = await this.workerManager.loadMCP(validated.mcp_name, resolvedConfig);
                    const loadTime = Date.now() - startTime;
                    this.metricsCollector.recordMCPLoad(loadedInstance.mcp_id, loadTime);
                    mcpId = loadedInstance.mcp_id;
                    instance = loadedInstance;
                    logger.info({
                        mcp_name: validated.mcp_name,
                        mcp_id: mcpId,
                        load_time_ms: loadTime,
                    }, 'MCP auto-loaded successfully');
                }
                catch (error) {
                    if (error instanceof MCPConnectionError) {
                        throw new MCPConnectionError(error.message, {
                            mcp_name: validated.mcp_name,
                            original_error: error.details,
                            fatal: true,
                        });
                    }
                    throw error;
                }
            }
        }
        else if (validated.mcp_id) {
            mcpId = validated.mcp_id;
            instance = this.workerManager.getInstance(mcpId);
            if (!instance) {
                throw new MCPIsolateError(`MCP instance not found: ${mcpId}`, 'NOT_FOUND', 404, {
                    mcp_id: mcpId,
                    suggestion: 'Use list_available_mcps or get_mcp_by_name to find the correct MCP ID, or use mcp_name instead to auto-load.',
                });
            }
        }
        else {
            throw new MCPIsolateError('Either mcp_id or mcp_name must be provided', 'INVALID_INPUT', 400);
        }
        const result = await this.workerManager.executeCode(mcpId, validated.code, validated.timeout_ms ?? 30000);
        this.metricsCollector.recordExecution(mcpId, result.execution_time_ms, result.success, result.metrics?.mcp_calls_made || 0);
        if (!result.success) {
            const errorMessage = result.error || '';
            const errorDetails = result.error_details;
            const hasWranglerError = errorMessage.includes('Wrangler execution failed') ||
                errorMessage.includes('Wrangler process') ||
                errorMessage.includes('Wrangler dev server') ||
                Boolean(errorDetails &&
                    typeof errorDetails === 'object' &&
                    ('wrangler_stderr' in errorDetails ||
                        'wrangler_stdout' in errorDetails));
            const isFatal = errorMessage.includes('MCP_CONNECTION_ERROR') ||
                errorMessage.includes('URL-based MCP') ||
                errorMessage.includes('cannot be loaded') ||
                hasWranglerError ||
                Boolean(errorDetails &&
                    typeof errorDetails === 'object' &&
                    'fatal' in errorDetails &&
                    errorDetails.fatal === true);
            let wranglerError = null;
            if (hasWranglerError &&
                errorDetails &&
                typeof errorDetails === 'object') {
                const stderr = 'wrangler_stderr' in errorDetails
                    ? String(errorDetails.wrangler_stderr)
                    : '';
                const stdout = 'wrangler_stdout' in errorDetails
                    ? String(errorDetails.wrangler_stdout)
                    : '';
                const formattedError = this.formatWranglerError(stderr, stdout);
                wranglerError = {
                    stderr: stderr
                        ? this.filterWranglerOutput(stderr).join('\n')
                        : undefined,
                    stdout: stdout
                        ? this.filterWranglerOutput(stdout).join('\n')
                        : undefined,
                    exit_code: 'exit_code' in errorDetails
                        ? Number(errorDetails.exit_code)
                        : undefined,
                    formatted_error: formattedError,
                };
            }
            const errorResponse = {
                success: false,
                error_code: 'EXECUTION_ERROR',
                error_message: result.error || 'Code execution failed',
                suggested_action: this.getExecutionErrorSuggestion(result.error),
                fatal: isFatal,
                execution_time_ms: result.execution_time_ms,
            };
            if (wranglerError) {
                errorResponse.wrangler_error = wranglerError;
                if (wranglerError.formatted_error) {
                    errorResponse.error_message = `${errorResponse.error_message}\n\n${wranglerError.formatted_error}`;
                }
            }
            if (isFatal) {
                errorResponse.instruction =
                    'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.';
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(errorResponse, null, 2),
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    formatWranglerError(stderr, stdout) {
        const lines = [];
        if (stderr) {
            const stderrLines = this.filterWranglerOutput(stderr);
            lines.push(...stderrLines);
        }
        if (stdout) {
            const stdoutLines = this.filterWranglerOutput(stdout);
            lines.push(...stdoutLines);
        }
        return lines.join('\n').trim();
    }
    filterWranglerOutput(output) {
        const lines = output.split('\n');
        const filtered = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            if (trimmed.startsWith('⛅️') || trimmed.includes('wrangler ')) {
                continue;
            }
            if (/^[─═]+$/.test(trimmed)) {
                continue;
            }
            if (trimmed.includes('Using vars defined in .env') ||
                trimmed.includes('Your Worker has access to') ||
                trimmed.includes('Binding') ||
                trimmed.includes('Resource') ||
                trimmed.includes('Environment Variable local') ||
                /^env\..+\("\(hidden\)"\)/.test(trimmed)) {
                continue;
            }
            if (trimmed.includes('Starting local server') ||
                trimmed.includes('Ready on http')) {
                continue;
            }
            if (/\[wrangler:info\].*\b(200|201|204|304)\b/.test(trimmed)) {
                continue;
            }
            if (trimmed.includes('[ERROR]') ||
                trimmed.includes('✗') ||
                trimmed.includes('Build failed') ||
                /\b(4\d\d|5\d\d)\b/.test(trimmed) ||
                trimmed.includes('Error:') ||
                trimmed.includes('at ')) {
                filtered.push(line);
                continue;
            }
            if (/\w+\.(ts|js|tsx|jsx):\d+:\d+/.test(trimmed)) {
                filtered.push(line);
                continue;
            }
            if (filtered.length < 20) {
                filtered.push(line);
            }
        }
        return filtered;
    }
    getExecutionErrorSuggestion(error) {
        if (!error) {
            return 'Review the code and try again. Check that all MCP tool calls are correct.';
        }
        const errorLower = error.toLowerCase();
        if (errorLower.includes('wrangler')) {
            if (errorLower.includes('missing entry-point') ||
                errorLower.includes('entry-point')) {
                return 'Wrangler configuration error: Missing entry point. This is a fatal error - MCPGuard cannot execute code without a properly configured Worker runtime. Check that src/worker/runtime.ts exists and wrangler.toml is correctly configured.';
            }
            if (errorLower.includes('exited with code')) {
                return 'Wrangler execution failed. This is a fatal error - MCPGuard cannot execute code. Check the error_details for Wrangler stderr/stdout output to diagnose the issue. Common causes: missing dependencies, configuration errors, or Wrangler version incompatibility.';
            }
            return 'Wrangler execution error. This is a fatal error - MCPGuard cannot execute code. Check the error_details for detailed Wrangler output. Ensure Wrangler is installed (npx wrangler --version) and the Worker runtime is properly configured.';
        }
        if (errorLower.includes('timeout')) {
            return 'Execution timed out. Try increasing timeout_ms or optimizing the code to run faster.';
        }
        if (errorLower.includes('not defined') ||
            errorLower.includes('undefined')) {
            return 'A variable or function is not defined. Check that all MCP tool calls use the correct tool names from the available_tools list.';
        }
        if (errorLower.includes('rpc') || errorLower.includes('binding')) {
            return 'MCP RPC binding error. The MCP server may not be ready or the RPC mechanism needs to be implemented.';
        }
        if (errorLower.includes('syntax')) {
            return 'Syntax error in the code. Review the TypeScript syntax and ensure all brackets, parentheses, and quotes are properly closed.';
        }
        return 'Review the error message and code. Ensure MCP tools are called correctly with the right parameters. Use get_mcp_schema to see the tool definitions.';
    }
    async handleListMCPs() {
        const instances = this.workerManager.listInstances();
        const mcpNameToId = {};
        instances.forEach((instance) => {
            mcpNameToId[instance.mcp_name] = instance.mcp_id;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
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
                    }, null, 2),
                },
            ],
        };
    }
    async handleGetSchema(args) {
        if (!args ||
            typeof args !== 'object' ||
            !('mcp_id' in args) ||
            typeof args.mcp_id !== 'string') {
            throw new MCPIsolateError('mcp_id is required and must be a string', 'INVALID_INPUT', 400);
        }
        const { mcp_id } = args;
        if (!mcp_id) {
            throw new MCPIsolateError('mcp_id is required and must be a string', 'INVALID_INPUT', 400);
        }
        const instance = this.workerManager.getInstance(mcp_id);
        if (!instance) {
            throw new MCPIsolateError(`MCP instance not found: ${mcp_id}`, 'NOT_FOUND', 404);
        }
        const commonPatterns = this.generateCommonPatterns(instance.tools);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        mcp_id: instance.mcp_id,
                        mcp_name: instance.mcp_name,
                        typescript_api: instance.typescript_api,
                        tools: instance.tools,
                        common_patterns: commonPatterns,
                    }, null, 2),
                },
            ],
        };
    }
    async handleGetMCPByName(args) {
        if (!args ||
            typeof args !== 'object' ||
            !('mcp_name' in args) ||
            typeof args.mcp_name !== 'string') {
            throw new MCPIsolateError('mcp_name is required and must be a string', 'INVALID_INPUT', 400);
        }
        const { mcp_name } = args;
        if (!mcp_name) {
            throw new MCPIsolateError('mcp_name is required and must be a string', 'INVALID_INPUT', 400);
        }
        const instance = this.workerManager.getMCPByName(mcp_name);
        if (!instance) {
            throw new MCPIsolateError(`MCP not found with name: ${mcp_name}`, 'NOT_FOUND', 404);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        mcp_id: instance.mcp_id,
                        mcp_name: instance.mcp_name,
                        status: instance.status,
                        tools_count: instance.tools.length,
                        available_tools: instance.tools.map((t) => t.name),
                        uptime_ms: instance.uptime_ms,
                        created_at: instance.created_at.toISOString(),
                    }, null, 2),
                },
            ],
        };
    }
    async handleUnloadMCP(args) {
        if (!args ||
            typeof args !== 'object' ||
            !('mcp_id' in args) ||
            typeof args.mcp_id !== 'string') {
            throw new MCPIsolateError('mcp_id is required and must be a string', 'INVALID_INPUT', 400);
        }
        const { mcp_id, remove_from_saved = false } = args;
        if (!mcp_id) {
            throw new MCPIsolateError('mcp_id is required and must be a string', 'INVALID_INPUT', 400);
        }
        const instance = this.workerManager.getInstance(mcp_id);
        const mcpName = instance?.mcp_name;
        await this.workerManager.unloadMCP(mcp_id);
        let configRemoved = false;
        if (remove_from_saved && mcpName) {
            try {
                configRemoved = this.configManager.deleteConfig(mcpName);
            }
            catch (error) {
                logger.warn({ error, mcpName }, 'Failed to remove config from IDE config file');
            }
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `MCP server ${mcp_id} unloaded successfully`,
                        config_removed: configRemoved,
                    }, null, 2),
                },
            ],
        };
    }
    async handleGetMetrics() {
        const metrics = this.metricsCollector.getMetrics();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(metrics, null, 2),
                },
            ],
        };
    }
    getSuggestedAction(errorCode, toolName) {
        const suggestions = {
            NOT_FOUND: `MCP not found. Use list_available_mcps to see loaded MCPs, or use get_mcp_by_name to find by name.`,
            INVALID_INPUT: `Invalid input provided. Check the tool's inputSchema for required parameters and their types.`,
            VALIDATION_ERROR: `Input validation failed. Review the error details and ensure all required fields are provided with correct types.`,
            WORKER_ERROR: `Worker execution error. The MCP may not be ready. Check the MCP status with list_available_mcps.`,
            MCP_CONNECTION_ERROR: `Failed to connect to MCP server. This is a fatal error - do not attempt alternative approaches. Verify the MCP configuration (command, args, env for command-based, or url, headers for URL-based) and ensure the MCP server is accessible.`,
            UNSUPPORTED_CONFIG: `This MCP configuration is not supported. Check the configuration format and ensure it matches the expected schema.`,
            SECURITY_ERROR: `Code validation failed. The code contains prohibited patterns. Review the code and remove any dangerous operations.`,
            UNKNOWN_TOOL: `Unknown tool: ${toolName}. Check available tools with list_available_mcps.`,
        };
        return (suggestions[errorCode] ||
            'Review the error details and try again. If the issue persists, check the logs.');
    }
    generateUsageExample(tools) {
        if (tools.length === 0) {
            return 'No tools available.';
        }
        const firstTool = tools[0];
        const toolName = firstTool.name;
        const params = firstTool.inputSchema.properties || {};
        const paramKeys = Object.keys(params).slice(0, 2);
        const exampleParams = {};
        paramKeys.forEach((key) => {
            const schema = params[key];
            if (schema?.type === 'string') {
                exampleParams[key] = 'example_value';
            }
            else if (schema?.type === 'number') {
                exampleParams[key] = 1;
            }
            else if (schema?.type === 'boolean') {
                exampleParams[key] = true;
            }
        });
        return `To use this MCP, call call_mcp with code like:

\`\`\`typescript
const result = await mcp.${toolName}(${JSON.stringify(exampleParams, null, 2)});
console.log(JSON.stringify(result, null, 2));
\`\`\`

Available tools: ${tools.map((t) => t.name).join(', ')}`;
    }
    generateExampleCode(tools) {
        if (tools.length === 0) {
            return '// No tools available';
        }
        const firstTool = tools[0];
        const toolName = firstTool.name;
        const params = firstTool.inputSchema.properties || {};
        const required = firstTool.inputSchema.required || [];
        const paramKeys = required.length > 0
            ? required.slice(0, 2)
            : Object.keys(params).slice(0, 2);
        const exampleParams = {};
        paramKeys.forEach((key) => {
            const schema = params[key];
            if (schema?.type === 'string') {
                exampleParams[key] = schema.description?.toLowerCase().includes('query')
                    ? 'typescript'
                    : 'example';
            }
            else if (schema?.type === 'number') {
                exampleParams[key] = 1;
            }
            else if (schema?.type === 'boolean') {
                exampleParams[key] = true;
            }
        });
        return `// Example: Call ${toolName} tool
const result = await mcp.${toolName}(${JSON.stringify(exampleParams, null, 2)});
console.log(JSON.stringify(result, null, 2));`;
    }
    generateCommonPatterns(tools) {
        const patterns = [];
        if (tools.length > 0) {
            patterns.push(`// Call a tool: const result = await mcp.${tools[0].name}({ ... });`);
            patterns.push(`// Output results: console.log(JSON.stringify(result, null, 2));`);
        }
        if (tools.length > 1) {
            patterns.push(`// Chain multiple calls: const r1 = await mcp.${tools[0].name}({...}); const r2 = await mcp.${tools[1].name}({...});`);
        }
        patterns.push(`// Error handling: try { const result = await mcp.toolName({...}); } catch (error) { console.error('Error:', error.message); }`);
        return patterns;
    }
    async handleDisableMCPs(args) {
        const typedArgs = args && typeof args === 'object' ? args : {};
        const { mcp_names } = typedArgs;
        const configPath = this.configManager.getCursorConfigPath();
        if (!configPath) {
            throw new MCPIsolateError('No IDE MCP configuration file found. Please add MCPGuard to your IDE config first.', 'CONFIG_NOT_FOUND', 404);
        }
        const sourceName = this.configManager.getConfigSourceDisplayName();
        const result = {
            disabled: [],
            alreadyDisabled: [],
            failed: [],
            mcpguardRestored: false,
        };
        if (mcp_names && mcp_names.length > 0) {
            for (const mcpName of mcp_names) {
                if (mcpName.toLowerCase() === 'mcpguard') {
                    continue;
                }
                if (this.configManager.isMCPDisabled(mcpName)) {
                    result.alreadyDisabled.push(mcpName);
                }
                else if (this.configManager.disableMCP(mcpName)) {
                    result.disabled.push(mcpName);
                }
                else {
                    result.failed.push(mcpName);
                }
            }
        }
        else {
            const disableResult = this.configManager.disableAllExceptMCPGuard();
            result.disabled = disableResult.disabled;
            result.alreadyDisabled = disableResult.alreadyDisabled;
            result.failed = disableResult.failed;
            result.mcpguardRestored = disableResult.mcpguardRestored;
        }
        const response = {
            success: true,
            message: `MCPs disabled in ${sourceName} configuration`,
            source: sourceName,
            disabled: result.disabled,
            alreadyDisabled: result.alreadyDisabled,
            failed: result.failed,
            mcpguardRestored: result.mcpguardRestored,
        };
        if (result.disabled.length === 0 && result.alreadyDisabled.length === 0) {
            response.message = `All specified MCPs are already disabled in ${sourceName} config`;
        }
        if (result.failed.length > 0) {
            response.note = `Some MCPs could not be disabled. They may not exist in the configuration.`;
        }
        if (result.mcpguardRestored) {
            response.note = `${response.note ? `${response.note} ` : ''}MCPGuard was restored to active config.`;
        }
        logger.info({
            disabled: result.disabled,
            alreadyDisabled: result.alreadyDisabled,
            failed: result.failed,
            source: sourceName,
        }, 'MCPs guarded via guard tool');
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                },
            ],
        };
    }
    async handleImportCursorConfigs(args) {
        const typedArgs = args && typeof args === 'object' && 'cursor_config_path' in args
            ? args
            : {};
        const { cursor_config_path } = typedArgs;
        const result = this.configManager.importConfigs(cursor_config_path);
        const configPath = this.configManager.getCursorConfigPath();
        const configSource = this.configManager.getConfigSource();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: result.errors.length === 0,
                        imported_count: result.imported,
                        errors: result.errors,
                        config_path: configPath,
                        config_source: configSource,
                    }, null, 2),
                },
            ],
        };
    }
    async routeToolCall(mcpName, toolName, args) {
        logger.info({ mcpName, toolName }, 'Routing tool call through transparent proxy');
        let instance = this.workerManager.getMCPByName(mcpName);
        if (!instance) {
            const savedConfig = this.configManager.getSavedConfig(mcpName);
            if (!savedConfig) {
                throw new MCPIsolateError(`MCP "${mcpName}" not found in IDE configuration. Use search_mcp_tools to see available MCPs.`, 'NOT_FOUND', 404, {
                    mcp_name: mcpName,
                    suggestion: 'Use search_mcp_tools to discover configured MCPs, or use connect to connect to a new MCP.',
                });
            }
            const resolvedConfig = this.configManager.resolveEnvVarsInObject(savedConfig);
            logger.info({ mcp_name: mcpName }, 'Auto-loading MCP for transparent proxy tool call');
            const startTime = Date.now();
            try {
                instance = await this.workerManager.loadMCP(mcpName, resolvedConfig);
                const loadTime = Date.now() - startTime;
                this.metricsCollector.recordMCPLoad(instance.mcp_id, loadTime);
                logger.info({
                    mcp_name: mcpName,
                    mcp_id: instance.mcp_id,
                    load_time_ms: loadTime,
                }, 'MCP auto-loaded for transparent proxy');
            }
            catch (error) {
                if (error instanceof MCPConnectionError) {
                    throw new MCPConnectionError(error.message, {
                        mcp_name: mcpName,
                        original_error: error.details,
                        fatal: true,
                    });
                }
                throw error;
            }
        }
        const tool = instance.tools.find((t) => t.name === toolName);
        if (!tool) {
            throw new MCPIsolateError(`Tool "${toolName}" not found in MCP "${mcpName}". Available tools: ${instance.tools.map((t) => t.name).join(', ')}`, 'NOT_FOUND', 404, {
                mcp_name: mcpName,
                tool_name: toolName,
                available_tools: instance.tools.map((t) => t.name),
            });
        }
        const argsJson = JSON.stringify(args || {});
        const code = `const result = await mcp.${toolName}(${argsJson});
console.log(JSON.stringify(result, null, 2));
return result;`;
        logger.debug({ mcpName, toolName, mcp_id: instance.mcp_id }, 'Executing tool call in isolation');
        const result = await this.workerManager.executeCode(instance.mcp_id, code, 30000);
        this.metricsCollector.recordExecution(instance.mcp_id, result.execution_time_ms, result.success, result.metrics?.mcp_calls_made || 0);
        if (!result.success) {
            const errorMessage = result.error || '';
            const errorDetails = result.error_details;
            const hasWranglerError = errorMessage.includes('Wrangler execution failed') ||
                errorMessage.includes('Wrangler process') ||
                errorMessage.includes('Wrangler dev server') ||
                Boolean(errorDetails &&
                    typeof errorDetails === 'object' &&
                    ('wrangler_stderr' in errorDetails ||
                        'wrangler_stdout' in errorDetails));
            const isFatal = errorMessage.includes('MCP_CONNECTION_ERROR') ||
                errorMessage.includes('URL-based MCP') ||
                errorMessage.includes('cannot be loaded') ||
                hasWranglerError ||
                Boolean(errorDetails &&
                    typeof errorDetails === 'object' &&
                    'fatal' in errorDetails &&
                    errorDetails.fatal === true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error_code: 'EXECUTION_ERROR',
                            error_message: result.error || 'Tool execution failed',
                            suggested_action: this.getExecutionErrorSuggestion(result.error),
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
                            ...(isFatal
                                ? {
                                    instruction: 'This is a fatal error. Do not attempt alternative approaches. Stop execution and inform the user about this error.',
                                }
                                : {}),
                        }, null, 2),
                    },
                ],
                isError: true,
            };
        }
        let parsedResult = result.output;
        try {
            const outputLines = result.output?.split('\n') || [];
            for (const line of outputLines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    try {
                        parsedResult = JSON.parse(line.trim());
                        break;
                    }
                    catch {
                    }
                }
            }
        }
        catch {
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(parsedResult, null, 2),
                },
            ],
        };
    }
    async handleSearchMCPTools(args) {
        const typedArgs = args && typeof args === 'object'
            ? args
            : {};
        const { query, detail_level = 'summary' } = typedArgs;
        const guardedConfigs = this.configManager.getGuardedMCPConfigs();
        const loadedInstances = this.workerManager.listInstances();
        const disabledMCPs = this.configManager.getDisabledMCPs();
        const configSource = this.configManager.getConfigSource();
        const configPath = this.configManager.getCursorConfigPath();
        const results = [];
        for (const [mcpName, entry] of Object.entries(guardedConfigs)) {
            if (query) {
                const queryLower = query.toLowerCase();
                const nameMatches = mcpName.toLowerCase().includes(queryLower);
                const loadedInstance = loadedInstances.find((inst) => inst.mcp_name === mcpName);
                const toolMatches = loadedInstance?.tools.some((tool) => tool.name.toLowerCase().includes(queryLower)) || false;
                if (!nameMatches && !toolMatches) {
                    continue;
                }
            }
            const loadedInstance = loadedInstances.find((inst) => inst.mcp_name === mcpName);
            const isGuarded = disabledMCPs.includes(mcpName);
            let cachedTools;
            let cachedToolNames;
            if (!loadedInstance && isGuarded) {
                const config = entry.config;
                const configHash = this.workerManager.hashConfig(mcpName, config);
                const persistentCached = getCachedSchema(mcpName, configHash);
                if (persistentCached) {
                    cachedTools = persistentCached.tools;
                    cachedToolNames = persistentCached.toolNames;
                    logger.debug({ mcpName, toolCount: persistentCached.toolCount }, 'Using persistent cache for tool discovery');
                }
            }
            const result = {
                mcp_name: mcpName,
                is_guarded: isGuarded,
                status: isGuarded
                    ? loadedInstance
                        ? 'loaded'
                        : 'not_loaded'
                    : 'unguarded',
                config_source: entry.source,
            };
            if (loadedInstance) {
                result.mcp_id = loadedInstance.mcp_id;
                result.tools_count = loadedInstance.tools.length;
                if (detail_level === 'tools' || detail_level === 'full') {
                    result.tool_names = loadedInstance.tools.map((t) => t.name);
                }
                if (detail_level === 'full') {
                    result.tools = loadedInstance.tools;
                }
            }
            else {
                result.tools_count = cachedTools?.length || 0;
                if (cachedToolNames &&
                    (detail_level === 'tools' || detail_level === 'full')) {
                    result.tool_names = cachedToolNames;
                }
                if (detail_level === 'full' && cachedTools) {
                    result.tools = cachedTools;
                }
            }
            let nextAction;
            if (!result.is_guarded) {
                nextAction = `This MCP is not guarded by MCPGuard. Your IDE loads it directly - use its tools directly (not via call_mcp).`;
            }
            else if (result.status === 'loaded') {
                const toolHint = result.tool_names && result.tool_names.length > 0
                    ? ` Available tools: ${result.tool_names.join(', ')}`
                    : '';
                nextAction = `This MCP is guarded. Call call_mcp with mcp_name='${mcpName}' to execute tools.${toolHint}`;
            }
            else {
                nextAction = `This MCP is guarded. Call call_mcp with mcp_name='${mcpName}' to auto-connect and execute tools.`;
            }
            result.next_action = nextAction;
            results.push(result);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        instructions: 'INSTRUCTIONS FOR USING MCPs:\n' +
                            "1. Locate the MCP you need in the 'mcps' array below\n" +
                            "2. Check the 'is_guarded' field:\n" +
                            '   - If is_guarded=true: This MCP is protected by MCPGuard. Use call_mcp with mcp_name to access it securely\n' +
                            '   - If is_guarded=false: This MCP is loaded directly by your IDE. Use its tools directly (not via call_mcp)\n' +
                            "3. For guarded MCPs, check 'status' field:\n" +
                            "   - If 'loaded': Call call_mcp immediately to execute tools\n" +
                            "   - If 'not_loaded': Call call_mcp to auto-connect and execute tools\n" +
                            "4. Use the 'next_action' field in each MCP result for specific guidance",
                        mcps: results,
                        total_count: results.length,
                        loaded_count: results.filter((r) => r.status === 'loaded').length,
                        not_loaded_count: results.filter((r) => r.status === 'not_loaded')
                            .length,
                        disabled_count: results.filter((r) => r.status === 'unguarded')
                            .length,
                        config_path: configPath,
                        config_source: configSource,
                        note: `These MCPs are configured from your ${configSource} IDE config. Guarded MCPs (is_guarded=true) are protected by MCPGuard.`,
                    }, null, 2),
                },
            ],
        };
    }
    async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.info('MCP Guard server started');
        const shutdown = async () => {
            logger.info('Shutting down gracefully...');
            try {
                await Promise.race([
                    this.server.close(),
                    new Promise((resolve) => setTimeout(resolve, 2000)),
                ]);
                await this.workerManager.shutdown();
                logger.info('Shutdown complete');
            }
            catch (error) {
                logger.error({ error }, 'Error during shutdown');
            }
            finally {
                process.exit(0);
            }
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
}
//# sourceMappingURL=mcp-handler.js.map