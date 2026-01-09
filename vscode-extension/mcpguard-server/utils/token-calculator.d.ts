import type { MCPConfig } from '../types/mcp.js';
export interface MCPTokenMetrics {
    toolCount: number;
    schemaChars: number;
    estimatedTokens: number;
    assessedAt: string;
}
export interface TokenSavingsSummary {
    totalTokensWithoutGuard: number;
    mcpGuardTokens: number;
    tokensSaved: number;
    assessedMCPs: number;
    guardedMCPs: number;
    mcpBreakdown: Array<{
        name: string;
        isGuarded: boolean;
        isAssessed: boolean;
        tokens: number;
        toolCount: number;
    }>;
    hasEstimates?: boolean;
}
export declare const MCPGUARD_BASELINE_TOKENS = 500;
export declare const DEFAULT_UNASSESSED_TOKENS = 800;
export declare function assessCommandBasedMCP(_mcpName: string, config: MCPConfig, timeoutMs?: number): Promise<MCPTokenMetrics | null>;
export declare function calculateTokenSavings(mcps: Array<{
    name: string;
    isGuarded: boolean;
    metrics?: MCPTokenMetrics;
    toolCount?: number;
}>): TokenSavingsSummary;
export declare function formatTokens(tokens: number): string;
export declare function calculatePercentage(part: number, total: number): number;
//# sourceMappingURL=token-calculator.d.ts.map