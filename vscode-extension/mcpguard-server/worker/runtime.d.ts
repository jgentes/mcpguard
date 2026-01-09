import { WorkerEntrypoint } from 'cloudflare:workers';
import type { WorkerLoader } from '../types/worker.js';
type ExecutionContext = {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    exports: {
        MCPBridge: (options?: {
            props?: {
                mcpId: string;
                rpcUrl: string;
            };
        }) => MCPBridge;
        FetchProxy?: (options?: Record<string, never>) => FetchProxy;
    };
};
interface Env {
    LOADER: WorkerLoader;
    [key: string]: unknown;
}
export declare class MCPBridge extends WorkerEntrypoint<{
    mcpId: string;
    rpcUrl: string;
}> {
    callTool(toolName: string, input: unknown): Promise<unknown>;
}
export declare class FetchProxy extends WorkerEntrypoint {
    fetch(request: Request): Promise<Response>;
    private isHostAllowed;
}
declare const _default: {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};
export default _default;
//# sourceMappingURL=runtime.d.ts.map