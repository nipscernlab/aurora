// vitest.config.js
//
// Default `npm test` runs unit tests only (tests/unit/**) — fast, no Electron.
// E2E tests live under tests/e2e/ and launch a full Electron app via
// Playwright; they take ~10s each so they're a separate command
// (`npm run test:e2e`) and a separate CI step.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    exclude: ['**/node_modules/**'],
    coverage: {
      // `npm run test:coverage` (and CI) measure coverage of the source the unit
      // tests actually exercise. `all:false` keeps the report to the modules the
      // tests import (meaningful for the current pure-module suite) rather than
      // diluting it with the whole renderer/main tree at 0%.
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      all: false,
      exclude: ['**/*.test.js', '**/node_modules/**', 'dist/**', 'components/**', 'tests/**', '**/*.config.*'],
    },
  },
});
