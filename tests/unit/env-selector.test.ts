import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEnvVarsFromFile } from '../../src/utils/env-selector.js';
import * as path from 'path';

// Mock readline for interactive function
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock fs module
const mockFiles: Map<string, string> = new Map();
vi.mock('fs', () => ({
  existsSync: vi.fn((filePath: string) => mockFiles.has(filePath)),
  readFileSync: vi.fn((filePath: string) => {
    const content = mockFiles.get(filePath);
    if (content === undefined) {
      const err = new Error('ENOENT') as any;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  }),
}));

describe('env-selector', () => {
  let mockCwd: string;
  let mockEnvPath: string;

  beforeEach(() => {
    mockCwd = '/test/dir';
    mockEnvPath = path.join(mockCwd, '.env');
    
    // Mock process.cwd()
    vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
    
    // Clear mock files
    mockFiles.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockFiles.clear();
  });

  describe('getEnvVarsFromFile', () => {
    it('should return empty object when .env file does not exist', () => {
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({});
    });

    it('should parse basic KEY=VALUE format', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value\nANOTHER_KEY=another_value');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
        ANOTHER_KEY: 'another_value',
      });
    });

    it('should skip comments', () => {
      mockFiles.set(mockEnvPath, '# This is a comment\nTEST_KEY=test_value\n# Another comment');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
      });
    });

    it('should skip empty lines', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value\n\nANOTHER_KEY=another_value\n');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
        ANOTHER_KEY: 'another_value',
      });
    });

    it('should remove quotes from values', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY="quoted_value"\nANOTHER_KEY=\'single_quoted\'');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'quoted_value',
        ANOTHER_KEY: 'single_quoted',
      });
    });

    it('should handle values with spaces', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=value with spaces');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'value with spaces',
      });
    });

    it('should handle values with equals signs', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=value=with=equals');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        TEST_KEY: 'value=with=equals',
      });
    });

    it('should only match valid variable names', () => {
      mockFiles.set(mockEnvPath, 'VALID_KEY=value\n123INVALID=value\nINVALID-KEY=value\n_VALID=value');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        VALID_KEY: 'value',
        _VALID: 'value',
      });
    });

    it('should handle empty values', () => {
      mockFiles.set(mockEnvPath, 'EMPTY_KEY=');
      
      const envVars = getEnvVarsFromFile();
      expect(envVars).toEqual({
        EMPTY_KEY: '',
      });
    });
  });
});

