/**
 * MCP Guard Configuration Types
 */

/**
 * Network access configuration for Worker isolation
 */
export interface NetworkConfig {
  /** Whether network access is enabled (false = complete isolation) */
  enabled: boolean;
  /** Allowlist of domains/hosts that can be accessed */
  allowlist: string[];
  /** Whether to allow localhost access */
  allowLocalhost: boolean;
}

/**
 * File system access configuration
 */
export interface FileSystemConfig {
  /** Whether file system access is enabled */
  enabled: boolean;
  /** Directories that can be read from */
  readPaths: string[];
  /** Directories that can be written to */
  writePaths: string[];
}

/**
 * Resource limits for Worker execution
 */
export interface ResourceLimits {
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs: number;
  /** Maximum memory usage in MB */
  maxMemoryMB: number;
  /** Maximum number of MCP calls per execution */
  maxMCPCalls: number;
}

/**
 * Security settings for an MCP server
 */
export interface MCPSecurityConfig {
  /** Unique identifier for this configuration */
  id: string;
  /** Name of the MCP server */
  mcpName: string;
  /** Whether this MCP is guarded by MCP Guard */
  isGuarded: boolean;
  /** Network access configuration */
  network: NetworkConfig;
  /** File system access configuration */
  fileSystem: FileSystemConfig;
  /** Resource limits */
  resourceLimits: ResourceLimits;
  /** Last modified timestamp */
  lastModified: string;
}

/**
 * Token metrics for an MCP server
 * Used to calculate context window savings
 */
export interface MCPTokenMetrics {
  /** Number of tools available in this MCP */
  toolCount: number;
  /** Total characters in the tool schemas (JSON) */
  schemaChars: number;
  /** Estimated tokens (schemaChars / 3.5) */
  estimatedTokens: number;
  /** When this assessment was performed */
  assessedAt: string;
}

/**
 * Assessment error info for MCPs that failed assessment
 */
export interface MCPAssessmentError {
  /** Error type */
  type: 'auth_failed' | 'connection_failed' | 'timeout' | 'unknown';
  /** Human-readable message */
  message: string;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** HTTP status text if applicable */
  statusText?: string;
  /** When this error occurred */
  errorAt: string;
  /** Diagnostic details for troubleshooting */
  diagnostics?: {
    /** URL that was requested */
    requestUrl?: string;
    /** Method used (POST, GET, etc.) */
    requestMethod?: string;
    /** Headers that were sent (sensitive values masked) */
    requestHeaders?: Record<string, string>;
    /** Body that was sent */
    requestBody?: string;
    /** Response body (truncated if too long) */
    responseBody?: string;
    /** Response headers */
    responseHeaders?: Record<string, string>;
    /** Raw error message from the exception */
    rawError?: string;
  };
}

/**
 * MCP server info from IDE config
 */
export interface MCPServerInfo {
  /** Name of the MCP server */
  name: string;
  /** Command to run the MCP server */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** URL for URL-based MCPs */
  url?: string;
  /** HTTP headers for URL-based MCPs (e.g., Authorization) */
  headers?: Record<string, string>;
  /** Environment variables */
  env?: Record<string, string>;
  /** Source IDE (claude, copilot, cursor) */
  source: 'claude' | 'copilot' | 'cursor' | 'unknown';
  /** Whether the server is currently enabled in the IDE config */
  enabled: boolean;
  /** Token metrics (assessed once) */
  tokenMetrics?: MCPTokenMetrics;
  /** Assessment error if failed */
  assessmentError?: MCPAssessmentError;
}

/**
 * Token metrics cache entry
 */
export interface TokenMetricsCache {
  /** Cached token metrics per MCP name */
  [mcpName: string]: MCPTokenMetrics;
}

/**
 * Assessment errors cache
 */
export interface AssessmentErrorsCache {
  /** Cached assessment errors per MCP name */
  [mcpName: string]: MCPAssessmentError;
}

/**
 * Global MCP Guard settings
 */
export interface MCPGuardSettings {
  /** Whether MCP Guard is globally enabled */
  enabled: boolean;
  /** Default security settings for new MCPs */
  defaults: Omit<MCPSecurityConfig, 'id' | 'mcpName' | 'isGuarded' | 'lastModified'>;
  /** Per-MCP configurations */
  mcpConfigs: MCPSecurityConfig[];
  /** Cached token metrics for MCPs (assessed once per MCP) */
  tokenMetricsCache?: TokenMetricsCache;
  /** Cached assessment errors for MCPs */
  assessmentErrorsCache?: AssessmentErrorsCache;
}

/**
 * Message types for webview communication
 */
export type WebviewMessage =
  | { type: 'getSettings' }
  | { type: 'getMCPServers' }
  | { type: 'saveSettings'; data: MCPGuardSettings }
  | { type: 'saveMCPConfig'; data: MCPSecurityConfig }
  | { type: 'importFromIDE' }
  | { type: 'refreshMCPs' }
  | { type: 'openMCPGuardDocs' }
  | { type: 'assessTokens'; mcpName: string }
  | { type: 'openIDEConfig'; source: 'claude' | 'copilot' | 'cursor' | 'unknown' }
  | { type: 'retryAssessment'; mcpName: string }
  | { type: 'openLogs' }
  | { type: 'testConnection'; mcpName: string };

/**
 * Token savings summary data
 */
export interface TokenSavingsSummary {
  /** Total tokens that would be used without MCPGuard */
  totalTokensWithoutGuard: number;
  /** Tokens used by MCPGuard itself (~500 for its tools) */
  mcpGuardTokens: number;
  /** Net tokens saved */
  tokensSaved: number;
  /** Number of MCPs with assessed token metrics */
  assessedMCPs: number;
  /** Number of guarded MCPs contributing to savings */
  guardedMCPs: number;
  /** Whether some guarded MCPs are using estimated tokens */
  hasEstimates?: boolean;
}

/**
 * Connection test result with detailed diagnostics
 */
export interface ConnectionTestResult {
  /** Whether the connection test succeeded */
  success: boolean;
  /** MCP name that was tested */
  mcpName: string;
  /** Step-by-step log of the test */
  steps: ConnectionTestStep[];
  /** Final error if failed */
  error?: MCPAssessmentError;
  /** Duration of the test in ms */
  durationMs: number;
}

/**
 * Single step in a connection test
 */
export interface ConnectionTestStep {
  /** Step name/description */
  name: string;
  /** Whether this step succeeded */
  success: boolean;
  /** Additional details */
  details?: string;
  /** Duration of this step in ms */
  durationMs?: number;
  /** Request/response data for this step */
  data?: {
    request?: string;
    response?: string;
  };
}

/**
 * Response messages from extension to webview
 */
export type ExtensionMessage =
  | { type: 'settings'; data: MCPGuardSettings }
  | { type: 'mcpServers'; data: MCPServerInfo[] }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string }
  | { type: 'loading'; isLoading: boolean }
  | { type: 'tokenSavings'; data: TokenSavingsSummary }
  | { type: 'tokenAssessmentProgress'; mcpName: string; status: 'started' | 'completed' | 'failed' }
  | { type: 'connectionTestResult'; data: ConnectionTestResult }
  | { type: 'connectionTestProgress'; mcpName: string; step: string };

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: Omit<MCPSecurityConfig, 'id' | 'mcpName' | 'isGuarded' | 'lastModified'> = {
  network: {
    enabled: false,
    allowlist: [],
    allowLocalhost: false,
  },
  fileSystem: {
    enabled: false,
    readPaths: [],
    writePaths: [],
  },
  resourceLimits: {
    maxExecutionTimeMs: 30000,
    maxMemoryMB: 128,
    maxMCPCalls: 100,
  },
};

/**
 * Default global settings
 */
export const DEFAULT_SETTINGS: MCPGuardSettings = {
  enabled: true,
  defaults: DEFAULT_SECURITY_CONFIG,
  mcpConfigs: [],
};








