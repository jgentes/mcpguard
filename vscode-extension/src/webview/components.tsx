/**
 * React components for the MCP Guard webview UI
 * 
 * UI Component Guidelines:
 * - Use shadcn/ui-style components for consistency
 * - Switch component should be used for binary toggles (not custom toggle implementations)
 * - All UI components should follow shadcn design patterns when possible
 */

import React, { useState, useCallback } from 'react';
import type { MCPSecurityConfig, MCPServerInfo, MCPGuardSettings } from './types';
import { DEFAULT_SECURITY_CONFIG } from './types';

// ====================
// Utility Components
// ====================

interface IconProps {
  size?: number;
  className?: string;
}

export const ShieldIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

// Logo version with gradient - for header and empty state
export const ShieldLogo: React.FC<IconProps> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 128 128" fill="none">
    <defs>
      <linearGradient id="shieldMainLogo" x1="20%" y1="0%" x2="80%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#4ade80' }} />
        <stop offset="45%" style={{ stopColor: '#22c55e' }} />
        <stop offset="100%" style={{ stopColor: '#16a34a' }} />
      </linearGradient>
      <linearGradient id="shieldEdgeLogo" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style={{ stopColor: '#15803d' }} />
        <stop offset="100%" style={{ stopColor: '#166534' }} />
      </linearGradient>
    </defs>
    {/* Subtle shadow */}
    <path d="M64 12L112 26V54C112 84 90 106 64 117C38 106 16 84 16 54V26L64 12Z" 
          fill="#0f172a" 
          opacity="0.15"
          transform="translate(2, 3)"/>
    {/* Main shield */}
    <path d="M64 10L114 25V54C114 85 91 108 64 119C37 108 14 85 14 54V25L64 10Z" 
          fill="url(#shieldMainLogo)"/>
    {/* Left highlight */}
    <path d="M64 10L14 25V54C14 85 37 108 64 119L64 10Z" 
          fill="white" 
          opacity="0.15"/>
    {/* Right shadow */}
    <path d="M64 10L114 25V54C114 85 91 108 64 119L64 10Z" 
          fill="url(#shieldEdgeLogo)" 
          opacity="0.25"/>
    {/* Border */}
    <path d="M64 10L114 25V54C114 85 91 108 64 119C37 108 14 85 14 54V25L64 10Z" 
          fill="none" 
          stroke="#15803d" 
          strokeWidth="2"/>
    {/* White checkmark */}
    <path d="M46 62L58 74L82 50" 
          stroke="white" 
          strokeWidth="10" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          fill="none"/>
  </svg>
);

export const NetworkIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const FolderIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const AlertIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// Shield with X - for unguarded state
export const ShieldOffIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

// Copy icon for test prompts
export const CopyIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// Beaker icon for testing
export const BeakerIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4.5 3h15" />
    <path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3" />
    <path d="M6 14h12" />
  </svg>
);

// Close/X icon for modals
export const CloseIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Play icon for running tests
export const PlayIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

// Info icon
export const InfoIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

// ====================
// UI Components
// ====================

// ====================
// Switch Component (shadcn-style)
// ====================

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Switch component styled after shadcn/ui Switch
 * Uses consistent styling and proper alignment
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onCheckedChange, disabled = false, className }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        background: checked ? '#22c55e' : '#3f3f46',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.2s ease',
        padding: 0,
        outline: 'none',
      }}
      className={className}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          onCheckedChange(!checked);
        }
      }}
    >
      <span
        style={{
          display: 'block',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: 'white',
          position: 'absolute',
          top: '2px',
          left: checked ? '22px' : '2px',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
        }}
      />
    </button>
  );
};

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  description?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ enabled, onChange, label, description }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }} onClick={() => onChange(!enabled)}>
    <Switch checked={enabled} onCheckedChange={onChange} />
    {(label || description) && (
      <div style={{ flex: 1 }}>
        {label && <div style={{ fontWeight: 500 }}>{label}</div>}
        {description && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{description}</div>}
      </div>
    )}
  </div>
);

interface ButtonProps {
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const Button: React.FC<ButtonProps> = ({ onClick, variant = 'secondary', size = 'md', disabled, children, style }) => {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: size === 'sm' ? '4px 8px' : '8px 16px',
    fontSize: size === 'sm' ? '12px' : '13px',
    fontWeight: 500,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all 0.15s ease',
    ...style,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: { background: '#22c55e', color: 'white' },
    secondary: { background: 'var(--bg-hover)', color: 'var(--text-primary)' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)' },
    danger: { background: 'var(--error)', color: 'white' },
  };

  return (
    <button style={{ ...baseStyle, ...variants[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
};

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  style?: React.CSSProperties;
}

export const Input: React.FC<InputProps> = ({ value, onChange, placeholder, type = 'text', style }) => (
  <input
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      width: '100%',
      padding: '8px 12px',
      fontSize: '13px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-color)',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      ...style,
    }}
  />
);

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({ tags, onChange, placeholder }) => {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      if (!tags.includes(inputValue.trim())) {
        onChange([...tags, inputValue.trim()]);
      }
      setInputValue('');
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        padding: '8px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        minHeight: '40px',
      }}
    >
      {tags.map((tag, index) => (
        <span
          key={index}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            fontSize: '12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-hover)',
            color: 'var(--text-primary)',
          }}
        >
          {tag}
          <span
            onClick={() => removeTag(index)}
            style={{ cursor: 'pointer', opacity: 0.7, marginLeft: '2px' }}
          >
            ×
          </span>
        </span>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ''}
        style={{
          flex: 1,
          minWidth: '100px',
          padding: '2px 4px',
          fontSize: '13px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
    </div>
  );
};

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, icon, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {icon}
        <span style={{ flex: 1, fontWeight: 500 }}>{title}</span>
        <ChevronDownIcon
          size={16}
          className={undefined}
        />
      </div>
      {isOpen && (
        <div style={{ padding: '16px', background: 'var(--bg-primary)' }} className="animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
};

// ====================
// MCP Configuration Components
// ====================

interface MCPCardProps {
  server: MCPServerInfo;
  config?: MCPSecurityConfig;
  onConfigChange: (config: MCPSecurityConfig) => void;
  currentIDE?: string; // The IDE we're currently running in
  globalEnabled?: boolean; // Whether MCP Guard is globally enabled
}

export const MCPCard: React.FC<MCPCardProps> = ({ server, config, onConfigChange, currentIDE = 'cursor', globalEnabled = true }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [selectedTestType, setSelectedTestType] = useState<'quick' | 'network' | 'codeInjection' | 'filesystem' | 'legitimate'>('quick');
  
  // Initialize config if not exists
  const currentConfig: MCPSecurityConfig = config || {
    id: `config-${server.name}`,
    mcpName: server.name,
    isGuarded: false,
    ...DEFAULT_SECURITY_CONFIG,
    lastModified: new Date().toISOString(),
  };

  const updateConfig = useCallback((updates: Partial<MCPSecurityConfig>) => {
    onConfigChange({
      ...currentConfig,
      ...updates,
      lastModified: new Date().toISOString(),
    });
  }, [currentConfig, onConfigChange]);

  const sourceColors: Record<string, string> = {
    claude: '#cc7832',
    copilot: '#6e5494',
    cursor: '#00d1b2',
    unknown: 'var(--text-muted)',
  };

  // Determine border color based on guard status and global enabled state
  const getBorderColor = () => {
    if (!globalEnabled) {
      return 'var(--border-color)'; // Grey when globally disabled
    }
    return currentConfig.isGuarded ? '#22c55e' : 'var(--warning)';
  };

  return (
    <div
      style={{
        borderRadius: 'var(--radius-md)',
        border: `2px solid ${getBorderColor()}`,
        background: 'var(--bg-secondary)',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
        opacity: globalEnabled ? 1 : 0.7,
      }}
      className="animate-slide-in"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px',
          cursor: 'pointer',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: !globalEnabled 
              ? 'var(--bg-hover)'
              : currentConfig.isGuarded 
                ? '#22c55e' 
                : 'rgba(255, 215, 0, 0.15)',
            color: !globalEnabled 
              ? 'var(--text-muted)'
              : currentConfig.isGuarded 
                ? 'white' 
                : 'var(--warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
        >
          {!globalEnabled 
            ? <ShieldOffIcon size={18} />
            : currentConfig.isGuarded 
              ? <ShieldIcon size={18} /> 
              : <ShieldOffIcon size={18} />
          }
        </div>
        
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 600 }}>{server.name}</span>
            {/* Only show source tag if from a different IDE */}
            {server.source !== currentIDE && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: sourceColors[server.source] || sourceColors.unknown,
                  color: 'white',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {server.source}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {server.command ? `${server.command} ${(server.args || []).slice(0, 2).join(' ')}...` : server.url || 'No command'}
          </div>
        </div>

        {/* Test Button */}
        <div onClick={(e) => e.stopPropagation()}>
          <TestButton
            onClick={() => setShowTestModal(true)}
            disabled={!globalEnabled}
            isGuarded={currentConfig.isGuarded}
          />
        </div>

        {/* Guard Toggle */}
        <div 
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ 
            fontSize: '12px', 
            fontWeight: 500, 
            color: !globalEnabled 
              ? 'var(--text-muted)' 
              : currentConfig.isGuarded 
                ? 'var(--success)' 
                : 'var(--warning)' 
          }}>
            {!globalEnabled 
              ? (currentConfig.isGuarded ? 'Will Guard' : 'Unguarded')
              : (currentConfig.isGuarded ? 'Guarded' : 'Unguarded')
            }
          </span>
          <Switch 
            checked={currentConfig.isGuarded} 
            onCheckedChange={(checked) => updateConfig({ isGuarded: checked })}
          />
        </div>
        
        <ChevronDownIcon
          size={16}
          className={undefined}
        />
      </div>

      {/* Expanded Configuration */}
      {isExpanded && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }} className="animate-fade-in">
          {/* Network Configuration */}
          <CollapsibleSection
            title="Network Access"
            icon={<NetworkIcon size={16} />}
            defaultOpen={currentConfig.network.enabled}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Toggle
                enabled={currentConfig.network.enabled}
                onChange={(enabled) => updateConfig({
                  network: { ...currentConfig.network, enabled }
                })}
                label="Enable Network Access"
                description="Allow this MCP to make outbound network requests"
              />
              
              {currentConfig.network.enabled && (
                <>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                      Allowed Hosts
                    </label>
                    <TagInput
                      tags={currentConfig.network.allowlist}
                      onChange={(allowlist) => updateConfig({
                        network: { ...currentConfig.network, allowlist }
                      })}
                      placeholder="Enter domain and press Enter (e.g., api.github.com)"
                    />
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Only these hosts will be accessible. Leave empty to block all external requests.
                    </div>
                  </div>
                  
                  <Toggle
                    enabled={currentConfig.network.allowLocalhost}
                    onChange={(allowLocalhost) => updateConfig({
                      network: { ...currentConfig.network, allowLocalhost }
                    })}
                    label="Allow Localhost"
                    description="Permit requests to localhost and 127.0.0.1"
                  />
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* File System Configuration */}
          <CollapsibleSection
            title="File System Access"
            icon={<FolderIcon size={16} />}
            defaultOpen={currentConfig.fileSystem.enabled}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Toggle
                enabled={currentConfig.fileSystem.enabled}
                onChange={(enabled) => updateConfig({
                  fileSystem: { ...currentConfig.fileSystem, enabled }
                })}
                label="Enable File System Access"
                description="Allow this MCP to access the file system"
              />
              
              {currentConfig.fileSystem.enabled && (
                <>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                      Read Paths
                    </label>
                    <TagInput
                      tags={currentConfig.fileSystem.readPaths}
                      onChange={(readPaths) => updateConfig({
                        fileSystem: { ...currentConfig.fileSystem, readPaths }
                      })}
                      placeholder="Enter path and press Enter (e.g., /home/user/projects)"
                    />
                  </div>
                  
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                      Write Paths
                    </label>
                    <TagInput
                      tags={currentConfig.fileSystem.writePaths}
                      onChange={(writePaths) => updateConfig({
                        fileSystem: { ...currentConfig.fileSystem, writePaths }
                      })}
                      placeholder="Enter path and press Enter (e.g., /tmp)"
                    />
                    <div style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '4px' }}>
                      ⚠️ Write access should be granted carefully
                    </div>
                  </div>
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Resource Limits */}
          <CollapsibleSection
            title="Resource Limits"
            icon={<ClockIcon size={16} />}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                  Max Execution Time (ms)
                </label>
                <Input
                  type="number"
                  value={currentConfig.resourceLimits.maxExecutionTimeMs.toString()}
                  onChange={(value) => updateConfig({
                    resourceLimits: { ...currentConfig.resourceLimits, maxExecutionTimeMs: parseInt(value) || 30000 }
                  })}
                  placeholder="30000"
                />
              </div>
              
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                  Max Memory (MB)
                </label>
                <Input
                  type="number"
                  value={currentConfig.resourceLimits.maxMemoryMB.toString()}
                  onChange={(value) => updateConfig({
                    resourceLimits: { ...currentConfig.resourceLimits, maxMemoryMB: parseInt(value) || 128 }
                  })}
                  placeholder="128"
                />
              </div>
              
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                  Max MCP Calls per Execution
                </label>
                <Input
                  type="number"
                  value={currentConfig.resourceLimits.maxMCPCalls.toString()}
                  onChange={(value) => updateConfig({
                    resourceLimits: { ...currentConfig.resourceLimits, maxMCPCalls: parseInt(value) || 100 }
                  })}
                  placeholder="100"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* Save Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="primary" onClick={() => onConfigChange(currentConfig)}>
              <CheckIcon size={14} />
              Save Configuration
            </Button>
          </div>
        </div>
      )}

      {/* Test Prompt Modal */}
      <TestPromptModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        mcpName={server.name}
        testType={selectedTestType}
        isGuarded={currentConfig.isGuarded}
      />
    </div>
  );
};

// ====================
// Notification Component
// ====================

interface NotificationProps {
  type: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}

export const Notification: React.FC<NotificationProps> = ({ type, message, onDismiss }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 14px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-secondary)',
      border: `1px solid ${type === 'success' ? '#22c55e' : 'var(--error)'}`,
      color: type === 'success' ? '#22c55e' : 'var(--error)',
      fontSize: '12px',
      marginBottom: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}
    className="animate-fade-in"
  >
    {type === 'success' ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
    <span style={{ flex: 1, color: 'var(--text-primary)' }}>{message}</span>
    <span onClick={onDismiss} style={{ cursor: 'pointer', opacity: 0.5, fontSize: '16px' }}>×</span>
  </div>
);

// ====================
// Header Component
// ====================

interface HeaderProps {
  globalEnabled: boolean;
  onGlobalToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ globalEnabled, onGlobalToggle, onRefresh, isLoading }) => (
  <div style={{ marginBottom: '24px' }}>
    {/* Logo and Title */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
      <ShieldLogo size={48} />
      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>MCP Guard</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
          Secure isolation for MCP servers
        </p>
      </div>
    </div>

    {/* Global Toggle and Actions */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <Toggle
        enabled={globalEnabled}
        onChange={onGlobalToggle}
        label={globalEnabled ? "MCP Guard Enabled" : "MCP Guard Disabled"}
      />
      
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? <span className="loading-spinner" /> : <RefreshIcon size={14} />}
          Refresh
        </Button>
      </div>
    </div>
  </div>
);

// ====================
// Empty State Component
// ====================

export const EmptyState: React.FC<{ onImport: () => void }> = ({ onImport }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '48px 24px',
      borderRadius: 'var(--radius-lg)',
      border: '2px dashed var(--border-color)',
      background: 'var(--bg-secondary)',
    }}
  >
    <div style={{ marginBottom: '8px' }}>
      <ShieldLogo size={72} />
    </div>
    <h3 style={{ margin: '16px 0 8px', fontWeight: 600 }}>No MCP Servers Found</h3>
    <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
      Import MCP servers from your IDE configuration to get started.
    </p>
    <Button variant="primary" onClick={onImport}>
      <PlusIcon size={14} />
      Import from IDE Config
    </Button>
  </div>
);

// ====================
// Security Testing Components
// ====================

interface TestButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isGuarded?: boolean;
}

export const TestButton: React.FC<TestButtonProps> = ({ onClick, disabled, isGuarded }) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={(e) => {
      e?.stopPropagation();
      onClick();
    }}
    disabled={disabled}
    style={{ 
      padding: '4px 8px',
      color: isGuarded ? 'var(--success)' : 'var(--warning)',
    }}
  >
    <BeakerIcon size={14} />
    Test
  </Button>
);

interface TestPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  mcpName: string;
  testType: 'quick' | 'network' | 'codeInjection' | 'filesystem' | 'legitimate';
  isGuarded: boolean;
}

export const TestPromptModal: React.FC<TestPromptModalProps> = ({ isOpen, onClose, mcpName, testType, isGuarded }) => {
  const [copied, setCopied] = useState(false);

  const getTestPrompt = () => {
    switch (testType) {
      case 'quick':
        return {
          title: 'Quick Security Test',
          description: 'Verify MCPGuard\'s protections are active with a quick test.',
          prompt: `Test "${mcpName}" MCP security. Run this using execute_code with mcp_name "${mcpName}":

\`\`\`typescript
// Test 1: Network isolation
try {
  await fetch('https://httpcat.com/200');
  console.log('FAIL: Network not blocked');
} catch (e) {
  console.log('PASS: Network blocked');
}

// Test 2: Call a legitimate tool to confirm it works
// (The tool call itself proves legitimate operations work)
\`\`\`

Just report PASS or FAIL for each test.`,
        };
      
      case 'network':
        return {
          title: 'Network Isolation Test',
          description: 'Verify that arbitrary network requests are blocked.',
          prompt: `Test network isolation for "${mcpName}". Run using execute_code with mcp_name "${mcpName}":

\`\`\`typescript
try {
  await fetch('https://httpcat.com/200');
  console.log('FAIL: Fetch succeeded - network not isolated');
} catch (e) {
  console.log('PASS: Network request blocked');
}
\`\`\`

Just report PASS or FAIL.`,
        };
      
      case 'codeInjection':
        return {
          title: 'Code Injection Test',
          description: 'Verify that eval() and Function constructor are blocked.',
          prompt: `Test code injection prevention for "${mcpName}". Run using execute_code with mcp_name "${mcpName}":

\`\`\`typescript
let pass = 0;
try { eval('1'); } catch { pass++; console.log('PASS: eval blocked'); }
try { new Function('1'); } catch { pass++; console.log('PASS: Function blocked'); }
console.log(pass === 2 ? 'RESULT: Protected' : 'RESULT: Vulnerable');
\`\`\`

Just report the result.`,
        };
      
      case 'filesystem':
        return {
          title: 'Filesystem Isolation Test',
          description: 'Verify that filesystem access is blocked.',
          prompt: `Test filesystem isolation for "${mcpName}". Run using execute_code with mcp_name "${mcpName}":

\`\`\`typescript
try {
  require('fs');
  console.log('FAIL: fs module accessible');
} catch {
  console.log('PASS: fs blocked');
}
\`\`\`

Just report PASS or FAIL.`,
        };
      
      case 'legitimate':
        return {
          title: 'Legitimate Tool Test',
          description: 'Verify that normal MCP tools work correctly.',
          prompt: `Test that "${mcpName}" tools work through MCPGuard.

1. Use search_mcp_tools to find a tool for "${mcpName}"
2. Call it using execute_code with mcp_name "${mcpName}"

Just confirm if the tool call succeeded or failed.`,
        };
      
      default:
        return {
          title: 'Security Test',
          description: 'Verify MCPGuard protections.',
          prompt: `Test "${mcpName}" MCP security using execute_code.`,
        };
    }
  };

  const testInfo = getTestPrompt();

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(testInfo.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!isOpen) return null;

  // Show different content for unguarded MCPs
  if (!isGuarded) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px',
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            maxWidth: '500px',
            width: '100%',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
          className="animate-fade-in"
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              background: 'rgba(255, 215, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldOffIcon size={20} />
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--warning)' }}>
                  MCP Not Guarded
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {mcpName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--text-secondary)',
              }}
            >
              <CloseIcon size={20} />
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '20px' }}>
            <p style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: '13px' }}>
              This MCP is currently <strong>unguarded</strong>, which means it has direct access without MCPGuard's security isolation.
            </p>

            {/* Risk Explanation */}
            <div
              style={{
                background: 'rgba(255, 215, 0, 0.1)',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--warning)' }}>
                Potential Risks Without Guarding:
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <li><strong>Prompt Injection</strong> — Malicious content in MCP responses could trick the AI into harmful actions</li>
                <li><strong>Data Exfiltration</strong> — Compromised code could send sensitive data to external servers</li>
                <li><strong>Unauthorized Access</strong> — Code could attempt to access files or resources beyond the MCP's scope</li>
              </ul>
            </div>

            {/* How MCPGuard Helps */}
            <div
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--success)' }}>
                How MCPGuard Protects You:
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <li><strong>Network Isolation</strong> — All external network requests are blocked</li>
                <li><strong>Sandboxed Execution</strong> — Code runs in an isolated Cloudflare Worker</li>
                <li><strong>Code Validation</strong> — Dangerous patterns like eval() are blocked before execution</li>
                <li><strong>Legitimate Calls Work</strong> — Normal MCP tool calls function correctly</li>
              </ul>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              Enable guarding for this MCP, then run security tests to verify the protection is active.
            </p>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              padding: '16px 20px',
              borderTop: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}
          >
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in"
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BeakerIcon size={20} />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{testInfo.title}</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {mcpName} — Guarded
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: 'var(--text-secondary)',
            }}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
          <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {testInfo.description}
          </p>

          {/* Instructions */}
          <div
            style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <InfoIcon size={16} className={undefined} />
              <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                <strong>How to run this test:</strong>
                <ol style={{ margin: '8px 0 0', paddingLeft: '16px' }}>
                  <li>Copy the prompt below</li>
                  <li>Paste it into your AI chat (Cursor, Claude, etc.)</li>
                  <li>The AI will execute the test via MCPGuard's secure isolation</li>
                  <li>Review the results to verify protection is active</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Prompt Box */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-color)',
                background: 'var(--bg-hover)',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Test Prompt
              </span>
              <Button
                variant={copied ? 'primary' : 'secondary'}
                size="sm"
                onClick={copyToClipboard}
              >
                {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                {copied ? 'Copied!' : 'Copy to Chat'}
              </Button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '16px',
                fontSize: '12px',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-primary)',
                maxHeight: '300px',
                overflow: 'auto',
              }}
            >
              {testInfo.prompt}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={copyToClipboard}>
            <CopyIcon size={14} />
            {copied ? 'Copied!' : 'Copy to Chat'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Test type selector for the modal
interface TestTypeSelectorProps {
  selectedType: 'quick' | 'network' | 'codeInjection' | 'filesystem' | 'legitimate';
  onSelectType: (type: 'quick' | 'network' | 'codeInjection' | 'filesystem' | 'legitimate') => void;
}

export const TestTypeSelector: React.FC<TestTypeSelectorProps> = ({ selectedType, onSelectType }) => {
  const testTypes = [
    { id: 'quick' as const, name: 'Quick Test', description: 'Run all security tests', icon: <PlayIcon size={14} /> },
    { id: 'legitimate' as const, name: 'Legitimate Call', description: 'Test normal tool usage', icon: <CheckIcon size={14} /> },
    { id: 'network' as const, name: 'Network Isolation', description: 'Test fetch() blocking', icon: <NetworkIcon size={14} /> },
    { id: 'codeInjection' as const, name: 'Code Injection', description: 'Test eval() blocking', icon: <ShieldIcon size={14} /> },
    { id: 'filesystem' as const, name: 'Filesystem', description: 'Test fs access blocking', icon: <FolderIcon size={14} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {testTypes.map((test) => (
        <button
          key={test.id}
          onClick={() => onSelectType(test.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            border: selectedType === test.id ? '2px solid #22c55e' : '1px solid var(--border-color)',
            background: selectedType === test.id ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-secondary)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: selectedType === test.id ? '#22c55e' : 'var(--bg-hover)',
              color: selectedType === test.id ? 'white' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {test.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: '13px' }}>{test.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{test.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

// ====================
// Testing Tab Component
// ====================

interface TestingTabProps {
  servers: MCPServerInfo[];
  configs: MCPSecurityConfig[];
  onBack: () => void;
}

export const TestingTab: React.FC<TestingTabProps> = ({ servers, configs, onBack }) => {
  const [selectedMCP, setSelectedMCP] = useState<string | null>(null);
  const [selectedTestType, setSelectedTestType] = useState<'quick' | 'network' | 'codeInjection' | 'filesystem' | 'legitimate'>('quick');
  const [showModal, setShowModal] = useState(false);

  // Get guard status for selected MCP
  const getIsGuarded = (mcpName: string): boolean => {
    const config = configs.find(c => c.mcpName === mcpName);
    return config?.isGuarded ?? false;
  };
  
  const selectedMCPIsGuarded = selectedMCP ? getIsGuarded(selectedMCP) : false;

  const securityFeatures = [
    {
      icon: <NetworkIcon size={20} />,
      title: 'Network Isolation',
      description: 'Workers cannot make arbitrary network requests. All fetch() and HTTP calls are blocked.',
      color: '#3b82f6',
    },
    {
      icon: <ShieldIcon size={20} />,
      title: 'Code Injection Prevention',
      description: 'Dangerous patterns like eval(), Function constructor, and require() are blocked.',
      color: '#22c55e',
    },
    {
      icon: <FolderIcon size={20} />,
      title: 'Filesystem Isolation',
      description: 'No direct filesystem access. Workers run in a sandboxed environment.',
      color: '#f59e0b',
    },
    {
      icon: <ClockIcon size={20} />,
      title: 'Resource Limits',
      description: 'Execution time, memory, and MCP call limits prevent resource exhaustion attacks.',
      color: '#8b5cf6',
    },
  ];

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px 0',
            marginBottom: '12px',
            fontSize: '12px',
          }}
        >
          <ChevronDownIcon size={14} className={undefined} />
          Back to MCPs
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
            }}
          >
            <BeakerIcon size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Security Testing</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Validate that your MCPs are properly isolated
            </p>
          </div>
        </div>
      </div>

      {/* What MCPGuard Protects Against */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
          What MCPGuard Protects Against
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {securityFeatures.map((feature, index) => (
            <div
              key={index}
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-sm)',
                  background: `${feature.color}20`,
                  color: feature.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                }}
              >
                {feature.icon}
              </div>
              <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600 }}>{feature.title}</h4>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Run a Test Section */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
          Run a Security Test
        </h3>
        
        {/* Step 1: Select MCP */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
            Step 1: Select an MCP to test
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {servers.length > 0 ? (
              servers.map((server) => {
                const isGuarded = getIsGuarded(server.name);
                return (
                  <button
                    key={server.name}
                    onClick={() => setSelectedMCP(server.name)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      border: selectedMCP === server.name 
                        ? '2px solid #22c55e' 
                        : `1px solid ${isGuarded ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 215, 0, 0.3)'}`,
                      background: selectedMCP === server.name 
                        ? 'rgba(34, 197, 94, 0.1)' 
                        : isGuarded ? 'rgba(34, 197, 94, 0.05)' : 'rgba(255, 215, 0, 0.05)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: selectedMCP === server.name ? 600 : 400,
                      color: 'var(--text-primary)',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {isGuarded ? <ShieldIcon size={12} /> : <ShieldOffIcon size={12} />}
                    {server.name}
                    <span style={{ 
                      fontSize: '10px', 
                      padding: '1px 4px', 
                      borderRadius: '3px',
                      background: isGuarded ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 215, 0, 0.2)',
                      color: isGuarded ? 'var(--success)' : 'var(--warning)',
                      fontWeight: 500,
                    }}>
                      {isGuarded ? 'guarded' : 'unguarded'}
                    </span>
                  </button>
                );
              })
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                No MCPs available. Import MCPs from your IDE configuration first.
              </p>
            )}
          </div>
        </div>

        {/* Guard Status Notice */}
        {selectedMCP && (
          <div 
            style={{ 
              marginBottom: '16px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: selectedMCPIsGuarded ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 215, 0, 0.1)',
              border: `1px solid ${selectedMCPIsGuarded ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 215, 0, 0.3)'}`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }} 
            className="animate-fade-in"
          >
            {selectedMCPIsGuarded ? <ShieldIcon size={18} /> : <ShieldOffIcon size={18} />}
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: selectedMCPIsGuarded ? 'var(--success)' : 'var(--warning)' }}>
                {selectedMCPIsGuarded ? 'Ready to Test' : 'Enable Guarding First'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {selectedMCPIsGuarded 
                  ? 'Run security tests to verify that MCPGuard\'s protections are active. Tests will confirm that malicious operations are blocked while legitimate tool calls succeed.'
                  : 'This MCP is not guarded. Enable guarding to activate MCPGuard\'s security isolation, then run tests to verify the protection is working.'}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Select Test Type */}
        {selectedMCP && (
          <div style={{ marginBottom: '16px' }} className="animate-fade-in">
            <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
              Step 2: Choose a test type
            </label>
            <TestTypeSelector selectedType={selectedTestType} onSelectType={setSelectedTestType} />
          </div>
        )}

        {/* Step 3: Generate Prompt */}
        {selectedMCP && (
          <div className="animate-fade-in">
            <Button variant="primary" onClick={() => setShowModal(true)}>
              <PlayIcon size={14} />
              Generate Test Prompt
            </Button>
          </div>
        )}
      </div>

      {/* How Testing Works */}
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
        }}
      >
        <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <InfoIcon size={16} />
          How Security Testing Works
        </h4>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Tests run through MCPGuard's <code style={{ background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: '3px' }}>execute_code</code> tool, which executes code in a secure, isolated Cloudflare Worker environment. The tests verify that:
        </p>
        <ul style={{ margin: '0 0 12px', paddingLeft: '20px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <li><strong>Legitimate tool calls</strong> work correctly through the isolation layer</li>
          <li><strong>Network requests</strong> to external servers are blocked (prevents data exfiltration)</li>
          <li><strong>Dangerous code patterns</strong> like eval() are blocked (prevents code injection)</li>
          <li><strong>Filesystem access</strong> is unavailable (prevents unauthorized file access)</li>
        </ul>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Note: Tests only work for guarded MCPs. Enable guarding first to activate MCPGuard's protection layer.
        </p>
      </div>

      {/* Test Prompt Modal */}
      {selectedMCP && (
        <TestPromptModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          mcpName={selectedMCP}
          testType={selectedTestType}
          isGuarded={selectedMCPIsGuarded}
        />
      )}
    </div>
  );
};


