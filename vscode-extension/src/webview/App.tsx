/**
 * Main App component for MCP Guard webview
 */

import React, { useState } from 'react';
import { useSettings, useMCPServers, useNotifications, useTokenSavings, useConnectionTest, postMessage } from './hooks';
import { Header, MCPCard, EmptyState, Notification, Button, ShieldIcon, ShieldOffIcon, BeakerIcon, TestingTab, TokenSavingsBadge, ConnectionTestModal } from './components';
import type { MCPSecurityConfig, MCPGuardSettings } from './types';

export const App: React.FC = () => {
  const { settings, saveSettings, saveMCPConfig, isLoading: settingsLoading } = useSettings();
  const { servers, isLoading: serversLoading, refresh } = useMCPServers();
  const { notifications, dismiss } = useNotifications();
  const { tokenSavings, assessingMCPs } = useTokenSavings();
  const { testingMCP, currentStep, testResult, testConnection, openLogs, clearResult } = useConnectionTest();
  const [showTestingTab, setShowTestingTab] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);

  const isLoading = settingsLoading || serversLoading;
  const isAssessingTokens = assessingMCPs.size > 0;

  const handleGlobalToggle = (enabled: boolean) => {
    const newSettings: MCPGuardSettings = { ...settings, enabled };
    saveSettings(newSettings);
  };

  const handleConfigChange = (config: MCPSecurityConfig) => {
    saveMCPConfig(config);
  };

  const handleImport = () => {
    postMessage({ type: 'importFromIDE' });
  };

  const handleTestConnection = (mcpName: string) => {
    setShowTestModal(true);
    testConnection(mcpName);
  };

  const handleViewLogs = () => {
    openLogs();
  };

  const handleCloseTestModal = () => {
    setShowTestModal(false);
    clearResult();
  };

  // Find existing config for each server
  const getConfigForServer = (serverName: string): MCPSecurityConfig | undefined => {
    return settings.mcpConfigs.find(c => c.mcpName === serverName);
  };

  // Check if a server is guarded
  const isServerGuarded = (serverName: string): boolean => {
    const config = getConfigForServer(serverName);
    return config?.isGuarded ?? false;
  };

  // Sort servers alphabetically
  const sortedServers = [...servers].sort((a, b) => a.name.localeCompare(b.name));
  
  // Count guarded and unguarded for status summary
  const guardedServers = sortedServers.filter(s => isServerGuarded(s.name));
  const unguardedServers = sortedServers.filter(s => !isServerGuarded(s.name));
  const guardedCount = guardedServers.length;
  const unguardedCount = unguardedServers.length;
  
  // Consistent yellow color for unguarded state (matches MCP card styling)
  const UNGUARDED_YELLOW = '#eab308'; // Muted yellow (less orange)

  return (
    <div style={{ padding: '16px', maxWidth: '100%' }}>
      {/* Notifications - Bottom positioned */}
      <div style={{ position: 'fixed', bottom: '16px', left: '16px', right: '16px', zIndex: 1000 }}>
        {notifications.map(n => (
          <Notification key={n.id} type={n.type} message={n.message} onDismiss={() => dismiss(n.id)} />
        ))}
      </div>

      {/* Header */}
      <Header
        globalEnabled={settings.enabled}
        onGlobalToggle={handleGlobalToggle}
        onRefresh={refresh}
        isLoading={isLoading}
      />

      {/* Testing Tab */}
      {showTestingTab && (
        <TestingTab
          servers={sortedServers}
          configs={settings.mcpConfigs}
          onBack={() => setShowTestingTab(false)}
        />
      )}

      {/* Main Content - Hidden when Testing Tab is shown */}
      {!showTestingTab && (
        <>
      {/* Disabled Banner */}
      {!settings.enabled && servers.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShieldOffIcon size={16} className={undefined} />
          <span style={{ fontSize: '13px', color: 'var(--error)', fontWeight: 500 }}>
            MCP Guard is disabled — all MCPs have direct access
          </span>
        </div>
      )}

      {/* Status Summary */}
      {servers.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '20px',
            opacity: settings.enabled ? 1 : 0.5,
          }}
        >
          {/* Unguarded - Primary focus */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              background: !settings.enabled 
                ? 'var(--bg-secondary)'
                : unguardedCount > 0 
                  ? 'rgba(234, 179, 8, 0.1)' 
                  : 'var(--bg-secondary)',
              border: !settings.enabled
                ? '1px solid var(--border-color)'
                : unguardedCount > 0 
                  ? `1px solid ${UNGUARDED_YELLOW}` 
                  : '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ color: !settings.enabled ? 'var(--text-muted)' : unguardedCount > 0 ? UNGUARDED_YELLOW : 'var(--text-secondary)' }}>
                <ShieldOffIcon size={16} className={undefined} />
              </div>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 600, 
                color: !settings.enabled ? 'var(--text-muted)' : unguardedCount > 0 ? UNGUARDED_YELLOW : 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Unguarded
              </span>
              <span style={{ 
                marginLeft: 'auto',
                fontSize: '18px', 
                fontWeight: 700, 
                color: !settings.enabled ? 'var(--text-muted)' : unguardedCount > 0 ? UNGUARDED_YELLOW : 'var(--text-muted)'
              }}>
                {!settings.enabled ? servers.length : unguardedCount}
              </span>
            </div>
            {!settings.enabled ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Protection disabled
              </div>
            ) : unguardedCount > 0 ? (
              <>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {unguardedCount} MCP{unguardedCount === 1 ? '' : 's'} need protection
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {unguardedServers.map(server => (
                    <span
                      key={server.name}
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(234, 179, 8, 0.2)',
                        border: `1px solid ${UNGUARDED_YELLOW}`,
                        color: 'var(--text-primary)',
                        fontWeight: 400,
                      }}
                    >
                      {server.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                All MCPs protected ✓
              </div>
            )}
          </div>

          {/* Guarded */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              background: !settings.enabled
                ? 'var(--bg-secondary)'
                : guardedCount > 0 
                  ? 'rgba(34, 197, 94, 0.1)' 
                  : 'var(--bg-secondary)',
              border: !settings.enabled
                ? '1px solid var(--border-color)'
                : guardedCount > 0 
                  ? '1px solid rgba(34, 197, 94, 0.3)' 
                  : '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <ShieldIcon size={16} className={undefined} />
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 600, 
                color: !settings.enabled ? 'var(--text-muted)' : guardedCount > 0 ? 'var(--success)' : 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {!settings.enabled ? 'Will Guard' : 'Guarded'}
              </span>
              <span style={{ 
                marginLeft: 'auto',
                fontSize: '18px', 
                fontWeight: 700, 
                color: !settings.enabled ? 'var(--text-muted)' : guardedCount > 0 ? 'var(--success)' : 'var(--text-muted)'
              }}>
                {!settings.enabled ? guardedCount : guardedCount}
              </span>
            </div>
            {!settings.enabled ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {guardedCount} MCP{guardedCount === 1 ? '' : 's'} configured
              </div>
            ) : guardedCount > 0 ? (
              <>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {guardedCount} MCP{guardedCount === 1 ? '' : 's'} protected
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {guardedServers.map(server => (
                    <span
                      key={server.name}
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        border: '1px solid #22c55e',
                        color: 'var(--text-primary)',
                        fontWeight: 400,
                      }}
                    >
                      {server.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                No MCPs guarded yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Token Savings Badge */}
      {servers.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <TokenSavingsBadge 
            tokenSavings={tokenSavings}
            isAssessing={isAssessingTokens}
            globalEnabled={settings.enabled}
          />
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <span className="loading-spinner" style={{ width: '32px', height: '32px' }} />
          <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading MCP servers...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && servers.length === 0 && (
        <EmptyState onImport={handleImport} />
      )}

      {/* MCP List - Single alphabetically sorted list */}
      {!isLoading && !showTestingTab && sortedServers.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h2 style={{ 
              fontSize: '13px', 
              fontWeight: 600, 
              color: 'var(--text-secondary)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.5px'
            }}>
              MCP Servers ({sortedServers.length})
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowTestingTab(true)}
                disabled={guardedCount === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <BeakerIcon size={14} />
                Test
              </Button>
              <Button variant="ghost" size="sm" onClick={handleImport}>
                Re-import
              </Button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sortedServers.map(server => (
              <MCPCard
                key={server.name}
                server={server}
                config={getConfigForServer(server.name)}
                onConfigChange={handleConfigChange}
                currentIDE="cursor"
                globalEnabled={settings.enabled}
                onTestConnection={handleTestConnection}
                onViewLogs={handleViewLogs}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          MCP Guard v0.1.0 · 
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); postMessage({ type: 'openMCPGuardDocs' }); }}
            style={{ color: 'var(--accent)', marginLeft: '4px', textDecoration: 'none' }}
          >
            Documentation
          </a>
        </p>
      </div>
        </>
      )}

      {/* Connection Test Modal */}
      <ConnectionTestModal
        isOpen={showTestModal}
        onClose={handleCloseTestModal}
        testResult={testResult}
        testingMCP={testingMCP}
        currentStep={currentStep}
        onViewLogs={handleViewLogs}
        onRetry={testingMCP ? () => testConnection(testingMCP) : undefined}
      />
    </div>
  );
};

export default App;


