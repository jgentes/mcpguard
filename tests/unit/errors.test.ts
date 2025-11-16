import { describe, it, expect } from 'vitest';
import {
  WorkerError,
  MCPConnectionError,
  ValidationError,
  SecurityError,
  MCPIsolateError,
} from '../../src/utils/errors.js';

describe('Error Classes', () => {
  describe('WorkerError', () => {
    it('should create error with message', () => {
      const error = new WorkerError('Test error');
      expect(error.message).toBe('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should include details if provided', () => {
      const details = { code: 'TEST', value: 123 };
      const error = new WorkerError('Test error', details);
      expect(error.details).toEqual(details);
    });
  });

  describe('MCPConnectionError', () => {
    it('should create error with message', () => {
      const error = new MCPConnectionError('Connection failed');
      expect(error.message).toBe('Connection failed');
      expect(error).toBeInstanceOf(Error);
    });

    it('should include details if provided', () => {
      const details = { mcpName: 'test', error: new Error('inner') };
      const error = new MCPConnectionError('Connection failed', details);
      expect(error.details).toEqual(details);
    });
  });

  describe('ValidationError', () => {
    it('should create error with message', () => {
      const error = new ValidationError('Validation failed');
      expect(error.message).toBe('Validation failed');
      expect(error).toBeInstanceOf(Error);
    });

    it('should include validation errors if provided', () => {
      const validationErrors = [{ path: ['field'], message: 'Invalid' }];
      const error = new ValidationError('Validation failed', validationErrors);
      // Check if validationErrors property exists (may be stored in details)
      expect(error.details || (error as any).validationErrors).toBeDefined();
    });
  });

  describe('SecurityError', () => {
    it('should create error with message', () => {
      const error = new SecurityError('Security violation');
      expect(error.message).toBe('Security violation');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('MCPIsolateError', () => {
    it('should create error with message', () => {
      const error = new MCPIsolateError('Isolate error', 'ERROR_CODE');
      expect(error.message).toBe('Isolate error');
      expect(error.code).toBe('ERROR_CODE');
      expect(error).toBeInstanceOf(Error);
    });

    it('should include status code if provided', () => {
      const error = new MCPIsolateError('Isolate error', 'ERROR_CODE', 404);
      expect(error.statusCode).toBe(404);
    });
  });
});

