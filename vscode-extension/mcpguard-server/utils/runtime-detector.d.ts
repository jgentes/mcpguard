export interface RuntimeInfo {
    type: 'bun' | 'pnpm' | 'yarn' | 'npm';
    version: string;
    available: boolean;
    command: string;
    executor: string;
    args: string[];
}
declare class RuntimeDetector {
    private runtimes;
    private checked;
    private preferredRuntime;
    detectRuntimes(): Promise<void>;
    getPreferredRuntime(): Promise<RuntimeInfo>;
    getRuntime(type: 'bun' | 'pnpm' | 'yarn' | 'npm'): Promise<RuntimeInfo | null>;
    isRuntimeAvailable(type: 'bun' | 'pnpm' | 'yarn' | 'npm'): Promise<boolean>;
    isBunAvailable(): Promise<boolean>;
    isNodeAvailable(): Promise<boolean>;
    getPackageCommand(): Promise<string>;
    getSpawnCommand(): Promise<{
        command: string;
        args: string[];
    }>;
    getRuntimeType(): Promise<'bun' | 'pnpm' | 'yarn' | 'npm'>;
    getAvailableRuntimes(): Promise<RuntimeInfo[]>;
}
export declare const runtimeDetector: RuntimeDetector;
export {};
//# sourceMappingURL=runtime-detector.d.ts.map