import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaConverter } from '../../src/server/schema-converter.js';
import { MCPTool } from '../../src/types/mcp.js';

describe('SchemaConverter', () => {
  let converter: SchemaConverter;

  beforeEach(() => {
    converter = new SchemaConverter();
  });

  describe('convertToTypeScript', () => {
    it('should convert simple tool with string input', () => {
      const tools: MCPTool[] = [
        {
          name: 'get_weather',
          description: 'Get weather information',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City name',
              },
            },
            required: ['location'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('interface GetWeatherInput');
      expect(result).toContain('location: string');
      expect(result).toContain('interface GetWeatherOutput');
      expect(result).toContain('declare const mcp:');
      expect(result).toContain('get_weather: (input: GetWeatherInput) => Promise<GetWeatherOutput>');
    });

    it('should handle optional fields', () => {
      const tools: MCPTool[] = [
        {
          name: 'search',
          description: 'Search for items',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              limit: {
                type: 'number',
                description: 'Result limit',
              },
            },
            required: ['query'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('query: string');
      expect(result).toContain('limit?: number');
    });

    it('should handle multiple tools', () => {
      const tools: MCPTool[] = [
        {
          name: 'tool1',
          description: 'First tool',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'tool2',
          description: 'Second tool',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('interface Tool1Input');
      expect(result).toContain('interface Tool2Input');
      expect(result).toContain('tool1: (input: Tool1Input) => Promise<Tool1Output>');
      expect(result).toContain('tool2: (input: Tool2Input) => Promise<Tool2Output>');
    });

    it('should handle complex nested objects', () => {
      const tools: MCPTool[] = [
        {
          name: 'create_user',
          description: 'Create a user',
          inputSchema: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' },
                },
                required: ['name'],
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['user'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('user: { name: string; age?: number }');
      expect(result).toContain('tags?: string[]');
    });

    it('should handle array types', () => {
      const tools: MCPTool[] = [
        {
          name: 'process_items',
          description: 'Process multiple items',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                  required: ['id'],
                },
              },
            },
            required: ['items'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('items: { id: string }[]');
    });

    it('should handle tool names with hyphens and underscores', () => {
      const tools: MCPTool[] = [
        {
          name: 'create-github-issue',
          description: 'Create GitHub issue',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
            },
            required: ['title'],
          },
        },
        {
          name: 'search_users',
          description: 'Search users',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('interface CreateGithubIssueInput');
      expect(result).toContain('interface SearchUsersInput');
    });

    it('should handle empty tools array', () => {
      const tools: MCPTool[] = [];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('declare const mcp:');
      expect(result).toContain('};');
    });

    it('should include descriptions in interfaces', () => {
      const tools: MCPTool[] = [
        {
          name: 'test_tool',
          description: 'Test tool description',
          inputSchema: {
            type: 'object',
            properties: {
              param: {
                type: 'string',
                description: 'Parameter description',
              },
            },
            required: ['param'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('/**');
      expect(result).toContain('Parameter description');
      expect(result).toContain('Test tool description');
    });

    it('should handle boolean and number types', () => {
      const tools: MCPTool[] = [
        {
          name: 'update_settings',
          description: 'Update settings',
          inputSchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              count: { type: 'number' },
              integer: { type: 'integer' },
            },
            required: ['enabled'],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('enabled: boolean');
      expect(result).toContain('count?: number');
      expect(result).toContain('integer?: number');
    });

    it('should handle schema without type', () => {
      const tools: MCPTool[] = [
        {
          name: 'flexible_tool',
          description: 'Flexible tool',
          inputSchema: {
            type: 'object',
            properties: {
              data: {
                // No type specified
                description: 'Any data',
              } as any,
            },
            required: [],
          },
        },
      ];

      const result = converter.convertToTypeScript(tools);

      expect(result).toContain('data?: any');
    });
  });
});

