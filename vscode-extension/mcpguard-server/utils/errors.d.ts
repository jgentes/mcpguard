export declare class MCPIsolateError extends Error {
    code: string;
    statusCode: number;
    details?: unknown | undefined;
    constructor(message: string, code: string, statusCode?: number, details?: unknown | undefined);
}
export declare class ValidationError extends MCPIsolateError {
    constructor(message: string, details?: unknown);
}
export declare class WorkerError extends MCPIsolateError {
    constructor(message: string, details?: unknown);
}
export declare class MCPConnectionError extends MCPIsolateError {
    constructor(message: string, details?: unknown);
}
export declare class SecurityError extends MCPIsolateError {
    constructor(message: string, details?: unknown);
}
//# sourceMappingURL=errors.d.ts.map