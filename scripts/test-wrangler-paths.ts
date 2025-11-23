#!/usr/bin/env tsx
/**
 * Test script to determine which path format Wrangler accepts for the Worker entry point
 * 
 * This script simulates how the MCP server is invoked and tests paths from that context.
 * Run with: npx tsx scripts/test-wrangler-paths.ts
 * 
 * To simulate the actual MCP server context, you can also run:
 * npx tsx D:\mcpguard\src\server\index.ts
 * (from a different directory to see if cwd matters)
 */

import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Simulate MCP server context - get the directory where this script is located
// When MCP server runs via "npx tsx D:\mcpguard\src\server\index.ts", 
// the cwd might be different from the script location
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const cwd = process.cwd()
const isWindows = process.platform === 'win32'
const baseEntryPoint = 'src/worker/runtime.ts'

console.log('Execution Context:')
console.log(`  Script directory: ${scriptDir}`)
console.log(`  Project root (from script): ${projectRoot}`)
console.log(`  Current working directory: ${cwd}`)
console.log(`  Are they the same? ${projectRoot === cwd}`)
console.log()

// Generate multiple path variations to test
// Test from both the actual cwd and the project root
const pathVariations = [
  // From actual cwd
  { path: baseEntryPoint, description: 'relative path (from cwd)', cwd: cwd },
  { path: resolve(cwd, baseEntryPoint), description: 'absolute path from cwd', cwd: cwd },
  { path: `./${baseEntryPoint}`, description: 'relative path with ./ (from cwd)', cwd: cwd },
  
  // From project root (where wrangler.toml is)
  { path: baseEntryPoint, description: 'relative path (from project root)', cwd: projectRoot },
  { path: resolve(projectRoot, baseEntryPoint), description: 'absolute path from project root', cwd: projectRoot },
  { path: `./${baseEntryPoint}`, description: 'relative path with ./ (from project root)', cwd: projectRoot },
  
  // Absolute paths (work from any cwd)
  { path: resolve(projectRoot, baseEntryPoint), description: 'absolute path (resolve)', cwd: cwd },
  { path: resolve(projectRoot, baseEntryPoint).replace(/\\/g, '/'), description: 'absolute path (forward slashes)', cwd: cwd },
  ...(isWindows
    ? [{ path: resolve(projectRoot, baseEntryPoint).replace(/\//g, '\\'), description: 'absolute path (backslashes)', cwd: cwd }]
    : []),
]

console.log('Testing Worker entry point path variations for Wrangler\n')
console.log('Path variations to test:')
pathVariations.forEach(({ path, description, cwd: testCwd }, index) => {
  // Check if path exists relative to the test cwd
  const fullPath = path.startsWith('/') || /^[A-Z]:/.test(path) 
    ? path 
    : resolve(testCwd, path)
  const exists = existsSync(fullPath)
  console.log(`  ${index + 1}. ${description}`)
  console.log(`     Path: ${path}`)
  console.log(`     Full path: ${fullPath}`)
  console.log(`     Test CWD: ${testCwd}`)
  console.log(`     Exists: ${exists ? '✓' : '✗'}`)
  console.log()
})

// Test each path by trying to run wrangler dev with it
async function testPath(path: string, description: string, testCwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\nTesting: ${description}`)
    console.log(`  Path: ${path}`)
    console.log(`  CWD: ${testCwd}`)
    
    const npxCmd = isWindows ? 'npx.cmd' : 'npx'
    const wranglerArgs = [
      'wrangler',
      'dev',
      path,
      '--local',
      '--port',
      '8787', // Fixed port for testing
    ]
    
    console.log(`  Command: ${npxCmd} ${wranglerArgs.join(' ')}`)
    console.log(`  Spawning from: ${testCwd}`)
    
    const process = spawn(npxCmd, wranglerArgs, {
      cwd: testCwd, // Use the test cwd, not the actual cwd
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    })
    
    let stdout = ''
    let stderr = ''
    let resolved = false
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        process.kill()
        console.log(`  Result: TIMEOUT (Wrangler didn't start within 5 seconds)`)
        console.log(`  Stdout: ${stdout.substring(0, 200)}...`)
        console.log(`  Stderr: ${stderr.substring(0, 200)}...`)
        resolve(false)
      }
    }, 5000)
    
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
        // Check for success indicators
        if (stdout.includes('Ready') || stdout.includes('ready') || stdout.includes('Listening')) {
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            process.kill()
            console.log(`  Result: ✓ SUCCESS (Wrangler started successfully)`)
            resolve(true)
          }
        }
      })
    }
    
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
        // Check for error indicators
        if (stderr.includes('ERROR') || stderr.includes('Missing entry-point')) {
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            process.kill()
            console.log(`  Result: ✗ FAILED`)
            console.log(`  Error: ${stderr.split('\n').find((line) => line.includes('ERROR') || line.includes('Missing'))?.trim() || 'Unknown error'}`)
            resolve(false)
          }
        }
      })
    }
    
    process.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        if (code === 0 || code === null) {
          console.log(`  Result: ✓ SUCCESS (Process exited with code ${code})`)
          resolve(true)
        } else {
          console.log(`  Result: ✗ FAILED (Process exited with code ${code})`)
          console.log(`  Stderr: ${stderr.substring(0, 300)}`)
          resolve(false)
        }
      }
    })
    
    process.on('error', (error) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        console.log(`  Result: ✗ FAILED (Process error: ${error.message})`)
        resolve(false)
      }
    })
  })
}

async function main() {
  console.log('='.repeat(70))
  console.log('Wrangler Path Resolution Test')
  console.log('='.repeat(70))
  console.log()
  
  const results: Array<{ path: string; description: string; cwd: string; success: boolean }> = []
  
  for (const { path, description, cwd: testCwd } of pathVariations) {
    // Check if path exists relative to the test cwd
    const fullPath = path.startsWith('/') || /^[A-Z]:/.test(path) 
      ? path 
      : resolve(testCwd, path)
    
    if (!existsSync(fullPath)) {
      console.log(`\nSkipping ${description} - file does not exist at ${fullPath}`)
      results.push({ path, description, cwd: testCwd, success: false })
      continue
    }
    
    const success = await testPath(path, description, testCwd)
    results.push({ path, description, cwd: testCwd, success })
    
    // Wait a bit between tests
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  
  console.log('\n' + '='.repeat(70))
  console.log('Test Results Summary')
  console.log('='.repeat(70))
  console.log()
  
  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)
  
  if (successful.length > 0) {
    console.log('✓ Successful paths:')
    successful.forEach(({ path, description, cwd: testCwd }) => {
      console.log(`  - ${description}`)
      console.log(`    Path: ${path}`)
      console.log(`    CWD: ${testCwd}`)
    })
  } else {
    console.log('✗ No successful paths found')
  }
  
  console.log()
  
  if (failed.length > 0) {
    console.log('✗ Failed paths:')
    failed.forEach(({ path, description, cwd: testCwd }) => {
      console.log(`  - ${description}`)
      console.log(`    Path: ${path}`)
      console.log(`    CWD: ${testCwd}`)
    })
  }
  
  console.log()
  console.log('Recommendation:')
  if (successful.length > 0) {
    const best = successful[0]
    console.log(`  Use: ${best.description}`)
    console.log(`  Path: ${best.path}`)
    console.log(`  CWD: ${best.cwd}`)
    console.log()
    console.log('  In code, use:')
    console.log(`    spawn(npxCmd, ['wrangler', 'dev', '${best.path}', ...], { cwd: '${best.cwd}' })`)
  } else {
    console.log('  None of the tested paths worked. Check Wrangler configuration.')
  }
}

main().catch(console.error)

