#!/usr/bin/env node

import * as readline from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import dotenv from 'dotenv'
import { MetricsCollector } from '../server/metrics-collector.js'
import { WorkerManager } from '../server/worker-manager.js'
import {
  ExecuteCodeRequestSchema,
  isCommandBasedConfig,
  LoadMCPRequestSchema,
  type MCPConfig,
  type MCPInstance,
} from '../types/mcp.js'
import { ConfigManager } from '../utils/config-manager.js'
import { selectEnvVarsInteractively } from '../utils/env-selector.js'
import logger from '../utils/logger.js'
import {
  createDefaultConfig,
  loadSettings,
  upsertMCPConfig,
} from '../utils/mcp-registry.js'
import { ProgressIndicator } from '../utils/progress-indicator.js'
import {
  invalidateMetricsCache,
  loadTokenMetrics,
  saveTokenMetrics,
} from '../utils/settings-manager.js'
import {
  assessCommandBasedMCP,
  calculatePercentage,
  calculateTokenSavings,
  formatTokens,
  type MCPTokenMetrics,
} from '../utils/token-calculator.js'
import { validateInput, validateTypeScriptCode } from '../utils/validation.js'
import { formatExecutionResult } from '../utils/wrangler-formatter.js'

// Load environment variables
dotenv.config()

// Set CLI mode for logger
process.env.CLI_MODE = 'true'

// Check for verbose flag
const verbose =
  process.argv.includes('--verbose') || process.argv.includes('-v')
if (verbose) {
  process.env.LOG_LEVEL = 'debug'
  logger.level = 'debug'
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'mcpguard> ',
})

const workerManager = new WorkerManager()
const metricsCollector = new MetricsCollector()
const configManager = new ConfigManager()

let isExiting = false

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve)
  })
}

async function loadMCP() {
  try {
    // Check for saved configs first
    const savedConfigs = configManager.getSavedConfigs()
    const savedNames = Object.keys(savedConfigs)

    if (savedNames.length > 0) {
      const sourceName = configManager.getConfigSourceDisplayName()
      console.log(`\n💾 Saved MCP configurations found (${sourceName}):`)
      savedNames.forEach((name, index) => {
        console.log(`  ${index + 1}. ${name}`)
      })
      console.log(`  ${savedNames.length + 1}. Load new MCP configuration\n`)

      const useSaved = await question(
        'Use saved config? Enter number or name (or "new" for new config): ',
      )
      const useSavedLower = useSaved.trim().toLowerCase()

      if (
        useSavedLower !== 'new' &&
        useSavedLower !== String(savedNames.length + 1)
      ) {
        // User wants to use a saved config
        let selectedName: string | null = null
        const selectedNum = parseInt(useSavedLower, 10)

        if (
          !Number.isNaN(selectedNum) &&
          selectedNum >= 1 &&
          selectedNum <= savedNames.length
        ) {
          selectedName = savedNames[selectedNum - 1]
        } else {
          // Try to find by name
          selectedName =
            savedNames.find((name) => name.toLowerCase() === useSavedLower) ||
            null
        }

        if (selectedName) {
          const savedConfig = configManager.getSavedConfig(selectedName)
          if (savedConfig) {
            console.log(`\n📋 Loading saved config: ${selectedName}`)

            const startTime = Date.now()
            const instance = await workerManager.loadMCP(
              selectedName,
              savedConfig,
            )
            const loadTime = Date.now() - startTime

            metricsCollector.recordMCPLoad(instance.mcp_id, loadTime)

            console.log(
              `\n✅ ${instance.mcp_name} loaded with ${instance.tools.length} ${instance.tools.length === 1 ? 'tool' : 'tools'}!`,
            )
            return
          }
        }
      }
    }

    // Load new MCP configuration
    const mcpName = await question('MCP name: ')
    const command = await question('Command (e.g., npx): ')
    const argsInput = await question(
      'Args (comma-separated, or press Enter for none): ',
    )
    const args = argsInput.trim()
      ? argsInput.split(',').map((s) => s.trim())
      : []

    // Check for IDE MCP conflicts
    const allSavedConfigs = configManager.getSavedConfigs()
    const conflictingMCP = allSavedConfigs[mcpName]
    if (conflictingMCP) {
      const sourceName = configManager.getConfigSourceDisplayName()
      console.log(
        `\n⚠️  Warning: An MCP named "${mcpName}" already exists in your ${sourceName} configuration.`,
      )
      console.log(
        `   If you're using mcpguard, consider disabling "${mcpName}" in your IDE's MCP settings`,
      )
      console.log(
        `   to avoid confusion. The IDE will use the real MCP, while mcpguard uses the sandboxed version.`,
      )
      const proceed = await question('\nContinue anyway? (y/N): ')
      if (proceed.trim().toLowerCase() !== 'y') {
        console.log('Cancelled.')
        return
      }
    }

    // Use interactive env var selector
    let env: Record<string, string> = {}
    try {
      env = await selectEnvVarsInteractively(rl)
    } catch (_error: any) {
      // Fallback to manual input if interactive selector fails
      console.log(
        '\n⚠️  Interactive selector failed, falling back to manual input.',
      )
      const envInput = await question(
        'Environment variables as JSON (or press Enter for none): ',
      )
      if (envInput.trim()) {
        try {
          env = JSON.parse(envInput.trim())
        } catch (_parseError) {
          console.error('❌ Invalid JSON. Proceeding without env vars.')
          env = {}
        }
      }
    }

    const config = {
      command,
      args: args.length > 0 ? args : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
    }

    const validated = validateInput(LoadMCPRequestSchema, {
      mcp_name: mcpName,
      mcp_config: config,
    })

    // Resolve environment variables before loading
    const resolvedConfig = configManager.resolveEnvVarsInObject(
      validated.mcp_config,
    ) as MCPConfig

    console.log('\nLoading MCP server...')
    const startTime = Date.now()
    const instance = await workerManager.loadMCP(
      validated.mcp_name,
      resolvedConfig,
    )
    const loadTime = Date.now() - startTime

    metricsCollector.recordMCPLoad(instance.mcp_id, loadTime)

    // Auto-save the configuration
    try {
      configManager.saveConfig(validated.mcp_name, validated.mcp_config)
      const configPath = configManager.getCursorConfigPath()
      const sourceName = configManager.getConfigSourceDisplayName()
      console.log(`\n💾 Configuration saved to ${sourceName}: ${configPath}`)
    } catch (error: any) {
      console.warn(
        `\n⚠️  Warning: Failed to save configuration: ${error.message}`,
      )
    }

    console.log(
      `\n✅ ${instance.mcp_name} loaded with ${instance.tools.length} ${instance.tools.length === 1 ? 'tool' : 'tools'}!`,
    )
  } catch (error: any) {
    console.error('\n❌ Error loading MCP:', error.message)
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2))
    }
  }
}

/**
 * Generate TypeScript code to call an MCP tool
 */
function generateToolCallCode(toolName: string, args: any): string {
  // Format args as a single-line JSON for cleaner code
  const argsJson = JSON.stringify(args)
  return `const result = await mcp.${toolName}(${argsJson});
console.log('Result:', JSON.stringify(result, null, 2));
return result;`
}

/**
 * Select a tool from available tools
 */
async function selectToolFromInstance(tools: any[]): Promise<any> {
  console.log('\n📋 Available Tools:')
  tools.forEach((tool, index) => {
    console.log(`  ${index + 1}. ${tool.name}`)
    if (tool.description) {
      console.log(`     ${tool.description}`)
    }
  })

  while (true) {
    const selection = await question(
      '\nSelect tool by number or name (or "exit" to quit): ',
    )
    const trimmed = selection.trim()

    if (trimmed.toLowerCase() === 'exit') {
      return null
    }

    const num = parseInt(trimmed, 10)
    if (!Number.isNaN(num) && num >= 1 && num <= tools.length) {
      return tools[num - 1]
    }

    const tool = tools.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (tool) {
      return tool
    }

    console.log('❌ Invalid selection. Please try again.')
  }
}

/**
 * Get required properties from schema
 */
function getRequiredProperties(schema: any): string[] {
  if (!schema || !schema.properties) {
    return []
  }
  return schema.required || []
}

/**
 * Parse value based on type
 */
function parseValue(value: string, type: string): any {
  if (type === 'number') {
    return parseFloat(value)
  } else if (type === 'boolean') {
    return value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
  } else if (type === 'array') {
    if (value.trim().startsWith('[')) {
      try {
        return JSON.parse(value)
      } catch {
        return value.split(',').map((v: string) => v.trim())
      }
    } else {
      return value.split(',').map((v: string) => v.trim())
    }
  } else if (type === 'object') {
    if (value.trim().startsWith('{')) {
      try {
        return JSON.parse(value)
      } catch {
        throw new Error('Invalid JSON object')
      }
    } else {
      throw new Error('Object type must be JSON')
    }
  } else {
    return value
  }
}

/**
 * Collect tool arguments interactively
 */
async function collectToolArguments(tool: any): Promise<any> {
  const args: any = {}
  const schema = tool.inputSchema

  if (
    !schema ||
    !schema.properties ||
    Object.keys(schema.properties).length === 0
  ) {
    console.log("\n💡 This tool doesn't require any arguments.")
    const useJson = await question(
      'Enter arguments as JSON (or press Enter to skip): ',
    )
    if (useJson.trim()) {
      try {
        return JSON.parse(useJson.trim())
      } catch (_e) {
        console.error('❌ Invalid JSON. Using empty arguments.')
        return {}
      }
    }
    return {}
  }

  console.log('\n📝 Enter tool arguments:')
  console.log(
    '   ──────────────────────────────────────────────────────────────',
  )
  console.log('   💡 Press Enter to use defaults or skip optional fields')
  console.log('   💡 Type "json" to enter full JSON object at once')
  console.log(
    '   ──────────────────────────────────────────────────────────────',
  )
  console.log('')

  const properties = schema.properties
  const required = getRequiredProperties(schema)

  // Process required fields first, then optional ones
  const allKeys = Object.keys(properties)
  const requiredKeys = allKeys.filter((key) => required.includes(key))
  const optionalKeys = allKeys.filter((key) => !required.includes(key))
  const orderedKeys = [...requiredKeys, ...optionalKeys]

  for (const key of orderedKeys) {
    const prop = properties[key]
    const propSchema = prop as any
    const isRequired = required.includes(key)
    const type = propSchema.type || 'string'
    const hasDefault = propSchema.default !== undefined
    const defaultValue = propSchema.default

    while (true) {
      // Build prompt with default value if available
      let promptText = `  ${key}${isRequired ? ' (required)' : ''}${propSchema.description ? ` - ${propSchema.description}` : ''}${type ? ` [${type}]` : ''}`
      if (hasDefault) {
        const defaultDisplay =
          typeof defaultValue === 'string'
            ? `"${defaultValue}"`
            : JSON.stringify(defaultValue)
        promptText += ` (default: ${defaultDisplay})`
      }
      promptText += ': '

      const value = await question(promptText)

      if (!value.trim()) {
        // User pressed Enter
        if (hasDefault) {
          // Use the default value
          args[key] = defaultValue
          break
        } else if (isRequired) {
          console.log('   ⚠️  This field is required and has no default.')
          continue
        } else {
          // Skip optional field without default
          break
        }
      }

      if (value.trim().toLowerCase() === 'json') {
        const jsonInput = await question('  Enter full JSON object: ')
        try {
          return JSON.parse(jsonInput.trim())
        } catch (_e) {
          console.error('   ❌ Invalid JSON. Please try again.')
          continue
        }
      }

      try {
        args[key] = parseValue(value.trim(), type)
        break
      } catch (e: any) {
        console.error(`   ❌ ${e.message}. Please try again.`)
      }
    }
  }

  return args
}

async function testTool() {
  try {
    // Get all saved configs and loaded instances
    const savedConfigs = configManager.getSavedConfigs()
    const loadedInstances = workerManager.listInstances()

    // Create a combined list of all available MCPs
    const allMCPs: Array<{
      name: string
      isLoaded: boolean
      instance?: any
      config?: any
    }> = []

    // Add all saved configs
    for (const [name, entry] of Object.entries(savedConfigs)) {
      const loadedInstance = workerManager.getMCPByName(name)
      allMCPs.push({
        name,
        isLoaded: !!loadedInstance,
        instance: loadedInstance,
        config: entry.config,
      })
    }

    // Add loaded instances that might not be in saved configs
    for (const instance of loadedInstances) {
      if (!savedConfigs[instance.mcp_name]) {
        allMCPs.push({
          name: instance.mcp_name,
          isLoaded: true,
          instance,
        })
      }
    }

    if (allMCPs.length === 0) {
      console.log(
        '\n📭 No MCP configurations found. Please load an MCP first using the "load" command.',
      )
      return
    }

    console.log('\n📋 Available MCP Servers:')
    allMCPs.forEach((mcp, index) => {
      const status = mcp.isLoaded
        ? `✅ Loaded (${mcp.instance?.status || 'active'})`
        : '⏳ Not loaded'
      console.log(`  ${index + 1}. ${mcp.name} - ${status}`)
    })

    const selection = await question(
      '\nSelect MCP by number or enter MCP name: ',
    )

    let selectedMCP: {
      name: string
      isLoaded: boolean
      instance?: MCPInstance
      config?: MCPConfig
    } | null = null
    const selectionNum = parseInt(selection.trim(), 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= allMCPs.length
    ) {
      // User selected by number
      selectedMCP = allMCPs[selectionNum - 1]
    } else {
      // User entered name
      const searchTerm = selection.trim().toLowerCase()
      const found = allMCPs.find((mcp) => mcp.name.toLowerCase() === searchTerm)

      if (!found) {
        console.error(`\n❌ MCP not found: ${selection}`)
        return
      }

      selectedMCP = found
    }

    // If not loaded, load it first
    let selectedInstance = selectedMCP.instance

    if (!selectedMCP.isLoaded) {
      if (!selectedMCP.config) {
        console.error(
          `\n❌ No configuration found for ${selectedMCP.name}. Please load it first using the "load" command.`,
        )
        return
      }

      console.log(`\n⏳ Loading ${selectedMCP.name}...`)
      try {
        const resolvedConfig = configManager.resolveEnvVarsInObject(
          selectedMCP.config,
        ) as MCPConfig
        const startTime = Date.now()
        selectedInstance = await workerManager.loadMCP(
          selectedMCP.name,
          resolvedConfig,
        )
        const loadTime = Date.now() - startTime

        metricsCollector.recordMCPLoad(selectedInstance.mcp_id, loadTime)

        console.log(
          `\n✅ ${selectedInstance.mcp_name} loaded with ${selectedInstance.tools.length} ${selectedInstance.tools.length === 1 ? 'tool' : 'tools'}!`,
        )
      } catch (error: any) {
        console.error(`\n❌ Error loading MCP: ${error.message}`)
        if (error.details) {
          console.error('Details:', JSON.stringify(error.details, null, 2))
        }
        return
      }
    } else if (selectedInstance) {
      console.log(
        `\n✅ Using already loaded: ${selectedInstance.mcp_name} (${selectedInstance.mcp_id})`,
      )
    }

    // Ensure instance is loaded
    if (!selectedInstance) {
      console.error('\n❌ Failed to load MCP instance')
      return
    }

    // Interactive tool selection and execution
    while (true) {
      const selectedTool = await selectToolFromInstance(selectedInstance.tools)

      if (!selectedTool) {
        break // User chose to exit
      }

      console.log(`\n🔧 Selected tool: ${selectedTool.name}`)
      if (selectedTool.description) {
        console.log(`   ${selectedTool.description}`)
      }

      const args = await collectToolArguments(selectedTool)

      // Generate TypeScript code to call the tool
      const code = generateToolCallCode(selectedTool.name, args)

      console.log(`\n📝 Generated TypeScript code:`)
      console.log('─'.repeat(60))
      console.log(code)
      console.log('─'.repeat(60))
      console.log('')

      // Default timeout to 15 seconds for test command
      const timeout = 15000

      console.log('\n🚀 Executing through WorkerManager (Wrangler)...\n')

      try {
        validateTypeScriptCode(code)

        const result = await workerManager.executeCode(
          selectedInstance.mcp_id,
          code,
          timeout,
        )

        metricsCollector.recordExecution(
          selectedInstance.mcp_id,
          result.execution_time_ms,
          result.success,
          result.metrics?.mcp_calls_made ?? 0,
        )

        console.log('\n✅ Execution result:')
        console.log(formatExecutionResult(result as any))
        console.log('')
      } catch (error: any) {
        console.error('\n❌ Execution failed:')
        console.error(`   ${error.message}`)
        if (error.details) {
          console.error('Details:', JSON.stringify(error.details, null, 2))
        }
        console.log('')
      }

      const continueChoice = await question('Test another tool? (Y/n): ')
      if (continueChoice.trim().toLowerCase() === 'n') {
        break
      }
    }
  } catch (error: any) {
    console.error('\n❌ Error testing tool:', error.message)
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2))
    }
  }
}

/**
 * Format tool result for direct MCP testing (simpler than Worker execution)
 */
function formatDirectToolResult(result: any): string {
  try {
    const jsonStr = JSON.stringify(result, null, 2)
    // Limit output to 2000 characters
    if (jsonStr.length > 2000) {
      return (
        jsonStr.substring(0, 2000) +
        `\n... (truncated, ${jsonStr.length - 2000} more characters)`
      )
    }
    return jsonStr
  } catch (e) {
    return String(result)
  }
}

/**
 * Test MCP directly without Wrangler/Worker isolation
 * Uses saved configs from IDE config file
 */
async function testDirect() {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const savedNames = Object.keys(savedConfigs)

    if (savedNames.length === 0) {
      console.log(
        '\n📭 No saved MCP configurations found. Please load an MCP first using the "load" command.',
      )
      return
    }

    console.log('\n📋 Available MCP Configurations:')
    savedNames.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`)
    })

    const selection = await question(
      '\nSelect MCP by number or name (or "exit" to quit): ',
    )
    const trimmed = selection.trim()

    if (trimmed.toLowerCase() === 'exit') {
      return
    }

    let selectedName: string | null = null
    const selectionNum = parseInt(trimmed, 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= savedNames.length
    ) {
      selectedName = savedNames[selectionNum - 1]
    } else {
      selectedName =
        savedNames.find(
          (name) => name.toLowerCase() === trimmed.toLowerCase(),
        ) || null
    }

    if (!selectedName) {
      console.error(`\n❌ MCP not found: ${selection}`)
      return
    }

    const savedConfig = configManager.getSavedConfig(selectedName)
    if (!savedConfig) {
      console.error(`\n❌ Configuration not found for: ${selectedName}`)
      return
    }

    // Resolve environment variables
    const resolvedConfig = configManager.resolveEnvVarsInObject(
      savedConfig,
    ) as MCPConfig

    // Check if it's a command-based config (not URL-based)
    if (!('command' in resolvedConfig)) {
      console.error(
        '\n❌ URL-based MCP configurations are not supported for direct testing.',
      )
      return
    }

    console.log(
      `\n🔍 Testing ${selectedName} directly (bypassing Wrangler)...\n`,
    )
    console.log('Configuration:')
    console.log(`  Command: ${resolvedConfig.command}`)
    console.log(`  Args: ${resolvedConfig.args?.join(' ') || 'none'}`)
    const envKeys = Object.keys(resolvedConfig.env || {})
    console.log(`  Env keys: ${envKeys.join(', ') || 'none'}`)
    console.log('')

    const transport = new StdioClientTransport({
      command: resolvedConfig.command,
      args: resolvedConfig.args || [],
      env: resolvedConfig.env,
    })

    const client = new Client(
      { name: 'mcpguard-cli-direct-test', version: '1.0.0' },
      { capabilities: {} },
    )

    try {
      const progress = new ProgressIndicator()
      ;(progress as any).steps = [
        { name: 'CLI', status: 'pending' },
        { name: 'MCP SDK Client', status: 'pending' },
        { name: 'Target MCP', status: 'pending' },
      ]

      console.log('📡 Connecting to MCP server...')
      progress.updateStep(0, 'running')
      progress.updateStep(1, 'running')

      await client.connect(transport, { timeout: 10000 })

      progress.updateStep(0, 'success')
      progress.updateStep(1, 'success')
      progress.updateStep(2, 'running')
      progress.showFinal()
      console.log('✅ Connected successfully!\n')

      console.log('📋 Fetching available tools...')
      const toolsResponse = await client.listTools()
      const tools = toolsResponse.tools
      progress.updateStep(2, 'success')
      progress.showFinal()
      console.log(`✅ Found ${tools.length} tools\n`)

      // Interactive tool selection and execution
      while (true) {
        const selectedTool = await selectToolFromInstance(tools)

        if (!selectedTool) {
          break // User chose to exit
        }

        console.log(`\n🔧 Selected tool: ${selectedTool.name}`)
        if (selectedTool.description) {
          console.log(`   ${selectedTool.description}`)
        }

        const args = await collectToolArguments(selectedTool)

        console.log(`\n🚀 Executing tool with arguments:`)
        console.log(JSON.stringify(args, null, 2))
        console.log('')

        const execProgress = new ProgressIndicator()
        ;(execProgress as any).steps = [
          { name: 'CLI', status: 'pending' },
          { name: 'MCP SDK Client', status: 'pending' },
          { name: 'Target MCP', status: 'pending' },
        ]
        execProgress.updateStep(0, 'success')
        execProgress.updateStep(1, 'running')
        execProgress.updateStep(2, 'running')

        try {
          const result = await client.callTool({
            name: selectedTool.name,
            arguments: args,
          })

          execProgress.updateStep(1, 'success')
          execProgress.updateStep(2, 'success')
          execProgress.showFinal()

          console.log('\n✅ Tool execution result:')
          console.log(formatDirectToolResult(result))
          console.log('')
        } catch (error: any) {
          execProgress.updateStep(1, 'failed')
          execProgress.updateStep(2, 'failed')
          execProgress.showFinal(2)

          console.error('\n❌ Tool execution failed:')
          console.error(`   ${error.message}`)
          if (error.stack) {
            console.error(`\nStack trace:\n${error.stack}`)
          }
          console.log('')
        }

        const continueChoice = await question('Test another tool? (Y/n): ')
        if (continueChoice.trim().toLowerCase() === 'n') {
          break
        }
      }

      await transport.close()
      console.log('\n✅ Test session completed!\n')
    } catch (error: any) {
      console.error('\n❌ Error testing MCP:')
      console.error(`   ${error.message}`)
      if (error.stack) {
        console.error(`\nStack trace:\n${error.stack}`)
      }
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2))
    }
  }
}

async function executeCode() {
  try {
    // First, show available MCPs
    const instances = workerManager.listInstances()

    if (instances.length === 0) {
      console.log(
        '\n📭 No MCP servers loaded. Please load an MCP first using the "load" command.',
      )
      return
    }

    console.log('\n📋 Available MCP Servers:')
    instances.forEach((instance, index) => {
      console.log(
        `  ${index + 1}. ${instance.mcp_name} - Status: ${instance.status}`,
      )
    })

    const selection = await question(
      '\nSelect MCP by number or enter MCP ID/name: ',
    )

    let selectedInstance
    const selectionNum = parseInt(selection.trim(), 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= instances.length
    ) {
      // User selected by number
      selectedInstance = instances[selectionNum - 1]
    } else {
      // User entered ID or name
      const searchTerm = selection.trim().toLowerCase()
      selectedInstance = instances.find(
        (inst) =>
          inst.mcp_id.toLowerCase() === searchTerm ||
          inst.mcp_name.toLowerCase() === searchTerm,
      )

      if (!selectedInstance) {
        console.error(`\n❌ MCP not found: ${selection}`)
        return
      }
    }

    console.log(
      `\n✅ Selected: ${selectedInstance.mcp_name} (${selectedInstance.mcp_id})`,
    )
    console.log('Enter TypeScript code (end with a blank line):')

    const lines: string[] = []
    while (true) {
      const line = await question('')
      if (line.trim() === '' && lines.length > 0) {
        break
      }
      if (line.trim() !== '') {
        lines.push(line)
      }
    }

    const code = lines.join('\n')
    const timeoutInput = await question('Timeout (ms, default 30000): ')
    const timeout = timeoutInput.trim() ? parseInt(timeoutInput, 10) : 30000

    const validated = validateInput(ExecuteCodeRequestSchema, {
      mcp_id: selectedInstance.mcp_id,
      code,
      timeout_ms: timeout,
    })

    validateTypeScriptCode(validated.code)

    // CLI always provides mcp_id, so it's safe to assert
    if (!validated.mcp_id) {
      throw new Error('mcp_id is required in CLI mode')
    }

    console.log('\nExecuting code...\n')
    const result = await workerManager.executeCode(
      validated.mcp_id,
      validated.code,
      validated.timeout_ms,
    )

    metricsCollector.recordExecution(
      validated.mcp_id,
      result.execution_time_ms,
      result.success,
      result.metrics?.mcp_calls_made ?? 0,
    )

    console.log(formatExecutionResult(result as any))
  } catch (error: any) {
    console.error('\n❌ Error executing code:', error.message)
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2))
    }
  }
}

async function listMCPs() {
  const instances = workerManager.listInstances()
  const savedConfigs = configManager.getSavedConfigs()
  const disabledMCPs = configManager.getDisabledMCPNames()

  if (instances.length === 0) {
    console.log('\n📭 No MCP servers loaded.')

    // Show quick token savings summary even if no MCPs loaded
    if (Object.keys(savedConfigs).length > 0) {
      const guardedCount = disabledMCPs.length
      if (guardedCount > 0) {
        console.log(
          `\n💡 ${guardedCount} MCP${guardedCount === 1 ? '' : 's'} configured for guarding: ${disabledMCPs.join(', ')}`,
        )
        console.log(
          `   Run 'load' to load an MCP, then 'savings' to see token savings`,
        )
      }
    }
    return
  }

  console.log('\n📋 Loaded MCP Servers:')
  instances.forEach((instance) => {
    const isGuarded = disabledMCPs.includes(instance.mcp_name)
    const guardStatus = isGuarded ? '🛡️  Guarded' : '⚠️  Unguarded'

    console.log(
      JSON.stringify(
        {
          mcp_id: instance.mcp_id,
          mcp_name: instance.mcp_name,
          status: instance.status,
          guard_status: guardStatus,
          uptime_ms: instance.uptime_ms,
          tools_count: instance.tools.length,
          created_at: instance.created_at.toISOString(),
        },
        null,
        2,
      ),
    )
  })

  // Token savings summary
  const allMCPs = Object.entries(savedConfigs).map(([name]) => ({
    name,
    isGuarded: disabledMCPs.includes(name),
    metrics: tokenMetricsCache.get(name),
    toolCount: workerManager.getMCPByName(name)?.tools.length,
  }))

  const summary = calculateTokenSavings(allMCPs)

  if (summary.guardedMCPs > 0 || summary.tokensSaved > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Token Savings Summary:')
    if (summary.tokensSaved > 0) {
      const savingsPercent = calculatePercentage(
        summary.tokensSaved,
        summary.totalTokensWithoutGuard,
      )
      console.log(
        `  💰 Saving ~${formatTokens(summary.tokensSaved)} tokens (${savingsPercent}% reduction)`,
      )
      console.log(
        `  🛡️  ${summary.guardedMCPs} MCP${summary.guardedMCPs === 1 ? '' : 's'} guarded`,
      )
    } else {
      console.log(
        `  ⚠️  No token savings yet - run 'guard --all' to protect MCPs`,
      )
    }
    console.log(`\n  Run 'savings' for detailed breakdown`)
  }
}

async function getSchema() {
  try {
    const instances = workerManager.listInstances()

    if (instances.length === 0) {
      console.log(
        '\n📭 No MCP servers loaded. Please load an MCP first using the "load" command.',
      )
      return
    }

    console.log('\n📋 Available MCP Servers:')
    instances.forEach((instance, index) => {
      console.log(
        `  ${index + 1}. ${instance.mcp_name} - Status: ${instance.status}`,
      )
    })

    const selection = await question(
      '\nSelect MCP by number or enter MCP ID/name: ',
    )

    let selectedInstance
    const selectionNum = parseInt(selection.trim(), 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= instances.length
    ) {
      selectedInstance = instances[selectionNum - 1]
    } else {
      const searchTerm = selection.trim().toLowerCase()
      selectedInstance = instances.find(
        (inst) =>
          inst.mcp_id.toLowerCase() === searchTerm ||
          inst.mcp_name.toLowerCase() === searchTerm,
      )

      if (!selectedInstance) {
        console.error(`\n❌ MCP not found: ${selection}`)
        return
      }
    }

    const instance = workerManager.getInstance(selectedInstance.mcp_id)
    if (!instance) {
      console.error(`\n❌ MCP instance not found: ${selectedInstance.mcp_id}`)
      return
    }

    console.log(`\n✅ Selected: ${instance.mcp_name} (${instance.mcp_id})`)
    console.log('\n📝 TypeScript API:')
    console.log(instance.typescript_api)
    console.log('\n🔧 Available Tools:')
    instance.tools.forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description || 'No description'}`)
    })
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
  }
}

async function unloadMCP() {
  try {
    const instances = workerManager.listInstances()

    if (instances.length === 0) {
      console.log('\n📭 No MCP servers loaded. Nothing to unload.')
      return
    }

    console.log('\n📋 Available MCP Servers:')
    instances.forEach((instance, index) => {
      console.log(
        `  ${index + 1}. ${instance.mcp_name} - Status: ${instance.status}`,
      )
    })

    const selection = await question(
      '\nSelect MCP to unload by number or enter MCP ID/name: ',
    )

    let selectedInstance
    const selectionNum = parseInt(selection.trim(), 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= instances.length
    ) {
      selectedInstance = instances[selectionNum - 1]
    } else {
      const searchTerm = selection.trim().toLowerCase()
      selectedInstance = instances.find(
        (inst) =>
          inst.mcp_id.toLowerCase() === searchTerm ||
          inst.mcp_name.toLowerCase() === searchTerm,
      )

      if (!selectedInstance) {
        console.error(`\n❌ MCP not found: ${selection}`)
        return
      }
    }

    const removeFromSaved = await question(
      `\nAlso remove ${selectedInstance.mcp_name} from saved configs? (y/N): `,
    )
    const shouldRemove = removeFromSaved.trim().toLowerCase() === 'y'

    console.log(
      `\n⚠️  Unloading: ${selectedInstance.mcp_name} (${selectedInstance.mcp_id})`,
    )
    await workerManager.unloadMCP(selectedInstance.mcp_id)

    if (shouldRemove) {
      try {
        const removed = configManager.deleteConfig(selectedInstance.mcp_name)
        if (removed) {
          console.log(`\n💾 Configuration removed from saved configs.`)
        }
      } catch (error: any) {
        console.warn(
          `\n⚠️  Warning: Failed to remove from saved configs: ${error.message}`,
        )
      }
    }

    console.log(
      `\n✅ MCP server ${selectedInstance.mcp_name} unloaded successfully.`,
    )
  } catch (error: any) {
    console.error('\n❌ Error unloading MCP:', error.message)
  }
}

async function getMetrics() {
  const metrics = metricsCollector.getMetrics()
  console.log('\n📊 Metrics:')
  console.log(JSON.stringify(metrics, null, 2))
}

async function listSavedConfigs() {
  const savedConfigs = configManager.getSavedConfigs()
  const configPath = configManager.getCursorConfigPath()
  const sourceName = configManager.getConfigSourceDisplayName()

  if (Object.keys(savedConfigs).length === 0) {
    console.log('\n📭 No saved MCP configurations found.')
    if (configPath) {
      console.log(`   Config file location: ${configPath}`)
    } else {
      console.log(
        `   ${sourceName} config file not found. Configs will be saved when you load an MCP.`,
      )
    }
    return
  }

  console.log(`\n💾 Saved MCP Configurations (${sourceName}):`)
  if (configPath) {
    console.log(`   Config file: ${configPath}\n`)
  }

  Object.entries(savedConfigs).forEach(([name, entry], index) => {
    console.log(`  ${index + 1}. ${name}`)
    const config = entry.config
    if (isCommandBasedConfig(config)) {
      console.log(`     Command: ${config.command}`)
      if (config.args) {
        console.log(`     Args: ${config.args.join(' ')}`)
      }
      if (config.env) {
        const envKeys = Object.keys(config.env)
        console.log(`     Env vars: ${envKeys.length} variable(s)`)
        envKeys.forEach((key) => {
          const value = config.env![key]
          // Don't show full values, just indicate if it's an env var reference
          if (value && value.startsWith('${') && value.endsWith('}')) {
            console.log(`       ${key}: ${value}`)
          } else {
            console.log(`       ${key}: [hidden]`)
          }
        })
      }
    } else {
      console.log(`     URL: ${config.url}`)
    }
    console.log('')
  })
}

async function checkIDEConflicts() {
  const savedConfigs = configManager.getSavedConfigs()
  const loadedInstances = workerManager.listInstances()
  const sourceName = configManager.getConfigSourceDisplayName()

  if (Object.keys(savedConfigs).length === 0) {
    console.log('\n📭 No MCP configurations found in your IDE.')
    return
  }

  console.log(
    `\n🔍 Checking for potential IDE MCP conflicts (${sourceName}):\n`,
  )

  const conflicts: Array<{ name: string; inIDE: boolean; inIsolate: boolean }> =
    []

  // Check which MCPs are in IDE config
  for (const [name] of Object.entries(savedConfigs)) {
    const inIsolate = loadedInstances.some((inst) => inst.mcp_name === name)
    conflicts.push({
      name,
      inIDE: true,
      inIsolate,
    })
  }

  // Check which loaded MCPs might conflict
  for (const instance of loadedInstances) {
    if (!savedConfigs[instance.mcp_name]) {
      conflicts.push({
        name: instance.mcp_name,
        inIDE: false,
        inIsolate: true,
      })
    }
  }

  if (conflicts.length === 0) {
    console.log('✅ No conflicts detected.')
    return
  }

  let hasConflicts = false
  conflicts.forEach((conflict) => {
    if (conflict.inIDE && conflict.inIsolate) {
      hasConflicts = true
      console.log(
        `⚠️  "${conflict.name}" is configured in both your IDE and mcpguard`,
      )
      console.log(
        `   Recommendation: Disable "${conflict.name}" in your IDE's MCP settings`,
      )
      console.log(
        `   to avoid confusion. The IDE will use the real MCP, while mcpguard`,
      )
      console.log(`   uses the sandboxed version.\n`)
    } else if (conflict.inIDE && !conflict.inIsolate) {
      console.log(
        `ℹ️  "${conflict.name}" is configured in your IDE but not loaded in mcpguard`,
      )
      console.log(
        `   This is fine - they won't conflict unless you load it here.\n`,
      )
    }
  })

  if (hasConflicts) {
    console.log('💡 Tip: To disable an MCP in your IDE:')
    console.log(`   1. Open your ${sourceName} MCP configuration file`)
    console.log(
      `   2. Comment out or remove the "${conflicts.find((c) => c.inIDE && c.inIsolate)?.name}" entry`,
    )
    console.log(`   3. Restart your IDE\n`)
  }
}

async function deleteSavedConfig() {
  const savedConfigs = configManager.getSavedConfigs()
  const savedNames = Object.keys(savedConfigs)

  if (savedNames.length === 0) {
    console.log('\n📭 No saved MCP configurations to delete.')
    return
  }

  console.log('\n💾 Saved MCP Configurations:')
  savedNames.forEach((name, index) => {
    console.log(`  ${index + 1}. ${name}`)
  })

  const selection = await question(
    '\nSelect config to delete by number or name: ',
  )

  let selectedName: string | null = null
  const selectionNum = parseInt(selection.trim(), 10)

  if (
    !Number.isNaN(selectionNum) &&
    selectionNum >= 1 &&
    selectionNum <= savedNames.length
  ) {
    selectedName = savedNames[selectionNum - 1]
  } else {
    selectedName =
      savedNames.find(
        (name) => name.toLowerCase() === selection.trim().toLowerCase(),
      ) || null
  }

  if (!selectedName) {
    console.error(`\n❌ Config not found: ${selection}`)
    return
  }

  const confirmed = await question(
    `\n⚠️  Delete saved config "${selectedName}"? (y/N): `,
  )
  if (confirmed.trim().toLowerCase() !== 'y') {
    console.log('Cancelled.')
    return
  }

  try {
    const deleted = configManager.deleteConfig(selectedName)
    if (deleted) {
      console.log(`\n✅ Configuration "${selectedName}" deleted successfully.`)
    } else {
      console.error(`\n❌ Failed to delete configuration "${selectedName}".`)
    }
  } catch (error: any) {
    console.error(`\n❌ Error deleting config: ${error.message}`)
  }
}

// Legacy install/restore functions removed - transparent proxy mode makes them unnecessary
// MCPGuard automatically discovers and guards all configured MCPs without config modifications

// Token metrics cache (loaded from disk, shared with VSCode extension)
const tokenMetricsCache = loadTokenMetrics()

/**
 * Show token savings analysis
 */
async function showSavings() {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const loadedInstances = workerManager.listInstances()

    if (
      Object.keys(savedConfigs).length === 0 &&
      loadedInstances.length === 0
    ) {
      console.log(
        '\n📭 No MCP configurations found. Load an MCP first using the "load" command.',
      )
      return
    }

    // Build MCP list with guarded status
    const allMCPs: Array<{
      name: string
      isGuarded: boolean
      metrics?: MCPTokenMetrics
      toolCount?: number
    }> = []

    // Check which MCPs are guarded (in _mcpguard_disabled section)
    const disabledMCPs = configManager.getDisabledMCPNames()

    for (const [name, entry] of Object.entries(savedConfigs)) {
      const isGuarded = disabledMCPs.includes(name)
      const instance = workerManager.getMCPByName(name)

      // Try to get cached metrics
      let metrics = tokenMetricsCache.get(name)

      // If not cached and guarded, assess it
      if (!metrics && isGuarded) {
        console.log(`\nAssessing ${name}...`)
        const assessedMetrics = await assessCommandBasedMCP(name, entry.config)
        if (assessedMetrics) {
          metrics = assessedMetrics
          tokenMetricsCache.set(name, metrics)
          // Persist to disk after assessment
          saveTokenMetrics(tokenMetricsCache)
        }
      }

      allMCPs.push({
        name,
        isGuarded,
        metrics,
        toolCount: instance?.tools.length,
      })
    }

    // Add loaded instances not in saved configs
    for (const instance of loadedInstances) {
      if (!savedConfigs[instance.mcp_name]) {
        allMCPs.push({
          name: instance.mcp_name,
          isGuarded: disabledMCPs.includes(instance.mcp_name),
          toolCount: instance.tools.length,
        })
      }
    }

    const summary = calculateTokenSavings(allMCPs)

    console.log('\n📊 Token Savings Analysis')
    console.log('════════════════════════════════════════════════════════════')
    console.log(
      `  Without MCPGuard: ${formatTokens(summary.totalTokensWithoutGuard)} tokens`,
    )
    console.log(
      `  With MCPGuard:    ${formatTokens(summary.mcpGuardTokens)} tokens (MCPGuard's ${summary.mcpGuardTokens} tools)`,
    )
    console.log('  ─────────────────────────────────────────────────────────')

    if (summary.tokensSaved > 0) {
      const savingsPercent = calculatePercentage(
        summary.tokensSaved,
        summary.totalTokensWithoutGuard,
      )
      console.log(
        `  Net Savings:      ${formatTokens(summary.tokensSaved)} tokens (${savingsPercent}% reduction)`,
      )
    } else {
      console.log(`  Net Savings:      0 tokens (no MCPs guarded)`)
    }

    console.log('════════════════════════════════════════════════════════════')

    // Show guarded MCPs
    const guardedMCPs = summary.mcpBreakdown.filter((m) => m.isGuarded)
    if (guardedMCPs.length > 0) {
      console.log('\nGuarded MCPs:')
      for (const mcp of guardedMCPs) {
        const assessed = mcp.isAssessed ? '' : ' (estimated)'
        const tools = mcp.toolCount > 0 ? ` (${mcp.toolCount} tools)` : ''
        console.log(
          `  ✓ ${mcp.name}: ~${formatTokens(mcp.tokens)} tokens${tools}${assessed}`,
        )
      }
    }

    // Show unguarded MCPs
    const unguardedMCPs = summary.mcpBreakdown.filter((m) => !m.isGuarded)
    if (unguardedMCPs.length > 0) {
      console.log('\nUnguarded MCPs:')
      for (const mcp of unguardedMCPs) {
        const mcpMetrics = tokenMetricsCache.get(mcp.name)
        const tokens = mcpMetrics
          ? ` (~${formatTokens(mcpMetrics.estimatedTokens)} tokens)`
          : ''
        const tools = mcp.toolCount > 0 ? ` (${mcp.toolCount} tools)` : ''
        console.log(
          `  ⚠ ${mcp.name}${tools}${tokens} - Run 'guard ${mcp.name}' to save tokens`,
        )
      }
      console.log(
        `\n💡 Tip: Run 'guard --all' to guard all MCPs and maximize token savings`,
      )
    }

    if (summary.hasEstimates) {
      console.log(
        '\n💡 Note: Some MCPs are using estimated tokens. Assessments happen automatically when you load them.',
      )
    }
  } catch (error: any) {
    console.error('\n❌ Error calculating token savings:', error.message)
    if (error.stack && verbose) {
      console.error(error.stack)
    }
  }
}

/**
 * Guard or unguard an MCP
 */
async function guardMCP(mcpName: string, shouldGuard: boolean) {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const disabledMCPs = configManager.getDisabledMCPNames()

    // Handle --all flag
    if (mcpName === '--all') {
      const allNames = Object.keys(savedConfigs)
      if (allNames.length === 0) {
        console.log('\n📭 No MCP configurations found.')
        return
      }

      if (shouldGuard) {
        // Guard all
        let guardedCount = 0
        for (const name of allNames) {
          if (!disabledMCPs.includes(name)) {
            configManager.disableMCP(name)
            guardedCount++
          }
        }
        console.log(`\n✓ Guarding all ${allNames.length} MCPs...`)
        console.log(`  ${allNames.join(', ')}`)
        if (guardedCount > 0) {
          console.log(`\n💡 Run 'savings' to see token savings estimate`)
        }
      } else {
        // Unguard all
        let unguardedCount = 0
        for (const name of allNames) {
          if (disabledMCPs.includes(name)) {
            configManager.enableMCP(name)
            unguardedCount++
          }
        }
        console.log(
          `\n⚠ Removed MCPGuard protection from all ${unguardedCount} MCPs`,
        )
        console.log(`  All MCPs now have direct access to your system`)
      }
      return
    }

    // Single MCP guard/unguard
    if (!savedConfigs[mcpName]) {
      console.error(`\n❌ MCP not found: ${mcpName}`)
      console.log('\nAvailable MCPs:')
      Object.keys(savedConfigs).forEach((name) => console.log(`  - ${name}`))
      return
    }

    const isCurrentlyGuarded = disabledMCPs.includes(mcpName)

    if (shouldGuard) {
      if (isCurrentlyGuarded) {
        console.log(`\n${mcpName} is already guarded`)
        return
      }

      configManager.disableMCP(mcpName)
      console.log(`\n✓ ${mcpName} moved to MCPGuard protection`)
      console.log(
        `  Network: Isolated (use 'configure ${mcpName}' to allow domains)`,
      )
      console.log(
        `  Filesystem: Isolated (use 'configure ${mcpName}' to allow paths)`,
      )

      // Try to show token savings
      const config = savedConfigs[mcpName].config
      const metrics = await assessCommandBasedMCP(mcpName, config)
      if (metrics) {
        tokenMetricsCache.set(mcpName, metrics)
        // Persist to disk after assessment
        saveTokenMetrics(tokenMetricsCache)
        console.log(
          `  Token savings: ~${formatTokens(metrics.estimatedTokens)} tokens`,
        )
      }
    } else {
      if (!isCurrentlyGuarded) {
        console.log(`\n${mcpName} is not currently guarded`)
        return
      }

      configManager.enableMCP(mcpName)
      // Invalidate cache when unguarding (metrics may change)
      invalidateMetricsCache(mcpName)
      console.log(`\n⚠ ${mcpName} removed from MCPGuard protection`)
      console.log(`  This MCP now has direct access to your system`)
    }
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`)
    if (error.stack && verbose) {
      console.error(error.stack)
    }
  }
}

/**
 * Diagnose MCP connection issues
 */
async function diagnoseMCP() {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const savedNames = Object.keys(savedConfigs)

    if (savedNames.length === 0) {
      console.log('\n📭 No MCP configurations found.')
      return
    }

    console.log('\n📋 Available MCP Configurations:')
    savedNames.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`)
    })

    const selection = await question(
      '\nSelect MCP to diagnose by number or name (or "exit" to quit): ',
    )
    const trimmed = selection.trim()

    if (trimmed.toLowerCase() === 'exit') {
      return
    }

    let selectedName: string | null = null
    const selectionNum = parseInt(trimmed, 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= savedNames.length
    ) {
      selectedName = savedNames[selectionNum - 1]
    } else {
      selectedName =
        savedNames.find(
          (name) => name.toLowerCase() === trimmed.toLowerCase(),
        ) || null
    }

    if (!selectedName) {
      console.error(`\n❌ MCP not found: ${selection}`)
      return
    }

    const savedConfig = configManager.getSavedConfig(selectedName)
    if (!savedConfig) {
      console.error(`\n❌ Configuration not found for: ${selectedName}`)
      return
    }

    // Resolve environment variables
    const resolvedConfig = configManager.resolveEnvVarsInObject(
      savedConfig,
    ) as MCPConfig

    console.log(`\n🔍 Diagnosing ${selectedName}...`)
    console.log('')

    // Step 1: Validate configuration
    console.log('[1/4] Validate Configuration')
    if ('command' in resolvedConfig) {
      console.log(`  ✓ Command: ${resolvedConfig.command}`)
      if (resolvedConfig.args) {
        console.log(`    Args: ${resolvedConfig.args.join(' ')}`)
      }
      const envKeys = Object.keys(resolvedConfig.env || {})
      if (envKeys.length > 0) {
        console.log(`    Env vars: ${envKeys.join(', ')}`)
      }
    } else if ('url' in resolvedConfig) {
      console.log(`  ✓ URL: ${resolvedConfig.url}`)
      if (resolvedConfig.headers) {
        const headerKeys = Object.keys(resolvedConfig.headers)
        console.log(`    Headers: ${headerKeys.join(', ')}`)
      }
    } else {
      console.log('  ✗ No command or URL configured')
      return
    }
    console.log('')

    // Step 2: Test MCP connection
    console.log('[2/4] Test MCP Connection')

    if ('command' in resolvedConfig) {
      // Command-based MCP
      console.log('  Testing command-based MCP...')

      const transport = new StdioClientTransport({
        command: resolvedConfig.command,
        args: resolvedConfig.args || [],
        env: resolvedConfig.env,
      })

      const client = new Client(
        { name: 'mcpguard-cli-diagnose', version: '1.0.0' },
        { capabilities: {} },
      )

      try {
        const progress = new ProgressIndicator()
        ;(progress as any).steps = [
          { name: 'CLI', status: 'pending' },
          { name: 'MCP SDK Client', status: 'pending' },
          { name: 'Target MCP', status: 'pending' },
        ]

        progress.updateStep(0, 'running')
        progress.updateStep(1, 'running')

        await client.connect(transport, { timeout: 10000 })

        progress.updateStep(0, 'success')
        progress.updateStep(1, 'success')
        progress.updateStep(2, 'running')
        progress.showFinal()
        console.log('  ✓ Connected successfully\n')

        // Step 3: Fetch tools
        console.log('[3/4] Fetch Tools List')
        const toolsResponse = await client.listTools()
        const tools = toolsResponse.tools

        progress.updateStep(2, 'success')
        progress.showFinal()
        console.log(`  ✓ Found ${tools.length} tools\n`)

        // Step 4: Summary
        console.log('[4/4] Summary')
        console.log(`  ✓ MCP "${selectedName}" is working correctly`)
        console.log(`  ✓ Available tools: ${tools.length}`)
        if (tools.length > 0) {
          console.log('\n  Top tools:')
          tools.slice(0, 5).forEach((tool) => {
            console.log(
              `    - ${tool.name}${tool.description ? `: ${tool.description}` : ''}`,
            )
          })
          if (tools.length > 5) {
            console.log(`    ... and ${tools.length - 5} more`)
          }
        }

        await transport.close()
      } catch (error: any) {
        console.log(`  ✗ Connection failed: ${error.message}\n`)

        console.log('[3/4] Troubleshooting')
        console.log('  Possible issues:')
        console.log('    - Command not found or not executable')
        console.log('    - Missing dependencies (npm packages, etc.)')
        console.log('    - Incorrect environment variables')
        console.log('    - MCP server crashed on startup')
        console.log('\n  Try:')
        console.log(
          `    1. Run the command manually: ${resolvedConfig.command} ${resolvedConfig.args?.join(' ') || ''}`,
        )
        console.log('    2. Check MCP server logs for errors')
        console.log('    3. Verify all required environment variables are set')
      }
    } else if ('url' in resolvedConfig) {
      // URL-based MCP - not implemented in CLI yet
      console.log('  ⚠️  URL-based MCP diagnostics not yet supported in CLI')
      console.log(`  URL: ${resolvedConfig.url}`)
      console.log(
        '\n  To test URL-based MCPs, use the VSCode extension or test-direct command',
      )
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack && verbose) {
      console.error(error.stack)
    }
  }
}

/**
 * Configure MCP security settings
 * Note: This is a simplified CLI version. Full configuration UI is available in the VS Code extension.
 */
async function configureMCP() {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const disabledMCPs = configManager.getDisabledMCPNames()
    const savedNames = Object.keys(savedConfigs)

    if (savedNames.length === 0) {
      console.log('\n📭 No MCP configurations found.')
      return
    }

    console.log('\n📋 Available MCP Configurations:')
    savedNames.forEach((name, index) => {
      const isGuarded = disabledMCPs.includes(name)
      const guardStatus = isGuarded ? '🛡️  Guarded' : '⚠️  Unguarded'
      console.log(`  ${index + 1}. ${name} ${guardStatus}`)
    })

    const selection = await question(
      '\nSelect MCP to configure by number or name (or "exit" to quit): ',
    )
    const trimmed = selection.trim()

    if (trimmed.toLowerCase() === 'exit') {
      return
    }

    let selectedName: string | null = null
    const selectionNum = parseInt(trimmed, 10)

    if (
      !Number.isNaN(selectionNum) &&
      selectionNum >= 1 &&
      selectionNum <= savedNames.length
    ) {
      selectedName = savedNames[selectionNum - 1]
    } else {
      selectedName =
        savedNames.find(
          (name) => name.toLowerCase() === trimmed.toLowerCase(),
        ) || null
    }

    if (!selectedName) {
      console.error(`\n❌ MCP not found: ${selection}`)
      return
    }

    const isGuarded = disabledMCPs.includes(selectedName)

    console.log(`\n⚙️  Configuration: ${selectedName}`)
    console.log('════════════════════════════════════════════════════════════')
    console.log(
      `  Status: ${isGuarded ? '🛡️  Guarded (Protected by MCPGuard)' : '⚠️  Unguarded (Direct access)'}`,
    )
    console.log('')

    if (!isGuarded) {
      console.log('  ⚠️  This MCP is not guarded.')
      console.log('  Network: Direct access (no isolation)')
      console.log('  Filesystem: Direct access (no isolation)')
      console.log('')
      console.log(
        `  Run 'guard ${selectedName}' to enable MCPGuard protection.`,
      )
      return
    }

    // Show current configuration (defaults for CLI - full config in extension)
    console.log('  Current Settings (CLI defaults):')
    console.log('    Network: Isolated (no external network access)')
    console.log('    Filesystem: Isolated (no filesystem access)')
    console.log('    Resource Limits:')
    console.log('      - Max execution time: 30000ms')
    console.log('      - Max memory: 128MB')
    console.log('      - Max MCP calls: 100')
    console.log('')
    console.log('  ℹ️  Advanced Configuration:')
    console.log(
      '     Network allowlists, filesystem paths, and custom resource',
    )
    console.log('     limits can be configured using the VSCode extension.')
    console.log('')
    console.log('     For now, the CLI uses secure defaults:')
    console.log('       • Complete network isolation')
    console.log('       • No filesystem access')
    console.log('       • Standard resource limits')
    console.log('')
    console.log('  Quick Actions:')
    console.log(
      `    • unguard ${selectedName}  - Remove protection (not recommended)`,
    )
    console.log(`    • test ${selectedName}      - Test this MCP's tools`)
    console.log(`    • diagnose ${selectedName}  - Test connection`)
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack && verbose) {
      console.error(error.stack)
    }
  }
}

/**
 * Show status overview
 */
async function showStatus() {
  try {
    const savedConfigs = configManager.getSavedConfigs()
    const loadedInstances = workerManager.listInstances()
    const disabledMCPs = configManager.getDisabledMCPNames()
    const sourceName = configManager.getConfigSourceDisplayName()

    const totalMCPs = Object.keys(savedConfigs).length
    const guardedCount = disabledMCPs.length
    const unguardedCount = totalMCPs - guardedCount
    const loadedCount = loadedInstances.length

    console.log('\nMCP Guard Status')
    console.log('════════════════════════════════════════════════════════════')

    // Global state
    const globalEnabled = true // MCPGuard is always enabled in CLI mode
    console.log(
      `  Global Protection: ${globalEnabled ? '✓ ENABLED' : '✗ DISABLED'}`,
    )

    // MCP counts
    console.log(
      `  Total MCPs: ${totalMCPs} (${guardedCount} guarded, ${unguardedCount} unguarded)`,
    )
    console.log(`  Loaded MCPs: ${loadedCount}`)

    // Token savings (quick estimate)
    const allMCPs = Object.entries(savedConfigs).map(([name]) => ({
      name,
      isGuarded: disabledMCPs.includes(name),
      metrics: tokenMetricsCache.get(name),
    }))
    const summary = calculateTokenSavings(allMCPs)

    if (summary.tokensSaved > 0) {
      const savingsPercent = calculatePercentage(
        summary.tokensSaved,
        summary.totalTokensWithoutGuard,
      )
      console.log(
        `  Token Savings: ~${formatTokens(summary.tokensSaved)} tokens (${savingsPercent}% reduction)`,
      )
    } else {
      console.log(`  Token Savings: 0 tokens (no MCPs guarded)`)
    }

    console.log(`  IDE Config: ${sourceName}`)
    console.log('════════════════════════════════════════════════════════════')

    // Quick actions
    console.log('\nQuick Actions:')
    if (unguardedCount > 0) {
      console.log('  • guard --all        - Protect all MCPs')
    }
    console.log('  • savings            - View detailed token analysis')
    if (totalMCPs > 0) {
      console.log('  • list               - List all loaded MCPs')
    }
    if (guardedCount > 0) {
      const firstGuarded = disabledMCPs[0]
      console.log(`  • test ${firstGuarded}     - Test a guarded MCP`)
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack && verbose) {
      console.error(error.stack)
    }
  }
}

function showHelp() {
  console.log(`
Available commands:
  status        - Show at-a-glance MCP Guard status (counts, token savings, quick actions)
  savings       - Detailed token savings analysis with per-MCP breakdown
  guard <mcp>   - Enable MCPGuard protection for an MCP (use --all for all MCPs)
  unguard <mcp> - Disable MCPGuard protection for an MCP (use --all for all MCPs)
  network <mcp> on|off           - Enable/disable Worker outbound network for a guarded MCP
  allowhost <mcp> add|remove <h> - Add/remove an allowed host (e.g., api.github.com)
  allowlocalhost <mcp> on|off    - Allow/deny localhost (localhost/127.0.0.1) access
  configure     - View security configuration for an MCP
  diagnose      - Step-by-step connection diagnostics for an MCP
  load          - Load an MCP server (shows saved configs, auto-saves new ones)
  test          - Interactively test MCP tools (select tool, enter args, execute via Wrangler)
  test-direct   - Test MCP directly without Wrangler/Worker isolation (uses saved configs)
  execute       - Execute custom TypeScript code against a loaded MCP
  list          - List all loaded MCP servers
  saved         - List all saved MCP configurations
  delete        - Delete a saved MCP configuration
  schema        - Get TypeScript API schema for an MCP
  unload        - Unload an MCP server
  conflicts     - Check for IDE MCP configuration conflicts
  metrics       - Show performance metrics
  help          - Show this help message
  exit          - Exit the CLI

Common workflows:
  status                - Quick overview of your setup
  guard --all           - Protect all MCPs and maximize token savings
  savings               - See how many tokens you're saving
  diagnose              - Troubleshoot MCP connection issues
  test github           - Test a specific MCP's tools interactively

Usage:
  npm run cli              - Run CLI (quiet mode, only warnings/errors)
  npm run cli -- --verbose - Run CLI with detailed logs
  npm run cli -- -v       - Short form for verbose mode
`)
}

async function handleCommand(command: string) {
  const input = command.trim()
  const [cmd, ...args] = input.toLowerCase().split(/\s+/)

  switch (cmd) {
    case 'status':
      await showStatus()
      break
    case 'savings':
      await showSavings()
      break
    case 'configure':
      await configureMCP()
      break
    case 'diagnose':
      await diagnoseMCP()
      break
    case 'guard':
      if (args.length === 0) {
        console.log('\n❌ Usage: guard <mcp-name> or guard --all')
        console.log('Example: guard github')
        console.log('Example: guard --all')
      } else {
        await guardMCP(args[0], true)
      }
      break
    case 'unguard':
      if (args.length === 0) {
        console.log('\n❌ Usage: unguard <mcp-name> or unguard --all')
        console.log('Example: unguard github')
        console.log('Example: unguard --all')
      } else {
        await guardMCP(args[0], false)
      }
      break
    case 'load':
      await loadMCP()
      break
    case 'execute':
      await executeCode()
      break
    case 'test':
      await testTool()
      break
    case 'test-direct':
    case 'testdirect':
      await testDirect()
      break
    case 'list':
      await listMCPs()
      break
    case 'saved':
      await listSavedConfigs()
      break
    case 'delete':
      await deleteSavedConfig()
      break
    case 'schema':
      await getSchema()
      break
    case 'unload':
      await unloadMCP()
      break
    case 'conflicts':
      await checkIDEConflicts()
      break
    case 'metrics':
      await getMetrics()
      break
    case 'network': {
      // network <mcpName> on|off
      if (args.length < 2) {
        console.log('\n❌ Usage: network <mcp-name> on|off')
        console.log('Example: network github on')
        console.log('Example: network github off')
        break
      }
      const [mcpName, mode] = args
      await updateNetworkEnabled(mcpName, mode === 'on')
      break
    }
    case 'allowhost': {
      // allowhost <mcpName> add|remove <host>
      if (args.length < 3) {
        console.log('\n❌ Usage: allowhost <mcp-name> add|remove <host>')
        console.log('Example: allowhost github add api.github.com')
        console.log('Example: allowhost github remove api.github.com')
        break
      }
      const [mcpName, action, host] = args
      await updateAllowedHost(mcpName, action, host)
      break
    }
    case 'allowlocalhost': {
      // allowlocalhost <mcpName> on|off
      if (args.length < 2) {
        console.log('\n❌ Usage: allowlocalhost <mcp-name> on|off')
        console.log('Example: allowlocalhost github on')
        console.log('Example: allowlocalhost github off')
        break
      }
      const [mcpName, mode] = args
      await updateAllowLocalhost(mcpName, mode === 'on')
      break
    }
    case 'help':
      showHelp()
      break
    case 'exit':
    case 'quit':
      isExiting = true
      console.log('\n👋 Goodbye!')
      rl.close()
      process.exit(0)
      break
    case '':
      // Empty command, do nothing
      break
    default:
      console.log(`\n❌ Unknown command: ${cmd}`)
      console.log('Type "help" for available commands.')
  }
}

async function updateNetworkEnabled(mcpName: string, enabled: boolean) {
  const config = getOrCreateSecurityConfig(mcpName)
  config.network.enabled = enabled
  upsertMCPConfig(config)
  console.log(
    `\n✅ Network access for "${mcpName}" set to ${enabled ? 'ON' : 'OFF'}.`,
  )
  if (enabled) {
    console.log(
      `   Allowed hosts: ${config.network.allowlist.length > 0 ? config.network.allowlist.join(', ') : '(none - blocks all external)'}`,
    )
  }
}

async function updateAllowLocalhost(mcpName: string, allow: boolean) {
  const config = getOrCreateSecurityConfig(mcpName)
  config.network.enabled = true
  config.network.allowLocalhost = allow
  upsertMCPConfig(config)
  console.log(
    `\n✅ Allow localhost for "${mcpName}" set to ${allow ? 'ON' : 'OFF'}.`,
  )
}

async function updateAllowedHost(
  mcpName: string,
  action: string,
  host: string,
) {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost) {
    console.log('\n❌ Host is required.')
    return
  }

  const config = getOrCreateSecurityConfig(mcpName)
  config.network.enabled = true

  const current = new Set(config.network.allowlist.map((h) => h.toLowerCase()))
  if (action === 'add') {
    current.add(normalizedHost)
  } else if (action === 'remove' || action === 'rm' || action === 'delete') {
    current.delete(normalizedHost)
  } else {
    console.log('\n❌ Usage: allowhost <mcp-name> add|remove <host>')
    return
  }

  config.network.allowlist = Array.from(current).sort()
  upsertMCPConfig(config)

  console.log(
    `\n✅ Updated allowlist for "${mcpName}": ${config.network.allowlist.length > 0 ? config.network.allowlist.join(', ') : '(none - blocks all external)'}`,
  )
}

function getOrCreateSecurityConfig(mcpName: string) {
  const settings = loadSettings()
  const existing = settings.mcpConfigs.find((c) => c.mcpName === mcpName)
  if (existing) return existing
  return createDefaultConfig(mcpName)
}

async function main() {
  // Interactive CLI mode
  const verbose =
    process.argv.includes('--verbose') || process.argv.includes('-v')

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              MCP Guard - Interactive CLI                  ║
╚═══════════════════════════════════════════════════════════╝

Type "help" for available commands.
Type "exit" to quit.
${verbose ? '\n🔍 Verbose logging enabled. Use --quiet to disable.\n' : '\n💡 Tip: Use --verbose or -v for detailed logs.\n'}`)

  rl.prompt()

  rl.on('line', async (input) => {
    await handleCommand(input)
    rl.prompt()
  })

  rl.on('close', () => {
    if (!isExiting) {
      console.log('\n👋 Goodbye!')
    }
    process.exit(0)
  })
}

// Legacy non-interactive install/restore functions removed
// With transparent proxy mode, no installation step is needed beyond adding mcpguard to IDE config

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
