/**
 * Tests for config-loader.ts
 * Tests IDE config loading, MCP management, and config file manipulation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { addMockFile, getMockFileContent, resetMockFs } from '../setup';

// Helper to get test config paths (uses the same paths as config-loader.ts)
function getTestConfigPath(ide: 'claude' | 'copilot' | 'cursor'): string {
  const homeDir = os.homedir();
  
  switch (ide) {
    case 'claude':
      // Claude Code uses ~/.claude/mcp.json as primary path (cross-platform)
      return path.join(homeDir, '.claude', 'mcp.json');
    
    case 'copilot':
      // GitHub Copilot uses ~/.github/copilot/mcp.json as primary path
      return path.join(homeDir, '.github', 'copilot', 'mcp.json');
    
    case 'cursor':
      // Cursor uses ~/.cursor/mcp.json as primary path
      return path.join(homeDir, '.cursor', 'mcp.json');
  }
}

// Helper to create sample MCP config
function createSampleMCPConfig(mcpServers: Record<string, unknown>, extras?: Record<string, unknown>): string {
  return JSON.stringify({
    mcpServers,
    ...extras,
  }, null, 2);
}

// Import the module under test
import {
  loadAllMCPServers,
  getSettingsPath,
  getDetectedConfigs,
  getPrimaryIDEConfigPath,
  isMCPDisabled,
  disableMCPInIDE,
  enableMCPInIDE,
  ensureMCPGuardInConfig,
  removeMCPGuardFromConfig,
  getMCPStatus,
  invalidateMCPCache,
  addMCPToIDE,
  deleteMCPFromIDE,
} from '../../src/extension/config-loader';

describe('config-loader', () => {
  beforeEach(() => {
    resetMockFs();
  });

  describe('loadAllMCPServers', () => {
    it('should return empty array when no config files exist', () => {
      const mcps = loadAllMCPServers();
      expect(mcps).toEqual([]);
    });

    it('should load MCPs from Claude config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'test-mcp': {
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'secret' },
        },
        'another-mcp': {
          url: 'http://localhost:3000',
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(2);
      expect(mcps[0]).toMatchObject({
        name: 'test-mcp',
        command: 'node',
        args: ['server.js'],
        source: 'claude',
        enabled: true,
      });
      expect(mcps[1]).toMatchObject({
        name: 'another-mcp',
        url: 'http://localhost:3000',
        source: 'claude',
        enabled: true,
      });
    });

    it('should load MCPs from Cursor config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'cursor-mcp': {
          command: 'python',
          args: ['-m', 'mcp_server'],
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0]).toMatchObject({
        name: 'cursor-mcp',
        command: 'python',
        source: 'cursor',
        enabled: true,
      });
    });

    it('should load disabled MCPs from Cursor _mcpguard_disabled section', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {
          'active-mcp': { command: 'node', args: ['active.js'] },
        },
        {
          _mcpguard_disabled: {
            'disabled-mcp': { command: 'node', args: ['disabled.js'] },
          },
        }
      ));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(2);
      
      const activeMcp = mcps.find(m => m.name === 'active-mcp');
      const disabledMcp = mcps.find(m => m.name === 'disabled-mcp');
      
      expect(activeMcp?.enabled).toBe(true);
      expect(disabledMcp?.enabled).toBe(false);
    });

    it('should load MCPs from Copilot config', () => {
      const copilotPath = getTestConfigPath('copilot');
      addMockFile(copilotPath, createSampleMCPConfig({
        'copilot-mcp': {
          command: 'npx',
          args: ['@copilot/mcp'],
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0]).toMatchObject({
        name: 'copilot-mcp',
        source: 'copilot',
        enabled: true,
      });
    });

    it('should skip mcpguard entry in configs', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        mcpguard: { command: 'node', args: ['mcpguard.js'] },
        'real-mcp': { command: 'node', args: ['real.js'] },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0].name).toBe('real-mcp');
    });

    it('should deduplicate MCPs by name (prefer earlier sources)', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'shared-mcp': { command: 'claude-cmd' },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({
        'shared-mcp': { command: 'cursor-cmd' },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0].command).toBe('claude-cmd');
      expect(mcps[0].source).toBe('claude');
    });

    it('should handle disabled MCPs in Claude config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'disabled-mcp': {
          command: 'node',
          args: ['disabled.js'],
          disabled: true,
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0].enabled).toBe(false);
    });

    it('should handle invalid JSON gracefully', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, '{ invalid json }');

      const mcps = loadAllMCPServers();
      expect(mcps).toEqual([]);
    });

    it('should handle config without mcpServers key', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, JSON.stringify({ someOtherKey: 'value' }));

      const mcps = loadAllMCPServers();
      expect(mcps).toEqual([]);
    });
  });

  describe('getSettingsPath', () => {
    it('should return path in user home directory', () => {
      const settingsPath = getSettingsPath();
      expect(settingsPath).toContain('.mcpguard');
      expect(settingsPath).toContain('settings.json');
    });

    it('should create directory if it does not exist', () => {
      const settingsPath = getSettingsPath();
      // The function should not throw even when directory doesn't exist
      expect(settingsPath).toBeDefined();
    });
  });

  describe('getDetectedConfigs', () => {
    it('should return empty array when no configs exist', () => {
      const detected = getDetectedConfigs();
      expect(detected).toEqual([]);
    });

    it('should detect Claude config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({}));

      const detected = getDetectedConfigs();
      
      expect(detected.length).toBeGreaterThanOrEqual(1);
      expect(detected.find(d => d.ide === 'claude')).toBeDefined();
    });

    it('should detect multiple IDE configs', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({}));
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const detected = getDetectedConfigs();
      
      expect(detected.length).toBeGreaterThanOrEqual(2);
      expect(detected.find(d => d.ide === 'claude')).toBeDefined();
      expect(detected.find(d => d.ide === 'cursor')).toBeDefined();
    });
  });

  describe('getPrimaryIDEConfigPath', () => {
    it('should return null when no configs exist', () => {
      const configPath = getPrimaryIDEConfigPath();
      expect(configPath).toBeNull();
    });

    it('should prefer Claude config over others', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({}));
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const configPath = getPrimaryIDEConfigPath();
      // Claude has highest priority
      expect(configPath).toBe(claudePath);
    });

    it('should fall back to Claude if Cursor not available', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({}));

      const configPath = getPrimaryIDEConfigPath();
      expect(configPath).toBe(claudePath);
    });

    it('should fall back to Copilot if others not available', () => {
      const copilotPath = getTestConfigPath('copilot');
      addMockFile(copilotPath, createSampleMCPConfig({}));

      const configPath = getPrimaryIDEConfigPath();
      expect(configPath).toBe(copilotPath);
    });
  });

  describe('isMCPDisabled', () => {
    it('should return false when no config exists', () => {
      expect(isMCPDisabled('test-mcp')).toBe(false);
    });

    it('should return false for active MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node' },
      }));

      expect(isMCPDisabled('test-mcp')).toBe(false);
    });

    it('should return true for disabled MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'test-mcp': { command: 'node' } } }
      ));

      expect(isMCPDisabled('test-mcp')).toBe(true);
    });
  });

  describe('disableMCPInIDE', () => {
    it('should return failure when no config exists', () => {
      const result = disableMCPInIDE('test-mcp');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No IDE config file found');
    });

    it('should return failure when MCP not found', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const result = disableMCPInIDE('nonexistent-mcp');
      expect(result.success).toBe(false);
      expect(result.message).toContain('MCP not found');
    });

    it('should return success if MCP is already disabled', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'test-mcp': { command: 'node' } } }
      ));

      const result = disableMCPInIDE('test-mcp');
      expect(result.success).toBe(true);
      expect(result.message).toContain('already disabled');
    });

    it('should successfully disable an active MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node', args: ['test.js'] },
      }));

      const result = disableMCPInIDE('test-mcp');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('disabled');
      
      // Verify the MCP was moved to disabled section
      expect(isMCPDisabled('test-mcp')).toBe(true);
    });
  });

  describe('enableMCPInIDE', () => {
    it('should return failure when no config exists', () => {
      const result = enableMCPInIDE('test-mcp');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No IDE config file found');
    });

    it('should return success if MCP is already enabled', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node' },
      }));

      const result = enableMCPInIDE('test-mcp');
      expect(result.success).toBe(true);
      expect(result.message).toContain('already enabled');
    });

    it('should return failure if MCP not in disabled list', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const result = enableMCPInIDE('nonexistent-mcp');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found in disabled list');
    });

    it('should successfully enable a disabled MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'test-mcp': { command: 'node', args: ['test.js'] } } }
      ));

      const result = enableMCPInIDE('test-mcp');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('restored');
      
      // Verify the MCP was moved back to active
      expect(isMCPDisabled('test-mcp')).toBe(false);
    });

    it('should clean up empty _mcpguard_disabled section', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'test-mcp': { command: 'node' } } }
      ));

      enableMCPInIDE('test-mcp');
      
      // After enabling the only disabled MCP, the section should be cleaned up
      // We verify by checking the MCP status
      expect(getMCPStatus('test-mcp')).toBe('active');
    });
  });

  describe('ensureMCPGuardInConfig', () => {
    it('should add mcpguard to existing config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'other-mcp': { command: 'node' },
      }));

      const result = ensureMCPGuardInConfig('/fake/extension/path');
      
      expect(result.success).toBe(true);
      expect(result.added).toBe(true);
      expect(getMCPStatus('mcpguard')).toBe('active');
    });

    it('should return success without adding if mcpguard already exists', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        mcpguard: { command: 'node', args: ['existing.js'] },
      }));

      const result = ensureMCPGuardInConfig('/fake/extension/path');
      
      expect(result.success).toBe(true);
      expect(result.added).toBe(false);
      expect(result.message).toContain('already in config');
    });

    it('should restore mcpguard from disabled section', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { mcpguard: { command: 'node' } } }
      ));

      const result = ensureMCPGuardInConfig('/fake/extension/path');
      
      expect(result.success).toBe(true);
      expect(result.added).toBe(true);
      expect(result.message).toContain('Restored');
    });
  });

  describe('removeMCPGuardFromConfig', () => {
    it('should return failure when no config exists', () => {
      const result = removeMCPGuardFromConfig();
      expect(result.success).toBe(false);
      expect(result.message).toContain('No IDE config file found');
    });

    it('should return success if mcpguard not in config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'other-mcp': { command: 'node' },
      }));

      const result = removeMCPGuardFromConfig();
      expect(result.success).toBe(true);
      expect(result.message).toContain('not in config');
    });

    it('should successfully remove mcpguard from config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        mcpguard: { command: 'node', args: ['guard.js'] },
        'other-mcp': { command: 'node' },
      }));

      const result = removeMCPGuardFromConfig();
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Removed');
      expect(getMCPStatus('mcpguard')).toBe('not_found');
    });
  });

  describe('getMCPStatus', () => {
    it('should return not_found when no config exists', () => {
      expect(getMCPStatus('test-mcp')).toBe('not_found');
    });

    it('should return active for enabled MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node' },
      }));

      expect(getMCPStatus('test-mcp')).toBe('active');
    });

    it('should return disabled for MCP in _mcpguard_disabled', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'test-mcp': { command: 'node' } } }
      ));

      expect(getMCPStatus('test-mcp')).toBe('disabled');
    });

    it('should return not_found for unknown MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'other-mcp': { command: 'node' },
      }));

      expect(getMCPStatus('unknown-mcp')).toBe('not_found');
    });
  });

  describe('invalidateMCPCache', () => {
    it('should return success when no settings file exists', () => {
      const result = invalidateMCPCache('test-mcp');
      expect(result.success).toBe(true);
      expect(result.message).toContain('No settings file exists');
    });

    it('should clear token metrics cache for specific MCP', () => {
      const settingsPath = getSettingsPath();
      addMockFile(settingsPath, JSON.stringify({
        enabled: true,
        defaults: {},
        mcpConfigs: [],
        tokenMetricsCache: {
          'test-mcp': { toolCount: 5, schemaChars: 1000, estimatedTokens: 286, assessedAt: '2024-01-01' },
          'other-mcp': { toolCount: 3, schemaChars: 500, estimatedTokens: 143, assessedAt: '2024-01-01' },
        },
      }));

      const result = invalidateMCPCache('test-mcp');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Cache invalidated');
      
      // Verify the cache was cleared for test-mcp but not other-mcp
      const savedContent = getMockFileContent(settingsPath);
      const saved = JSON.parse(savedContent!);
      expect(saved.tokenMetricsCache['test-mcp']).toBeUndefined();
      expect(saved.tokenMetricsCache['other-mcp']).toBeDefined();
    });

    it('should clear assessment errors cache for specific MCP', () => {
      const settingsPath = getSettingsPath();
      addMockFile(settingsPath, JSON.stringify({
        enabled: true,
        defaults: {},
        mcpConfigs: [],
        assessmentErrorsCache: {
          'test-mcp': { type: 'auth_failed', message: 'Auth failed', errorAt: '2024-01-01' },
          'other-mcp': { type: 'connection_failed', message: 'Connection failed', errorAt: '2024-01-01' },
        },
      }));

      const result = invalidateMCPCache('test-mcp');
      
      expect(result.success).toBe(true);
      
      // Verify the error cache was cleared for test-mcp but not other-mcp
      const savedContent = getMockFileContent(settingsPath);
      const saved = JSON.parse(savedContent!);
      expect(saved.assessmentErrorsCache['test-mcp']).toBeUndefined();
      expect(saved.assessmentErrorsCache['other-mcp']).toBeDefined();
    });

    it('should clear mcpSchemaCache for specific MCP', () => {
      const settingsPath = getSettingsPath();
      addMockFile(settingsPath, JSON.stringify({
        enabled: true,
        defaults: {},
        mcpConfigs: [],
        mcpSchemaCache: {
          'test-mcp:abc123': { mcpName: 'test-mcp', configHash: 'abc123', tools: [], toolNames: [], toolCount: 0, cachedAt: '2024-01-01' },
          'test-mcp:def456': { mcpName: 'test-mcp', configHash: 'def456', tools: [], toolNames: [], toolCount: 0, cachedAt: '2024-01-01' },
          'other-mcp:xyz789': { mcpName: 'other-mcp', configHash: 'xyz789', tools: [{ name: 'tool1' }], toolNames: ['tool1'], toolCount: 1, cachedAt: '2024-01-01' },
        },
      }));

      const result = invalidateMCPCache('test-mcp');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('mcpSchema');
      
      // Verify all cache entries for test-mcp were cleared but not other-mcp
      const savedContent = getMockFileContent(settingsPath);
      const saved = JSON.parse(savedContent!);
      expect(saved.mcpSchemaCache['test-mcp:abc123']).toBeUndefined();
      expect(saved.mcpSchemaCache['test-mcp:def456']).toBeUndefined();
      expect(saved.mcpSchemaCache['other-mcp:xyz789']).toBeDefined();
    });

    it('should return success with message when no cache entries found', () => {
      const settingsPath = getSettingsPath();
      addMockFile(settingsPath, JSON.stringify({
        enabled: true,
        defaults: {},
        mcpConfigs: [],
      }));

      const result = invalidateMCPCache('nonexistent-mcp');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('No cache entries found');
    });
  });

  describe('addMCPToIDE', () => {
    it('should add command-based MCP to existing config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'existing-mcp': { command: 'node', args: ['existing.js'] },
      }));

      const result = addMCPToIDE('new-mcp', {
        command: 'python',
        args: ['-m', 'my_server'],
      });
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Added new-mcp');
      
      // Verify the MCP was added
      const mcps = loadAllMCPServers();
      const newMcp = mcps.find(m => m.name === 'new-mcp');
      expect(newMcp).toBeDefined();
      expect(newMcp?.command).toBe('python');
      expect(newMcp?.args).toEqual(['-m', 'my_server']);
    });

    it('should add URL-based MCP with headers', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const result = addMCPToIDE('github', {
        url: 'https://api.github.com/mcp/',
        headers: { Authorization: 'Bearer token123' },
      });
      
      expect(result.success).toBe(true);
      
      // Verify the MCP was added with headers
      const mcps = loadAllMCPServers();
      const githubMcp = mcps.find(m => m.name === 'github');
      expect(githubMcp).toBeDefined();
      expect(githubMcp?.url).toBe('https://api.github.com/mcp/');
      expect(githubMcp?.headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('should fail if MCP already exists', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'existing-mcp': { command: 'node' },
      }));

      const result = addMCPToIDE('existing-mcp', { command: 'python' });
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('already exists');
    });

    it('should fail if MCP exists in disabled section', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'guarded-mcp': { command: 'node' } } }
      ));

      const result = addMCPToIDE('guarded-mcp', { command: 'python' });
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('already exists');
      expect(result.message).toContain('guarded');
    });

    it('should add MCP with environment variables', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const result = addMCPToIDE('env-mcp', {
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'secret123', DEBUG: 'true' },
      });
      
      expect(result.success).toBe(true);
      
      // Verify the MCP was added with env
      const mcps = loadAllMCPServers();
      const envMcp = mcps.find(m => m.name === 'env-mcp');
      expect(envMcp).toBeDefined();
      expect(envMcp?.env).toEqual({ API_KEY: 'secret123', DEBUG: 'true' });
    });
  });

  describe('deleteMCPFromIDE', () => {
    it('should return failure when no config exists', () => {
      const result = deleteMCPFromIDE('test-mcp');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No IDE config file found');
    });

    it('should delete active MCP from config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'to-delete': { command: 'node', args: ['delete.js'] },
        'to-keep': { command: 'node', args: ['keep.js'] },
      }));

      const result = deleteMCPFromIDE('to-delete');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted to-delete');
      
      // Verify the MCP was deleted
      expect(getMCPStatus('to-delete')).toBe('not_found');
      expect(getMCPStatus('to-keep')).toBe('active');
    });

    it('should delete disabled MCP from config', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        { 'active-mcp': { command: 'node' } },
        { _mcpguard_disabled: { 'disabled-mcp': { command: 'node' } } }
      ));

      const result = deleteMCPFromIDE('disabled-mcp');
      
      expect(result.success).toBe(true);
      
      // Verify the MCP was deleted
      expect(getMCPStatus('disabled-mcp')).toBe('not_found');
      expect(getMCPStatus('active-mcp')).toBe('active');
    });

    it('should return failure for non-existent MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'existing-mcp': { command: 'node' },
      }));

      const result = deleteMCPFromIDE('nonexistent-mcp');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should clean up empty _mcpguard_disabled section after delete', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig(
        {},
        { _mcpguard_disabled: { 'only-disabled': { command: 'node' } } }
      ));

      deleteMCPFromIDE('only-disabled');
      
      // Verify the _mcpguard_disabled section was cleaned up
      const savedContent = getMockFileContent(cursorPath);
      const saved = JSON.parse(savedContent!);
      expect(saved._mcpguard_disabled).toBeUndefined();
    });

    it('should invalidate cache when deleting MCP', () => {
      const cursorPath = getTestConfigPath('cursor');
      const settingsPath = getSettingsPath();
      
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node' },
      }));
      addMockFile(settingsPath, JSON.stringify({
        enabled: true,
        defaults: {},
        mcpConfigs: [],
        tokenMetricsCache: {
          'test-mcp': { toolCount: 5, schemaChars: 1000, estimatedTokens: 286, assessedAt: '2024-01-01' },
        },
        assessmentErrorsCache: {
          'test-mcp': { type: 'auth_failed', message: 'Auth failed', errorAt: '2024-01-01' },
        },
      }));

      deleteMCPFromIDE('test-mcp');
      
      // Verify the cache was invalidated
      const savedSettings = getMockFileContent(settingsPath);
      const settings = JSON.parse(savedSettings!);
      expect(settings.tokenMetricsCache['test-mcp']).toBeUndefined();
      expect(settings.assessmentErrorsCache['test-mcp']).toBeUndefined();
    });
  });

  describe('Claude Code Integration', () => {
    it('should use correct Claude Code config path (~/.claude/mcp.json)', () => {
      // Verify the test helper returns the correct path
      const claudePath = getTestConfigPath('claude');
      expect(claudePath).toContain('.claude');
      expect(claudePath).toContain('mcp.json');
      // Should NOT use old Claude Desktop path
      expect(claudePath).not.toContain('claude_desktop_config');
      expect(claudePath).not.toContain('AppData');
      expect(claudePath).not.toContain('Application Support');
    });

    it('should load MCPs from Claude Code config with _mcpguard_disabled section', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig(
        {
          'active-claude-mcp': { command: 'node', args: ['active.js'] },
        },
        {
          _mcpguard_disabled: {
            'disabled-claude-mcp': { command: 'node', args: ['disabled.js'] },
          },
        }
      ));

      const mcps = loadAllMCPServers();
      
      // Should load both active and disabled MCPs
      expect(mcps).toHaveLength(2);
      
      const activeMcp = mcps.find(m => m.name === 'active-claude-mcp');
      const disabledMcp = mcps.find(m => m.name === 'disabled-claude-mcp');
      
      expect(activeMcp).toBeDefined();
      expect(activeMcp?.source).toBe('claude');
      expect(activeMcp?.enabled).toBe(true);
      
      expect(disabledMcp).toBeDefined();
      expect(disabledMcp?.source).toBe('claude');
      expect(disabledMcp?.enabled).toBe(false);
    });

    it('should load URL-based MCPs from Claude Code config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'url-mcp': {
          url: 'https://mcp.example.com/api',
          headers: { 'Authorization': 'Bearer token123' },
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0]).toMatchObject({
        name: 'url-mcp',
        url: 'https://mcp.example.com/api',
        headers: { 'Authorization': 'Bearer token123' },
        source: 'claude',
        enabled: true,
      });
    });

    it('should load MCPs with environment variables from Claude Code config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'env-mcp': {
          command: 'npx',
          args: ['@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: '${GITHUB_TOKEN}',
            DEBUG: 'true',
          },
        },
      }));

      const mcps = loadAllMCPServers();
      
      expect(mcps).toHaveLength(1);
      expect(mcps[0].env).toEqual({
        GITHUB_TOKEN: '${GITHUB_TOKEN}',
        DEBUG: 'true',
      });
    });

    it('should detect Claude Code config in getDetectedConfigs', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({}));

      const detected = getDetectedConfigs();
      
      const claudeConfig = detected.find(d => d.ide === 'claude');
      expect(claudeConfig).toBeDefined();
      expect(claudeConfig?.path).toBe(claudePath);
    });

    it('should prioritize Claude Code over Copilot when deduplicating MCPs', () => {
      const claudePath = getTestConfigPath('claude');
      const copilotPath = getTestConfigPath('copilot');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'shared-mcp': { command: 'claude-command' },
      }));
      addMockFile(copilotPath, createSampleMCPConfig({
        'shared-mcp': { command: 'copilot-command' },
      }));

      const mcps = loadAllMCPServers();
      
      // Claude should take priority
      expect(mcps).toHaveLength(1);
      expect(mcps[0].command).toBe('claude-command');
      expect(mcps[0].source).toBe('claude');
    });

    it('should disable and enable MCPs in Claude Code config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'test-mcp': { command: 'node', args: ['test.js'] },
      }));

      // Disable the MCP
      const disableResult = disableMCPInIDE('test-mcp');
      expect(disableResult.success).toBe(true);
      expect(isMCPDisabled('test-mcp')).toBe(true);

      // Enable the MCP
      const enableResult = enableMCPInIDE('test-mcp');
      expect(enableResult.success).toBe(true);
      expect(isMCPDisabled('test-mcp')).toBe(false);
    });

    it('should add new MCP to Claude Code config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({}));

      const result = addMCPToIDE('new-claude-mcp', {
        command: 'npx',
        args: ['@anthropic/mcp-server'],
        env: { API_KEY: 'secret' },
      });
      
      expect(result.success).toBe(true);
      
      // Verify the MCP was added
      const mcps = loadAllMCPServers();
      const newMcp = mcps.find(m => m.name === 'new-claude-mcp');
      expect(newMcp).toBeDefined();
      expect(newMcp?.command).toBe('npx');
    });

    it('should delete MCP from Claude Code config', () => {
      const claudePath = getTestConfigPath('claude');
      addMockFile(claudePath, createSampleMCPConfig({
        'to-delete': { command: 'node' },
        'to-keep': { command: 'python' },
      }));

      const result = deleteMCPFromIDE('to-delete');
      
      expect(result.success).toBe(true);
      expect(getMCPStatus('to-delete')).toBe('not_found');
      expect(getMCPStatus('to-keep')).toBe('active');
    });
  });

  describe('Priority Order (Claude > Cursor > Copilot)', () => {
    it('should prioritize Claude over Cursor when deduplicating MCPs', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'shared-mcp': { command: 'claude-command' },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({
        'shared-mcp': { command: 'cursor-command' },
      }));

      const mcps = loadAllMCPServers();
      
      // Claude should take priority over Cursor
      expect(mcps).toHaveLength(1);
      expect(mcps[0].command).toBe('claude-command');
      expect(mcps[0].source).toBe('claude');
    });

    it('should prioritize Cursor over Copilot when deduplicating MCPs', () => {
      const cursorPath = getTestConfigPath('cursor');
      const copilotPath = getTestConfigPath('copilot');
      
      addMockFile(cursorPath, createSampleMCPConfig({
        'shared-mcp': { command: 'cursor-command' },
      }));
      addMockFile(copilotPath, createSampleMCPConfig({
        'shared-mcp': { command: 'copilot-command' },
      }));

      const mcps = loadAllMCPServers();
      
      // Cursor should take priority over Copilot
      expect(mcps).toHaveLength(1);
      expect(mcps[0].command).toBe('cursor-command');
      expect(mcps[0].source).toBe('cursor');
    });

    it('should use Claude > Cursor > Copilot priority for getPrimaryIDEConfigPath', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      const copilotPath = getTestConfigPath('copilot');
      
      // Only Copilot exists -> should return Copilot
      addMockFile(copilotPath, createSampleMCPConfig({}));
      expect(getPrimaryIDEConfigPath()).toBe(copilotPath);
      
      // Add Cursor -> should now return Cursor
      addMockFile(cursorPath, createSampleMCPConfig({}));
      expect(getPrimaryIDEConfigPath()).toBe(cursorPath);
      
      // Add Claude -> should now return Claude
      addMockFile(claudePath, createSampleMCPConfig({}));
      expect(getPrimaryIDEConfigPath()).toBe(claudePath);
    });
  });

  describe('Source-based Config Modification', () => {
    it('should disable MCP in correct IDE config when source is specified', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'claude-mcp': { command: 'node', args: ['claude.js'] },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({
        'cursor-mcp': { command: 'node', args: ['cursor.js'] },
      }));

      // Disable cursor-mcp with source='cursor'
      const result = disableMCPInIDE('cursor-mcp', 'cursor');
      expect(result.success).toBe(true);
      
      // Verify it was disabled in cursor config
      const cursorConfig = JSON.parse(getMockFileContent(cursorPath)!);
      expect(cursorConfig.mcpServers['cursor-mcp']).toBeUndefined();
      expect(cursorConfig._mcpguard_disabled?.['cursor-mcp']).toBeDefined();
      
      // Verify claude config wasn't touched
      const claudeConfig = JSON.parse(getMockFileContent(claudePath)!);
      expect(claudeConfig.mcpServers['claude-mcp']).toBeDefined();
    });

    it('should enable MCP in correct IDE config when source is specified', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({}, {
        _mcpguard_disabled: {
          'claude-mcp': { command: 'node', args: ['claude.js'] },
        },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({}, {
        _mcpguard_disabled: {
          'cursor-mcp': { command: 'node', args: ['cursor.js'] },
        },
      }));

      // Enable cursor-mcp with source='cursor'
      const result = enableMCPInIDE('cursor-mcp', 'cursor');
      expect(result.success).toBe(true);
      
      // Verify it was enabled in cursor config
      const cursorConfig = JSON.parse(getMockFileContent(cursorPath)!);
      expect(cursorConfig.mcpServers['cursor-mcp']).toBeDefined();
      expect(cursorConfig._mcpguard_disabled?.['cursor-mcp']).toBeUndefined();
      
      // Verify claude config wasn't touched
      const claudeConfig = JSON.parse(getMockFileContent(claudePath)!);
      expect(claudeConfig._mcpguard_disabled?.['claude-mcp']).toBeDefined();
    });

    it('should delete MCP from correct IDE config when source is specified', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'claude-mcp': { command: 'node' },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({
        'cursor-mcp': { command: 'python' },
      }));

      // Delete cursor-mcp with source='cursor'
      const result = deleteMCPFromIDE('cursor-mcp', 'cursor');
      expect(result.success).toBe(true);
      
      // Verify it was deleted from cursor config
      const cursorConfig = JSON.parse(getMockFileContent(cursorPath)!);
      expect(cursorConfig.mcpServers['cursor-mcp']).toBeUndefined();
      
      // Verify claude config wasn't touched
      const claudeConfig = JSON.parse(getMockFileContent(claudePath)!);
      expect(claudeConfig.mcpServers['claude-mcp']).toBeDefined();
    });

    it('should fall back to primary IDE config when source is not specified', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({
        'test-mcp': { command: 'node' },
      }));
      addMockFile(cursorPath, createSampleMCPConfig({
        'other-mcp': { command: 'python' },
      }));

      // Disable without specifying source - should use primary (Claude)
      const result = disableMCPInIDE('test-mcp');
      expect(result.success).toBe(true);
      
      // Verify it was disabled in Claude config (primary)
      const claudeConfig = JSON.parse(getMockFileContent(claudePath)!);
      expect(claudeConfig.mcpServers['test-mcp']).toBeUndefined();
      expect(claudeConfig._mcpguard_disabled?.['test-mcp']).toBeDefined();
    });
  });
});
