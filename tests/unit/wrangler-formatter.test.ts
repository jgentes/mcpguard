import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatWranglerError, formatExecutionResult } from '../../src/utils/wrangler-formatter.js';

describe('wrangler-formatter', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;

  beforeEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe('formatWranglerError', () => {
    it('should format error in normal mode', () => {
      const error = new Error('Test error');
      const result = formatWranglerError(error, 'stdout', 'stderr');
      
      expect(result).toContain('❌ Wrangler Execution Error');
      expect(result).toContain('stderr');
    });

    it('should format error in verbose mode', () => {
      process.argv.push('--verbose');
      const error = new Error('Test error');
      const result = formatWranglerError(error, 'stdout output', 'stderr output', {
        mcpId: 'test-id',
        port: 8080,
        tempDir: '/tmp/test',
        userCode: 'console.log("test");',
      });
      
      expect(result).toContain('Error: Test error');
      expect(result).toContain('MCP ID: test-id');
      expect(result).toContain('Port: 8080');
      expect(result).toContain('Temp Dir: /tmp/test');
      expect(result).toContain('Your code:');
      expect(result).toContain('Wrangler STDOUT:');
      expect(result).toContain('Wrangler STDERR:');
    });

    it('should handle build errors', () => {
      const error = new Error('Build failed');
      const stderr = 'Build failed\n✗ Build failed';
      const result = formatWranglerError(error, '', stderr);
      
      expect(result).toContain('🔍 TypeScript Compilation Error');
      expect(result).toContain('Your code has a syntax error');
    });

    it('should strip ANSI codes', () => {
      const error = new Error('Test');
      const stderr = '\u001b[31mError\u001b[0m';
      const result = formatWranglerError(error, '', stderr);
      
      expect(result).not.toContain('\u001b');
      expect(result).toContain('Error');
    });

    it('should handle empty stderr', () => {
      const error = new Error('Test error');
      const result = formatWranglerError(error, 'stdout', '');
      
      expect(result).toBeDefined();
      expect(result).toContain('❌ Wrangler Execution Error');
    });

    it('should handle context without all fields in verbose mode', () => {
      process.argv.push('--verbose');
      const error = new Error('Test');
      const result = formatWranglerError(error, '', 'stderr', {
        mcpId: 'test-id',
      });
      
      expect(result).toContain('test-id');
    });

    it('should format esbuild error locations', () => {
      process.argv.push('--verbose');
      const error = new Error('Build failed');
      const stderr = 'user-code.ts:4:68: error message';
      const result = formatWranglerError(error, '', stderr, {
        userCode: 'const x = 1;',
      });
      
      expect(result).toContain('user-code.ts:4:68');
    });
  });

  describe('formatExecutionResult', () => {
    it('should format successful execution', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Test output',
        execution_time_ms: 100,
        metrics: {
          mcp_calls_made: 2,
          tokens_saved_estimate: 50,
        },
      });
      
      expect(result).toContain('✅ Execution Successful');
      expect(result).toContain('Output:');
      expect(result).toContain('Test output');
      expect(result).toContain('Execution Time: 100ms');
      expect(result).toContain('MCP Calls Made: 2');
      expect(result).toContain('Tokens Saved (est.): 50');
    });

    it('should format failed execution', () => {
      const result = formatExecutionResult({
        success: false,
        error: 'Test error',
        execution_time_ms: 50,
      });
      
      expect(result).toContain('❌ Execution Failed');
      expect(result).toContain('Error: Test error');
      expect(result).toContain('Execution Time: 50ms');
    });

    it('should handle execution without metrics', () => {
      const result = formatExecutionResult({
        success: true,
        output: 'Output',
        execution_time_ms: 200,
      });
      
      expect(result).toContain('✅ Execution Successful');
      expect(result).toContain('Execution Time: 200ms');
    });

    it('should handle execution without output', () => {
      const result = formatExecutionResult({
        success: true,
        execution_time_ms: 150,
        metrics: {
          mcp_calls_made: 1,
          tokens_saved_estimate: 25,
        },
      });
      
      expect(result).toContain('✅ Execution Successful');
      expect(result).toContain('Execution Time: 150ms');
    });
  });
});

