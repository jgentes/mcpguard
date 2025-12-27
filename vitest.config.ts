import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    globalSetup: './tests/helpers/setup.ts',
    globalTeardown: './tests/helpers/global-teardown.ts',
    env: {
      // Silence logger during tests unless LOG_LEVEL is explicitly set
      NODE_ENV: 'test',
      VITEST: 'true',
      LOG_LEVEL: process.env.LOG_LEVEL || 'silent',
    },
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

