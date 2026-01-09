/**
 * Configuration Loader
 *
 * Loads MCP configurations from various IDE config files
 * and provides functions to disable/enable MCPs for MCP Guard integration.
 *
 * Supports Claude Code, GitHub Copilot, and Cursor IDEs.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { MCPServerInfo } from './types'

/**
 * IDE configuration file format (matches Cursor/Claude Code format)
 */
interface MCPServersConfig {
  mcpServers: Record<string, unknown>
  // MCPGuard metadata: stores disabled MCPs that should be guarded
  _mcpguard_disabled?: Record<string, unknown>
  _mcpguard_metadata?: {
    version?: string
    disabled_at?: string
  }
}

/**
 * IDE configuration file locations
 * Claude Code is checked first as it has highest priority
 */
const IDE_CONFIG_PATHS = {
  claude: [
    // Claude Code primary paths (cross-platform)
    path.join(os.homedir(), '.claude', 'mcp.json'),
    path.join(os.homedir(), '.claude', 'mcp.jsonc'),
    // Claude Code on Windows (AppData)
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
    // Claude Code on macOS (Application Support)
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
    // Claude Code on Linux (.config)
    path.join(
      os.homedir(),
      '.config',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      '.config',
      'Claude Code',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
  ],
  copilot: [
    // GitHub Copilot MCP config (primary paths)
    path.join(os.homedir(), '.github', 'copilot', 'mcp.json'),
    path.join(os.homedir(), '.github', 'copilot', 'mcp.jsonc'),
    // GitHub Copilot on Windows (VS Code extension storage)
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.jsonc',
    ),
    // GitHub Copilot on macOS (VS Code extension storage)
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.jsonc',
    ),
    // GitHub Copilot on Linux (VS Code extension storage)
    path.join(
      os.homedir(),
      '.config',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      '.config',
      'Code',
      'User',
      'globalStorage',
      'github.copilot',
      'mcp.jsonc',
    ),
  ],
  cursor: [
    // Cursor MCP config (primary paths)
    path.join(os.homedir(), '.cursor', 'mcp.json'),
    path.join(os.homedir(), '.cursor', 'mcp.jsonc'),
    // Cursor on Windows (AppData)
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
    // Cursor on macOS (Application Support)
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
    // Cursor on Linux (.config)
    path.join(
      os.homedir(),
      '.config',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.json',
    ),
    path.join(
      os.homedir(),
      '.config',
      'Cursor',
      'User',
      'globalStorage',
      'mcp.jsonc',
    ),
  ],
}

/**
 * Check if a file exists and is readable
 */
function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Safely parse JSON from a file
 */
function safeParseJSON(filePath: string): unknown | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Load MCPs from Claude Code config (including disabled MCPs from _mcpguard_disabled)
 * Claude Code uses ~/.claude/mcp.json or ~/.claude/mcp.jsonc as primary config location
 * Also supports legacy `disabled: true` property for backwards compatibility
 */
function loadClaudeConfig(): MCPServerInfo[] {
  const mcps: MCPServerInfo[] = []

  for (const configPath of IDE_CONFIG_PATHS.claude) {
    if (!fileExists(configPath)) continue

    const config = safeParseJSON(configPath) as {
      mcpServers?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
          disabled?: boolean
        }
      >
      _mcpguard_disabled?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
        }
      >
    } | null

    if (!config) continue

    // Load active MCPs (also check legacy disabled property)
    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'claude',
          // Support both _mcpguard_disabled section and legacy disabled property
          enabled: !serverConfig.disabled,
        })
      }
    }

    // Load disabled MCPs (guarded by MCPGuard - new pattern)
    if (config._mcpguard_disabled) {
      for (const [name, serverConfig] of Object.entries(
        config._mcpguard_disabled,
      )) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'claude',
          enabled: false, // Disabled MCPs - guarded by MCPGuard
        })
      }
    }

    // Only use first found config
    break
  }

  return mcps
}

/**
 * Load MCPs from GitHub Copilot config (including disabled MCPs from _mcpguard_disabled)
 * GitHub Copilot uses ~/.github/copilot/mcp.json as primary config location
 * Also supports legacy `disabled: true` property for backwards compatibility
 */
function loadCopilotConfig(): MCPServerInfo[] {
  const mcps: MCPServerInfo[] = []

  for (const configPath of IDE_CONFIG_PATHS.copilot) {
    if (!fileExists(configPath)) continue

    const config = safeParseJSON(configPath) as {
      mcpServers?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
          disabled?: boolean
        }
      >
      _mcpguard_disabled?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
        }
      >
    } | null

    if (!config) continue

    // Load active MCPs (also check legacy disabled property)
    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'copilot',
          // Support both _mcpguard_disabled section and legacy disabled property
          enabled: !serverConfig.disabled,
        })
      }
    }

    // Load disabled MCPs (guarded by MCPGuard - new pattern)
    if (config._mcpguard_disabled) {
      for (const [name, serverConfig] of Object.entries(
        config._mcpguard_disabled,
      )) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'copilot',
          enabled: false, // Disabled MCPs - guarded by MCPGuard
        })
      }
    }

    break
  }

  return mcps
}

/**
 * Load MCPs from Cursor config (including disabled MCPs from _mcpguard_disabled)
 * Cursor uses ~/.cursor/mcp.json or ~/.cursor/mcp.jsonc as primary config location
 * Also supports legacy `disabled: true` property for backwards compatibility
 */
function loadCursorConfig(): MCPServerInfo[] {
  const mcps: MCPServerInfo[] = []

  for (const configPath of IDE_CONFIG_PATHS.cursor) {
    if (!fileExists(configPath)) continue

    const config = safeParseJSON(configPath) as {
      mcpServers?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
          disabled?: boolean
        }
      >
      _mcpguard_disabled?: Record<
        string,
        {
          command?: string
          args?: string[]
          url?: string
          headers?: Record<string, string>
          env?: Record<string, string>
        }
      >
    } | null

    if (!config) continue

    // Load active MCPs (also check legacy disabled property)
    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'cursor',
          // Support both _mcpguard_disabled section and legacy disabled property
          enabled: !serverConfig.disabled,
        })
      }
    }

    // Load disabled MCPs (guarded by MCPGuard - new pattern)
    if (config._mcpguard_disabled) {
      for (const [name, serverConfig] of Object.entries(
        config._mcpguard_disabled,
      )) {
        // Skip mcpguard itself
        if (name === 'mcpguard') continue

        mcps.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args,
          url: serverConfig.url,
          headers: serverConfig.headers,
          env: serverConfig.env,
          source: 'cursor',
          enabled: false, // Disabled MCPs - guarded by MCPGuard
        })
      }
    }

    break
  }

  return mcps
}

/**
 * Load all MCP servers from all IDE configs
 */
export function loadAllMCPServers(): MCPServerInfo[] {
  const mcps: MCPServerInfo[] = []
  const seenNames = new Set<string>()

  // Load from each IDE in priority order: Claude > Cursor > Copilot
  const sources = [loadClaudeConfig(), loadCursorConfig(), loadCopilotConfig()]

  for (const source of sources) {
    for (const mcp of source) {
      // Deduplicate by name (prefer earlier sources)
      if (!seenNames.has(mcp.name)) {
        seenNames.add(mcp.name)
        mcps.push(mcp)
      }
    }
  }

  return mcps
}

/**
 * Get the path to the MCP Guard settings file
 */
export function getSettingsPath(): string {
  const configDir = path.join(os.homedir(), '.mcpguard')

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  return path.join(configDir, 'settings.json')
}

/**
 * Get the list of detected IDE config paths
 */
export function getDetectedConfigs(): { ide: string; path: string }[] {
  const detected: { ide: string; path: string }[] = []

  for (const [ide, paths] of Object.entries(IDE_CONFIG_PATHS)) {
    for (const configPath of paths) {
      if (fileExists(configPath)) {
        detected.push({ ide, path: configPath })
        break // Only include first found for each IDE
      }
    }
  }

  return detected
}

// ============================================================================
// IDE Config Manipulation Functions (for Guard toggle integration)
// ============================================================================

/**
 * Find the first existing IDE config path for a given IDE
 */
function findIDEConfigPath(
  ide: 'claude' | 'copilot' | 'cursor',
): string | null {
  const paths = IDE_CONFIG_PATHS[ide]
  for (const configPath of paths) {
    if (fileExists(configPath)) {
      return configPath
    }
  }
  return null
}

/**
 * Get the primary IDE config path (priority: Claude > Cursor > Copilot)
 */
export function getPrimaryIDEConfigPath(): string | null {
  // Priority order: Claude > Cursor > Copilot
  const claudePath = findIDEConfigPath('claude')
  if (claudePath) return claudePath

  const cursorPath = findIDEConfigPath('cursor')
  if (cursorPath) return cursorPath

  const copilotPath = findIDEConfigPath('copilot')
  if (copilotPath) return copilotPath

  return null
}

/**
 * Get config path for a specific IDE source
 */
export function getIDEConfigPath(
  source: 'claude' | 'copilot' | 'cursor' | 'unknown',
): string | null {
  if (source === 'unknown') {
    return getPrimaryIDEConfigPath()
  }
  return findIDEConfigPath(source)
}

/**
 * Read raw config file (including disabled MCPs section)
 */
function readRawConfigFile(filePath: string): MCPServersConfig | null {
  if (!fileExists(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const config = JSON.parse(content) as MCPServersConfig

    if (!config || typeof config !== 'object') {
      console.error('MCP Guard: Invalid config file format')
      return null
    }

    // Ensure mcpServers exists
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {}
    }

    return config
  } catch (error) {
    console.error('MCP Guard: Failed to read config file:', error)
    return null
  }
}

/**
 * Write config file
 */
function writeConfigFile(filePath: string, config: MCPServersConfig): boolean {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const content = JSON.stringify(config, null, 2)
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch (error) {
    console.error('MCP Guard: Failed to write config file:', error)
    return false
  }
}

/**
 * Check if an MCP is disabled (in the _mcpguard_disabled section)
 */
export function isMCPDisabled(mcpName: string): boolean {
  const configPath = getPrimaryIDEConfigPath()
  if (!configPath) return false

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) return false

  return !!rawConfig._mcpguard_disabled?.[mcpName]
}

/**
 * Disable an MCP by moving it to the _mcpguard_disabled section
 * This prevents the IDE from loading it directly, ensuring MCPGuard proxies it instead
 * @param mcpName Name of the MCP to disable
 * @param source Optional source IDE - if provided, modifies that IDE's config; otherwise uses primary
 */
export function disableMCPInIDE(
  mcpName: string,
  source?: 'claude' | 'copilot' | 'cursor',
): {
  success: boolean
  message: string
  requiresRestart: boolean
} {
  const configPath = source
    ? getIDEConfigPath(source)
    : getPrimaryIDEConfigPath()
  if (!configPath) {
    return {
      success: false,
      message: source
        ? `No ${source} config file found`
        : 'No IDE config file found',
      requiresRestart: false,
    }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return {
      success: false,
      message: 'Failed to read IDE config',
      requiresRestart: false,
    }
  }

  // Check if MCP exists and is not already disabled
  if (!rawConfig.mcpServers[mcpName]) {
    if (rawConfig._mcpguard_disabled?.[mcpName]) {
      return {
        success: true,
        message: 'MCP is already disabled',
        requiresRestart: false,
      }
    }
    return {
      success: false,
      message: 'MCP not found in IDE config',
      requiresRestart: false,
    }
  }

  // Move MCP to disabled section
  const mcpConfig = rawConfig.mcpServers[mcpName]
  delete rawConfig.mcpServers[mcpName]

  // Initialize disabled section if needed
  if (!rawConfig._mcpguard_disabled) {
    rawConfig._mcpguard_disabled = {}
  }
  rawConfig._mcpguard_disabled[mcpName] = mcpConfig

  // Update metadata
  if (!rawConfig._mcpguard_metadata) {
    rawConfig._mcpguard_metadata = {}
  }
  rawConfig._mcpguard_metadata.disabled_at = new Date().toISOString()

  if (!writeConfigFile(configPath, rawConfig)) {
    return {
      success: false,
      message: 'Failed to write config file',
      requiresRestart: false,
    }
  }

  console.log(`MCP Guard: Disabled ${mcpName} in IDE config`)
  return {
    success: true,
    message: `${mcpName} disabled - will be proxied through MCP Guard`,
    requiresRestart: false,
  }
}

/**
 * Enable a previously disabled MCP by moving it back to active config
 * @param mcpName Name of the MCP to enable
 * @param source Optional source IDE - if provided, modifies that IDE's config; otherwise uses primary
 */
export function enableMCPInIDE(
  mcpName: string,
  source?: 'claude' | 'copilot' | 'cursor',
): {
  success: boolean
  message: string
  requiresRestart: boolean
} {
  const configPath = source
    ? getIDEConfigPath(source)
    : getPrimaryIDEConfigPath()
  if (!configPath) {
    return {
      success: false,
      message: source
        ? `No ${source} config file found`
        : 'No IDE config file found',
      requiresRestart: false,
    }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return {
      success: false,
      message: 'Failed to read IDE config',
      requiresRestart: false,
    }
  }

  // Check if MCP is in disabled list
  if (!rawConfig._mcpguard_disabled?.[mcpName]) {
    // Check if it's already active
    if (rawConfig.mcpServers[mcpName]) {
      return {
        success: true,
        message: 'MCP is already enabled',
        requiresRestart: false,
      }
    }
    return {
      success: false,
      message: 'MCP not found in disabled list',
      requiresRestart: false,
    }
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

  if (!writeConfigFile(configPath, rawConfig)) {
    return {
      success: false,
      message: 'Failed to write config file',
      requiresRestart: false,
    }
  }

  console.log(`MCP Guard: Enabled ${mcpName} in IDE config`)
  return {
    success: true,
    message: `${mcpName} restored to active config`,
    requiresRestart: false,
  }
}

/**
 * Ensure mcpguard is in the IDE config
 * If not present, adds it with the bundled server path
 */
export function ensureMCPGuardInConfig(extensionPath: string): {
  success: boolean
  message: string
  added: boolean
} {
  const configPath = getPrimaryIDEConfigPath()

  // If no config exists, we need to create one
  if (!configPath) {
    // Try to create Cursor config as default
    const cursorConfigDir = path.join(os.homedir(), '.cursor')
    const cursorConfigPath = path.join(cursorConfigDir, 'mcp.json')

    try {
      if (!fs.existsSync(cursorConfigDir)) {
        fs.mkdirSync(cursorConfigDir, { recursive: true })
      }

      const serverPath = path.join(
        extensionPath,
        '..',
        'dist',
        'server',
        'index.js',
      )
      const newConfig: MCPServersConfig = {
        mcpServers: {
          mcpguard: {
            command: 'node',
            args: [serverPath],
          },
        },
      }

      if (!writeConfigFile(cursorConfigPath, newConfig)) {
        return {
          success: false,
          message: 'Failed to create config file',
          added: false,
        }
      }

      console.log('MCP Guard: Created IDE config with mcpguard entry')
      return {
        success: true,
        message: 'Created IDE config with mcpguard',
        added: true,
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create config directory',
        added: false,
      }
    }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return {
      success: false,
      message: 'Failed to read IDE config',
      added: false,
    }
  }

  // Check if mcpguard already exists
  if (rawConfig.mcpServers['mcpguard']) {
    return {
      success: true,
      message: 'mcpguard already in config',
      added: false,
    }
  }

  // Check if it's in disabled section (shouldn't be, but just in case)
  if (rawConfig._mcpguard_disabled?.['mcpguard']) {
    // Move it back to active
    const mcpConfig = rawConfig._mcpguard_disabled['mcpguard']
    delete rawConfig._mcpguard_disabled['mcpguard']
    rawConfig.mcpServers['mcpguard'] = mcpConfig

    if (!writeConfigFile(configPath, rawConfig)) {
      return {
        success: false,
        message: 'Failed to write config file',
        added: false,
      }
    }

    console.log('MCP Guard: Restored mcpguard from disabled section')
    return {
      success: true,
      message: 'Restored mcpguard to active config',
      added: true,
    }
  }

  // Add mcpguard entry pointing to the bundled server
  const serverPath = path.join(
    extensionPath,
    '..',
    'dist',
    'server',
    'index.js',
  )
  rawConfig.mcpServers['mcpguard'] = {
    command: 'node',
    args: [serverPath],
  }

  if (!writeConfigFile(configPath, rawConfig)) {
    return {
      success: false,
      message: 'Failed to write config file',
      added: false,
    }
  }

  console.log('MCP Guard: Added mcpguard to IDE config')
  return { success: true, message: 'Added mcpguard to IDE config', added: true }
}

/**
 * Remove mcpguard from the IDE config
 * Used when MCP Guard is globally disabled
 */
export function removeMCPGuardFromConfig(): {
  success: boolean
  message: string
} {
  const configPath = getPrimaryIDEConfigPath()
  if (!configPath) {
    return { success: false, message: 'No IDE config file found' }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return { success: false, message: 'Failed to read IDE config' }
  }

  // Check if mcpguard exists in active config
  if (!rawConfig.mcpServers['mcpguard']) {
    return { success: true, message: 'mcpguard not in config' }
  }

  // Remove mcpguard from active config
  delete rawConfig.mcpServers['mcpguard']

  if (!writeConfigFile(configPath, rawConfig)) {
    return { success: false, message: 'Failed to write config file' }
  }

  console.log('MCP Guard: Removed mcpguard from IDE config')
  return { success: true, message: 'Removed mcpguard from IDE config' }
}

/**
 * Get the status of an MCP (active, disabled, or not found)
 */
export function getMCPStatus(
  mcpName: string,
): 'active' | 'disabled' | 'not_found' {
  const configPath = getPrimaryIDEConfigPath()
  if (!configPath) return 'not_found'

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) return 'not_found'

  if (rawConfig.mcpServers[mcpName]) {
    return 'active'
  }

  if (rawConfig._mcpguard_disabled?.[mcpName]) {
    return 'disabled'
  }

  return 'not_found'
}

/**
 * Get all configured MCP names (both active and disabled)
 */
export function getAllConfiguredMCPNames(): string[] {
  const mcps = loadAllMCPServers()
  return mcps.map((m) => m.name)
}

/**
 * Invalidate cache for a specific MCP
 * Call this when an MCP is deleted, modified, or its guard status changes
 * This forces a fresh assessment on the next load AND clears the schema cache
 * so that the MCPGuard server will re-fetch tools from the MCP
 */
export function invalidateMCPCache(mcpName: string): {
  success: boolean
  message: string
} {
  const settingsPath = getSettingsPath()

  if (!fs.existsSync(settingsPath)) {
    return { success: true, message: 'No settings file exists' }
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content)
    let changed = false
    const clearedCaches: string[] = []

    // Clear token metrics cache for this MCP
    if (settings.tokenMetricsCache?.[mcpName]) {
      delete settings.tokenMetricsCache[mcpName]
      changed = true
      clearedCaches.push('tokenMetrics')
    }

    // Clear assessment errors cache for this MCP
    if (settings.assessmentErrorsCache?.[mcpName]) {
      delete settings.assessmentErrorsCache[mcpName]
      changed = true
      clearedCaches.push('assessmentErrors')
    }

    // Clear MCP schema cache for this MCP
    // Schema cache keys are in format "mcpName:configHash", so we need to find and remove all matching entries
    // This is CRITICAL - without this, the MCPGuard server will continue using cached (possibly empty) schemas
    if (settings.mcpSchemaCache) {
      const keysToRemove = Object.keys(settings.mcpSchemaCache).filter((key) =>
        key.startsWith(`${mcpName}:`),
      )
      for (const key of keysToRemove) {
        delete settings.mcpSchemaCache[key]
        changed = true
      }
      if (keysToRemove.length > 0) {
        clearedCaches.push(`mcpSchema (${keysToRemove.length} entries)`)
      }
    }

    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      console.log(
        `MCP Guard: Invalidated cache for ${mcpName} - cleared: ${clearedCaches.join(', ')}`,
      )
      return {
        success: true,
        message: `Cache invalidated for ${mcpName}: ${clearedCaches.join(', ')}`,
      }
    }

    return { success: true, message: `No cache entries found for ${mcpName}` }
  } catch (error) {
    console.error(
      `MCP Guard: Failed to invalidate cache for ${mcpName}:`,
      error,
    )
    return { success: false, message: `Failed to invalidate cache: ${error}` }
  }
}

/**
 * Clean up token metrics cache for MCPs that no longer exist in IDE config
 * Call this periodically to prevent accumulation of stale cache entries
 */
export function cleanupTokenMetricsCache(): { removed: string[] } {
  const settingsPath = getSettingsPath()
  const removed: string[] = []

  if (!fs.existsSync(settingsPath)) {
    return { removed }
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content)

    if (!settings.tokenMetricsCache) {
      return { removed }
    }

    const configuredMCPs = new Set(getAllConfiguredMCPNames())

    for (const mcpName of Object.keys(settings.tokenMetricsCache)) {
      if (!configuredMCPs.has(mcpName)) {
        delete settings.tokenMetricsCache[mcpName]
        removed.push(mcpName)
      }
    }

    // Also clean up assessment errors cache
    if (settings.assessmentErrorsCache) {
      for (const mcpName of Object.keys(settings.assessmentErrorsCache)) {
        if (!configuredMCPs.has(mcpName)) {
          delete settings.assessmentErrorsCache[mcpName]
          if (!removed.includes(mcpName)) {
            removed.push(mcpName)
          }
        }
      }
    }

    if (removed.length > 0) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      console.log(
        `MCP Guard: Cleaned up cache entries for removed MCPs: ${removed.join(', ')}`,
      )
    }

    return { removed }
  } catch (error) {
    console.error('MCP Guard: Failed to clean up token metrics cache:', error)
    return { removed }
  }
}

/**
 * MCP configuration for adding a new MCP
 */
export interface MCPConfigInput {
  /** Command to run the MCP server (for command-based MCPs) */
  command?: string
  /** Arguments for the command */
  args?: string[]
  /** URL for URL-based MCPs */
  url?: string
  /** HTTP headers for URL-based MCPs */
  headers?: Record<string, string>
  /** Environment variables */
  env?: Record<string, string>
}

/**
 * Add a new MCP to the IDE config
 * @param mcpName Name for the new MCP server
 * @param config MCP configuration (command-based or URL-based)
 * @returns Success status and message
 */
export function addMCPToIDE(
  mcpName: string,
  config: MCPConfigInput,
): { success: boolean; message: string } {
  const configPath = getPrimaryIDEConfigPath()

  // If no config exists, create the default Cursor config
  if (!configPath) {
    const cursorConfigDir = path.join(os.homedir(), '.cursor')
    const cursorConfigPath = path.join(cursorConfigDir, 'mcp.json')

    try {
      if (!fs.existsSync(cursorConfigDir)) {
        fs.mkdirSync(cursorConfigDir, { recursive: true })
      }

      const newConfig: MCPServersConfig = {
        mcpServers: {
          [mcpName]: config,
        },
      }

      fs.writeFileSync(cursorConfigPath, JSON.stringify(newConfig, null, 2))
      console.log(`MCP Guard: Created IDE config with ${mcpName}`)
      return { success: true, message: `Created IDE config with ${mcpName}` }
    } catch (error) {
      console.error('MCP Guard: Failed to create config file:', error)
      return { success: false, message: 'Failed to create config directory' }
    }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return { success: false, message: 'Failed to read IDE config' }
  }

  // Check if MCP already exists (in active or disabled section)
  if (rawConfig.mcpServers[mcpName]) {
    return {
      success: false,
      message: `MCP "${mcpName}" already exists in IDE config`,
    }
  }
  if (rawConfig._mcpguard_disabled?.[mcpName]) {
    return {
      success: false,
      message: `MCP "${mcpName}" already exists (currently guarded)`,
    }
  }

  // Add the new MCP
  rawConfig.mcpServers[mcpName] = config

  if (!writeConfigFile(configPath, rawConfig)) {
    return { success: false, message: 'Failed to write config file' }
  }

  console.log(`MCP Guard: Added ${mcpName} to IDE config`)
  return { success: true, message: `Added ${mcpName} to IDE config` }
}

/**
 * Delete an MCP from the IDE config entirely
 * Removes from both active and disabled sections
 * @param mcpName Name of the MCP server to delete
 * @returns Success status and message
 */
/**
 * Delete an MCP from the IDE config entirely
 * @param mcpName Name of the MCP to delete
 * @param source Optional source IDE - if provided, modifies that IDE's config; otherwise uses primary
 */
export function deleteMCPFromIDE(
  mcpName: string,
  source?: 'claude' | 'copilot' | 'cursor',
): {
  success: boolean
  message: string
} {
  const configPath = source
    ? getIDEConfigPath(source)
    : getPrimaryIDEConfigPath()
  if (!configPath) {
    return {
      success: false,
      message: source
        ? `No ${source} config file found`
        : 'No IDE config file found',
    }
  }

  const rawConfig = readRawConfigFile(configPath)
  if (!rawConfig) {
    return { success: false, message: 'Failed to read IDE config' }
  }

  let deleted = false

  // Remove from active MCPs
  if (rawConfig.mcpServers[mcpName]) {
    delete rawConfig.mcpServers[mcpName]
    deleted = true
  }

  // Remove from disabled MCPs
  if (rawConfig._mcpguard_disabled?.[mcpName]) {
    delete rawConfig._mcpguard_disabled[mcpName]
    deleted = true

    // Clean up disabled section if empty
    if (Object.keys(rawConfig._mcpguard_disabled).length === 0) {
      delete rawConfig._mcpguard_disabled
    }
  }

  if (!deleted) {
    return {
      success: false,
      message: `MCP "${mcpName}" not found in IDE config`,
    }
  }

  if (!writeConfigFile(configPath, rawConfig)) {
    return { success: false, message: 'Failed to write config file' }
  }

  // Also invalidate the cache for this MCP
  invalidateMCPCache(mcpName)

  console.log(`MCP Guard: Deleted ${mcpName} from IDE config`)
  return { success: true, message: `Deleted ${mcpName} from IDE config` }
}
