import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { WorkerManager } from '../../src/server/worker-manager.js'
import {
  testConfigCleanup,
  trackWorkerManager,
} from '../helpers/config-cleanup.js'

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

describe('MCP Lifecycle Integration', () => {
  let manager: WorkerManager

  beforeEach(() => {
    manager = new WorkerManager()
    // Track manager for global cleanup
    trackWorkerManager(manager)
  })

  afterEach(async () => {
    // Clean up any loaded instances and wait for processes to terminate
    const instances = manager.listInstances()
    for (const instance of instances) {
      try {
        // Only track test configs (those with TEST_MCP_PREFIX) for cleanup
        // Real MCPs loaded during tests should not be deleted
        if (instance.mcp_name.startsWith('__TEST__')) {
          testConfigCleanup.trackConfig(instance.mcp_name)
        }
        await manager.unloadMCP(instance.mcp_id)
      } catch {
        // Ignore cleanup errors
      }
    }

    // Shutdown the manager to kill all processes (Wrangler, workerd, MCP processes)
    try {
      await manager.shutdown()
    } catch {
      // Ignore shutdown errors
    }

    // Give processes time to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Clean up test configs after each test
    testConfigCleanup.cleanup()
  })

  afterAll(() => {
    // Clean up any MCP configs that were saved during tests
    testConfigCleanup.cleanup()
  })

  describe('RPC Server', () => {
    it('should start RPC server on initialization', async () => {
      // Access private method for testing
      const getRPCUrl = (
        manager as unknown as { getRPCUrl: () => Promise<string> }
      ).getRPCUrl.bind(manager)
      const url = await getRPCUrl()

      expect(url).toBeDefined()
      expect(url).toContain('http://127.0.0.1')
      expect(url).toContain('/mcp-rpc')
      expect(url).toMatch(/http:\/\/127\.0\.0\.1:\d+\/mcp-rpc/)
    })

    it('should return consistent RPC URL', async () => {
      // Access private method for testing
      const getRPCUrl = (
        manager as unknown as { getRPCUrl: () => Promise<string> }
      ).getRPCUrl.bind(manager)
      const url1 = await getRPCUrl()
      const url2 = await getRPCUrl()

      expect(url1).toBe(url2)
    })
  })

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
      ]

      // Access private method for testing
      const generateCode = (
        manager as unknown as {
          generateWorkerCode: (
            id: string,
            tools: unknown[],
            typescriptApi: string,
            userCode: string,
          ) => Promise<unknown>
        }
      ).generateWorkerCode.bind(manager)
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");',
      )

      expect(workerCode).toBeDefined()
      expect(workerCode.compatibilityDate).toBe('2025-06-01')
      expect(workerCode.mainModule).toBe('worker.js')
      expect(workerCode.modules['worker.js']).toBeDefined()
      expect(typeof workerCode.modules['worker.js']).toBe('string')
      expect(workerCode.env).toBeDefined()
      expect(workerCode.env.MCP_ID).toBe('test-id')
      expect(workerCode.env.MCP_RPC_URL).toBeDefined() // Used by parent Worker to create Service Binding
      expect(workerCode.globalOutbound).toBeNull() // True isolation enabled
    })

    it('should use Service Binding in generated code when tools exist', async () => {
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
      ]
      // Access private method for testing
      const generateCode = (
        manager as unknown as {
          generateWorkerCode: (
            id: string,
            tools: unknown[],
            typescriptApi: string,
            userCode: string,
          ) => Promise<unknown>
        }
      ).generateWorkerCode.bind(manager)
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");',
      )

      const code = workerCode.modules['worker.js'] as string

      // Code should use Service Binding (env.MCP.callTool) instead of fetch()
      expect(code).toContain('env.MCP.callTool')
      // Check that there are no fetch() calls for MCP tools (excluding the Worker export function)
      expect(code).not.toMatch(/await\s+fetch\(|fetch\(['"`]/) // No actual fetch() calls for HTTP requests
      expect(workerCode.globalOutbound).toBeNull() // True isolation enabled
    })

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
      ]

      // Access private method for testing
      const generateCode = (
        manager as unknown as {
          generateWorkerCode: (
            id: string,
            tools: unknown[],
            typescriptApi: string,
            userCode: string,
          ) => Promise<unknown>
        }
      ).generateWorkerCode.bind(manager)
      const workerCode = await generateCode(
        'test-id',
        tools,
        '',
        'console.log("test");',
      )

      const code = workerCode.modules['worker.js'] as string
      expect(code).toContain('tool1')
      expect(code).toContain('tool2')
    })
  })

  describe('Instance Management', () => {
    it('should list instances correctly', () => {
      const instances = manager.listInstances()
      expect(Array.isArray(instances)).toBe(true)
    })

    it('should return undefined for non-existent instance', () => {
      const instance = manager.getInstance('non-existent')
      expect(instance).toBeUndefined()
    })

    it('should return undefined for non-existent MCP name', () => {
      const instance = manager.getMCPByName('non-existent')
      expect(instance).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('should throw WorkerError for non-existent MCP in executeCode', async () => {
      await expect(
        manager.executeCode('non-existent-id', 'console.log("test");'),
      ).rejects.toThrow()
    })

    it('should throw WorkerError for non-existent MCP in unloadMCP', async () => {
      await expect(manager.unloadMCP('non-existent-id')).rejects.toThrow()
    })
  })
})
