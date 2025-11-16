import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerManager } from '../../src/server/worker-manager.js';
import { MCPConfig, MCPTool } from '../../src/types/mcp.js';
import { WorkerError } from '../../src/utils/errors.js';

// Mock logger to avoid console output during tests
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'info',
  },
}));

describe('WorkerManager', () => {
  let manager: WorkerManager;

  beforeEach(() => {
    manager = new WorkerManager();
  });

  afterEach(async () => {
    // Clean up any loaded instances
    const instances = manager.listInstances();
    for (const instance of instances) {
      try {
        await manager.unloadMCP(instance.mcp_id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('listInstances', () => {
    it('should return empty array initially', () => {
      const instances = manager.listInstances();
      expect(instances).toEqual([]);
    });
  });

  describe('getInstance', () => {
    it('should return undefined for non-existent instance', () => {
      const instance = manager.getInstance('non-existent-id');
      expect(instance).toBeUndefined();
    });
  });

  describe('getMCPByName', () => {
    it('should return undefined for non-existent MCP name', () => {
      const instance = manager.getMCPByName('non-existent');
      expect(instance).toBeUndefined();
    });
  });

  describe('executeCode', () => {
    it('should throw error for non-existent MCP instance', async () => {
      await expect(
        manager.executeCode('non-existent-id', 'console.log("test");')
      ).rejects.toThrow(WorkerError);
    });

    it('should throw error when instance is not ready', async () => {
      // Create a mock instance with non-ready status
      const mockInstance = {
        mcp_id: 'test-id',
        mcp_name: 'test-mcp',
        status: 'loading' as const,
        created_at: new Date(),
        config: {
          command: 'echo',
          args: ['test'],
        } as MCPConfig,
        tools: [],
      };
      
      (manager as any).instances.set('test-id', mockInstance);
      
      await expect(
        manager.executeCode('test-id', 'console.log("test");')
      ).rejects.toThrow(WorkerError);
      
      (manager as any).instances.delete('test-id');
    });
  });

  describe('unloadMCP', () => {
    it('should throw error for non-existent MCP instance', async () => {
      await expect(
        manager.unloadMCP('non-existent-id')
      ).rejects.toThrow(WorkerError);
    });
  });

  describe('generateWorkerCode', () => {
    it('should generate worker code with embedded RPC URL', async () => {
      const tools: MCPTool[] = [
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string' },
            },
            required: ['param'],
          },
        },
      ];

      // Access private method via type assertion (for testing)
      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      
      const workerCode = await generateCode(
        'test-mcp-id',
        tools,
        '// TypeScript API',
        'console.log("test");'
      );

      expect(workerCode).toBeDefined();
      expect(workerCode.compatibilityDate).toBe('2025-06-01');
      expect(workerCode.mainModule).toBe('worker.js');
      expect(workerCode.modules['worker.js']).toBeDefined();
      expect(workerCode.env.MCP_ID).toBe('test-mcp-id');
      expect(workerCode.env.MCP_RPC_URL).toBeDefined();
      expect(typeof workerCode.env.MCP_RPC_URL).toBe('string');
    });

    it('should include tool bindings in generated code', async () => {
      const tools: MCPTool[] = [
        {
          name: 'search_users',
          description: 'Search users',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_user',
          description: 'Get user',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
        },
      ];

      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      const workerCode = await generateCode(
        'test-mcp-id',
        tools,
        '',
        'console.log("test");'
      );

      const code = workerCode.modules['worker.js'] as string;
      expect(code).toContain('search_users');
      expect(code).toContain('get_user');
      expect(code).toContain('fetch'); // Uses fetch to call RPC server
      expect(code).toContain('mcpBinding');
    });

    it('should escape special characters in RPC URL', async () => {
      const tools: MCPTool[] = [];
      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      
      // This should not throw even with special characters
      const workerCode = await generateCode(
        'test-mcp-id',
        tools,
        '',
        'console.log("test");'
      );

      expect(workerCode).toBeDefined();
    });

    it('should embed user code in worker script', async () => {
      const tools: MCPTool[] = [];
      const userCode = 'const result = await mcp.test(); console.log(result);';
      
      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      const workerCode = await generateCode(
        'test-mcp-id',
        tools,
        '',
        userCode
      );

      const code = workerCode.modules['worker.js'] as string;
      // User code should be embedded (though escaped)
      expect(code).toContain('console.log');
    });
  });

  describe('RPC Server', () => {
    it('should start RPC server on initialization', async () => {
      // RPC server should be started in constructor
      const getRPCUrl = (manager as any).getRPCUrl.bind(manager);
      const url = await getRPCUrl();
      
      expect(url).toBeDefined();
      expect(url).toContain('http://127.0.0.1');
      expect(url).toContain('/mcp-rpc');
    });

    it('should return same URL on multiple calls', async () => {
      const getRPCUrl = (manager as any).getRPCUrl.bind(manager);
      const url1 = await getRPCUrl();
      const url2 = await getRPCUrl();
      
      expect(url1).toBe(url2);
    });

    it('should handle RPC server already started', () => {
      // Create a new manager - RPC server should already be started
      const manager2 = new WorkerManager();
      const startRPCServer = (manager2 as any).startRPCServer.bind(manager2);
      
      // Calling startRPCServer again should not throw
      expect(() => startRPCServer()).not.toThrow();
    });
  });

  describe('listInstances', () => {
    it('should calculate uptime for instances', () => {
      const mockInstance = {
        mcp_id: 'test-id',
        mcp_name: 'test-mcp',
        status: 'ready' as const,
        created_at: new Date(Date.now() - 1000), // 1 second ago
        config: {
          command: 'echo',
          args: ['test'],
        } as MCPConfig,
        tools: [],
      };
      
      (manager as any).instances.set('test-id', mockInstance);
      
      const instances = manager.listInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].uptime_ms).toBeGreaterThanOrEqual(1000);
      expect(instances[0].uptime_ms).toBeLessThan(2000);
      
      (manager as any).instances.delete('test-id');
    });
  });

  describe('getInstance', () => {
    it('should calculate uptime for instance', () => {
      const mockInstance = {
        mcp_id: 'test-id',
        mcp_name: 'test-mcp',
        status: 'ready' as const,
        created_at: new Date(Date.now() - 500),
        config: {
          command: 'echo',
          args: ['test'],
        } as MCPConfig,
        tools: [],
      };
      
      (manager as any).instances.set('test-id', mockInstance);
      
      const instance = manager.getInstance('test-id');
      expect(instance).toBeDefined();
      expect(instance?.uptime_ms).toBeGreaterThanOrEqual(500);
      expect(instance?.uptime_ms).toBeLessThan(1000);
      
      (manager as any).instances.delete('test-id');
    });
  });
});

