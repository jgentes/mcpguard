import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatExecutionResult,
  formatWranglerError,
} from '../../src/utils/wrangler-formatter.js'

describe('wrangler-formatter', () => {
  const originalArgv = process.argv
  const originalEnv = process.env

  beforeEach(() => {
    process.argv = [...originalArgv]
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
  })

  describe('formatWranglerError', () => {
    it('should format error in normal mode', () => {
      const error = new Error('Test error')
      const result = formatWranglerError(error, 'stdout', 'stderr')

      expect(result).toContain('❌ Wrangler Execution Error')
      expect(result).toContain('stderr')
    })

    it('should format error in verbose mode', () => {
      process.argv.push('--verbose')
      const error = new Error('Test error')
      const result = formatWranglerError(
        error,
        'stdout output',
        'stderr output',
        {
          mcpId: 'test-id',
          port: 8080,
          tempDir: '/tmp/test',
          userCode: 'console.log("test");',
        },
      )

      expect(result).toContain('Error: Test error')
      expect(result).toContain('MCP ID: test-id')
      expect(result).toContain('Port: 8080')
      expect(result).toContain('Temp Dir: /tmp/test')
      expect(result).toContain('Your code:')
      expect(result).toContain('Wrangler STDOUT:')
      expect(result).toContain('Wrangler STDERR:')
    })

    it('should handle build errors', () => {
      const error = new Error('Build failed')
      const stderr = 'Build failed\n✗ Build failed'
      const result = formatWranglerError(error, '', stderr)

      expect(result).toContain('🔍 TypeScript Compilation Error')
      expect(result).toContain('Your code has a syntax error')
    })

    it('should strip ANSI codes', () => {
      const error = new Error('Test')
      const stderr = '\u001b[31mError\u001b[0m'
      const result = formatWranglerError(error, '', stderr)

      expect(result).not.toContain('\u001b')
      expect(result).toContain('Error')
    })

    it('should handle empty stderr', () => {
      const error = new Error('Test error')
      const result = formatWranglerError(error, 'stdout', '')

      expect(result).toBeDefined()
      expect(result).toContain('❌ Wrangler Execution Error')
    })

    it('should handle context without all fields in verbose mode', () => {
      process.argv.push('--verbose')
      const error = new Error('Test')
      const result = formatWranglerError(error, '', 'stderr', {
        mcpId: 'test-id',
      })

      expect(result).toContain('test-id')
    })

    it('should format esbuild error locations', () => {
      process.argv.push('--verbose')
      const error = new Error('Build failed')
      const stderr = 'user-code.ts:4:68: error message'
      const result = formatWranglerError(error, '', stderr, {
        userCode: 'const x = 1;',
      })

      expect(result).toContain('user-code.ts:4:68')
    })
  })

  describe('formatExecutionResult', () => {
    it('should format successful execution', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test output',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 2,
        },
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('Output:')
      expect(result).toContain('Test output')
      expect(result).toContain('2 MCP calls: 100ms') // New format combines MCP calls and execution time
    })

    it('should format failed execution', () => {
      const result = formatExecutionResult({
        success: false,
        error: 'Test error',
        execution_time_ms: 50,
      })

      expect(result).toContain('❌ Execution Failed')
      expect(result).toContain('Error: Test error')
      expect(result).toContain('Execution Time: 50ms')
    })

    it('should handle execution without metrics', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Output',
        execution_time_ms: 200,
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('Execution Time: 200ms')
    })

    it('should handle execution without output', () => {
      const result = formatExecutionResult({
        success: true,
        execution_time_ms: 150,
        metrics: {
          mcp_calls_made: 1,
        },
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('1 MCP calls: 150ms') // New format combines MCP calls and execution time
    })

    it('should pretty-print JSON output', () => {
      const jsonOutput = JSON.stringify({
        total_count: 2,
        items: [{ id: 1, name: 'test' }],
      })
      const result = formatExecutionResult({
        success: true,
        output: jsonOutput,
        execution_time_ms: 100,
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('Output:')
      // Should contain pretty-printed JSON with proper indentation
      expect(result).toContain('"total_count": 2')
      expect(result).toContain('"items":')
    })

    it('should pretty-print nested JSON in MCP response format', () => {
      const mcpResponse = JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ total_count: 2, items: [] }),
          },
        ],
      })
      const result = formatExecutionResult({
        success: true,
        output: mcpResponse,
        execution_time_ms: 100,
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('Output:')
      // The nested JSON is pretty-printed, so we check for unescaped quotes
      expect(result).toContain('"total_count"')
      expect(result).toContain('"items"')
    })

    it('should format execution result with schema efficiency metrics', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 2,
          schema_efficiency: {
            total_tools_available: 10,
            tools_used: ['tool1', 'tool2'],
            schema_size_total_chars: 1000,
            schema_size_used_chars: 200,
            schema_utilization_percent: 20,
            schema_efficiency_ratio: 5,
            schema_size_reduction_chars: 800,
            schema_size_reduction_percent: 80,
            estimated_tokens_saved: 250,
          },
        },
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('2 MCP calls: 100ms')
      expect(result).toContain('tokens saved')
      expect(result).toContain('80% reduction')
    })

    it('should format execution result with security metrics', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 1,
          security: {
            network_isolation_enabled: true,
            process_isolation_enabled: true,
            isolation_type: 'worker',
            security_level: 'high',
            protection_summary: ['Network isolation', 'Process isolation'],
          },
        },
      })

      expect(result).toContain('✅ Execution Successful')
      expect(result).toContain('Security (HIGH)')
      expect(result).toContain('Network ✓')
      expect(result).toContain('Process ✓')
    })

    it('should format execution result with schema efficiency without token estimate', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 2,
          schema_efficiency: {
            total_tools_available: 10,
            tools_used: ['tool1'],
            schema_size_total_chars: 1000,
            schema_size_used_chars: 200,
            schema_utilization_percent: 20,
            schema_efficiency_ratio: 5,
            schema_size_reduction_chars: 800,
            schema_size_reduction_percent: 80,
          },
        },
      })

      expect(result).toContain('2 MCP calls: 100ms')
      expect(result).toContain('80% schema reduction')
    })

    it('should handle schema efficiency with 0% reduction', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 2,
          schema_efficiency: {
            total_tools_available: 10,
            tools_used: ['tool1', 'tool2'],
            schema_size_total_chars: 1000,
            schema_size_used_chars: 1000,
            schema_utilization_percent: 100,
            schema_efficiency_ratio: 1,
            schema_size_reduction_chars: 0,
            schema_size_reduction_percent: 0,
          },
        },
      })

      expect(result).toContain('2 MCP calls: 100ms')
      expect(result).not.toContain('reduction')
    })
  })
})
