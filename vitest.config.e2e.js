// vitest.config.e2e.js
//
// E2E config: runs only tests/e2e/**, with longer timeouts for the
// Electron launch overhead (~10s on a warm machine, more on first run).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.js'],
    // Each test boots a renderer and asks Monaco's AMD loader to finish.
    // CI (windows-latest) is noticeably slower than a dev machine —
    // electron cold-start + .spf-load IPC chain takes ~10–15 s on the
    // runner where it's <2 s locally. Sized for the worst observed
    // case while still flagging genuinely-hung runs.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
