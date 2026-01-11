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
 * Security settings for an MCP server (stored format - without isGuarded)
 * isGuarded is derived from IDE config, not stored in settings.json
 */
export interface MCPSecurityConfigStored {
  /** Unique identifier for this configuration */
  id: string;
  /** Name of the MCP server */
  mcpName: string;
  // isGuarded is NOT stored - it's derived from IDE config (_mcpguard_disabled)
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
 * Security settings for an MCP server (with computed isGuarded)
 * isGuarded is derived from whether the MCP is in _mcpguard_disabled in IDE config
 */
export interface MCPSecurityConfig extends MCPSecurityConfigStored {
  /** Computed from IDE config - true if MCP is in _mcpguard_disabled */
  isGuarded: boolean;
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
  /** NPM package name (for npx-based MCPs only) */
  packageName?: string;
  /** Installed version detected during assessment (for npx-based MCPs only) */
  installedVersion?: string;
  /** Latest version from npm registry (checked async) */
  latestVersion?: string;
  /** ISO timestamp of last version check */
  versionCheckedAt?: string;
}

/**
 * OAuth protected resource metadata (from /.well-known/oauth-protected-resource or WWW-Authenticate header)
 * See RFC 9728: OAuth 2.0 Protected Resource Metadata
 */
export interface MCPOAuthMetadata {
  /** Resource identifier (usually the MCP server URL) */
  resource?: string;
  /** List of authorization server URLs that can be used */
  authorization_servers?: string[];
  /** OAuth 2.0 scopes required to access the resource */
  scopes_supported?: string[];
  /** Bearer token type methods supported */
  bearer_methods_supported?: string[];
  /** Resource documentation URL */
  resource_documentation?: string;
  /** How OAuth was detected: 'well-known' or 'www-authenticate' */
  detectedVia?: 'well-known' | 'www-authenticate';
  /** Raw WWW-Authenticate header value if detected via header */
  wwwAuthenticate?: string;
  /** When this metadata was discovered */
  discoveredAt: string;
}


/**
 * Assessment error info for MCPs that failed assessment
 */
export interface MCPAssessmentError {
  /** Error type - 'oauth_required' indicates OAuth flow is needed, 'sdk_mismatch' indicates SDK transport failed */
  type: 'auth_failed' | 'oauth_required' | 'connection_failed' | 'timeout' | 'sdk_mismatch' | 'unknown';
  /** Human-readable message */
  message: string;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** HTTP status text if applicable */
  statusText?: string;
  /** When this error occurred */
  errorAt: string;
  /** OAuth metadata if OAuth is required */
  oauthMetadata?: MCPOAuthMetadata;
  /** SDK validation details (for sdk_mismatch errors) */
  sdkValidation?: {
    /** Number of tools from direct fetch */
    directFetchTools: number;
    /** Number of tools from SDK transport (-1 if failed) */
    sdkTransportTools: number;
    /** Error message from SDK transport if it failed */
    sdkError?: string;
  };
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
 * Global MCP Guard settings (stored format)
 */
export interface MCPGuardSettingsStored {
  /** Whether MCP Guard is globally enabled */
  enabled: boolean;
  /** Default security settings for new MCPs */
  defaults: Omit<MCPSecurityConfigStored, 'id' | 'mcpName' | 'lastModified'>;
  /** Per-MCP configurations (without isGuarded - it's derived from IDE config) */
  mcpConfigs: MCPSecurityConfigStored[];
  /** Cached token metrics for MCPs (assessed once per MCP) */
  tokenMetricsCache?: TokenMetricsCache;
  /** Cached assessment errors for MCPs */
  assessmentErrorsCache?: AssessmentErrorsCache;
  /** Context window size in tokens (default: 200000) */
  contextWindowSize?: number;
}

/**
 * Global MCP Guard settings (with computed isGuarded)
 */
export interface MCPGuardSettings {
  /** Whether MCP Guard is globally enabled */
  enabled: boolean;
  /** Default security settings for new MCPs */
  defaults: Omit<MCPSecurityConfig, 'id' | 'mcpName' | 'isGuarded' | 'lastModified'>;
  /** Per-MCP configurations (isGuarded derived from IDE config) */
  mcpConfigs: MCPSecurityConfig[];
  /** Cached token metrics for MCPs (assessed once per MCP) */
  tokenMetricsCache?: TokenMetricsCache;
  /** Cached assessment errors for MCPs */
  assessmentErrorsCache?: AssessmentErrorsCache;
  /** Context window size in tokens (default: 200000) */
  contextWindowSize?: number;
}

/**
 * MCP configuration for adding a new MCP
 */
export interface MCPConfigInput {
  /** Command to run the MCP server (for command-based MCPs) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** URL for URL-based MCPs */
  url?: string;
  /** HTTP headers for URL-based MCPs */
  headers?: Record<string, string>;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Message types for webview communication
 */
export type WebviewMessage =
  | { type: 'getSettings' }
  | { type: 'getMCPServers' }
  | { type: 'saveSettings'; data: MCPGuardSettings }
  | { type: 'saveMCPConfig'; data: MCPSecurityConfig; source?: 'claude' | 'copilot' | 'cursor' }
  | { type: 'importFromIDE' }
  | { type: 'refreshMCPs' }
  | { type: 'openMCPGuardDocs' }
  | { type: 'assessTokens'; mcpName: string }
  | { type: 'openIDEConfig'; source: 'claude' | 'copilot' | 'cursor' | 'unknown' }
  | { type: 'retryAssessment'; mcpName: string; source?: 'claude' | 'copilot' | 'cursor' }
  | { type: 'openLogs' }
  | { type: 'testConnection'; mcpName: string }
  | { type: 'openExternalLink'; url: string }
  | { type: 'deleteMCP'; mcpName: string; source?: 'claude' | 'copilot' | 'cursor' }
  | { type: 'addMCP'; name: string; config: MCPConfigInput }
  | { type: 'invalidateCache'; mcpName: string }
  | { type: 'checkVersion'; mcpName: string };

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
export const DEFAULT_SECURITY_CONFIG: Omit<MCPSecurityConfigStored, 'id' | 'mcpName' | 'lastModified'> = {
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








