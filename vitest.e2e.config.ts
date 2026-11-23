import { defineConfig } from 'vitest/config';

// the end-to-end test starts a real homebridge with the built plugin, so it runs after the
// build and apart from the other tests
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    globalSetup: ['test/e2e/globalSetup.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // every file has a fhem and a homebridge of its own, on ports of their own, so the files
    // run side by side. they spend most of their time waiting for homebridge and the stand-in,
    // not on the processor.
    maxWorkers: 8,
  },
});
