import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/server/metrics-collector.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('recordMCPLoad', () => {
    it('should record MCP load metrics', () => {
      collector.recordMCPLoad('mcp-1', 150);

      const metrics = collector.getMetrics();
      expect(metrics.per_mcp).toHaveLength(1);
      expect(metrics.per_mcp[0].mcp_id).toBe('mcp-1');
      expect(metrics.per_mcp[0].load_time_ms).toBe(150);
    });

    it('should initialize execution metrics for new MCP', () => {
      collector.recordMCPLoad('mcp-1', 100);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      expect(mcpMetric.executions.total_executions).toBe(0);
      expect(mcpMetric.executions.successful_executions).toBe(0);
      expect(mcpMetric.executions.failed_executions).toBe(0);
      expect(mcpMetric.executions.total_execution_time_ms).toBe(0);
      expect(mcpMetric.executions.total_mcp_calls).toBe(0);
      expect(mcpMetric.executions.estimated_tokens_saved).toBe(0);
    });

    it('should handle multiple MCP loads', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordMCPLoad('mcp-2', 200);

      const metrics = collector.getMetrics();
      expect(metrics.per_mcp).toHaveLength(2);
      expect(metrics.summary.total_mcps_loaded).toBe(2);
    });
  });

  describe('recordExecution', () => {
    beforeEach(() => {
      collector.recordMCPLoad('mcp-1', 100);
    });

    it('should record successful execution', () => {
      collector.recordExecution('mcp-1', 50, true, 2);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      expect(mcpMetric.executions.total_executions).toBe(1);
      expect(mcpMetric.executions.successful_executions).toBe(1);
      expect(mcpMetric.executions.failed_executions).toBe(0);
      expect(mcpMetric.executions.total_execution_time_ms).toBe(50);
      expect(mcpMetric.executions.average_execution_time_ms).toBe(50);
      expect(mcpMetric.executions.total_mcp_calls).toBe(2);
    });

    it('should record failed execution', () => {
      collector.recordExecution('mcp-1', 30, false, 0);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      expect(mcpMetric.executions.total_executions).toBe(1);
      expect(mcpMetric.executions.successful_executions).toBe(0);
      expect(mcpMetric.executions.failed_executions).toBe(1);
    });

    it('should calculate average execution time', () => {
      collector.recordExecution('mcp-1', 50, true, 1);
      collector.recordExecution('mcp-1', 100, true, 1);
      collector.recordExecution('mcp-1', 150, true, 1);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      expect(mcpMetric.executions.total_executions).toBe(3);
      expect(mcpMetric.executions.average_execution_time_ms).toBe(100);
    });

    it('should calculate tokens saved', () => {
      collector.recordExecution('mcp-1', 50, true, 3);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      // Traditional: 3 * 1500 = 4500 tokens
      // Code mode: 300 + (3 * 100) = 600 tokens
      // Saved: 4500 - 600 = 3900 tokens
      expect(mcpMetric.executions.estimated_tokens_saved).toBe(3900);
    });

    it('should update global metrics', () => {
      collector.recordMCPLoad('mcp-2', 200);
      collector.recordExecution('mcp-1', 50, true, 2);
      collector.recordExecution('mcp-2', 75, true, 1);

      const metrics = collector.getMetrics();
      
      expect(metrics.global.total_executions).toBe(2);
      expect(metrics.global.successful_executions).toBe(2);
      expect(metrics.global.failed_executions).toBe(0);
      expect(metrics.global.total_execution_time_ms).toBe(125);
      expect(metrics.global.average_execution_time_ms).toBe(62.5);
      expect(metrics.global.total_mcp_calls).toBe(3);
    });

    it('should handle execution for non-existent MCP', () => {
      collector.recordExecution('non-existent', 50, true, 1);

      const metrics = collector.getMetrics();
      // Should still update global metrics
      expect(metrics.global.total_executions).toBe(1);
      // Per-MCP metrics should not include non-existent MCP
      const nonExistentMetric = metrics.per_mcp.find(m => m.mcp_id === 'non-existent');
      expect(nonExistentMetric).toBeUndefined();
    });

    it('should accumulate MCP calls', () => {
      collector.recordExecution('mcp-1', 50, true, 2);
      collector.recordExecution('mcp-1', 50, true, 3);
      collector.recordExecution('mcp-1', 50, true, 1);

      const metrics = collector.getMetrics();
      const mcpMetric = metrics.per_mcp[0];
      
      expect(mcpMetric.executions.total_mcp_calls).toBe(6);
    });
  });

  describe('getMetrics', () => {
    it('should return empty metrics initially', () => {
      const metrics = collector.getMetrics();

      expect(metrics.global.total_executions).toBe(0);
      expect(metrics.per_mcp).toHaveLength(0);
      expect(metrics.summary.total_mcps_loaded).toBe(0);
      expect(metrics.summary.success_rate).toBe(0);
    });

    it('should calculate success rate', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordExecution('mcp-1', 50, true, 1);
      collector.recordExecution('mcp-1', 50, true, 1);
      collector.recordExecution('mcp-1', 50, false, 0);

      const metrics = collector.getMetrics();
      
      expect(metrics.summary.success_rate).toBeCloseTo(66.67, 1);
    });

    it('should calculate average tokens saved per execution', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordExecution('mcp-1', 50, true, 2);
      collector.recordExecution('mcp-1', 50, true, 1);

      const metrics = collector.getMetrics();
      
      // First: 2 calls = 3000 - 500 = 2500 saved
      // Second: 1 call = 1500 - 400 = 1100 saved
      // Average: (2500 + 1100) / 2 = 1800
      expect(metrics.summary.average_tokens_saved_per_execution).toBe(1800);
    });

    it('should return correct structure', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordExecution('mcp-1', 50, true, 1);

      const metrics = collector.getMetrics();

      expect(metrics).toHaveProperty('global');
      expect(metrics).toHaveProperty('per_mcp');
      expect(metrics).toHaveProperty('summary');
      expect(metrics.summary).toHaveProperty('total_mcps_loaded');
      expect(metrics.summary).toHaveProperty('success_rate');
      expect(metrics.summary).toHaveProperty('average_tokens_saved_per_execution');
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordExecution('mcp-1', 50, true, 1);

      collector.resetMetrics();

      const metrics = collector.getMetrics();
      expect(metrics.global.total_executions).toBe(0);
      expect(metrics.per_mcp).toHaveLength(0);
      expect(metrics.summary.total_mcps_loaded).toBe(0);
    });

    it('should reset global metrics', () => {
      collector.recordMCPLoad('mcp-1', 100);
      collector.recordExecution('mcp-1', 50, true, 1);

      collector.resetMetrics();

      const metrics = collector.getMetrics();
      expect(metrics.global.successful_executions).toBe(0);
      expect(metrics.global.failed_executions).toBe(0);
      expect(metrics.global.total_execution_time_ms).toBe(0);
      expect(metrics.global.total_mcp_calls).toBe(0);
      expect(metrics.global.estimated_tokens_saved).toBe(0);
    });
  });
});

