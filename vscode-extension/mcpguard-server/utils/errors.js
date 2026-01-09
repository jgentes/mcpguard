export class MCPIsolateError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code, statusCode = 500, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'MCPIsolateError';
    }
}
export class ValidationError extends MCPIsolateError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 400, details);
        this.name = 'ValidationError';
    }
}
export class WorkerError extends MCPIsolateError {
    constructor(message, details) {
        super(message, 'WORKER_ERROR', 500, details);
        this.name = 'WorkerError';
    }
}
export class MCPConnectionError extends MCPIsolateError {
    constructor(message, details) {
        super(message, 'MCP_CONNECTION_ERROR', 502, details);
        this.name = 'MCPConnectionError';
    }
}
export class SecurityError extends MCPIsolateError {
    constructor(message, details) {
        super(message, 'SECURITY_ERROR', 403, details);
        this.name = 'SecurityError';
    }
}
//# sourceMappingURL=errors.js.map