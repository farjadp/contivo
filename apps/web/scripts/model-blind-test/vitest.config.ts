import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Separate from the app's vitest config: nothing here runs in `pnpm test`.
 * The paid entry (blind.run.test.ts) and the DB export (export.run.test.ts)
 * also skip themselves unless their env flag is set.
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
    // 50 units of up to 5 sequential calls of up to 120 s each.
    testTimeout: 3 * 60 * 60 * 1000,
  },
});
