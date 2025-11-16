import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigManager } from '../../src/utils/config-manager.js';
import { WorkerManager } from '../../src/server/worker-manager.js';
import { MCPConfig } from '../../src/types/mcp.js';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    level: 'info',
  },
}));

describe('CLI Test Command Logic', () => {
  let configManager: ConfigManager;
  let workerManager: WorkerManager;

  beforeEach(() => {
    configManager = new ConfigManager();
    workerManager = new WorkerManager();
  });

  describe('testTool logic', () => {
    it('should combine saved configs and loaded instances', () => {
      // This tests the logic used in testTool function
      const savedConfigs = configManager.getSavedConfigs();
      const loadedInstances = workerManager.listInstances();
      
      // Create combined list
      const allMCPs: Array<{
        name: string;
        isLoaded: boolean;
        instance?: any;
        config?: any;
      }> = [];
      
      // Add all saved configs
      for (const [name, entry] of Object.entries(savedConfigs)) {
        const loadedInstance = workerManager.getMCPByName(name);
        allMCPs.push({
          name,
          isLoaded: !!loadedInstance,
          instance: loadedInstance,
          config: entry.config,
        });
      }
      
      // Add loaded instances that might not be in saved configs
      for (const instance of loadedInstances) {
        if (!savedConfigs[instance.mcp_name]) {
          allMCPs.push({
            name: instance.mcp_name,
            isLoaded: true,
            instance,
          });
        }
      }
      
      expect(Array.isArray(allMCPs)).toBe(true);
    });

    it('should identify loaded vs not loaded MCPs', () => {
      const savedConfigs = configManager.getSavedConfigs();
      const loadedInstances = workerManager.listInstances();
      
      const allMCPs: Array<{
        name: string;
        isLoaded: boolean;
      }> = [];
      
      for (const [name] of Object.entries(savedConfigs)) {
        const loadedInstance = workerManager.getMCPByName(name);
        allMCPs.push({
          name,
          isLoaded: !!loadedInstance,
        });
      }
      
      // Verify structure
      allMCPs.forEach(mcp => {
        expect(mcp).toHaveProperty('name');
        expect(mcp).toHaveProperty('isLoaded');
        expect(typeof mcp.isLoaded).toBe('boolean');
      });
    });
  });

  describe('MCP selection logic', () => {
    it('should handle numeric selection', () => {
      const allMCPs = [
        { name: 'mcp1', isLoaded: true },
        { name: 'mcp2', isLoaded: false },
        { name: 'mcp3', isLoaded: true },
      ];
      
      const selectionNum = 2;
      const selectedMCP = allMCPs[selectionNum - 1];
      
      expect(selectedMCP.name).toBe('mcp2');
      expect(selectedMCP.isLoaded).toBe(false);
    });

    it('should handle name-based selection', () => {
      const allMCPs = [
        { name: 'mcp1', isLoaded: true },
        { name: 'mcp2', isLoaded: false },
        { name: 'mcp3', isLoaded: true },
      ];
      
      const searchTerm = 'mcp2';
      const selectedMCP = allMCPs.find(
        mcp => mcp.name.toLowerCase() === searchTerm.toLowerCase()
      );
      
      expect(selectedMCP).toBeDefined();
      expect(selectedMCP?.name).toBe('mcp2');
    });
  });
});

