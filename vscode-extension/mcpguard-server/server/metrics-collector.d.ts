interface ExecutionMetrics {
    total_executions: number;
    successful_executions: number;
    failed_executions: number;
    total_execution_time_ms: number;
    average_execution_time_ms: number;
    total_mcp_calls: number;
}
interface MCPMetrics {
    mcp_id: string;
    load_time_ms: number;
    executions: ExecutionMetrics;
}
export declare class MetricsCollector {
    private mcpMetrics;
    private globalMetrics;
    recordMCPLoad(mcpId: string, loadTimeMs: number): void;
    recordExecution(mcpId: string, executionTimeMs: number, success: boolean, mcpCallsMade: number): void;
    getMetrics(): {
        global: ExecutionMetrics;
        per_mcp: MCPMetrics[];
        summary: {
            total_mcps_loaded: number;
            success_rate: number;
        };
    };
    resetMetrics(): void;
}
export {};
//# sourceMappingURL=metrics-collector.d.ts.map