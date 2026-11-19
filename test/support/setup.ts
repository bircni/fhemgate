import { beforeEach, vi } from 'vitest';

// the plugin prints every cached reading to the console
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
