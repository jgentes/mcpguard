import { z } from 'zod';
export interface JSONSchemaProperty {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description?: string;
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
    items?: JSONSchemaProperty;
    default?: unknown;
    enum?: unknown[];
    [key: string]: unknown;
}
export declare const MCPToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    inputSchema: z.ZodObject<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[] | undefined;
    }, {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    name: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[] | undefined;
    };
    description?: string | undefined;
}, {
    name: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[] | undefined;
    };
    description?: string | undefined;
}>;
export type MCPTool = z.infer<typeof MCPToolSchema>;
export declare const MCPPromptArgumentSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    required: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}, {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}>;
export type MCPPromptArgument = z.infer<typeof MCPPromptArgumentSchema>;
export declare const MCPPromptSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
    arguments?: {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}, {
    name: string;
    description?: string | undefined;
    arguments?: {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}>;
export type MCPPrompt = z.infer<typeof MCPPromptSchema>;
export declare const MCPPromptMessageContentSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    data: z.ZodString;
    mimeType: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "image";
    data: string;
    mimeType: string;
}, {
    type: "image";
    data: string;
    mimeType: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"resource">;
    resource: z.ZodObject<{
        uri: z.ZodString;
        mimeType: z.ZodOptional<z.ZodString>;
        text: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        uri: string;
        text?: string | undefined;
        mimeType?: string | undefined;
    }, {
        uri: string;
        text?: string | undefined;
        mimeType?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "resource";
    resource: {
        uri: string;
        text?: string | undefined;
        mimeType?: string | undefined;
    };
}, {
    type: "resource";
    resource: {
        uri: string;
        text?: string | undefined;
        mimeType?: string | undefined;
    };
}>]>;
export type MCPPromptMessageContent = z.infer<typeof MCPPromptMessageContentSchema>;
export declare const MCPPromptMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodUnion<[z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"resource">;
        resource: z.ZodObject<{
            uri: z.ZodString;
            mimeType: z.ZodOptional<z.ZodString>;
            text: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        }, {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    }, {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    }>]>, z.ZodArray<z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"resource">;
        resource: z.ZodObject<{
            uri: z.ZodString;
            mimeType: z.ZodOptional<z.ZodString>;
            text: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        }, {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    }, {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    }>]>, "many">]>;
}, "strip", z.ZodTypeAny, {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    } | {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    } | ({
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    } | {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    })[];
}, {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    } | {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    } | ({
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    } | {
        type: "resource";
        resource: {
            uri: string;
            text?: string | undefined;
            mimeType?: string | undefined;
        };
    })[];
}>;
export type MCPPromptMessage = z.infer<typeof MCPPromptMessageSchema>;
export declare const MCPConfigSchema: z.ZodUnion<[z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    command: string;
    args?: string[] | undefined;
    env?: Record<string, string> | undefined;
}, {
    command: string;
    args?: string[] | undefined;
    env?: Record<string, string> | undefined;
}>, z.ZodObject<{
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    headers?: Record<string, string> | undefined;
}, {
    url: string;
    headers?: Record<string, string> | undefined;
}>]>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export declare function isCommandBasedConfig(config: MCPConfig): config is {
    command: string;
    args?: string[];
    env?: Record<string, string>;
};
export declare const LoadMCPRequestSchema: z.ZodObject<{
    mcp_name: z.ZodString;
    mcp_config: z.ZodUnion<[z.ZodObject<{
        command: z.ZodString;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    }, {
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    }>, z.ZodObject<{
        url: z.ZodString;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        headers?: Record<string, string> | undefined;
    }, {
        url: string;
        headers?: Record<string, string> | undefined;
    }>]>;
}, "strip", z.ZodTypeAny, {
    mcp_name: string;
    mcp_config: {
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    } | {
        url: string;
        headers?: Record<string, string> | undefined;
    };
}, {
    mcp_name: string;
    mcp_config: {
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    } | {
        url: string;
        headers?: Record<string, string> | undefined;
    };
}>;
export type LoadMCPRequest = z.infer<typeof LoadMCPRequestSchema>;
export declare const ExecuteCodeRequestSchema: z.ZodEffects<z.ZodObject<{
    mcp_id: z.ZodOptional<z.ZodString>;
    mcp_name: z.ZodOptional<z.ZodString>;
    code: z.ZodString;
    timeout_ms: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    code: string;
    timeout_ms: number;
    mcp_name?: string | undefined;
    mcp_id?: string | undefined;
}, {
    code: string;
    mcp_name?: string | undefined;
    mcp_id?: string | undefined;
    timeout_ms?: number | undefined;
}>, {
    code: string;
    timeout_ms: number;
    mcp_name?: string | undefined;
    mcp_id?: string | undefined;
}, {
    code: string;
    mcp_name?: string | undefined;
    mcp_id?: string | undefined;
    timeout_ms?: number | undefined;
}>;
export type ExecuteCodeRequest = z.infer<typeof ExecuteCodeRequestSchema>;
export interface SchemaEfficiencyMetrics {
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
}
export interface SecurityMetrics {
    network_isolation_enabled: boolean;
    process_isolation_enabled: boolean;
    isolation_type: string;
    security_level: string;
    protection_summary: string[];
}
export interface ExecutionResult {
    success: boolean;
    output?: string;
    result?: unknown;
    error?: string;
    execution_time_ms: number;
    error_details?: unknown;
    metrics: {
        mcp_calls_made: number;
        tools_called?: string[];
        schema_efficiency?: SchemaEfficiencyMetrics;
        security?: SecurityMetrics;
    };
}
export interface MCPInstance {
    mcp_id: string;
    mcp_name: string;
    status: 'initializing' | 'ready' | 'error' | 'stopped';
    worker_id?: string;
    typescript_api: string;
    tools: MCPTool[];
    prompts: MCPPrompt[];
    created_at: Date;
    uptime_ms: number;
}
export interface EnhancedErrorResponse {
    error_code: string;
    error_message: string;
    suggested_action?: string;
    context?: Record<string, unknown>;
    details?: unknown;
}
export interface EnhancedLoadMCPResponse {
    success: boolean;
    mcp_id: string;
    mcp_name: string;
    status: string;
    tools_count: number;
    typescript_api: string;
    available_tools: string[];
    load_time_ms: number;
    usage_example?: string;
    example_code?: string;
}
export interface EnhancedGetSchemaResponse {
    mcp_id: string;
    mcp_name: string;
    typescript_api: string;
    tools: MCPTool[];
    common_patterns?: string[];
}
export interface SavedMCPConfig {
    mcp_name: string;
    config: MCPConfig;
    source: 'cursor' | 'claude-code' | 'github-copilot';
}
export interface TransparentProxyConfig {
    mode?: 'transparent-proxy' | 'manual' | 'auto-detect';
    auto_guard_new?: boolean;
    namespace_tools?: boolean;
}
//# sourceMappingURL=mcp.d.ts.map