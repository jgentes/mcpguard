import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseJSONC } from 'jsonc-parser';
import logger from './logger.js';
export class ConfigManager {
    configPath = null;
    configSource = null;
    ideDefinitions = [
        {
            id: 'claude-code',
            displayName: 'Claude Code',
            priority: 1,
            paths: {
                windows: [
                    join(homedir(), '.claude', 'mcp.json'),
                    join(homedir(), '.claude', 'mcp.jsonc'),
                    join(homedir(), 'AppData', 'Roaming', 'Claude Code', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), 'AppData', 'Roaming', 'Claude Code', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                macos: [
                    join(homedir(), '.claude', 'mcp.json'),
                    join(homedir(), '.claude', 'mcp.jsonc'),
                    join(homedir(), 'Library', 'Application Support', 'Claude Code', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), 'Library', 'Application Support', 'Claude Code', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                linux: [
                    join(homedir(), '.claude', 'mcp.json'),
                    join(homedir(), '.claude', 'mcp.jsonc'),
                    join(homedir(), '.config', 'Claude Code', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), '.config', 'Claude Code', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                default: join(homedir(), '.claude', 'mcp.jsonc'),
            },
        },
        {
            id: 'github-copilot',
            displayName: 'GitHub Copilot',
            priority: 2,
            paths: {
                windows: [
                    join(homedir(), '.github', 'copilot', 'mcp.json'),
                    join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
                    join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.json'),
                    join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.jsonc'),
                    join(homedir(), 'AppData', 'Roaming', 'GitHub Copilot', 'mcp.json'),
                    join(homedir(), 'AppData', 'Roaming', 'GitHub Copilot', 'mcp.jsonc'),
                ],
                macos: [
                    join(homedir(), '.github', 'copilot', 'mcp.json'),
                    join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
                    join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.json'),
                    join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.jsonc'),
                    join(homedir(), 'Library', 'Application Support', 'GitHub Copilot', 'mcp.json'),
                    join(homedir(), 'Library', 'Application Support', 'GitHub Copilot', 'mcp.jsonc'),
                ],
                linux: [
                    join(homedir(), '.github', 'copilot', 'mcp.json'),
                    join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
                    join(homedir(), '.config', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.json'),
                    join(homedir(), '.config', 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.jsonc'),
                    join(homedir(), '.config', 'GitHub Copilot', 'mcp.json'),
                    join(homedir(), '.config', 'GitHub Copilot', 'mcp.jsonc'),
                ],
                default: join(homedir(), '.github', 'copilot', 'mcp.jsonc'),
            },
        },
        {
            id: 'cursor',
            displayName: 'Cursor',
            priority: 3,
            paths: {
                windows: [
                    join(homedir(), '.cursor', 'mcp.json'),
                    join(homedir(), '.cursor', 'mcp.jsonc'),
                    join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                macos: [
                    join(homedir(), '.cursor', 'mcp.json'),
                    join(homedir(), '.cursor', 'mcp.jsonc'),
                    join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                linux: [
                    join(homedir(), '.cursor', 'mcp.json'),
                    join(homedir(), '.cursor', 'mcp.jsonc'),
                    join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'mcp.json'),
                    join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'mcp.jsonc'),
                ],
                default: join(homedir(), '.cursor', 'mcp.jsonc'),
            },
        },
    ];
    constructor() {
        const result = this.findConfigFile();
        this.configPath = result.path;
        this.configSource = result.source;
    }
    getPlatformPaths(ide) {
        const platform = process.platform;
        if (platform === 'win32') {
            return ide.paths.windows;
        }
        else if (platform === 'darwin') {
            return ide.paths.macos;
        }
        else {
            return ide.paths.linux;
        }
    }
    findConfigFile() {
        const sortedIDEs = [...this.ideDefinitions].sort((a, b) => a.priority - b.priority);
        for (const ide of sortedIDEs) {
            const paths = this.getPlatformPaths(ide);
            for (const path of paths) {
                if (existsSync(path)) {
                    logger.info({ path, ide: ide.id }, `Found ${ide.displayName} MCP config file`);
                    return { path, source: ide.id };
                }
            }
        }
        logger.warn('MCP config file not found in standard locations for any supported IDE');
        return { path: null, source: null };
    }
    resolveEnvVars(value) {
        return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
            const envValue = process.env[varName];
            if (envValue === undefined) {
                logger.warn({ varName }, `Environment variable ${varName} not found, keeping placeholder`);
                return match;
            }
            return envValue;
        });
    }
    resolveEnvVarsInObject(obj) {
        if (typeof obj === 'string') {
            return this.resolveEnvVars(obj);
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.resolveEnvVarsInObject(item));
        }
        if (obj && typeof obj === 'object') {
            const resolved = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = this.resolveEnvVarsInObject(value);
            }
            return resolved;
        }
        return obj;
    }
    readConfigFile(filePath) {
        if (!existsSync(filePath)) {
            return null;
        }
        try {
            const content = readFileSync(filePath, 'utf-8');
            const config = parseJSONC(content);
            if (!config || typeof config !== 'object') {
                logger.warn({ filePath }, 'Invalid config file format');
                return null;
            }
            if (!config.mcpServers || typeof config.mcpServers !== 'object') {
                config.mcpServers = {};
            }
            const activeConfig = {
                mcpServers: {},
                _mcpguard_disabled: config._mcpguard_disabled,
                _mcpguard_metadata: config._mcpguard_metadata,
            };
            for (const [name, mcpConfig] of Object.entries(config.mcpServers)) {
                if (config._mcpguard_disabled?.[name]) {
                    continue;
                }
                activeConfig.mcpServers[name] = mcpConfig;
            }
            return activeConfig;
        }
        catch (error) {
            logger.error({ error, filePath }, 'Failed to read config file');
            return null;
        }
    }
    readRawConfigFile(filePath) {
        if (!existsSync(filePath)) {
            return null;
        }
        try {
            const content = readFileSync(filePath, 'utf-8');
            const config = parseJSONC(content);
            if (!config || typeof config !== 'object') {
                logger.warn({ filePath }, 'Invalid config file format');
                return null;
            }
            if (!config.mcpServers || typeof config.mcpServers !== 'object') {
                config.mcpServers = {};
            }
            return config;
        }
        catch (error) {
            logger.error({ error, filePath }, 'Failed to read config file');
            return null;
        }
    }
    writeConfigFile(filePath, config) {
        try {
            const dir = dirname(filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const content = JSON.stringify(config, null, 2);
            writeFileSync(filePath, content, 'utf-8');
        }
        catch (error) {
            logger.error({ error, filePath }, 'Failed to write config file');
            throw error;
        }
    }
    getSavedConfigs() {
        const configs = {};
        if (!this.configPath || !this.configSource) {
            return configs;
        }
        const fileConfig = this.readConfigFile(this.configPath);
        if (fileConfig) {
            for (const [name, config] of Object.entries(fileConfig.mcpServers)) {
                configs[name] = {
                    config: config,
                    source: this.configSource,
                };
            }
        }
        return configs;
    }
    getSavedConfig(mcpName) {
        const saved = this.getSavedConfigs();
        const entry = saved[mcpName];
        if (!entry) {
            return null;
        }
        return this.resolveEnvVarsInObject(entry.config);
    }
    saveConfig(mcpName, config) {
        if (!this.configPath) {
            const sortedIDEs = [...this.ideDefinitions].sort((a, b) => a.priority - b.priority);
            let foundIDE = null;
            for (const ide of sortedIDEs) {
                const defaultDir = dirname(ide.paths.default);
                if (existsSync(defaultDir)) {
                    foundIDE = ide;
                    break;
                }
            }
            const ideToUse = foundIDE || sortedIDEs[0];
            const defaultPath = ideToUse.paths.default;
            const dir = dirname(defaultPath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            this.configPath = defaultPath;
            this.configSource = ideToUse.id;
        }
        const existingConfig = this.readConfigFile(this.configPath) || {
            mcpServers: {},
        };
        existingConfig.mcpServers[mcpName] = config;
        this.writeConfigFile(this.configPath, existingConfig);
        const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
        const sourceName = ide ? ide.displayName : 'IDE';
        logger.info({ mcpName, configPath: this.configPath, source: this.configSource }, `MCP config saved to ${sourceName} config file`);
    }
    deleteConfig(mcpName) {
        if (!this.configPath) {
            return false;
        }
        const existingConfig = this.readRawConfigFile(this.configPath);
        if (!existingConfig) {
            return false;
        }
        let deleted = false;
        if (existingConfig.mcpServers[mcpName]) {
            delete existingConfig.mcpServers[mcpName];
            deleted = true;
        }
        if (existingConfig._mcpguard_disabled?.[mcpName]) {
            delete existingConfig._mcpguard_disabled[mcpName];
            deleted = true;
            if (Object.keys(existingConfig._mcpguard_disabled).length === 0) {
                delete existingConfig._mcpguard_disabled;
            }
        }
        if (!deleted) {
            return false;
        }
        this.writeConfigFile(this.configPath, existingConfig);
        const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
        const sourceName = ide ? ide.displayName : 'IDE';
        logger.info({ mcpName, configPath: this.configPath, source: this.configSource }, `MCP config deleted from ${sourceName} config file`);
        return true;
    }
    importConfigs(configPath) {
        const errors = [];
        let imported = 0;
        if (configPath) {
            this.configPath = configPath;
            const detectedIDE = this.ideDefinitions.find((ide) => configPath.toLowerCase().includes(ide.id.replace('-', '')) ||
                configPath
                    .toLowerCase()
                    .includes(ide.displayName.toLowerCase().replace(/\s+/g, '')));
            if (detectedIDE) {
                this.configSource = detectedIDE.id;
            }
            if (existsSync(configPath)) {
                const config = this.readConfigFile(configPath);
                if (config) {
                    imported = Object.keys(config.mcpServers).length;
                    const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
                    const sourceName = ide ? ide.displayName : 'IDE';
                    logger.info({ path: configPath, imported, source: this.configSource }, `Loaded ${sourceName} configs from specified path`);
                }
            }
            else {
                errors.push(`Config file not found: ${configPath}`);
                logger.debug({ path: configPath }, 'Config file does not exist yet, will be created on save');
            }
        }
        else {
            const result = this.findConfigFile();
            this.configPath = result.path;
            this.configSource = result.source;
            if (this.configPath) {
                const config = this.readConfigFile(this.configPath);
                if (config) {
                    imported = Object.keys(config.mcpServers).length;
                    const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
                    const sourceName = ide ? ide.displayName : 'IDE';
                    logger.info({ path: this.configPath, imported, source: this.configSource }, `Refreshed ${sourceName} configs`);
                }
            }
            else {
                const ideNames = this.ideDefinitions
                    .map((d) => d.displayName)
                    .join(', ');
                errors.push(`MCP config file not found in standard locations for ${ideNames}`);
            }
        }
        return { imported, errors };
    }
    getCursorConfigPath() {
        return this.configPath;
    }
    getConfigSource() {
        return this.configSource;
    }
    getConfigSourceDisplayName() {
        if (!this.configSource) {
            return 'IDE';
        }
        const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
        return ide ? ide.displayName : 'IDE';
    }
    getAllConfiguredMCPs() {
        const allMCPs = {};
        if (!this.configPath || !this.configSource) {
            return allMCPs;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig) {
            return allMCPs;
        }
        for (const [name, config] of Object.entries(rawConfig.mcpServers || {})) {
            if (name.toLowerCase() !== 'mcpguard' && config) {
                allMCPs[name] = {
                    config: config,
                    source: this.configSource,
                    status: 'active',
                };
            }
        }
        for (const [name, config] of Object.entries(rawConfig._mcpguard_disabled || {})) {
            if (name.toLowerCase() !== 'mcpguard' && config) {
                allMCPs[name] = {
                    config: config,
                    source: this.configSource,
                    status: 'disabled',
                };
            }
        }
        return allMCPs;
    }
    getGuardedMCPConfigs() {
        const guardedConfigs = {};
        if (!this.configPath || !this.configSource) {
            return guardedConfigs;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig) {
            return guardedConfigs;
        }
        for (const [name, config] of Object.entries(rawConfig.mcpServers || {})) {
            if (name.toLowerCase() !== 'mcpguard' && config) {
                guardedConfigs[name] = {
                    config: config,
                    source: this.configSource,
                };
            }
        }
        for (const [name, config] of Object.entries(rawConfig._mcpguard_disabled || {})) {
            if (name.toLowerCase() !== 'mcpguard' && config) {
                guardedConfigs[name] = {
                    config: config,
                    source: this.configSource,
                };
            }
        }
        return guardedConfigs;
    }
    disableMCP(mcpName) {
        if (!this.configPath) {
            logger.warn('No config file found, cannot disable MCP');
            return false;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig) {
            return false;
        }
        if (!rawConfig.mcpServers[mcpName]) {
            if (rawConfig._mcpguard_disabled?.[mcpName]) {
                logger.info({ mcpName }, 'MCP is already disabled');
                return false;
            }
            logger.warn({ mcpName }, 'MCP not found in config');
            return false;
        }
        const mcpConfig = rawConfig.mcpServers[mcpName];
        delete rawConfig.mcpServers[mcpName];
        if (!rawConfig._mcpguard_disabled) {
            rawConfig._mcpguard_disabled = {};
        }
        rawConfig._mcpguard_disabled[mcpName] = mcpConfig;
        if (!rawConfig._mcpguard_metadata) {
            rawConfig._mcpguard_metadata = {};
        }
        rawConfig._mcpguard_metadata.disabled_at = new Date().toISOString();
        this.writeConfigFile(this.configPath, rawConfig);
        const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
        const sourceName = ide ? ide.displayName : 'IDE';
        logger.info({ mcpName, configPath: this.configPath, source: this.configSource }, `MCP disabled in ${sourceName} config file (moved to _mcpguard_disabled)`);
        return true;
    }
    enableMCP(mcpName) {
        if (!this.configPath) {
            logger.warn('No config file found, cannot enable MCP');
            return false;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig) {
            return false;
        }
        if (!rawConfig._mcpguard_disabled?.[mcpName]) {
            logger.warn({ mcpName }, 'MCP not found in disabled list');
            return false;
        }
        const mcpConfig = rawConfig._mcpguard_disabled[mcpName];
        delete rawConfig._mcpguard_disabled[mcpName];
        if (!rawConfig.mcpServers) {
            rawConfig.mcpServers = {};
        }
        rawConfig.mcpServers[mcpName] = mcpConfig;
        if (rawConfig._mcpguard_disabled &&
            Object.keys(rawConfig._mcpguard_disabled).length === 0) {
            delete rawConfig._mcpguard_disabled;
        }
        this.writeConfigFile(this.configPath, rawConfig);
        const ide = this.ideDefinitions.find((d) => d.id === this.configSource);
        const sourceName = ide ? ide.displayName : 'IDE';
        logger.info({ mcpName, configPath: this.configPath, source: this.configSource }, `MCP enabled in ${sourceName} config file (moved from _mcpguard_disabled)`);
        return true;
    }
    disableAllExceptMCPGuard() {
        const result = {
            disabled: [],
            failed: [],
            alreadyDisabled: [],
            mcpguardRestored: false,
        };
        if (!this.configPath) {
            return result;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig || !rawConfig.mcpServers) {
            return result;
        }
        if (rawConfig._mcpguard_disabled?.mcpguard) {
            this.enableMCP('mcpguard');
            result.mcpguardRestored = true;
        }
        for (const [mcpName] of Object.entries(rawConfig.mcpServers)) {
            if (mcpName.toLowerCase() === 'mcpguard') {
                continue;
            }
            if (rawConfig._mcpguard_disabled?.[mcpName]) {
                result.alreadyDisabled.push(mcpName);
            }
            else if (this.disableMCP(mcpName)) {
                result.disabled.push(mcpName);
            }
            else {
                result.failed.push(mcpName);
            }
        }
        return result;
    }
    restoreAllDisabled() {
        const restored = [];
        if (!this.configPath) {
            return restored;
        }
        const rawConfig = this.readRawConfigFile(this.configPath);
        if (!rawConfig || !rawConfig._mcpguard_disabled) {
            return restored;
        }
        for (const [mcpName] of Object.entries(rawConfig._mcpguard_disabled)) {
            if (this.enableMCP(mcpName)) {
                restored.push(mcpName);
            }
        }
        return restored;
    }
    getDisabledMCPs() {
        if (!this.configPath) {
            return [];
        }
        const rawConfig = this.readConfigFile(this.configPath);
        if (!rawConfig || !rawConfig._mcpguard_disabled) {
            return [];
        }
        return Object.keys(rawConfig._mcpguard_disabled);
    }
    isMCPDisabled(mcpName) {
        return this.getDisabledMCPs().includes(mcpName);
    }
    getDisabledMCPNames() {
        return this.getDisabledMCPs();
    }
    getRawConfig() {
        if (!this.configPath) {
            return null;
        }
        return this.readRawConfigFile(this.configPath);
    }
}
//# sourceMappingURL=config-manager.js.map