import { defineConfig } from 'vitest/config';

// the end-to-end test starts a real homebridge with the built plugin, so it runs after the
// build and apart from the other tests
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
