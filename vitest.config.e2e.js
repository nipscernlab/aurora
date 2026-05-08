// vitest.config.e2e.js
//
// E2E config: runs only tests/e2e/**, with longer timeouts for the
// Electron launch overhead (~10s on a warm machine, more on first run).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.js'],
    // Each test boots a renderer and asks Monaco's AMD loader to finish.
    // 30s per test is generous on slow machines without being so high
    // that a hung run wastes CI minutes.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
