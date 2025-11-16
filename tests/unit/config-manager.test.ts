import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../src/utils/config-manager.js';
import { MCPConfig } from '../../src/types/mcp.js';
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigManager', () => {
  let testDir: string;
  let configPath: string;
  let manager: ConfigManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = join(tmpdir(), `mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'mcp.json');
  });

  afterEach(() => {
    // Cleanup
    try {
      if (existsSync(configPath)) {
        unlinkSync(configPath);
      }
      if (existsSync(testDir)) {
        rmdirSync(testDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('saveConfig and getSavedConfig', () => {
    it('should save and retrieve a config', () => {
      manager = new ConfigManager();
      
      // Use importConfigs to set a custom path
      const result = manager.importConfigs(configPath);
      
      const config: MCPConfig = {
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: 'test-token',
        },
      };

      manager.saveConfig('github', config);
      const retrieved = manager.getSavedConfig('github');

      expect(retrieved).toBeDefined();
      expect(retrieved?.command).toBe('npx');
      expect(retrieved?.args).toEqual(['@modelcontextprotocol/server-github']);
    });

    it('should handle configs without args', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'node',
        env: {
          API_KEY: 'key',
        },
      };

      manager.saveConfig('simple', config);
      const retrieved = manager.getSavedConfig('simple');

      expect(retrieved?.command).toBe('node');
      expect(retrieved?.args).toBeUndefined();
    });

    it('should handle configs without env', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'npx',
        args: ['tool'],
      };

      manager.saveConfig('no-env', config);
      const retrieved = manager.getSavedConfig('no-env');

      expect(retrieved?.command).toBe('npx');
      expect(retrieved?.env).toBeUndefined();
    });

    it('should return null for non-existent config', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const retrieved = manager.getSavedConfig('non-existent');

      expect(retrieved).toBeNull();
    });
  });

  describe('getSavedConfigs', () => {
    it('should return all saved configs', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config1: MCPConfig = {
        command: 'npx',
        args: ['tool1'],
      };
      const config2: MCPConfig = {
        command: 'npx',
        args: ['tool2'],
      };

      manager.saveConfig('tool1', config1);
      manager.saveConfig('tool2', config2);

      const configs = manager.getSavedConfigs();

      // Should include our saved configs (may also include existing configs from system)
      expect(configs.tool1).toBeDefined();
      expect(configs.tool2).toBeDefined();
      expect(configs.tool1.config.command).toBe('npx');
      expect(configs.tool2.config.command).toBe('npx');
    });

    it('should import configs from existing file', () => {
      // Create a test config file first
      const testConfig = {
        mcpServers: {
          imported_tool: {
            command: 'npx',
            args: ['imported'],
          },
        },
      };
      const importPath = join(testDir, 'import-mcp.json');
      writeFileSync(importPath, JSON.stringify(testConfig, null, 2));

      manager = new ConfigManager();
      const result = manager.importConfigs(importPath);

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(manager.getSavedConfig('imported_tool')).toBeDefined();
      expect(manager.getCursorConfigPath()).toBe(importPath);
    });
  });

  describe('deleteConfig', () => {
    it('should delete a saved config', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'npx',
        args: ['tool'],
      };

      manager.saveConfig('tool', config);
      expect(manager.getSavedConfig('tool')).toBeDefined();

      const deleted = manager.deleteConfig('tool');
      expect(deleted).toBe(true);
      expect(manager.getSavedConfig('tool')).toBeNull();
    });

    it('should return false for non-existent config', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const deleted = manager.deleteConfig('non-existent');
      expect(deleted).toBe(false);
    });

    it('should return false when no config file exists', () => {
      manager = new ConfigManager();
      // Don't import any config

      const deleted = manager.deleteConfig('any');
      expect(deleted).toBe(false);
    });
  });

  describe('resolveEnvVarsInObject', () => {
    beforeEach(() => {
      process.env.TEST_VAR = 'test-value';
      process.env.ANOTHER_VAR = 'another-value';
    });

    afterEach(() => {
      delete process.env.TEST_VAR;
      delete process.env.ANOTHER_VAR;
    });

    it('should resolve environment variables in strings', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'npx',
        env: {
          TOKEN: '${TEST_VAR}',
          KEY: '${ANOTHER_VAR}',
        },
      };

      manager.saveConfig('test', config);
      const resolved = manager.getSavedConfig('test');

      expect(resolved?.env?.TOKEN).toBe('test-value');
      expect(resolved?.env?.KEY).toBe('another-value');
    });

    it('should handle nested objects', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'npx',
        env: {
          NESTED: JSON.stringify({ key: '${TEST_VAR}' }),
        },
      };

      manager.saveConfig('nested', config);
      const resolved = manager.getSavedConfig('nested');

      expect(resolved?.env?.NESTED).toContain('test-value');
    });

    it('should keep placeholder if env var not found', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const config: MCPConfig = {
        command: 'npx',
        env: {
          MISSING: '${NON_EXISTENT_VAR}',
        },
      };

      manager.saveConfig('missing', config);
      const resolved = manager.getSavedConfig('missing');

      expect(resolved?.env?.MISSING).toBe('${NON_EXISTENT_VAR}');
    });
  });

  describe('importConfigs', () => {
    it('should import configs from existing file', () => {
      // Create a test config file
      const testConfig = {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['@modelcontextprotocol/server-github'],
          },
          test: {
            command: 'node',
            args: ['test.js'],
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      manager = new ConfigManager();
      const result = manager.importConfigs(configPath);

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(manager.getSavedConfig('github')).toBeDefined();
      expect(manager.getSavedConfig('test')).toBeDefined();
    });

    it('should return error for non-existent file', () => {
      manager = new ConfigManager();
      const result = manager.importConfigs('/non/existent/path.json');

      expect(result.imported).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid JSON', () => {
      writeFileSync(configPath, 'invalid json');

      manager = new ConfigManager();
      const result = manager.importConfigs(configPath);

      // Should handle gracefully
      expect(result.imported).toBe(0);
    });
  });

  describe('getConfigSourceDisplayName', () => {
    it('should return display name for detected source', () => {
      manager = new ConfigManager();
      manager.importConfigs(configPath);

      const name = manager.getConfigSourceDisplayName();
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
    });

    it('should return a valid display name', () => {
      manager = new ConfigManager();
      // ConfigManager may detect system configs, so just verify it returns a string
      const name = manager.getConfigSourceDisplayName();
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });
});

