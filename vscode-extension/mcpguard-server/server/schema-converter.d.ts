import type { MCPTool } from '../types/mcp.js';
export declare class SchemaConverter {
    convertToTypeScript(tools: MCPTool[]): string;
    private generateInterfaceForTool;
    private generateAPIObject;
    private jsonSchemaToTypeScript;
    private toPascalCase;
}
//# sourceMappingURL=schema-converter.d.ts.map