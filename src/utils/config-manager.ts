import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseJSONC } from 'jsonc-parser'
import type { MCPConfig } from '../types/mcp.js'
import logger from './logger.js'

/**
 * Standard MCP configuration file format (matches Cursor/Claude Desktop format)
 * MCP configs can be either command-based (command/args) or url-based (url/headers)
 */
export interface MCPServersConfig {
  mcpServers: Record<string, unknown> // Use unknown to allow both command-based and url-based configs
  // MCPGuard metadata: stores disabled MCPs that should be guarded
  _mcpguard_disabled?: Record<string, unknown>
  _mcpguard_metadata?: {
    version?: string
    disabled_at?: string
  }
  // Transparent proxy configuration
  _mcpguard?: {
    mode?: 'transparent-proxy' | 'manual' | 'auto-detect'
    auto_guard_new?: boolean
    namespace_tools?: boolean
  }
}

/**
 * IDE configuration definition
 */
interface IDEDefinition {
  id: 'claude-code' | 'cursor' | 'github-copilot'
  displayName: string
  priority: number // Lower number = higher priority
  paths: {
    windows: string[]
    macos: string[]
    linux: string[]
    default: string // Default path to create if none exists
  }
}

/**
 * Configuration manager for MCP server configurations
 * Uses standard MCP configuration format (Cursor/Claude Desktop format)
 * Auto-detects IDE (Claude Code, Cursor, or GitHub Copilot) and uses the appropriate config file
 * Resolves environment variables from .env file
 */
export class ConfigManager {
  private configPath: string | null = null
  private configSource: 'cursor' | 'claude-code' | 'github-copilot' | null =
    null

  // IDE definitions - ordered by priority (lower = higher priority)
  private readonly ideDefinitions: IDEDefinition[] = [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      priority: 1,
      paths: {
        windows: [
          join(homedir(), '.claude', 'mcp.json'),
          join(homedir(), '.claude', 'mcp.jsonc'),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        macos: [
          join(homedir(), '.claude', 'mcp.json'),
          join(homedir(), '.claude', 'mcp.jsonc'),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        linux: [
          join(homedir(), '.claude', 'mcp.json'),
          join(homedir(), '.claude', 'mcp.jsonc'),
          join(
            homedir(),
            '.config',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            '.config',
            'Claude Code',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        default: join(homedir(), '.claude', 'mcp.jsonc'),
      },
    },
    {
      id: 'github-copilot',
      displayName: 'GitHub Copilot',
      priority: 2,
      paths: {
        windows: [
          join(homedir(), '.github', 'copilot', 'mcp.json'),
          join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.json',
          ),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.jsonc',
          ),
          join(homedir(), 'AppData', 'Roaming', 'GitHub Copilot', 'mcp.json'),
          join(homedir(), 'AppData', 'Roaming', 'GitHub Copilot', 'mcp.jsonc'),
        ],
        macos: [
          join(homedir(), '.github', 'copilot', 'mcp.json'),
          join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.json',
          ),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.jsonc',
          ),
          join(
            homedir(),
            'Library',
            'Application Support',
            'GitHub Copilot',
            'mcp.json',
          ),
          join(
            homedir(),
            'Library',
            'Application Support',
            'GitHub Copilot',
            'mcp.jsonc',
          ),
        ],
        linux: [
          join(homedir(), '.github', 'copilot', 'mcp.json'),
          join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
          join(
            homedir(),
            '.config',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.json',
          ),
          join(
            homedir(),
            '.config',
            'Code',
            'User',
            'globalStorage',
            'github.copilot',
            'mcp.jsonc',
          ),
          join(homedir(), '.config', 'GitHub Copilot', 'mcp.json'),
          join(homedir(), '.config', 'GitHub Copilot', 'mcp.jsonc'),
        ],
        default: join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
      },
    },
    {
      id: 'cursor',
      displayName: 'Cursor',
      priority: 3,
      paths: {
        windows: [
          join(homedir(), '.cursor', 'mcp.json'),
          join(homedir(), '.cursor', 'mcp.jsonc'),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            'AppData',
            'Roaming',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        macos: [
          join(homedir(), '.cursor', 'mcp.json'),
          join(homedir(), '.cursor', 'mcp.jsonc'),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        linux: [
          join(homedir(), '.cursor', 'mcp.json'),
          join(homedir(), '.cursor', 'mcp.jsonc'),
          join(
            homedir(),
            '.config',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.json',
          ),
          join(
            homedir(),
            '.config',
            'Cursor',
            'User',
            'globalStorage',
            'mcp.jsonc',
          ),
        ],
        default: join(homedir(), '.cursor', 'mcp.jsonc'),
      },
    },
  ]

  constructor() {
    // Find config file in standard locations (checks IDEs in priority order)
    const result = this.findConfigFile()
    this.configPath = result.path
    this.configSource = result.source
  }

  /**
   * Get platform-specific paths for an IDE
   */
  private getPlatformPaths(ide: IDEDefinition): string[] {
    const platform = process.platform
    if (platform === 'win32') {
      return ide.paths.windows
    } else if (platform === 'darwin') {
      return ide.paths.macos
    } else {
      return ide.paths.linux
    }
  }

  /**
   * Find MCP configuration file in standard locations
   * Checks IDEs in priority order (lower priority number = checked first)
   */
  private findConfigFile(): {
    path: string | null
    source: 'cursor' | 'claude-code' | 'github-copilot' | null
  } {
    // Sort by priority (lower number = higher priority)
    const sortedIDEs = [...this.ideDefinitions].sort(
      (a, b) => a.priority - b.priority,
    )

    for (const ide of sortedIDEs) {
      const paths = this.getPlatformPaths(ide)
      for (const path of paths) {
        if (existsSync(path)) {
          logger.info(
            { path, ide: ide.id },
            `Found ${ide.displayName} MCP config file`,
          )
          return { path, source: ide.id }
        }
      }
    }

    logger.warn(
      'MCP config file not found in standard locations for any supported IDE',
    )
    return { path: null, source: null }
  }

  /**
   * Resolve environment variables in a string
   * Supports ${VAR_NAME} syntax, resolves from process.env
   */
  private resolveEnvVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = process.env[varName]
      if (envValue === undefined) {
        logger.warn(
          { varName },
          `Environment variable ${varName} not found, keeping placeholder`,
        )
        return match // Keep original if not found
      }
      return envValue
    })
  }

  /**
   * Recursively resolve environment variables in an object
   * Public method for resolving env vars in MCP configs
   */
  resolveEnvVarsInObject(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.resolveEnvVars(obj)
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveEnvVarsInObject(item))
    }

    if (obj && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvVarsInObject(value)
      }
      return resolved
    }

    return obj
  }

  /**
   * Read and parse a JSONC config file
   */
  private readConfigFile(filePath: string): MCPServersConfig | null {
    if (!existsSync(filePath)) {
      return null
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const config = parseJSONC(content) as MCPServersConfig

      if (!config || typeof config !== 'object') {
        logger.warn({ filePath }, 'Invalid config file format')
        return null
      }

      // Ensure mcpServers exists
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        config.mcpServers = {}
      }

      // Filter out disabled MCPs from active config (they're stored in _mcpguard_disabled)
      // This ensures disabled MCPs don't appear in getSavedConfigs()
      const activeConfig: MCPServersConfig = {
        mcpServers: {},
        _mcpguard_disabled: config._mcpguard_disabled,
        _mcpguard_metadata: config._mcpguard_metadata,
      }

      // Only include MCPs that are not disabled
      for (const [name, mcpConfig] of Object.entries(config.mcpServers)) {
        // Skip if this MCP is in the disabled list
        if (config._mcpguard_disabled?.[name]) {
          continue
        }
        activeConfig.mcpServers[name] = mcpConfig
      }

      return activeConfig
    } catch (error: unknown) {
      logger.error({ error, filePath }, 'Failed to read config file')
      return null
    }
  }

  /**
   * Read raw config file without filtering disabled MCPs
   * Used internally for disable/enable operations
   */
  private readRawConfigFile(filePath: string): MCPServersConfig | null {
    if (!existsSync(filePath)) {
      return null
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const config = parseJSONC(content) as MCPServersConfig

      if (!config || typeof config !== 'object') {
        logger.warn({ filePath }, 'Invalid config file format')
        return null
      }

      // Ensure mcpServers exists
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        config.mcpServers = {}
      }

      return config
    } catch (error: unknown) {
      logger.error({ error, filePath }, 'Failed to read config file')
      return null
    }
  }

  /**
   * Write a JSONC config file
   */
  private writeConfigFile(filePath: string, config: MCPServersConfig): void {
    try {
      // Ensure directory exists
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Format as JSON with comments preserved (JSONC)
      const content = JSON.stringify(config, null, 2)
      writeFileSync(filePath, content, 'utf-8')

      // Logging is handled by the caller (saveConfig, deleteConfig, etc.)
    } catch (error: unknown) {
      logger.error({ error, filePath }, 'Failed to write config file')
      throw error
    }
  }

  /**
   * Get all saved MCP configurations from the detected config file
   * Excludes disabled MCPs (they're stored in _mcpguard_disabled)
   * Returns configs as-is (supports both command-based and url-based)
   */
  getSavedConfigs(): Record<
    string,
    { config: MCPConfig; source: 'cursor' | 'claude-code' | 'github-copilot' }
  > {
    const configs: Record<
      string,
      { config: MCPConfig; source: 'cursor' | 'claude-code' | 'github-copilot' }
    > = {}

    if (!this.configPath || !this.configSource) {
      return configs
    }

    // readConfigFile already filters out disabled MCPs
    const fileConfig = this.readConfigFile(this.configPath)
    if (fileConfig) {
      for (const [name, config] of Object.entries(fileConfig.mcpServers)) {
        // Cast to MCPConfig (supports both command-based and url-based)
        configs[name] = {
          config: config as MCPConfig,
          source: this.configSource,
        }
      }
    }

    return configs
  }

  /**
   * Get a saved MCP configuration by name
   * Returns config as-is (supports both command-based and url-based)
   */
  getSavedConfig(mcpName: string): MCPConfig | null {
    const saved = this.getSavedConfigs()
    const entry = saved[mcpName]
    if (!entry) {
      return null
    }

    // Resolve environment variables before returning
    return this.resolveEnvVarsInObject(entry.config) as MCPConfig
  }

  /**
   * Save an MCP configuration to the detected config file
   * @param mcpName Name of the MCP server
   * @param config MCP configuration
   */
  saveConfig(mcpName: string, config: MCPConfig): void {
    if (!this.configPath) {
      // If no config exists, try to detect which IDE to use
      // Check IDEs in priority order
      const sortedIDEs = [...this.ideDefinitions].sort(
        (a, b) => a.priority - b.priority,
      )

      let foundIDE: IDEDefinition | null = null
      for (const ide of sortedIDEs) {
        // Check if any of the IDE's default directory exists
        const defaultDir = dirname(ide.paths.default)
        if (existsSync(defaultDir)) {
          foundIDE = ide
          break
        }
      }

      // Use highest priority IDE if found, otherwise default to Claude Code
      const ideToUse = foundIDE || sortedIDEs[0]
      const defaultPath = ideToUse.paths.default
      const dir = dirname(defaultPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      this.configPath = defaultPath
      this.configSource = ideToUse.id
    }

    const existingConfig = this.readConfigFile(this.configPath) || {
      mcpServers: {},
    }

    // Store config with environment variable placeholders (don't resolve when saving)
    existingConfig.mcpServers[mcpName] = config

    this.writeConfigFile(this.configPath, existingConfig)

    const ide = this.ideDefinitions.find((d) => d.id === this.configSource)
    const sourceName = ide ? ide.displayName : 'IDE'
    logger.info(
      { mcpName, configPath: this.configPath, source: this.configSource },
      `MCP config saved to ${sourceName} config file`,
    )
  }

  /**
   * Delete an MCP configuration from the detected config file
   * @param mcpName Name of the MCP server
   */
  deleteConfig(mcpName: string): boolean {
    if (!this.configPath) {
      return false
    }

    const existingConfig = this.readConfigFile(this.configPath)

    if (!existingConfig || !existingConfig.mcpServers[mcpName]) {
      return false
    }

    delete existingConfig.mcpServers[mcpName]
    this.writeConfigFile(this.configPath, existingConfig)

    const ide = this.ideDefinitions.find((d) => d.id === this.configSource)
    const sourceName = ide ? ide.displayName : 'IDE'
    logger.info(
      { mcpName, configPath: this.configPath, source: this.configSource },
      `MCP config deleted from ${sourceName} config file`,
    )
    return true
  }

  /**
   * Import/refresh MCP configurations from the config file
   * This reloads the config file location in case it was created or moved
   */
  importConfigs(configPath?: string): { imported: number; errors: string[] } {
    const errors: string[] = []
    let imported = 0

    // If a specific path is provided, use it
    if (configPath) {
      if (existsSync(configPath)) {
        this.configPath = configPath
        // Try to detect source from path
        const detectedIDE = this.ideDefinitions.find(
          (ide) =>
            configPath.toLowerCase().includes(ide.id.replace('-', '')) ||
            configPath
              .toLowerCase()
              .includes(ide.displayName.toLowerCase().replace(/\s+/g, '')),
        )
        if (detectedIDE) {
          this.configSource = detectedIDE.id
        }
        const config = this.readConfigFile(configPath)
        if (config) {
          imported = Object.keys(config.mcpServers).length
          const ide = this.ideDefinitions.find(
            (d) => d.id === this.configSource,
          )
          const sourceName = ide ? ide.displayName : 'IDE'
          logger.info(
            { path: configPath, imported, source: this.configSource },
            `Loaded ${sourceName} configs from specified path`,
          )
        }
      } else {
        errors.push(`Config file not found: ${configPath}`)
      }
    } else {
      // Refresh the config file location
      const result = this.findConfigFile()
      this.configPath = result.path
      this.configSource = result.source
      if (this.configPath) {
        const config = this.readConfigFile(this.configPath)
        if (config) {
          imported = Object.keys(config.mcpServers).length
          const ide = this.ideDefinitions.find(
            (d) => d.id === this.configSource,
          )
          const sourceName = ide ? ide.displayName : 'IDE'
          logger.info(
            { path: this.configPath, imported, source: this.configSource },
            `Refreshed ${sourceName} configs`,
          )
        }
      } else {
        const ideNames = this.ideDefinitions
          .map((d) => d.displayName)
          .join(', ')
        errors.push(
          `MCP config file not found in standard locations for ${ideNames}`,
        )
      }
    }

    return { imported, errors }
  }

  /**
   * Get the path to the config file (Cursor or Claude Code)
   */
  getCursorConfigPath(): string | null {
    return this.configPath
  }

  /**
   * Get the source of the config file
   */
  getConfigSource(): 'cursor' | 'claude-code' | 'github-copilot' | null {
    return this.configSource
  }

  /**
   * Get the display name for the current config source
   */
  getConfigSourceDisplayName(): string {
    if (!this.configSource) {
      return 'IDE'
    }
    const ide = this.ideDefinitions.find((d) => d.id === this.configSource)
    return ide ? ide.displayName : 'IDE'
  }

  /**
   * Get all configured MCPs (including disabled ones) for transparent proxy discovery
   * Returns all MCPs with their status (active or disabled)
   * Excludes mcpguard itself
   */
  getAllConfiguredMCPs(): Record<
    string,
    {
      config: MCPConfig
      source: 'cursor' | 'claude-code' | 'github-copilot'
      status: 'active' | 'disabled'
    }
  > {
    const allMCPs: Record<
      string,
      {
        config: MCPConfig
        source: 'cursor' | 'claude-code' | 'github-copilot'
        status: 'active' | 'disabled'
      }
    > = {}

    if (!this.configPath || !this.configSource) {
      return allMCPs
    }

    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig) {
      return allMCPs
    }

    // Include active MCPs (except mcpguard)
    for (const [name, config] of Object.entries(rawConfig.mcpServers || {})) {
      if (name.toLowerCase() !== 'mcpguard' && config) {
        allMCPs[name] = {
          config: config as MCPConfig,
          source: this.configSource,
          status: 'active',
        }
      }
    }

    // Include disabled MCPs (except mcpguard)
    for (const [name, config] of Object.entries(
      rawConfig._mcpguard_disabled || {},
    )) {
      if (name.toLowerCase() !== 'mcpguard' && config) {
        allMCPs[name] = {
          config: config as MCPConfig,
          source: this.configSource,
          status: 'disabled',
        }
      }
    }

    return allMCPs
  }

  /**
   * Get all MCP configurations excluding mcpguard itself
   * Used for discovery and transparency - shows what MCPs are configured
   * (including disabled ones) but should be accessed through MCPGuard
   */
  getGuardedMCPConfigs(): Record<
    string,
    { config: MCPConfig; source: 'cursor' | 'claude-code' | 'github-copilot' }
  > {
    const guardedConfigs: Record<
      string,
      { config: MCPConfig; source: 'cursor' | 'claude-code' | 'github-copilot' }
    > = {}

    if (!this.configPath || !this.configSource) {
      return guardedConfigs
    }

    // Read raw config to include disabled MCPs for transparency
    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig) {
      return guardedConfigs
    }

    // Include active MCPs (except mcpguard)
    for (const [name, config] of Object.entries(rawConfig.mcpServers || {})) {
      if (name.toLowerCase() !== 'mcpguard' && config) {
        // Cast to MCPConfig (supports both command-based and url-based)
        guardedConfigs[name] = {
          config: config as MCPConfig,
          source: this.configSource,
        }
      }
    }

    // Include disabled MCPs (except mcpguard) for transparency
    for (const [name, config] of Object.entries(
      rawConfig._mcpguard_disabled || {},
    )) {
      if (name.toLowerCase() !== 'mcpguard' && config) {
        // Cast to MCPConfig (supports both command-based and url-based)
        guardedConfigs[name] = {
          config: config as MCPConfig,
          source: this.configSource,
        }
      }
    }

    return guardedConfigs
  }

  /**
   * Disable an MCP server by moving it to the disabled section
   * This prevents the IDE from loading it directly, ensuring MCPGuard is used instead
   * @param mcpName Name of the MCP server to disable
   * @returns true if the MCP was disabled, false if it wasn't found or already disabled
   */
  disableMCP(mcpName: string): boolean {
    if (!this.configPath) {
      logger.warn('No config file found, cannot disable MCP')
      return false
    }

    // Read raw config (including disabled MCPs)
    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig) {
      return false
    }

    // Check if MCP exists and is not already disabled
    if (!rawConfig.mcpServers[mcpName]) {
      // Check if it's already disabled
      if (rawConfig._mcpguard_disabled?.[mcpName]) {
        logger.info({ mcpName }, 'MCP is already disabled')
        return false
      }
      logger.warn({ mcpName }, 'MCP not found in config')
      return false
    }

    // Move MCP to disabled section
    const mcpConfig = rawConfig.mcpServers[mcpName]
    delete rawConfig.mcpServers[mcpName]

    // Initialize disabled section if needed
    if (!rawConfig._mcpguard_disabled) {
      rawConfig._mcpguard_disabled = {}
    }
    rawConfig._mcpguard_disabled[mcpName] = mcpConfig

    // Initialize metadata if needed
    if (!rawConfig._mcpguard_metadata) {
      rawConfig._mcpguard_metadata = {}
    }
    rawConfig._mcpguard_metadata.disabled_at = new Date().toISOString()

    this.writeConfigFile(this.configPath, rawConfig)

    const ide = this.ideDefinitions.find((d) => d.id === this.configSource)
    const sourceName = ide ? ide.displayName : 'IDE'
    logger.info(
      { mcpName, configPath: this.configPath, source: this.configSource },
      `MCP disabled in ${sourceName} config file (moved to _mcpguard_disabled)`,
    )

    return true
  }

  /**
   * Enable a previously disabled MCP server by moving it back to active config
   * @param mcpName Name of the MCP server to enable
   * @returns true if the MCP was enabled, false if it wasn't found in disabled list
   */
  enableMCP(mcpName: string): boolean {
    if (!this.configPath) {
      logger.warn('No config file found, cannot enable MCP')
      return false
    }

    // Read raw config (including disabled MCPs)
    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig) {
      return false
    }

    // Check if MCP is in disabled list
    if (!rawConfig._mcpguard_disabled?.[mcpName]) {
      logger.warn({ mcpName }, 'MCP not found in disabled list')
      return false
    }

    // Move MCP back to active config
    const mcpConfig = rawConfig._mcpguard_disabled[mcpName]
    delete rawConfig._mcpguard_disabled[mcpName]

    // Ensure mcpServers exists
    if (!rawConfig.mcpServers) {
      rawConfig.mcpServers = {}
    }
    rawConfig.mcpServers[mcpName] = mcpConfig

    // Clean up disabled section if empty
    if (
      rawConfig._mcpguard_disabled &&
      Object.keys(rawConfig._mcpguard_disabled).length === 0
    ) {
      delete rawConfig._mcpguard_disabled
    }

    this.writeConfigFile(this.configPath, rawConfig)

    const ide = this.ideDefinitions.find((d) => d.id === this.configSource)
    const sourceName = ide ? ide.displayName : 'IDE'
    logger.info(
      { mcpName, configPath: this.configPath, source: this.configSource },
      `MCP enabled in ${sourceName} config file (moved from _mcpguard_disabled)`,
    )

    return true
  }

  /**
   * Disable all MCPs except mcpguard
   * Used during setup to ensure only MCPGuard is accessible
   * Also ensures mcpguard is in the config (if it exists in disabled, moves it to active)
   * @returns Object with results
   */
  disableAllExceptMCPGuard(): {
    disabled: string[]
    failed: string[]
    alreadyDisabled: string[]
    mcpguardRestored: boolean
  } {
    const result = {
      disabled: [] as string[],
      failed: [] as string[],
      alreadyDisabled: [] as string[],
      mcpguardRestored: false,
    }

    if (!this.configPath) {
      return result
    }

    // Read raw config to see all MCPs
    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig || !rawConfig.mcpServers) {
      return result
    }

    // If mcpguard is disabled, restore it first (but don't count it in results)
    if (rawConfig._mcpguard_disabled?.['mcpguard']) {
      this.enableMCP('mcpguard')
      result.mcpguardRestored = true
    }

    // Disable all MCPs except mcpguard
    for (const [mcpName] of Object.entries(rawConfig.mcpServers)) {
      if (mcpName.toLowerCase() === 'mcpguard') {
        continue // Skip mcpguard
      }

      // Check if already disabled
      if (rawConfig._mcpguard_disabled?.[mcpName]) {
        result.alreadyDisabled.push(mcpName)
      } else if (this.disableMCP(mcpName)) {
        result.disabled.push(mcpName)
      } else {
        result.failed.push(mcpName)
      }
    }

    return result
  }

  /**
   * Restore all disabled MCPs back to active config
   * @returns Array of restored MCP names
   */
  restoreAllDisabled(): string[] {
    const restored: string[] = []

    if (!this.configPath) {
      return restored
    }

    // Read raw config
    const rawConfig = this.readRawConfigFile(this.configPath)
    if (!rawConfig || !rawConfig._mcpguard_disabled) {
      return restored
    }

    // Restore all disabled MCPs
    for (const [mcpName] of Object.entries(rawConfig._mcpguard_disabled)) {
      if (this.enableMCP(mcpName)) {
        restored.push(mcpName)
      }
    }

    return restored
  }

  /**
   * Get list of disabled MCPs
   * @returns Array of disabled MCP names
   */
  getDisabledMCPs(): string[] {
    if (!this.configPath) {
      return []
    }

    // Read raw config to see disabled MCPs
    const rawConfig = this.readConfigFile(this.configPath)
    if (!rawConfig || !rawConfig._mcpguard_disabled) {
      return []
    }

    return Object.keys(rawConfig._mcpguard_disabled)
  }

  /**
   * Check if an MCP is disabled
   * @param mcpName Name of the MCP server to check
   * @returns true if the MCP is disabled
   */
  isMCPDisabled(mcpName: string): boolean {
    return this.getDisabledMCPs().includes(mcpName)
  }

  /**
   * Get the raw config file content (including disabled MCPs)
   * Useful for inspection or backup purposes
   */
  getRawConfig(): MCPServersConfig | null {
    if (!this.configPath) {
      return null
    }

    return this.readRawConfigFile(this.configPath)
  }
}
