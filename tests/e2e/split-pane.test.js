// tests/e2e/split-pane.test.js
//
// Regression coverage for two split-editor bugs that shipped together:
//
//   1. Clicking a project .v in the tree always opened in the MAIN pane,
//      ignoring a focused split. The Verilog tree's click handler
//      (file_mode.js) routed straight to TabManager.addTab without checking
//      SplitEditorManager.focusedPane — unlike the generic file tree.
//
//   2. Dragging a tab from the main pane onto a split pane did nothing — the
//      split panes were never wired as HTML5 drop targets; drag/drop only
//      reordered tabs inside the main #tabs-container.
//
// Both are asserted at the user-visible contract level so any future
// regression in the routing/DnD wiring fails here regardless of the cause.

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

function writeFixtureProject(rootDir) {
  const counterPath = path.join(rootDir, 'counter.v');
  const tbPath = path.join(rootDir, 'tb_counter.v');
  fs.writeFileSync(counterPath, `module counter(input clk); endmodule\n`);
  fs.writeFileSync(tbPath, `module tb_counter; endmodule\n`);
  const spfPath = path.join(rootDir, 'counter.spf');
  fs.writeFileSync(spfPath, JSON.stringify({
    metadata: { projectName: 'counter', projectPath: rootDir, appVersion: '0.0.0-test' },
    structure: {
      basePath: rootDir, processors: [], folders: [],
      topLevelFile: counterPath, testbenchFile: tbPath,
      synthesizableFiles: [{ name: 'counter.v', path: counterPath, isTopLevel: true }],
      testbenchFiles: [{ name: 'tb_counter.v', path: tbPath, isTopLevel: false }],
    },
  }, null, 2));
  return { spfPath, counterPath, tbPath };
}

describe('Aurora E2E — split pane routing + drag-and-drop', () => {
  let app, window, userDataDir, projectDir, fixture;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-repro-ud-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-repro-prj-'));
    fixture = writeFixtureProject(projectDir);
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, fixture.spfPath],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    window.on('console', (msg) => console.log(`[renderer:${msg.type()}] ${msg.text()}`));
    window.on('pageerror', (err) => console.log(`[renderer:pageerror] ${err.message}`));
    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined' && !!document.getElementById('monaco-editor'),
      null, { timeout: 15_000 });
    await window.evaluate(async (spfPath) => {
      try { await window.electronAPI?.openProject?.(spfPath); } catch (_e) { /* IPC may have already loaded it */ }
      await window.projectTreeManager?.refreshTree?.();
    }, fixture.spfPath);
    await window.waitForSelector('.file-item, .verilog-file-item', { timeout: 45_000 });
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('opens tree file in the focused split pane', async () => {
    // 1. Open counter.v in main
    const counter = window.locator('.file-item, .verilog-file-item').filter({ hasText: 'counter.v' }).first();
    await counter.click();
    await window.waitForSelector('.tab[data-path]', { timeout: 5_000 });

    // 2. Click the split button
    const splitBtnState = await window.evaluate(() => {
      const btn = document.getElementById('split-editor-btn');
      return { exists: !!btn, disabled: btn?.disabled, canSplit: window.SplitEditorManager?.canSplit?.() };
    });
    console.log('[split-pane] split btn:', JSON.stringify(splitBtnState));
    await window.click('#split-editor-btn');
    await new Promise((r) => setTimeout(r, 400));

    const afterSplit = await window.evaluate(() => ({
      focusedPane: window.SplitEditorManager?.focusedPane,
      paneCount: window.SplitEditorManager?.panes?.length,
      splitPaneTabs: window.SplitEditorManager?.panes?.map(p => ({ idx: p.paneIndex, tabs: [...p.tabs.keys()] })),
    }));
    console.log('[split-pane] after split:', JSON.stringify(afterSplit));

    // 3. Wait a beat (let any deferred focus settle), then re-check focus
    await new Promise((r) => setTimeout(r, 300));
    const focusBeforeTreeClick = await window.evaluate(() => window.SplitEditorManager?.focusedPane);
    console.log('[split-pane] focusedPane right before tree click:', focusBeforeTreeClick);

    // 4. Click tb_counter.v in the tree
    const tb = window.locator('.file-item, .verilog-file-item').filter({ hasText: 'tb_counter.v' }).first();
    await tb.click();
    await new Promise((r) => setTimeout(r, 500));

    // 5. Where did tb_counter land?
    const result = await window.evaluate((tbPath) => {
      const sem = window.SplitEditorManager;
      const inMain = window.TabManager?.tabs?.has(tbPath);
      const inSplit = sem?.panes?.some(p => p.tabs.has(tbPath));
      return {
        focusedPane: sem?.focusedPane,
        tbInMain: inMain,
        tbInSplit: inSplit,
        splitPanes: sem?.panes?.map(p => ({ idx: p.paneIndex, tabs: [...p.tabs.keys()].map(k => k.split(/[\\/]/).pop()) })),
        mainTabs: [...(window.TabManager?.tabs?.keys() ?? [])].map(k => k.split(/[\\/]/).pop()),
      };
    }, fixture.tbPath);
    console.log('[split-pane] RESULT:', JSON.stringify(result, null, 2));

    expect(result.tbInSplit).toBe(true);
  });

  it('moves a main tab into a split pane via drag-and-drop', async () => {
    // State from here: split pane (idx 1) exists. counter.v is in main,
    // tb_counter.v is in the split (from the previous test). Drag counter.v's
    // MAIN tab onto the split pane and assert it moves (lands in split, leaves
    // main). We simulate the HTML5 DnD by firing the events with a shared
    // DataTransfer — Playwright's dragTo doesn't drive native DnD reliably.
    const moved = await window.evaluate(async () => {
      const sem = window.SplitEditorManager;
      const counterPath = [...window.TabManager.tabs.keys()].find(p => p.endsWith('counter.v') && !p.endsWith('tb_counter.v'));
      if (!counterPath) return { error: 'counter.v not in main' };

      const mainTab = document.querySelector(`#tabs-container .tab[data-path="${window.CSS.escape(counterPath)}"]`);
      const targetPane = sem.panes.find(p => p.paneIndex === 1)?.element;
      if (!mainTab || !targetPane) return { error: 'tab or pane element missing' };

      const dt = new window.DataTransfer();
      mainTab.dispatchEvent(new window.DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      targetPane.dispatchEvent(new window.DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      targetPane.dispatchEvent(new window.DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      mainTab.dispatchEvent(new window.DragEvent('dragend', { bubbles: true, dataTransfer: dt }));

      // moveFileToPane awaits openFile + closeTab; give microtasks a beat.
      await new Promise(r => setTimeout(r, 300));

      return {
        counterPath,
        inMain: window.TabManager.tabs.has(counterPath),
        inSplit: sem.panes.some(p => p.tabs.has(counterPath)),
        focusedPane: sem.focusedPane,
      };
    });
    console.log('[split-pane] DRAG RESULT:', JSON.stringify(moved, null, 2));

    expect(moved.error).toBeUndefined();
    expect(moved.inSplit).toBe(true);  // landed in the split
    expect(moved.inMain).toBe(false);  // moved out of main
  });

  it('has no standard view; no-project card lives in the verilog container', async () => {
    const state = await window.evaluate(() => {
      const ft = document.getElementById('file-tree');
      // Render the no-project empty card, then confirm a verilog render
      // strips it (project-load path). projectTreeManager has files from
      // the earlier tests, so renderTree() paints rows and clears the card.
      window.renderTreeEmptyState();
      const verilog = window.treeView.getContainer('verilog');
      const cardPresentAfterRender = !!verilog?.querySelector('.tree-empty-no-project');

      window.projectTreeManager?.renderTree?.();
      const cardClearedByRenderTree = !verilog?.querySelector('.tree-empty-no-project');

      return {
        activeView: ft?.dataset.activeView,
        hasStandardContainer: !!ft?.querySelector(':scope > .tree-view-standard'),
        standardInViewNames: !!window.treeView && !window.treeView.getContainer('standard'),
        cardPresentAfterRender,
        cardClearedByRenderTree,
      };
    });
    console.log('[split-pane] STANDARD-GONE:', JSON.stringify(state, null, 2));

    expect(state.activeView).toBe('verilog');     // default view is verilog now
    expect(state.hasStandardContainer).toBe(false); // standard subtree never created
    expect(state.cardPresentAfterRender).toBe(true);  // card renders into verilog
    expect(state.cardClearedByRenderTree).toBe(true); // and is stripped on file render
  });
});
