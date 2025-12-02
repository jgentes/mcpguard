/**
 * MCP Guard - VS Code Extension
 * 
 * Provides a graphical interface for configuring MCP servers
 * with security isolation settings. Bundles and auto-spawns the
 * mcpguard MCP server for transparent proxying.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { MCPGuardWebviewProvider } from './webview-provider';
import { loadAllMCPServers } from './config-loader';

let webviewProvider: MCPGuardWebviewProvider | undefined;
let mcpServerProcess: ChildProcess | undefined;

/**
 * Get the path to the mcpguard server
 */
function getMCPGuardServerPath(context: vscode.ExtensionContext): string {
  // In development, the server is in the parent directory's dist folder
  // In production, it will be bundled with the extension
  const devPath = path.join(context.extensionPath, '..', 'dist', 'server', 'index.js');
  const prodPath = path.join(context.extensionPath, 'mcpguard-server', 'index.js');
  
  // Check if we're in development (parent has dist folder)
  const fs = require('fs');
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  return prodPath;
}

/**
 * Spawn the mcpguard MCP server as a child process
 */
function spawnMCPGuardServer(context: vscode.ExtensionContext): ChildProcess | undefined {
  const serverPath = getMCPGuardServerPath(context);
  const fs = require('fs');
  
  if (!fs.existsSync(serverPath)) {
    console.log(`MCP Guard: Server not found at ${serverPath}, skipping spawn`);
    return undefined;
  }

  console.log(`MCP Guard: Spawning server from ${serverPath}`);
  
  const nodeExecutable = process.execPath; // Use the same Node.js that VS Code uses
  
  const proc = spawn(nodeExecutable, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Ensure the server knows it's running from the extension
      MCPGUARD_FROM_EXTENSION: 'true',
    },
    // Don't detach - we want the process to die when VS Code closes
    detached: false,
  });

  proc.stdout?.on('data', (data) => {
    console.log(`MCP Guard Server: ${data.toString().trim()}`);
  });

  proc.stderr?.on('data', (data) => {
    console.error(`MCP Guard Server Error: ${data.toString().trim()}`);
  });

  proc.on('error', (error) => {
    console.error('MCP Guard: Failed to spawn server:', error.message);
  });

  proc.on('exit', (code, signal) => {
    console.log(`MCP Guard: Server exited with code ${code}, signal ${signal}`);
    mcpServerProcess = undefined;
  });

  return proc;
}

/**
 * Stop the mcpguard server if running
 */
function stopMCPGuardServer(): void {
  if (mcpServerProcess) {
    console.log('MCP Guard: Stopping server...');
    mcpServerProcess.kill('SIGTERM');
    mcpServerProcess = undefined;
  }
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('MCP Guard extension activated - build v2');
  console.log('MCP Guard: Extension path:', context.extensionPath);

  // Spawn the mcpguard MCP server
  mcpServerProcess = spawnMCPGuardServer(context);
  if (mcpServerProcess) {
    console.log('MCP Guard: Server spawned successfully');
  }

  // Create the webview provider
  webviewProvider = new MCPGuardWebviewProvider(context.extensionUri);

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MCPGuardWebviewProvider.viewType,
      webviewProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpguard.openSettings', () => {
      vscode.commands.executeCommand('workbench.view.extension.mcpguard');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mcpguard.refreshMCPs', () => {
      webviewProvider?.refresh();
      vscode.window.showInformationMessage('MCP Guard: Refreshed MCP list');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mcpguard.importFromIDE', () => {
      webviewProvider?.refresh();
      vscode.window.showInformationMessage('MCP Guard: Imported MCPs from IDE configurations');
    })
  );

  // Register cleanup on deactivation
  context.subscriptions.push({
    dispose: () => stopMCPGuardServer()
  });

  // Auto-import on activation - log what's found
  const mcps = loadAllMCPServers();
  console.log(`MCP Guard: Found ${mcps.length} MCP server(s) on activation`);
  if (mcps.length > 0) {
    console.log('MCP Guard: Detected servers:', mcps.map(m => `${m.name} (${m.source})`).join(', '));
  } else {
    console.log('MCP Guard: No MCP servers detected. Checked Claude, Copilot, and Cursor configs.');
  }

  // Show welcome message on first activation (with more helpful info)
  const hasShownWelcome = context.globalState.get('mcpguard.hasShownWelcome');
  if (!hasShownWelcome) {
    const message = mcps.length > 0
      ? `MCP Guard found ${mcps.length} MCP server${mcps.length === 1 ? '' : 's'}. Click the shield icon to configure security settings.`
      : 'MCP Guard is active. No MCP servers detected yet - check your IDE configuration.';
    
    vscode.window.showInformationMessage(message, 'Open Settings').then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.view.extension.mcpguard');
      }
    });
    context.globalState.update('mcpguard.hasShownWelcome', true);
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  console.log('MCP Guard extension deactivated');
  stopMCPGuardServer();
}


