import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
class RuntimeDetector {
    runtimes = new Map();
    checked = false;
    preferredRuntime = null;
    async detectRuntimes() {
        if (this.checked) {
            return;
        }
        const isWindows = process.platform === 'win32';
        try {
            const { stdout } = await execAsync('bun --version');
            const version = stdout.trim();
            const bunRuntime = {
                type: 'bun',
                version,
                available: true,
                command: 'bunx',
                executor: 'bunx',
                args: [],
            };
            this.runtimes.set('bun', bunRuntime);
            this.preferredRuntime = bunRuntime;
            this.checked = true;
            return;
        }
        catch {
            this.runtimes.set('bun', {
                type: 'bun',
                version: 'unknown',
                available: false,
                command: 'bunx',
                executor: 'bunx',
                args: [],
            });
        }
        try {
            const [pnpmResult, pnpxResult] = await Promise.allSettled([
                execAsync('pnpm --version'),
                execAsync('pnpx --version'),
            ]);
            if (pnpmResult.status === 'fulfilled' &&
                pnpxResult.status === 'fulfilled') {
                const version = pnpmResult.value.stdout.trim();
                const pnpmRuntime = {
                    type: 'pnpm',
                    version,
                    available: true,
                    command: 'pnpx',
                    executor: 'pnpx',
                    args: [],
                };
                this.runtimes.set('pnpm', pnpmRuntime);
                this.preferredRuntime = pnpmRuntime;
                this.checked = true;
                return;
            }
            if (pnpmResult.status === 'fulfilled') {
                const version = pnpmResult.value.stdout.trim();
                this.runtimes.set('pnpm', {
                    type: 'pnpm',
                    version,
                    available: false,
                    command: 'pnpx',
                    executor: 'pnpx',
                    args: [],
                });
            }
            else {
                this.runtimes.set('pnpm', {
                    type: 'pnpm',
                    version: 'unknown',
                    available: false,
                    command: 'pnpx',
                    executor: 'pnpx',
                    args: [],
                });
            }
        }
        catch {
            this.runtimes.set('pnpm', {
                type: 'pnpm',
                version: 'unknown',
                available: false,
                command: 'pnpx',
                executor: 'pnpx',
                args: [],
            });
        }
        try {
            const [yarnResult, yarnDlxResult] = await Promise.allSettled([
                execAsync('yarn --version'),
                execAsync('yarn dlx --help'),
            ]);
            if (yarnResult.status === 'fulfilled' &&
                yarnDlxResult.status === 'fulfilled') {
                const version = yarnResult.value.stdout.trim();
                const yarnRuntime = {
                    type: 'yarn',
                    version,
                    available: true,
                    command: 'yarn dlx',
                    executor: 'yarn',
                    args: ['dlx'],
                };
                this.runtimes.set('yarn', yarnRuntime);
                this.preferredRuntime = yarnRuntime;
                this.checked = true;
                return;
            }
            if (yarnResult.status === 'fulfilled') {
                const version = yarnResult.value.stdout.trim();
                this.runtimes.set('yarn', {
                    type: 'yarn',
                    version,
                    available: false,
                    command: 'yarn dlx',
                    executor: 'yarn',
                    args: ['dlx'],
                });
            }
            else {
                this.runtimes.set('yarn', {
                    type: 'yarn',
                    version: 'unknown',
                    available: false,
                    command: 'yarn dlx',
                    executor: 'yarn',
                    args: ['dlx'],
                });
            }
        }
        catch {
            this.runtimes.set('yarn', {
                type: 'yarn',
                version: 'unknown',
                available: false,
                command: 'yarn dlx',
                executor: 'yarn',
                args: ['dlx'],
            });
        }
        try {
            const [nodeResult, npxResult] = await Promise.allSettled([
                execAsync('node --version'),
                execAsync('npx --version'),
            ]);
            if (nodeResult.status === 'fulfilled' && npxResult.status === 'fulfilled') {
                const version = nodeResult.value.stdout.trim();
                const npmRuntime = {
                    type: 'npm',
                    version,
                    available: true,
                    command: isWindows ? 'npx.cmd' : 'npx',
                    executor: isWindows ? 'npx.cmd' : 'npx',
                    args: [],
                };
                this.runtimes.set('npm', npmRuntime);
                this.preferredRuntime = npmRuntime;
            }
            else if (nodeResult.status === 'fulfilled') {
                const version = nodeResult.value.stdout.trim();
                const npmRuntime = {
                    type: 'npm',
                    version,
                    available: false,
                    command: isWindows ? 'npx.cmd' : 'npx',
                    executor: isWindows ? 'npx.cmd' : 'npx',
                    args: [],
                };
                this.runtimes.set('npm', npmRuntime);
                this.preferredRuntime = npmRuntime;
            }
            else {
                const npmRuntime = {
                    type: 'npm',
                    version: 'unknown',
                    available: false,
                    command: isWindows ? 'npx.cmd' : 'npx',
                    executor: isWindows ? 'npx.cmd' : 'npx',
                    args: [],
                };
                this.runtimes.set('npm', npmRuntime);
                this.preferredRuntime = npmRuntime;
            }
        }
        catch {
            const npmRuntime = {
                type: 'npm',
                version: 'unknown',
                available: false,
                command: isWindows ? 'npx.cmd' : 'npx',
                executor: isWindows ? 'npx.cmd' : 'npx',
                args: [],
            };
            this.runtimes.set('npm', npmRuntime);
            this.preferredRuntime = npmRuntime;
        }
        this.checked = true;
    }
    async getPreferredRuntime() {
        await this.detectRuntimes();
        if (!this.preferredRuntime) {
            throw new Error('No package executor available');
        }
        return this.preferredRuntime;
    }
    async getRuntime(type) {
        await this.detectRuntimes();
        const runtime = this.runtimes.get(type);
        return runtime?.available ? runtime : null;
    }
    async isRuntimeAvailable(type) {
        await this.detectRuntimes();
        return this.runtimes.get(type)?.available ?? false;
    }
    async isBunAvailable() {
        return this.isRuntimeAvailable('bun');
    }
    async isNodeAvailable() {
        return this.isRuntimeAvailable('npm');
    }
    async getPackageCommand() {
        const runtime = await this.getPreferredRuntime();
        return runtime.executor;
    }
    async getSpawnCommand() {
        const runtime = await this.getPreferredRuntime();
        return {
            command: runtime.executor,
            args: runtime.args,
        };
    }
    async getRuntimeType() {
        const runtime = await this.getPreferredRuntime();
        return runtime.type;
    }
    async getAvailableRuntimes() {
        await this.detectRuntimes();
        return Array.from(this.runtimes.values()).filter((r) => r.available);
    }
}
export const runtimeDetector = new RuntimeDetector();
//# sourceMappingURL=runtime-detector.js.map