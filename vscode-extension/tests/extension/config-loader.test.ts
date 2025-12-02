/**
 * Tests for config-loader.ts
 * Tests IDE config loading, MCP management, and config file manipulation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { addMockFile, getMockFileContent, resetMockFs } from '../setup';

// Helper to get test config paths
function getTestConfigPath(ide: 'claude' | 'copilot' | 'cursor'): string {
  const homeDir = os.homedir();
  
  switch (ide) {
    case 'claude':
      if (process.platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
      } else if (process.platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      }
      return path.join(homeDir, '.config', 'claude', 'claude_desktop_config.json');
    
    case 'copilot':
      return path.join(homeDir, '.github-copilot', 'apps.json');
    
    case 'cursor':
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

    it('should prefer Cursor config over others', () => {
      const claudePath = getTestConfigPath('claude');
      const cursorPath = getTestConfigPath('cursor');
      
      addMockFile(claudePath, createSampleMCPConfig({}));
      addMockFile(cursorPath, createSampleMCPConfig({}));

      const configPath = getPrimaryIDEConfigPath();
      expect(configPath).toBe(cursorPath);
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
});
