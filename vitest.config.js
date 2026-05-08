// vitest.config.js
//
// Default `npm test` runs unit tests only (test/**) — fast, no Electron.
// E2E tests live under tests/e2e/ and launch a full Electron app via
// Playwright; they take ~10s each so they're a separate command
// (`npm run test:e2e`) and a separate CI step.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match the existing test/**/*.test.js layout but explicitly exclude
    // the e2e tree so unit runs don't try to launch Electron.
    exclude: [
      '**/node_modules/**',
      'tests/e2e/**',
    ],
  },
});
