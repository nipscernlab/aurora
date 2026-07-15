// tests/e2e/shell-terminal.test.js
//
// End-to-end for the TCMD terminal (xterm.js + a real PTY). Launches Aurora,
// opens the TCMD tab, and drives the PowerShell session through xterm over the
// real IPC/PTY path — proving the user's needs: run the user's python, navigate
// folders, and see live output, with a true terminal (inline input via the PTY).

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

const ROWS = '#terminal-tcmd .xterm-rows';

describe('Aurora E2E — TCMD terminal (xterm + pty)', () => {
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
    // Open the TCMD tab and make sure xterm mounted.
    await window.click('.tab[data-terminal="tcmd"]');
    await window.waitForSelector(ROWS, { timeout: 15_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* best-effort */ });
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  async function focusTerm() {
    await window.click('#terminal-tcmd .xterm-screen');
  }
  async function runCommand(cmd) {
    await focusTerm();
    await window.keyboard.type(cmd);
    await window.keyboard.press('Enter');
  }
  async function screenText() {
    return window.$eval(ROWS, (el) => el.textContent || '');
  }
  async function waitForText(re, timeout = 20_000) {
    await window.waitForFunction(
      ({ sel, src }) => new RegExp(src).test(document.querySelector(sel)?.textContent || ''),
      { sel: ROWS, src: re.source }, { timeout },
    );
  }

  it('mounts xterm and the PTY prints the aurora prompt', async () => {
    // The TCMD shell loads a themed prompt (main/shell/aurora-prompt.ps1) whose
    // input marker is the accent chevron ❯ instead of the default `PS ...>`.
    await waitForText(/❯/);
    expect(await screenText()).toMatch(/❯/);
  }, 30_000);

  it("runs the user's python and shows the version", async () => {
    await runCommand('python --version');
    await waitForText(/Python \d+\.\d+/);
    expect(await screenText()).toMatch(/Python \d+\.\d+/);
  }, 30_000);

  it('navigates folders (cd persists, prompt updates)', async () => {
    await runCommand('Set-Location $env:USERPROFILE; Get-Location');
    await waitForText(/Path/i);
    // The aurora prompt collapses the home directory to ~, so landing in the
    // user profile shows a ~ segment — proof the prompt tracks the new cwd.
    await waitForText(/~/);
    expect(await screenText()).toMatch(/~/);
  }, 30_000);

  it('streams live output (unbuffered python)', async () => {
    await runCommand("python -c \"import time,sys;[(print('tick',k),sys.stdout.flush(),time.sleep(0.3)) for k in range(3)]\"");
    await waitForText(/tick 2/);
    expect(await screenText()).toMatch(/tick 2/);
  }, 30_000);
});
