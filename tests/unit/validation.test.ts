import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateInput, validateTypeScriptCode } from '../../src/utils/validation.js';
import { ValidationError, SecurityError } from '../../src/utils/errors.js';

describe('Validation', () => {
  describe('validateInput', () => {
    it('should validate correct input', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = validateInput(schema, { name: 'John', age: 30 });

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should throw ValidationError for invalid input', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      expect(() => {
        validateInput(schema, { name: 'John', age: '30' });
      }).toThrow(ValidationError);
    });

    it('should handle nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
        }),
      });

      const result = validateInput(schema, { user: { name: 'John' } });

      expect(result).toEqual({ user: { name: 'John' } });
    });

    it('should handle arrays', () => {
      const schema = z.object({
        items: z.array(z.string()),
      });

      const result = validateInput(schema, { items: ['a', 'b', 'c'] });

      expect(result).toEqual({ items: ['a', 'b', 'c'] });
    });

    it('should handle optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result1 = validateInput(schema, { required: 'test' });
      expect(result1).toEqual({ required: 'test' });

      const result2 = validateInput(schema, { required: 'test', optional: 'value' });
      expect(result2).toEqual({ required: 'test', optional: 'value' });
    });
  });

  describe('validateTypeScriptCode', () => {
    it('should accept valid TypeScript code', () => {
      const code = `
        const result = await mcp.get_weather({ location: 'NYC' });
        console.log(result);
      `;

      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should reject require() calls', () => {
      const code = "const fs = require('fs');";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
      expect(() => validateTypeScriptCode(code)).toThrow(/dangerous pattern/);
    });

    it('should reject external imports', () => {
      const code = "import fs from 'fs';";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should allow relative imports', () => {
      const code = "import { helper } from './helper';";

      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should reject eval() calls', () => {
      const code = "eval('console.log(1)');";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject Function constructor', () => {
      const code = "const fn = new Function('return 1');";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject process access', () => {
      const code = "const env = process.env;";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject __dirname', () => {
      const code = "const dir = __dirname;";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject __filename', () => {
      const code = "const file = __filename;";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject global access', () => {
      const code = "global.something = 1;";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });

    it('should reject code exceeding length limit', () => {
      const code = 'a'.repeat(50001);

      expect(() => validateTypeScriptCode(code)).toThrow(ValidationError);
      expect(() => validateTypeScriptCode(code)).toThrow(/exceeds maximum length/);
    });

    it('should accept code at length limit', () => {
      const code = 'a'.repeat(50000);

      expect(() => validateTypeScriptCode(code)).not.toThrow();
    });

    it('should handle complex valid code', () => {
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

    it('should handle multiple dangerous patterns', () => {
      const code = "require('fs'); eval('code'); process.env;";

      expect(() => validateTypeScriptCode(code)).toThrow(SecurityError);
    });
  });
});

