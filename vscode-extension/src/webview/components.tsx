/**
 * React components for the MCP Guard webview UI
 * 
 * UI Component Guidelines:
 * - Use shadcn/ui-style components for consistency
 * - Switch component should be used for binary toggles (not custom toggle implementations)
 * - All UI components should follow shadcn design patterns when possible
 */

import React, { useState, useCallback } from 'react';
import type { MCPSecurityConfig, MCPServerInfo, MCPGuardSettings, TokenSavingsSummary, ConnectionTestResult, ConnectionTestStep } from './types';
import { DEFAULT_SECURITY_CONFIG } from './types';
import { postMessage } from './hooks';

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

export const ErrorIcon: React.FC<IconProps & { style?: React.CSSProperties }> = ({ size = 20, className, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

// Zap/lightning icon for tokens
export const ZapIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

// Sparkles icon for token savings
export const SparklesIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
);

// Terminal/Log icon for viewing logs
export const TerminalIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

// Bug icon for diagnostics
export const BugIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="8" y="6" width="8" height="14" rx="4" />
    <path d="m19 7-3 2" />
    <path d="m5 7 3 2" />
    <path d="m19 19-3-2" />
    <path d="m5 19 3-2" />
    <path d="M20 13h-4" />
    <path d="M4 13h4" />
    <path d="M10 4l1 2" />
    <path d="M14 4l-1 2" />
  </svg>
);

// ====================
// UI Components
// ====================

// ====================
// Token Savings Badge Component
// ====================

interface TokenSavingsBadgeProps {
  tokenSavings: TokenSavingsSummary | null;
  isAssessing: boolean;
  globalEnabled: boolean;
  servers?: MCPServerInfo[];
  mcpConfigs?: MCPSecurityConfig[];
  contextWindowSize?: number;
  onContextWindowChange?: (size: number) => void;
}

// Default context window size (200k tokens - Claude/GPT-4 standard)
const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;

// MCPGuard's consolidated tool baseline (~500 tokens for all MCPGuard tools)
const MCPGUARD_BASELINE_TOKENS = 500;

// Anthropic's article on code execution with MCP and context efficiency
const CONTEXT_WINDOW_ARTICLE_URL = 'https://www.anthropic.com/engineering/code-execution-with-mcp';

// Get status based on total MCP tokens relative to context window
// Based on Anthropic research: MCP tools should use minimal context
// to avoid degrading LLM reasoning quality - code execution can reduce by 98%+
const getTokenStatus = (tokens: number, contextWindowSize: number): { label: string; color: string; severity: 'low' | 'high' | 'critical' } => {
  const percentage = (tokens / contextWindowSize) * 100;
  if (percentage < 2.5) return { label: 'Excellent', color: '#22c55e', severity: 'low' };
  if (percentage < 5) return { label: 'Good', color: '#84cc16', severity: 'low' };
  if (percentage < 10) return { label: 'High', color: '#f97316', severity: 'high' };
  return { label: 'Critical', color: '#ef4444', severity: 'critical' };
};

// Generate a consistent color for an MCP based on its name
const getMCPColor = (name: string, index: number): string => {
  const colors = [
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#a855f7', // Violet
    '#ec4899', // Pink
    '#f43f5e', // Rose
    '#f97316', // Orange
    '#eab308', // Yellow
    '#84cc16', // Lime
    '#22c55e', // Green
    '#14b8a6', // Teal
    '#06b6d4', // Cyan
    '#3b82f6', // Blue
  ];
  // Use name hash + index for color selection
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[(Math.abs(hash) + index) % colors.length];
};

/**
 * Displays context window token usage as a visual bar
 * Shows relative size of each MCP's token contribution
 * Color-coded based on impact to LLM performance
 * 
 * Research shows MCP tools should ideally use <10% of context window
 * to avoid degrading LLM reasoning quality (up to 85% accuracy drop possible)
 */
export const TokenSavingsBadge: React.FC<TokenSavingsBadgeProps> = ({ 
  tokenSavings, 
  isAssessing,
  globalEnabled,
  servers = [],
  mcpConfigs = [],
  contextWindowSize = DEFAULT_CONTEXT_WINDOW_SIZE,
  onContextWindowChange
}) => {
  const [hoveredMCP, setHoveredMCP] = useState<string | null>(null);
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [contextInputValue, setContextInputValue] = useState('');

  // Use configured context window size
  const effectiveContextWindow = contextWindowSize || DEFAULT_CONTEXT_WINDOW_SIZE;

  // Helper to check if an MCP is guarded
  const isGuarded = (mcpName: string): boolean => {
    const config = mcpConfigs.find(c => c.mcpName === mcpName);
    return config?.isGuarded ?? false;
  };

  // Handle context window input submit (value is in K, so 200 = 200k)
  const handleContextSubmit = () => {
    const numValue = parseInt(contextInputValue, 10);
    if (!isNaN(numValue) && numValue > 0 && onContextWindowChange) {
      onContextWindowChange(numValue * 1000); // Convert K to actual tokens
    }
    setIsEditingContext(false);
    setContextInputValue('');
  };

  if (!tokenSavings && !isAssessing) {
    return null;
  }

  // Format number with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  // Format number with K suffix (no decimal for round numbers)
  const formatCompact = (num: number): string => {
    if (num >= 1000) {
      const k = num / 1000;
      return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
    }
    return num.toString();
  };

  // Open external link via extension
  const openContextArticle = () => {
    postMessage({ type: 'openExternalLink', url: CONTEXT_WINDOW_ARTICLE_URL });
  };

  // No servers with token metrics yet
  if (!tokenSavings || tokenSavings.assessedMCPs === 0) {
    // Still assessing
    if (isAssessing) {
      return (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '6px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="loading-spinner" style={{ width: '14px', height: '14px' }} />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Assessing MCP token usage...
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: '6px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ZapIcon size={14} className={undefined} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            No MCP token data available
          </span>
        </div>
      </div>
    );
  }

  // Calculate total tokens and MCP breakdown
  // All MCPs with token data, marking which are guarded
  const allMcpsWithTokens = servers
    .filter(s => s.tokenMetrics?.estimatedTokens)
    .map((s, index) => ({
      name: s.name,
      tokens: s.tokenMetrics!.estimatedTokens,
      color: getMCPColor(s.name, index),
      toolCount: s.tokenMetrics!.toolCount,
      isGuarded: globalEnabled && isGuarded(s.name),
    }))
    .sort((a, b) => b.tokens - a.tokens); // Sort by tokens descending

  // Split into guarded and unguarded
  const unguardedMcps = allMcpsWithTokens.filter(m => !m.isGuarded);
  const guardedMcps = allMcpsWithTokens.filter(m => m.isGuarded);
  
  // Calculate totals
  const unguardedTokens = unguardedMcps.reduce((sum, mcp) => sum + mcp.tokens, 0);
  const guardedTokensOriginal = guardedMcps.reduce((sum, mcp) => sum + mcp.tokens, 0);
  const hasGuardedMcps = guardedMcps.length > 0 && globalEnabled;

  // Actual context usage: unguarded at full size + MCPGuard baseline (if any guarded)
  const actualTokens = unguardedTokens + (hasGuardedMcps ? MCPGUARD_BASELINE_TOKENS : 0);
  
  // Total tokens for bar proportions: show ALL MCPs at original size
  // This lets us visualize the "savings" - guarded MCPs shown but marked as consolidated
  const totalTokensForBar = unguardedTokens + guardedTokensOriginal;
  
  // Status based on ACTUAL usage (what's really consuming context)
  const contextPercentage = (actualTokens / effectiveContextWindow) * 100;
  const status = getTokenStatus(actualTokens, effectiveContextWindow);
  
  // For display, use actual tokens
  const totalTokens = actualTokens;
  
  // All MCPs shown in bar (both guarded and unguarded)
  const mcpsWithTokens = allMcpsWithTokens;

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: '6px',
        background: 'var(--bg-secondary)',
        border: `1px solid ${status.color}40`,
        opacity: globalEnabled ? 1 : 0.6,
      }}
      className="animate-fade-in"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ZapIcon size={14} className={undefined} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            MCP Context Usage
          </span>
          <button
            onClick={openContextArticle}
            title="Learn how MCPGuard improves context efficiency (Anthropic Engineering)"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              borderRadius: '50%',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <InfoIcon size={14} className={undefined} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span 
            style={{ 
              fontSize: '10px', 
              padding: '2px 8px', 
              borderRadius: '4px',
              background: `${status.color}20`,
              color: status.color,
              fontWeight: 600,
            }}
          >
            {status.label}
          </span>
          {isEditingContext ? (
            <>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {contextPercentage.toFixed(1)}% of{' '}
              </span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={String(effectiveContextWindow / 1000)}
                  value={contextInputValue}
                  onChange={(e) => {
                    // Only allow numeric input
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setContextInputValue(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleContextSubmit();
                    if (e.key === 'Escape') {
                      setIsEditingContext(false);
                      setContextInputValue('');
                    }
                  }}
                  onBlur={handleContextSubmit}
                  style={{
                    width: '50px',
                    fontSize: '11px',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    border: '1px solid var(--accent)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>k</span>
              </div>
            </>
          ) : (
            <span
              onClick={() => {
                if (onContextWindowChange) {
                  setContextInputValue(String(effectiveContextWindow / 1000));
                  setIsEditingContext(true);
                }
              }}
              title={onContextWindowChange ? "Click to change context window size" : "Context window size"}
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                cursor: onContextWindowChange ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => onContextWindowChange && (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
            >
              {contextPercentage.toFixed(1)}% of {formatCompact(effectiveContextWindow)}
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar - shows all MCPs proportionally */}
      {/* Guarded: green outline, Unguarded: yellow outline */}
      <div
        style={{
          height: '28px',
          borderRadius: '4px',
          background: 'var(--bg-primary)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* MCP Segments */}
        <div style={{ display: 'flex', height: '100%', width: '100%' }}>
          {mcpsWithTokens.map((mcp, index) => {
            // Use totalTokensForBar so all MCPs are visible at their original proportions
            const segmentWidth = totalTokensForBar > 0 ? (mcp.tokens / totalTokensForBar) * 100 : 0;
            const isHovered = hoveredMCP === mcp.name;
            const isLast = index === mcpsWithTokens.length - 1;
            
            // Colors matching the status boxes
            const GUARDED_GREEN = '#22c55e';
            const UNGUARDED_YELLOW = '#eab308';
            
            return (
              <div
                key={mcp.name}
                onMouseEnter={() => setHoveredMCP(mcp.name)}
                onMouseLeave={() => setHoveredMCP(null)}
                style={{
                  width: `${segmentWidth}%`,
                  height: '100%',
                  // Guarded: green background/border, Unguarded: yellow background/border
                  background: mcp.isGuarded 
                    ? 'rgba(34, 197, 94, 0.15)' 
                    : 'rgba(234, 179, 8, 0.25)',
                  opacity: isHovered ? 1 : 0.85,
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  // Colored borders all around each segment
                  borderTop: `2px solid ${mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW}`,
                  borderBottom: `2px solid ${mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW}`,
                  borderLeft: index === 0 ? `2px solid ${mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW}` : 'none',
                  borderRight: isLast ? `2px solid ${mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW}` : '1px solid rgba(0,0,0,0.3)',
                  borderRadius: index === 0 ? '4px 0 0 4px' : (isLast ? '0 4px 4px 0' : '0'),
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
                title={mcp.isGuarded 
                  ? `${mcp.name}: ${formatNumber(mcp.tokens)} tokens → guarded (consolidated to ~${formatNumber(MCPGUARD_BASELINE_TOKENS)} shared)`
                  : `${mcp.name}: ${formatNumber(mcp.tokens)} tokens (${mcp.toolCount} tools) - unguarded`}
              >
                {/* Show name and icon */}
                {segmentWidth > 12 && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      padding: '0 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {mcp.isGuarded && <ShieldIcon size={12} className={undefined} />}
                    {!mcp.isGuarded && <ShieldOffIcon size={12} className={undefined} />}
                    {mcp.name}
                  </span>
                )}
                {/* Small icons for narrow segments */}
                {segmentWidth <= 12 && segmentWidth > 3 && (
                  <span style={{ color: mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW }}>
                    {mcp.isGuarded ? <ShieldIcon size={10} className={undefined} /> : <ShieldOffIcon size={10} className={undefined} />}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Total token count overlay - shows ACTUAL usage */}
        <div
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '12px',
            fontWeight: 700,
            color: 'white',
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>{formatNumber(totalTokens)}</span>
          <span style={{ fontSize: '10px', fontWeight: 500, opacity: 0.9 }}>tokens</span>
        </div>
      </div>

      {/* Legend - shows MCP breakdown */}
      <div style={{ marginTop: '8px' }}>
        {hoveredMCP ? (
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              flexWrap: 'wrap',
            }}
            className="animate-fade-in"
          >
            {(() => {
              const mcp = mcpsWithTokens.find(m => m.name === hoveredMCP);
              if (!mcp) return null;
              const mcpBarPercent = totalTokensForBar > 0 ? ((mcp.tokens / totalTokensForBar) * 100).toFixed(0) : '0';
              const mcpContextPercent = ((mcp.tokens / effectiveContextWindow) * 100).toFixed(2);
              
              // Colors matching status boxes
              const GUARDED_GREEN = '#22c55e';
              const UNGUARDED_YELLOW = '#eab308';
              
              // Display for guarded MCP
              if (mcp.isGuarded) {
                return (
                  <>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        border: `1px solid ${GUARDED_GREEN}`,
                        flexShrink: 0,
                      }}
                    />
                    <ShieldIcon size={12} className={undefined} />
                    <span style={{ fontWeight: 600, color: GUARDED_GREEN }}>{mcp.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {formatNumber(mcp.tokens)} → ~{formatNumber(Math.round(MCPGUARD_BASELINE_TOKENS / guardedMcps.length))} tokens
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span>{mcp.toolCount} tools</span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span style={{ color: GUARDED_GREEN, fontWeight: 500 }}>protected</span>
                  </>
                );
              }
              
              // Display for unguarded MCP
              return (
                <>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '2px',
                      background: mcp.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{mcp.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span>{formatNumber(mcp.tokens)} tokens</span>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span>{mcp.toolCount} tools</span>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span style={{ color: mcp.color, fontWeight: 600 }}>{mcpBarPercent}%</span>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span style={{ color: UNGUARDED_YELLOW, fontWeight: 500 }}>unguarded</span>
                </>
              );
            })()}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '10px' }}>
            {mcpsWithTokens.map(mcp => {
              const mcpBarPercent = totalTokensForBar > 0 ? ((mcp.tokens / totalTokensForBar) * 100).toFixed(0) : '0';
              
              // Colors matching status boxes
              const GUARDED_GREEN = '#22c55e';
              const UNGUARDED_YELLOW = '#eab308';
              
              return (
                <div 
                  key={mcp.name}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: mcp.isGuarded 
                      ? 'rgba(34, 197, 94, 0.1)' 
                      : 'rgba(234, 179, 8, 0.1)',
                    border: `1px solid ${mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW}`,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setHoveredMCP(mcp.name)}
                  onMouseLeave={() => setHoveredMCP(null)}
                >
                  {mcp.isGuarded ? (
                    <ShieldIcon size={10} className={undefined} />
                  ) : (
                    <ShieldOffIcon size={10} className={undefined} />
                  )}
                  <span style={{ 
                    color: mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW, 
                    fontWeight: 500 
                  }}>
                    {mcp.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {formatCompact(mcp.tokens)}
                  </span>
                  <span style={{ 
                    color: mcp.isGuarded ? GUARDED_GREEN : UNGUARDED_YELLOW, 
                    fontWeight: 600 
                  }}>
                    {mcpBarPercent}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Potential Savings - show what could be saved by guarding unguarded MCPs */}
      {unguardedMcps.length > 0 && unguardedTokens > MCPGUARD_BASELINE_TOKENS && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '4px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <ZapIcon size={14} className={undefined} />
          <span style={{ color: 'var(--text-secondary)' }}>
            Guard {unguardedMcps.length} MCP{unguardedMcps.length === 1 ? '' : 's'} for{' '}
            <span style={{ color: '#eab308', fontWeight: 600 }}>
              {Math.round((1 - MCPGUARD_BASELINE_TOKENS / unguardedTokens) * 100)}%
            </span>
            {' '}reduction in token usage{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              ({formatNumber(unguardedTokens - MCPGUARD_BASELINE_TOKENS)} tokens)
            </span>
          </span>
        </div>
      )}

      {/* Impact Warning - based on Anthropic research that excessive tool definitions degrade LLM performance */}
      {status.severity !== 'low' && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '4px',
            background: `${status.color}10`,
            border: `1px solid ${status.color}30`,
            fontSize: '11px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <AlertIcon size={14} className={undefined} />
          <div>
            <span style={{ fontWeight: 600, color: status.color }}>
              {status.severity === 'critical' ? 'High impact on LLM performance. ' : 'Notable context consumption. '}
            </span>
            {status.severity === 'critical' 
              ? 'Context usage above 10% can significantly degrade LLM reasoning quality. '
              : 'MCP tools are using a notable portion of context. '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openContextArticle(); }}
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              Learn more
            </a>
          </div>
        </div>
      )}

      {/* Active Token Savings Info (if guarded) */}
      {hasGuardedMcps && guardedTokensOriginal > MCPGUARD_BASELINE_TOKENS && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '4px',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <SparklesIcon size={14} className={undefined} />
          <span style={{ color: 'var(--text-secondary)' }}>
            MCPGuard achieving{' '}
            <span style={{ color: '#22c55e', fontWeight: 600 }}>
              {Math.round((1 - MCPGUARD_BASELINE_TOKENS / guardedTokensOriginal) * 100)}%
            </span>
            {' '}reduction{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              ({formatNumber(guardedTokensOriginal - MCPGUARD_BASELINE_TOKENS)} tokens from {guardedMcps.length} guarded MCP{guardedMcps.length === 1 ? '' : 's'})
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

// ====================
// Switch Component (shadcn-style)
// ====================

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  uncheckedColor?: string;
}

/**
 * Switch component styled after shadcn/ui Switch
 * Uses consistent styling and proper alignment
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onCheckedChange, disabled = false, className, uncheckedColor = '#3f3f46' }) => {
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
        background: checked ? '#22c55e' : uncheckedColor,
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
  onTestConnection?: (mcpName: string) => void; // Callback to test connection
  onViewLogs?: () => void; // Callback to open logs
}

export const MCPCard: React.FC<MCPCardProps> = ({ server, config, onConfigChange, currentIDE = 'cursor', globalEnabled = true, onTestConnection, onViewLogs }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
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

  // Consistent yellow color for unguarded state (matches status panel)
  const UNGUARDED_YELLOW = '#eab308'; // Muted yellow (less orange)
  
  // Determine border color based on guard status and global enabled state
  const getBorderColor = () => {
    if (!globalEnabled) {
      return 'var(--border-color)'; // Grey when globally disabled
    }
    return currentConfig.isGuarded ? '#22c55e' : UNGUARDED_YELLOW;
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
                : 'rgba(234, 179, 8, 0.15)',
            color: !globalEnabled 
              ? 'var(--text-muted)'
              : currentConfig.isGuarded 
                ? 'white' 
                : UNGUARDED_YELLOW,
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
            {/* Token count badge - successfully assessed */}
            {server.tokenMetrics && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(139, 92, 246, 0.5)',
                  color: '#8b5cf6',
                  fontWeight: 500,
                }}
                title={`${server.tokenMetrics.schemaChars.toLocaleString()} chars in schema`}
              >
                {server.tokenMetrics.toolCount} tools · {server.tokenMetrics.estimatedTokens.toLocaleString()} tokens
              </span>
            )}
            {/* Assessment error - auth failed */}
            {!server.tokenMetrics && server.assessmentError?.type === 'auth_failed' && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: 'var(--error)',
                  fontWeight: 500,
                }}
                title={server.assessmentError.message}
              >
                auth failed
              </span>
            )}
            {/* Assessment error - other errors */}
            {!server.tokenMetrics && server.assessmentError && server.assessmentError.type !== 'auth_failed' && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: 'var(--error)',
                  fontWeight: 500,
                }}
                title={server.assessmentError.message}
              >
                {server.assessmentError.type === 'connection_failed' ? 'connection failed' : 
                 server.assessmentError.type === 'timeout' ? 'timeout' : 'error'}
              </span>
            )}
            {/* URL-based MCP with auth configured but no error yet */}
            {!server.tokenMetrics && !server.assessmentError && server.url && server.headers && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(255, 215, 0, 0.5)',
                  color: 'var(--warning)',
                  fontWeight: 500,
                }}
                title="URL-based MCP with authentication. Expand for details."
              >
                {Object.keys(server.headers)[0]} configured
              </span>
            )}
            {/* URL-based MCP without auth and no error */}
            {!server.tokenMetrics && !server.assessmentError && server.url && !server.headers && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: 'var(--error)',
                  fontWeight: 500,
                }}
                title="URL-based MCP without authentication configured"
              >
                no auth
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {server.command ? `${server.command} ${(server.args || []).slice(0, 2).join(' ')}...` : server.url || 'No command'}
          </div>
        </div>

        {/* Guard Toggle */}
        <div 
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ 
            fontSize: '12px', 
            fontWeight: 400, 
            color: 'var(--text-secondary)'
          }}>
            {!globalEnabled 
              ? (currentConfig.isGuarded ? 'Will Guard' : 'Unguarded')
              : (currentConfig.isGuarded ? 'Guarded' : 'Unguarded')
            }
          </span>
          <Switch 
            checked={currentConfig.isGuarded} 
            onCheckedChange={(checked) => updateConfig({ isGuarded: checked })}
            uncheckedColor={currentConfig.isGuarded ? undefined : UNGUARDED_YELLOW}
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
          
          {/* Auth Failed Error - show prominently */}
          {server.assessmentError?.type === 'auth_failed' && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <ErrorIcon size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: 'var(--error)' }}>
                    Authentication Failed
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {server.assessmentError.message}
                    {server.headers && (
                      <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
                        Current header: <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '2px' }}>
                          {Object.keys(server.headers).join(', ')}
                        </code>
                      </div>
                    )}
                  </div>
                  
                  {/* Diagnostics Preview */}
                  {server.assessmentError.diagnostics?.responseBody && (
                    <div style={{ marginTop: '8px' }}>
                      <details style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>Response details</summary>
                        <pre style={{ 
                          margin: 0, 
                          padding: '6px', 
                          background: 'var(--bg-primary)', 
                          borderRadius: '4px', 
                          overflow: 'auto', 
                          maxHeight: '80px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {server.assessmentError.diagnostics.responseBody}
                        </pre>
                      </details>
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => postMessage({ type: 'openIDEConfig', source: server.source })}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Open Config
                    </button>
                    {onTestConnection && (
                      <button
                        onClick={() => onTestConnection(server.name)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(59, 130, 246, 0.5)',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#3b82f6',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <BugIcon size={12} />
                        Test Connection
                      </button>
                    )}
                    <button
                      onClick={() => postMessage({ type: 'retryAssessment', mcpName: server.name })}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(139, 92, 246, 0.5)',
                        background: 'rgba(139, 92, 246, 0.15)',
                        color: '#8b5cf6',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Retry
                    </button>
                    {onViewLogs && (
                      <button
                        onClick={onViewLogs}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <TerminalIcon size={12} />
                        View Logs
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Other Assessment Errors */}
          {server.assessmentError && server.assessmentError.type !== 'auth_failed' && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(255, 215, 0, 0.08)',
                border: '1px solid rgba(255, 215, 0, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <InfoIcon size={16} className={undefined} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: 'var(--warning)' }}>
                    {server.assessmentError.type === 'connection_failed' ? 'Connection Failed' :
                     server.assessmentError.type === 'timeout' ? 'Connection Timed Out' : 'Assessment Error'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {server.assessmentError.message}
                    {server.assessmentError.statusCode && (
                      <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>
                        (HTTP {server.assessmentError.statusCode})
                      </span>
                    )}
                  </div>
                  
                  {/* Diagnostics Preview */}
                  {server.assessmentError.diagnostics?.responseBody && (
                    <div style={{ marginTop: '8px' }}>
                      <details style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>Response details</summary>
                        <pre style={{ 
                          margin: 0, 
                          padding: '6px', 
                          background: 'var(--bg-primary)', 
                          borderRadius: '4px', 
                          overflow: 'auto', 
                          maxHeight: '80px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {server.assessmentError.diagnostics.responseBody}
                        </pre>
                      </details>
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {onTestConnection && server.url && (
                      <button
                        onClick={() => onTestConnection(server.name)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid rgba(59, 130, 246, 0.5)',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#3b82f6',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <BugIcon size={12} />
                        Test Connection
                      </button>
                    )}
                    <button
                      onClick={() => postMessage({ type: 'retryAssessment', mcpName: server.name })}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(139, 92, 246, 0.5)',
                        background: 'rgba(139, 92, 246, 0.15)',
                        color: '#8b5cf6',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Retry
                    </button>
                    {onViewLogs && (
                      <button
                        onClick={onViewLogs}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <TerminalIcon size={12} />
                        View Logs
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Token Assessment Status - for URL-based MCPs without metrics and no error */}
          {!server.tokenMetrics && !server.assessmentError && server.url && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: server.headers ? 'rgba(255, 215, 0, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${server.headers ? 'rgba(255, 215, 0, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <InfoIcon size={16} className={undefined} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: server.headers ? 'var(--warning)' : 'var(--error)' }}>
                    Tool count unavailable
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {server.headers ? (
                      <>
                        This URL-based MCP has <strong>{Object.keys(server.headers).join(', ')}</strong> configured, 
                        but we couldn't connect to count its tools. This is normal for MCPs that require 
                        session-based auth (like GitHub Copilot). The MCP will still work correctly when used.
                      </>
                    ) : (
                      <>
                        This URL-based MCP has no authentication headers configured. 
                        If this MCP requires auth, add headers to your Cursor MCP config.
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    URL: {server.url}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Token metrics display - for successfully assessed MCPs */}
          {server.tokenMetrics && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tools</div>
                  <div style={{ fontWeight: 600, color: '#8b5cf6' }}>{server.tokenMetrics.toolCount}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Schema Size</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{server.tokenMetrics.schemaChars.toLocaleString()} chars</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Est. Tokens</div>
                  <div style={{ fontWeight: 600, color: '#8b5cf6' }}>{server.tokenMetrics.estimatedTokens.toLocaleString()}</div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
                  Assessed {new Date(server.tokenMetrics.assessedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          )}

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

// ====================
// Connection Test Modal
// ====================

interface ConnectionTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  testResult: ConnectionTestResult | null;
  testingMCP: string | null;
  currentStep: string | null;
  onViewLogs: () => void;
  onRetry?: () => void;
}

/**
 * Get troubleshooting tips based on error type
 */
function getTroubleshootingTips(error?: ConnectionTestResult['error']): string[] {
  if (!error) return [];
  
  switch (error.type) {
    case 'auth_failed':
      return [
        'Check that your Authorization header or API key is correct',
        'Verify the token/key has not expired',
        'Ensure the header name matches what the server expects (e.g., "Authorization" vs "X-API-Key")',
        'Try generating a new token if the current one seems valid',
      ];
    case 'connection_failed':
      if (error.statusCode === 400) {
        return [
          'HTTP 400 typically means the request format is incorrect',
          'The MCP server may expect a different protocol version',
          'Check if the URL endpoint is correct for MCP communication',
          'Some MCP servers require specific headers beyond Authorization',
        ];
      }
      if (error.statusCode === 404) {
        return [
          'The URL endpoint may be incorrect',
          'Verify the MCP server URL in your IDE configuration',
          'The server may have moved to a different path',
        ];
      }
      if (error.statusCode && error.statusCode >= 500) {
        return [
          'The server is experiencing issues - try again later',
          'Check the MCP server\'s status page if available',
          'This may be a temporary outage',
        ];
      }
      return [
        'Check that the URL is correct and accessible',
        'Verify your network connection and any proxy settings',
        'The server may be down or unreachable',
      ];
    case 'timeout':
      return [
        'The server took too long to respond (>10 seconds)',
        'Check your network connection speed',
        'The server may be overloaded or experiencing issues',
        'Try again later if the problem persists',
      ];
    default:
      return [
        'Review the error details in the Output panel',
        'Check your MCP configuration in the IDE settings',
        'Consult the MCP server documentation',
      ];
  }
}

export const ConnectionTestModal: React.FC<ConnectionTestModalProps> = ({ 
  isOpen, 
  onClose, 
  testResult, 
  testingMCP,
  currentStep,
  onViewLogs,
  onRetry,
}) => {
  if (!isOpen) return null;

  const isLoading = testingMCP && !testResult;
  const tips = testResult?.error ? getTroubleshootingTips(testResult.error) : [];

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
          maxWidth: '700px',
          width: '100%',
          maxHeight: '85vh',
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
            background: testResult?.success 
              ? 'rgba(34, 197, 94, 0.1)' 
              : testResult?.error 
                ? 'rgba(239, 68, 68, 0.1)'
                : 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BugIcon size={20} />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                Connection Test {testResult ? (testResult.success ? '- Passed' : '- Failed') : ''}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {testingMCP || testResult?.mcpName || 'Testing connection...'}
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
          {/* Loading State */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '32px' }}>
              <span className="loading-spinner" style={{ width: '32px', height: '32px' }} />
              <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
                {currentStep || 'Testing connection...'}
              </p>
            </div>
          )}

          {/* Test Results */}
          {testResult && (
            <>
              {/* Summary */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '20px',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: testResult.success 
                    ? 'rgba(34, 197, 94, 0.1)' 
                    : 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${testResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {testResult.success ? <CheckIcon size={20} /> : <ErrorIcon size={20} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: testResult.success ? 'var(--success)' : 'var(--error)' }}>
                    {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Completed in {testResult.durationMs}ms
                  </div>
                </div>
              </div>

              {/* Steps */}
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Test Steps
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {testResult.steps.map((step, index) => (
                    <TestStepDisplay key={index} step={step} />
                  ))}
                </div>
              </div>

              {/* Error Details */}
              {testResult.error && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--error)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Error Details
                  </h4>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(239, 68, 68, 0.05)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600 }}>Type:</span>{' '}
                      <code style={{ background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: '3px' }}>
                        {testResult.error.type}
                      </code>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600 }}>Message:</span>{' '}
                      {testResult.error.message}
                    </div>
                    {testResult.error.statusCode && (
                      <div>
                        <span style={{ fontWeight: 600 }}>HTTP Status:</span>{' '}
                        {testResult.error.statusCode} {testResult.error.statusText || ''}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Troubleshooting Tips */}
              {tips.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Troubleshooting Tips
                  </h4>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '20px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                    }}
                  >
                    {tips.map((tip, index) => (
                      <li key={index} style={{ marginBottom: '4px' }}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Diagnostics Note */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                }}
              >
                <strong>Need more details?</strong> Click "View Logs" to see full request/response data in the Output panel.
              </div>
            </>
          )}
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
          <Button variant="ghost" onClick={onViewLogs}>
            <TerminalIcon size={14} />
            View Logs
          </Button>
          {testResult?.error && onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              <RefreshIcon size={14} />
              Retry
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Display a single test step
 */
const TestStepDisplay: React.FC<{ step: ConnectionTestStep }> = ({ step }) => {
  const [expanded, setExpanded] = useState(false);
  const hasData = step.data?.request || step.data?.response;

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-secondary)',
        border: `1px solid ${step.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: hasData ? 'pointer' : 'default',
        }}
        onClick={() => hasData && setExpanded(!expanded)}
      >
        {step.success ? (
          <CheckIcon size={14} className={undefined} />
        ) : (
          <ErrorIcon size={14} style={{ color: 'var(--error)' }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: '12px' }}>{step.name}</div>
          {step.details && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {step.details}
            </div>
          )}
        </div>
        {step.durationMs !== undefined && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {step.durationMs}ms
          </span>
        )}
        {hasData && (
          <ChevronDownIcon 
            size={14} 
            className={undefined}
          />
        )}
      </div>

      {/* Expanded Data */}
      {expanded && hasData && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
          {step.data?.request && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                Request
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  fontSize: '10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-primary)',
                  overflow: 'auto',
                  maxHeight: '150px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {step.data.request}
              </pre>
            </div>
          )}
          {step.data?.response && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                Response
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  fontSize: '10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-primary)',
                  overflow: 'auto',
                  maxHeight: '150px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {step.data.response}
              </pre>
            </div>
          )}
        </div>
      )}
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


