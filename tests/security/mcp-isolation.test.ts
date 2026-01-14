import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { WorkerManager } from '../../src/server/worker-manager.js';
import { MCPConfig, MCPTool } from '../../src/types/mcp.js';
import { testConfigCleanup, trackWorkerManager } from '../helpers/config-cleanup.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'info',
  },
}));

describe('Security: MCP Isolation', () => {
  let manager: WorkerManager;

  /**
   * Pre-cache filesystem MCP schema to work around SDK validation issues
   * The filesystem MCP returns tools without inputSchema.type, which causes SDK validation to fail
   * We normalize and cache the schema manually for tests
   */
  async function cacheFilesystemMCPSchema(
    manager: WorkerManager,
    mcpName: string,
    config: MCPConfig,
  ): Promise<void> {
    // Use the same cache key generation logic as WorkerManager
    const { createHash } = await import('node:crypto');
    const hashConfig = (name: string, cfg: MCPConfig): string => {
      const configString = JSON.stringify({ mcpName: name, config: cfg });
      return createHash('sha256')
        .update(configString)
        .digest('hex')
        .substring(0, 16);
    };
    const cacheKey = `${mcpName}:${hashConfig(mcpName, config)}`;
    const configHash = hashConfig(mcpName, config);
    
    // Known filesystem MCP tools (normalized with type: 'object')
    const filesystemTools: MCPTool[] = [
      {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List files in a directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the directory' },
          },
          required: ['path'],
        },
      },
      {
        name: 'get_file_info',
        description: 'Get information about a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'create_directory',
        description: 'Create a directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the directory' },
          },
          required: ['path'],
        },
      },
      {
        name: 'move_file',
        description: 'Move or rename a file',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source path' },
            destination: { type: 'string', description: 'Destination path' },
          },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
      },
    ];

    // Generate TypeScript API
    const { SchemaConverter } = await import('../../src/server/schema-converter.js');
    const converter = new SchemaConverter();
    const typescriptApi = converter.convertToTypeScript(filesystemTools);

    // Cache the schema using the manager's private cache
    // We need to access the private schemaCache, so we'll use a workaround
    const managerAny = manager as any;
    if (!managerAny.schemaCache) {
      managerAny.schemaCache = new Map();
    }
    
    managerAny.schemaCache.set(cacheKey, {
      tools: filesystemTools,
      typescriptApi,
      configHash,
      cachedAt: new Date(),
    });
  }

  beforeEach(() => {
    manager = new WorkerManager();
    // Track manager for global cleanup
    trackWorkerManager(manager);
  });

  afterEach(async () => {
    // Clean up any loaded instances and wait for processes to terminate
    const instances = manager.listInstances();
    for (const instance of instances) {
      try {
        // Track config names for cleanup
        testConfigCleanup.trackConfig(instance.mcp_name);
        await manager.unloadMCP(instance.mcp_id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Shutdown the manager to kill all processes (Wrangler, workerd, MCP processes)
    try {
      await manager.shutdown();
    } catch {
      // Ignore shutdown errors
    }
    
    // Give processes time to fully terminate
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(() => {
    // Clean up any MCP configs that were saved during tests
    testConfigCleanup.cleanup();
  });

  describe('Filesystem MCP Isolation', () => {
    it('should prevent direct filesystem access even when filesystem MCP is loaded', async () => {
      // Skip test if wrangler is not available
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch {
        console.warn('Skipping test: Wrangler not available');
        return;
      }

      // Load server-filesystem MCP - this test specifically requires it
      const config: MCPConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
      };

      // Pre-cache the filesystem MCP schema to work around SDK validation issues
      // The filesystem MCP returns tools without inputSchema.type, causing SDK validation to fail
      // We normalize and cache the schema manually so the test can use the real filesystem MCP
      await cacheFilesystemMCPSchema(manager, 'filesystem-test', config);

      const instance = await manager.loadMCP('filesystem-test', config);
      expect(instance).toBeDefined();
      expect(instance.status).toBe('ready');
      expect(instance.mcp_name).toBe('filesystem-test');

      // Try direct filesystem access (this should fail at runtime)
      // Note: WorkerManager.executeCode doesn't validate (validation happens in MCP handler)
      // This test verifies runtime isolation - even if validation is bypassed, runtime blocks it
      const code = `
        // Try direct filesystem access (this should fail at runtime)
        try {
          const fs = require('fs');
          const content = fs.readFileSync('package.json', 'utf8');
          console.log('Direct filesystem access succeeded - SECURITY BREACH!');
        } catch (error) {
          console.log('Direct filesystem access blocked at runtime:', error.message);
        }
      `;

      const result = await manager.executeCode(instance.mcp_id, code, 30000);
      
      // Verify that filesystem access was blocked at runtime
      // Worker isolates don't have Node.js require() or fs module
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Direct filesystem access blocked at runtime');
      expect(result.output).not.toContain('SECURITY BREACH');
      
      // Note: In production, code validation (in MCP handler) would block require() first
      // This test verifies defense-in-depth: runtime isolation as a second layer
    }, 60000); // Longer timeout for MCP loading

    it('should prevent filesystem access at runtime in Worker isolate', async () => {
      // Skip test if wrangler is not available
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch {
        console.warn('Skipping test: Wrangler not available');
        return;
      }

      // Load any MCP (we just need an instance)
      const config: MCPConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      };

      const instance = await manager.loadMCP('memory-test', config);
      expect(instance).toBeDefined();

      // Note: This test bypasses code validation (which normally blocks require())
      // to test runtime isolation. In production, validation would block this first.
      // We're testing defense-in-depth: even if validation is bypassed, runtime isolation blocks it.
      const code = `
        try {
          // This should fail at runtime - Worker isolates don't have Node.js modules
          // Note: In production, code validation would block require() before execution
          const fs = require('fs');
          const content = fs.readFileSync('package.json', 'utf8');
          console.log('Filesystem access succeeded - SECURITY BREACH!');
        } catch (error) {
          console.log('Filesystem access correctly blocked at runtime:', error.message);
        }
      `;

      const result = await manager.executeCode(instance.mcp_id, code, 30000);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Filesystem access correctly blocked at runtime');
      expect(result.output).not.toContain('SECURITY BREACH');
    }, 60000);
  });

  describe('Network MCP Isolation', () => {
    it('should prevent direct network access even when fetch MCP would be loaded', async () => {
      // Skip test if wrangler is not available
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch {
        console.warn('Skipping test: Wrangler not available');
        return;
      }

      // Use memory MCP (we're testing isolation, not the fetch MCP itself)
      // The important test is that direct fetch() is blocked
      const config: MCPConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      };

      const instance = await manager.loadMCP('memory-test', config);
      expect(instance).toBeDefined();
      expect(instance.status).toBe('ready');

      // Try to fetch Wikipedia using direct fetch() (should fail)
      const code = `
        // Try direct fetch() call (should fail due to globalOutbound: null)
        try {
          const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/TypeScript');
          const data = await response.json();
          console.log('Direct fetch() succeeded - SECURITY BREACH!');
          console.log('Data:', JSON.stringify(data).substring(0, 100));
        } catch (error) {
          console.log('Direct fetch() correctly blocked:', error.message);
        }
      `;

      const result = await manager.executeCode(instance.mcp_id, code, 30000);

      // The execution should succeed (code runs), but direct fetch() should fail
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      
      // Verify that direct fetch() was blocked
      // Worker isolates with globalOutbound: null cannot make network requests
      expect(result.output).toContain('Direct fetch() correctly blocked');
      expect(result.output).not.toContain('SECURITY BREACH');
    }, 60000);

    it('should prevent network access via fetch() in Worker isolate', async () => {
      // Skip test if wrangler is not available
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch {
        console.warn('Skipping test: Wrangler not available');
        return;
      }

      // Load any MCP (we just need an instance)
      const config: MCPConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      };

      const instance = await manager.loadMCP('memory-test', config);
      expect(instance).toBeDefined();

      // Try to make network request directly (should fail)
      const code = `
        try {
          // This should fail - Worker isolates have globalOutbound: null
          const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/TypeScript');
          const data = await response.json();
          console.log('Network access succeeded - SECURITY BREACH!');
          console.log('Title:', data.title);
        } catch (error) {
          console.log('Network access correctly blocked:', error.message);
        }
      `;

      const result = await manager.executeCode(instance.mcp_id, code, 30000);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Network access correctly blocked');
      expect(result.output).not.toContain('SECURITY BREACH');
    }, 60000);

    it('should prevent SSRF attacks via fetch()', async () => {
      // Skip test if wrangler is not available
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch {
        console.warn('Skipping test: Wrangler not available');
        return;
      }

      // Load any MCP
      const config: MCPConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      };

      const instance = await manager.loadMCP('memory-test', config);
      expect(instance).toBeDefined();

      // Try SSRF attack vectors (should all fail)
      const code = `
        const attackTargets = [
          'http://169.254.169.254/latest/meta-data/', // AWS metadata
          'http://localhost:6379', // Redis
          'http://127.0.0.1:5432', // PostgreSQL
          'http://192.168.1.1/admin', // Internal network
        ];
        
        let blockedCount = 0;
        for (const target of attackTargets) {
          try {
            await fetch(target);
            console.log('SSRF attack succeeded for', target, '- SECURITY BREACH!');
          } catch (error) {
            blockedCount++;
            console.log('SSRF attack blocked for', target);
          }
        }
        console.log('Total attacks blocked:', blockedCount, 'out of', attackTargets.length);
      `;

      const result = await manager.executeCode(instance.mcp_id, code, 30000);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Total attacks blocked: 4 out of 4');
      expect(result.output).not.toContain('SECURITY BREACH');
    }, 60000);
  });
});

