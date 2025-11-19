import type { WorkerManager } from '../../src/server/worker-manager.js'
import { ConfigManager } from '../../src/utils/config-manager.js'

/**
 * Test helper to track and clean up MCP configs created during tests
 *
 * IMPORTANT: Only configs explicitly tracked via trackConfig() will be deleted.
 * This prevents accidentally deleting real user configurations.
 * Tests MUST call trackConfig() for every config they create.
 */
export class TestConfigCleanup {
  private configManager: ConfigManager
  private testConfigNames: Set<string> = new Set()

  constructor() {
    this.configManager = new ConfigManager()
  }

  /**
   * Track an MCP config name that was created during tests
   * This config will be deleted during cleanup.
   *
   * Tests MUST call this for every config they create to prevent
   * accidentally deleting real user configurations.
   */
  trackConfig(mcpName: string): void {
    this.testConfigNames.add(mcpName)
  }

  /**
   * Clean up all tracked test configs ONLY
   *
   * This only deletes configs that were explicitly tracked via trackConfig().
   * We do NOT use string matching or heuristics to avoid accidentally
   * deleting real user configurations (e.g., a real "github" MCP).
   */
  cleanup(): void {
    if (this.testConfigNames.size === 0) {
      return
    }

    // Delete only tracked configs
    for (const mcpName of this.testConfigNames) {
      try {
        this.configManager.deleteConfig(mcpName)
      } catch {
        // Ignore cleanup errors (config might not exist or already deleted)
      }
    }

    this.testConfigNames.clear()
  }

  /**
   * Get all tracked config names
   */
  getTrackedConfigs(): string[] {
    return Array.from(this.testConfigNames)
  }
}

/**
 * Global test config cleanup instance
 * Tests should use this to track configs they create
 */
export const testConfigCleanup = new TestConfigCleanup()

/**
 * Global WorkerManager instances created during tests
 * Used to ensure all processes are cleaned up
 */
const testWorkerManagers: Set<WorkerManager> = new Set()

/**
 * Track a WorkerManager instance for cleanup
 */
export function trackWorkerManager(manager: WorkerManager): void {
  testWorkerManagers.add(manager)
}

/**
 * Clean up all WorkerManager instances (kills all processes)
 */
export async function cleanupWorkerManagers(): Promise<void> {
  const cleanupPromises = Array.from(testWorkerManagers).map(
    async (manager) => {
      try {
        await manager.shutdown()
      } catch {
        // Ignore cleanup errors
      }
    },
  )

  await Promise.allSettled(cleanupPromises)
  testWorkerManagers.clear()
}
