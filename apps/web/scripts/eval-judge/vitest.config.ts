import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Separate from the app's vitest config on purpose: the app config only
 * collects src/**, so nothing here runs in `pnpm test` / CI. The eval entry
 * (eval.run.test.ts) additionally skips itself unless EVAL_PROVIDER is set,
 * so running this config without it costs nothing.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
  test: {
    environment: 'node',
    root: __dirname,
    include: ['**/*.test.ts'],
    // A real provider run is 11+ sequential calls of up to 90 s each.
    testTimeout: 30 * 60 * 1000,
  },
});
