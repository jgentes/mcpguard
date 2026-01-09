import { z } from 'zod';
export const MCPToolSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.object({
        type: z.literal('object'),
        properties: z.record(z.unknown()),
        required: z.array(z.string()).optional(),
    }),
});
export const MCPPromptArgumentSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
});
export const MCPPromptSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    arguments: z.array(MCPPromptArgumentSchema).optional(),
});
export const MCPPromptMessageContentSchema = z.union([
    z.object({
        type: z.literal('text'),
        text: z.string(),
    }),
    z.object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string(),
    }),
    z.object({
        type: z.literal('resource'),
        resource: z.object({
            uri: z.string(),
            mimeType: z.string().optional(),
            text: z.string().optional(),
        }),
    }),
]);
export const MCPPromptMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
        MCPPromptMessageContentSchema,
        z.array(MCPPromptMessageContentSchema),
    ]),
});
export const MCPConfigSchema = z.union([
    z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
    }),
    z.object({
        url: z.string(),
        headers: z.record(z.string()).optional(),
    }),
]);
export function isCommandBasedConfig(config) {
    return 'command' in config;
}
export const LoadMCPRequestSchema = z.object({
    mcp_name: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9-_]+$/),
    mcp_config: MCPConfigSchema,
});
export const ExecuteCodeRequestSchema = z
    .object({
    mcp_id: z.string().uuid().optional(),
    mcp_name: z.string().min(1).max(100).optional(),
    code: z.string().min(1).max(50000),
    timeout_ms: z.number().min(100).max(60000).default(30000),
})
    .refine((data) => data.mcp_id || data.mcp_name, {
    message: 'Either mcp_id or mcp_name must be provided',
    path: ['mcp_id'],
});
//# sourceMappingURL=mcp.js.map