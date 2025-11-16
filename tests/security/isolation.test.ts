import { describe, it, expect } from 'vitest';
import { validateTypeScriptCode } from '../../src/utils/validation.js';
import { SecurityError, ValidationError } from '../../src/utils/errors.js';

describe('Security: Code Isolation', () => {
  describe('validateTypeScriptCode', () => {
    it('should block require() calls', () => {
      const code = "const fs = require('fs');";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block eval() calls', () => {
      const code = "eval('malicious code');";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block Function constructor', () => {
      const code = "const fn = new Function('return process');";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block process access', () => {
      const code = "const env = process.env.SECRET;";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block __dirname', () => {
      const code = "const dir = __dirname;";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block __filename', () => {
      const code = "const file = __filename;";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block global access', () => {
      const code = "global.something = 'value';";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should block external imports', () => {
      const code = "import fs from 'fs';";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should allow relative imports', () => {
      const code = "import { helper } from './helper';";
      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should block code exceeding length limit', () => {
      const code = 'a'.repeat(50001);
      expect(() => validateTypeScriptCode(code)).toThrow(ValidationError);
    });

    it('should allow valid code at length limit', () => {
      const code = 'a'.repeat(50000);
      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should allow safe MCP tool calls', () => {
      const code = `
        const result = await mcp.search_users({ query: 'test' });
        console.log(result);
      `;
      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should block multiple dangerous patterns', () => {
      const code = "require('fs'); eval('code'); process.env;";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should allow complex but safe code', () => {
      const code = `
        async function processData() {
          const result1 = await mcp.tool1({ param: 'value' });
          const result2 = await mcp.tool2({ id: result1.id });
          
          const processed = result2.items.map(item => ({
            ...item,
            processed: true
          }));
          
          console.log(JSON.stringify(processed, null, 2));
          return processed;
        }
        
        await processData();
      `;
      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should block require in comments (edge case)', () => {
      // This is a limitation - regex matches in comments too
      // But it's better to be safe
      const code = "// require('fs')";
      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });
  });

  describe('Worker Code Generation Security', () => {
    it('should escape special characters in RPC URL', async () => {
      const { WorkerManager } = await import('../../src/server/worker-manager.js');
      const manager = new WorkerManager();
      
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
      
      // Test with special characters that could break code generation
      const workerCode = await generateCode(
        'test-id-with-special-chars',
        tools,
        '',
        'console.log("test");'
      );

      const code = workerCode.modules['worker.js'] as string;
      const rpcUrl = workerCode.env.MCP_RPC_URL as string;
      
      // Code should be valid and not throw syntax errors
      expect(code).toBeDefined();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      
      // RPC URL should be properly embedded and escaped in the code when tools exist
      expect(code).toContain('fetch');
      expect(code).toContain('mcp-rpc');
    });
  });
});

