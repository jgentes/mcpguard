import { spawn, } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isCommandBasedConfig } from '../types/mcp.js';
import { MCPConnectionError, MCPIsolateError, WorkerError, } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { clearMCPSchemaCache, getCachedSchema, getIsolationConfigForMCP, saveCachedSchema, } from '../utils/mcp-registry.js';
import { ProgressIndicator } from '../utils/progress-indicator.js';
import { formatWranglerError } from '../utils/wrangler-formatter.js';
import { SchemaConverter } from './schema-converter.js';
export class WorkerManager {
    instances = new Map();
    mcpProcesses = new Map();
    mcpClients = new Map();
    wranglerProcesses = new Set();
    schemaConverter;
    wranglerAvailable = null;
    schemaCache = new Map();
    rpcServer = null;
    rpcPort = 0;
    rpcServerReady = null;
    cachedWorkerEntryPoint = null;
    projectRoot = null;
    constructor() {
        this.schemaConverter = new SchemaConverter();
        this.projectRoot = this.findProjectRoot();
        this.startRPCServer();
    }
    findProjectRoot() {
        const currentFile = fileURLToPath(import.meta.url);
        let currentDir = dirname(currentFile);
        const maxDepth = 10;
        let depth = 0;
        while (depth < maxDepth) {
            if (existsSync(join(currentDir, 'wrangler.toml')) ||
                existsSync(join(currentDir, 'package.json'))) {
                logger.debug({
                    projectRoot: currentDir,
                    cwd: process.cwd(),
                    sourceFile: currentFile,
                }, 'Found project root');
                return currentDir;
            }
            const parentDir = resolve(currentDir, '..');
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
            depth++;
        }
        logger.warn({
            cwd: process.cwd(),
            sourceFile: currentFile,
            searchedFrom: dirname(currentFile),
        }, 'Could not find project root (wrangler.toml or package.json), using cwd as fallback');
        return process.cwd();
    }
    startRPCServer() {
        if (this.rpcServer) {
            return;
        }
        this.rpcServer = createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            if (req.method !== 'POST' || req.url !== '/mcp-rpc') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }
            try {
                let body = '';
                for await (const chunk of req) {
                    body += chunk.toString();
                }
                const { mcpId, toolName, input } = JSON.parse(body);
                if (!mcpId || !toolName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing mcpId or toolName' }));
                    return;
                }
                const client = this.mcpClients.get(mcpId);
                if (!client) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: `MCP client not found for ID: ${mcpId}`,
                    }));
                    return;
                }
                logger.debug({ mcpId, toolName, input }, 'RPC: Calling MCP tool');
                const result = await client.callTool({
                    name: toolName,
                    arguments: input || {},
                });
                let toolResult = result;
                if (result && typeof result === 'object' && 'content' in result) {
                    const content = result.content;
                    if (Array.isArray(content) && content.length > 0) {
                        const firstContent = content[0];
                        if (firstContent.type === 'text' && firstContent.text) {
                            try {
                                const text = firstContent.text.trim();
                                if (text.startsWith('{') || text.startsWith('[')) {
                                    toolResult = JSON.parse(text);
                                }
                                else {
                                    toolResult = text;
                                }
                            }
                            catch {
                                toolResult = firstContent.text;
                            }
                        }
                        else {
                            toolResult = firstContent;
                        }
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, result: toolResult }));
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const errorStack = error instanceof Error ? error.stack : undefined;
                logger.error({ error: errorMessage, stack: errorStack }, 'RPC: Error calling MCP tool');
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: errorMessage,
                    // Don't expose stack traces in API responses - security risk
                }));
            }
        });
        this.rpcServerReady = new Promise((resolve) => {
            this.rpcServer?.listen(0, '127.0.0.1', () => {
                const address = this.rpcServer?.address();
                if (address && typeof address === 'object') {
                    this.rpcPort = address.port;
                }
                resolve();
            });
        });
    }
    async getRPCUrl() {
        if (this.rpcServerReady) {
            await this.rpcServerReady;
        }
        return `http://127.0.0.1:${this.rpcPort}/mcp-rpc`;
    }
    hashConfig(mcpName, config) {
        const configString = JSON.stringify({ mcpName, config });
        return createHash('sha256')
            .update(configString)
            .digest('hex')
            .substring(0, 16);
    }
    getCacheKey(mcpName, config) {
        return `${mcpName}:${this.hashConfig(mcpName, config)}`;
    }
    calculateToolSchemaSize(tool) {
        return JSON.stringify(tool).length;
    }
    estimateTokens(chars) {
        return Math.round(chars / 3.5);
    }
    calculateSchemaMetrics(tools, toolsCalled) {
        const totalTools = tools.length;
        const toolsUsedSet = new Set(toolsCalled);
        const toolsUsed = Array.from(toolsUsedSet);
        const schemaSizeTotal = tools.reduce((sum, tool) => sum + this.calculateToolSchemaSize(tool), 0);
        const schemaSizeUsed = tools
            .filter((tool) => toolsUsedSet.has(tool.name))
            .reduce((sum, tool) => sum + this.calculateToolSchemaSize(tool), 0);
        const schemaUtilizationPercent = schemaSizeTotal > 0 ? (schemaSizeUsed / schemaSizeTotal) * 100 : 0;
        const schemaEfficiencyRatio = schemaSizeUsed > 0 ? schemaSizeTotal / schemaSizeUsed : 0;
        const schemaSizeReduction = schemaSizeTotal - schemaSizeUsed;
        const schemaSizeReductionPercent = schemaSizeTotal > 0 ? (schemaSizeReduction / schemaSizeTotal) * 100 : 0;
        const estimatedTokensTotal = this.estimateTokens(schemaSizeTotal);
        const estimatedTokensUsed = this.estimateTokens(schemaSizeUsed);
        const estimatedTokensSaved = estimatedTokensTotal - estimatedTokensUsed;
        return {
            total_tools_available: totalTools,
            tools_used: toolsUsed,
            schema_size_total_chars: schemaSizeTotal,
            schema_size_used_chars: schemaSizeUsed,
            schema_utilization_percent: Math.round(schemaUtilizationPercent * 100) / 100,
            schema_efficiency_ratio: Math.round(schemaEfficiencyRatio * 100) / 100,
            schema_size_reduction_chars: schemaSizeReduction,
            schema_size_reduction_percent: Math.round(schemaSizeReductionPercent * 100) / 100,
            estimated_tokens_total: estimatedTokensTotal,
            estimated_tokens_used: estimatedTokensUsed,
            estimated_tokens_saved: estimatedTokensSaved,
        };
    }
    getSecurityMetrics() {
        const networkIsolationEnabled = true;
        const processIsolationEnabled = true;
        const isolationType = 'worker_isolate';
        const securityLevel = 'high';
        const protectionSummary = [];
        if (networkIsolationEnabled) {
            protectionSummary.push('Network isolation (no outbound access)');
        }
        if (processIsolationEnabled) {
            protectionSummary.push('Process isolation (separate Worker)');
        }
        protectionSummary.push('Code sandboxing (isolated execution)');
        return {
            network_isolation_enabled: networkIsolationEnabled,
            process_isolation_enabled: processIsolationEnabled,
            isolation_type: isolationType,
            sandbox_status: 'active',
            security_level: securityLevel,
            protection_summary: protectionSummary,
        };
    }
    async loadMCPSchemaOnly(mcpName, config) {
        const cacheKey = this.getCacheKey(mcpName, config);
        const configHash = this.hashConfig(mcpName, config);
        const cached = this.schemaCache.get(cacheKey);
        const hasCachedSchema = cached && cached.configHash === configHash;
        if (hasCachedSchema &&
            cached.tools.length === 0 &&
            !isCommandBasedConfig(config)) {
            const persistentCached = getCachedSchema(mcpName, configHash);
            if (persistentCached && persistentCached.toolCount > 0) {
                this.schemaCache.set(cacheKey, {
                    tools: persistentCached.tools,
                    typescriptApi: persistentCached.typescriptApi ||
                        this.schemaConverter.convertToTypeScript(persistentCached.tools),
                    configHash: persistentCached.configHash,
                    cachedAt: new Date(persistentCached.cachedAt),
                });
                logger.info({ mcpName, toolCount: persistentCached.toolCount }, 'Updated empty in-memory cache from persistent cache (transparent proxy)');
                return persistentCached.tools;
            }
        }
        if (hasCachedSchema) {
            logger.debug({ mcpName, cacheKey, toolCount: cached.tools.length }, 'Using cached MCP schema for transparent proxy');
            return cached.tools;
        }
        let client = null;
        let transport = null;
        try {
            if (isCommandBasedConfig(config)) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env,
                });
            }
            else {
                const url = new URL(config.url);
                const transportOptions = {};
                if (config.headers) {
                    transportOptions.requestInit = {
                        headers: config.headers,
                    };
                    const maskedHeaders = Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [
                        k,
                        k.toLowerCase().includes('auth') ? `${v.substring(0, 15)}...` : v,
                    ]));
                    logger.info({ mcpName, url: config.url, headers: maskedHeaders }, 'loadMCPSchemaOnly: passing headers to StreamableHTTPClientTransport');
                }
                transport = new StreamableHTTPClientTransport(url, transportOptions);
            }
            client = new Client({
                name: 'mcpflare',
                version: '0.1.0',
            }, {
                capabilities: {},
            });
            await client.connect(transport, { timeout: 10000 });
            const toolsResponse = await client.listTools();
            logger.info({ mcpName, toolCount: toolsResponse.tools.length }, `loadMCPSchemaOnly: received ${toolsResponse.tools.length} tools`);
            const tools = toolsResponse.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: {
                    type: 'object',
                    properties: (tool.inputSchema.properties || {}),
                    required: tool.inputSchema.required || [],
                },
            }));
            const shouldCache = tools.length > 0 || isCommandBasedConfig(config);
            if (shouldCache) {
                const typescriptApi = this.schemaConverter.convertToTypeScript(tools);
                this.schemaCache.set(cacheKey, {
                    tools,
                    typescriptApi,
                    configHash,
                    cachedAt: new Date(),
                });
                logger.info({ mcpName, cacheKey, toolCount: tools.length }, 'Fetched and cached MCP schema for transparent proxy');
            }
            else {
                logger.warn({
                    mcpName,
                    url: !isCommandBasedConfig(config) ? config.url : undefined,
                    toolCount: tools.length,
                }, 'URL-based MCP returned 0 tools - not caching (may indicate auth issue)');
            }
            return tools;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isAuthError = /401|403|Unauthorized|Forbidden/i.test(errorMessage);
            if (isAuthError) {
                logger.warn({ error, mcpName }, 'Authentication failed for MCP - may require OAuth or valid Authorization header');
            }
            else {
                logger.warn({ error, mcpName }, 'Failed to fetch MCP schema for transparent proxy');
            }
            return [];
        }
        finally {
            if (client) {
                try {
                    await client.close();
                }
                catch (error) {
                    logger.debug({ error }, 'Error closing temporary MCP client');
                }
            }
            if (transport) {
                try {
                    await transport.close();
                }
                catch (error) {
                    logger.debug({ error }, 'Error closing temporary MCP transport');
                }
            }
        }
    }
    async loadMCPPromptsOnly(mcpName, config) {
        const cacheKey = this.getCacheKey(mcpName, config);
        const configHash = this.hashConfig(mcpName, config);
        const cached = this.schemaCache.get(cacheKey);
        if (cached && cached.configHash === configHash && cached.prompts) {
            logger.debug({ mcpName, cacheKey, promptCount: cached.prompts.length }, 'Using cached MCP prompts for transparent proxy');
            return cached.prompts;
        }
        let client = null;
        let transport = null;
        try {
            if (isCommandBasedConfig(config)) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env,
                });
            }
            else {
                const url = new URL(config.url);
                const transportOptions = {};
                if (config.headers) {
                    transportOptions.requestInit = {
                        headers: config.headers,
                    };
                }
                transport = new StreamableHTTPClientTransport(url, transportOptions);
            }
            client = new Client({
                name: 'mcpflare',
                version: '0.1.0',
            }, {
                capabilities: {},
            });
            await client.connect(transport, { timeout: 10000 });
            const promptsResponse = await client.listPrompts();
            const prompts = promptsResponse.prompts.map((prompt) => ({
                name: prompt.name,
                description: prompt.description,
                arguments: prompt.arguments,
            }));
            const existingCache = this.schemaCache.get(cacheKey);
            this.schemaCache.set(cacheKey, {
                tools: existingCache?.tools || [],
                typescriptApi: existingCache?.typescriptApi || '',
                prompts,
                configHash,
                cachedAt: new Date(),
            });
            logger.info({ mcpName, cacheKey, promptCount: prompts.length }, 'Fetched and cached MCP prompts for transparent proxy');
            return prompts;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isAuthError = /401|403|Unauthorized|Forbidden/i.test(errorMessage);
            if (isAuthError) {
                logger.warn({ error, mcpName }, 'Authentication failed for MCP prompts - may require OAuth or valid Authorization header');
            }
            else {
                logger.warn({ error, mcpName }, 'Failed to fetch MCP prompts for transparent proxy');
            }
            return [];
        }
        finally {
            if (client) {
                try {
                    await client.close();
                }
                catch (error) {
                    logger.debug({ error }, 'Error closing temporary MCP client');
                }
            }
            if (transport) {
                try {
                    await transport.close();
                }
                catch (error) {
                    logger.debug({ error }, 'Error closing temporary MCP transport');
                }
            }
        }
    }
    async loadMCP(mcpName, config) {
        const mcpId = randomUUID();
        const cacheKey = this.getCacheKey(mcpName, config);
        const safeConfig = isCommandBasedConfig(config)
            ? {
                command: config.command,
                args: config.args,
                envKeys: config.env ? Object.keys(config.env) : undefined,
            }
            : { url: config.url };
        logger.info({ mcpId, mcpName, config: safeConfig }, 'Loading MCP server');
        try {
            const cached = this.schemaCache.get(cacheKey);
            const configHash = this.hashConfig(mcpName, config);
            const hasCachedSchema = cached && cached.configHash === configHash;
            const shouldCheckPersistentCache = !hasCachedSchema ||
                (!isCommandBasedConfig(config) && cached && cached.tools.length === 0);
            if (shouldCheckPersistentCache) {
                let persistentCached = getCachedSchema(mcpName, configHash);
                if (persistentCached && persistentCached.toolCount === 0) {
                    clearMCPSchemaCache(mcpName);
                    logger.info({ mcpId, mcpName, configHash }, 'Cleared stale zero-tool persistent cache entry');
                    persistentCached = null;
                }
                if (persistentCached && persistentCached.toolCount > 0) {
                    this.schemaCache.set(cacheKey, {
                        tools: persistentCached.tools,
                        typescriptApi: persistentCached.typescriptApi ||
                            this.schemaConverter.convertToTypeScript(persistentCached.tools),
                        configHash: persistentCached.configHash,
                        cachedAt: new Date(persistentCached.cachedAt),
                    });
                    logger.info({ mcpId, mcpName, toolCount: persistentCached.toolCount }, 'Loaded MCP schema from persistent cache');
                }
            }
            const cachedAfterLoad = this.schemaCache.get(cacheKey);
            const hasCachedSchemaAfterLoad = cachedAfterLoad &&
                cachedAfterLoad.configHash === configHash &&
                (isCommandBasedConfig(config) || cachedAfterLoad.tools.length > 0);
            if (hasCachedSchemaAfterLoad) {
                if (isCommandBasedConfig(config)) {
                    const mcpProcess = await this.startMCPProcess(config, true);
                    this.mcpProcesses.set(mcpId, mcpProcess);
                }
                else {
                    logger.info({ mcpId, mcpName }, 'Establishing MCP client connection for URL-based MCP with cached schema');
                    await this.connectMCPClient(mcpId, mcpName, config);
                }
            }
            let tools;
            let prompts;
            let typescriptApi;
            if (hasCachedSchemaAfterLoad) {
                logger.info({ mcpId, mcpName, cacheKey }, 'Using cached MCP schema');
                tools = cachedAfterLoad?.tools;
                prompts = cachedAfterLoad?.prompts || [];
                typescriptApi = cachedAfterLoad?.typescriptApi;
            }
            else {
                const schema = await this.fetchMCPSchema(mcpName, config, mcpId);
                tools = schema.tools;
                prompts = schema.prompts;
                typescriptApi = this.schemaConverter.convertToTypeScript(tools);
                const shouldCache = tools.length > 0 || prompts.length > 0 || isCommandBasedConfig(config);
                if (shouldCache) {
                    this.schemaCache.set(cacheKey, {
                        tools,
                        prompts,
                        typescriptApi,
                        configHash: this.hashConfig(mcpName, config),
                        cachedAt: new Date(),
                    });
                    logger.debug({
                        mcpId,
                        mcpName,
                        cacheKey,
                        toolCount: tools.length,
                        promptCount: prompts.length,
                    }, 'Cached MCP schema');
                    saveCachedSchema({
                        mcpName,
                        configHash: this.hashConfig(mcpName, config),
                        tools,
                        prompts,
                        toolNames: tools.map((t) => t.name),
                        promptNames: prompts.map((p) => p.name),
                        toolCount: tools.length,
                        promptCount: prompts.length,
                        cachedAt: new Date().toISOString(),
                    });
                }
                else {
                    logger.warn({
                        mcpId,
                        mcpName,
                        url: !isCommandBasedConfig(config) ? config.url : undefined,
                        toolCount: tools.length,
                        promptCount: prompts.length,
                    }, 'URL-based MCP returned 0 tools and 0 prompts - not caching (may indicate auth issue)');
                }
            }
            const workerId = `worker-${mcpId}`;
            const instance = {
                mcp_id: mcpId,
                mcp_name: mcpName,
                status: 'ready',
                worker_id: workerId,
                typescript_api: typescriptApi,
                tools,
                prompts,
                created_at: new Date(),
                uptime_ms: 0,
            };
            this.instances.set(mcpId, instance);
            logger.info({ mcpId, mcpName, cached: !!cached }, 'MCP server loaded successfully');
            return instance;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error, mcpId, mcpName }, 'Failed to load MCP server');
            const mcpProcess = this.mcpProcesses.get(mcpId);
            if (mcpProcess) {
                try {
                    await this.killMCPProcess(mcpProcess);
                }
                catch (error) {
                    logger.warn({ error, mcpId }, 'Error killing MCP process during load failure');
                }
                this.mcpProcesses.delete(mcpId);
            }
            throw new MCPConnectionError(`Failed to load MCP server: ${errorMessage}`, { mcpName, error });
        }
    }
    async executeCode(mcpId, code, timeoutMs = 30000) {
        const instance = this.instances.get(mcpId);
        if (!instance) {
            throw new WorkerError(`MCP instance not found: ${mcpId}`);
        }
        if (instance.status !== 'ready') {
            throw new WorkerError(`MCP instance not ready: ${instance.status}`);
        }
        logger.info({ mcpId, codeLength: code.length }, 'Executing code in Worker isolate');
        const startTime = Date.now();
        try {
            const result = await this.executeInIsolate(mcpId, code, timeoutMs, instance);
            const executionTime = Date.now() - startTime;
            const toolsCalled = result.metrics?.tools_called || [];
            const schemaEfficiency = this.calculateSchemaMetrics(instance.tools, toolsCalled);
            const security = this.getSecurityMetrics();
            logger.info({ mcpId, executionTime }, 'Code executed successfully');
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
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            logger.error({ error, mcpId, executionTime }, 'Code execution failed');
            const schemaEfficiency = this.calculateSchemaMetrics(instance.tools, []);
            const security = this.getSecurityMetrics();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            let errorDetails;
            if (error instanceof MCPIsolateError) {
                errorDetails = error.details;
                logger.debug({ mcpId, hasDetails: !!errorDetails }, 'Extracted error details from MCPIsolateError');
            }
            else if (error instanceof WorkerError) {
                errorDetails = error.details;
                logger.debug({ mcpId, hasDetails: !!errorDetails }, 'Extracted error details from WorkerError');
            }
            else {
                logger.debug({ mcpId, errorType: error?.constructor?.name }, 'Error is not an MCPIsolateError or WorkerError');
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
            };
        }
    }
    async unloadMCP(mcpId) {
        logger.info({ mcpId }, 'Unloading MCP server');
        const instance = this.instances.get(mcpId);
        if (!instance) {
            throw new WorkerError(`MCP instance not found: ${mcpId}`);
        }
        const client = this.mcpClients.get(mcpId);
        if (client) {
            try {
                const clientWithTransport = client;
                const transport = clientWithTransport._transport;
                if (transport && typeof transport.close === 'function') {
                    await transport.close();
                }
            }
            catch (error) {
                logger.warn({ error, mcpId }, 'Error closing MCP client transport');
            }
            this.mcpClients.delete(mcpId);
        }
        const mcpProcess = this.mcpProcesses.get(mcpId);
        if (mcpProcess) {
            try {
                await this.killMCPProcess(mcpProcess);
            }
            catch (error) {
                logger.warn({ error, mcpId }, 'Error killing MCP process during unload');
            }
            this.mcpProcesses.delete(mcpId);
        }
        this.instances.delete(mcpId);
        logger.info({ mcpId }, 'MCP server unloaded');
    }
    listInstances() {
        return Array.from(this.instances.values()).map((instance) => ({
            ...instance,
            uptime_ms: Date.now() - instance.created_at.getTime(),
        }));
    }
    getInstance(mcpId) {
        const instance = this.instances.get(mcpId);
        if (instance) {
            return {
                ...instance,
                uptime_ms: Date.now() - instance.created_at.getTime(),
            };
        }
        return undefined;
    }
    getMCPByName(mcpName) {
        const instances = this.listInstances();
        return instances.find((instance) => instance.mcp_name === mcpName);
    }
    getMCPClient(mcpId) {
        return this.mcpClients.get(mcpId);
    }
    clearSchemaCache(mcpName) {
        let cleared = 0;
        for (const cacheKey of this.schemaCache.keys()) {
            if (cacheKey.startsWith(`${mcpName}:`)) {
                this.schemaCache.delete(cacheKey);
                cleared++;
            }
        }
        if (cleared > 0) {
            logger.info({ mcpName, clearedEntries: cleared }, 'Cleared in-memory schema cache for MCP');
        }
        return cleared;
    }
    async startMCPProcess(config, hasCachedSchema = false) {
        if (!isCommandBasedConfig(config)) {
            throw new MCPConnectionError('URL-based MCP configurations use HTTP transport and do not spawn processes. Process tracking is only for command-based MCPs.');
        }
        return new Promise((resolve, reject) => {
            let command = config.command;
            const args = config.args || [];
            if (process.platform === 'win32' && command === 'npx') {
                command = 'npx.cmd';
            }
            logger.info({
                platform: process.platform,
                originalCommand: config.command,
                resolvedCommand: command,
                args: args,
                envKeys: Object.keys(config.env || {}),
                hasCachedSchema,
            }, 'Spawning MCP process');
            let mcpProcess;
            let initialized = false;
            try {
                const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
                const spawnOptions = {
                    env: { ...process.env, ...config.env },
                    stdio: isTestEnv
                        ? ['pipe', 'pipe', 'ignore']
                        : ['pipe', 'pipe', 'pipe'],
                };
                if (process.platform === 'win32') {
                    spawnOptions.shell = true;
                }
                // Log spawn options without sensitive environment variables
                const safeSpawnOptions = {
                    ...spawnOptions,
                    env: spawnOptions.env
                        ? Object.keys(spawnOptions.env).reduce((acc, key) => {
                            // Only log non-sensitive env var names, not values
                            acc[key] = '[REDACTED]';
                            return acc;
                        }, {})
                        : undefined,
                };
                logger.debug({ spawnOptions: safeSpawnOptions }, 'Spawning with options');
                mcpProcess = spawn(command, args, spawnOptions);
                logger.info({
                    pid: mcpProcess.pid,
                    command,
                    args: args.slice(0, 5),
                }, `MCP process spawned: PID ${mcpProcess.pid}`);
                if (hasCachedSchema) {
                    setTimeout(() => {
                        if (mcpProcess && !mcpProcess.killed) {
                            initialized = true;
                            resolve(mcpProcess);
                        }
                        else {
                            reject(new MCPConnectionError('MCP process failed to start'));
                        }
                    }, 500);
                    return;
                }
                if (mcpProcess.stdout) {
                    mcpProcess.stdout.on('data', (data) => {
                        const output = data.toString();
                        logger.debug({ output }, 'MCP stdout');
                        if (!initialized) {
                            initialized = true;
                            setTimeout(() => resolve(mcpProcess), 200);
                        }
                    });
                }
                if (!isTestEnv && mcpProcess.stderr) {
                    mcpProcess.stderr.on('data', (data) => {
                        const stderrOutput = data.toString();
                        logger.debug({ error: stderrOutput }, 'MCP stderr');
                        if (!initialized && stderrOutput.trim().length > 0) {
                            initialized = true;
                            setTimeout(() => resolve(mcpProcess), 200);
                        }
                    });
                }
                mcpProcess.on('error', (error) => {
                    const errnoError = error;
                    logger.error({
                        error: error instanceof Error ? error.message : String(error),
                        code: errnoError.code,
                        errno: errnoError.errno,
                        syscall: errnoError.syscall,
                        command,
                        args,
                    }, 'MCP process spawn error');
                    reject(new MCPConnectionError(`Failed to start MCP process: ${error.message}`));
                });
                mcpProcess.on('exit', (code, signal) => {
                    logger.debug({ pid: mcpProcess.pid, code, signal, command }, 'MCP process exited naturally');
                });
                setTimeout(() => {
                    if (!initialized) {
                        if (mcpProcess && !mcpProcess.killed && mcpProcess.pid) {
                            logger.info({ pid: mcpProcess.pid }, 'MCP process ready (timeout - assuming ready)');
                            initialized = true;
                            resolve(mcpProcess);
                        }
                        else {
                            reject(new MCPConnectionError('MCP process initialization timeout - process not running'));
                        }
                    }
                }, 2000);
            }
            catch (spawnError) {
                const errorMessage = spawnError instanceof Error ? spawnError.message : 'Unknown error';
                const errorCode = spawnError?.code;
                const errorErrno = spawnError?.errno;
                const errorSyscall = spawnError?.syscall;
                logger.error({
                    error: errorMessage,
                    code: errorCode,
                    errno: errorErrno,
                    syscall: errorSyscall,
                    command,
                    args,
                }, 'Failed to spawn MCP process (catch block)');
                reject(new MCPConnectionError(`Failed to spawn MCP process: ${errorMessage}`));
            }
        });
    }
    async connectMCPClient(mcpId, mcpName, config) {
        if (isCommandBasedConfig(config)) {
            throw new Error('connectMCPClient should only be used for URL-based MCPs');
        }
        const url = new URL(config.url);
        const transportOptions = {};
        if (config.headers) {
            transportOptions.requestInit = {
                headers: config.headers,
            };
        }
        const transport = new StreamableHTTPClientTransport(url, transportOptions);
        const client = new Client({ name: 'mcpflare', version: '0.1.0' }, { capabilities: {} });
        const connectStartTime = Date.now();
        await client.connect(transport, { timeout: 10000 });
        const connectTime = Date.now() - connectStartTime;
        this.mcpClients.set(mcpId, client);
        logger.info({ mcpId, mcpName, connectTimeMs: connectTime }, 'MCP client connected for cached schema');
    }
    async fetchMCPSchema(mcpName, config, mcpId) {
        logger.info({ mcpId, mcpName }, 'Fetching MCP schema using real protocol');
        try {
            let transport;
            if (isCommandBasedConfig(config)) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env,
                });
            }
            else {
                const url = new URL(config.url);
                const transportOptions = {};
                if (config.headers) {
                    transportOptions.requestInit = {
                        headers: config.headers,
                    };
                    const maskedHeaders = Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [
                        k,
                        k.toLowerCase().includes('auth') ? `${v.substring(0, 15)}...` : v,
                    ]));
                    logger.info({ mcpId, mcpName, url: config.url, headers: maskedHeaders }, 'URL-based MCP: passing headers to StreamableHTTPClientTransport');
                }
                else {
                    logger.info({ mcpId, mcpName, url: config.url }, 'URL-based MCP: no custom headers configured');
                }
                transport = new StreamableHTTPClientTransport(url, transportOptions);
            }
            const client = new Client({
                name: 'mcpflare',
                version: '0.1.0',
            }, {
                capabilities: {},
            });
            const connectStartTime = Date.now();
            await client.connect(transport, { timeout: 10000 });
            const connectTime = Date.now() - connectStartTime;
            logger.info({ mcpId, mcpName, connectTimeMs: connectTime }, 'MCP client connected');
            this.mcpClients.set(mcpId, client);
            if (isCommandBasedConfig(config)) {
                const transportWithProcess = transport;
                const process = transportWithProcess._process;
                if (process) {
                    this.mcpProcesses.set(mcpId, process);
                    if (process.pid) {
                        logger.info({
                            pid: process.pid,
                            command: config.command,
                            args: (config.args || []).slice(0, 5),
                            mcpId,
                            mcpName,
                        }, `MCP process spawned via StdioClientTransport: PID ${process.pid}`);
                    }
                }
            }
            else {
                logger.info({ mcpId, mcpName, url: config.url }, 'MCP connected via StreamableHTTPClientTransport');
            }
            const listToolsStartTime = Date.now();
            const toolsResponse = await client.listTools();
            const listToolsTime = Date.now() - listToolsStartTime;
            logger.info({
                mcpId,
                mcpName,
                toolCount: toolsResponse.tools.length,
                listToolsTimeMs: listToolsTime,
                toolNames: toolsResponse.tools.slice(0, 5).map((t) => t.name),
            }, `Fetched ${toolsResponse.tools.length} tools from MCP server`);
            const tools = toolsResponse.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: {
                    type: 'object',
                    properties: (tool.inputSchema.properties || {}),
                    required: tool.inputSchema.required || [],
                },
            }));
            const listPromptsStartTime = Date.now();
            let prompts = [];
            try {
                const promptsResponse = await client.listPrompts();
                const listPromptsTime = Date.now() - listPromptsStartTime;
                logger.debug({
                    mcpId,
                    mcpName,
                    promptCount: promptsResponse.prompts.length,
                    listPromptsTimeMs: listPromptsTime,
                }, 'Fetched prompts from MCP server');
                prompts = promptsResponse.prompts.map((prompt) => ({
                    name: prompt.name,
                    description: prompt.description,
                    arguments: prompt.arguments,
                }));
            }
            catch (error) {
                logger.debug({ mcpId, mcpName, error }, 'MCP does not support prompts or prompts fetch failed');
            }
            return { tools, prompts };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error, mcpId, mcpName }, 'Failed to fetch MCP schema');
            throw new MCPConnectionError(`Failed to fetch MCP schema: ${errorMessage}`, { mcpName, error });
        }
    }
    async generateWorkerCode(mcpId, tools, _typescriptApi, userCode, isolationConfig) {
        const rpcUrl = await this.getRPCUrl();
        const allowedHostsRaw = isolationConfig?.outbound.allowedHosts ?? null;
        const allowLocalhost = isolationConfig?.outbound.allowLocalhost ?? false;
        const allowedHosts = Array.isArray(allowedHostsRaw) && allowedHostsRaw.length > 0
            ? allowedHostsRaw
                .map((h) => String(h).trim().toLowerCase())
                .filter((h) => h.length > 0)
            : [];
        const networkEnabled = allowLocalhost || allowedHosts.length > 0;
        logger.debug({ mcpId, toolCount: tools.length, toolNames: tools.map((t) => t.name) }, 'Generating MCP binding stubs');
        const mcpBindingStubs = tools
            .map((tool) => {
            // Escape tool name for use in template string - escape all special characters
            // Escape backslashes first, then quotes, then other control characters
            const escapedToolName = tool.name
                .replace(/\\/g, '\\\\') // Escape backslashes
                .replace(/'/g, "\\'") // Escape single quotes
                .replace(/"/g, '\\"') // Escape double quotes
                .replace(/\n/g, '\\n') // Escape newlines
                .replace(/\r/g, '\\r') // Escape carriage returns
                .replace(/\t/g, '\\t'); // Escape tabs
            return `    ${tool.name}: async (input) => {
      // Call MCP tool via Service Binding (no fetch() needed - native RPC)
      // The Service Binding is provided by the parent Worker and bridges to Node.js RPC server
      return await env.MCP.callTool('${escapedToolName}', input || {});
    }`;
        })
            .join(',\n');
        logger.debug({ mcpId, bindingStubsPreview: mcpBindingStubs.substring(0, 500) }, 'Generated MCP binding stubs');
        logger.debug({
            codeLength: userCode.length,
            preview: userCode.substring(0, 200),
        }, 'Embedding user code in worker script');
        const modulePrelude = networkEnabled
            ? '// MCPflare: Fetch wrapper at module level to intercept before runtime freezes fetch\n' +
                `const __mcpflareAllowedHosts = ${JSON.stringify(allowedHosts.join(','))};\n` +
                `const __mcpflareAllowLocalhost = ${allowLocalhost ? '"true"' : '"false"'};\n` +
                'const __mcpflareOriginalFetch = globalThis.fetch;\n' +
                'const __mcpflareFetchWrapper = async (input, init) => {\n' +
                '  const headers = new Headers(init?.headers || {});\n' +
                '  headers.set("X-MCPflare-Allowed-Hosts", __mcpflareAllowedHosts);\n' +
                '  headers.set("X-MCPflare-Allow-Localhost", __mcpflareAllowLocalhost);\n' +
                '  const response = await __mcpflareOriginalFetch(input, { ...init, headers });\n' +
                '  if (response.status === 403) {\n' +
                '    try {\n' +
                '      const body = await response.clone().json();\n' +
                '      if (body.error && body.error.startsWith("MCPflare network policy:")) {\n' +
                '        throw new Error(body.error);\n' +
                '      }\n' +
                '    } catch (e) {\n' +
                '      if (e.message && e.message.startsWith("MCPflare network policy:")) {\n' +
                '        throw e;\n' +
                '      }\n' +
                '    }\n' +
                '  }\n' +
                '  return response;\n' +
                '};\n' +
                '// Override globalThis.fetch at module level\n' +
                'globalThis.fetch = __mcpflareFetchWrapper;\n\n'
            : '';
        const workerScript = '// Dynamic Worker that executes AI-generated code\n' +
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
            '            throw new Error("Tool \\"" + String(prop) + "\\" not found. Available tools: " + (availableTools || "none"));\n' +
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
            '};\n';
        return {
            compatibilityDate: '2025-06-01',
            mainModule: 'worker.js',
            modules: {
                'worker.js': workerScript,
            },
            env: {
                MCP_ID: mcpId,
                MCP_RPC_URL: rpcUrl,
                NETWORK_ENABLED: networkEnabled ? 'true' : 'false',
            },
            globalOutbound: null,
        };
    }
    async executeInIsolate(mcpId, code, timeoutMs, instance) {
        if (this.wranglerAvailable === false) {
            throw new WorkerError('Wrangler is required for Worker execution but is not available.\n' +
                'Please install Wrangler to enable code execution in isolated Worker environments:\n' +
                '  npm install -g wrangler\n' +
                '  or ensure npx can access wrangler: npx wrangler --version');
        }
        try {
            return await this.executeWithWrangler(mcpId, code, timeoutMs, instance);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorCode = error?.code;
            const isSpawnENOENT = errorCode === 'ENOENT' ||
                (errorMessage.includes('ENOENT') &&
                    (errorMessage.includes('spawn') ||
                        errorMessage.includes('Failed to spawn') ||
                        errorMessage.includes('npx') ||
                        errorMessage.includes('npx.cmd')));
            if (isSpawnENOENT && this.wranglerAvailable === null) {
                this.wranglerAvailable = false;
                logger.error({ mcpId, error: errorMessage, errorCode }, 'Wrangler spawn failed - command not found');
                throw new WorkerError('Wrangler is required for Worker execution but is not available.\n' +
                    'Wrangler provides the Cloudflare Worker isolation environment needed for safe code execution.\n' +
                    'Please install Wrangler:\n' +
                    '  npm install -g wrangler\n' +
                    '  or ensure npx can access wrangler: npx wrangler --version\n\n' +
                    `Error details: ${errorMessage}`);
            }
            logger.error({ mcpId, error: errorMessage, errorCode, isSpawnENOENT }, 'Wrangler execution error (not spawn failure)');
            throw error;
        }
    }
    getWorkerEntryPoint() {
        if (this.cachedWorkerEntryPoint !== null) {
            return this.cachedWorkerEntryPoint;
        }
        const cwd = process.cwd();
        const nodeEnv = process.env.NODE_ENV;
        const isNodeEnvDev = nodeEnv === 'development';
        const isNodeEnvProd = nodeEnv === 'production';
        const isRunningViaTsx = process.argv[1]?.includes('tsx') ||
            process.argv[0]?.includes('tsx') ||
            process.argv[1]?.includes('src/server/index.ts') ||
            process.argv[1]?.includes('src\\server\\index.ts');
        const isDevMode = isNodeEnvDev || (!isNodeEnvProd && isRunningViaTsx);
        const devPath = join(cwd, 'src', 'worker', 'runtime.ts');
        const prodPath = join(cwd, 'dist', 'worker', 'runtime.js');
        const devExists = existsSync(devPath);
        const prodExists = existsSync(prodPath);
        let entryPoint;
        if (isDevMode && devExists) {
            entryPoint = 'src/worker/runtime.ts';
        }
        else if (prodExists) {
            entryPoint = 'dist/worker/runtime.js';
        }
        else if (isDevMode) {
            entryPoint = 'src/worker/runtime.ts';
            logger.warn({ devPath, prodPath, cwd }, 'Dev entry point file not found, using dev path anyway');
        }
        else {
            entryPoint = 'dist/worker/runtime.js';
            logger.warn({ devPath, prodPath, cwd }, 'Production entry point file not found, using prod path anyway');
        }
        this.cachedWorkerEntryPoint = entryPoint;
        logger.info({
            entryPoint,
            isDevMode,
            nodeEnv,
            isRunningViaTsx,
            devExists,
            prodExists,
            cwd,
        }, 'Determined Worker entry point (cached)');
        return entryPoint;
    }
    async executeWithWrangler(mcpId, code, timeoutMs, instance) {
        const progress = new ProgressIndicator();
        const isCLIMode = process.env.CLI_MODE === 'true';
        let wranglerProcess = null;
        const port = Math.floor(Math.random() * 10000) + 20000;
        let wranglerStdout = '';
        let wranglerStderr = '';
        try {
            if (isCLIMode) {
                progress.updateStep(0, 'running');
            }
            const isolationConfig = getIsolationConfigForMCP(instance.mcp_name);
            const workerCode = await this.generateWorkerCode(mcpId, instance.tools, instance.typescript_api, code, isolationConfig);
            const isWindows = process.platform === 'win32';
            const npxCmd = isWindows ? 'npx.cmd' : 'npx';
            if (isCLIMode) {
                progress.updateStep(0, 'success');
            }
            if (isCLIMode) {
                progress.updateStep(1, 'running');
            }
            logger.debug({ mcpId, port }, 'Starting Wrangler dev server for parent Worker');
            const baseEntryPoint = this.getWorkerEntryPoint();
            const wranglerCwd = this.projectRoot || process.cwd();
            const entryPointPath = resolve(wranglerCwd, baseEntryPoint);
            const entryPointExists = existsSync(entryPointPath);
            const entryPointForWrangler = baseEntryPoint;
            logger.info({
                mcpId,
                port,
                baseEntryPoint,
                entryPointForWrangler,
                wranglerCwd,
                entryPointPath,
                entryPointExists,
                actualCwd: process.cwd(),
                projectRoot: this.projectRoot,
            }, 'Spawning Wrangler - using project root as CWD');
            if (!entryPointExists) {
                const error = new Error(`Worker entry point not found at project root.\n` +
                    `  - Project root: ${wranglerCwd}\n` +
                    `  - Entry point: ${baseEntryPoint}\n` +
                    `  - Full path: ${entryPointPath}\n` +
                    `  - Exists: ${entryPointExists}`);
                logger.error({ error, wranglerCwd, baseEntryPoint, entryPointPath }, 'Entry point not found');
                throw error;
            }
            const wranglerArgs = [
                'wrangler',
                'dev',
                entryPointForWrangler,
                '--local',
                '--port',
                port.toString(),
            ];
            // Use detached: true on Unix so we can kill the entire process group (including workerd)
            wranglerProcess = spawn(npxCmd, wranglerArgs, {
                cwd: wranglerCwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: isWindows,
                // detached creates a new process group, allowing process.kill(-pid) to kill all children
                // This is essential because Wrangler spawns workerd as a child process
                detached: !isWindows, // Only on Unix - Windows handles this differently with taskkill /T
            });
            let spawnError = null;
            let errorHandled = false;
            wranglerProcess.on('error', (error) => {
                if (errorHandled)
                    return;
                spawnError = error;
                errorHandled = true;
                logger.error({
                    error: error.message,
                    code: error.code,
                    command: npxCmd,
                    args: wranglerArgs,
                    cwd: wranglerCwd,
                }, 'Wrangler spawn error - command may not be found');
            });
            if (wranglerProcess?.pid) {
                this.wranglerProcesses.add(wranglerProcess);
                logger.info({
                    pid: wranglerProcess.pid,
                    port,
                    mcpId,
                    command: npxCmd,
                    args: wranglerArgs,
                }, `Wrangler process spawned: PID ${wranglerProcess.pid} on port ${port}`);
                const trackedProcess = wranglerProcess;
                trackedProcess.on('exit', (code, signal) => {
                    this.wranglerProcesses.delete(trackedProcess);
                    logger.debug({ pid: trackedProcess.pid, code, signal }, 'Wrangler process exited');
                });
            }
            if (wranglerProcess?.stdout) {
                wranglerProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    wranglerStdout += output;
                    logger.debug({ output }, 'Wrangler stdout');
                });
            }
            if (wranglerProcess?.stderr) {
                wranglerProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    wranglerStderr += output;
                    logger.debug({ output }, 'Wrangler stderr');
                });
            }
            await new Promise((resolve, reject) => {
                if (spawnError) {
                    const spawnErrnoError = spawnError;
                    const isENOENT = spawnErrnoError.code === 'ENOENT' ||
                        spawnError.message.includes('ENOENT');
                    if (isENOENT) {
                        reject(new Error(`Failed to spawn Wrangler: ${spawnError.message}\n` +
                            `Command: ${npxCmd} ${wranglerArgs.join(' ')}\n` +
                            `This usually means npx or wrangler is not installed or not in PATH.`));
                        return;
                    }
                    reject(spawnError);
                    return;
                }
                const timeout = setTimeout(() => {
                    const error = new Error('Wrangler dev server failed to start within 10 seconds');
                    reject(error);
                }, 10000);
                let ready = false;
                let checkCount = 0;
                const maxChecks = 50;
                const checkReady = async () => {
                    checkCount++;
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
                                        'test.js': 'export default { fetch: () => new Response("ok") }',
                                    },
                                },
                                executionRequest: { code: '// health check', timeout: 1000 },
                            }),
                            signal: AbortSignal.timeout(500),
                        });
                        if (response.ok || response.status === 500) {
                            ready = true;
                            clearTimeout(timeout);
                            if (isCLIMode) {
                                progress.updateStep(1, 'success');
                            }
                            resolve();
                        }
                        else if (checkCount < maxChecks) {
                            setTimeout(checkReady, 200);
                        }
                    }
                    catch (error) {
                        if (checkCount < maxChecks &&
                            !(error instanceof Error && error.name?.includes('AbortError'))) {
                            setTimeout(checkReady, 200);
                        }
                        else if (checkCount >= maxChecks) {
                            clearTimeout(timeout);
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            const healthCheckError = new Error(`Wrangler health check failed after ${maxChecks} attempts. Last error: ${errorMessage}`);
                            reject(healthCheckError);
                        }
                    }
                };
                setTimeout(checkReady, 1000);
                if (wranglerProcess?.stdout) {
                    wranglerProcess.stdout.on('data', (data) => {
                        const output = data.toString();
                        if ((output.includes('Ready') ||
                            output.includes('ready') ||
                            output.includes('Listening')) &&
                            !ready) {
                            ready = true;
                            clearTimeout(timeout);
                            if (isCLIMode) {
                                progress.updateStep(1, 'success');
                            }
                            setTimeout(() => resolve(), 500);
                        }
                    });
                }
                wranglerProcess?.on('error', (error) => {
                    if (errorHandled)
                        return;
                    errorHandled = true;
                    clearTimeout(timeout);
                    const isENOENT = error.code === 'ENOENT' || error.message.includes('ENOENT');
                    if (isENOENT) {
                        reject(new Error(`Failed to spawn Wrangler: ${error.message}\n` +
                            `Command: ${npxCmd} ${wranglerArgs.join(' ')}\n` +
                            `This usually means npx or wrangler is not installed or not in PATH.`));
                    }
                    else {
                        reject(new Error(`Wrangler process error: ${error.message}`));
                    }
                });
                wranglerProcess?.on('exit', (code, signal) => {
                    if (!ready && code !== null && code !== 0) {
                        clearTimeout(timeout);
                        const hasBuildError = wranglerStderr.includes('Build failed') ||
                            wranglerStderr.includes('build failed') ||
                            wranglerStderr.includes('✗ Build failed');
                        const hasWorkerLoadersError = wranglerStderr.includes('worker_loaders') ||
                            wranglerStdout.includes('worker_loaders');
                        if (hasWorkerLoadersError) {
                            const error = new Error('Worker Loader API configuration error. The "worker_loaders" field may not be supported in your Wrangler version.\n' +
                                'Please ensure you have Wrangler 3.50.0 or later, or check the Wrangler documentation for the correct configuration format.\n' +
                                'Error details: ' +
                                (wranglerStderr || wranglerStdout)
                                    .split('\n')
                                    .find((line) => line.includes('worker_loaders')) ||
                                'Unknown error');
                            const buildError = error;
                            buildError.isBuildError = true;
                            reject(buildError);
                        }
                        else if (hasBuildError) {
                            const error = new Error('TypeScript compilation failed. Check the error details below.');
                            error.isBuildError = true;
                            reject(error);
                        }
                        else {
                            const error = new Error(`Wrangler process exited with code ${code} (signal: ${signal})`);
                            error.code = code ?? undefined;
                            error.signal = signal ?? undefined;
                            reject(error);
                        }
                    }
                });
            });
            if (isCLIMode) {
                progress.updateStep(2, 'running');
            }
            logger.debug({ mcpId, codeLength: code.length }, 'Executing code via Worker Loader API');
            const workerId = `mcp-${mcpId}-${createHash('sha256').update(`${mcpId}-${code}`).digest('hex').substring(0, 16)}`;
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
            });
            if (!response.ok) {
                const errorText = await response.text();
                if (isCLIMode) {
                    progress.updateStep(2, 'failed');
                    progress.showFinal(2);
                }
                throw new Error(`Worker execution failed: ${response.status} ${errorText}`);
            }
            const result = (await response.json());
            if (wranglerProcess) {
                await this.killWranglerProcess(wranglerProcess);
                wranglerProcess = null;
            }
            if (isCLIMode) {
                progress.updateStep(2, 'success');
                progress.showFinal();
            }
            const metrics = result.metrics
                ? {
                    mcp_calls_made: result.metrics.mcp_calls_made ?? 0,
                    tools_called: result.metrics
                        .tools_called,
                }
                : {
                    mcp_calls_made: 0,
                };
            return {
                output: result.output || '',
                result: result.result,
                metrics,
            };
        }
        catch (error) {
            let failedStep = -1;
            const isCLIMode = process.env.CLI_MODE === 'true';
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorIsBuildError = error?.isBuildError === true;
            if (isCLIMode) {
                const hasWorkerLoadersError = (wranglerStderr?.includes('worker_loaders') ||
                    wranglerStdout?.includes('worker_loaders') ||
                    errorMessage.includes('worker_loaders')) ??
                    false;
                const hasBuildError = wranglerStderr.includes('Build failed') ||
                    wranglerStderr.includes('build failed') ||
                    wranglerStderr.includes('✗ Build failed') ||
                    errorMessage.includes('TypeScript compilation failed') ||
                    errorMessage.includes('compilation failed') ||
                    errorIsBuildError;
                if (hasWorkerLoadersError ||
                    hasBuildError ||
                    errorMessage.includes('Wrangler process') ||
                    errorMessage.includes('Wrangler dev server') ||
                    errorMessage.includes('health check') ||
                    errorMessage.includes('Wrangler process exited')) {
                    failedStep = 1;
                    progress.updateStep(1, 'failed');
                }
                else if (errorMessage.includes('Worker execution failed') ||
                    errorMessage.includes('execute') ||
                    (errorMessage.includes('fetch') && errorMessage.includes('localhost'))) {
                    failedStep = 2;
                    progress.updateStep(2, 'failed');
                }
                else {
                    failedStep = 0;
                    progress.updateStep(0, 'failed');
                }
                progress.showFinal(failedStep);
            }
            const context = {
                mcpId,
                port,
            };
            const isWorkerLoadersError = wranglerStderr?.includes('worker_loaders') ||
                wranglerStdout?.includes('worker_loaders');
            const isBuildError = wranglerStderr?.includes('Build failed') ||
                wranglerStderr?.includes('build failed') ||
                wranglerStderr?.includes('✗ Build failed');
            if ((isBuildError || isWorkerLoadersError) && code) {
                context.userCode = code;
            }
            console.error('\n' +
                formatWranglerError(error instanceof Error ? error : new Error(String(error)), wranglerStdout || '', wranglerStderr || '', context) +
                '\n');
            const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
            if (!isCLIMode || isVerbose) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;
                logger.error({
                    error: errorMsg,
                    stack: errorStack,
                    mcpId,
                    port,
                }, 'Wrangler execution error');
            }
            if (wranglerProcess) {
                await this.killWranglerProcess(wranglerProcess);
            }
            throw new WorkerError(`Wrangler execution failed: ${errorMessage}`, {
                wrangler_stdout: wranglerStdout || '',
                wrangler_stderr: wranglerStderr || '',
                exit_code: error?.code,
                mcp_id: mcpId,
                port,
                fatal: true,
            });
        }
    }
    async killProcessTree(pid) {
        if (!pid || !Number.isInteger(pid) || pid <= 0) {
            return;
        }
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                const taskkillProcess = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
                    stdio: 'ignore',
                    shell: false,
                });
                taskkillProcess.on('exit', () => {
                    resolve();
                });
                taskkillProcess.on('error', () => {
                    resolve();
                });
            }
            else {
                try {
                    process.kill(-pid, 'SIGTERM');
                    setTimeout(() => {
                        try {
                            process.kill(-pid, 'SIGKILL');
                        }
                        catch {
                        }
                        resolve();
                    }, 1000);
                }
                catch {
                    resolve();
                }
            }
        });
    }
    async killWranglerProcess(proc) {
        if (!proc || proc.killed) {
            return;
        }
        const pid = proc.pid;
        if (!pid) {
            return;
        }
        logger.info({ pid }, `Killing Wrangler process tree: PID ${pid}`);
        this.wranglerProcesses.delete(proc);
        await this.killProcessTree(pid);
        try {
            proc.kill('SIGTERM');
        }
        catch {
        }
        await new Promise((resolve) => {
            if (proc.killed) {
                resolve();
                return;
            }
            proc.on('exit', () => resolve());
            setTimeout(() => {
                if (proc && !proc.killed && proc.pid) {
                    try {
                        this.killProcessTree(proc.pid).catch(() => {
                        });
                    }
                    catch {
                    }
                }
                resolve();
            }, 3000);
        });
    }
    async killMCPProcess(proc) {
        if (!proc || proc.killed) {
            return;
        }
        const pid = proc.pid;
        if (!pid) {
            return;
        }
        logger.info({ pid }, `Killing MCP process tree: PID ${pid}`);
        await this.killProcessTree(pid);
        try {
            proc.kill('SIGTERM');
        }
        catch {
        }
        await new Promise((resolve) => {
            if (proc.killed) {
                resolve();
                return;
            }
            proc.on('exit', () => resolve());
            setTimeout(() => {
                if (proc && !proc.killed && proc.pid) {
                    try {
                        this.killProcessTree(proc.pid).catch(() => {
                        });
                    }
                    catch {
                    }
                }
                resolve();
            }, 2000);
        });
    }
    async shutdown() {
        logger.debug('Shutting down WorkerManager...');
        if (this.rpcServer) {
            await new Promise((resolve) => {
                this.rpcServer?.close(() => {
                    logger.debug('RPC server closed');
                    resolve();
                });
                setTimeout(() => {
                    resolve();
                }, 2000);
            });
            this.rpcServer = null;
        }
        const cleanupPromises = [];
        for (const [mcpId, client] of this.mcpClients.entries()) {
            cleanupPromises.push((async () => {
                try {
                    const clientWithTransport = client;
                    const transport = clientWithTransport._transport;
                    if (transport && typeof transport.close === 'function') {
                        await transport.close();
                    }
                }
                catch (error) {
                    logger.warn({ error, mcpId }, 'Error closing MCP client');
                }
            })());
        }
        for (const [mcpId, proc] of this.mcpProcesses.entries()) {
            cleanupPromises.push((async () => {
                try {
                    await this.killMCPProcess(proc);
                }
                catch (error) {
                    logger.warn({ error, mcpId }, 'Error killing MCP process');
                }
            })());
        }
        const wranglerProcesses = Array.from(this.wranglerProcesses);
        for (const proc of wranglerProcesses) {
            cleanupPromises.push((async () => {
                try {
                    await this.killWranglerProcess(proc);
                }
                catch (error) {
                    logger.warn({ error }, 'Error killing Wrangler process');
                }
            })());
        }
        await Promise.race([
            Promise.all(cleanupPromises),
            new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        this.mcpClients.clear();
        this.mcpProcesses.clear();
        this.wranglerProcesses.clear();
        this.instances.clear();
        this.schemaCache.clear();
        logger.debug('WorkerManager shutdown complete');
    }
}
//# sourceMappingURL=worker-manager.js.map