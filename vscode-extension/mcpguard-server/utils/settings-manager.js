import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
export function getSettingsPath() {
    const configDir = path.join(os.homedir(), '.mcpguard');
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'settings.json');
}
export function loadSettings() {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
        return {};
    }
    try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        console.warn('Failed to load settings:', error);
        return {};
    }
}
export function saveSettings(settings) {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
export function loadTokenMetrics() {
    const settings = loadSettings();
    const cache = new Map();
    if (settings.tokenMetricsCache) {
        for (const [name, metrics] of Object.entries(settings.tokenMetricsCache)) {
            cache.set(name, metrics);
        }
    }
    return cache;
}
export function saveTokenMetrics(cache) {
    const settings = loadSettings();
    if (!settings.tokenMetricsCache) {
        settings.tokenMetricsCache = {};
    }
    settings.tokenMetricsCache = {};
    for (const [name, metrics] of cache.entries()) {
        settings.tokenMetricsCache[name] = metrics;
    }
    saveSettings(settings);
}
export function getCachedMetrics(mcpName) {
    const cache = loadTokenMetrics();
    return cache.get(mcpName);
}
export function setCachedMetrics(mcpName, metrics) {
    const cache = loadTokenMetrics();
    cache.set(mcpName, metrics);
    saveTokenMetrics(cache);
}
export function invalidateMetricsCache(mcpName) {
    const settings = loadSettings();
    let changed = false;
    if (settings.tokenMetricsCache?.[mcpName]) {
        delete settings.tokenMetricsCache[mcpName];
        changed = true;
    }
    if (settings.assessmentErrorsCache?.[mcpName]) {
        delete settings.assessmentErrorsCache[mcpName];
        changed = true;
    }
    if (changed) {
        saveSettings(settings);
    }
}
export function getCachedMCPNames() {
    const cache = loadTokenMetrics();
    return Array.from(cache.keys());
}
//# sourceMappingURL=settings-manager.js.map