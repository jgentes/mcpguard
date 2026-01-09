export interface WorkerEntrypoint {
    fetch(request: Request): Promise<Response>;
}
export interface GetEntrypointOptions {
    props?: unknown;
}
export interface WorkerCode {
    compatibilityDate: string;
    compatibilityFlags?: string[];
    experimental?: boolean;
    mainModule: string;
    modules: Record<string, string | ModuleContent>;
    env?: Record<string, unknown>;
    globalOutbound?: null | unknown;
}
export type ModuleContent = {
    js: string;
} | {
    cjs: string;
} | {
    py: string;
} | {
    text: string;
} | {
    data: ArrayBuffer;
} | {
    json: object;
};
export interface WorkerStub {
    getEntrypoint(name?: string, options?: GetEntrypointOptions): WorkerEntrypoint;
}
export interface WorkerLoader {
    get(id: string, getCodeCallback: () => Promise<WorkerCode>): WorkerStub;
}
//# sourceMappingURL=worker.d.ts.map