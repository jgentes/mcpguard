/**
 * React hooks for the MCP Guard webview
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MCPGuardSettings, MCPServerInfo, ExtensionMessage, WebviewMessage, MCPSecurityConfig, TokenSavingsSummary, ConnectionTestResult } from './types';
import { DEFAULT_SETTINGS } from './types';

// Get VS Code API (singleton)
const vscode = window.acquireVsCodeApi();

/**
 * Post a message to the extension
 */
export function postMessage(message: WebviewMessage): void {
  vscode.postMessage(message);
}

/**
 * Hook to manage settings state
 */
export function useSettings() {
  const [settings, setSettings] = useState<MCPGuardSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Request initial settings
    postMessage({ type: 'getSettings' });

    // Listen for messages from extension
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      
      if (message.type === 'settings') {
        setSettings(message.data);
        setIsLoading(false);
      } else if (message.type === 'loading') {
        setIsLoading(message.isLoading);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const saveSettings = useCallback((newSettings: MCPGuardSettings) => {
    setSettings(newSettings);
    postMessage({ type: 'saveSettings', data: newSettings });
  }, []);

  const saveMCPConfig = useCallback((config: MCPSecurityConfig, source?: 'claude' | 'copilot' | 'cursor') => {
    // Optimistically update local settings state immediately
    setSettings(prev => {
      const existingIndex = prev.mcpConfigs.findIndex(c => c.id === config.id || c.mcpName === config.mcpName);
      const newConfigs = [...prev.mcpConfigs];

      if (existingIndex >= 0) {
        newConfigs[existingIndex] = config;
      } else {
        newConfigs.push(config);
      }

      return {
        ...prev,
        mcpConfigs: newConfigs,
      };
    });

    // Send to backend with source for source-based config modification
    postMessage({ type: 'saveMCPConfig', data: config, source });
  }, []);

  return { settings, setSettings, isLoading, saveSettings, saveMCPConfig };
}

/**
 * Hook to manage MCP servers state
 */
export function useMCPServers() {
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Request initial MCP servers
    postMessage({ type: 'getMCPServers' });

    // Listen for messages from extension
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      
      if (message.type === 'mcpServers') {
        setServers(message.data);
        setIsLoading(false);
      } else if (message.type === 'loading') {
        setIsLoading(message.isLoading);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    postMessage({ type: 'refreshMCPs' });
  }, []);

  return { servers, isLoading, refresh };
}

/**
 * Hook to manage notifications
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<Array<{ id: string; type: 'success' | 'error'; message: string }>>([]);
  const notificationIdRef = useRef(0);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      
      if (message.type === 'success' || message.type === 'error') {
        const id = `notification-${notificationIdRef.current++}`;
        setNotifications(prev => [...prev, { id, type: message.type, message: message.message }]);
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== id));
        }, 3000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notifications, dismiss };
}

/**
 * Hook to manage token savings data
 */
export function useTokenSavings() {
  const [tokenSavings, setTokenSavings] = useState<TokenSavingsSummary | null>(null);
  const [assessingMCPs, setAssessingMCPs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      
      if (message.type === 'tokenSavings') {
        setTokenSavings(message.data);
      } else if (message.type === 'tokenAssessmentProgress') {
        setAssessingMCPs(prev => {
          const next = new Set(prev);
          if (message.status === 'started') {
            next.add(message.mcpName);
          } else {
            next.delete(message.mcpName);
          }
          return next;
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const assessTokens = useCallback((mcpName: string) => {
    postMessage({ type: 'assessTokens', mcpName });
  }, []);

  return { tokenSavings, assessingMCPs, assessTokens };
}

/**
 * Hook to manage connection testing
 */
export function useConnectionTest() {
  const [testingMCP, setTestingMCP] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      
      if (message.type === 'connectionTestProgress') {
        setTestingMCP(message.mcpName);
        setCurrentStep(message.step);
      } else if (message.type === 'connectionTestResult') {
        setTestResult(message.data);
        setTestingMCP(null);
        setCurrentStep(null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const testConnection = useCallback((mcpName: string) => {
    setTestResult(null);
    setTestingMCP(mcpName);
    setCurrentStep('Starting test...');
    postMessage({ type: 'testConnection', mcpName });
  }, []);

  const openLogs = useCallback(() => {
    postMessage({ type: 'openLogs' });
  }, []);

  const clearResult = useCallback(() => {
    setTestResult(null);
  }, []);

  return { testingMCP, currentStep, testResult, testConnection, openLogs, clearResult };
}








