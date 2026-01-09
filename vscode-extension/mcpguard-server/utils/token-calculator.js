import { spawn } from 'node:child_process';
function estimateTokens(chars) {
    return Math.round(chars / 3.5);
}
export const MCPGUARD_BASELINE_TOKENS = 500;
export const DEFAULT_UNASSESSED_TOKENS = 800;
export async function assessCommandBasedMCP(_mcpName, config, timeoutMs = 15000) {
    if (!('command' in config)) {
        return null;
    }
    return new Promise((resolve) => {
        let mcpProcess = null;
        let resolved = false;
        let stdoutBuffer = '';
        const cleanup = () => {
            if (mcpProcess && !mcpProcess.killed) {
                try {
                    mcpProcess.kill('SIGTERM');
                }
                catch {
                }
            }
        };
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
            }
        }, timeoutMs);
        try {
            const command = process.platform === 'win32' && config.command === 'npx'
                ? 'npx.cmd'
                : config.command;
            mcpProcess = spawn(command, config.args || [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, ...config.env },
                shell: process.platform === 'win32',
            });
            const initRequest = {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'mcpguard-cli', version: '1.0.0' },
                },
            };
            mcpProcess.stdin?.write(`${JSON.stringify(initRequest)}\n`);
            mcpProcess.stdout?.on('data', (data) => {
                stdoutBuffer += data.toString();
                const lines = stdoutBuffer.split('\n');
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].trim();
                    if (!line)
                        continue;
                    try {
                        const response = JSON.parse(line);
                        if (response.id === 1 && response.result) {
                            const toolsRequest = {
                                jsonrpc: '2.0',
                                id: 2,
                                method: 'tools/list',
                                params: {},
                            };
                            mcpProcess?.stdin?.write(`${JSON.stringify(toolsRequest)}\n`);
                        }
                        if (response.id === 2 && response.result?.tools) {
                            const tools = response.result.tools;
                            const schemaChars = JSON.stringify(tools).length;
                            const estimatedTokensValue = estimateTokens(schemaChars);
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                cleanup();
                                resolve({
                                    toolCount: tools.length,
                                    schemaChars,
                                    estimatedTokens: estimatedTokensValue,
                                    assessedAt: new Date().toISOString(),
                                });
                            }
                        }
                    }
                    catch {
                    }
                }
                stdoutBuffer = lines[lines.length - 1];
            });
            mcpProcess.on('error', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(null);
                }
            });
            mcpProcess.on('exit', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(null);
                }
            });
        }
        catch {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(null);
            }
        }
    });
}
export function calculateTokenSavings(mcps) {
    let totalTokensWithoutGuard = 0;
    let assessedMCPs = 0;
    let guardedMCPs = 0;
    let unassessedGuardedMCPs = 0;
    const mcpBreakdown = mcps.map((mcp) => {
        const isGuarded = mcp.isGuarded;
        const isAssessed = !!mcp.metrics;
        let tokens = 0;
        if (isGuarded) {
            guardedMCPs++;
            if (mcp.metrics) {
                assessedMCPs++;
                tokens = mcp.metrics.estimatedTokens;
                totalTokensWithoutGuard += tokens;
            }
            else {
                unassessedGuardedMCPs++;
                tokens = DEFAULT_UNASSESSED_TOKENS;
                totalTokensWithoutGuard += tokens;
            }
        }
        else if (mcp.metrics) {
            assessedMCPs++;
        }
        return {
            name: mcp.name,
            isGuarded,
            isAssessed,
            tokens,
            toolCount: mcp.metrics?.toolCount || mcp.toolCount || 0,
        };
    });
    const tokensSaved = Math.max(0, totalTokensWithoutGuard - MCPGUARD_BASELINE_TOKENS);
    return {
        totalTokensWithoutGuard,
        mcpGuardTokens: MCPGUARD_BASELINE_TOKENS,
        tokensSaved,
        assessedMCPs,
        guardedMCPs,
        mcpBreakdown,
        hasEstimates: unassessedGuardedMCPs > 0,
    };
}
export function formatTokens(tokens) {
    return tokens.toLocaleString();
}
export function calculatePercentage(part, total) {
    if (total === 0)
        return 0;
    return Math.round((part / total) * 100);
}
//# sourceMappingURL=token-calculator.js.map