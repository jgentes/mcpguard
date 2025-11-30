/**
 * Main App component for MCP Guard webview
 */

import React, { useState } from 'react';
import { useSettings, useMCPServers, useNotifications, postMessage } from './hooks';
import { Header, MCPCard, EmptyState, Notification, Button, ShieldIcon, ShieldOffIcon, BeakerIcon, TestingTab } from './components';
import type { MCPSecurityConfig, MCPGuardSettings } from './types';

export const App: React.FC = () => {
  const { settings, saveSettings, saveMCPConfig, isLoading: settingsLoading } = useSettings();
  const { servers, isLoading: serversLoading, refresh } = useMCPServers();
  const { notifications, dismiss } = useNotifications();
  const [showTestingTab, setShowTestingTab] = useState(false);

  const isLoading = settingsLoading || serversLoading;

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
  const guardedCount = sortedServers.filter(s => isServerGuarded(s.name)).length;
  const unguardedCount = sortedServers.length - guardedCount;

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

      {/* Tab Buttons */}
      {!showTestingTab && servers.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowTestingTab(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <BeakerIcon size={14} />
            Security Testing
          </Button>
        </div>
      )}

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
                  ? 'rgba(255, 215, 0, 0.1)' 
                  : 'var(--bg-secondary)',
              border: !settings.enabled
                ? '1px solid var(--border-color)'
                : unguardedCount > 0 
                  ? `1px solid var(--warning)` 
                  : '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <ShieldOffIcon size={16} className={undefined} />
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 600, 
                color: !settings.enabled ? 'var(--text-muted)' : unguardedCount > 0 ? 'var(--warning)' : 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Unguarded
              </span>
              <span style={{ 
                marginLeft: 'auto',
                fontSize: '18px', 
                fontWeight: 700, 
                color: !settings.enabled ? 'var(--text-muted)' : unguardedCount > 0 ? 'var(--warning)' : 'var(--text-muted)'
              }}>
                {!settings.enabled ? servers.length : unguardedCount}
              </span>
            </div>
            {!settings.enabled ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Protection disabled
              </div>
            ) : unguardedCount > 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {unguardedCount} MCP{unguardedCount === 1 ? '' : 's'} need protection
              </div>
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
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {guardedCount} MCP{guardedCount === 1 ? '' : 's'} protected
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                No MCPs guarded yet
              </div>
            )}
          </div>
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
      {!isLoading && sortedServers.length > 0 && (
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
            <Button variant="ghost" size="sm" onClick={handleImport}>
              Re-import
            </Button>
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
    </div>
  );
};

export default App;


