import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function getEnvVarsFromFile() {
    const envPath = join(process.cwd(), '.env');
    if (!existsSync(envPath)) {
        return {};
    }
    const content = readFileSync(envPath, 'utf-8');
    const envVars = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (match) {
            const key = match[1];
            let value = match[2];
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            envVars[key] = value;
        }
    }
    return envVars;
}
export async function selectEnvVarsInteractively(rl) {
    const envVars = getEnvVarsFromFile();
    const envVarKeys = Object.keys(envVars).sort();
    const selected = {};
    if (envVarKeys.length > 0) {
        console.log('\n📋 Available environment variables from .env file:');
        envVarKeys.forEach((key, index) => {
            const value = envVars[key];
            const masked = value.length > 8
                ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
                : '***';
            const alreadySelected = selected[key] ? ' ✓' : '';
            console.log(`  ${index + 1}. ${key} = ${masked}${alreadySelected}`);
        });
    }
    else {
        console.log('\n⚠️  No environment variables found in .env file.');
        const placeholder = '${' + 'VAR_NAME' + '}';
        console.log(`   You can still enter env vars manually or use ${placeholder} syntax.`);
    }
    console.log('\n💡 Options:');
    console.log(`  - Enter a number (1-${envVarKeys.length}) to select an env var`);
    console.log('  - Enter "done" when finished');
    console.log('  - Enter "skip" to skip env vars');
    console.log('  - Enter "manual" to enter env vars as JSON\n');
    while (true) {
        const remaining = envVarKeys.filter((k) => !selected[k]);
        if (remaining.length === 0) {
            console.log('\n✅ All environment variables have been selected.');
            break;
        }
        if (remaining.length < envVarKeys.length) {
            console.log('\n📋 Remaining environment variables:');
            remaining.forEach((key) => {
                const originalIndex = envVarKeys.indexOf(key) + 1;
                const value = envVars[key];
                const masked = value.length > 8
                    ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
                    : '***';
                console.log(`  ${originalIndex}. ${key} = ${masked}`);
            });
        }
        const input = await new Promise((resolve) => {
            rl.question('Select env var by number (or "done"/"skip"/"manual"): ', resolve);
        });
        const trimmed = input.trim();
        const trimmedLower = trimmed.toLowerCase();
        if (trimmedLower === 'done') {
            break;
        }
        if (trimmedLower === 'skip') {
            return {};
        }
        if (trimmedLower === 'manual') {
            const manualInput = await new Promise((resolve) => {
                rl.question('Environment variables as JSON (or press Enter for none): ', resolve);
            });
            if (manualInput.trim()) {
                try {
                    const parsed = JSON.parse(manualInput.trim());
                    const result = {};
                    for (const [key, value] of Object.entries(parsed)) {
                        if (typeof value === 'string' && !value.startsWith('${')) {
                            if (envVars[key]) {
                                result[key] = `\${${key}}`;
                            }
                            else {
                                result[key] = value;
                            }
                        }
                        else {
                            result[key] = value;
                        }
                    }
                    return result;
                }
                catch (_error) {
                    console.error('❌ Invalid JSON. Please try again.');
                    continue;
                }
            }
            return {};
        }
        const num = parseInt(trimmed, 10);
        if (Number.isNaN(num) || num < 1 || num > envVarKeys.length) {
            console.log(`❌ Invalid number. Please enter a number between 1 and ${envVarKeys.length}, or "done"/"skip"/"manual".\n`);
            continue;
        }
        const key = envVarKeys[num - 1];
        if (selected[key]) {
            console.log(`⚠️  ${key} is already selected.`);
            continue;
        }
        selected[key] = `\${${key}}`;
        console.log(`✅ Added: ${key} = \${${key}}`);
    }
    return selected;
}
//# sourceMappingURL=env-selector.js.map