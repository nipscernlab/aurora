// tests/e2e/edit-flow.test.js
//
// Reproduces the bug class that surfaced repeatedly this month:
// "open project → click a .v in the tree → cursor blinks but typing is dead".
// Each occurrence had a different proximate trigger (Monaco 0.53 install
// drift, race in setActiveEditor, a mode-oracle change). They all surfaced
// the same way at the user level: clicking a file no longer gave you an
// editable editor.
//
// This test asserts the user-visible contract end-to-end:
//   1. Aurora opens with a project loaded
//   2. The file tree renders the project's .v files
//   3. Clicking a .v opens it in Monaco
//   4. Typing into Monaco actually updates the buffer
//
// If any of those break — regardless of which subsystem regressed — this
// test fails. That's the point of integration tests at this layer.

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

/**
 * Build a minimal Verilog project on disk: counter.v + tb_counter.v + the
 * projectOriented.json and .spf that Aurora needs to recognize the folder
 * as a project. Paths inside the JSON have to be absolute (Aurora uses
 * them verbatim), so we generate the fixture at test time rather than
 * checking it in static.
 */
function writeFixtureProject(rootDir) {
  const counterPath = path.join(rootDir, 'counter.v');
  const tbPath = path.join(rootDir, 'tb_counter.v');

  fs.writeFileSync(counterPath,
    `\`timescale 1ns/1ps\n` +
    `module counter (\n` +
    `  input  wire       clk,\n` +
    `  input  wire       rst,\n` +
    `  output reg  [3:0] q\n` +
    `);\n` +
    `  always @(posedge clk) begin\n` +
    `    if (rst) q <= 4'b0;\n` +
    `    else     q <= q + 1'b1;\n` +
    `  end\n` +
    `endmodule\n`
  );

  fs.writeFileSync(tbPath,
    `\`timescale 1ns/1ps\n` +
    `module tb_counter;\n` +
    `  reg clk = 0;\n` +
    `  reg rst = 1;\n` +
    `  wire [3:0] q;\n` +
    `  counter dut (.clk(clk), .rst(rst), .q(q));\n` +
    `  always #5 clk = ~clk;\n` +
    `  initial begin\n` +
    `    $dumpfile("tb_counter.vcd");\n` +
    `    $dumpvars(0, tb_counter);\n` +
    `    #20 rst = 0;\n` +
    `    #200 $finish;\n` +
    `  end\n` +
    `endmodule\n`
  );

  const cfg = {
    synthesizableFiles: [
      { name: 'counter.v', path: counterPath, isTopLevel: true },
    ],
    testbenchFiles: [
      { name: 'tb_counter.v', path: tbPath, isTopLevel: false },
    ],
    topLevelFile: counterPath,
    testbenchFile: tbPath,
    gtkwFiles: [],
    processors: [],
  };
  fs.writeFileSync(path.join(rootDir, 'projectOriented.json'), JSON.stringify(cfg, null, 2));

  const spfPath = path.join(rootDir, 'counter.spf');
  fs.writeFileSync(spfPath, JSON.stringify({
    metadata: {
      projectName: 'counter',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: 'e2e-test',
      appVersion: '0.0.0-test',
      projectPath: rootDir,
    },
    structure: { basePath: rootDir, processors: [], folders: [] },
  }, null, 2));

  return { spfPath, counterPath, tbPath };
}

describe('Aurora E2E — edit flow', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  /** @type {string} */
  let userDataDir;
  /** @type {string} */
  let projectDir;
  /** @type {{ spfPath: string, counterPath: string, tbPath: string }} */
  let fixture;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-ud-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-prj-'));
    fixture = writeFixtureProject(projectDir);

    app = await electron.launch({
      // Passing the .spf as a positional arg makes lifecycle.js pick it
      // up via process.argv (the same code path as double-clicking a
      // .spf in OS shell). The renderer then auto-loads it after
      // did-finish-load.
      args: ['.', `--user-data-dir=${userDataDir}`, fixture.spfPath],
      cwd: REPO_ROOT,
      env: {
        ...stripElectronNodeMode(process.env),
        SAPHO_SKIP_SINGLE_INSTANCE: '1',
      },
      timeout: 30_000,
    });

    window = await waitForMainWindow(app);

    // Mirror renderer console output to the test runner stdout so CI
    // failures show why the page is in the state it's in (e.g. silent
    // .spf-load failures) without having to repro locally.
    window.on('console', (msg) => {
      console.log(`[renderer:${msg.type()}] ${msg.text()}`);
    });
    window.on('pageerror', (err) => {
      console.log(`[renderer:pageerror] ${err.message}`);
    });

    // Wait for Monaco AMD to finish loading. The 3-arg form
    // (fn, arg, options) is required — the 2-arg form (fn, options)
    // is interpreted by Playwright as (fn, arg), so the timeout
    // option is silently dropped and the 30s default kicks in.
    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined'
        && !!document.getElementById('monaco-editor'),
      null,
      { timeout: 15_000 }
    );

    // Belt-and-suspenders project load. The argv-passed .spf path
    // (lifecycle.js → state.fileToOpen → did-finish-load IPC →
    // ProjectManager.onSimulateOpenProject → loadProject) is the
    // intended path and works locally, but on the windows-latest CI
    // runner it has historically lost the IPC message — the renderer
    // listener registers on DOMContentLoaded and the IPC fires on
    // did-finish-load, which on a slow CPU + slow disk can race in
    // either direction. Calling window.electronAPI.openProject(spf)
    // directly here goes through the same loadProject flow but
    // doesn't depend on listener-registration timing.
    await window.evaluate(async (spfPath) => {
      const api = window.electronAPI;
      if (!api?.openProject) return;
      try {
        await api.openProject(spfPath);
      } catch (_e) { /* original IPC may have already loaded it */ }
    }, fixture.spfPath);

    // Wait for the project tree to render at least one item. Use
    // waitForSelector so we don't fall into the same (fn, options)
    // trap; selector form has unambiguous (selector, options).
    //
    // The .spf-load goes through several IPC round-trips (file
    // watcher start, processor list seeding, project file
    // enumeration) that are noticeably slower on CI than on a dev
    // machine. Local runs finish in <2 s; the hookTimeout (90 s)
    // and per-wait timeout (45 s) are sized for the worst observed
    // case on the windows-latest runner with electron just unpacked
    // from npm install cache.
    try {
      await window.waitForSelector('.file-item, .verilog-file-item', { timeout: 45_000 });
    } catch (err) {
      // Diagnostic dump so CI failures are debuggable without local
      // repro: snapshot the file-tree DOM and the URL the page is on.
      const diag = await window.evaluate(() => ({
        url: window.location.href,
        bodyClasses: document.body.className,
        fileTreeHtml: document.getElementById('file-tree')?.outerHTML?.slice(0, 1000) ?? '(no #file-tree)',
        currentProjectPath: window.currentProjectPath ?? '(unset)',
      })).catch(() => ({ note: 'evaluate failed' }));
      console.log('[edit-flow setup] tree wait timed out. Page state:', JSON.stringify(diag, null, 2));
      throw err;
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* best-effort */ });
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('clicking a .v file opens an editable Monaco buffer', async () => {
    // Click counter.v wherever it lives in the tree. Locator pierces both
    // tree implementations because both render the file name as text.
    const fileItem = window.locator('.file-item, .verilog-file-item')
      .filter({ hasText: 'counter.v' })
      .first();
    await fileItem.waitFor({ state: 'visible', timeout: 10_000 });
    await fileItem.click();

    // Tab + editor instance for this file should appear.
    await window.waitForSelector('.tab[data-path]', { timeout: 5_000 });
    await window.waitForFunction(() => {
      // The editor instance carries the filePath in its dataset (see
      // EditorManager.createEditorInstance). Wait for at least one to be
      // attached and visible.
      const instances = document.querySelectorAll('.editor-instance');
      for (const el of instances) {
        if (el.style.display !== 'none' && el.dataset.filePath) return true;
      }
      return false;
    }, { timeout: 10_000 });

    // Move focus into Monaco. Clicking the visible editor's textarea is
    // the most reliable way to do it — Monaco mounts a contenteditable
    // .inputarea that accepts keyboard events.
    const inputArea = window.locator('.editor-instance:visible .inputarea').first();
    await inputArea.waitFor({ state: 'attached', timeout: 5_000 });
    await inputArea.focus();

    // Send a unique marker so we can distinguish our edit from the
    // file's existing content. Press End to land at the end of the
    // current line first, then a newline to keep the original buffer
    // intact (cleaner than mid-file insertion which can fight with
    // language services).
    const marker = `// e2e-marker-${Date.now()}`;
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type(marker);

    // Read back from the shared model — the source of truth for the
    // buffer regardless of which pane (main or split) is focused.
    const value = await window.evaluate(() => {
      const activeTab = document.querySelector('.tab.active[data-path]');
      const filePath = activeTab?.getAttribute('data-path');
      if (!filePath || !window.SharedModelRegistry) return null;
      return window.SharedModelRegistry.getModel(filePath)?.getValue() ?? null;
    });

    expect(value).toBeTruthy();
    expect(value).toContain(marker);
  });
});
