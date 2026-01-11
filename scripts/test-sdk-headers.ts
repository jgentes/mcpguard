/**
 * Test script to verify MCP SDK StreamableHTTPClientTransport header handling
 * This tests the same code path as MCPGuard server to diagnose header issues
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function testSDKWithHeaders() {
  // Test config - same as user's GitHub Copilot MCP config
  const testUrl = 'https://api.githubcopilot.com/mcp/'
  const testHeaders = {
    Authorization: 'Bearer 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',
  }

  console.log('=== MCP SDK Header Test ===')
  console.log(`URL: ${testUrl}`)
  console.log(`Headers: ${JSON.stringify({ Authorization: testHeaders.Authorization.substring(0, 20) + '...' })}`)
  console.log('')

  try {
    // Create transport with headers - same as MCPGuard server does
    const url = new URL(testUrl)
    const transportOptions: { requestInit?: RequestInit } = {}
    
    transportOptions.requestInit = {
      headers: testHeaders,
    }
    
    console.log('Creating StreamableHTTPClientTransport...')
    const transport = new StreamableHTTPClientTransport(url, transportOptions)

    console.log('Creating MCP Client...')
    const client = new Client(
      { name: 'mcpguard-test', version: '0.1.0' },
      { capabilities: {} }
    )

    console.log('Connecting to MCP server (10s timeout)...')
    await client.connect(transport, { timeout: 10000 })
    console.log('✓ Connected successfully!')

    console.log('Calling listTools()...')
    const toolsResponse = await client.listTools()
    console.log(`✓ Received ${toolsResponse.tools.length} tools`)
    
    if (toolsResponse.tools.length > 0) {
      console.log('First 5 tools:')
      toolsResponse.tools.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.name}`)
      })
    } else {
      console.log('⚠ WARNING: Server returned 0 tools - this indicates auth may have failed silently')
    }

    // Clean up
    console.log('Closing connection...')
    await client.close()
    console.log('✓ Test complete')
    
    return toolsResponse.tools.length
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    
    console.error('✗ Test failed:')
    console.error(`  Error: ${errorMessage}`)
    if (errorStack) {
      console.error(`  Stack: ${errorStack.split('\n').slice(0, 3).join('\n')}`)
    }
    
    // Check for common error types
    if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('Unauthorized')) {
      console.error('\n⚠ This appears to be an authentication error.')
      console.error('  The GitHub Copilot MCP requires OAuth authentication, not a PAT.')
    }
    
    return -1
  }
}

// Also test with direct fetch to compare
async function testDirectFetch() {
  const testUrl = 'https://api.githubcopilot.com/mcp/'
  const testHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    Authorization: 'Bearer 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',
  }

  console.log('\n=== Direct Fetch Test (same as VS Code extension) ===')
  
  try {
    // Initialize request
    const initBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcpguard-test', version: '1.0.0' },
      },
    })

    console.log('Sending initialize request...')
    const initResponse = await fetch(testUrl, {
      method: 'POST',
      headers: testHeaders,
      body: initBody,
      signal: AbortSignal.timeout(10000),
    })

    console.log(`Initialize response: ${initResponse.status} ${initResponse.statusText}`)
    
    // Capture session ID
    const sessionId = initResponse.headers.get('mcp-session-id')
    if (sessionId) {
      console.log(`Session ID: ${sessionId.substring(0, 20)}...`)
    }

    if (!initResponse.ok) {
      const body = await initResponse.text()
      console.error(`Init failed: ${body.substring(0, 200)}`)
      return -1
    }

    // Tools request
    const toolsHeaders = { ...testHeaders }
    if (sessionId) {
      (toolsHeaders as Record<string, string>)['mcp-session-id'] = sessionId
    }

    const toolsBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })

    console.log('Sending tools/list request...')
    const toolsResponse = await fetch(testUrl, {
      method: 'POST',
      headers: toolsHeaders,
      body: toolsBody,
      signal: AbortSignal.timeout(10000),
    })

    console.log(`Tools response: ${toolsResponse.status} ${toolsResponse.statusText}`)
    
    if (!toolsResponse.ok) {
      const body = await toolsResponse.text()
      console.error(`Tools failed: ${body.substring(0, 200)}`)
      return -1
    }

    const responseText = await toolsResponse.text()
    
    // Parse response
    let tools: Array<{ name: string }> = []
    try {
      const parsed = JSON.parse(responseText)
      tools = parsed.result?.tools || []
    } catch {
      // Try SSE format
      const lines = responseText.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.substring(6))
          if (data.result?.tools) {
            tools = data.result.tools
            break
          }
        }
      }
    }

    console.log(`✓ Received ${tools.length} tools via direct fetch`)
    if (tools.length > 0) {
      console.log('First 5 tools:')
      tools.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.name}`)
      })
    }

    return tools.length
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`✗ Direct fetch failed: ${errorMessage}`)
    return -1
  }
}

// Run tests
async function main() {
  console.log('Testing MCP SDK version:', await import('@modelcontextprotocol/sdk/package.json', { assert: { type: 'json' } }).then(m => m.default.version).catch(() => 'unknown'))
  console.log('')
  
  const sdkTools = await testSDKWithHeaders()
  const fetchTools = await testDirectFetch()
  
  console.log('\n=== Summary ===')
  console.log(`SDK Transport: ${sdkTools >= 0 ? `${sdkTools} tools` : 'FAILED'}`)
  console.log(`Direct Fetch:  ${fetchTools >= 0 ? `${fetchTools} tools` : 'FAILED'}`)
  
  if (sdkTools === 0 && fetchTools > 0) {
    console.log('\n⚠ ISSUE DETECTED: Direct fetch works but SDK returns 0 tools.')
    console.log('  This suggests the SDK is not passing headers correctly.')
  } else if (sdkTools > 0 && fetchTools > 0) {
    console.log('\n✓ Both methods work - SDK header fix is working!')
  } else if (sdkTools === 0 && fetchTools === 0) {
    console.log('\n⚠ Both methods returned 0 tools - PAT may not work for this endpoint.')
  }
}

main().catch(console.error)
