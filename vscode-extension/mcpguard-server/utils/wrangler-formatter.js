function isVerbose() {
    return (process.argv.includes('--verbose') ||
        process.argv.includes('-v') ||
        process.env.LOG_LEVEL === 'debug');
}
function stripAnsiCodes(str) {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
}
export function formatWranglerError(error, stdout, stderr, context) {
    const verbose = isVerbose();
    const lines = [];
    lines.push('');
    lines.push('❌ Wrangler Execution Error');
    if (verbose) {
        lines.push('─'.repeat(60));
        if (error.message) {
            const cleanMessage = stripAnsiCodes(error.message);
            lines.push(`Error: ${cleanMessage}`);
            lines.push('');
        }
        if (context) {
            lines.push('Context:');
            if (context.mcpId) {
                lines.push(`  MCP ID: ${context.mcpId}`);
            }
            if (context.port) {
                lines.push(`  Port: ${context.port}`);
            }
            if (context.tempDir) {
                lines.push(`  Temp Dir: ${context.tempDir}`);
                lines.push(`  You can inspect the generated files in this directory`);
            }
            if (context.userCode) {
                lines.push('');
                lines.push('Your code:');
                lines.push('─'.repeat(60));
                const codeLines = context.userCode.split('\n');
                codeLines.forEach((line, index) => {
                    lines.push(`${(index + 1).toString().padStart(3, ' ')} | ${line}`);
                });
                lines.push('─'.repeat(60));
            }
            lines.push('');
        }
        if (stdout.trim()) {
            const cleanStdout = stripAnsiCodes(stdout).trim();
            if (cleanStdout) {
                lines.push('Wrangler STDOUT:');
                lines.push('─'.repeat(60));
                lines.push(cleanStdout);
                lines.push('');
            }
        }
    }
    if (stderr.trim()) {
        const cleanStderr = stripAnsiCodes(stderr).trim();
        if (cleanStderr) {
            const isBuildError = cleanStderr.includes('Build failed') ||
                cleanStderr.includes('build failed') ||
                cleanStderr.includes('✗ Build failed');
            if (verbose) {
                lines.push('Wrangler STDERR:');
                if (!isBuildError) {
                    lines.push('─'.repeat(60));
                }
            }
            if (isBuildError) {
                if (verbose) {
                    lines.push('─'.repeat(60));
                }
                lines.push('');
                lines.push('🔍 TypeScript Compilation Error');
                lines.push('');
                lines.push('Your code has a syntax error that prevented it from compiling.');
                lines.push('');
                if (!verbose) {
                    lines.push('💡 Add the -v or --verbose flag to see your code and more details.');
                    lines.push('');
                }
            }
            const stderrLines = cleanStderr.split('\n');
            let inErrorBlock = false;
            let errorFile = '';
            let errorLine = '';
            let errorColumn = '';
            for (const line of stderrLines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                if (trimmed.includes('Logs were written to') ||
                    trimmed.includes('🪵')) {
                    if (verbose) {
                        lines.push(`    ${trimmed}`);
                    }
                    continue;
                }
                const fileLocationMatch = trimmed.match(/(\S+\.ts):(\d+):(\d+):/);
                if (fileLocationMatch) {
                    errorFile = fileLocationMatch[1];
                    errorLine = fileLocationMatch[2];
                    errorColumn = fileLocationMatch[3];
                }
                if (trimmed.includes('[ERROR]') ||
                    trimmed.includes('ERROR') ||
                    trimmed.includes('Error:') ||
                    trimmed.includes('✗') ||
                    trimmed.includes('Build failed') ||
                    trimmed.includes('must be initialized') ||
                    trimmed.includes('expected') ||
                    trimmed.includes('unexpected')) {
                    if (!inErrorBlock) {
                        if (!isBuildError) {
                            lines.push('─'.repeat(60));
                            lines.push('');
                        }
                        inErrorBlock = true;
                    }
                    const cleanLine = trimmed
                        .replace(/^X\s*\[ERROR\]\s*/i, '')
                        .replace(/^\[ERROR\]\s*/i, '')
                        .replace(/^X\s+/i, '')
                        .replace(/^✗\s+/, '')
                        .trim();
                    if (isBuildError &&
                        errorFile &&
                        errorLine &&
                        !cleanLine.includes(errorFile)) {
                        lines.push(`  ✗ ${errorFile}:${errorLine}:${errorColumn || '?'}`);
                        lines.push(`    ${cleanLine}`);
                    }
                    else {
                        lines.push(`  ✗ ${cleanLine}`);
                    }
                }
                else if (trimmed.includes('│') ||
                    trimmed.includes('─') ||
                    trimmed.includes('═')) {
                }
                else if (trimmed.includes('╵') || trimmed.includes('^')) {
                    if (inErrorBlock) {
                        lines.push(`    ${trimmed}`);
                    }
                }
                else if (inErrorBlock || verbose) {
                    lines.push(`    ${trimmed}`);
                }
            }
            if (!verbose && !inErrorBlock) {
                const meaningfulLines = stderrLines
                    .map((l) => l.trim())
                    .filter((l) => l &&
                    !l.match(/^[│─═╔╗╚╝╠╣]/) &&
                    !l.includes('Logs were written to') &&
                    !l.includes('🪵'))
                    .slice(0, 5);
                for (const line of meaningfulLines) {
                    lines.push(`  ${line}`);
                }
            }
            if (inErrorBlock || (verbose && !isBuildError)) {
                lines.push('─'.repeat(60));
            }
        }
    }
    lines.push('');
    return lines.join('\n');
}
function formatNestedJsonStructure(obj, indent = 0) {
    const indentStr = '  '.repeat(indent);
    const nextIndent = indent + 1;
    const nextIndentStr = '  '.repeat(nextIndent);
    if (Array.isArray(obj)) {
        if (obj.length === 0)
            return '[]';
        const items = obj.map((item) => {
            const formatted = formatNestedJsonStructure(item, nextIndent);
            if (formatted.includes('\n')) {
                return `${nextIndentStr}${formatted}`;
            }
            return `${nextIndentStr}${formatted}`;
        });
        return `[\n${items.join(',\n')}\n${indentStr}]`;
    }
    if (obj && typeof obj === 'object') {
        const keys = Object.keys(obj);
        if (keys.length === 0)
            return '{}';
        const entries = keys.map((key) => {
            const value = obj[key];
            if (key === 'text' &&
                typeof value === 'string' &&
                (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                try {
                    const parsed = JSON.parse(value);
                    const formatted = formatNestedJsonStructure(parsed, nextIndent);
                    return `${nextIndentStr}"${key}": ${formatted}`;
                }
                catch {
                    return `${nextIndentStr}"${key}": ${JSON.stringify(value)}`;
                }
            }
            else {
                const formattedValue = formatNestedJsonStructure(value, nextIndent);
                return `${nextIndentStr}"${key}": ${formattedValue}`;
            }
        });
        return `{\n${entries.join(',\n')}\n${indentStr}}`;
    }
    return JSON.stringify(obj);
}
function tryPrettyPrintJson(str) {
    let jsonStr = str.trim();
    const resultPrefix = 'Result: ';
    if (jsonStr.startsWith(resultPrefix)) {
        jsonStr = jsonStr.substring(resultPrefix.length).trim();
    }
    try {
        const parsed = JSON.parse(jsonStr);
        const formatted = formatNestedJsonStructure(parsed, 0);
        if (str.startsWith(resultPrefix)) {
            return `${resultPrefix}${formatted}`;
        }
        return formatted;
    }
    catch {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                const formatted = formatNestedJsonStructure(parsed, 0);
                const result = jsonStr.replace(jsonMatch[0], formatted);
                if (str.startsWith(resultPrefix)) {
                    return `${resultPrefix}${result}`;
                }
                return result;
            }
            catch {
                return null;
            }
        }
        return null;
    }
}
export function formatExecutionResult(result) {
    const lines = [];
    lines.push('');
    lines.push(result.success ? '✅ Execution Successful' : '❌ Execution Failed');
    lines.push('─'.repeat(60));
    if (result.error) {
        lines.push(`Error: ${result.error}`);
        lines.push('');
    }
    if (result.output) {
        lines.push('Output:');
        const prettyPrinted = tryPrettyPrintJson(result.output);
        if (prettyPrinted) {
            const outputLines = prettyPrinted.split('\n');
            for (const line of outputLines) {
                lines.push(`  ${line}`);
            }
        }
        else {
            const outputLines = result.output.split('\n');
            for (const line of outputLines) {
                if (line.trim()) {
                    lines.push(`  ${line}`);
                }
            }
        }
        lines.push('');
    }
    lines.push('Metrics:');
    if (result.metrics) {
        let firstLine = `${result.metrics.mcp_calls_made} MCP calls: ${result.execution_time_ms}ms`;
        if (result.metrics.schema_efficiency) {
            const se = result.metrics.schema_efficiency;
            const reduction = se.schema_size_reduction_percent.toFixed(0);
            if (reduction !== '0') {
                if (se.estimated_tokens_saved && se.estimated_tokens_saved > 0) {
                    firstLine += ` (~${se.estimated_tokens_saved.toLocaleString()} tokens saved, ${reduction}% reduction)`;
                }
                else {
                    firstLine += ` (${reduction}% schema reduction)`;
                }
            }
        }
        lines.push(`  ${firstLine}`);
        if (result.metrics.security) {
            const sec = result.metrics.security;
            const networkStatus = sec.network_isolation_enabled ? '✓' : '✗';
            const processStatus = sec.process_isolation_enabled ? '✓' : '✗';
            lines.push(`  Security (${sec.security_level.toUpperCase()}): Network ${networkStatus} | Process ${processStatus}`);
        }
    }
    else {
        lines.push(`  Execution Time: ${result.execution_time_ms}ms`);
    }
    lines.push('─'.repeat(60));
    lines.push('');
    return lines.join('\n');
}
//# sourceMappingURL=wrangler-formatter.js.map