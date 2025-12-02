/**
 * Test setup file for VS Code extension tests
 * Sets up mocks for VS Code API and fs module
 */

import { vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Track mock file system state
let mockFileSystem = new Map<string, string>();

// Export for use by test helpers
export function getMockFileSystem(): Map<string, string> {
  return mockFileSystem;
}

export function resetMockFs(): void {
  mockFileSystem = new Map();
}

// Mock VS Code API
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    parse: vi.fn((uri: string) => ({ toString: () => uri, fsPath: uri })),
    joinPath: vi.fn((...args: unknown[]) => {
      const paths = args.slice(1) as string[];
      const fsPath = path.join((args[0] as { fsPath: string }).fsPath, ...paths);
      return { fsPath, toString: () => fsPath };
    }),
  },
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
  })),
}));

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => {
      return mockFileSystem.has(path.normalize(filePath));
    }),
    accessSync: vi.fn((filePath: string) => {
      if (!mockFileSystem.has(path.normalize(filePath))) {
        const error = new Error('ENOENT: no such file or directory');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
    }),
    readFileSync: vi.fn((filePath: string) => {
      const content = mockFileSystem.get(path.normalize(filePath));
      if (content === undefined) {
        const error = new Error('ENOENT: no such file or directory');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return content;
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      mockFileSystem.set(path.normalize(filePath), data);
    }),
    mkdirSync: vi.fn(() => undefined),
    constants: actual.constants,
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
}));

// Helper to add mock file - using the same import trick
export function addMockFile(filePath: string, content: string): void {
  mockFileSystem.set(path.normalize(filePath), content);
}

export function getMockFileContent(filePath: string): string | undefined {
  return mockFileSystem.get(path.normalize(filePath));
}

// Global hooks to reset state between tests
beforeEach(() => {
  mockFileSystem = new Map();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});
