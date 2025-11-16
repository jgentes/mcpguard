import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/cli/index.ts', // CLI entry point
        'src/server/index.ts', // Server entry point
        'src/server/mcp-handler.ts', // MCP server handler - requires full MCP setup (integration tested)
        'src/worker/runtime.ts', // Worker runtime - requires Cloudflare Workers environment (integration tested)
      ],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

