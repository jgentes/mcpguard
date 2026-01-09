export declare class MCPHandler {
    private server;
    private workerManager;
    private metricsCollector;
    private configManager;
    private discoveredMCPTools;
    private discoveredMCPPrompts;
    constructor();
    private parseToolNamespace;
    private discoverConfiguredMCPs;
    private ensureMCPToolsLoaded;
    private ensureMCPPromptsLoaded;
    private setupHandlers;
    private handleLoadMCP;
    private handleExecuteCode;
    private formatWranglerError;
    private filterWranglerOutput;
    private getExecutionErrorSuggestion;
    private handleListMCPs;
    private handleGetSchema;
    private handleGetMCPByName;
    private handleUnloadMCP;
    private handleGetMetrics;
    private getSuggestedAction;
    private generateUsageExample;
    private generateExampleCode;
    private generateCommonPatterns;
    private handleDisableMCPs;
    private handleImportCursorConfigs;
    private routeToolCall;
    private handleSearchMCPTools;
    start(): Promise<void>;
}
//# sourceMappingURL=mcp-handler.d.ts.map