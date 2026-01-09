import { WorkerEntrypoint } from 'cloudflare:workers';
export class MCPBridge extends WorkerEntrypoint {
    async callTool(toolName, input) {
        const { mcpId, rpcUrl } = this.ctx.props;
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mcpId,
                toolName,
                input: input || {},
            }),
        });
        if (!response.ok) {
            const errorData = (await response.json().catch(() => ({
                error: response.statusText,
            })));
            throw new Error(`MCP tool call failed: ${errorData.error || response.statusText}`);
        }
        const result = (await response.json());
        if (!result.success) {
            throw new Error(`MCP tool call failed: ${result.error || 'Unknown error'}`);
        }
        return result.result;
    }
}
export class FetchProxy extends WorkerEntrypoint {
    async fetch(request) {
        const allowedHostsHeader = request.headers.get('X-MCPGuard-Allowed-Hosts') || '';
        const allowLocalhostHeader = request.headers.get('X-MCPGuard-Allow-Localhost') || 'false';
        const allowedHosts = allowedHostsHeader ? allowedHostsHeader.split(',').map(h => h.trim()).filter(h => h) : [];
        const allowLocalhost = allowLocalhostHeader === 'true';
        const url = new URL(request.url);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
        const isLoopback = hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1';
        if (isLoopback && !allowLocalhost) {
            return new Response(JSON.stringify({
                error: `MCPGuard network policy: localhost blocked (${hostname})`,
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (!isLoopback && allowedHosts.length > 0) {
            const isAllowed = this.isHostAllowed(hostname, allowedHosts);
            if (!isAllowed) {
                return new Response(JSON.stringify({
                    error: `MCPGuard network policy: ${hostname} is not in the allowed hosts list`,
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        const forwardHeaders = new Headers(request.headers);
        forwardHeaders.delete('X-MCPGuard-Allowed-Hosts');
        forwardHeaders.delete('X-MCPGuard-Allow-Localhost');
        return fetch(request.url, {
            method: request.method,
            headers: forwardHeaders,
            body: request.body,
            redirect: request.redirect,
        });
    }
    isHostAllowed(hostname, allowedHosts) {
        for (const entryRaw of allowedHosts) {
            const entry = entryRaw.toLowerCase().replace(/\.$/, '');
            if (!entry)
                continue;
            if (entry.startsWith('*.') && entry.length > 2) {
                const suffix = entry.slice(2);
                if (hostname === suffix || hostname.endsWith('.' + suffix)) {
                    return true;
                }
            }
            else if (hostname === entry) {
                return true;
            }
        }
        return false;
    }
}
export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        if (request.method !== 'POST') {
            return new Response('Method not allowed', {
                status: 405,
                headers: corsHeaders,
            });
        }
        try {
            const { workerId, workerCode, executionRequest } = (await request.json());
            if (!env.LOADER) {
                throw new Error('Worker Loader binding not available. Ensure [[worker_loaders]] is configured in wrangler.toml');
            }
            const dynamicWorker = env.LOADER.get(workerId, async () => {
                const mcpId = workerCode.env?.MCP_ID;
                const rpcUrl = workerCode.env?.MCP_RPC_URL;
                const mcpBinding = ctx.exports.MCPBridge({
                    props: { mcpId, rpcUrl },
                });
                const needsFetchProxy = workerCode.env?.NETWORK_ENABLED === 'true';
                const fetchProxy = needsFetchProxy && 'FetchProxy' in ctx.exports && ctx.exports.FetchProxy
                    ? ctx.exports.FetchProxy({})
                    : undefined;
                const env = {
                    ...workerCode.env,
                    MCP: mcpBinding,
                };
                const globalOutbound = fetchProxy || null;
                return {
                    ...workerCode,
                    env,
                    globalOutbound,
                };
            });
            const entrypoint = dynamicWorker.getEntrypoint();
            const executionRequestPayload = JSON.stringify(executionRequest);
            const workerResponse = await entrypoint.fetch(new Request('http://localhost', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: executionRequestPayload,
            }));
            const responseBody = await workerResponse.text();
            return new Response(responseBody, {
                status: workerResponse.status,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : undefined;
            return new Response(JSON.stringify({
                success: false,
                error: 'Failed to execute code in Worker isolate',
                message: errorMessage,
                stack: errorStack,
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            });
        }
    },
};
//# sourceMappingURL=runtime.js.map