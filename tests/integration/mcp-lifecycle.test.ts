import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from '../../src/server/worker-manager.js';
import { MCPConfig } from '../../src/types/mcp.js';

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

describe('MCP Lifecycle Integration', () => {
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

  describe('RPC Server', () => {
    it('should start RPC server on initialization', async () => {
      const getRPCUrl = (manager as any).getRPCUrl.bind(manager);
      const url = await getRPCUrl();
      
      expect(url).toBeDefined();
      expect(url).toContain('http://127.0.0.1');
      expect(url).toContain('/mcp-rpc');
      expect(url).toMatch(/http:\/\/127\.0\.0\.1:\d+\/mcp-rpc/);
    });

    it('should return consistent RPC URL', async () => {
      const getRPCUrl = (manager as any).getRPCUrl.bind(manager);
      const url1 = await getRPCUrl();
      const url2 = await getRPCUrl();
      
      expect(url1).toBe(url2);
    });
  });

  describe('Worker Code Generation', () => {
    it('should generate valid worker code structure', async () => {
      const tools = [
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            type: 'object' as const,
            properties: {
              param: { type: 'string' },
            },
            required: ['param'],
          },
        },
      ];

      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");'
      );

      expect(workerCode).toBeDefined();
      expect(workerCode.compatibilityDate).toBe('2025-06-01');
      expect(workerCode.mainModule).toBe('worker.js');
      expect(workerCode.modules['worker.js']).toBeDefined();
      expect(typeof workerCode.modules['worker.js']).toBe('string');
      expect(workerCode.env).toBeDefined();
      expect(workerCode.env.MCP_ID).toBe('test-id');
      expect(workerCode.env.MCP_RPC_URL).toBeDefined();
    });

    it('should embed RPC URL in generated code when tools exist', async () => {
      const tools = [
        {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      ];
      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");'
      );

      const code = workerCode.modules['worker.js'] as string;
      const rpcUrl = workerCode.env.MCP_RPC_URL as string;
      
      // RPC URL should be embedded in the code when tools are present
      expect(code).toContain(rpcUrl);
      expect(code).toContain('fetch');
    });

    it('should generate code with multiple tools', async () => {
      const tools = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      ];

      const generateCode = (manager as any).generateWorkerCode.bind(manager);
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");'
      );

      const code = workerCode.modules['worker.js'] as string;
      expect(code).toContain('tool1');
      expect(code).toContain('tool2');
    });
  });

  describe('Instance Management', () => {
    it('should list instances correctly', () => {
      const instances = manager.listInstances();
      expect(Array.isArray(instances)).toBe(true);
    });

    it('should return undefined for non-existent instance', () => {
      const instance = manager.getInstance('non-existent');
      expect(instance).toBeUndefined();
    });

    it('should return undefined for non-existent MCP name', () => {
      const instance = manager.getMCPByName('non-existent');
      expect(instance).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw WorkerError for non-existent MCP in executeCode', async () => {
      await expect(
        manager.executeCode('non-existent-id', 'console.log("test");')
      ).rejects.toThrow();
    });

    it('should throw WorkerError for non-existent MCP in unloadMCP', async () => {
      await expect(
        manager.unloadMCP('non-existent-id')
      ).rejects.toThrow();
    });
  });
});

