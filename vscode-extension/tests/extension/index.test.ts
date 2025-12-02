/**
 * Tests for extension/index.ts
 * Tests extension activation, deactivation, and command registration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { addMockFile, resetMockFs } from '../setup';

// Helper to get test config paths
function getTestConfigPath(ide: 'cursor'): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

function createSampleMCPConfig(mcpServers: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers }, null, 2);
}

// Get access to the vscode mock from setup
import * as vscode from 'vscode';

// Import after mocks
import { activate, deactivate } from '../../src/extension/index';

describe('extension/index', () => {
  let mockContext: {
    extensionUri: { fsPath: string };
    extensionPath: string;
    subscriptions: Array<{ dispose?: () => void }>;
    globalState: {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    resetMockFs();
    vi.clearAllMocks();
    
    mockContext = {
      extensionUri: { fsPath: '/mock/extension' },
      extensionPath: '/mock/extension',
      subscriptions: [],
      globalState: {
        get: vi.fn().mockReturnValue(true), // hasShownWelcome = true to skip welcome
        update: vi.fn(),
      },
    };
  });

  describe('activate', () => {
    it('should register webview provider', () => {
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled();
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        'mcpguard.configPanel',
        expect.anything()
      );
    });

    it('should register openSettings command', () => {
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'mcpguard.openSettings',
        expect.any(Function)
      );
    });

    it('should register refreshMCPs command', () => {
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'mcpguard.refreshMCPs',
        expect.any(Function)
      );
    });

    it('should register importFromIDE command', () => {
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'mcpguard.importFromIDE',
        expect.any(Function)
      );
    });

    it('should add subscriptions for cleanup', () => {
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      // Should have multiple subscriptions (webview provider + commands + cleanup)
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });

    it('should show welcome message on first activation', () => {
      mockContext.globalState.get = vi.fn().mockReturnValue(false); // First time

      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'mcpguard.hasShownWelcome',
        true
      );
    });

    it('should not show welcome message on subsequent activations', () => {
      mockContext.globalState.get = vi.fn().mockReturnValue(true); // Already shown

      // Clear previous calls
      vi.mocked(vscode.window.showInformationMessage).mockClear();
      vi.mocked(mockContext.globalState.update).mockClear();

      activate(mockContext as unknown as import('vscode').ExtensionContext);

      // globalState.update should not be called when hasShownWelcome is true
      expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
        'mcpguard.hasShownWelcome',
        true
      );
    });

    it('should load MCPs on activation', () => {
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'test-mcp': { command: 'node', args: ['test.js'] },
      }));

      // This should not throw and should log MCP detection
      activate(mockContext as unknown as import('vscode').ExtensionContext);

      // Extension should activate successfully
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled();
    });

    describe('command handlers', () => {
      it('openSettings command should execute workbench view command', () => {
        activate(mockContext as unknown as import('vscode').ExtensionContext);

        // Find the openSettings command registration
        const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
        const openSettingsCall = calls.find(
          (call) => call[0] === 'mcpguard.openSettings'
        );
        
        expect(openSettingsCall).toBeDefined();
        
        // Execute the handler
        const handler = openSettingsCall![1] as () => void;
        handler();

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'workbench.view.extension.mcpguard'
        );
      });

      it('refreshMCPs command should show info message', () => {
        activate(mockContext as unknown as import('vscode').ExtensionContext);

        // Find the refreshMCPs command registration
        const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
        const refreshCall = calls.find(
          (call) => call[0] === 'mcpguard.refreshMCPs'
        );
        
        expect(refreshCall).toBeDefined();
        
        // Execute the handler
        const handler = refreshCall![1] as () => void;
        handler();

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP Guard: Refreshed MCP list'
        );
      });

      it('importFromIDE command should show info message', () => {
        activate(mockContext as unknown as import('vscode').ExtensionContext);

        // Find the importFromIDE command registration
        const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
        const importCall = calls.find(
          (call) => call[0] === 'mcpguard.importFromIDE'
        );
        
        expect(importCall).toBeDefined();
        
        // Execute the handler
        const handler = importCall![1] as () => void;
        handler();

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP Guard: Imported MCPs from IDE configurations'
        );
      });
    });
  });

  describe('deactivate', () => {
    it('should not throw when called', () => {
      expect(() => deactivate()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      expect(() => {
        deactivate();
        deactivate();
      }).not.toThrow();
    });
  });

  describe('welcome message variations', () => {
    it('should show MCP count in welcome when MCPs found', () => {
      mockContext.globalState.get = vi.fn().mockReturnValue(false);
      
      const cursorPath = getTestConfigPath('cursor');
      addMockFile(cursorPath, createSampleMCPConfig({
        'mcp-1': { command: 'node' },
        'mcp-2': { command: 'node' },
      }));

      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('2'),
        'Open Settings'
      );
    });

    it('should show no MCPs message when none found', () => {
      mockContext.globalState.get = vi.fn().mockReturnValue(false);

      activate(mockContext as unknown as import('vscode').ExtensionContext);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No MCP servers detected'),
        'Open Settings'
      );
    });
  });
});
