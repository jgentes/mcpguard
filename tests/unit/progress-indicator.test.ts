import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressIndicator } from '../../src/utils/progress-indicator.js';

describe('ProgressIndicator', () => {
  let indicator: ProgressIndicator;
  let stdoutWriteSpy: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    indicator = new ProgressIndicator();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateStep', () => {
    it('should update step status and render', () => {
      indicator.updateStep(0, 'running');
      expect(stdoutWriteSpy).toHaveBeenCalled();
    });

    it('should not update invalid index', () => {
      const callCount = stdoutWriteSpy.mock.calls.length;
      indicator.updateStep(-1, 'running');
      indicator.updateStep(10, 'running');
      // Should not render for invalid indices
      expect(stdoutWriteSpy.mock.calls.length).toBe(callCount);
    });

    it('should handle all status types', () => {
      // Each updateStep calls render() which calls write() twice (clear + render)
      indicator.updateStep(0, 'pending');
      indicator.updateStep(1, 'running');
      indicator.updateStep(2, 'success');
      indicator.updateStep(0, 'failed');
      // 4 updates * 2 writes each = 8 calls
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(8);
    });
  });

  describe('render', () => {
    it('should render progress indicator', () => {
      indicator.render();
      expect(stdoutWriteSpy).toHaveBeenCalled();
    });

    it('should show pending steps without icons', () => {
      indicator.render();
      // render() calls write() twice: clear line, then render
      const output = stdoutWriteSpy.mock.calls[1][0];
      expect(output).toContain('Our MCP');
      expect(output).toContain('Wrangler');
      expect(output).toContain('Target MCP');
    });

    it('should show icons for non-pending steps', () => {
      indicator.updateStep(0, 'running');
      indicator.updateStep(1, 'success');
      indicator.updateStep(2, 'failed');
      
      const calls = stdoutWriteSpy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('⟳');
      expect(lastCall).toContain('✓');
      expect(lastCall).toContain('✗');
    });
  });

  describe('clear', () => {
    it('should clear the progress indicator', () => {
      indicator.clear();
      expect(stdoutWriteSpy).toHaveBeenCalled();
    });
  });

  describe('showFinal', () => {
    it('should show final status without failedAt', () => {
      indicator.updateStep(0, 'success');
      indicator.updateStep(1, 'running');
      indicator.showFinal();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show final status with failedAt', () => {
      indicator.updateStep(0, 'success');
      indicator.updateStep(1, 'failed');
      indicator.showFinal(1);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should handle all status combinations', () => {
      indicator.updateStep(0, 'success');
      indicator.showFinal();
      indicator.updateStep(1, 'failed');
      indicator.showFinal(1);
      indicator.updateStep(2, 'running');
      indicator.showFinal();
      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('reset', () => {
    it('should reset all steps to pending', () => {
      indicator.updateStep(0, 'success');
      indicator.updateStep(1, 'running');
      indicator.reset();
      
      // After reset, rendering should show pending steps
      indicator.render();
      const output = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      // Should not contain icons (pending steps don't have icons)
      expect(output).toContain('Our MCP');
    });
  });
});

