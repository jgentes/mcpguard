/**
 * Tests for config-exporter.ts
 * Tests configuration conversion and export functions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { addMockFile, getMockFileContent, resetMockFs } from '../setup';
import type { MCPSecurityConfig, MCPGuardSettings } from '../../src/extension/types';
import {
  toWorkerIsolationConfig,
  loadWorkerIsolationConfigs,
  getIsolationConfigForMCP,
  generateOutboundRules,
  exportSettingsForRuntime,
  type WorkerIsolationConfig,
} from '../../src/extension/config-exporter';
import { getSettingsPath } from '../../src/extension/config-loader';

describe('config-exporter', () => {
  beforeEach(() => {
    resetMockFs();
  });

  // Helper to create a test MCPSecurityConfig
  function createTestConfig(overrides: Partial<MCPSecurityConfig> = {}): MCPSecurityConfig {
    return {
      id: 'test-id',
      mcpName: 'test-mcp',
      isGuarded: true,
      network: {
        enabled: false,
        allowlist: [],
        allowLocalhost: false,
      },
      fileSystem: {
        enabled: false,
        readPaths: [],
        writePaths: [],
      },
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxMemoryMB: 128,
        maxMCPCalls: 100,
      },
      lastModified: new Date().toISOString(),
      ...overrides,
    };
  }

  // Helper to create test settings
  function createTestSettings(mcpConfigs: MCPSecurityConfig[] = []): MCPGuardSettings {
    return {
      enabled: true,
      defaults: {
        network: { enabled: false, allowlist: [], allowLocalhost: false },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        resourceLimits: { maxExecutionTimeMs: 30000, maxMemoryMB: 128, maxMCPCalls: 100 },
      },
      mcpConfigs,
    };
  }

  describe('toWorkerIsolationConfig', () => {
    it('should convert basic MCPSecurityConfig to WorkerIsolationConfig', () => {
      const input = createTestConfig();
      const result = toWorkerIsolationConfig(input);

      expect(result).toMatchObject({
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: null,
          allowLocalhost: false,
        },
        fileSystem: {
          enabled: false,
          readPaths: [],
          writePaths: [],
        },
        limits: {
          cpuMs: 30000,
          memoryMB: 128,
          subrequests: 100,
        },
      });
    });

    it('should include network allowlist when enabled', () => {
      const input = createTestConfig({
        network: {
          enabled: true,
          allowlist: ['api.github.com', 'api.openai.com'],
          allowLocalhost: true,
        },
      });

      const result = toWorkerIsolationConfig(input);

      expect(result.outbound.allowedHosts).toEqual(['api.github.com', 'api.openai.com']);
      expect(result.outbound.allowLocalhost).toBe(true);
    });

    it('should return null allowedHosts when network enabled but allowlist empty', () => {
      const input = createTestConfig({
        network: {
          enabled: true,
          allowlist: [],
          allowLocalhost: false,
        },
      });

      const result = toWorkerIsolationConfig(input);

      expect(result.outbound.allowedHosts).toBeNull();
      expect(result.outbound.allowLocalhost).toBe(false);
    });

    it('should return null allowedHosts when network disabled', () => {
      const input = createTestConfig({
        network: {
          enabled: false,
          allowlist: ['api.github.com'], // Should be ignored
          allowLocalhost: true, // Should be ignored
        },
      });

      const result = toWorkerIsolationConfig(input);

      expect(result.outbound.allowedHosts).toBeNull();
      expect(result.outbound.allowLocalhost).toBe(false);
    });

    it('should preserve file system paths', () => {
      const input = createTestConfig({
        fileSystem: {
          enabled: true,
          readPaths: ['/home/user/projects', '/tmp'],
          writePaths: ['/tmp/output'],
        },
      });

      const result = toWorkerIsolationConfig(input);

      expect(result.fileSystem).toMatchObject({
        enabled: true,
        readPaths: ['/home/user/projects', '/tmp'],
        writePaths: ['/tmp/output'],
      });
    });

    it('should correctly map resource limits', () => {
      const input = createTestConfig({
        resourceLimits: {
          maxExecutionTimeMs: 60000,
          maxMemoryMB: 256,
          maxMCPCalls: 200,
        },
      });

      const result = toWorkerIsolationConfig(input);

      expect(result.limits).toMatchObject({
        cpuMs: 60000,
        memoryMB: 256,
        subrequests: 200,
      });
    });
  });

  describe('loadWorkerIsolationConfigs', () => {
    it('should return empty map when settings file does not exist', () => {
      const configs = loadWorkerIsolationConfigs();
      expect(configs.size).toBe(0);
    });

    it('should return empty map when MCP Guard is globally disabled', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([createTestConfig()]);
      settings.enabled = false;
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const configs = loadWorkerIsolationConfigs();
      expect(configs.size).toBe(0);
    });

    it('should load configs for guarded MCPs only', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'guarded-mcp', isGuarded: true }),
        createTestConfig({ mcpName: 'unguarded-mcp', isGuarded: false }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const configs = loadWorkerIsolationConfigs();
      
      expect(configs.size).toBe(1);
      expect(configs.has('guarded-mcp')).toBe(true);
      expect(configs.has('unguarded-mcp')).toBe(false);
    });

    it('should handle invalid JSON in settings file', () => {
      const settingsPath = getSettingsPath();
      addMockFile(settingsPath, '{ invalid json }');

      const configs = loadWorkerIsolationConfigs();
      expect(configs.size).toBe(0);
    });

    it('should load multiple guarded MCPs', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'mcp-1', isGuarded: true }),
        createTestConfig({ mcpName: 'mcp-2', isGuarded: true }),
        createTestConfig({ mcpName: 'mcp-3', isGuarded: true }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const configs = loadWorkerIsolationConfigs();
      
      expect(configs.size).toBe(3);
      expect(configs.has('mcp-1')).toBe(true);
      expect(configs.has('mcp-2')).toBe(true);
      expect(configs.has('mcp-3')).toBe(true);
    });
  });

  describe('getIsolationConfigForMCP', () => {
    it('should return undefined when MCP not found', () => {
      const config = getIsolationConfigForMCP('nonexistent-mcp');
      expect(config).toBeUndefined();
    });

    it('should return config for guarded MCP', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'test-mcp', isGuarded: true }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const config = getIsolationConfigForMCP('test-mcp');
      
      expect(config).toBeDefined();
      expect(config?.mcpName).toBe('test-mcp');
      expect(config?.isGuarded).toBe(true);
    });

    it('should return undefined for unguarded MCP', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'unguarded-mcp', isGuarded: false }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const config = getIsolationConfigForMCP('unguarded-mcp');
      expect(config).toBeUndefined();
    });
  });

  describe('generateOutboundRules', () => {
    it('should generate null outbound for complete isolation', () => {
      const config: WorkerIsolationConfig = {
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: null,
          allowLocalhost: false,
        },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        limits: { cpuMs: 30000, memoryMB: 128, subrequests: 100 },
      };

      const rules = generateOutboundRules(config);
      expect(rules).toBe('globalOutbound: null');
    });

    it('should include localhost rules when allowed', () => {
      const config: WorkerIsolationConfig = {
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: null,
          allowLocalhost: true,
        },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        limits: { cpuMs: 30000, memoryMB: 128, subrequests: 100 },
      };

      const rules = generateOutboundRules(config);
      
      expect(rules).toContain('localhost');
      expect(rules).toContain('127.0.0.1');
    });

    it('should include custom hosts in rules', () => {
      const config: WorkerIsolationConfig = {
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: ['api.github.com', 'api.openai.com'],
          allowLocalhost: false,
        },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        limits: { cpuMs: 30000, memoryMB: 128, subrequests: 100 },
      };

      const rules = generateOutboundRules(config);
      
      expect(rules).toContain('api.github.com');
      expect(rules).toContain('api.openai.com');
      expect(rules).not.toContain('localhost');
    });

    it('should include both localhost and custom hosts', () => {
      const config: WorkerIsolationConfig = {
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: ['api.example.com'],
          allowLocalhost: true,
        },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        limits: { cpuMs: 30000, memoryMB: 128, subrequests: 100 },
      };

      const rules = generateOutboundRules(config);
      
      expect(rules).toContain('localhost');
      expect(rules).toContain('127.0.0.1');
      expect(rules).toContain('api.example.com');
    });

    it('should return null outbound when only empty allowlist', () => {
      const config: WorkerIsolationConfig = {
        mcpName: 'test-mcp',
        isGuarded: true,
        outbound: {
          allowedHosts: [],
          allowLocalhost: false,
        },
        fileSystem: { enabled: false, readPaths: [], writePaths: [] },
        limits: { cpuMs: 30000, memoryMB: 128, subrequests: 100 },
      };

      const rules = generateOutboundRules(config);
      expect(rules).toBe('globalOutbound: null');
    });
  });

  describe('exportSettingsForRuntime', () => {
    it('should create output file with isolation configs', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'mcp-1', isGuarded: true }),
        createTestConfig({ mcpName: 'mcp-2', isGuarded: true }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const outputPath = path.join(path.dirname(settingsPath), 'test-export.json');
      exportSettingsForRuntime(outputPath);

      const content = getMockFileContent(outputPath);
      expect(content).toBeDefined();
      
      const exported = JSON.parse(content!);
      expect(exported['mcp-1']).toBeDefined();
      expect(exported['mcp-2']).toBeDefined();
    });

    it('should use default output path when not specified', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'test-mcp', isGuarded: true }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      exportSettingsForRuntime();

      const defaultPath = path.join(path.dirname(settingsPath), 'isolation-configs.json');
      const content = getMockFileContent(defaultPath);
      expect(content).toBeDefined();
    });

    it('should export empty object when no guarded MCPs', () => {
      const settingsPath = getSettingsPath();
      const settings = createTestSettings([
        createTestConfig({ mcpName: 'unguarded-mcp', isGuarded: false }),
      ]);
      
      addMockFile(settingsPath, JSON.stringify(settings));

      const outputPath = path.join(path.dirname(settingsPath), 'test-export.json');
      exportSettingsForRuntime(outputPath);

      const content = getMockFileContent(outputPath);
      const exported = JSON.parse(content!);
      expect(Object.keys(exported)).toHaveLength(0);
    });
  });
});
