/**
 * Tests for types.ts
 * Tests type definitions and default values
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_SETTINGS,
  type MCPSecurityConfig,
  type MCPGuardSettings,
  type MCPServerInfo,
  type NetworkConfig,
  type FileSystemConfig,
  type ResourceLimits,
} from '../../src/extension/types';

describe('types', () => {
  describe('DEFAULT_SECURITY_CONFIG', () => {
    it('should have network disabled by default', () => {
      expect(DEFAULT_SECURITY_CONFIG.network.enabled).toBe(false);
    });

    it('should have empty network allowlist by default', () => {
      expect(DEFAULT_SECURITY_CONFIG.network.allowlist).toEqual([]);
    });

    it('should not allow localhost by default', () => {
      expect(DEFAULT_SECURITY_CONFIG.network.allowLocalhost).toBe(false);
    });

    it('should have file system disabled by default', () => {
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.enabled).toBe(false);
    });

    it('should have empty file system paths by default', () => {
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.readPaths).toEqual([]);
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.writePaths).toEqual([]);
    });

    it('should have 30 second default execution time', () => {
      expect(DEFAULT_SECURITY_CONFIG.resourceLimits.maxExecutionTimeMs).toBe(30000);
    });

    it('should have 128 MB default memory limit', () => {
      expect(DEFAULT_SECURITY_CONFIG.resourceLimits.maxMemoryMB).toBe(128);
    });

    it('should have 100 default max MCP calls', () => {
      expect(DEFAULT_SECURITY_CONFIG.resourceLimits.maxMCPCalls).toBe(100);
    });

    it('should be a secure default (minimal permissions)', () => {
      // Verify all permissions are restrictive by default
      expect(DEFAULT_SECURITY_CONFIG.network.enabled).toBe(false);
      expect(DEFAULT_SECURITY_CONFIG.network.allowlist.length).toBe(0);
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.enabled).toBe(false);
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.readPaths.length).toBe(0);
      expect(DEFAULT_SECURITY_CONFIG.fileSystem.writePaths.length).toBe(0);
    });
  });

  describe('DEFAULT_SETTINGS', () => {
    it('should be enabled by default', () => {
      expect(DEFAULT_SETTINGS.enabled).toBe(true);
    });

    it('should have empty mcpConfigs by default', () => {
      expect(DEFAULT_SETTINGS.mcpConfigs).toEqual([]);
    });

    it('should use DEFAULT_SECURITY_CONFIG for defaults', () => {
      expect(DEFAULT_SETTINGS.defaults).toEqual(DEFAULT_SECURITY_CONFIG);
    });

    it('should have all required properties', () => {
      expect(DEFAULT_SETTINGS).toHaveProperty('enabled');
      expect(DEFAULT_SETTINGS).toHaveProperty('defaults');
      expect(DEFAULT_SETTINGS).toHaveProperty('mcpConfigs');
    });
  });

  describe('Type Structure Validation', () => {
    it('should allow creating valid MCPSecurityConfig', () => {
      const config: MCPSecurityConfig = {
        id: 'test-123',
        mcpName: 'test-mcp',
        isGuarded: true,
        network: {
          enabled: true,
          allowlist: ['api.example.com'],
          allowLocalhost: false,
        },
        fileSystem: {
          enabled: true,
          readPaths: ['/tmp'],
          writePaths: ['/tmp/output'],
        },
        resourceLimits: {
          maxExecutionTimeMs: 60000,
          maxMemoryMB: 256,
          maxMCPCalls: 50,
        },
        lastModified: '2024-01-01T00:00:00Z',
      };

      expect(config.id).toBe('test-123');
      expect(config.mcpName).toBe('test-mcp');
      expect(config.isGuarded).toBe(true);
    });

    it('should allow creating valid MCPServerInfo', () => {
      const serverInfo: MCPServerInfo = {
        name: 'github-mcp',
        command: 'npx',
        args: ['@github/mcp-server'],
        env: { GITHUB_TOKEN: 'token123' },
        source: 'cursor',
        enabled: true,
      };

      expect(serverInfo.name).toBe('github-mcp');
      expect(serverInfo.source).toBe('cursor');
    });

    it('should allow URL-based MCPServerInfo', () => {
      const serverInfo: MCPServerInfo = {
        name: 'remote-mcp',
        url: 'http://localhost:3000/mcp',
        source: 'claude',
        enabled: true,
      };

      expect(serverInfo.url).toBe('http://localhost:3000/mcp');
      expect(serverInfo.command).toBeUndefined();
    });

    it('should allow all valid source types', () => {
      const sources: Array<MCPServerInfo['source']> = ['claude', 'copilot', 'cursor', 'unknown'];
      
      for (const source of sources) {
        const serverInfo: MCPServerInfo = {
          name: 'test',
          source,
          enabled: true,
        };
        expect(serverInfo.source).toBe(source);
      }
    });

    it('should allow creating valid NetworkConfig', () => {
      const networkConfig: NetworkConfig = {
        enabled: true,
        allowlist: ['api.github.com', 'api.openai.com'],
        allowLocalhost: true,
      };

      expect(networkConfig.allowlist).toHaveLength(2);
    });

    it('should allow creating valid FileSystemConfig', () => {
      const fsConfig: FileSystemConfig = {
        enabled: true,
        readPaths: ['/home/user', '/etc/config'],
        writePaths: ['/tmp'],
      };

      expect(fsConfig.readPaths).toHaveLength(2);
      expect(fsConfig.writePaths).toHaveLength(1);
    });

    it('should allow creating valid ResourceLimits', () => {
      const limits: ResourceLimits = {
        maxExecutionTimeMs: 120000,
        maxMemoryMB: 512,
        maxMCPCalls: 1000,
      };

      expect(limits.maxExecutionTimeMs).toBe(120000);
    });

    it('should allow creating valid MCPGuardSettings', () => {
      const settings: MCPGuardSettings = {
        enabled: true,
        defaults: DEFAULT_SECURITY_CONFIG,
        mcpConfigs: [
          {
            id: 'config-1',
            mcpName: 'mcp-1',
            isGuarded: true,
            ...DEFAULT_SECURITY_CONFIG,
            lastModified: new Date().toISOString(),
          },
        ],
      };

      expect(settings.mcpConfigs).toHaveLength(1);
    });
  });

  describe('Default Values Security', () => {
    it('should default to most restrictive network settings', () => {
      const defaults = DEFAULT_SECURITY_CONFIG.network;
      
      // Network should be off by default
      expect(defaults.enabled).toBe(false);
      // No hosts should be allowed by default
      expect(defaults.allowlist).toEqual([]);
      // Localhost should not be allowed by default
      expect(defaults.allowLocalhost).toBe(false);
    });

    it('should default to most restrictive file system settings', () => {
      const defaults = DEFAULT_SECURITY_CONFIG.fileSystem;
      
      // File system should be off by default
      expect(defaults.enabled).toBe(false);
      // No paths should be readable by default
      expect(defaults.readPaths).toEqual([]);
      // No paths should be writable by default
      expect(defaults.writePaths).toEqual([]);
    });

    it('should have reasonable resource limits', () => {
      const defaults = DEFAULT_SECURITY_CONFIG.resourceLimits;
      
      // Execution time should be limited but reasonable (30s)
      expect(defaults.maxExecutionTimeMs).toBeGreaterThan(0);
      expect(defaults.maxExecutionTimeMs).toBeLessThanOrEqual(60000);
      
      // Memory should be limited but usable (128MB)
      expect(defaults.maxMemoryMB).toBeGreaterThan(0);
      expect(defaults.maxMemoryMB).toBeLessThanOrEqual(1024);
      
      // MCP calls should be limited
      expect(defaults.maxMCPCalls).toBeGreaterThan(0);
      expect(defaults.maxMCPCalls).toBeLessThanOrEqual(1000);
    });
  });
});

