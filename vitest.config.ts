import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: {
      // reading timestamps from fhem carry no time zone
      TZ: 'UTC',
    },
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 70,
      },
    },
  },
});
