export interface NetworkConfig {
    enabled: boolean;
    allowlist: string[];
    allowLocalhost: boolean;
}
export interface FileSystemConfig {
    enabled: boolean;
    readPaths: string[];
    writePaths: string[];
}
export interface ResourceLimits {
    maxExecutionTimeMs: number;
    maxMemoryMB: number;
    maxMCPCalls: number;
}
export interface MCPSecurityConfigStored {
    id: string;
    mcpName: string;
    network: NetworkConfig;
    fileSystem: FileSystemConfig;
    resourceLimits: ResourceLimits;
    lastModified: string;
}
export interface MCPSecurityConfig extends MCPSecurityConfigStored {
    isGuarded: boolean;
}
export interface MCPSchemaCacheEntry {
    mcpName: string;
    configHash: string;
    tools: unknown[];
    prompts?: unknown[];
    toolNames: string[];
    promptNames?: string[];
    toolCount: number;
    promptCount?: number;
    typescriptApi?: string;
    cachedAt: string;
}
export interface MCPSchemaCache {
    [cacheKey: string]: MCPSchemaCacheEntry;
}
export interface MCPGuardSettingsStored {
    enabled: boolean;
    defaults: Omit<MCPSecurityConfigStored, 'id' | 'mcpName' | 'lastModified'>;
    mcpConfigs: MCPSecurityConfigStored[];
    tokenMetricsCache?: Record<string, {
        toolCount: number;
        schemaChars: number;
        estimatedTokens: number;
        assessedAt: string;
    }>;
    mcpSchemaCache?: MCPSchemaCache;
}
export interface MCPGuardSettings {
    enabled: boolean;
    defaults: Omit<MCPSecurityConfig, 'id' | 'mcpName' | 'isGuarded' | 'lastModified'>;
    mcpConfigs: MCPSecurityConfig[];
    tokenMetricsCache?: Record<string, {
        toolCount: number;
        schemaChars: number;
        estimatedTokens: number;
        assessedAt: string;
    }>;
    mcpSchemaCache?: MCPSchemaCache;
}
export interface WorkerIsolationConfig {
    mcpName: string;
    isGuarded: boolean;
    outbound: {
        allowedHosts: string[] | null;
        allowLocalhost: boolean;
    };
    fileSystem: {
        enabled: boolean;
        readPaths: string[];
        writePaths: string[];
    };
    limits: {
        cpuMs: number;
        memoryMB: number;
        subrequests: number;
    };
}
declare function isMCPGuardedInIDEConfig(mcpName: string): boolean;
export declare function getSettingsPath(): string;
export declare function loadSettings(): MCPGuardSettings;
export declare function saveSettings(settings: MCPGuardSettings): void;
export declare function toWorkerIsolationConfig(config: MCPSecurityConfig): WorkerIsolationConfig;
export declare function getIsolationConfigForMCP(mcpName: string): WorkerIsolationConfig | undefined;
export declare function getAllGuardedMCPs(): Map<string, WorkerIsolationConfig>;
export declare function isMCPGuarded(mcpName: string): boolean;
export declare function createDefaultConfig(mcpName: string): MCPSecurityConfig;
export declare function upsertMCPConfig(config: MCPSecurityConfig): void;
export declare function removeMCPConfig(mcpName: string): void;
export declare function cleanupTokenMetricsCache(): {
    removed: string[];
};
export declare function getCachedSchema(mcpName: string, configHash: string): MCPSchemaCacheEntry | null;
export declare function saveCachedSchema(entry: MCPSchemaCacheEntry): void;
export declare function cleanupSchemaCache(): {
    removed: string[];
};
export declare function clearMCPSchemaCache(mcpName: string): {
    removed: string[];
    success: boolean;
};
export { isMCPGuardedInIDEConfig as isGuardedInIDEConfig };
//# sourceMappingURL=mcp-registry.d.ts.map