/**
 * Webview Provider for MCP Guard Configuration Panel
 */

import * as fs from 'fs'
import * as vscode from 'vscode'
import {
  addMCPToIDE,
  cleanupTokenMetricsCache,
  deleteMCPFromIDE,
  disableMCPInIDE,
  enableMCPInIDE,
  ensureMCPGuardInConfig,
  getIDEConfigPath,
  getSettingsPath,
  invalidateMCPCache,
  isMCPDisabled,
  loadAllMCPServers,
  type MCPConfigInput,
  removeMCPGuardFromConfig,
} from './config-loader'
import {
  assessMCPTokensWithError,
  calculateTokenSavings,
  testMCPConnection,
} from './token-assessor'
import type {
  AssessmentErrorsCache,
  ExtensionMessage,
  MCPGuardSettings,
  MCPGuardSettingsStored,
  MCPSecurityConfig,
  MCPSecurityConfigStored,
  MCPServerInfo,
  TokenMetricsCache,
  WebviewMessage,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { checkAllMCPVersions } from './version-checker'

/**
 * Hydrate a stored config with computed isGuarded from IDE config
 * @param storedConfig The stored config to hydrate
 * @param source Optional source IDE - if provided, checks that IDE's config for disabled status
 */
function hydrateConfig(
  storedConfig: MCPSecurityConfigStored,
  source?: 'claude' | 'copilot' | 'cursor',
): MCPSecurityConfig {
  return {
    ...storedConfig,
    isGuarded: isMCPDisabled(storedConfig.mcpName, source),
  }
}

/**
 * Dehydrate a config for storage (remove isGuarded)
 */
function dehydrateConfig(config: MCPSecurityConfig): MCPSecurityConfigStored {
  const { isGuarded: _, ...stored } = config
  return stored
}

/**
 * Build a map of MCP names to their source IDE for quick lookup
 */
function buildSourceMap(
  mcps: Array<{ name: string; source: string }>,
): Map<string, 'claude' | 'copilot' | 'cursor' | undefined> {
  const map = new Map<string, 'claude' | 'copilot' | 'cursor' | undefined>()
  for (const mcp of mcps) {
    if (
      mcp.source === 'claude' ||
      mcp.source === 'copilot' ||
      mcp.source === 'cursor'
    ) {
      map.set(mcp.name, mcp.source)
    }
  }
  return map
}

/**
 * Load settings from disk and hydrate configs with isGuarded from IDE config
 * @param settingsPath Path to the settings file
 * @param mcps Optional list of loaded MCPs - if provided, uses their source for accurate hydration
 */
function loadSettingsWithHydration(
  settingsPath: string,
  mcps?: Array<{ name: string; source: string }>,
): MCPGuardSettings {
  if (!fs.existsSync(settingsPath)) {
    return {
      ...DEFAULT_SETTINGS,
      mcpConfigs: [],
    }
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const storedSettings = JSON.parse(content) as MCPGuardSettingsStored

    // Build source map for accurate hydration
    const sourceMap = mcps ? buildSourceMap(mcps) : null

    // Hydrate configs with computed isGuarded from the correct IDE config
    const hydratedConfigs = storedSettings.mcpConfigs.map((config) => {
      const source = sourceMap?.get(config.mcpName)
      return hydrateConfig(config, source)
    })

    return {
      ...storedSettings,
      mcpConfigs: hydratedConfigs,
    }
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      mcpConfigs: [],
    }
  }
}

/**
 * Save settings to disk, dehydrating configs (removing isGuarded)
 */
function saveSettingsWithDehydration(
  settingsPath: string,
  settings: MCPGuardSettings,
): void {
  const storedSettings: MCPGuardSettingsStored = {
    enabled: settings.enabled,
    defaults: settings.defaults,
    mcpConfigs: settings.mcpConfigs.map(dehydrateConfig),
    tokenMetricsCache: settings.tokenMetricsCache,
    assessmentErrorsCache: settings.assessmentErrorsCache,
    contextWindowSize: settings.contextWindowSize,
  }

  fs.writeFileSync(settingsPath, JSON.stringify(storedSettings, null, 2))
}

export class MCPGuardWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mcpguard.configPanel'

  private _view?: vscode.WebviewView
  private _extensionUri: vscode.Uri
  private _mcpCount: number = 0
  private _outputChannel: vscode.OutputChannel

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri
    this._outputChannel = vscode.window.createOutputChannel('MCP Guard')
  }

  private _log(message: string): void {
    const timestamp = new Date().toISOString()
    this._outputChannel.appendLine(`[${timestamp}] ${message}`)
    console.log(`MCP Guard: ${message}`)
  }

  /**
   * Update the view badge to show MCP count or warning
   */
  private _updateBadge(): void {
    if (!this._view) return

    if (this._mcpCount === 0) {
      // Hide badge when no MCPs found (0 would be misleading)
      this._view.badge = undefined
    } else {
      // Show count badge
      this._view.badge = {
        tooltip: `${this._mcpCount} MCP server${this._mcpCount === 1 ? '' : 's'} detected`,
        value: this._mcpCount,
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._log('Webview panel opened')
    this._outputChannel.show(true) // Show the output channel
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      await this._handleMessage(message)
    })

    // Auto-import MCPs on view initialization
    this._autoImportOnInit()
  }

  /**
   * Automatically import MCPs when the view is first shown
   */
  private async _autoImportOnInit(): Promise<void> {
    // Small delay to ensure webview is ready
    setTimeout(() => {
      const mcps = loadAllMCPServers()
      this._mcpCount = mcps.length
      this._updateBadge()

      // Log what we found for debugging
      console.log(`MCP Guard: Auto-imported ${mcps.length} MCP server(s)`)
      if (mcps.length > 0) {
        console.log(
          'MCP Guard: Found servers:',
          mcps.map((m) => `${m.name} (${m.source})`).join(', '),
        )
      }

      // Clean up stale token metrics cache entries for MCPs that no longer exist
      const cleanupResult = cleanupTokenMetricsCache()
      if (cleanupResult.removed.length > 0) {
        console.log(
          `MCP Guard: Cleaned up stale cache entries: ${cleanupResult.removed.join(', ')}`,
        )
      }

      // Check versions asynchronously (don't block UI load)
      setTimeout(() => {
        this._checkVersionsAsync()
      }, 1000) // Wait 1 second after UI loads before checking versions
    }, 100)
  }

  /**
   * Check versions for all MCPs asynchronously (runs in background)
   * Also adds missing packageName for npx-based MCPs that were assessed before version feature
   */
  private async _checkVersionsAsync(): Promise<void> {
    try {
      this._log('Background version check starting...')
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      const cache = settings.tokenMetricsCache || {}
      let cacheUpdated = false

      // First pass: Fix npx-based MCPs that need version data populated
      // We need to work directly with the cache, not the MCPs (which don't have tokenMetrics attached)
      for (const mcp of mcps) {
        const cachedMetrics = cache[mcp.name]
        if (!cachedMetrics) continue

        // Check if this is an npx-based MCP
        const isNpx = mcp.command === 'npx' || mcp.command?.endsWith('npx.cmd')
        if (!isNpx || !mcp.args) continue

        // Extract package name from args (skip flags)
        const packageName = mcp.args.find(
          (arg) => !arg.startsWith('-') && arg.trim().length > 0,
        )
        if (!packageName) continue

        // Check if we need to fix this entry
        const needsPackageName = !cachedMetrics.packageName
        const needsInstalledVersion =
          cachedMetrics.packageName && !cachedMetrics.installedVersion

        if (needsPackageName) {
          this._log(
            `Adding missing packageName for ${mcp.name}: ${packageName}`,
          )
          cache[mcp.name] = {
            ...cachedMetrics,
            packageName: packageName,
          }
          cacheUpdated = true
        }

        if (needsInstalledVersion) {
          // Clear versionCheckedAt to force a re-check that will populate installedVersion
          this._log(
            `Clearing stale version data for ${mcp.name} to force re-check`,
          )
          cache[mcp.name] = {
            ...cache[mcp.name],
            versionCheckedAt: undefined,
          }
          cacheUpdated = true
        }
      }

      // Save cache with added package names
      if (cacheUpdated) {
        settings.tokenMetricsCache = cache
        saveSettingsWithDehydration(settingsPath, settings)
        this._log(
          `Updated cache with package names for ${Object.keys(cache).length} MCPs`,
        )
      }

      // Second pass: Attach tokenMetrics to MCPs for version checking
      const mcpsWithMetrics = mcps.map((mcp) => ({
        ...mcp,
        tokenMetrics: cache[mcp.name],
      }))

      // Third pass: Check versions (this will detect installed versions and check npm registry)
      const updatedCache = await checkAllMCPVersions(mcpsWithMetrics, cache)

      // Save updated cache
      settings.tokenMetricsCache = updatedCache
      saveSettingsWithDehydration(settingsPath, settings)

      // Refresh MCP list to show updated versions
      await this._sendMCPServers()

      this._log('Background version check complete')
    } catch (error) {
      this._log(`Background version check error: ${error}`)
      // Don't show error to user - this is a background operation
    }
  }

  /**
   * Send a message to the webview
   */
  private _postMessage(message: ExtensionMessage): void {
    this._view?.webview.postMessage(message)
  }

  /**
   * Handle messages from the webview
   */
  private async _handleMessage(message: WebviewMessage): Promise<void> {
    this._log(`Received message: ${message.type}`)

    switch (message.type) {
      case 'getSettings':
        await this._sendSettings()
        break

      case 'getMCPServers':
        this._log('getMCPServers requested')
        await this._sendMCPServers()
        break

      case 'saveSettings':
        await this._saveSettings(message.data)
        break

      case 'saveMCPConfig':
        await this._saveMCPConfig(message.data, message.source)
        break

      case 'importFromIDE':
        await this._importFromIDE()
        break

      case 'refreshMCPs':
        await this._sendMCPServers()
        break

      case 'openMCPGuardDocs':
        await vscode.env.openExternal(
          vscode.Uri.parse('https://github.com/mcpguard/mcpguard'),
        )
        break

      case 'openExternalLink':
        if ('url' in message && message.url) {
          this._log(`Opening external link: ${message.url}`)
          try {
            const uri = vscode.Uri.parse(message.url)
            // Try vscode.open command which is more reliable for external URLs
            await vscode.commands.executeCommand('vscode.open', uri)
            this._log(`vscode.open command executed for: ${message.url}`)
          } catch (err) {
            this._log(`Error opening external link: ${err}`)
            // Fallback to openExternal
            try {
              await vscode.env.openExternal(vscode.Uri.parse(message.url))
            } catch (err2) {
              this._log(`Fallback openExternal also failed: ${err2}`)
            }
          }
        } else {
          this._log(`openExternalLink called but no URL provided`)
        }
        break

      case 'assessTokens':
        await this._assessTokensForMCP(message.mcpName)
        break

      case 'openIDEConfig':
        await this._openIDEConfig(message.source)
        break

      case 'retryAssessment':
        await this._retryAssessment(message.mcpName, message.source)
        break

      case 'openLogs':
        this._outputChannel.show(true)
        break

      case 'testConnection':
        await this._testConnection(message.mcpName)
        break

      case 'deleteMCP':
        await this._deleteMCP(message.mcpName, message.source)
        break

      case 'addMCP':
        await this._addMCP(message.name, message.config)
        break

      case 'invalidateCache':
        await this._invalidateCache(message.mcpName)
        break

      case 'checkVersion':
        await this._checkVersion(message.mcpName)
        break

      default:
        this._log(
          `Unhandled message type: ${(message as { type: string }).type}`,
        )
    }
  }

  /**
   * Open the IDE config file for editing
   */
  private async _openIDEConfig(
    source: 'claude' | 'copilot' | 'cursor' | 'unknown',
  ): Promise<void> {
    const configPath = getIDEConfigPath(source)
    if (configPath) {
      const doc = await vscode.workspace.openTextDocument(configPath)
      await vscode.window.showTextDocument(doc)
    } else {
      this._postMessage({
        type: 'error',
        message: 'Could not find IDE config file',
      })
    }
  }

  /**
   * Retry assessment for a specific MCP (clears cached error first)
   */
  private async _retryAssessment(
    mcpName: string,
    source?: 'claude' | 'copilot' | 'cursor',
  ): Promise<void> {
    // Clear the cached error first
    const mcps = loadAllMCPServers()
    const settingsPath = getSettingsPath()
    const settings = loadSettingsWithHydration(settingsPath, mcps)

    // Clear cached error
    if (settings.assessmentErrorsCache?.[mcpName]) {
      delete settings.assessmentErrorsCache[mcpName]
      saveSettingsWithDehydration(settingsPath, settings)
    }

    // Now re-assess
    await this._assessTokensForMCP(mcpName)

    // Refresh the MCP list to show updated state
    await this._sendMCPServers()
  }

  /**
   * Test connection to an MCP with verbose step-by-step diagnostics
   */
  private async _testConnection(mcpName: string): Promise<void> {
    const mcps = loadAllMCPServers()
    const server = mcps.find((m) => m.name === mcpName)

    if (!server) {
      this._postMessage({ type: 'error', message: `MCP ${mcpName} not found` })
      return
    }

    this._log(`Testing connection to ${mcpName}...`)
    this._outputChannel.appendLine(`\n${'='.repeat(60)}`)
    this._outputChannel.appendLine(`Connection Test: ${mcpName}`)
    this._outputChannel.appendLine(`Started: ${new Date().toISOString()}`)
    this._outputChannel.appendLine('='.repeat(60))

    try {
      const result = await testMCPConnection(server, (step) => {
        this._postMessage({ type: 'connectionTestProgress', mcpName, step })
        this._log(`  → ${step}`)
      })

      // Log all steps to output channel
      for (const step of result.steps) {
        this._outputChannel.appendLine(
          `\n[${step.success ? '✓' : '✗'}] ${step.name}`,
        )
        if (step.details) {
          this._outputChannel.appendLine(
            `    ${step.details.replace(/\n/g, '\n    ')}`,
          )
        }
        if (step.durationMs !== undefined) {
          this._outputChannel.appendLine(`    Duration: ${step.durationMs}ms`)
        }
        if (step.data?.request) {
          this._outputChannel.appendLine(
            `    Request:\n      ${step.data.request.replace(/\n/g, '\n      ')}`,
          )
        }
        if (step.data?.response) {
          this._outputChannel.appendLine(
            `    Response:\n      ${step.data.response.replace(/\n/g, '\n      ')}`,
          )
        }
      }

      this._outputChannel.appendLine(`\n${'='.repeat(60)}`)
      this._outputChannel.appendLine(
        `Result: ${result.success ? 'SUCCESS' : 'FAILED'}`,
      )
      this._outputChannel.appendLine(`Total Duration: ${result.durationMs}ms`)
      if (result.error) {
        this._outputChannel.appendLine(`Error: ${result.error.message}`)
        if (result.error.diagnostics) {
          this._outputChannel.appendLine(
            `Diagnostics: ${JSON.stringify(result.error.diagnostics, null, 2)}`,
          )
        }
      }
      this._outputChannel.appendLine('='.repeat(60) + '\n')

      this._postMessage({ type: 'connectionTestResult', data: result })

      if (result.success) {
        this._postMessage({
          type: 'success',
          message: `Connection to ${mcpName} successful!`,
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      this._log(`Connection test failed: ${errorMessage}`)
      this._outputChannel.appendLine(`\nUnexpected error: ${errorMessage}`)
      this._postMessage({
        type: 'error',
        message: `Connection test failed: ${errorMessage}`,
      })
    }
  }

  /**
   * Delete an MCP from the IDE config with confirmation
   * @param mcpName Name of the MCP to delete
   * @param source Source IDE to modify - if provided, deletes from that specific IDE's config
   */
  private async _deleteMCP(
    mcpName: string,
    source?: 'claude' | 'copilot' | 'cursor',
  ): Promise<void> {
    this._log(
      `Delete MCP requested: ${mcpName}${source ? ` from ${source}` : ''}`,
    )

    // Show confirmation dialog
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${mcpName}" from your IDE configuration? This action cannot be undone.`,
      { modal: true },
      'Delete',
    )

    if (confirm !== 'Delete') {
      this._log(`Delete cancelled for ${mcpName}`)
      return
    }

    const result = deleteMCPFromIDE(mcpName, source)

    if (result.success) {
      this._postMessage({ type: 'success', message: result.message })
      // Refresh MCP list
      await this._sendMCPServers()
    } else {
      this._postMessage({ type: 'error', message: result.message })
    }
  }

  /**
   * Add a new MCP to the IDE config
   */
  private async _addMCP(
    mcpName: string,
    config: MCPConfigInput,
  ): Promise<void> {
    this._log(`Add MCP requested: ${mcpName}`)

    // Validate the input
    if (!mcpName || mcpName.trim() === '') {
      this._postMessage({ type: 'error', message: 'MCP name is required' })
      return
    }

    // Must have either command or url
    if (!config.command && !config.url) {
      this._postMessage({
        type: 'error',
        message: 'MCP must have either a command or URL',
      })
      return
    }

    const result = addMCPToIDE(mcpName.trim(), config)

    if (result.success) {
      this._postMessage({ type: 'success', message: result.message })
      // Refresh MCP list
      await this._sendMCPServers()
    } else {
      this._postMessage({ type: 'error', message: result.message })
    }
  }

  /**
   * Invalidate cache for a specific MCP
   */
  private async _invalidateCache(mcpName: string): Promise<void> {
    this._log(`Invalidate cache requested: ${mcpName}`)

    const result = invalidateMCPCache(mcpName)

    if (result.success) {
      this._postMessage({ type: 'success', message: result.message })
      // Refresh MCP list to trigger re-assessment
      await this._sendMCPServers()
    } else {
      this._postMessage({ type: 'error', message: result.message })
    }
  }

  /**
   * Check version for a specific MCP or all MCPs
   */
  private async _checkVersion(mcpName?: string): Promise<void> {
    this._log(
      `Check version requested${mcpName ? ` for ${mcpName}` : ' for all MCPs'}`,
    )

    try {
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      // Filter to specific MCP if requested
      const mcpsToCheck = mcpName
        ? mcps.filter((m) => m.name === mcpName)
        : mcps

      if (mcpsToCheck.length === 0) {
        this._postMessage({
          type: 'error',
          message: `MCP ${mcpName} not found`,
        })
        return
      }

      // Check versions (this will detect installed versions and check npm registry)
      const updatedCache = await checkAllMCPVersions(
        mcpsToCheck,
        settings.tokenMetricsCache || {},
      )

      // Save updated cache
      settings.tokenMetricsCache = updatedCache
      saveSettingsWithDehydration(settingsPath, settings)

      // Refresh MCP list to show updated versions
      await this._sendMCPServers()

      this._postMessage({
        type: 'success',
        message: mcpName
          ? `Version check complete for ${mcpName}`
          : 'Version check complete for all MCPs',
      })
    } catch (error) {
      this._log(`Error checking versions: ${error}`)
      this._postMessage({ type: 'error', message: 'Failed to check versions' })
    }
  }

  /**
   * Load and send current settings to webview
   * isGuarded is computed from IDE config, not stored in settings
   */
  private async _sendSettings(): Promise<void> {
    try {
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      this._postMessage({ type: 'settings', data: settings })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._postMessage({
        type: 'error',
        message: `Failed to load settings: ${message}`,
      })
    }
  }

  /**
   * Load and send MCP servers from IDE configs
   */
  private async _sendMCPServers(): Promise<void> {
    try {
      this._postMessage({ type: 'loading', isLoading: true })
      const mcps = loadAllMCPServers()

      // Load token metrics from cache (with hydrated isGuarded from IDE config)
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      const tokenCache = settings.tokenMetricsCache || {}
      const errorCache = settings.assessmentErrorsCache || {}

      // Attach cached token metrics and errors to each MCP
      const mcpsWithMetrics: MCPServerInfo[] = mcps.map((mcp) => ({
        ...mcp,
        tokenMetrics: tokenCache[mcp.name],
        assessmentError: errorCache[mcp.name],
      }))

      this._mcpCount = mcps.length
      this._updateBadge()
      this._postMessage({ type: 'mcpServers', data: mcpsWithMetrics })

      // Send token savings summary
      await this._sendTokenSavings()

      // Auto-assess tokens for new MCPs in the background
      // Small delay to not block UI
      setTimeout(() => {
        this._autoAssessTokens().catch((err) => {
          console.error('Auto token assessment error:', err)
        })
      }, 500)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._postMessage({
        type: 'error',
        message: `Failed to load MCP servers: ${message}`,
      })
    } finally {
      this._postMessage({ type: 'loading', isLoading: false })
    }
  }

  /**
   * Save settings to file
   * When the global 'enabled' toggle changes, update IDE config for all guarded MCPs
   * Note: isGuarded is NOT saved - it's derived from IDE config
   */
  private async _saveSettings(settings: MCPGuardSettings): Promise<void> {
    try {
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      const sourceMap = buildSourceMap(mcps)

      // Check if global enabled state changed
      const previousSettings = loadSettingsWithHydration(settingsPath, mcps)

      const globalEnabledChanged = previousSettings.enabled !== settings.enabled

      // Save settings (dehydrates configs to remove isGuarded)
      saveSettingsWithDehydration(settingsPath, settings)

      // If global enabled state changed, update IDE config for all guarded MCPs
      if (globalEnabledChanged) {
        // Get guarded MCPs by checking IDE config (isGuarded is derived from there)
        // Use source-aware check for each MCP
        const guardedMcps = settings.mcpConfigs.filter((c) =>
          isMCPDisabled(c.mcpName, sourceMap.get(c.mcpName)),
        )

        if (settings.enabled) {
          // MCP Guard is now enabled - MCPs stay in their current state
          // (guarded MCPs are already in _mcpguard_disabled)
          // Ensure mcpguard is in the config
          const extensionPath = this._extensionUri.fsPath
          ensureMCPGuardInConfig(extensionPath)

          this._postMessage({
            type: 'success',
            message: `MCP Guard enabled - ${guardedMcps.length} MCP${guardedMcps.length === 1 ? '' : 's'} guarded`,
          })
        } else {
          // MCP Guard is now disabled - restore all guarded MCPs to active in IDE config
          for (const config of guardedMcps) {
            // Use source-aware enable for each MCP
            const source = sourceMap.get(config.mcpName)
            const result = enableMCPInIDE(config.mcpName, source)
            if (result.success) {
              console.log(
                `MCP Guard: ${config.mcpName} restored to active in IDE config${source ? ` (${source})` : ''}`,
              )
            }
          }

          // Also remove mcpguard itself from the IDE config since it's not needed
          const removeResult = removeMCPGuardFromConfig()
          if (removeResult.success) {
            console.log('MCP Guard: Removed mcpguard server from IDE config')
          }

          this._postMessage({
            type: 'success',
            message: `MCP Guard disabled - ${guardedMcps.length} MCP${guardedMcps.length === 1 ? '' : 's'} restored to direct access`,
          })
        }

        // Refresh MCP list to show updated status
        await this._sendMCPServers()
      } else {
        // For non-guard changes (e.g., context window size), still send settings back
        const updatedSettings = loadSettingsWithHydration(settingsPath, mcps)
        this._postMessage({ type: 'settings', data: updatedSettings })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._postMessage({
        type: 'error',
        message: `Failed to save settings: ${message}`,
      })
    }
  }

  /**
   * Save a single MCP config and update IDE config if guard status changed
   * isGuarded is derived from IDE config - when toggled, we update IDE config
   * @param config MCP security configuration
   * @param source Source IDE to modify - if provided, modifies that specific IDE's config
   */
  private async _saveMCPConfig(
    config: MCPSecurityConfig,
    source?: 'claude' | 'copilot' | 'cursor',
  ): Promise<void> {
    try {
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      let settings = loadSettingsWithHydration(settingsPath, mcps)

      // Check if guard status changed (compare against the correct IDE config)
      const wasGuarded = isMCPDisabled(config.mcpName, source)
      const isNowGuarded = config.isGuarded
      const guardStatusChanged = wasGuarded !== isNowGuarded

      // First, update IDE config if guard status changed
      // This is the source of truth for isGuarded
      if (guardStatusChanged) {
        // Invalidate cache when guard status changes to force fresh assessment
        invalidateMCPCache(config.mcpName)

        if (isNowGuarded) {
          // Disable MCP in IDE config (move to _mcpguard_disabled)
          const result = disableMCPInIDE(config.mcpName, source)
          if (result.success) {
            console.log(
              `MCP Guard: ${config.mcpName} disabled in IDE config${source ? ` (${source})` : ''}`,
            )
          } else {
            console.warn(
              `MCP Guard: Failed to disable ${config.mcpName} in IDE: ${result.message}`,
            )
          }

          // Also ensure mcpguard is in the config
          const extensionPath = this._extensionUri.fsPath
          ensureMCPGuardInConfig(extensionPath)
        } else {
          // Enable MCP in IDE config (restore from _mcpguard_disabled)
          const result = enableMCPInIDE(config.mcpName, source)
          if (result.success) {
            console.log(
              `MCP Guard: ${config.mcpName} enabled in IDE config${source ? ` (${source})` : ''}`,
            )
          } else {
            console.warn(
              `MCP Guard: Failed to enable ${config.mcpName} in IDE: ${result.message}`,
            )
          }
        }
      }

      // Reload MCPs and settings to get fresh isGuarded state from IDE config
      const updatedMcps = loadAllMCPServers()
      settings = loadSettingsWithHydration(settingsPath, updatedMcps)

      // Update or add the MCP config in settings (security settings only, not isGuarded)
      const existingIndex = settings.mcpConfigs.findIndex(
        (c) => c.id === config.id || c.mcpName === config.mcpName,
      )
      if (existingIndex >= 0) {
        // Keep the computed isGuarded from the correct IDE config
        settings.mcpConfigs[existingIndex] = {
          ...config,
          isGuarded: isMCPDisabled(config.mcpName, source),
        }
      } else {
        settings.mcpConfigs.push({
          ...config,
          isGuarded: isMCPDisabled(config.mcpName, source),
        })
      }

      // Save settings (dehydrates to remove isGuarded)
      saveSettingsWithDehydration(settingsPath, settings)

      // Always send updated settings back to ensure frontend is in sync
      // This is critical for toggles that need to persist across component unmount/remount
      const finalMcps = loadAllMCPServers()
      const updatedSettings = loadSettingsWithHydration(settingsPath, finalMcps)
      this._postMessage({ type: 'settings', data: updatedSettings })

      // Show appropriate success message
      if (guardStatusChanged) {
        const status = isNowGuarded ? 'guarded' : 'unguarded'
        this._postMessage({
          type: 'success',
          message: `${config.mcpName} is now ${status}`,
        })
      } else {
        this._postMessage({
          type: 'success',
          message: `Configuration for "${config.mcpName}" saved`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this._postMessage({
        type: 'error',
        message: `Failed to save MCP config: ${message}`,
      })
    }
  }

  /**
   * Import MCPs from IDE configs
   */
  private async _importFromIDE(): Promise<void> {
    await this._sendMCPServers()
    this._postMessage({
      type: 'success',
      message: 'MCPs imported from IDE configurations',
    })
  }

  /**
   * Assess token usage for a specific MCP
   */
  private async _assessTokensForMCP(mcpName: string): Promise<void> {
    const mcps = loadAllMCPServers()
    const server = mcps.find((m) => m.name === mcpName)

    if (!server) {
      this._postMessage({ type: 'error', message: `MCP ${mcpName} not found` })
      return
    }

    this._postMessage({
      type: 'tokenAssessmentProgress',
      mcpName,
      status: 'started',
    })

    try {
      const result = await assessMCPTokensWithError(server)

      // Save to settings cache
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      if (result.metrics) {
        if (!settings.tokenMetricsCache) {
          settings.tokenMetricsCache = {}
        }
        settings.tokenMetricsCache[mcpName] = result.metrics

        // Clear any previous error
        if (settings.assessmentErrorsCache?.[mcpName]) {
          delete settings.assessmentErrorsCache[mcpName]
        }

        saveSettingsWithDehydration(settingsPath, settings)
        this._postMessage({
          type: 'tokenAssessmentProgress',
          mcpName,
          status: 'completed',
        })
        await this._sendTokenSavings()
      } else if (result.error) {
        // Store the error
        if (!settings.assessmentErrorsCache) {
          settings.assessmentErrorsCache = {}
        }
        settings.assessmentErrorsCache[mcpName] = result.error
        saveSettingsWithDehydration(settingsPath, settings)

        this._postMessage({
          type: 'tokenAssessmentProgress',
          mcpName,
          status: 'failed',
        })
      }
    } catch (error) {
      console.error(`Token assessment failed for ${mcpName}:`, error)
      this._postMessage({
        type: 'tokenAssessmentProgress',
        mcpName,
        status: 'failed',
      })
    }
  }

  /**
   * Calculate and send token savings summary
   */
  private async _sendTokenSavings(): Promise<void> {
    try {
      const mcps = loadAllMCPServers()
      const settingsPath = getSettingsPath()
      const settings = loadSettingsWithHydration(settingsPath, mcps)

      this._log(`Loading settings from ${settingsPath}`)
      this._log(`Loaded settings with ${settings.mcpConfigs.length} configs`)
      this._log(
        `Configs: ${JSON.stringify(settings.mcpConfigs.map((c) => ({ name: c.mcpName, guarded: c.isGuarded })))}`,
      )

      this._log(
        `Found ${mcps.length} MCPs: ${mcps.map((m) => m.name).join(', ')}`,
      )

      const tokenCache = settings.tokenMetricsCache || {}

      const summary = calculateTokenSavings(
        mcps,
        settings.mcpConfigs,
        tokenCache,
      )
      this._log(`Token savings summary: ${JSON.stringify(summary)}`)

      this._postMessage({ type: 'tokenSavings', data: summary })
    } catch (error) {
      this._log(`Failed to calculate token savings: ${error}`)
    }
  }

  /**
   * Auto-assess tokens for MCPs that haven't been assessed yet
   * Runs in the background without blocking
   */
  private async _autoAssessTokens(): Promise<void> {
    const mcps = loadAllMCPServers()
    const settingsPath = getSettingsPath()
    const settings = loadSettingsWithHydration(settingsPath, mcps)

    const tokenCache = settings.tokenMetricsCache || {}
    const errorCache = settings.assessmentErrorsCache || {}

    // Find MCPs that need assessment (not in success cache AND not in error cache)
    const unassessedMCPs = mcps.filter(
      (m) => !tokenCache[m.name] && !errorCache[m.name] && (m.command || m.url),
    )

    if (unassessedMCPs.length === 0) {
      // All MCPs are already assessed (or have recorded errors), just send the summary
      await this._sendTokenSavings()
      return
    }

    console.log(
      `MCP Guard: Auto-assessing tokens for ${unassessedMCPs.length} MCP(s)...`,
    )

    // Assess each MCP (limit to 3 concurrent for performance)
    for (const server of unassessedMCPs.slice(0, 3)) {
      this._postMessage({
        type: 'tokenAssessmentProgress',
        mcpName: server.name,
        status: 'started',
      })

      try {
        const result = await assessMCPTokensWithError(server)

        if (result.metrics) {
          // Update success cache in memory
          if (!settings.tokenMetricsCache) {
            settings.tokenMetricsCache = {}
          }
          settings.tokenMetricsCache[server.name] = result.metrics
          tokenCache[server.name] = result.metrics

          // Clear any previous error
          if (settings.assessmentErrorsCache?.[server.name]) {
            delete settings.assessmentErrorsCache[server.name]
          }

          this._postMessage({
            type: 'tokenAssessmentProgress',
            mcpName: server.name,
            status: 'completed',
          })
        } else if (result.error) {
          // Store the error
          if (!settings.assessmentErrorsCache) {
            settings.assessmentErrorsCache = {}
          }
          settings.assessmentErrorsCache[server.name] = result.error

          this._postMessage({
            type: 'tokenAssessmentProgress',
            mcpName: server.name,
            status: 'failed',
          })
        }
      } catch (error) {
        console.error(`Auto-assessment failed for ${server.name}:`, error)
        this._postMessage({
          type: 'tokenAssessmentProgress',
          mcpName: server.name,
          status: 'failed',
        })
      }
    }

    // Save updated cache (dehydrates to remove isGuarded)
    saveSettingsWithDehydration(settingsPath, settings)

    // Send updated token savings
    await this._sendTokenSavings()
  }

  /**
   * Refresh the webview
   */
  public refresh(): void {
    if (this._view) {
      this._sendSettings()
      this._sendMCPServers()
    }
  }

  /**
   * Generate HTML content for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get the webview script URI
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js'),
    )

    // Generate a nonce for security
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>MCP Guard</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --bg-hover: var(--vscode-list-hoverBackground);
      --bg-active: var(--vscode-list-activeSelectionBackground);
      --text-primary: var(--vscode-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --text-muted: var(--vscode-disabledForeground);
      --border-color: var(--vscode-panel-border);
      --accent: #22c55e;
      --accent-secondary: #22c55e;
      --accent-light: rgba(34, 197, 94, 0.15);
      --success: #22c55e;
      --warning: var(--vscode-terminal-ansiYellow);
      --error: var(--vscode-errorForeground);
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-primary);
      background: var(--bg-primary);
      line-height: 1.5;
      padding: 0;
      min-height: 100vh;
    }

    #root {
      min-height: 100vh;
    }

    /* Loading spinner */
    .loading-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--text-muted);
      border-radius: 50%;
      border-top-color: #22c55e;
      animation: spin 1s ease-in-out infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .animate-fade-in {
      animation: fadeIn 0.2s ease-out;
    }

    .animate-slide-in {
      animation: slideIn 0.3s ease-out;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

/**
 * Generate a random nonce for CSP
 */
function getNonce(): string {
  let text = ''
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
