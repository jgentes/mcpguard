import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { MCPHandler } from '../../src/server/mcp-handler.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { testConfigCleanup } from '../helpers/config-cleanup.js'

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'info',
  },
}))

describe('Eval: GitHub MCP Isolation via MCPGuard', () => {
  let handler: MCPHandler
  let configManager: ConfigManager
  const testMCPName = 'github-eval-test'

  beforeEach(() => {
    handler = new MCPHandler()
    configManager = new ConfigManager()

    // Track config for cleanup
    testConfigCleanup.trackConfig(testMCPName)
  })

  afterEach(async () => {
    // Give processes time to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterAll(() => {
    // Clean up any MCP configs that were saved during tests
    testConfigCleanup.cleanup()
  })

  /**
   * Eval test to verify Wrangler isolation is working correctly with GitHub MCP via MCPGuard.
   *
   * This test uses MCPGuard's interface (not directly loading the MCP) to:
   * 1. Use MCPGuard's call_mcp tool with mcp_name to auto-connect GitHub MCP from config
   * 2. Execute code that uses the GitHub MCP tool to retrieve repository information
   * 3. Verifies that MCP tools work correctly through MCPGuard's isolation layer
   * 4. Verifies that direct fetch() calls are blocked (isolation working)
   *
   * This ensures that:
   * - MCPGuard can properly discover and load MCPs from config
   * - MCP tools can make network requests through the MCP server (allowed)
   * - Direct network access from the Worker isolate is blocked (security)
   * - The isolation layer properly routes MCP tool calls while preventing direct access
   */
  it('should successfully retrieve repository information via GitHub MCP through MCPGuard while maintaining isolation', async () => {
    // Skip test if wrangler is not available
    const { execSync } = await import('node:child_process')
    try {
      execSync('npx wrangler --version', { stdio: 'ignore' })
    } catch {
      console.warn('Skipping test: Wrangler not available')
      return
    }

    // First, save the GitHub MCP config so MCPGuard can discover it
    // This simulates having the MCP configured in the IDE config
    const githubConfig = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    }

    configManager.saveConfig(testMCPName, githubConfig)
    
    // Disable the MCP to guard it (move it to _mcpguard_disabled)
    // This ensures it can only be accessed through MCPGuard
    const disabled = configManager.disableMCP(testMCPName)
    if (!disabled) {
      throw new Error(`Failed to disable MCP ${testMCPName}`)
    }

    // Use MCPGuard's call_mcp tool with mcp_name to auto-connect the GitHub MCP
    // This tests MCPGuard's transparent proxy and auto-connection functionality
    const code = `
      // Use GitHub MCP to search for the modelcontextprotocol repository
      // This code runs in an isolated Worker, and MCP tool calls go through MCPGuard
      try {
        // Try to use the GitHub MCP to search for repositories
        let repoInfo;
        let repoData;
        
        // Try search_repositories first (most common GitHub MCP tool)
        try {
          repoInfo = await mcp.search_repositories({ 
            query: 'modelcontextprotocol/modelcontextprotocol',
            per_page: 1 
          });
          console.log('Repository search result:', JSON.stringify(repoInfo).substring(0, 300));
          
          // Extract repository data from search result
          if (repoInfo && repoInfo.items && repoInfo.items.length > 0) {
            repoData = repoInfo.items[0];
          } else if (repoInfo && repoInfo.repositories && repoInfo.repositories.length > 0) {
            repoData = repoInfo.repositories[0];
          } else {
            repoData = repoInfo;
          }
        } catch (searchError) {
          // If search_repositories doesn't exist, try get_repository
          try {
            repoInfo = await mcp.get_repository({ 
              owner: 'modelcontextprotocol',
              repo: 'modelcontextprotocol'
            });
            console.log('Repository info:', JSON.stringify(repoInfo).substring(0, 300));
            repoData = repoInfo;
          } catch (getError) {
            // List available tools for debugging
            console.log('Available tools:', Object.keys(mcp).join(', '));
            throw new Error('Neither search_repositories nor get_repository found. Error: ' + getError.message);
          }
        }
        
        // Verify we got some repository information
        if (!repoInfo) {
          throw new Error('No repository information returned');
        }
        
        // Verify the repository data contains expected fields
        const repoStr = JSON.stringify(repoData || repoInfo);
        const hasExpectedFields = 
          repoStr.includes('modelcontextprotocol') || 
          repoStr.includes('Model Context Protocol') ||
          repoStr.includes('modelcontextprotocol.io');
        
        if (!hasExpectedFields) {
          console.log('Warning: Repository data may not contain expected fields');
          console.log('Full data:', repoStr.substring(0, 500));
        }
        
        // Verify isolation: direct fetch() should be blocked
        // This is the key security test - even though MCP tools work, direct network access is blocked
        let directFetchBlocked = false;
        try {
          const response = await fetch('https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol');
          const data = await response.json();
          console.log('Direct fetch() succeeded - SECURITY BREACH!');
          console.log('Data:', JSON.stringify(data).substring(0, 100));
        } catch (fetchError) {
          directFetchBlocked = true;
          console.log('Direct fetch() correctly blocked:', fetchError.message);
        }
        
        if (!directFetchBlocked) {
          throw new Error('SECURITY BREACH: Direct fetch() should be blocked but was not');
        }
        
        console.log('SUCCESS: MCP tool worked through MCPGuard and direct fetch was blocked');
        console.log(JSON.stringify({ 
          success: true, 
          mcpToolWorked: true, 
          directFetchBlocked: true,
          hasRepositoryData: !!repoData
        }));
      } catch (error) {
        console.log('ERROR:', error.message);
        console.log('Stack:', error.stack);
        throw error;
      }
    `

    // Call MCPGuard's call_mcp tool with mcp_name to auto-connect the GitHub MCP
    // We access the private method for testing purposes
    const handlerAny = handler as any
    const result = await handlerAny.handleExecuteCode({
      mcp_name: testMCPName, // This triggers auto-loading from saved config
      code,
      timeout_ms: 60000,
    })

    // Parse the result
    const resultContent = result.content?.[0]
    if (!resultContent || resultContent.type !== 'text') {
      throw new Error('Unexpected result format')
    }

    const parsedResult = JSON.parse(resultContent.text)

    // Verify execution succeeded
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.output).toBeDefined()

    // Verify that MCP tool was used successfully through MCPGuard
    expect(parsedResult.output).toContain('SUCCESS')
    expect(parsedResult.output).toContain('MCP tool worked through MCPGuard')
    expect(parsedResult.output).toContain('direct fetch was blocked')

    // Verify that direct fetch() was blocked (isolation working)
    expect(parsedResult.output).toContain('Direct fetch() correctly blocked')
    expect(parsedResult.output).not.toContain('SECURITY BREACH')

    // Verify repository data was retrieved (indicates MCP tool worked through MCPGuard)
    expect(parsedResult.output).toMatch(/Repository (search result|info):/)

    // Verify no errors occurred
    expect(parsedResult.output).not.toContain('ERROR:')
  }, 120000) // Longer timeout for MCP loading and network requests
})
