/**
 * Token Assessor
 *
 * Assesses token usage for MCP servers by temporarily spawning them
 * to fetch their tool schemas. Results are cached to avoid repeated assessments.
 */

import { type ChildProcess, spawn } from 'child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  MCPAssessmentError,
  MCPOAuthMetadata,
  MCPSecurityConfig,
  MCPServerInfo,
  MCPTokenMetrics,
  TokenMetricsCache,
  TokenSavingsSummary,
} from './types'
import {
  detectInstalledVersion,
  extractPackageName,
  isNpxCommand,
} from './version-checker'

/**
 * Validate URL-based MCP using MCP SDK's StreamableHTTPClientTransport
 * This is the same method used by MCPGuard server at runtime
 * Returns the number of tools or -1 if validation fails
 */
async function validateWithSDKTransport(
  url: string,
  headers?: Record<string, string>,
): Promise<{ toolCount: number; error?: string }> {
  let client: Client | null = null
  let transport: StreamableHTTPClientTransport | null = null

  try {
    const parsedUrl = new URL(url)
    const transportOptions: { requestInit?: RequestInit } = {}

    if (headers) {
      transportOptions.requestInit = {
        headers: headers,
      }
    }

    transport = new StreamableHTTPClientTransport(parsedUrl, transportOptions)

    client = new Client(
      { name: 'mcpguard-validator', version: '0.1.0' },
      { capabilities: {} },
    )

    // Connect with timeout
    await client.connect(transport, { timeout: 10000 })

    // Fetch tools
    const toolsResponse = await client.listTools()
    const toolCount = toolsResponse.tools.length

    console.log(
      `SDK Validation: ${url} - received ${toolCount} tools via SDK transport`,
    )

    return { toolCount }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.log(`SDK Validation: ${url} - failed: ${errorMessage}`)
    return { toolCount: -1, error: errorMessage }
  } finally {
    // Clean up
    if (client) {
      try {
        await client.close()
      } catch {
        // Ignore cleanup errors
      }
    }
    if (transport) {
      try {
        await transport.close()
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Tool schema format from MCP protocol
 */
interface MCPToolSchema {
  name: string
  description?: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Estimate tokens from character count
 * JSON/structured data typically tokenizes at ~3-4 chars/token
 * Using 3.5 as a middle ground
 */
function estimateTokens(chars: number): number {
  return Math.round(chars / 3.5)
}

/**
 * MCPGuard's own tools (approximate schema size)
 * These tools are always loaded regardless of how many MCPs are guarded:
 * - connect
 * - call_mcp
 * - list_available_mcps
 * - get_mcp_by_name
 * - get_mcp_schema
 * - disconnect
 * - get_metrics
 * - import_configs
 * - search_mcp_tools
 * - guard
 *
 * Estimated ~500 tokens for all MCPGuard tools combined
 */
const MCPGUARD_BASELINE_TOKENS = 500

/**
 * Default estimate for MCPs that can't be assessed
 * Based on typical MCP tool schemas (10-15 tools averaging ~50-100 tokens each)
 */
const DEFAULT_UNASSESSED_TOKENS = 800

/**
 * Result of URL-based MCP assessment
 */
interface URLAssessmentResult {
  metrics?: MCPTokenMetrics
  error?: MCPAssessmentError
}

/**
 * Mask sensitive header values for logging
 */
function maskSensitiveHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  if (!headers) return {}
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === 'authorization' ||
      lowerKey.includes('token') ||
      lowerKey.includes('key')
    ) {
      // Show first 10 chars and mask the rest
      masked[key] = value.length > 15 ? `${value.substring(0, 10)}...` : '***'
    } else {
      masked[key] = value
    }
  }
  return masked
}

/**
 * Truncate response body for logging (keep first 500 chars)
 */
function truncateBody(body: string, maxLength = 500): string {
  if (body.length <= maxLength) return body
  return (
    body.substring(0, maxLength) + `... (truncated, total ${body.length} chars)`
  )
}

/**
 * Discover OAuth metadata from a URL-based MCP server
 * Checks the /.well-known/oauth-protected-resource endpoint (RFC 9728)
 * @param baseUrl The MCP server URL
 * @returns OAuth metadata if the server requires OAuth, null otherwise
 */
export async function discoverOAuthMetadata(
  baseUrl: string,
): Promise<MCPOAuthMetadata | null> {
  try {
    const url = new URL(baseUrl)
    // Construct the well-known OAuth protected resource URL
    const wellKnownUrl = `${url.origin}/.well-known/oauth-protected-resource`

    console.log(`OAuth Discovery: Checking ${wellKnownUrl}...`)

    const response = await fetch(wellKnownUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      console.log(
        `OAuth Discovery: ${wellKnownUrl} returned ${response.status} - server may not require OAuth`,
      )
      return null
    }

    const metadata = (await response.json()) as {
      resource?: string
      authorization_servers?: string[]
      scopes_supported?: string[]
      bearer_methods_supported?: string[]
      resource_documentation?: string
    }

    // Validate that we have the minimum required fields
    if (
      !metadata.authorization_servers ||
      metadata.authorization_servers.length === 0
    ) {
      console.log(
        `OAuth Discovery: ${wellKnownUrl} response missing authorization_servers`,
      )
      return null
    }

    console.log(
      `OAuth Discovery: Found OAuth metadata for ${baseUrl}:`,
      JSON.stringify(metadata, null, 2),
    )

    return {
      resource: metadata.resource,
      authorization_servers: metadata.authorization_servers,
      scopes_supported: metadata.scopes_supported,
      bearer_methods_supported: metadata.bearer_methods_supported,
      resource_documentation: metadata.resource_documentation,
      discoveredAt: new Date().toISOString(),
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.log(`OAuth Discovery: Error checking ${baseUrl}: ${errorMsg}`)
    return null
  }
}

/**
 * Assess token usage for a URL-based MCP using Streamable HTTP
 * Properly handles session state via Mcp-Session-Id header
 */
async function assessURLBasedMCP(
  server: MCPServerInfo,
): Promise<URLAssessmentResult> {
  if (!server.url) {
    console.log(`Token Assessor: ${server.name} has no URL, skipping`)
    return {
      error: {
        type: 'unknown',
        message: 'No URL configured',
        errorAt: new Date().toISOString(),
      },
    }
  }

  console.log(
    `Token Assessor: Assessing URL-based MCP ${server.name} at ${server.url}...`,
  )
  console.log(
    `Token Assessor: Headers configured: ${server.headers ? Object.keys(server.headers).join(', ') : 'none'}`,
  )

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...server.headers,
  }

  const initRequestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'mcpguard-token-assessor',
        version: '1.0.0',
      },
    },
  })

  // Session ID for Streamable HTTP - captured from initialize response
  let sessionId: string | null = null

  try {
    // Initialize the MCP connection
    console.log(
      `Token Assessor: Sending initialize request to ${server.url}...`,
    )
    const initResponse = await fetch(server.url, {
      method: 'POST',
      headers: baseHeaders,
      body: initRequestBody,
      signal: AbortSignal.timeout(10000),
    })

    // Collect response info for diagnostics
    const initResponseHeaders: Record<string, string> = {}
    initResponse.headers.forEach((value, key) => {
      initResponseHeaders[key] = value
    })

    // Capture session ID from response (case-insensitive header lookup)
    sessionId =
      initResponse.headers.get('mcp-session-id') ||
      initResponse.headers.get('Mcp-Session-Id')
    if (sessionId) {
      console.log(
        `Token Assessor: ${server.name} returned session ID: ${sessionId.substring(0, 20)}...`,
      )
    } else {
      console.log(`Token Assessor: ${server.name} did not return a session ID`)
    }

    if (!initResponse.ok) {
      const statusCode = initResponse.status
      const statusText = initResponse.statusText
      let responseBody = ''
      try {
        responseBody = await initResponse.text()
      } catch {
        responseBody = '(could not read response body)'
      }

      console.log(
        `Token Assessor: ${server.name} init failed with status ${statusCode}`,
      )
      console.log(
        `Token Assessor: Response body: ${truncateBody(responseBody)}`,
      )

      const diagnostics = {
        requestUrl: server.url,
        requestMethod: 'POST',
        requestHeaders: maskSensitiveHeaders(baseHeaders),
        requestBody: initRequestBody,
        responseBody: truncateBody(responseBody),
        responseHeaders: initResponseHeaders,
      }

      if (statusCode === 401 || statusCode === 403) {
        // Check for OAuth requirement from WWW-Authenticate header first
        const wwwAuth = initResponse.headers.get('www-authenticate') || ''
        const isOAuthBearer = wwwAuth.toLowerCase().includes('bearer')
        
        console.log(`Token Assessor: ${server.name} got ${statusCode}, checking OAuth...`)
        console.log(`Token Assessor: WWW-Authenticate header: "${wwwAuth}"`)
        console.log(`Token Assessor: isOAuthBearer: ${isOAuthBearer}`)
        
        // Also check well-known endpoint for OAuth metadata
        const oauthMetadata = await discoverOAuthMetadata(server.url)
        console.log(`Token Assessor: OAuth metadata from well-known: ${oauthMetadata ? 'found' : 'not found'}`)

        if (oauthMetadata || isOAuthBearer) {
          console.log(
            `Token Assessor: ${server.name} requires OAuth authentication` +
            (isOAuthBearer ? ' (detected via WWW-Authenticate header)' : ''),
          )
          return {
            error: {
              type: 'oauth_required',
              message: `This MCP server requires OAuth authentication, which MCPGuard cannot support.`,
              statusCode,
              statusText,
              errorAt: new Date().toISOString(),
              oauthMetadata: oauthMetadata || {
                // Create minimal metadata from WWW-Authenticate header
                discoveredAt: new Date().toISOString(),
                detectedVia: 'www-authenticate',
                wwwAuthenticate: wwwAuth,
              },
              diagnostics,
            },
          }
        }

        console.log(`Token Assessor: ${server.name} - no OAuth detected, returning auth_failed`)
        return {
          error: {
            type: 'auth_failed',
            message: `Authentication failed (HTTP ${statusCode}${statusText ? ' ' + statusText : ''}). Check your Authorization header.`,
            statusCode,
            statusText,
            errorAt: new Date().toISOString(),
            diagnostics,
          },
        }
      }

      return {
        error: {
          type: 'connection_failed',
          message: `Server returned HTTP ${statusCode}${statusText ? ' ' + statusText : ''}`,
          statusCode,
          statusText,
          errorAt: new Date().toISOString(),
          diagnostics,
        },
      }
    }

    // Read and log the initialize response body
    let initResponseBody = ''
    try {
      initResponseBody = await initResponse.text()
      console.log(
        `Token Assessor: ${server.name} init response: ${truncateBody(initResponseBody, 200)}`,
      )
    } catch {
      console.log(
        `Token Assessor: ${server.name} could not read init response body`,
      )
    }

    // Build headers for subsequent requests - include session ID if provided
    const toolsRequestHeaders: Record<string, string> = { ...baseHeaders }
    if (sessionId) {
      toolsRequestHeaders['mcp-session-id'] = sessionId
    }

    // Fetch tools list
    const toolsRequestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })

    console.log(
      `Token Assessor: Sending tools/list request to ${server.url}${sessionId ? ' with session ID' : ''}...`,
    )
    const toolsResponse = await fetch(server.url, {
      method: 'POST',
      headers: toolsRequestHeaders,
      body: toolsRequestBody,
      signal: AbortSignal.timeout(10000),
    })

    // Collect tools response headers
    const toolsResponseHeaders: Record<string, string> = {}
    toolsResponse.headers.forEach((value, key) => {
      toolsResponseHeaders[key] = value
    })

    if (!toolsResponse.ok) {
      const statusCode = toolsResponse.status
      const statusText = toolsResponse.statusText
      let responseBody = ''
      try {
        responseBody = await toolsResponse.text()
      } catch {
        responseBody = '(could not read response body)'
      }

      console.log(
        `Token Assessor: ${server.name} tools/list failed with status ${statusCode}`,
      )
      console.log(
        `Token Assessor: tools/list response body: ${truncateBody(responseBody)}`,
      )

      const diagnostics = {
        requestUrl: server.url,
        requestMethod: 'POST',
        requestHeaders: maskSensitiveHeaders(toolsRequestHeaders),
        requestBody: toolsRequestBody,
        responseBody: truncateBody(responseBody),
        responseHeaders: toolsResponseHeaders,
      }

      // Check if this is a session-related error
      const isSessionError =
        statusCode === 400 &&
        (responseBody.toLowerCase().includes('session') ||
          responseBody.toLowerCase().includes('invalid') ||
          !sessionId)

      if (isSessionError) {
        return {
          error: {
            type: 'connection_failed',
            message: `Session error (HTTP ${statusCode}). The server may require session-based authentication that isn't available during assessment.`,
            statusCode,
            statusText,
            errorAt: new Date().toISOString(),
            diagnostics,
          },
        }
      }

      if (statusCode === 401 || statusCode === 403) {
        // Check for OAuth requirement from WWW-Authenticate header first
        const wwwAuth = toolsResponse.headers.get('www-authenticate') || ''
        const isOAuthBearer = wwwAuth.toLowerCase().includes('bearer')
        
        // Also check well-known endpoint for OAuth metadata
        const oauthMetadata = await discoverOAuthMetadata(server.url)

        if (oauthMetadata || isOAuthBearer) {
          console.log(
            `Token Assessor: ${server.name} requires OAuth authentication (on tools/list)` +
            (isOAuthBearer ? ' (detected via WWW-Authenticate header)' : ''),
          )
          return {
            error: {
              type: 'oauth_required',
              message: `This MCP server requires OAuth authentication, which MCPGuard cannot support.`,
              statusCode,
              statusText,
              errorAt: new Date().toISOString(),
              oauthMetadata: oauthMetadata || {
                discoveredAt: new Date().toISOString(),
                detectedVia: 'www-authenticate',
                wwwAuthenticate: wwwAuth,
              },
              diagnostics,
            },
          }
        }

        return {
          error: {
            type: 'auth_failed',
            message: `Authentication failed (HTTP ${statusCode}${statusText ? ' ' + statusText : ''}). Check your Authorization header.`,
            statusCode,
            statusText,
            errorAt: new Date().toISOString(),
            diagnostics,
          },
        }
      }

      return {
        error: {
          type: 'connection_failed',
          message: `Server returned HTTP ${statusCode}${statusText ? ' ' + statusText : ''} on tools/list request`,
          statusCode,
          statusText,
          errorAt: new Date().toISOString(),
          diagnostics,
        },
      }
    }

    const toolsResponseText = await toolsResponse.text()
    console.log(
      `Token Assessor: ${server.name} tools/list response: ${truncateBody(toolsResponseText, 200)}`,
    )

    // Parse the response - handle both JSON-RPC and SSE formats
    let tools: MCPToolSchema[] = []
    try {
      // Try parsing as regular JSON first
      const toolsResult = JSON.parse(toolsResponseText) as {
        result?: { tools?: MCPToolSchema[] }
      }
      tools = toolsResult.result?.tools || []
    } catch {
      // If JSON parsing fails, try to extract from SSE format
      console.log(
        `Token Assessor: ${server.name} response is not plain JSON, trying SSE format...`,
      )
      const lines = toolsResponseText.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6))
            if (data.result?.tools) {
              tools = data.result.tools
              break
            }
          } catch {
            // Continue to next line
          }
        }
      }
    }

    if (tools.length === 0) {
      console.log(`Token Assessor: ${server.name} returned no tools`)
      return {
        error: {
          type: 'unknown',
          message: 'Server returned no tools',
          errorAt: new Date().toISOString(),
          diagnostics: {
            requestUrl: server.url,
            requestMethod: 'POST',
            requestHeaders: maskSensitiveHeaders(toolsRequestHeaders),
            requestBody: toolsRequestBody,
            responseBody: truncateBody(toolsResponseText),
            responseHeaders: toolsResponseHeaders,
          },
        },
      }
    }

    // Calculate schema size
    const schemaChars = JSON.stringify(tools).length
    const estimatedTokens = estimateTokens(schemaChars)

    // Validate with SDK transport (same as MCPGuard server uses at runtime)
    // This ensures the UI shows accurate information about what MCPGuard can actually use
    console.log(
      `Token Assessor: ${server.name} - validating with SDK transport...`,
    )
    const sdkValidation = await validateWithSDKTransport(server.url!, server.headers)

    // If SDK validation failed or returned 0 tools when direct fetch got tools,
    // this indicates MCPGuard server won't be able to use this MCP
    if (sdkValidation.toolCount === -1) {
      console.log(
        `Token Assessor: ${server.name} - SDK validation FAILED: ${sdkValidation.error}`,
      )
      return {
        error: {
          type: 'sdk_mismatch',
          message: `MCPGuard cannot connect to this MCP. Direct fetch succeeded with ${tools.length} tools, but SDK transport failed. This means MCPGuard server won't be able to guard this MCP.`,
          errorAt: new Date().toISOString(),
          sdkValidation: {
            directFetchTools: tools.length,
            sdkTransportTools: -1,
            sdkError: sdkValidation.error,
          },
          diagnostics: {
            requestUrl: server.url,
            requestMethod: 'POST',
            requestHeaders: maskSensitiveHeaders(baseHeaders),
          },
        },
      }
    }

    if (sdkValidation.toolCount === 0 && tools.length > 0) {
      console.log(
        `Token Assessor: ${server.name} - SDK validation MISMATCH: direct fetch got ${tools.length} tools but SDK got 0`,
      )
      return {
        error: {
          type: 'sdk_mismatch',
          message: `MCPGuard cannot use this MCP. Direct fetch returned ${tools.length} tools, but SDK transport returned 0. This indicates an authentication or protocol issue.`,
          errorAt: new Date().toISOString(),
          sdkValidation: {
            directFetchTools: tools.length,
            sdkTransportTools: 0,
            sdkError: 'SDK returned 0 tools while direct fetch succeeded',
          },
          diagnostics: {
            requestUrl: server.url,
            requestMethod: 'POST',
            requestHeaders: maskSensitiveHeaders(baseHeaders),
          },
        },
      }
    }

    const metrics: MCPTokenMetrics = {
      toolCount: tools.length,
      schemaChars,
      estimatedTokens,
      assessedAt: new Date().toISOString(),
    }

    console.log(
      `Token Assessor: ${server.name} - ${tools.length} tools, ~${estimatedTokens} tokens (SDK validated: ${sdkValidation.toolCount} tools)`,
    )
    return { metrics }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const rawError =
      error instanceof Error ? error.stack || error.message : String(error)
    console.log(
      `Token Assessor: Error assessing URL-based ${server.name}: ${errorMessage}`,
    )

    const diagnostics = {
      requestUrl: server.url,
      requestMethod: 'POST',
      requestHeaders: maskSensitiveHeaders(baseHeaders),
      requestBody: initRequestBody,
      rawError,
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('abort')) {
      return {
        error: {
          type: 'timeout',
          message: 'Connection timed out after 10 seconds',
          errorAt: new Date().toISOString(),
          diagnostics,
        },
      }
    }

    return {
      error: {
        type: 'connection_failed',
        message: errorMessage,
        errorAt: new Date().toISOString(),
        diagnostics,
      },
    }
  }
}

/**
 * Assessment result with both metrics and error
 */
export interface AssessmentResult {
  metrics?: MCPTokenMetrics
  error?: MCPAssessmentError
}

/**
 * Assess token usage for a single MCP by spawning it and fetching tools
 * This is a one-time operation - results should be cached
 */
export async function assessMCPTokens(
  server: MCPServerInfo,
): Promise<MCPTokenMetrics | null> {
  const result = await assessMCPTokensWithError(server)
  return result.metrics || null
}

/**
 * Assess token usage with detailed error information
 */
export async function assessMCPTokensWithError(
  server: MCPServerInfo,
): Promise<AssessmentResult> {
  // Handle URL-based MCPs differently
  if (server.url && !server.command) {
    return assessURLBasedMCP(server)
  }

  // For command-based MCPs, use the existing logic
  const metrics = await assessCommandBasedMCP(server)
  if (metrics) {
    return { metrics }
  }
  return {
    error: {
      type: 'unknown',
      message: 'Failed to assess command-based MCP',
      errorAt: new Date().toISOString(),
    },
  }
}

/**
 * Assess command-based MCP
 */
async function assessCommandBasedMCP(
  server: MCPServerInfo,
): Promise<MCPTokenMetrics | null> {
  // Can only assess command-based MCPs
  if (!server.command) {
    console.log(
      `Token Assessor: Skipping ${server.name} - no command or URL specified`,
    )
    return null
  }

  console.log(`Token Assessor: Assessing ${server.name}...`)

  return new Promise((resolve) => {
    let mcpProcess: ChildProcess | null = null
    let resolved = false
    let stdoutBuffer = ''

    const cleanup = () => {
      if (mcpProcess && !mcpProcess.killed) {
        try {
          mcpProcess.kill('SIGTERM')
        } catch {
          // Ignore kill errors
        }
      }
    }

    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        console.log(`Token Assessor: Timeout assessing ${server.name}`)
        cleanup()
        resolve(null)
      }
    }, 15000)

    try {
      // Spawn the MCP process
      // Note: server.command is guaranteed to be defined here due to the check at line 622
      const command =
        process.platform === 'win32' && server.command === 'npx'
          ? 'npx.cmd'
          : server.command!

      mcpProcess = spawn(command, server.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
        shell: process.platform === 'win32',
      })

      // spawn() returns a valid ChildProcess or throws - it never returns null
      // TypeScript needs help here because mcpProcess was initialized as null
      const proc = mcpProcess

      // Send MCP initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'mcpguard-token-assessor',
            version: '1.0.0',
          },
        },
      }

      proc.stdin?.write(JSON.stringify(initRequest) + '\n')

      // Handle stdout - look for responses
      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString()

        // Try to parse complete JSON-RPC messages
        const lines = stdoutBuffer.split('\n')
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim()
          if (!line) continue

          try {
            const response = JSON.parse(line)

            // Handle initialize response
            if (response.id === 1 && response.result) {
              // Send tools/list request
              const toolsRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {},
              }
              mcpProcess?.stdin?.write(JSON.stringify(toolsRequest) + '\n')
            }

            // Handle tools/list response
            if (response.id === 2 && response.result?.tools) {
              const tools = response.result.tools as MCPToolSchema[]

              // Calculate schema size
              const schemaChars = JSON.stringify(tools).length
              const estimatedTokens = estimateTokens(schemaChars)

              const metrics: MCPTokenMetrics = {
                toolCount: tools.length,
                schemaChars,
                estimatedTokens,
                assessedAt: new Date().toISOString(),
              }

              // Capture package name for npx-based MCPs (instant, no performance impact)
              // Actual version detection will happen async on extension load
              if (isNpxCommand(server.command)) {
                const packageName = extractPackageName(server.args)
                if (packageName) {
                  metrics.packageName = packageName
                  console.log(
                    `Token Assessor: ${server.name} - captured package name: ${packageName}`,
                  )
                }
              }

              console.log(
                `Token Assessor: ${server.name} - ${tools.length} tools, ~${estimatedTokens} tokens`,
              )

              if (!resolved) {
                resolved = true
                clearTimeout(timeout)
                cleanup()
                resolve(metrics)
              }
            }
          } catch {
            // Not a complete JSON line yet, continue
          }
        }
        // Keep the last incomplete line in the buffer
        stdoutBuffer = lines[lines.length - 1]
      })

      proc.stderr?.on('data', (data: Buffer) => {
        // Log stderr for debugging but don't fail
        console.log(
          `Token Assessor: ${server.name} stderr: ${data.toString().trim()}`,
        )
      })

      proc.on('error', (error) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          console.log(
            `Token Assessor: Error spawning ${server.name}: ${error.message}`,
          )
          resolve(null)
        }
      })

      proc.on('exit', () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          console.log(
            `Token Assessor: ${server.name} exited before assessment complete`,
          )
          resolve(null)
        }
      })
    } catch (error) {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        console.log(
          `Token Assessor: Exception assessing ${server.name}: ${error}`,
        )
        resolve(null)
      }
    }
  })
}

/**
 * Calculate token savings summary
 */
export function calculateTokenSavings(
  servers: MCPServerInfo[],
  configs: MCPSecurityConfig[],
  tokenCache: TokenMetricsCache,
): TokenSavingsSummary {
  let totalTokensWithoutGuard = 0
  let assessedMCPs = 0
  let guardedMCPs = 0
  let unassessedGuardedMCPs = 0

  console.log(
    `Token Savings: Calculating for ${servers.length} servers, ${configs.length} configs`,
  )
  console.log(
    `Token Savings: Server names: ${servers.map((s) => s.name).join(', ')}`,
  )
  console.log(
    `Token Savings: Config mcpNames: ${configs.map((c) => `${c.mcpName}(guarded:${c.isGuarded})`).join(', ')}`,
  )
  console.log(
    `Token Savings: Token cache keys: ${Object.keys(tokenCache).join(', ')}`,
  )

  for (const server of servers) {
    const metrics = tokenCache[server.name]
    const config = configs.find((c) => c.mcpName === server.name)
    const isGuarded = config?.isGuarded ?? false

    console.log(
      `Token Savings: Server "${server.name}" - config found: ${!!config}, isGuarded: ${isGuarded}, hasMetrics: ${!!metrics}`,
    )

    if (isGuarded) {
      guardedMCPs++
      if (metrics) {
        assessedMCPs++
        totalTokensWithoutGuard += metrics.estimatedTokens
        console.log(
          `Token Savings: Adding ${metrics.estimatedTokens} tokens from assessed "${server.name}"`,
        )
      } else {
        // Use default estimate for unassessed MCPs
        unassessedGuardedMCPs++
        totalTokensWithoutGuard += DEFAULT_UNASSESSED_TOKENS
        console.log(
          `Token Savings: Adding ${DEFAULT_UNASSESSED_TOKENS} estimated tokens for unassessed "${server.name}"`,
        )
      }
    } else if (metrics) {
      // Track assessed but unguarded MCPs too
      assessedMCPs++
    }
  }

  // Token savings = what we'd use without MCPGuard - what MCPGuard itself uses
  const tokensSaved = Math.max(
    0,
    totalTokensWithoutGuard - MCPGUARD_BASELINE_TOKENS,
  )

  return {
    totalTokensWithoutGuard,
    mcpGuardTokens: MCPGUARD_BASELINE_TOKENS,
    tokensSaved,
    assessedMCPs,
    guardedMCPs,
    hasEstimates: unassessedGuardedMCPs > 0,
  }
}

/**
 * Get MCPGuard's baseline token usage
 */
export function getMCPGuardBaselineTokens(): number {
  return MCPGUARD_BASELINE_TOKENS
}

/**
 * Connection test step result
 */
interface TestStep {
  name: string
  success: boolean
  details?: string
  durationMs?: number
  data?: {
    request?: string
    response?: string
  }
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean
  mcpName: string
  steps: TestStep[]
  error?: MCPAssessmentError
  durationMs: number
}

/**
 * Test connection to an MCP with verbose step-by-step logging
 * This is designed for debugging connection issues
 */
export async function testMCPConnection(
  server: MCPServerInfo,
  onProgress?: (step: string) => void,
): Promise<ConnectionTestResult> {
  const startTime = Date.now()
  const steps: TestStep[] = []

  // Step 1: Validate configuration
  const configStepStart = Date.now()
  onProgress?.('Validating configuration...')

  if (!server.url && !server.command) {
    steps.push({
      name: 'Validate Configuration',
      success: false,
      details: 'No URL or command configured for this MCP',
      durationMs: Date.now() - configStepStart,
    })
    return {
      success: false,
      mcpName: server.name,
      steps,
      error: {
        type: 'unknown',
        message: 'No URL or command configured',
        errorAt: new Date().toISOString(),
      },
      durationMs: Date.now() - startTime,
    }
  }

  steps.push({
    name: 'Validate Configuration',
    success: true,
    details: server.url
      ? `URL: ${server.url}\nHeaders: ${server.headers ? Object.keys(server.headers).join(', ') : 'none'}`
      : `Command: ${server.command} ${(server.args || []).join(' ')}`,
    durationMs: Date.now() - configStepStart,
  })

  // Only URL-based MCPs can be tested with verbose connection test for now
  if (!server.url) {
    steps.push({
      name: 'Test Command-based MCP',
      success: false,
      details:
        'Verbose connection testing is currently only supported for URL-based MCPs. Use "Retry" to re-assess this MCP.',
      durationMs: 0,
    })
    return {
      success: false,
      mcpName: server.name,
      steps,
      durationMs: Date.now() - startTime,
    }
  }

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...server.headers,
  }
  const maskedHeaders = maskSensitiveHeaders(baseHeaders)

  // Session ID for Streamable HTTP
  let sessionId: string | null = null

  // Step 2: DNS Resolution (implicit in fetch)
  const dnsStepStart = Date.now()
  onProgress?.('Testing network connectivity...')

  try {
    // Try a simple HEAD request first to test basic connectivity
    const connectController = new AbortController()
    const connectTimeout = setTimeout(() => connectController.abort(), 5000)

    try {
      await fetch(server.url, {
        method: 'HEAD',
        signal: connectController.signal,
      })
      steps.push({
        name: 'Network Connectivity',
        success: true,
        details: `Successfully reached ${new URL(server.url).hostname}`,
        durationMs: Date.now() - dnsStepStart,
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      // HEAD might not be allowed, that's okay
      if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
        steps.push({
          name: 'Network Connectivity',
          success: false,
          details: `Could not reach ${new URL(server.url).hostname} within 5 seconds`,
          durationMs: Date.now() - dnsStepStart,
        })
        return {
          success: false,
          mcpName: server.name,
          steps,
          error: {
            type: 'timeout',
            message: 'Network connectivity test timed out',
            errorAt: new Date().toISOString(),
          },
          durationMs: Date.now() - startTime,
        }
      }
      // 405 Method Not Allowed is fine - server is reachable
      steps.push({
        name: 'Network Connectivity',
        success: true,
        details: `Server at ${new URL(server.url).hostname} is reachable`,
        durationMs: Date.now() - dnsStepStart,
      })
    } finally {
      clearTimeout(connectTimeout)
    }
  } catch (urlError) {
    steps.push({
      name: 'Network Connectivity',
      success: false,
      details: `Invalid URL: ${server.url}`,
      durationMs: Date.now() - dnsStepStart,
    })
    return {
      success: false,
      mcpName: server.name,
      steps,
      error: {
        type: 'unknown',
        message: 'Invalid URL format',
        errorAt: new Date().toISOString(),
      },
      durationMs: Date.now() - startTime,
    }
  }

  // Step 3: MCP Initialize Request
  const initStepStart = Date.now()
  onProgress?.('Sending MCP initialize request...')

  const initRequestBody = JSON.stringify(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'mcpguard-connection-test',
          version: '1.0.0',
        },
      },
    },
    null,
    2,
  )

  try {
    const initResponse = await fetch(server.url, {
      method: 'POST',
      headers: baseHeaders,
      body: initRequestBody,
      signal: AbortSignal.timeout(10000),
    })

    // Capture session ID from response headers
    sessionId =
      initResponse.headers.get('mcp-session-id') ||
      initResponse.headers.get('Mcp-Session-Id')

    // Collect response headers for diagnostics
    const initResponseHeaders: Record<string, string> = {}
    initResponse.headers.forEach((value, key) => {
      initResponseHeaders[key] = value
    })

    let initResponseBody = ''
    try {
      initResponseBody = await initResponse.text()
    } catch {
      initResponseBody = '(could not read response body)'
    }

    if (!initResponse.ok) {
      steps.push({
        name: 'MCP Initialize',
        success: false,
        details: `HTTP ${initResponse.status} ${initResponse.statusText}`,
        durationMs: Date.now() - initStepStart,
        data: {
          request: `POST ${server.url}\nHeaders: ${JSON.stringify(maskedHeaders, null, 2)}\n\n${initRequestBody}`,
          response: `Status: ${initResponse.status} ${initResponse.statusText}\nHeaders: ${JSON.stringify(initResponseHeaders, null, 2)}\n\n${truncateBody(initResponseBody, 1000)}`,
        },
      })

      const diagnostics = {
        requestUrl: server.url,
        requestMethod: 'POST',
        requestHeaders: maskedHeaders,
        requestBody: initRequestBody,
        responseBody: truncateBody(initResponseBody),
        responseHeaders: initResponseHeaders,
      }

      // Check for OAuth if 401/403
      if (initResponse.status === 401 || initResponse.status === 403) {
        // Check for OAuth requirement from WWW-Authenticate header
        const wwwAuth = initResponse.headers.get('www-authenticate') || ''
        const isOAuthBearer = wwwAuth.toLowerCase().includes('bearer')
        
        console.log(`Connection Test: ${server.name} got ${initResponse.status}, checking OAuth...`)
        console.log(`Connection Test: WWW-Authenticate header: "${wwwAuth}"`)
        console.log(`Connection Test: isOAuthBearer: ${isOAuthBearer}`)
        
        // Also check well-known endpoint for OAuth metadata
        const oauthMetadata = await discoverOAuthMetadata(server.url)
        console.log(`Connection Test: OAuth metadata from well-known: ${oauthMetadata ? 'found' : 'not found'}`)
        
        if (oauthMetadata || isOAuthBearer) {
          const detectionMethod = oauthMetadata 
            ? `Authorization servers: ${oauthMetadata.authorization_servers?.join(', ')}`
            : `Detected via WWW-Authenticate: Bearer header`
          
          steps.push({
            name: 'OAuth Discovery',
            success: true,
            details: `Server requires OAuth authentication. ${detectionMethod}`,
            durationMs: Date.now() - initStepStart,
          })
          return {
            success: false,
            mcpName: server.name,
            steps,
            error: {
              type: 'oauth_required',
              message: `This MCP server requires OAuth authentication, which MCPGuard cannot support.`,
              statusCode: initResponse.status,
              statusText: initResponse.statusText,
              errorAt: new Date().toISOString(),
              oauthMetadata: oauthMetadata || {
                discoveredAt: new Date().toISOString(),
                detectedVia: 'www-authenticate',
                wwwAuthenticate: wwwAuth,
              },
              diagnostics,
            },
            durationMs: Date.now() - startTime,
          }
        }
      }

      return {
        success: false,
        mcpName: server.name,
        steps,
        error: {
          type:
            initResponse.status === 401 || initResponse.status === 403
              ? 'auth_failed'
              : 'connection_failed',
          message: `Server returned HTTP ${initResponse.status} ${initResponse.statusText}`,
          statusCode: initResponse.status,
          statusText: initResponse.statusText,
          errorAt: new Date().toISOString(),
          diagnostics,
        },
        durationMs: Date.now() - startTime,
      }
    }

    steps.push({
      name: 'MCP Initialize',
      success: true,
      details: sessionId
        ? `Server accepted initialize request. Session ID: ${sessionId.substring(0, 20)}...`
        : 'Server accepted initialize request (no session ID returned)',
      durationMs: Date.now() - initStepStart,
      data: {
        request: `POST ${server.url}\nHeaders: ${JSON.stringify(maskedHeaders, null, 2)}\n\n${initRequestBody}`,
        response: `Headers: ${JSON.stringify(initResponseHeaders, null, 2)}\n\n${truncateBody(initResponseBody, 1000)}`,
      },
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    steps.push({
      name: 'MCP Initialize',
      success: false,
      details: errorMsg,
      durationMs: Date.now() - initStepStart,
      data: {
        request: `POST ${server.url}\nHeaders: ${JSON.stringify(maskedHeaders, null, 2)}\n\n${initRequestBody}`,
      },
    })
    return {
      success: false,
      mcpName: server.name,
      steps,
      error: {
        type: errorMsg.includes('timeout') ? 'timeout' : 'connection_failed',
        message: errorMsg,
        errorAt: new Date().toISOString(),
        diagnostics: {
          requestUrl: server.url,
          requestMethod: 'POST',
          requestHeaders: maskedHeaders,
          requestBody: initRequestBody,
          rawError: error instanceof Error ? error.stack : errorMsg,
        },
      },
      durationMs: Date.now() - startTime,
    }
  }

  // Step 4: MCP Tools List Request
  const toolsStepStart = Date.now()
  onProgress?.('Fetching tools list...')

  const toolsRequestBody = JSON.stringify(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    null,
    2,
  )

  // Build headers for tools request - include session ID if we got one
  const toolsRequestHeaders: Record<string, string> = { ...baseHeaders }
  if (sessionId) {
    toolsRequestHeaders['mcp-session-id'] = sessionId
  }
  const toolsMaskedHeaders = maskSensitiveHeaders(toolsRequestHeaders)

  try {
    const toolsResponse = await fetch(server.url, {
      method: 'POST',
      headers: toolsRequestHeaders,
      body: toolsRequestBody,
      signal: AbortSignal.timeout(10000),
    })

    // Collect response headers
    const toolsResponseHeaders: Record<string, string> = {}
    toolsResponse.headers.forEach((value, key) => {
      toolsResponseHeaders[key] = value
    })

    let toolsResponseBody = ''
    try {
      toolsResponseBody = await toolsResponse.text()
    } catch {
      toolsResponseBody = '(could not read response body)'
    }

    if (!toolsResponse.ok) {
      // Check if this might be a session error
      const isSessionError =
        toolsResponse.status === 400 &&
        (toolsResponseBody.toLowerCase().includes('session') ||
          toolsResponseBody.toLowerCase().includes('invalid') ||
          !sessionId)

      steps.push({
        name: 'MCP Tools List',
        success: false,
        details: isSessionError
          ? `HTTP ${toolsResponse.status} - Possible session error. Server may require session-based auth.`
          : `HTTP ${toolsResponse.status} ${toolsResponse.statusText}`,
        durationMs: Date.now() - toolsStepStart,
        data: {
          request: `POST ${server.url}\nHeaders: ${JSON.stringify(toolsMaskedHeaders, null, 2)}\n${sessionId ? `(Session ID: ${sessionId.substring(0, 20)}...)` : '(No session ID)'}\n\n${toolsRequestBody}`,
          response: `Status: ${toolsResponse.status} ${toolsResponse.statusText}\nHeaders: ${JSON.stringify(toolsResponseHeaders, null, 2)}\n\n${truncateBody(toolsResponseBody, 1000)}`,
        },
      })
      return {
        success: false,
        mcpName: server.name,
        steps,
        error: {
          type: 'connection_failed',
          message: isSessionError
            ? `Session error (HTTP ${toolsResponse.status}). The server may require session-based authentication that isn't available during assessment.`
            : `Tools list failed: HTTP ${toolsResponse.status}`,
          statusCode: toolsResponse.status,
          statusText: toolsResponse.statusText,
          errorAt: new Date().toISOString(),
          diagnostics: {
            requestUrl: server.url,
            requestMethod: 'POST',
            requestHeaders: toolsMaskedHeaders,
            requestBody: toolsRequestBody,
            responseBody: truncateBody(toolsResponseBody),
            responseHeaders: toolsResponseHeaders,
          },
        },
        durationMs: Date.now() - startTime,
      }
    }

    // Parse and count tools - handle both JSON and SSE formats
    let toolCount = 0
    try {
      const toolsResult = JSON.parse(toolsResponseBody) as {
        result?: { tools?: MCPToolSchema[] }
      }
      toolCount = toolsResult.result?.tools?.length || 0
    } catch {
      // Try SSE format
      const lines = toolsResponseBody.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6))
            if (data.result?.tools) {
              toolCount = data.result.tools.length
              break
            }
          } catch {
            // Continue
          }
        }
      }
    }

    steps.push({
      name: 'MCP Tools List',
      success: true,
      details: `Successfully retrieved ${toolCount} tool${toolCount === 1 ? '' : 's'}${sessionId ? ' (with session)' : ''}`,
      durationMs: Date.now() - toolsStepStart,
      data: {
        request: `POST ${server.url}\nHeaders: ${JSON.stringify(toolsMaskedHeaders, null, 2)}\n${sessionId ? `(Session ID: ${sessionId.substring(0, 20)}...)` : '(No session ID)'}\n\n${toolsRequestBody}`,
        response: `Headers: ${JSON.stringify(toolsResponseHeaders, null, 2)}\n\n${truncateBody(toolsResponseBody, 1000)}`,
      },
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    steps.push({
      name: 'MCP Tools List',
      success: false,
      details: errorMsg,
      durationMs: Date.now() - toolsStepStart,
    })
    return {
      success: false,
      mcpName: server.name,
      steps,
      error: {
        type: errorMsg.includes('timeout') ? 'timeout' : 'connection_failed',
        message: errorMsg,
        errorAt: new Date().toISOString(),
      },
      durationMs: Date.now() - startTime,
    }
  }

  // All steps passed!
  return {
    success: true,
    mcpName: server.name,
    steps,
    durationMs: Date.now() - startTime,
  }
}
