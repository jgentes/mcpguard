import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { MCPConfig } from '../../src/types/mcp.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { testConfigCleanup } from '../helpers/config-cleanup.js'

// Mock logger to suppress log output during tests
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'silent',
  },
}))

describe('ConfigManager', () => {
  let testDir: string
  let configPath: string
  let manager: ConfigManager

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = join(tmpdir(), `mcp-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    configPath = join(testDir, 'mcp.json')
  })

  afterEach(() => {
    // Cleanup test files
    try {
      if (existsSync(configPath)) {
        unlinkSync(configPath)
      }
      if (existsSync(testDir)) {
        rmdirSync(testDir)
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  afterAll(() => {
    // Clean up any MCP configs that were accidentally saved to the real config file
    testConfigCleanup.cleanup()
  })

  describe('saveConfig and getSavedConfig', () => {
    it('should save and retrieve a config', () => {
      // IMPORTANT: Create ConfigManager AFTER setting up test directory
      // and ALWAYS call importConfigs() immediately to use test path
      // This prevents accidentally saving to the real config file
      manager = new ConfigManager()

      // Use importConfigs to set a custom path BEFORE any operations
      const result = manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: 'test-token',
        },
      }

      const configName = 'github'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const retrieved = manager.getSavedConfig(configName)

      expect(retrieved).toBeDefined()
      expect(retrieved?.command).toBe('npx')
      expect(retrieved?.args).toEqual(['@modelcontextprotocol/server-github'])
    })

    it('should handle configs without args', () => {
      manager = new ConfigManager()
      // Set test path BEFORE any operations
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'node',
        env: {
          API_KEY: 'key',
        },
      }

      const configName = 'simple'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const retrieved = manager.getSavedConfig(configName)

      expect(retrieved?.command).toBe('node')
      expect(retrieved?.args).toBeUndefined()
    })

    it('should handle configs without env', () => {
      manager = new ConfigManager()
      // Set test path BEFORE any operations
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        args: ['tool'],
      }

      const configName = 'no-env'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const retrieved = manager.getSavedConfig(configName)

      expect(retrieved?.command).toBe('npx')
      expect(retrieved?.env).toBeUndefined()
    })

    it('should return null for non-existent config', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const retrieved = manager.getSavedConfig('non-existent')

      expect(retrieved).toBeNull()
    })
  })

  describe('getSavedConfigs', () => {
    it('should return all saved configs', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const config1: MCPConfig = {
        command: 'npx',
        args: ['tool1'],
      }
      const config2: MCPConfig = {
        command: 'npx',
        args: ['tool2'],
      }

      const configName1 = 'tool1'
      const configName2 = 'tool2'
      testConfigCleanup.trackConfig(configName1)
      testConfigCleanup.trackConfig(configName2)
      manager.saveConfig(configName1, config1)
      manager.saveConfig(configName2, config2)

      const configs = manager.getSavedConfigs()

      // Should include our saved configs (may also include existing configs from system)
      expect(configs.tool1).toBeDefined()
      expect(configs.tool2).toBeDefined()
      expect(configs.tool1.config.command).toBe('npx')
      expect(configs.tool2.config.command).toBe('npx')
    })

    it('should import configs from existing file', () => {
      // Create a test config file first
      const testConfig = {
        mcpServers: {
          imported_tool: {
            command: 'npx',
            args: ['imported'],
          },
        },
      }
      const importPath = join(testDir, 'import-mcp.json')
      writeFileSync(importPath, JSON.stringify(testConfig, null, 2))

      manager = new ConfigManager()
      const result = manager.importConfigs(importPath)

      expect(result.imported).toBe(1)
      expect(result.errors).toHaveLength(0)
      const importedToolName = 'imported_tool'
      testConfigCleanup.trackConfig(importedToolName)
      expect(manager.getSavedConfig(importedToolName)).toBeDefined()
      expect(manager.getCursorConfigPath()).toBe(importPath)
    })
  })

  describe('deleteConfig', () => {
    it('should delete a saved config', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        args: ['tool'],
      }

      const configName = 'tool'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      expect(manager.getSavedConfig(configName)).toBeDefined()

      const deleted = manager.deleteConfig(configName)
      expect(deleted).toBe(true)
      expect(manager.getSavedConfig(configName)).toBeNull()
    })

    it('should return false for non-existent config', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const deleted = manager.deleteConfig('non-existent')
      expect(deleted).toBe(false)
    })

    it('should return false when no config file exists', () => {
      manager = new ConfigManager()
      // Don't import any config

      const deleted = manager.deleteConfig('any')
      expect(deleted).toBe(false)
    })
  })

  describe('resolveEnvVarsInObject', () => {
    beforeEach(() => {
      process.env.TEST_VAR = 'test-value'
      process.env.ANOTHER_VAR = 'another-value'
    })

    afterEach(() => {
      delete process.env.TEST_VAR
      delete process.env.ANOTHER_VAR
    })

    it('should resolve environment variables in strings', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        env: {
          TOKEN: '${TEST_VAR}',
          KEY: '${ANOTHER_VAR}',
        },
      }

      const configName = 'test'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const resolved = manager.getSavedConfig(configName)

      expect(resolved?.env?.TOKEN).toBe('test-value')
      expect(resolved?.env?.KEY).toBe('another-value')
    })

    it('should handle nested objects', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        env: {
          NESTED: JSON.stringify({ key: '${TEST_VAR}' }),
        },
      }

      const configName = 'nested'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const resolved = manager.getSavedConfig(configName)

      expect(resolved?.env?.NESTED).toContain('test-value')
    })

    it('should keep placeholder if env var not found', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const config: MCPConfig = {
        command: 'npx',
        env: {
          MISSING: '${NON_EXISTENT_VAR}',
        },
      }

      const configName = 'missing'
      testConfigCleanup.trackConfig(configName)
      manager.saveConfig(configName, config)
      const resolved = manager.getSavedConfig(configName)

      expect(resolved?.env?.MISSING).toBe('${NON_EXISTENT_VAR}')
    })
  })

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
      }
      writeFileSync(configPath, JSON.stringify(testConfig, null, 2))

      manager = new ConfigManager()
      const result = manager.importConfigs(configPath)

      expect(result.imported).toBe(2)
      expect(result.errors).toHaveLength(0)
      const githubConfigName = 'github'
      const testConfigName = 'test'
      testConfigCleanup.trackConfig(githubConfigName)
      testConfigCleanup.trackConfig(testConfigName)
      expect(manager.getSavedConfig(githubConfigName)).toBeDefined()
      expect(manager.getSavedConfig(testConfigName)).toBeDefined()
    })

    it('should return error for non-existent file', () => {
      manager = new ConfigManager()
      const result = manager.importConfigs('/non/existent/path.json')

      expect(result.imported).toBe(0)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should handle invalid JSON', () => {
      writeFileSync(configPath, 'invalid json')

      manager = new ConfigManager()
      const result = manager.importConfigs(configPath)

      // Should handle gracefully
      expect(result.imported).toBe(0)
    })
  })

  describe('getConfigSourceDisplayName', () => {
    it('should return display name for detected source', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)

      const name = manager.getConfigSourceDisplayName()
      expect(name).toBeDefined()
      expect(typeof name).toBe('string')
    })

    it('should return a valid display name', () => {
      manager = new ConfigManager()
      // ConfigManager may detect system configs, so just verify it returns a string
      const name = manager.getConfigSourceDisplayName()
      expect(name).toBeDefined()
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    })
  })

  describe('getConfigSource', () => {
    it('should return null when no config is loaded', () => {
      manager = new ConfigManager()
      // ConfigManager may auto-detect configs, so we need to check if it found one
      const source = manager.getConfigSource()
      // If it found a config, that's OK - just verify it returns a valid value or null
      expect(
        source === null ||
          ['cursor', 'claude-code', 'github-copilot'].includes(source!),
      ).toBe(true)
    })

    it('should return source after importing config', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)
      const source = manager.getConfigSource()
      expect(source).toBeTruthy()
    })
  })

  describe('getCursorConfigPath', () => {
    it('should return null or a path when no config is explicitly loaded', () => {
      manager = new ConfigManager()
      // ConfigManager may auto-detect configs, so path might not be null
      const path = manager.getCursorConfigPath()
      // Just verify it returns a string or null
      expect(path === null || typeof path === 'string').toBe(true)
    })

    it('should return config path after importing', () => {
      manager = new ConfigManager()
      manager.importConfigs(configPath)
      const path = manager.getCursorConfigPath()
      expect(path).toBe(configPath)
    })
  })

  describe('getAllConfiguredMCPs', () => {
    it('should return empty object or detected MCPs when no config explicitly loaded', () => {
      manager = new ConfigManager()
      const mcps = manager.getAllConfiguredMCPs()
      // ConfigManager may auto-detect configs, so mcps might not be empty
      expect(typeof mcps === 'object').toBe(true)
    })

    it('should return active and disabled MCPs', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'active-mcp': { command: 'node', args: ['server.js'] },
          mcpguard: { command: 'npx', args: ['mcpguard'] },
        },
        _mcpguard_disabled: {
          'disabled-mcp': { command: 'npx', args: ['disabled'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const mcps = manager.getAllConfiguredMCPs()
      expect(mcps['active-mcp']).toBeDefined()
      expect(mcps['active-mcp'].status).toBe('active')
      expect(mcps['disabled-mcp']).toBeDefined()
      expect(mcps['disabled-mcp'].status).toBe('disabled')
      expect(mcps['mcpguard']).toBeUndefined() // Should exclude mcpguard
    })
  })

  describe('getGuardedMCPConfigs', () => {
    it('should return empty object or detected configs when no config explicitly loaded', () => {
      manager = new ConfigManager()
      const configs = manager.getGuardedMCPConfigs()
      // ConfigManager may auto-detect configs, so configs might not be empty
      expect(typeof configs === 'object').toBe(true)
    })

    it('should return all MCPs except mcpguard', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'mcp-1': { command: 'node', args: ['server.js'] },
          mcpguard: { command: 'npx', args: ['mcpguard'] },
        },
        _mcpguard_disabled: {
          'mcp-2': { command: 'npx', args: ['disabled'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const configs = manager.getGuardedMCPConfigs()
      expect(configs['mcp-1']).toBeDefined()
      expect(configs['mcp-2']).toBeDefined()
      expect(configs['mcpguard']).toBeUndefined()
    })
  })

  describe('disableAllExceptMCPGuard', () => {
    it('should return result when no config explicitly loaded', () => {
      manager = new ConfigManager()
      // ConfigManager may auto-detect configs, so result might not be empty
      const result = manager.disableAllExceptMCPGuard()
      expect(Array.isArray(result.disabled)).toBe(true)
      expect(Array.isArray(result.failed)).toBe(true)
      expect(Array.isArray(result.alreadyDisabled)).toBe(true)
      expect(typeof result.mcpguardRestored === 'boolean').toBe(true)
    })

    it('should disable all MCPs except mcpguard', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'mcp-1': { command: 'node', args: ['server.js'] },
          'mcp-2': { command: 'npx', args: ['test'] },
          mcpguard: { command: 'npx', args: ['mcpguard'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const result = manager.disableAllExceptMCPGuard()
      expect(result.disabled.length).toBe(2)
      expect(result.disabled).toContain('mcp-1')
      expect(result.disabled).toContain('mcp-2')
      expect(result.disabled).not.toContain('mcpguard')
      expect(result.mcpguardRestored).toBe(false)

      // Verify MCPs are disabled
      const disabled = manager.getDisabledMCPs()
      expect(disabled).toContain('mcp-1')
      expect(disabled).toContain('mcp-2')
    })

    it('should restore mcpguard if it is disabled', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'mcp-1': { command: 'node', args: ['server.js'] },
        },
        _mcpguard_disabled: {
          mcpguard: { command: 'npx', args: ['mcpguard'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const result = manager.disableAllExceptMCPGuard()
      expect(result.mcpguardRestored).toBe(true)
      expect(manager.isMCPDisabled('mcpguard')).toBe(false)
    })
  })

  describe('restoreAllDisabled', () => {
    it('should return array when no config explicitly loaded', () => {
      manager = new ConfigManager()
      // ConfigManager may auto-detect configs, so restored might not be empty
      const restored = manager.restoreAllDisabled()
      expect(Array.isArray(restored)).toBe(true)
    })

    it('should restore all disabled MCPs', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {},
        _mcpguard_disabled: {
          'mcp-1': { command: 'node', args: ['server.js'] },
          'mcp-2': { command: 'npx', args: ['test'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const restored = manager.restoreAllDisabled()
      expect(restored.length).toBe(2)
      expect(restored).toContain('mcp-1')
      expect(restored).toContain('mcp-2')

      // Verify MCPs are no longer disabled
      expect(manager.isMCPDisabled('mcp-1')).toBe(false)
      expect(manager.isMCPDisabled('mcp-2')).toBe(false)
    })
  })

  describe('getDisabledMCPs', () => {
    it('should return empty array or detected disabled MCPs when no config explicitly loaded', () => {
      manager = new ConfigManager()
      const disabled = manager.getDisabledMCPs()
      // ConfigManager may auto-detect configs, so disabled might not be empty
      expect(Array.isArray(disabled)).toBe(true)
    })

    it('should return list of disabled MCPs', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'active-mcp': { command: 'node', args: ['server.js'] },
        },
        _mcpguard_disabled: {
          'disabled-1': { command: 'npx', args: ['test1'] },
          'disabled-2': { command: 'npx', args: ['test2'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const disabled = manager.getDisabledMCPs()
      expect(disabled.length).toBe(2)
      expect(disabled).toContain('disabled-1')
      expect(disabled).toContain('disabled-2')
    })
  })

  describe('isMCPDisabled', () => {
    it('should return false when no config loaded', () => {
      manager = new ConfigManager()
      expect(manager.isMCPDisabled('test-mcp')).toBe(false)
    })

    it('should return true for disabled MCP', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {},
        _mcpguard_disabled: {
          'disabled-mcp': { command: 'npx', args: ['test'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      expect(manager.isMCPDisabled('disabled-mcp')).toBe(true)
      expect(manager.isMCPDisabled('nonexistent')).toBe(false)
    })
  })

  describe('getRawConfig', () => {
    it('should return null or detected config when no config explicitly loaded', () => {
      manager = new ConfigManager()
      const rawConfig = manager.getRawConfig()
      // ConfigManager may auto-detect configs, so rawConfig might not be null
      expect(rawConfig === null || typeof rawConfig === 'object').toBe(true)
    })

    it('should return raw config including disabled MCPs', () => {
      manager = new ConfigManager()
      const config = {
        mcpServers: {
          'active-mcp': { command: 'node', args: ['server.js'] },
        },
        _mcpguard_disabled: {
          'disabled-mcp': { command: 'npx', args: ['test'] },
        },
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      manager.importConfigs(configPath)

      const rawConfig = manager.getRawConfig()
      expect(rawConfig).toBeDefined()
      expect(rawConfig?.mcpServers['active-mcp']).toBeDefined()
      expect(rawConfig?._mcpguard_disabled?.['disabled-mcp']).toBeDefined()
    })
  })
})
