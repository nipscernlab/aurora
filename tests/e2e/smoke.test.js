// tests/e2e/smoke.test.js
//
// Bare-minimum end-to-end smoke test. Launches Aurora via Playwright's
// Electron API and asserts the renderer reaches a usable state without
// any of the Monaco-init failures we've hit repeatedly:
//
//   - "EditorManager has not been initialized"   (createEditorInstance
//                                                  fired before the
//                                                  container was bound)
//   - "Property description must be an object"   (Monaco 0.53.x throwing
//                                                  inside its own
//                                                  monaco.contribution.js)
//   - any uncaught page-level error that bubbles to window.onerror
//
// This is intentionally narrow. Once the harness proves stable in CI
// we'll layer richer flow tests (open project → click file → type →
// assert model content) on top.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stripElectronNodeMode(env) {
  // Make a clean copy without ELECTRON_RUN_AS_NODE — copy-the-rest pattern
  // because deleting from a process.env reference would mutate the live one.
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  return out;
}

async function waitForMainWindow(app, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  // Poll app.windows() — splash closes once the main window mounts. The
  // main one is identified by index.html in its URL.
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.endsWith('/index.html') || url.endsWith('\\index.html')) {
        return w;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Main window (index.html) did not appear within timeout.');
}

const MONACO_FAILURE_MARKERS = [
  'EditorManager has not been initialized',
  'Property description must be an object',
  // monaco.contribution.js paths look like
  // "node_modules/monaco-editor/.../monaco.contribution.js" — the
  // substring is unique enough to flag any error inside that module.
  'monaco.contribution.js',
];

describe('Aurora E2E — smoke', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string} */
  let userDataDir;

  beforeAll(async () => {
    // Isolate from any Aurora install the developer might already have
    // running locally. main/lifecycle.js holds a single-instance lock,
    // so reusing the default user-data dir would cause `electron.launch`
    // to fail with "Process failed to launch!" the moment Aurora is open
    // in another window.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-'));

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: {
        // Drop ELECTRON_RUN_AS_NODE if the dev's shell has it set —
        // it forces Electron into Node-only mode (no GUI, no app
        // module) and makes every launch fail with "Process failed to
        // launch!" miles away from the actual cause.
        ...stripElectronNodeMode(process.env),
        // Bypass main/lifecycle.js single-instance lock — Electron's lock
        // is per app name and would collide with any Aurora the dev has
        // open. The test gets its own user-data-dir so there's no real
        // conflict; the lock just thinks there is.
        SAPHO_SKIP_SINGLE_INSTANCE: '1',
      },
      // Keep the renderer's console output capturable. Playwright's
      // page events fire only after firstWindow() resolves.
      timeout: 30_000,
    });

    // Aurora boots a splash window that closes itself once the main
    // window is ready. firstWindow() can resolve to either, so wait
    // for index.html specifically — splash loads splash.html.
    window = await waitForMainWindow(app);

    window.on('pageerror', (err) => {
      pageErrors.push(err.message ?? String(err));
    });
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for the renderer to mount its main container *and* for Monaco
    // to actually attach. The two are decoupled — #monaco-editor is in
    // the HTML from the start, but window.monaco only appears once the
    // AMD modules finish loading. Test against the latter.
    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined'
        && !!document.getElementById('monaco-editor'),
      { timeout: 15_000 }
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* best-effort */ });
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('renderer mounts the editor container', async () => {
    const handle = await window.$('#monaco-editor');
    expect(handle).not.toBeNull();
  });

  it('Monaco AMD modules are loaded', async () => {
    const hasMonaco = await window.evaluate(() => typeof window.monaco !== 'undefined');
    expect(hasMonaco).toBe(true);
  });

  it('no Monaco-init failures in console / page errors', () => {
    const all = [...pageErrors, ...consoleErrors];
    const hits = all.filter((line) =>
      MONACO_FAILURE_MARKERS.some((marker) => line.includes(marker))
    );
    if (hits.length > 0) {
      // Surface the actual messages — much faster to triage than a bare
      // expectation diff.
      throw new Error(
        `Monaco-init failure(s) detected:\n  ${hits.join('\n  ')}\n\n` +
        `Likely cause: monaco-editor drifted off the pinned 0.52.2.\n` +
        `Run: node scripts/check-pinned-versions.js`
      );
    }
    expect(hits).toEqual([]);
  });

  it('reaches interactive within the startup budget', async () => {
    // The renderer marks performance.mark('aurora-interactive') at the end of
    // init (app_initializer.js). Its startTime is TTI relative to navigation.
    // This is a regression GUARD, not a benchmark — the budget is deliberately
    // generous so a cold CI runner doesn't flake; it only trips on gross
    // regressions (a blocking await or sync I/O added to the boot path).
    const STARTUP_BUDGET_MS = 30_000;
    const tti = await window.evaluate(() => {
      const entry = performance.getEntriesByName('aurora-interactive')[0];
      return entry ? entry.startTime : null;
    });
    // The mark must exist (TTI instrumentation present) ...
    expect(tti).not.toBeNull();
    // ... and fire within budget.
    expect(tti).toBeLessThan(STARTUP_BUDGET_MS);
  });
});
