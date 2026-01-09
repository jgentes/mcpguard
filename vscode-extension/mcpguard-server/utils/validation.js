import { z } from 'zod';
import { SecurityError, ValidationError } from './errors.js';
import logger from './logger.js';
export function validateInput(schema, data) {
    try {
        return schema.parse(data);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            logger.error({ error: error.errors }, 'Validation failed');
            throw new ValidationError('Invalid input parameters', error.errors);
        }
        throw error;
    }
}
export function validateTypeScriptCode(code) {
    const dangerousPatterns = [
        /require\s*\(/g,
        /import\s+.*\s+from\s+['"](?!\.)/g,
        /eval\s*\(/g,
        /Function\s*\(/g,
        /process\./g,
        /__dirname/g,
        /__filename/g,
        /global\./g,
    ];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
            throw new SecurityError(`Code contains dangerous pattern: ${pattern.source}`);
        }
    }
    if (code.length > 50000) {
        throw new ValidationError('Code exceeds maximum length of 50KB');
    }
}
//# sourceMappingURL=validation.js.map