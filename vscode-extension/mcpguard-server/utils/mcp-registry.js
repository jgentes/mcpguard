import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from './config-manager.js';
import logger from './logger.js';
const DEFAULT_SECURITY_CONFIG = {
    network: {
        enabled: false,
        allowlist: [],
        allowLocalhost: false,
    },
    fileSystem: {
        enabled: false,
        readPaths: [],
        writePaths: [],
    },
    resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxMemoryMB: 128,
        maxMCPCalls: 100,
    },
};
const DEFAULT_SETTINGS_STORED = {
    enabled: true,
    defaults: DEFAULT_SECURITY_CONFIG,
    mcpConfigs: [],
};
let configManagerInstance = null;
function getConfigManager() {
    if (!configManagerInstance) {
        configManagerInstance = new ConfigManager();
    }
    return configManagerInstance;
}
function isMCPGuardedInIDEConfig(mcpName) {
    const configManager = getConfigManager();
    return configManager.isMCPDisabled(mcpName);
}
function hydrateConfig(storedConfig) {
    return {
        ...storedConfig,
        isGuarded: isMCPGuardedInIDEConfig(storedConfig.mcpName),
    };
}
function dehydrateConfig(config) {
    const { isGuarded: _, ...stored } = config;
    return stored;
}
export function getSettingsPath() {
    const configDir = join(homedir(), '.mcpguard');
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }
    return join(configDir, 'settings.json');
}
export function loadSettings() {
    const settingsPath = getSettingsPath();
    if (!existsSync(settingsPath)) {
        logger.debug({ settingsPath }, 'No MCP Guard settings file found, using defaults');
        return {
            ...DEFAULT_SETTINGS_STORED,
            mcpConfigs: [],
        };
    }
    try {
        const content = readFileSync(settingsPath, 'utf-8');
        const storedSettings = JSON.parse(content);
        const hydratedConfigs = storedSettings.mcpConfigs.map(hydrateConfig);
        const settings = {
            ...storedSettings,
            mcpConfigs: hydratedConfigs,
        };
        logger.debug({ settingsPath, mcpCount: settings.mcpConfigs.length }, 'Loaded MCP Guard settings');
        return settings;
    }
    catch (error) {
        logger.warn({ error, settingsPath }, 'Failed to load MCP Guard settings, using defaults');
        return {
            ...DEFAULT_SETTINGS_STORED,
            mcpConfigs: [],
        };
    }
}
export function saveSettings(settings) {
    const settingsPath = getSettingsPath();
    try {
        const storedSettings = {
            enabled: settings.enabled,
            defaults: settings.defaults,
            mcpConfigs: settings.mcpConfigs.map(dehydrateConfig),
            tokenMetricsCache: settings.tokenMetricsCache,
            mcpSchemaCache: settings.mcpSchemaCache,
        };
        writeFileSync(settingsPath, JSON.stringify(storedSettings, null, 2));
        logger.debug({ settingsPath }, 'Saved MCP Guard settings');
    }
    catch (error) {
        logger.error({ error, settingsPath }, 'Failed to save MCP Guard settings');
        throw error;
    }
}
export function toWorkerIsolationConfig(config) {
    return {
        mcpName: config.mcpName,
        isGuarded: config.isGuarded,
        outbound: {
            allowedHosts: config.network.enabled && config.network.allowlist.length > 0
                ? config.network.allowlist
                : null,
            allowLocalhost: config.network.enabled && config.network.allowLocalhost,
        },
        fileSystem: {
            enabled: config.fileSystem.enabled,
            readPaths: config.fileSystem.readPaths,
            writePaths: config.fileSystem.writePaths,
        },
        limits: {
            cpuMs: config.resourceLimits.maxExecutionTimeMs,
            memoryMB: config.resourceLimits.maxMemoryMB,
            subrequests: config.resourceLimits.maxMCPCalls,
        },
    };
}
export function getIsolationConfigForMCP(mcpName) {
    const settings = loadSettings();
    if (!settings.enabled) {
        logger.debug({ mcpName }, 'MCP Guard is globally disabled');
        return undefined;
    }
    const isGuarded = isMCPGuardedInIDEConfig(mcpName);
    if (!isGuarded) {
        logger.debug({ mcpName }, 'MCP is not guarded (not in _mcpguard_disabled)');
        return undefined;
    }
    const config = settings.mcpConfigs.find((c) => c.mcpName === mcpName);
    if (!config) {
        logger.debug({ mcpName }, 'No MCP Guard config found for guarded MCP, using defaults');
        const defaultConfig = {
            id: `config-${mcpName}-default`,
            mcpName,
            isGuarded: true,
            ...settings.defaults,
            lastModified: new Date().toISOString(),
        };
        return toWorkerIsolationConfig(defaultConfig);
    }
    return toWorkerIsolationConfig(config);
}
export function getAllGuardedMCPs() {
    const settings = loadSettings();
    const configs = new Map();
    if (!settings.enabled) {
        return configs;
    }
    const configManager = getConfigManager();
    const disabledMCPs = configManager.getDisabledMCPs();
    for (const mcpName of disabledMCPs) {
        const config = settings.mcpConfigs.find((c) => c.mcpName === mcpName);
        if (config) {
            configs.set(mcpName, toWorkerIsolationConfig(config));
        }
        else {
            const defaultConfig = {
                id: `config-${mcpName}-default`,
                mcpName,
                isGuarded: true,
                ...settings.defaults,
                lastModified: new Date().toISOString(),
            };
            configs.set(mcpName, toWorkerIsolationConfig(defaultConfig));
        }
    }
    logger.debug({ count: configs.size }, 'Loaded guarded MCP configurations');
    return configs;
}
export function isMCPGuarded(mcpName) {
    const settings = loadSettings();
    if (!settings.enabled) {
        return false;
    }
    return isMCPGuardedInIDEConfig(mcpName);
}
export function createDefaultConfig(mcpName) {
    const settings = loadSettings();
    return {
        id: `config-${mcpName}-${Date.now()}`,
        mcpName,
        isGuarded: isMCPGuardedInIDEConfig(mcpName),
        ...settings.defaults,
        lastModified: new Date().toISOString(),
    };
}
export function upsertMCPConfig(config) {
    const settings = loadSettings();
    const existingIndex = settings.mcpConfigs.findIndex((c) => c.mcpName === config.mcpName);
    if (existingIndex >= 0) {
        settings.mcpConfigs[existingIndex] = config;
    }
    else {
        settings.mcpConfigs.push(config);
    }
    saveSettings(settings);
    const actualGuarded = isMCPGuardedInIDEConfig(config.mcpName);
    logger.info({ mcpName: config.mcpName, isGuarded: actualGuarded }, 'Updated MCP configuration');
}
export function removeMCPConfig(mcpName) {
    const settings = loadSettings();
    settings.mcpConfigs = settings.mcpConfigs.filter((c) => c.mcpName !== mcpName);
    if (settings.tokenMetricsCache?.[mcpName]) {
        delete settings.tokenMetricsCache[mcpName];
    }
    saveSettings(settings);
    logger.info({ mcpName }, 'Removed MCP configuration');
}
export function cleanupTokenMetricsCache() {
    const settings = loadSettings();
    const configManager = getConfigManager();
    const allMCPs = configManager.getAllConfiguredMCPs();
    const removed = [];
    if (settings.tokenMetricsCache) {
        for (const mcpName of Object.keys(settings.tokenMetricsCache)) {
            if (!allMCPs[mcpName]) {
                delete settings.tokenMetricsCache[mcpName];
                removed.push(mcpName);
            }
        }
        if (removed.length > 0) {
            saveSettings(settings);
            logger.info({ removed }, 'Cleaned up stale token metrics cache entries');
        }
    }
    return { removed };
}
export function getCachedSchema(mcpName, configHash) {
    const settings = loadSettings();
    const cacheKey = `${mcpName}:${configHash}`;
    return settings.mcpSchemaCache?.[cacheKey] || null;
}
export function saveCachedSchema(entry) {
    const settings = loadSettings();
    const cacheKey = `${entry.mcpName}:${entry.configHash}`;
    if (!settings.mcpSchemaCache) {
        settings.mcpSchemaCache = {};
    }
    settings.mcpSchemaCache[cacheKey] = entry;
    saveSettings(settings);
    logger.debug({ mcpName: entry.mcpName, cacheKey, toolCount: entry.toolCount }, 'Saved MCP schema to persistent cache');
}
export function cleanupSchemaCache() {
    const settings = loadSettings();
    const configManager = getConfigManager();
    const allMCPs = configManager.getAllConfiguredMCPs() || {};
    const removed = [];
    if (settings.mcpSchemaCache) {
        for (const cacheKey of Object.keys(settings.mcpSchemaCache)) {
            const [mcpName] = cacheKey.split(':');
            const mcpConfig = allMCPs[mcpName];
            if (!mcpConfig) {
                delete settings.mcpSchemaCache[cacheKey];
                removed.push(cacheKey);
                logger.debug({ cacheKey }, 'Removed schema cache entry for deleted MCP');
            }
        }
        if (removed.length > 0) {
            saveSettings(settings);
            logger.info({ removed }, 'Cleaned up stale schema cache entries');
        }
    }
    return { removed };
}
export function clearMCPSchemaCache(mcpName) {
    const settings = loadSettings();
    const removed = [];
    if (settings.mcpSchemaCache) {
        for (const cacheKey of Object.keys(settings.mcpSchemaCache)) {
            if (cacheKey.startsWith(`${mcpName}:`)) {
                delete settings.mcpSchemaCache[cacheKey];
                removed.push(cacheKey);
            }
        }
        if (removed.length > 0) {
            try {
                saveSettings(settings);
                logger.info({ mcpName, removed }, 'Cleared schema cache entries for MCP - will re-fetch tools on next connection');
            }
            catch (error) {
                logger.error({ error, mcpName, removed }, 'Failed to persist schema cache clear for MCP');
                return { removed, success: false };
            }
        }
        else {
            logger.debug({ mcpName }, 'No schema cache entries found for MCP');
        }
    }
    return { removed, success: true };
}
export { isMCPGuardedInIDEConfig as isGuardedInIDEConfig };
//# sourceMappingURL=mcp-registry.js.map