#!/usr/bin/env node

import * as readline from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import dotenv from 'dotenv'
import { MetricsCollector } from '../server/metrics-collector.js'
import { WorkerManager } from '../server/worker-manager.js'
import {
  type MCPConfig,
  ExecuteCodeRequestSchema,
  LoadMCPRequestSchema,
} from '../types/mcp.js'
import { ConfigManager } from '../utils/config-manager.js'
import { selectEnvVarsInteractively } from '../utils/env-selector.js'
import logger from '../utils/logger.js'
import { ProgressIndicator } from '../utils/progress-indicator.js'
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

    let selectedMCP
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
      selectedMCP = allMCPs.find((mcp) => mcp.name.toLowerCase() === searchTerm)

      if (!selectedMCP) {
        console.error(`\n❌ MCP not found: ${selection}`)
        return
      }
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
    } else {
      console.log(
        `\n✅ Using already loaded: ${selectedInstance.mcp_name} (${selectedInstance.mcp_id})`,
      )
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
        savedNames.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ||
        null
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

    console.log(`\n🔍 Testing ${selectedName} directly (bypassing Wrangler)...\n`)
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

  if (instances.length === 0) {
    console.log('\n📭 No MCP servers loaded.')
    return
  }

  console.log('\n📋 Loaded MCP Servers:')
  instances.forEach((instance) => {
    console.log(
      JSON.stringify(
        {
          mcp_id: instance.mcp_id,
          mcp_name: instance.mcp_name,
          status: instance.status,
          uptime_ms: instance.uptime_ms,
          tools_count: instance.tools.length,
          created_at: instance.created_at.toISOString(),
        },
        null,
        2,
      ),
    )
  })
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
    console.log(`     Command: ${entry.config.command}`)
    if (entry.config.args) {
      console.log(`     Args: ${entry.config.args.join(' ')}`)
    }
    if (entry.config.env) {
      const envKeys = Object.keys(entry.config.env)
      console.log(`     Env vars: ${envKeys.length} variable(s)`)
      envKeys.forEach((key) => {
        const value = entry.config.env?.[key]
        // Don't show full values, just indicate if it's an env var reference
        if (value && value.startsWith('${') && value.endsWith('}')) {
          console.log(`       ${key}: ${value}`)
        } else {
          console.log(`       ${key}: [hidden]`)
        }
      })
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

async function setupMCPGuard() {
  // Interactive version - show what will happen, then call non-interactive
  try {
    const configPath = configManager.getCursorConfigPath()

    if (!configPath) {
      console.log(
        '\n❌ No IDE config file found. Please ensure Cursor or Claude Code is installed.',
      )
      return
    }

    // Read raw config to see all MCPs including disabled ones
    const rawConfig = configManager.getRawConfig()
    if (!rawConfig) {
      console.log('\n❌ Failed to read config file.')
      return
    }

    const allMCPs = Object.keys(rawConfig.mcpServers || {})
    const disabledMCPs = Object.keys(rawConfig._mcpguard_disabled || {})
    const mcpsToDisable = allMCPs.filter(
      (name) => name.toLowerCase() !== 'mcpguard',
    )

    if (mcpsToDisable.length === 0 && disabledMCPs.length > 0) {
      console.log('✅ All MCPs are already guarded.')
      return
    }

    if (mcpsToDisable.length > 0) {
      console.log(`\n📋 Found ${mcpsToDisable.length} MCP(s) to guard:`)
      mcpsToDisable.forEach((name) => {
        console.log(`   - ${name}`)
      })

      const confirmed = await question(
        '\n⚠️  This will disable all MCPs except mcpguard in your IDE config.\n   They will be moved to _mcpguard_disabled section.\n   Continue? (y/N): ',
      )

      if (confirmed.trim().toLowerCase() !== 'y') {
        console.log('Cancelled.')
        return
      }
    }

    // Execute the disable operation
    const rawConfig2 = configManager.getRawConfig()
    if (!rawConfig2) return

    const allMCPs2 = Object.keys(rawConfig2.mcpServers || {})
    const disabledMCPs2 = Object.keys(rawConfig2._mcpguard_disabled || {})
    const mcpguardExists = allMCPs2.some(
      (name) => name.toLowerCase() === 'mcpguard',
    ) || disabledMCPs2.some((name) => name.toLowerCase() === 'mcpguard')

    const mcpsToDisable2 = allMCPs2.filter(
      (name) => name.toLowerCase() !== 'mcpguard',
    )

    if (mcpsToDisable2.length > 0) {
      console.log('\n🔒 Disabling MCPs...')
      const result = configManager.disableAllExceptMCPGuard()

      console.log(`\n✅ Setup complete!`)
      console.log(`   Disabled: ${result.disabled.join(', ') || 'none'}`)
      if (result.alreadyDisabled.length > 0) {
        console.log(
          `   Already disabled: ${result.alreadyDisabled.join(', ')}`,
        )
      }
      if (result.failed.length > 0) {
        console.log(`   Failed: ${result.failed.join(', ')}`)
      }
    }

    if (!mcpguardExists) {
      console.log(
        '\n⚠️  Note: mcpguard not found in config.',
      )
      console.log(
        '   Please add mcpguard to your IDE config using the install button.',
      )
    }

    console.log(
      `\n💡 All MCPs are now guarded by MCPGuard. Restart your IDE for changes to take effect.`,
    )
  } catch (error: any) {
    console.error('\n❌ Error during setup:', error.message)
  }
}

async function restoreMCPs() {
  // Interactive version - show what will happen, then call non-interactive
  try {
    const disabledMCPs = configManager.getDisabledMCPs()

    if (disabledMCPs.length === 0) {
      console.log('\n✅ No disabled MCPs found. Nothing to restore.')
      return
    }

    console.log(`\n📋 Found ${disabledMCPs.length} disabled MCP(s):`)
    disabledMCPs.forEach((name) => {
      console.log(`   - ${name}`)
    })

    const confirmed = await question(
      '\n⚠️  This will re-enable all disabled MCPs in your IDE config.\n   They will be accessible directly by the IDE again.\n   Continue? (y/N): ',
    )

    if (confirmed.trim().toLowerCase() !== 'y') {
      console.log('Cancelled.')
      return
    }

    console.log('\n🔄 Restoring MCPs...')
    const restored = configManager.restoreAllDisabled()

    if (restored.length > 0) {
      console.log(`\n✅ Restored ${restored.length} MCP(s): ${restored.join(', ')}`)
      console.log(`\n💡 Restart your IDE for changes to take effect.`)
    } else {
      console.log('\n❌ Failed to restore MCPs.')
    }
  } catch (error: any) {
    console.error('\n❌ Error during restore:', error.message)
  }
}

function showHelp() {
  console.log(`
Available commands:
  install       - Disable all MCPs except mcpguard (run this after adding MCPGuard to IDE config)
  restore       - Re-enable all disabled MCPs
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

Usage:
  npm run cli              - Run CLI (quiet mode, only warnings/errors)
  npm run cli -- --verbose - Run CLI with detailed logs
  npm run cli -- -v       - Short form for verbose mode
`)
}

async function handleCommand(command: string) {
  const cmd = command.trim().toLowerCase()

  switch (cmd) {
    case 'install':
      await setupMCPGuard()
      break
    case 'restore':
      await restoreMCPs()
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

async function main() {
  // Check for non-interactive commands (install, restore)
  const command = process.argv[2]

  if (command === 'install') {
    await setupMCPGuardNonInteractive()
    process.exit(0)
  }

  if (command === 'restore') {
    await restoreMCPsNonInteractive()
    process.exit(0)
  }

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

async function setupMCPGuardNonInteractive() {
  try {
    const sourceName = configManager.getConfigSourceDisplayName()
    const configPath = configManager.getCursorConfigPath()

    if (!configPath) {
      console.error(
        '\n❌ No IDE config file found. Please ensure Cursor or Claude Code is installed.',
      )
      process.exit(1)
    }

    console.log(`\n🔧 Setting up MCPGuard in ${sourceName}...`)
    console.log(`   Config file: ${configPath}\n`)

    // Read raw config to see all MCPs including disabled ones
    const rawConfig = configManager.getRawConfig()
    if (!rawConfig) {
      console.error('\n❌ Failed to read config file.')
      process.exit(1)
    }

    // Get all MCPs (including disabled)
    const allMCPs = Object.keys(rawConfig.mcpServers || {})
    const disabledMCPs = Object.keys(rawConfig._mcpguard_disabled || {})
    const mcpguardExists = allMCPs.some(
      (name) => name.toLowerCase() === 'mcpguard',
    ) || disabledMCPs.some((name) => name.toLowerCase() === 'mcpguard')

    // MCPs to disable (all except mcpguard)
    const mcpsToDisable = allMCPs.filter(
      (name) => name.toLowerCase() !== 'mcpguard',
    )

    if (mcpsToDisable.length === 0 && disabledMCPs.length > 0) {
      console.log('✅ All MCPs are already guarded.')
      if (!mcpguardExists) {
        console.log('⚠️  Warning: mcpguard not found in config.')
        console.log('   Please add mcpguard to your IDE config using the install button.')
      }
      process.exit(0)
    }

    if (mcpsToDisable.length > 0) {
      console.log(`📋 Found ${mcpsToDisable.length} MCP(s) to guard:`)
      mcpsToDisable.forEach((name) => {
        console.log(`   - ${name}`)
      })

      console.log('\n🔒 Disabling MCPs...')
      const result = configManager.disableAllExceptMCPGuard()

      console.log(`\n✅ Setup complete!`)
      console.log(`   Disabled: ${result.disabled.join(', ') || 'none'}`)
      if (result.alreadyDisabled.length > 0) {
        console.log(
          `   Already disabled: ${result.alreadyDisabled.join(', ')}`,
        )
      }
      if (result.failed.length > 0) {
        console.log(`   Failed: ${result.failed.join(', ')}`)
        process.exit(1)
      }
    }

    if (!mcpguardExists) {
      console.log(
        '\n⚠️  Note: mcpguard not found in config.',
      )
      console.log(
        '   Please add mcpguard to your IDE config using the install button in Cursor/Claude.',
      )
    } else {
      console.log('\n✅ MCPGuard is configured.')
    }

    console.log(
      `\n💡 All MCPs are now guarded by MCPGuard. Restart your IDE for changes to take effect.`,
    )
    console.log(
      `   Use "npx mcpguard restore" to re-enable MCPs if needed.`,
    )
  } catch (error: any) {
    console.error('\n❌ Error during setup:', error.message)
    process.exit(1)
  }
}

async function restoreMCPsNonInteractive() {
  try {
    const disabledMCPs = configManager.getDisabledMCPs()

    if (disabledMCPs.length === 0) {
      console.log('\n✅ No disabled MCPs found. Nothing to restore.')
      process.exit(0)
    }

    console.log(`\n📋 Found ${disabledMCPs.length} disabled MCP(s):`)
    disabledMCPs.forEach((name) => {
      console.log(`   - ${name}`)
    })

    console.log('\n🔄 Restoring MCPs...')
    const restored = configManager.restoreAllDisabled()

    if (restored.length > 0) {
      console.log(`\n✅ Restored ${restored.length} MCP(s): ${restored.join(', ')}`)
      console.log(`\n💡 Restart your IDE for changes to take effect.`)
    } else {
      console.log('\n❌ Failed to restore MCPs.')
      process.exit(1)
    }
  } catch (error: any) {
    console.error('\n❌ Error during restore:', error.message)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
