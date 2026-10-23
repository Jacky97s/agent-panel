import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@agent-panel/core/acp', replacement: path.resolve('packages/core/src/acp.ts') },
      { find: '@agent-panel/core', replacement: path.resolve('packages/core/src/index.ts') },
      { find: '@agent-panel/server', replacement: path.resolve('packages/server/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
  },
});
