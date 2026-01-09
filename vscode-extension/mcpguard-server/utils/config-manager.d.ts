import type { MCPConfig } from '../types/mcp.js';
export interface MCPServersConfig {
    mcpServers: Record<string, unknown>;
    _mcpguard_disabled?: Record<string, unknown>;
    _mcpguard_metadata?: {
        version?: string;
        disabled_at?: string;
    };
    _mcpguard?: {
        mode?: 'transparent-proxy' | 'manual' | 'auto-detect';
        auto_guard_new?: boolean;
        namespace_tools?: boolean;
    };
}
export declare class ConfigManager {
    private configPath;
    private configSource;
    private readonly ideDefinitions;
    constructor();
    private getPlatformPaths;
    private findConfigFile;
    private resolveEnvVars;
    resolveEnvVarsInObject(obj: unknown): unknown;
    private readConfigFile;
    private readRawConfigFile;
    private writeConfigFile;
    getSavedConfigs(): Record<string, {
        config: MCPConfig;
        source: 'cursor' | 'claude-code' | 'github-copilot';
    }>;
    getSavedConfig(mcpName: string): MCPConfig | null;
    saveConfig(mcpName: string, config: MCPConfig): void;
    deleteConfig(mcpName: string): boolean;
    importConfigs(configPath?: string): {
        imported: number;
        errors: string[];
    };
    getCursorConfigPath(): string | null;
    getConfigSource(): 'cursor' | 'claude-code' | 'github-copilot' | null;
    getConfigSourceDisplayName(): string;
    getAllConfiguredMCPs(): Record<string, {
        config: MCPConfig;
        source: 'cursor' | 'claude-code' | 'github-copilot';
        status: 'active' | 'disabled';
    }>;
    getGuardedMCPConfigs(): Record<string, {
        config: MCPConfig;
        source: 'cursor' | 'claude-code' | 'github-copilot';
    }>;
    disableMCP(mcpName: string): boolean;
    enableMCP(mcpName: string): boolean;
    disableAllExceptMCPGuard(): {
        disabled: string[];
        failed: string[];
        alreadyDisabled: string[];
        mcpguardRestored: boolean;
    };
    restoreAllDisabled(): string[];
    getDisabledMCPs(): string[];
    isMCPDisabled(mcpName: string): boolean;
    getDisabledMCPNames(): string[];
    getRawConfig(): MCPServersConfig | null;
}
//# sourceMappingURL=config-manager.d.ts.map