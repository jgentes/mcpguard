export declare function formatWranglerError(error: Error, stdout: string, stderr: string, context?: {
    mcpId?: string;
    port?: number;
    tempDir?: string;
    userCode?: string;
}): string;
export declare function formatExecutionResult(result: {
    success: boolean;
    output?: string;
    error?: string;
    execution_time_ms: number;
    metrics?: {
        mcp_calls_made: number;
        tools_called?: string[];
        schema_efficiency?: {
            total_tools_available: number;
            tools_used: string[];
            schema_size_total_chars: number;
            schema_size_used_chars: number;
            schema_utilization_percent: number;
            schema_efficiency_ratio: number;
            schema_size_reduction_chars: number;
            schema_size_reduction_percent: number;
            estimated_tokens_total?: number;
            estimated_tokens_used?: number;
            estimated_tokens_saved?: number;
        };
        security?: {
            network_isolation_enabled: boolean;
            process_isolation_enabled: boolean;
            isolation_type: string;
            security_level: string;
            protection_summary: string[];
        };
    };
}): string;
//# sourceMappingURL=wrangler-formatter.d.ts.map