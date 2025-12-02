/**
 * File system mock utilities for testing
 * Uses vi.mock with factory functions for proper module mocking
 */

import { vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Store for mock file system - exported for direct use by mock factory
export let mockFileSystem: Map<string, string> = new Map();

// Reset file system state
export function resetMockFileSystem(): void {
  mockFileSystem = new Map();
}

// Add a mock file
export function addMockFile(filePath: string, content: string): void {
  mockFileSystem.set(path.normalize(filePath), content);
}

// Remove a mock file
export function removeMockFile(filePath: string): void {
  mockFileSystem.delete(path.normalize(filePath));
}

// Get file content from mock
export function getMockFileContent(filePath: string): string | undefined {
  return mockFileSystem.get(path.normalize(filePath));
}

// Check if mock file exists
export function mockFileExists(filePath: string): boolean {
  return mockFileSystem.has(path.normalize(filePath));
}

// Helper to create a test config file path
export function getTestConfigPath(ide: 'claude' | 'copilot' | 'cursor'): string {
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
export function createSampleMCPConfig(mcpServers: Record<string, unknown>, extras?: Record<string, unknown>): string {
  return JSON.stringify({
    mcpServers,
    ...extras,
  }, null, 2);
}

// These are placeholders - actual mocking will be done in setup.ts
export function setupFsMocks(): void {
  // No-op - mocking is done via vi.mock in setup.ts
}

export function restoreFsMocks(): void {
  // No-op - vitest handles mock cleanup
}
