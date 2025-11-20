import { z } from 'zod'

/**
 * JSON Schema type definition for MCP tool input schemas
 * Based on JSON Schema specification
 */
export interface JSONSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  description?: string
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  items?: JSONSchemaProperty
  default?: unknown
  enum?: unknown[]
  [key: string]: unknown // Allow additional JSON Schema properties
}

// MCP Tool Schema
export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal('object'),
    // JSON Schema properties can be complex nested structures
    // Using unknown is safer than any and allows proper type checking when accessed
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
})

export type MCPTool = z.infer<typeof MCPToolSchema>

// MCP Configuration
// Supports both command-based (local) and url-based (remote) MCP servers
export const MCPConfigSchema = z.union([
  // Command-based MCP (local execution)
  z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  }),
  // URL-based MCP (remote HTTP endpoint)
  z.object({
    url: z.string(),
    headers: z.record(z.string()).optional(),
  }),
])

export type MCPConfig = z.infer<typeof MCPConfigSchema>

// Load MCP Request
export const LoadMCPRequestSchema = z.object({
  mcp_name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/),
  mcp_config: MCPConfigSchema,
})

export type LoadMCPRequest = z.infer<typeof LoadMCPRequestSchema>

// Execute Code Request
export const ExecuteCodeRequestSchema = z.object({
  mcp_id: z.string().uuid().optional(),
  mcp_name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50000),
  timeout_ms: z.number().min(100).max(60000).default(30000),
}).refine(
  (data) => data.mcp_id || data.mcp_name,
  {
    message: "Either mcp_id or mcp_name must be provided",
    path: ["mcp_id"],
  }
)

export type ExecuteCodeRequest = z.infer<typeof ExecuteCodeRequestSchema>

// Schema Efficiency Metrics
export interface SchemaEfficiencyMetrics {
  total_tools_available: number
  tools_used: string[]
  schema_size_total_chars: number
  schema_size_used_chars: number
  schema_utilization_percent: number
  schema_efficiency_ratio: number
  schema_size_reduction_chars: number
  schema_size_reduction_percent: number
  estimated_tokens_total?: number
  estimated_tokens_used?: number
  estimated_tokens_saved?: number
}

// Security Metrics
export interface SecurityMetrics {
  network_isolation_enabled: boolean
  process_isolation_enabled: boolean
  isolation_type: string
  security_level: string
  protection_summary: string[]
}

// Execution Result
export interface ExecutionResult {
  success: boolean
  output?: string
  error?: string
  execution_time_ms: number
  metrics: {
    mcp_calls_made: number
    tools_called?: string[]
    schema_efficiency?: SchemaEfficiencyMetrics
    security?: SecurityMetrics
  }
}

// MCP Instance
export interface MCPInstance {
  mcp_id: string
  mcp_name: string
  status: 'initializing' | 'ready' | 'error' | 'stopped'
  worker_id?: string
  typescript_api: string
  tools: MCPTool[]
  created_at: Date
  uptime_ms: number
}

// Enhanced error response structure
export interface EnhancedErrorResponse {
  error_code: string
  error_message: string
  suggested_action?: string
  /**
   * Additional context about the error (e.g., tool name, status code, etc.)
   */
  context?: Record<string, unknown>
  /**
   * Additional error details (e.g., stack trace, nested errors, etc.)
   */
  details?: unknown
}

// Enhanced load MCP response
export interface EnhancedLoadMCPResponse {
  success: boolean
  mcp_id: string
  mcp_name: string
  status: string
  tools_count: number
  typescript_api: string
  available_tools: string[]
  load_time_ms: number
  usage_example?: string
  example_code?: string
}

// Enhanced get schema response
export interface EnhancedGetSchemaResponse {
  mcp_id: string
  mcp_name: string
  typescript_api: string
  tools: MCPTool[]
  common_patterns?: string[]
}

// Saved MCP Config Entry
export interface SavedMCPConfig {
  mcp_name: string
  config: MCPConfig
  source: 'cursor' | 'claude-code' | 'github-copilot'
}
