import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps JSX as-is for Next; tests that render a component need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
