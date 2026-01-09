/**
 * Shared types for the webview
 * These are duplicated from extension/types.ts to avoid import issues in the browser context
 */

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

/**
 * Security configuration for an MCP server
 * Note: isGuarded is computed from IDE config (whether MCP is in _mcpguard_disabled)
 * It is NOT stored in settings.json - the extension derives it at runtime
 */
export interface MCPSecurityConfig {
  id: string;
  mcpName: string;
  /** Computed from IDE config - true if MCP is in _mcpguard_disabled section */
  isGuarded: boolean;
  network: NetworkConfig;
  fileSystem: FileSystemConfig;
  resourceLimits: ResourceLimits;
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
  /** Error type - 'oauth_required' indicates OAuth flow is needed */
  type: 'auth_failed' | 'oauth_required' | 'connection_failed' | 'timeout' | 'unknown';
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

export interface MCPServerInfo {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  /** HTTP headers for URL-based MCPs */
  headers?: Record<string, string>;
  env?: Record<string, string>;
  source: 'claude' | 'copilot' | 'cursor' | 'unknown';
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

export interface MCPGuardSettings {
  enabled: boolean;
  defaults: Omit<MCPSecurityConfig, 'id' | 'mcpName' | 'isGuarded' | 'lastModified'>;
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
  | { type: 'testConnection'; mcpName: string }
  | { type: 'openExternalLink'; url: string }
  | { type: 'deleteMCP'; mcpName: string }
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

export const DEFAULT_SETTINGS: MCPGuardSettings = {
  enabled: true,
  defaults: DEFAULT_SECURITY_CONFIG,
  mcpConfigs: [],
};

// ====================
// Security Testing Types
// ====================

export type TestCategory = 'legitimateCall' | 'networkIsolation' | 'codeInjection' | 'filesystemIsolation';

export interface SecurityTest {
  id: string;
  name: string;
  description: string;
  category: TestCategory;
  code: string;
  expectedResult: 'success' | 'blocked';
  explanation: string;
}

export interface TestPrompt {
  mcpName: string;
  testName: string;
  prompt: string;
  code: string;
  expectedOutcome: string;
}

// Test category metadata for UI display
export const TEST_CATEGORIES: Record<TestCategory, { name: string; description: string; icon: string }> = {
  legitimateCall: {
    name: 'Legitimate Tool Call',
    description: 'Verifies that normal MCP tool calls work correctly when guarded',
    icon: 'check',
  },
  networkIsolation: {
    name: 'Network Isolation',
    description: 'Tests that arbitrary network requests (fetch, HTTP) are blocked',
    icon: 'network',
  },
  codeInjection: {
    name: 'Code Injection Prevention',
    description: 'Tests that dangerous code patterns (eval, Function) are blocked',
    icon: 'shield',
  },
  filesystemIsolation: {
    name: 'Filesystem Isolation',
    description: 'Tests that filesystem access attempts are blocked',
    icon: 'folder',
  },
};

// VSCode API type for webview context
declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: WebviewMessage) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}








