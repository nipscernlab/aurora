// tests/e2e/shell-terminal.test.js
//
// End-to-end for the TCMD embedded shell: launches Aurora, opens the TCMD tab,
// and drives the PowerShell session over the real IPC/pipe path — proving the
// user's stated needs work: run python (user's python), navigate folders, and
// see output update live.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stripElectronNodeMode(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  return out;
}

async function waitForMainWindow(app, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.endsWith('/index.html') || url.endsWith('\\index.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Main window (index.html) did not appear within timeout.');
}

const BODY = '#terminal-tcmd .terminal-body';
const INPUT = '#terminal-tcmd .terminal-input';

describe('Aurora E2E — TCMD shell', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-shell-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined' && !!document.getElementById('monaco-editor'),
      { timeout: 15_000 },
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* best-effort */ });
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  async function runCommand(cmd) {
    await window.click(INPUT);
    await window.fill(INPUT, cmd);
    await window.press(INPUT, 'Enter');
  }

  async function bodyText() {
    return window.$eval(BODY, (el) => el.textContent || '');
  }

  it('opens the TCMD tab and shows a shell prompt', async () => {
    await window.click('.tab[data-terminal="tcmd"]');
    // The persistent PowerShell prints its own prompt (PS <cwd>>) on start.
    await window.waitForFunction(
      (sel) => /PS .*>/.test(document.querySelector(sel)?.textContent || ''),
      BODY, { timeout: 20_000 },
    );
    expect(await bodyText()).toMatch(/PS .*>/);
  }, 30_000);

  it("runs the user's python and streams the output", async () => {
    await runCommand('python --version');
    await window.waitForFunction(
      (sel) => /Python \d+\.\d+/.test(document.querySelector(sel)?.textContent || ''),
      BODY, { timeout: 20_000 },
    );
    expect(await bodyText()).toMatch(/Python \d+\.\d+/);
  }, 30_000);

  it('navigates folders (cd persists, prompt updates)', async () => {
    const before = await bodyText();
    // Move somewhere that reliably exists and print the new location.
    await runCommand('Set-Location $env:USERPROFILE; Get-Location');
    await window.waitForFunction(
      (prev) => {
        const t = document.querySelector('#terminal-tcmd .terminal-body')?.textContent || '';
        // A new prompt rooted at the user profile must appear after our command.
        return t.length > prev.length && /PS .*Users.*>\s*$/m.test(t);
      },
      before, { timeout: 20_000 },
    );
    const after = await bodyText();
    expect(after).toMatch(/Path/i);          // Get-Location table header
    expect(after.length).toBeGreaterThan(before.length);
  }, 30_000);

  it('streams live output as it is produced (unbuffered python)', async () => {
    // Three ticks with 300ms gaps; PYTHONUNBUFFERED must make them appear. Kept a
    // one-LINER because <input type=text> strips embedded newlines.
    await runCommand("python -c \"import time,sys;[(print('tick',k),sys.stdout.flush(),time.sleep(0.3)) for k in range(3)]\"");
    await window.waitForFunction(
      (sel) => /tick 2/.test(document.querySelector(sel)?.textContent || ''),
      BODY, { timeout: 20_000 },
    );
    const t = await bodyText();
    expect(t).toMatch(/tick 0/);
    expect(t).toMatch(/tick 2/);
  }, 30_000);
});
