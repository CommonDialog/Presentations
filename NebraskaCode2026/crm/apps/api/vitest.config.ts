import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests share crm_test; run files sequentially to avoid races.
    fileParallelism: false,
  },
});
