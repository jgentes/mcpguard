import type { MCPTokenMetrics } from './token-calculator.js';
interface SettingsFile {
    enabled?: boolean;
    tokenMetricsCache?: Record<string, MCPTokenMetrics>;
    assessmentErrorsCache?: Record<string, unknown>;
    contextWindowSize?: number;
    [key: string]: unknown;
}
export declare function getSettingsPath(): string;
export declare function loadSettings(): SettingsFile;
export declare function saveSettings(settings: SettingsFile): void;
export declare function loadTokenMetrics(): Map<string, MCPTokenMetrics>;
export declare function saveTokenMetrics(cache: Map<string, MCPTokenMetrics>): void;
export declare function getCachedMetrics(mcpName: string): MCPTokenMetrics | undefined;
export declare function setCachedMetrics(mcpName: string, metrics: MCPTokenMetrics): void;
export declare function invalidateMetricsCache(mcpName: string): void;
export declare function getCachedMCPNames(): string[];
export {};
//# sourceMappingURL=settings-manager.d.ts.map