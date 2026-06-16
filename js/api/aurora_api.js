/**
 * aurora_api.js — `window.AuroraAPI`, the single async, JSON-serialisable
 * surface for every IDE operation.
 *
 * Phase A (this file). A thin *facade* that delegates to the existing
 * managers (EditorManager, TabManager, compilationFlowManager, …).
 * Importantly, nothing in the UI is rewired yet: toolbar buttons still
 * attach their own listeners, file-tree clicks still call into project
 * managers directly, etc. Phase A just exposes the surface so:
 *   - Aurora Intelligence can drive the IDE through stable function
 *     calls (PR 4),
 *   - dev tooling and tests can script the IDE without poking private
 *     fields,
 *   - subsequent phases can rewrite call sites to go through the API
 *     incrementally, without a big-bang refactor.
 *
 * Conventions
 * ===========
 *   - Every function is async and returns `{ ok, data?, error? }`. The
 *     shape is JSON-serialisable so the same value can travel over IPC
 *     to the AI runner without ceremony.
 *   - On error we resolve (not reject) with `ok:false` and a structured
 *     error. Tool-calling agents handle data better than they handle
 *     thrown promises.
 *   - All references to managers go through `window.*` or named imports
 *     and are resolved *at call time*, so the facade is safe to mount
 *     before every manager has finished booting.
 *
 * Future phases (next PRs):
 *   - Phase B: rewrite toolbar/shortcut handlers to call `AuroraAPI.X()`
 *     instead of touching managers directly.
 *   - Phase C: replace scattered `dispatchEvent(new CustomEvent(...))`
 *     publishers with `AuroraAPI.events.emit(...)`.
 *   - Phase D: flesh out `_meta.schema()` into a full JSON-Schema tool
 *     manifest auto-consumable by the AI runner.
 */

import { EditorManager } from '../editor/monaco_editor.js';
import { TabManager } from '../tabs/tab_manager.js';
import { SharedModelRegistry } from '../editor/shared_models.js';
import { setTooltipsEnabled } from '../ui/tooltip.js';
import { processorConfigPanel } from '../processors/processor_config_panel.js';
import {
  getSimulator as getWaveSimulator,
  setSimulator as setWaveSimulator,
} from '../wave/simulator_preference.js';
import {
  getViewer as getWaveViewer,
  setViewer as setWaveViewer,
} from '../wave/viewer_preference.js';
import {
  getSurferMultiWindow,
  setSurferMultiWindow,
} from '../wave/surfer_window_preference.js';

/* ============================================================
 *  Result helpers
 * ========================================================== */

function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function err(message, code) {
  return { ok: false, error: { message: String(message || 'Unknown error'), code: code || null } };
}

/**
 * Resolve a file the AI named to an absolute path inside the open project —
 * even when it passes just a basename or a partial nested path, and even when
 * casing differs (Windows is case-insensitive; a plain endsWith match is not).
 * Strategy, in order:
 *   1. the path as given (relative → joined to root; absolute → as-is) if it
 *      exists on disk;
 *   2. an exact relative-path match in the project tree (case-insensitive);
 *   3. a path that ENDS WITH the requested partial path ("Software/foo.cmm");
 *   4. a basename match anywhere in the tree (shortest path wins on ties).
 * Returns the absolute path string, or null if the file is nowhere in the
 * project. Shared by editor.openFile and project.readFile so both "find" a file
 * instead of erroring the moment a literal path miss happens.
 */
async function resolveProjectFile(filePath, root) {
  if (!filePath || !root) return null;
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
  const direct = isAbsolute
    ? filePath
    : `${root}\\${String(filePath).replace(/^[\\/]+/, '').replace(/\//g, '\\')}`;

  // 1. Try the path as given first — cheapest, and the usual hit.
  try {
    await window.electronAPI.readFile(direct);
    return direct;
  } catch (_) { /* fall through to a project-wide search */ }

  // An absolute path that doesn't exist has nothing to search against.
  if (isAbsolute) return null;

  // 2-4. Walk the whole project tree and match by name, case-insensitively.
  let tree;
  try { tree = await projectNs.getTree(root); } catch (_) { return null; }
  if (!tree || !tree.ok || !Array.isArray(tree.data)) return null;
  const paths = tree.data;                       // relative, forward-slash
  const want = String(filePath).replace(/^[\\/]+/, '').replace(/\\/g, '/').toLowerCase();
  const wantBase = want.split('/').pop();

  let match = paths.find((p) => p.toLowerCase() === want)                       // exact rel path
    || paths.find((p) => p.toLowerCase().endsWith(`/${want}`));                 // partial nested path
  if (!match) {
    const byBase = paths.filter((p) => p.toLowerCase().split('/').pop() === wantBase);
    byBase.sort((a, b) => a.length - b.length);  // prefer the shallowest hit
    match = byBase[0];
  }
  if (!match) return null;
  return `${root}\\${match.replace(/\//g, '\\')}`;
}

/* ============================================================
 *  Event bus
 *
 *  In-renderer pub/sub. Returns an unsubscribe function from
 *  `on()` so callers don't need to retain handler references.
 *  Phase C migrates the existing `window.dispatchEvent` publishers
 *  to emit here as well.
 * ========================================================== */

const listeners = new Map();

function on(event, fn) {
  if (typeof fn !== 'function') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}
function off(event, fn) {
  listeners.get(event)?.delete(fn);
}
function emit(event, payload) {
  const subs = listeners.get(event);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(payload); }
    catch (e) { console.warn(`[AuroraAPI.events] handler for "${event}" threw:`, e); }
  }
}

/* ============================================================
 *  Legacy window-event bridge
 *
 *  Aurora predates this bus, so cross-cutting signals are still
 *  dispatched as `CustomEvent`s on `window`. Rather than a risky
 *  big-bang migration of every publisher, we bridge them: each
 *  legacy event is re-emitted on the bus under a normalised,
 *  colon-namespaced name. Existing `window.addEventListener`
 *  callers keep working untouched; new code (and Aurora
 *  Intelligence) gets one consistent surface via
 *  `AuroraAPI.events.on(...)`.
 * ========================================================== */

const WINDOW_EVENT_BRIDGE = Object.freeze({
  'aurora:locale-changed':       'locale:changed',
  'aurora:editing-file-changed': 'editor:active-file-changed',
  'aurora-editor-focused':       'editor:focused',
  'aurora:spf-changed':          'project:spf-changed',
  'aurora-settings-updated':     'settings:updated',
  'aurora-shortcuts-updated':    'settings:shortcuts-updated',
  'aurora-tooltips-updated':     'settings:tooltips-updated',
});

function bridgeWindowEvents() {
  for (const [domEvent, busEvent] of Object.entries(WINDOW_EVENT_BRIDGE)) {
    window.addEventListener(domEvent, (e) => emit(busEvent, e && e.detail != null ? e.detail : null));
  }
}

/* ============================================================
 *  editor — Monaco interactions
 * ========================================================== */

function activeEditor() {
  return EditorManager?.activeEditor || null;
}
function activeModel() {
  return activeEditor()?.getModel() || null;
}

function flashLines(ed, startLine, endLine) {
  if (!ed || !window.monaco) return;
  const ids = ed.deltaDecorations([], [{
    range: new window.monaco.Range(startLine, 1, endLine, Number.MAX_SAFE_INTEGER),
    options: { isWholeLine: true, className: 'ai-edit-flash-line' },
  }]);
  setTimeout(() => ed.deltaDecorations(ids, []), 950);
}

/**
 * Magic-wand reveal for whole-file AI edits. Two layers, both soft purple:
 *   1. a shimmer band that sweeps up the editor (.ai-wand-overlay), and
 *   2. a fading purple tint over every freshly-written line
 *      (.aurora-edit-reveal) so the new text reads as being *revealed*
 *      over the old rather than abruptly swapped.
 * Purely cosmetic — guarded so it can never break the underlying write.
 */
function magicWandReveal(ed) {
  if (!ed) return;
  try {
    const editorDom = ed.getDomNode?.();
    const container = editorDom?.closest(
      '.split-pane-editor-area, .editor-container, #monaco-editor',
    ) || editorDom?.parentElement;
    if (container) {
      const wand = document.createElement('div');
      wand.className = 'ai-wand-overlay';
      container.style.position = 'relative';
      container.appendChild(wand);
      wand.addEventListener('animationend', () => wand.remove(), { once: true });
    }
    const model = ed.getModel?.();
    if (model && window.monaco) {
      const lineCount = model.getLineCount();
      const ids = ed.deltaDecorations([], [{
        range: new window.monaco.Range(1, 1, lineCount, Number.MAX_SAFE_INTEGER),
        options: { isWholeLine: true, className: 'aurora-edit-reveal' },
      }]);
      setTimeout(() => { try { ed.deltaDecorations(ids, []); } catch (_) { /* disposed */ } }, 950);
    }
  } catch (_) { /* cosmetic only */ }
}

const editorNs = {
  async getActiveFilePath() {
    return ok(TabManager?.activeTab || null);
  },

  async getOpenFiles() {
    // Collect files from all splits (SplitEditorManager.panes[*].tabs) plus
    // the main tab bar (TabManager.tabs) so no open file in any pane is missed.
    const seen = new Set();
    const splitMgr = window.SplitEditorManager;
    if (splitMgr?.panes) {
      for (const pane of splitMgr.panes) {
        for (const fp of (pane.tabs?.keys?.() || [])) seen.add(fp);
      }
    }
    const mainKeys = TabManager?.tabs?.keys?.();
    if (mainKeys) for (const fp of mainKeys) seen.add(fp);
    return ok(Array.from(seen));
  },

  async getActiveText() {
    const model = activeModel();
    if (!model) return err('No active editor');
    return ok(model.getValue());
  },

  async setActiveText(text) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const model = ed.getModel();
    if (!model) return err('No active editor');
    model.setValue(String(text ?? ''));
    magicWandReveal(ed);
    return ok();
  },

  /**
   * Insert `text` at `{ line, column }` (1-indexed Monaco coordinates).
   * Omit the position to insert at the current cursor.
   */
  async insertAt(text, position) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const pos = position && position.line && position.column
      ? { lineNumber: position.line, column: position.column }
      : ed.getPosition();
    if (!pos) return err('Cursor position unavailable');
    const insertText = String(text ?? '');
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: insertText,
      forceMoveMarkers: true,
    }]);
    const newLines = (insertText.match(/\n/g) || []).length;
    flashLines(ed, pos.lineNumber, pos.lineNumber + newLines);
    return ok();
  },

  /**
   * Replace the text in `{ startLine, startColumn, endLine, endColumn }`
   * (1-indexed, end-exclusive in column) with `text`.
   */
  async replaceRange({ startLine, startColumn, endLine, endColumn, text }) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    if (!startLine || !startColumn || !endLine || !endColumn) {
      return err('replaceRange requires startLine, startColumn, endLine, endColumn');
    }
    const replaceText = String(text ?? '');
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: startLine, startColumn,
        endLineNumber:   endLine,   endColumn,
      },
      text: replaceText,
      forceMoveMarkers: true,
    }]);
    const newLines = (replaceText.match(/\n/g) || []).length;
    flashLines(ed, startLine, startLine + newLines);
    return ok();
  },

  async getCursor() {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const p = ed.getPosition();
    return p ? ok({ line: p.lineNumber, column: p.column }) : err('Cursor unavailable');
  },

  async setCursor({ line, column }) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    ed.setPosition({ lineNumber: line, column });
    ed.revealPositionInCenter({ lineNumber: line, column });
    ed.focus();
    return ok();
  },

  async getLanguage() {
    const model = activeModel();
    if (!model) return err('No active editor');
    return ok(model.getLanguageId?.() ?? null);
  },

  async newFile() {
    if (typeof TabManager?.createNewFile !== 'function') {
      return err('newFile unavailable');
    }
    try {
      const filePath = TabManager.createNewFile();
      emit('editor:new-file', { filePath });
      return ok({ filePath });
    } catch (e) {
      return err(e?.message || 'newFile failed');
    }
  },

  async save() {
    const path = TabManager?.activeTab;
    if (!path) return err('No active file');
    try {
      await TabManager.saveCurrentFile();
      emit('editor:saved', { filePath: path });
      return ok({ filePath: path });
    } catch (e) {
      return err(e?.message || 'save failed');
    }
  },

  async saveAll() {
    try {
      await TabManager.saveAllFiles();
      emit('editor:saved', { filePath: null, all: true });
      return ok();
    } catch (e) {
      return err(e?.message || 'saveAll failed');
    }
  },

  /** Close `filePath`, or the active tab if no path is given. */
  async closeTab(filePath) {
    const target = filePath || TabManager?.activeTab;
    if (!target) return err('No tab to close');
    if (typeof TabManager?.closeTab !== 'function') return err('TabManager.closeTab unavailable');
    try {
      await TabManager.closeTab(target);
      return ok({ filePath: target });
    } catch (e) {
      return err(e?.message || 'closeTab failed');
    }
  },

  /** Re-open the most-recently closed tab (TabManager keeps a small history). */
  async reopenLastTab() {
    if (typeof TabManager?.reopenLastClosedTab !== 'function') {
      return err('reopen history unavailable');
    }
    try {
      await TabManager.reopenLastClosedTab();
      return ok();
    } catch (e) {
      return err(e?.message || 'reopenLastTab failed');
    }
  },

  /** Open a project file in the editor, optionally in a new split pane. */
  async openFile({ filePath, inNewSplit = false } = {}) {
    if (!filePath) return err('filePath required');
    const root = window.currentProjectPath || '';
    if (!root) return err('No project open');
    // Find the file anywhere in the project (basename / partial path / casing),
    // not just at the literal path the AI guessed.
    const absPath = await resolveProjectFile(filePath, root);
    if (!absPath) {
      return err(`"${filePath}" not found anywhere in the project. Use get_project_tree to list available paths.`);
    }
    let content;
    try {
      content = await window.electronAPI.readFile(absPath);
    } catch (e) {
      return err(`Found "${absPath}" but could not read it: ${e?.message || e}`);
    }
    const sem = window.SplitEditorManager;
    try {
      if (inNewSplit && sem?.createSplit) {
        await sem.createSplit();          // creates pane from current file + focuses it
        await sem.openInFocusedPane(absPath, content);  // replace with target file
      } else if (sem?.openInFocusedPane) {
        await sem.openInFocusedPane(absPath, content);
      } else {
        TabManager.addTab(absPath, content);
      }
      return ok({ filePath: absPath });
    } catch (e) {
      return err(e?.message || 'openFile failed');
    }
  },

  /** Create a new editor split pane. */
  async createSplit() {
    const sem = window.SplitEditorManager;
    if (!sem?.createSplit) return err('SplitEditorManager unavailable');
    try {
      await sem.createSplit();
      return ok();
    } catch (e) {
      return err(e?.message || 'createSplit failed');
    }
  },
};

/* ============================================================
 *  terminal — read/clear the per-area panels at the bottom
 *
 *  Terminals are addressed by their content id: 'tcmm', 'tasm',
 *  'tveri', 'twave', 'tprism' (the panes wired by the
 *  compilation-flow buttons). Pass `undefined` to operate on
 *  the currently visible terminal.
 * ========================================================== */

function visibleTerminalEl() {
  return document.querySelector('.terminal-content:not(.hidden)') || null;
}
function terminalElById(id) {
  if (!id) return visibleTerminalEl();
  // Match either the content div id (`tcmm`) or the wrapper `terminal-tcmm`.
  return document.getElementById(id) || document.getElementById(`terminal-${id}`) || null;
}
function extractTerminalText(el) {
  const lines = Array.from(el.querySelectorAll('.message, .entry, .terminal-line, .terminal-card'))
    .map((n) => n.textContent?.trim())
    .filter(Boolean);
  return lines.length ? lines.join('\n') : (el.textContent || '').trim();
}

const terminalNs = {
  /** List the ids of every terminal panel (tcmm, tasm, tveri, twave, ...). */
  async list() {
    const ids = Array.from(document.querySelectorAll('.terminal-content'))
      .map((el) => el.id)
      .filter(Boolean);
    return ok(ids);
  },

  /**
   * Return the visible text content of one terminal. Cards/messages get
   * concatenated with newlines so the result reads like the user sees
   * the panel. Omit `id` for the currently visible terminal.
   */
  async getText(id) {
    const el = terminalElById(id);
    if (!el) return err(id ? `terminal "${id}" not found` : 'no visible terminal');
    return ok(extractTerminalText(el));
  },

  /** Visible text of *every* terminal panel, keyed by id. */
  async getAll() {
    const out = {};
    for (const el of document.querySelectorAll('.terminal-content')) {
      if (el.id) out[el.id] = extractTerminalText(el);
    }
    return ok(out);
  },

  async clear(id) {
    const tm = window.globalTerminalManager;
    if (!tm) return err('terminal manager not initialised');
    const target = id || visibleTerminalEl()?.id || null;
    if (!target) return err('no terminal to clear');
    try {
      if (typeof tm.clearTerminal === 'function') {
        await tm.clearTerminal(target);
      } else if (typeof tm.clearTerminalImmediate === 'function') {
        tm.clearTerminalImmediate(target);
      } else {
        const el = terminalElById(target);
        if (!el) return err(`terminal "${target}" not found`);
        el.innerHTML = '';
      }
      return ok({ id: target });
    } catch (e) {
      return err(e?.message || 'clear failed');
    }
  },
};

/* ============================================================
 *  project — current project, filesystem tree, file/processor/
 *  project lifecycle
 * ========================================================== */

async function refreshTree() {
  try { await window.electronAPI?.triggerFileTreeRefresh?.(); }
  catch (_) { /* tree refresh is best-effort */ }
}

/**
 * Close `filePath` in every pane that shows it — the main TabManager pane
 * and any split panes. Used when a file's on-disk path changes underneath
 * the editor (e.g. a processor rename) so no tab is left pointing at a
 * path that no longer exists.
 */
async function closeFileEverywhere(filePath) {
  try {
    if (TabManager?.tabs?.has?.(filePath)) await TabManager.closeTab(filePath);
  } catch (_) { /* ignore */ }
  const sem = window.SplitEditorManager;
  if (sem?.panes) {
    for (const pane of [...sem.panes]) {
      try {
        if (pane?.tabs?.has?.(filePath) && typeof pane._closeFile === 'function') {
          await pane._closeFile(filePath);
        }
      } catch (_) { /* ignore */ }
    }
  }
}

const projectNs = {
  async getCurrent() {
    const path = window.currentProjectPath || window.currentOpenProjectPath || null;
    if (!path) return ok(null);
    try {
      const info = await window.electronAPI?.getProjectInfo?.(path);
      return ok({ path, info: info || null });
    } catch (e) {
      return ok({ path, info: null, infoError: e?.message || String(e) });
    }
  },

  async getTree(rootPath) {
    const root = rootPath || window.currentProjectPath || null;
    if (!root) return err('No project open');

    // Return a flat list of every file path (relative to project root) so the
    // AI can pick the right path without needing multiple tool calls to drill
    // into subdirectories one level at a time.
    const relPaths = [];
    const MAX_DEPTH = 8;

    async function walk(dir, depth) {
      if (depth > MAX_DEPTH) return;
      try {
        const entries = await window.electronAPI?.getFolderFiles?.(dir);
        if (!entries) return;
        for (const entry of entries) {
          const rel = entry.path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
          if (entry.isDirectory) {
            await walk(entry.path, depth + 1);
          } else {
            relPaths.push(rel);
          }
        }
      } catch (_) { /* skip unreadable directories */ }
    }

    try {
      await walk(root, 0);
      return ok(relPaths);
    } catch (e) {
      return err(e?.message || 'getTree failed');
    }
  },

  /**
   * Read the full text of any file inside the open project folder, at
   * any nesting depth. `filePath` may be absolute or relative to the
   * project root. Reads are scoped to the project folder — paths
   * outside it (or containing "..") are refused. Very large files are
   * returned truncated with `truncated: true`.
   */
  async readFile(filePath) {
    if (!filePath) return err('filePath required');
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');

    let target = String(filePath).trim();
    if (target.includes('..')) return err('path must not contain ".."');

    // A bare relative path resolves against the project root.
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\');
    if (!isAbsolute) {
      target = `${root}\\${target.replace(/^[\\/]+/, '')}`;
    }

    // Stay inside the project folder. The trailing-separator check
    // stops a sibling like "MyProject2" matching "MyProject".
    const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const r = norm(root);
    const t = norm(target);
    if (t !== r && !t.startsWith(r + '\\')) {
      return err('file is outside the open project folder');
    }

    // If the file is open in any Monaco pane, return its in-memory content
    // so the AI sees the latest unsaved edits, not the stale on-disk version.
    const liveModel = SharedModelRegistry.getModel(target);
    if (liveModel) {
      const text = liveModel.getValue();
      const MAX = 256 * 1024;
      if (text.length > MAX) {
        return ok({ filePath: target, content: text.slice(0, MAX), length: text.length, truncated: true, fromEditor: true });
      }
      return ok({ filePath: target, content: text, length: text.length, truncated: false, fromEditor: true });
    }

    const MAX = 256 * 1024;
    const readAt = async (abs) => {
      const text = String(await window.electronAPI.readFile(abs) ?? '');
      return text.length > MAX
        ? ok({ filePath: abs, content: text.slice(0, MAX), length: text.length, truncated: true })
        : ok({ filePath: abs, content: text, length: text.length, truncated: false });
    };
    try {
      return await readAt(target);
    } catch (e) {
      // Literal path missed — search the whole project by name / partial path
      // / casing before giving up, so a file in a nested folder still opens.
      const found = await resolveProjectFile(filePath, root);
      if (found && found.toLowerCase() !== target.toLowerCase()) {
        try { return await readAt(found); } catch (_) { /* fall through */ }
      }
      return err(`File not found: "${filePath}" anywhere in the project. Use get_project_tree to list all available paths.`);
    }
  },

  /**
   * Parse a SAPHO assembly (.asm) file and return a structured summary
   * the AI can reason about without re-reading the whole text.
   *
   * Resolution order (one of these must work):
   *   1. explicit `filePath` (absolute, or relative to project root)
   *   2. `processorName`  → <root>/<proc>/Software/<proc>.asm
   *   3. neither          → active editor (must be .asm)
   *
   * The returned shape lets the AI ask "how many instructions are in
   * the loop at @L3?" or "how many floating-point multiplications does
   * this processor do?" in O(1) after one call.
   */
  async analyzeAsm({ filePath, processorName } = {}) {
    const root = window.currentProjectPath || null;
    let target = null;

    if (filePath) {
      target = String(filePath).trim();
    } else if (processorName) {
      if (!root) return err('No project open');
      target = `${root}\\${processorName}\\Software\\${processorName}.asm`;
    } else {
      const active = window.tabManager?.getEditingFilePath?.()
                  || window.TabManager?.getEditingFilePath?.();
      if (!active || !active.toLowerCase().endsWith('.asm')) {
        return err('no filePath/processorName and active file is not .asm');
      }
      target = active;
    }

    if (target.includes('..')) return err('path must not contain ".."');
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\');
    if (!isAbsolute && root) target = `${root}\\${target.replace(/^[\\/]+/, '')}`;

    // Stay inside the project folder — same boundary as readFile.
    if (root) {
      const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
      const r = norm(root);
      const t = norm(target);
      if (t !== r && !t.startsWith(r + '\\')) {
        return err('file is outside the open project folder');
      }
    }

    // Read text (live model wins if the file is open in Monaco — so the
    // analysis tracks unsaved edits, same contract as readFile).
    let text;
    const liveModel = SharedModelRegistry.getModel(target);
    if (liveModel) {
      text = liveModel.getValue();
    } else {
      try { text = String(await window.electronAPI.readFile(target) ?? ''); }
      catch (e) { return err(`File not found: "${target}"`); }
    }

    // Load the opcode table so we recognise mnemonics. Without rules
    // we fall back to a regex-only parser (every uppercase identifier
    // is treated as a mnemonic).
    const rules    = await loadRules();
    const opcodes  = (rules?.asm?.opcodes) || [];
    const mneSet   = new Set(opcodes.map((o) => o.mnemonic));
    const families = new Map(opcodes.map((o) => [o.mnemonic, o.family]));

    /** @type {Record<string, number>} */
    const byOpcode = Object.create(null);
    /** @type {Record<string, number>} */
    const byFamily = Object.create(null);
    /** @type {{name:string,line:number}[]} */
    const labelDefs = [];
    /** @type {{from:number, target:string, mnemonic:string}[]} */
    const branches = [];
    /** @type {string[]} */
    const unknownMnemonics = [];

    const lines = text.split(/\r?\n/);
    let total = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      // Strip block-end comments (`//...`) but keep the body.
      const noComment = raw.replace(/\/\/.*$/, '').trim();
      if (!noComment) continue;
      // Header directives (#PRNAME, #NUBITS, ...) are not instructions.
      if (noComment.startsWith('#')) continue;

      // Pull every leading `@label` (a single .asm line can carry
      // several labels, e.g. `@main @L1 LOD 1`).
      let rest = noComment;
      while (rest.startsWith('@')) {
        const m = /^@([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(rest);
        if (!m) break;
        labelDefs.push({ name: m[1], line: i + 1 });
        rest = m[2];
      }
      if (!rest) continue;

      // First whitespace-separated token after labels = mnemonic.
      const tokens = rest.split(/\s+/);
      const mne = tokens[0];
      if (!mne) continue;
      // Mnemonics are uppercase letters/digits/underscore.
      if (!/^[A-Z][A-Z0-9_]*$/.test(mne)) continue;

      total++;
      byOpcode[mne] = (byOpcode[mne] || 0) + 1;
      const fam = families.get(mne) || 'other';
      byFamily[fam] = (byFamily[fam] || 0) + 1;

      if (!mneSet.has(mne) && unknownMnemonics.indexOf(mne) < 0) {
        unknownMnemonics.push(mne);
      }

      // Branches: JMP/JIZ/CAL take a single label-name operand. Record
      // so we can identify loops below.
      if (mne === 'JMP' || mne === 'JIZ' || mne === 'CAL') {
        const tgt = tokens[1];
        if (tgt && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tgt)) {
          branches.push({ from: i + 1, target: tgt, mnemonic: mne });
        }
      }
    }

    // Loop detection: a branch is a back-edge if its target label was
    // defined on or before the branch's own line (classic JMP-loop).
    // For each loop we estimate body size as branch_line − label_line.
    const labelLine = new Map();
    for (const l of labelDefs) {
      if (!labelLine.has(l.name)) labelLine.set(l.name, l.line);
    }
    const loops = [];
    for (const b of branches) {
      const lineOfLabel = labelLine.get(b.target);
      if (lineOfLabel == null) continue;
      if (lineOfLabel <= b.from) {
        loops.push({
          label:   b.target,
          labelLine: lineOfLabel,
          branchLine: b.from,
          branchMnemonic: b.mnemonic,
          bodyInstructions: Math.max(0, b.from - lineOfLabel),
        });
      }
    }
    loops.sort((a, b) => b.bodyInstructions - a.bodyInstructions);

    return ok({
      filePath: target,
      total,
      byOpcode,
      byFamily,
      labels: labelDefs,
      loops,
      unknownMnemonics,        // warns if .asm has opcodes not in sapho_rules
    });
  },

  /** Create (or overwrite) a file with `content`, then refresh the tree.
   *  .v/.sv/.vh files are auto-registered in synthesizableFiles so they
   *  appear in the file tree immediately without a manual import step. */
  async createFile(filePath, content = '') {
    if (!filePath) return err('filePath required');
    try {
      await window.electronAPI.writeFile(filePath, String(content ?? ''));

      // Magic-wand sweep across the editor when the AI rewrites a file
      // the user has open. We call setActiveText through the underlying
      // model so the editor view reflects the new content AND triggers
      // the purple sweep — without this, the file on disk changed but
      // Monaco still shows the previous buffer until the user re-opens it.
      try {
        const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
        const ed = EditorManager?.activeEditor;
        const model = ed?.getModel?.();
        const uri = model?.uri?.fsPath || model?.uri?.path || '';
        if (model && uri && uri.replace(/\\/g, '/').toLowerCase() === norm) {
          model.setValue(String(content ?? ''));
          magicWandReveal(ed);
        }
      } catch (_) { /* wand is cosmetic — never let it block the write */ }

      // Auto-register Verilog files in the SPF so they show up in the tree.
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      if (['v', 'sv', 'vh'].includes(ext)) {
        const spfPath = window.ProjectStore?.getSpfPath?.();
        if (spfPath && window.SpfStore) {
          const name = filePath.split(/[\\/]/).pop();
          const normPath = filePath.replace(/\\/g, '/').toLowerCase();
          await window.SpfStore.update(spfPath, (cfg) => {
            const synth = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
            const tb   = Array.isArray(cfg.testbenchFiles)     ? cfg.testbenchFiles     : [];
            const alreadyIn =
              synth.some((f) => (f.path || '').replace(/\\/g, '/').toLowerCase() === normPath) ||
              tb.some((f)   => (f.path || '').replace(/\\/g, '/').toLowerCase() === normPath);
            if (!alreadyIn) {
              synth.push({ name, path: filePath, isTopLevel: false });
              cfg.synthesizableFiles = synth;
            }
          });
          // SpfStore.update fires aurora:spf-changed → file tree re-renders.
          return ok({ filePath });
        }
      }

      await refreshTree();
      emit('project:file-created', { filePath });
      return ok({ filePath });
    } catch (e) { return err(e?.message || 'createFile failed'); }
  },

  async createFolder(dirPath) {
    if (!dirPath) return err('dirPath required');
    try {
      await window.electronAPI.mkdir(dirPath);
      await refreshTree();
      return ok({ dirPath });
    } catch (e) { return err(e?.message || 'createFolder failed'); }
  },

  /** Delete a file or directory, then refresh the tree. */
  async deleteFile(filePath) {
    if (!filePath) return err('filePath required');
    try {
      await window.electronAPI.deleteFileOrDirectory(filePath);
      await refreshTree();
      emit('project:file-deleted', { filePath });
      return ok({ filePath });
    } catch (e) { return err(e?.message || 'deleteFile failed'); }
  },

  /** Rename/move a file (copy to the new path, drop the old one). */
  async renameFile(fromPath, toPath) {
    if (!fromPath || !toPath) return err('fromPath and toPath required');
    try {
      await window.electronAPI.copyFile(fromPath, toPath);
      await window.electronAPI.deleteFileOrDirectory(fromPath);
      await refreshTree();
      emit('project:file-renamed', { fromPath, toPath });
      return ok({ fromPath, toPath });
    } catch (e) { return err(e?.message || 'renameFile failed'); }
  },

  /** Processors of the open project (names + per-processor config). */
  async listProcessors() {
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    try {
      const procs = await window.electronAPI.getAvailableProcessors(root);
      return ok(procs || []);
    } catch (e) { return err(e?.message || 'listProcessors failed'); }
  },

  /**
   * The project's MISSING files — paths the .spf still references but that no
   * longer exist on disk (moved, renamed, or deleted outside Aurora). This is
   * the same list the file tree surfaces in its "missing files" warning, kept
   * current by every project load / .spf change / disk-watch refresh. Returns
   * { count, files:[{name, path, category}] }; empty when nothing is missing
   * or no project is open.
   */
  async getMissingFiles() {
    const mgr = window.projectTreeManager;
    const missing = Array.isArray(mgr?.missingFiles) ? mgr.missingFiles : [];
    return ok({
      count: missing.length,
      files: missing.map((f) => ({
        name: f.name,
        path: f.path,
        category: f.category || null,
      })),
    });
  },

  /**
   * Dismiss the missing-files warning by pruning every dangling reference
   * from the .spf (the synthesizable / testbench lists, and the top-level /
   * testbench pointers if they point at a missing file). The on-disk files are
   * already gone — this only cleans up the project's references. No
   * confirmation: the caller (the AI, on the user's explicit request) owns
   * that decision. Returns { removed } — how many references were pruned.
   */
  async dismissMissingFiles() {
    const mgr = window.projectTreeManager;
    if (!mgr || typeof mgr.dismissMissingFiles !== 'function') {
      return err('project tree not available');
    }
    try {
      const removed = await mgr.dismissMissingFiles();
      emit('project:missing-files-dismissed', { removed });
      return ok({ removed });
    } catch (e) {
      return err(e?.message || 'dismissMissingFiles failed');
    }
  },

  /**
   * Generate a processor in the open project.
   * `config`: { processorName, nBits, nbMantissa, nbExponent,
   *             dataStackSize, instructionStackSize, inputPorts,
   *             outputPorts, gain }
   */
  async createProcessor(config) {
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    if (!config || !config.processorName) return err('processorName required');
    const name = config.processorName;
    try {
      // Anti-duplicata pela FILE TREE (a pasta real no disco), nao so o .spf:
      // se a pasta <root>/<name> existe, e um processador REAL ja feito —
      // bloqueia, NAO duplica. Se o nome so consta no .spf mas a pasta sumiu
      // (referencia "morta"/processador morto), deixa criar (revive a entrada).
      const procDir = await window.electronAPI.joinPath(root, name);
      if (await window.electronAPI.pathExists(procDir)) {
        return err(`Processor "${name}" already exists on disk (folder ${name}/). `
          + 'Pick a different name, or delete/rename the existing processor first.');
      }
      // O nome esta no .spf mas sem pasta? Entao a criacao revive uma referencia
      // morta — sinaliza isso na resposta (informa o usuario, sem bloquear).
      let revivedDanglingReference = false;
      try {
        const procs = await window.electronAPI.getAvailableProcessors(root);
        revivedDanglingReference = (Array.isArray(procs) ? procs : [])
          .map((p) => (typeof p === 'string' ? p : p && p.name))
          .some((n) => typeof n === 'string' && n.toLowerCase() === name.toLowerCase());
      } catch (_) { /* lista indisponivel — segue criando normalmente */ }

      const r = await window.electronAPI.createProcessorProject({
        projectLocation: root,
        ...config,
      });
      if (r && r.success) {
        await refreshTree();
        emit('project:processor-created', { name });
        return ok({ name, revivedDanglingReference });
      }
      return err((r && r.message) || 'createProcessor failed');
    } catch (e) { return err(e?.message || 'createProcessor failed'); }
  },

  /**
   * Create a new SAPHO project at `location\name` and open it.
   * `name` must be free of spaces/symbols (project convention).
   */
  async createProject({ name, location } = {}) {
    if (!name || !location) return err('name and location required');
    if (/[^A-Za-z0-9_-]/.test(name)) {
      return err('project name may only contain letters, numbers, _ and -');
    }
    try {
      const projectPath = `${location}\\${name}`;
      const spfPath = `${projectPath}\\${name}.spf`;
      const r = await window.electronAPI.createProjectStructure(projectPath, spfPath, name);
      if (!r || !r.success) return err((r && r.message) || 'createProject failed');
      if (window.projectManager?.loadProject) {
        await window.projectManager.loadProject(spfPath);
      }
      emit('project:created', { name, spfPath });
      return ok({ name, projectPath, spfPath });
    } catch (e) { return err(e?.message || 'createProject failed'); }
  },

  /**
   * Rename the currently open project — both the project root folder and
   * the .spf file, plus every absolute path the .spf stores. The main
   * process does the on-disk move + .spf rewrite (see the `rename-project`
   * IPC); here we save open files, then reopen the project at its new .spf
   * path so the tree, watchers, name label and ProjectStore all re-sync.
   *
   * Processor folders move with the root — a project rename never touches
   * #PRNAME or per-processor names (use rename_processor for those).
   */
  async renameProject({ newName } = {}) {
    const newNm = String(newName || '').trim();
    if (!newNm) return err('newName required');
    if (/[^A-Za-z0-9_-]/.test(newNm)) {
      return err('newName may only contain letters, numbers, _ and -');
    }
    const spfPath = window.ProjectStore?.getSpfPath?.() || window.currentSpfPath || null;
    if (!spfPath) return err('No project open');
    if (typeof window.electronAPI?.renameProject !== 'function') {
      return err('rename-project IPC unavailable');
    }

    // Persist edits and drop tabs — every file under the root is about to
    // move, so no tab (main or split) should keep pointing at a
    // soon-to-be-invalid path.
    try { await TabManager.saveAllFiles(); } catch (_) { /* best-effort */ }
    const sem = window.SplitEditorManager;
    if (sem && Array.isArray(sem.panes) && sem.panes.length) {
      for (const pane of [...sem.panes]) {
        try { sem.closePane(pane.paneIndex); } catch (_) { /* best-effort */ }
      }
    }
    try { await TabManager.closeAllTabs(); } catch (_) { /* best-effort */ }

    let r;
    try { r = await window.electronAPI.renameProject(newNm); }
    catch (e) { return err(e?.message || 'renameProject failed'); }
    if (r && r.success === false) return err(r.error || 'renameProject failed');

    const newSpfPath = r?.newSpfPath || null;
    const newRoot = r?.newRoot || null;

    // The on-disk rename is DONE here. Reopening a large project (chokidar
    // setup + a full tree scan) can take a long time, and doing it inline blew
    // past the AI tool's 120 s timeout — so the model reported failure even
    // though the rename had completed. Point the store at the new .spf
    // synchronously (so any immediate follow-up tool targets the right
    // project), then reopen in the BACKGROUND and return success right away.
    if (newSpfPath && newRoot) {
      try { window.ProjectStore?.setProject?.(newSpfPath, newRoot); } catch (_) { /* best-effort */ }
    }
    // The rename ran decoupled from the AI (no blocking card) — surface a toast
    // so the user sees it landed even when the model triggered it.
    try { window.showNotification?.(`Projeto renomeado para "${newNm}".`, 'success'); } catch (_) { /* best-effort */ }
    if (newSpfPath) {
      Promise.resolve()
        .then(() => (window.projectManager?.loadProject
          ? window.projectManager.loadProject(newSpfPath)
          : window.electronAPI.openProject(newSpfPath)))
        // loadProject re-adds the new .spf to recents; drop the OLD entry from
        // the welcome-screen list (main's recents.json self-prunes the gone path).
        .then(() => { try { window.recentProjectsManager?.removeProject?.(spfPath); } catch (_) { /* best-effort */ } })
        .catch((e) => console.warn('[rename] background reopen failed:', e));
    }

    emit('project:renamed', { oldName: r?.oldName, newName: r?.newName, spfPath: newSpfPath });
    return ok({ oldName: r?.oldName, newName: r?.newName, spfPath: newSpfPath });
  },

  /**
   * Mark a synthesizable Verilog file as the project's Top Level module.
   * Adds the file to synthesizableFiles if not yet tracked. The flag is
   * exclusive — any previous top-level loses the mark automatically.
   * The file tree refreshes via the aurora:spf-changed event.
   */
  async setTopLevel(filePath) {
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    const absPath = isAbs ? filePath : `${root}\\${filePath.replace(/^[\\/]+/, '')}`;
    const norm = (p) => (p || '').replace(/\\/g, '/').toLowerCase();
    const targetKey = norm(absPath);
    const name = absPath.split(/[\\/]/).pop();
    try {
      await window.SpfStore.update(spfPath, (cfg) => {
        // Remove from testbenchFiles if the file was there before; clear
        // testbenchFile pointer if it was pointing to this file.
        const tbArr = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];
        const tbFiltered = tbArr.filter((f) => norm(f.path) !== targetKey);
        if (tbFiltered.length !== tbArr.length) {
          cfg.testbenchFiles = tbFiltered;
          if (norm(cfg.testbenchFile || '') === targetKey) cfg.testbenchFile = '';
        }
        // Add to synthesizableFiles (if not already there) and set as exclusive synth top.
        const arr = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
        let entry = arr.find((f) => norm(f.path) === targetKey);
        if (!entry) { entry = { name, path: absPath, isTopLevel: false }; arr.push(entry); }
        for (const f of arr) f.isTopLevel = (f === entry);
        cfg.synthesizableFiles = arr;
        cfg.topLevelFile = absPath;
      });
      return ok({ filePath: absPath });
    } catch (e) { return err(e?.message || 'setTopLevel failed'); }
  },

  /**
   * Mark a Verilog file as the project's Testbench Top module.
   * Adds the file to testbenchFiles if not yet tracked. The mark is
   * exclusive within testbenchFiles. The file tree refreshes automatically.
   */
  async setTestbenchTop(filePath) {
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    const absPath = isAbs ? filePath : `${root}\\${filePath.replace(/^[\\/]+/, '')}`;
    const norm = (p) => (p || '').replace(/\\/g, '/').toLowerCase();
    const targetKey = norm(absPath);
    const name = absPath.split(/[\\/]/).pop();
    try {
      await window.SpfStore.update(spfPath, (cfg) => {
        // Remove from synthesizableFiles if the file was there before; clear
        // topLevelFile pointer if it was pointing to this file.
        const synthArr = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
        const synthFiltered = synthArr.filter((f) => norm(f.path) !== targetKey);
        if (synthFiltered.length !== synthArr.length) {
          cfg.synthesizableFiles = synthFiltered;
          if (norm(cfg.topLevelFile || '') === targetKey) cfg.topLevelFile = '';
        }
        // Add to testbenchFiles (if not already there) and set as exclusive testbench top.
        const arr = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];
        let entry = arr.find((f) => norm(f.path) === targetKey);
        if (!entry) { entry = { name, path: absPath, isTopLevel: false }; arr.push(entry); }
        for (const f of arr) f.isTopLevel = (f === entry);
        cfg.testbenchFiles = arr;
        cfg.testbenchFile = absPath;
      });
      return ok({ filePath: absPath });
    } catch (e) { return err(e?.message || 'setTestbenchTop failed'); }
  },

  /** Open an existing project by its .spf file. */
  async openProject(spfPath) {
    if (!spfPath) return err('spfPath required');
    try {
      if (window.projectManager?.loadProject) {
        await window.projectManager.loadProject(spfPath);
      } else {
        await window.electronAPI.openProject(spfPath);
      }
      return ok({ spfPath });
    } catch (e) { return err(e?.message || 'openProject failed'); }
  },

  /**
   * Recently-opened projects. Pulls from main's `recents.js` store
   * (prune-on-read, so stale paths whose .spf has been deleted drop
   * out). Returns an array of `{ spfPath, name }` ordered most-recent-first.
   */
  async listRecents() {
    try {
      if (typeof window.electronAPI?.listRecentProjects === 'function') {
        const paths = await window.electronAPI.listRecentProjects();
        const list = (paths || []).map((p) => {
          const base = String(p).split(/[\\/]/).pop() || p;
          const name = base.replace(/\.spf$/i, '');
          return { spfPath: p, name };
        });
        return ok(list);
      }
      // Fallback: the welcome screen also persists recents in localStorage.
      const cached = JSON.parse(localStorage.getItem('aurora-recent-projects') || '[]');
      const list = (Array.isArray(cached) ? cached : []).map((p) => ({
        spfPath: p,
        name: String(p).split(/[\\/]/).pop().replace(/\.spf$/i, ''),
      }));
      return ok(list);
    } catch (e) {
      return err(e?.message || 'listRecents failed');
    }
  },

  /**
   * Create a timestamped backup of the currently open project. Drives
   * the existing `create-backup` IPC (PowerShell Compress-Archive) so
   * the zip ends up in `<projectRoot>/Backup/`. Returns the resolved
   * archive path parsed out of the IPC's success message.
   */
  async backup() {
    const projectRoot = window.currentProjectPath || null;
    if (!projectRoot) return err('No project is open');
    if (typeof window.electronAPI?.createBackup !== 'function') {
      return err('Backup IPC unavailable');
    }
    try {
      const r = await window.electronAPI.createBackup(projectRoot);
      if (!r || r.success === false) {
        return err(r?.message || 'backup failed');
      }
      // The IPC tucks the absolute archive path inside `message`:
      // "Backup created at: <abs path>". Pull it back out so the AI
      // and any UI surface can show it without re-parsing the string.
      const m = String(r.message || '').match(/Backup created at:\s*(.+)$/);
      return ok({ archivePath: m ? m[1] : null, message: r.message || '' });
    } catch (e) {
      return err(e?.message || 'createBackup failed');
    }
  },

  /**
   * Delete a processor from the open project. Drives the existing
   * `delete-processor` IPC which removes the processor's working
   * directory and prunes its SPF entry, then re-broadcasts the
   * processors list to the renderer (`project:processors` event).
   */
  async deleteProcessor(processorName) {
    if (!processorName) return err('processorName required');
    if (typeof window.electronAPI?.deleteProcessor !== 'function') {
      return err('delete-processor IPC unavailable');
    }
    try {
      const r = await window.electronAPI.deleteProcessor(processorName);
      if (r && r.success === false) return err(r.error || 'deleteProcessor failed');
      await refreshTree();
      emit('project:processor-deleted', { processorName });
      return ok({ processorName });
    } catch (e) {
      return err(e?.message || 'deleteProcessor failed');
    }
  },

  /**
   * Rename a processor everywhere it matters: the working directory, the
   * .cmm file, the `#PRNAME` directive, the auto-generated build artifacts
   * and every .spf reference. The main process does the on-disk + .spf work
   * (see the `rename-processor` IPC); here we additionally re-point any open
   * editor tabs that lived under the old folder so the user never ends up
   * staring at a tab whose file just moved.
   *
   * Only SAPHO-internal files are renamed. Custom user toplevels/testbenches
   * at the project root are left untouched — rename those with rename_file.
   */
  async renameProcessor({ processorName, newName } = {}) {
    const oldNm = String(processorName || '').trim();
    const newNm = String(newName || '').trim();
    if (!oldNm) return err('processorName required');
    if (!newNm) return err('newName required');
    if (/[^A-Za-z0-9_-]/.test(newNm)) {
      return err('newName may only contain letters, numbers, _ and -');
    }
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    if (typeof window.electronAPI?.renameProcessor !== 'function') {
      return err('rename-processor IPC unavailable');
    }

    const sep = root.includes('\\') ? '\\' : '/';
    const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const oldDirNorm = norm(`${root}${sep}${oldNm}`);
    const isUnderOld = (p) => {
      const n = norm(p);
      return n === oldDirNorm || n.startsWith(oldDirNorm + '/');
    };

    // Persist unsaved edits in files that are about to move so the rename
    // doesn't strand them on a path that no longer exists.
    try { await TabManager.saveAllFiles(); } catch (_) { /* best-effort */ }

    // Snapshot which open files live under the old processor folder.
    const openResp = await editorNs.getOpenFiles();
    const openUnderOld = (openResp.ok && Array.isArray(openResp.data))
      ? openResp.data.filter(isUnderOld) : [];

    let r;
    try { r = await window.electronAPI.renameProcessor(oldNm, newNm); }
    catch (e) { return err(e?.message || 'renameProcessor failed'); }
    if (r && r.success === false) return err(r.error || 'renameProcessor failed');

    const realOld = r?.oldName || oldNm;
    const realNew = r?.newName || newNm;
    const oldDir = r?.oldDir || `${root}${sep}${realOld}`;
    const newDir = r?.newDir || `${root}${sep}${realNew}`;
    const escOld = realOld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const artifactRe = new RegExp(`([\\\\/])${escOld}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm)$`, 'i');
    const remap = (p) => {
      const np = newDir + p.slice(oldDir.length);
      return np.replace(artifactRe, (_m, slash, tb, ext) => `${slash}${realNew}${tb || ''}${ext}`);
    };

    // Re-point open tabs: the old paths no longer exist on disk.
    let reopenCmm = null;
    for (const oldPath of openUnderOld) {
      if (/\.cmm$/i.test(oldPath)) reopenCmm = remap(oldPath);
      await closeFileEverywhere(oldPath);
    }
    if (reopenCmm) {
      try {
        const content = await window.electronAPI.readFile(reopenCmm);
        TabManager.addTab(reopenCmm, content);
      } catch (_) { /* the .cmm may not exist; leave it */ }
    }

    // The rename released the project's directory watcher so Windows would let
    // the processor folder move. Re-establish it on the (unchanged) project
    // root — main creates a fresh chokidar since releaseWatchersUnder dropped
    // the entry — so file-system changes are detected again, no reopen needed.
    try { await window.electronAPI.watchDirectory?.(window.currentProjectPath); }
    catch (_) { /* best-effort; a project reopen would also restore it */ }

    await refreshTree();
    emit('project:processor-renamed', { oldName: realOld, newName: realNew });
    return ok({ oldName: realOld, newName: realNew });
  },

  /**
   * Import an existing Verilog/cocotb file (.v / .sv / .vh / .py) into the open
   * project: copies it to the project root if it lives elsewhere and
   * registers it in the SPF (synthesizable / testbench list).
   */
  async importFile({ filePath, kind = null } = {}) {
    if (!filePath) return err('filePath required');
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    const projectRoot = window.currentProjectPath || null;
    if (!projectRoot) return err('Project root unavailable');
    const nameHint = filePath.split(/[\\/]/).pop() || '';
    const normalizedKind = kind || (/\.py$/i.test(nameHint) ? 'testbench' : 'synthesizable');
    const targetList = normalizedKind === 'testbench' ? 'testbenchFiles' : 'synthesizableFiles';
    try {
      // Copy into the project if the source lives outside the project root.
      const sep = projectRoot.includes('\\') ? '\\' : '/';
      const normRoot = projectRoot.replace(/\\/g, '/').toLowerCase();
      const normSrc  = filePath.replace(/\\/g, '/').toLowerCase();
      let finalPath = filePath;
      if (!normSrc.startsWith(normRoot + '/')) {
        const base = filePath.split(/[\\/]/).pop();
        finalPath = `${projectRoot}${sep}${base}`;
        await window.electronAPI.copyFile(filePath, finalPath);
      }
      const name = finalPath.split(/[\\/]/).pop();
      const normFinal = finalPath.replace(/\\/g, '/').toLowerCase();
      await window.SpfStore.update(spfPath, (cfg) => {
        const arr = Array.isArray(cfg[targetList]) ? cfg[targetList] : [];
        const already = arr.some((f) => (f.path || '').replace(/\\/g, '/').toLowerCase() === normFinal);
        if (!already) arr.push({ name, path: finalPath, isTopLevel: false });
        cfg[targetList] = arr;
      });
      await refreshTree();
      emit('project:file-imported', { filePath: finalPath, kind: normalizedKind });
      return ok({ filePath: finalPath, kind: normalizedKind });
    } catch (e) {
      return err(e?.message || 'importFile failed');
    }
  },

  /** Remove a file from the SPF lists. Optionally delete it from disk. */
  async removeImportedFile({ filePath, deleteFromDisk = false } = {}) {
    if (!filePath) return err('filePath required');
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    try {
      const norm = filePath.replace(/\\/g, '/').toLowerCase();
      let removed = false;
      await window.SpfStore.update(spfPath, (cfg) => {
        for (const key of ['synthesizableFiles', 'testbenchFiles']) {
          const arr = Array.isArray(cfg[key]) ? cfg[key] : [];
          const filtered = arr.filter((f) => {
            const match = (f.path || '').replace(/\\/g, '/').toLowerCase() === norm;
            if (match) removed = true;
            return !match;
          });
          cfg[key] = filtered;
        }
      });
      if (deleteFromDisk) {
        try { await window.electronAPI.deleteFileOrDirectory(filePath); }
        catch (_) { /* removing from SPF still counts as success */ }
      }
      await refreshTree();
      emit('project:file-removed', { filePath, deletedFromDisk: !!deleteFromDisk });
      return ok({ filePath, removed, deletedFromDisk: !!deleteFromDisk });
    } catch (e) {
      return err(e?.message || 'removeImportedFile failed');
    }
  },

  /** Rename an imported file on disk and update its SPF entry. */
  async renameImportedFile({ fromPath, toPath } = {}) {
    if (!fromPath || !toPath) return err('fromPath and toPath required');
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    try {
      const fromNorm = fromPath.replace(/\\/g, '/').toLowerCase();
      // Copy + delete (matches renameFile above — true rename can fail
      // across drives on Windows).
      await window.electronAPI.copyFile(fromPath, toPath);
      await window.electronAPI.deleteFileOrDirectory(fromPath);
      const newName = toPath.split(/[\\/]/).pop();
      await window.SpfStore.update(spfPath, (cfg) => {
        for (const key of ['synthesizableFiles', 'testbenchFiles']) {
          const arr = Array.isArray(cfg[key]) ? cfg[key] : [];
          for (const f of arr) {
            if ((f.path || '').replace(/\\/g, '/').toLowerCase() === fromNorm) {
              f.path = toPath;
              f.name = newName;
            }
          }
          cfg[key] = arr;
        }
      });
      await refreshTree();
      emit('project:file-renamed', { fromPath, toPath });
      return ok({ fromPath, toPath });
    } catch (e) {
      return err(e?.message || 'renameImportedFile failed');
    }
  },

  /**
   * Read the per-processor simulation config (clk in MHz, numClocks,
   * showArrays). The returned `simTime_us = numClocks / clk` is what
   * Aurora bakes into the testbench's `$finish` line.
   * Omit `processorName` to return the config of every processor.
   */
  async getProcessorConfig(processorName) {
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    try {
      const structure = await window.SpfStore.read(spfPath);
      const procs = Array.isArray(structure.processors) ? structure.processors : [];
      const project = window.currentProjectPath || null;
      const all = await Promise.all(procs.map(async (p) => {
        const name = typeof p === 'string' ? p : p?.name;
        const raw  = (typeof p === 'object' && p) ? p : {};
        const clk       = Number.isFinite(raw.clk)       ? raw.clk       : 100;
        const numClocks = Number.isFinite(raw.numClocks) ? raw.numClocks : 2000;
        const cfg = {
          name,
          clk,
          numClocks,
          showArrays: !!raw.showArrays,
          simTime_us: numClocks > 0 && clk > 0 ? numClocks / clk : null,
        };
        // Also surface the .cmm header directives (NUBITS / NBMANT / NBEXPO …)
        // for the named processor — same enrichment the Verilog flow uses.
        if (project && name) {
          try {
            const cmm = `${project}\\${name}\\Software\\${name}.cmm`;
            const raw2 = await window.electronAPI.readFile(cmm);
            const header = {};
            for (const line of String(raw2 || '').split('\n')) {
              const m = line.match(/^#([A-Z_]+)\s+(.+)/);
              if (m) header[m[1]] = m[2].trim();
            }
            cfg.header = header;
          } catch (_) { /* missing .cmm — fine */ }
        }
        return cfg;
      }));
      if (processorName) {
        const hit = all.find((p) => p.name === processorName);
        return hit ? ok(hit) : err(`unknown processor: ${processorName}`);
      }
      return ok(all);
    } catch (e) { return err(e?.message || 'getProcessorConfig failed'); }
  },

  /**
   * Update the per-processor sim config. Any of `clk` / `numClocks` /
   * `showArrays` may be passed; omitted fields keep their current value.
   * Persisted into `structure.processors[i]` of the .spf via SpfStore.update
   * so the panel and status bar update automatically (aurora:spf-changed).
   */
  async setProcessorConfig({ processorName, clk, numClocks, showArrays } = {}) {
    if (!processorName) return err('processorName required');
    const spfPath = window.ProjectStore?.getSpfPath?.();
    if (!spfPath || !window.SpfStore) return err('No project open');
    const patch = {};
    if (clk !== undefined) {
      const n = Number(clk);
      if (!Number.isFinite(n) || n <= 0) return err('clk must be a positive number (MHz)');
      patch.clk = n;
    }
    if (numClocks !== undefined) {
      const n = Number(numClocks);
      if (!Number.isFinite(n) || n <= 0) return err('numClocks must be a positive integer');
      patch.numClocks = Math.round(n);
    }
    if (showArrays !== undefined) patch.showArrays = !!showArrays;
    if (!Object.keys(patch).length) return err('nothing to update (pass clk, numClocks, or showArrays)');
    let foundProc = false;
    let finalCfg  = null;
    try {
      await window.SpfStore.update(spfPath, (structure) => {
        const procs = Array.isArray(structure.processors) ? structure.processors : [];
        structure.processors = procs.map((p) => {
          const name = typeof p === 'string' ? p : p?.name;
          if (name !== processorName) {
            return typeof p === 'string' ? { name: p } : p;
          }
          foundProc = true;
          const prev = typeof p === 'object' && p ? p : { name };
          const next = { ...prev, name, ...patch };
          finalCfg = {
            name,
            clk: Number.isFinite(next.clk) ? next.clk : 100,
            numClocks: Number.isFinite(next.numClocks) ? next.numClocks : 2000,
            showArrays: !!next.showArrays,
          };
          finalCfg.simTime_us = finalCfg.numClocks / finalCfg.clk;
          return next;
        });
      });
      if (!foundProc) return err(`processor not in this project: ${processorName}`);
      // Refresh the panel popover so any open UI reflects the change.
      processorConfigPanel.refresh();
      emit('project:processor-config-changed', { processorName, ...patch });
      return ok(finalCfg);
    } catch (e) { return err(e?.message || 'setProcessorConfig failed'); }
  },

  /**
   * Force a fresh repaint of the project file tree. Useful after the
   * model creates/imports a file via tools that the regular SPF events
   * didn't reach (or when the tree is suspected of being stale).
   */
  async refreshTree() {
    try {
      // Two-pronged: the main-process file watcher refresh AND the
      // renderer's ProjectTreeManager reload. Either alone covers the
      // most-common race, both together cover all of them.
      await window.electronAPI?.triggerFileTreeRefresh?.();
    } catch (_) { /* best-effort */ }
    try {
      await window.projectTreeManager?.refreshTree?.();
    } catch (e) {
      return err(e?.message || 'refreshTree failed');
    }
    emit('project:tree-refreshed', null);
    return ok();
  },

  /**
   * Switch the left panel between the file tree and the post-synthesis
   * hierarchy tree. The hierarchy view is only available after a
   * successful Verilog compilation (hierarchyData is populated by the
   * compile flow); calling setView('hierarchy') before then returns an
   * error telling the model what to do.
   */
  async setView(mode) {
    const ctl = window.fileTreeViewController;
    if (!ctl) return err('file tree controller not initialised');
    if (mode === 'file' || mode === 'verilog' || mode === 'files') {
      ctl.showFileMode();
      return ok({ view: ctl.getActiveView?.() || 'verilog' });
    }
    if (mode === 'hierarchy' || mode === 'hierarchical') {
      if (!ctl.getHierarchyData?.()) {
        return err('hierarchy view is only available after a successful Verilog compilation — call compile_step("verilog") first');
      }
      const okSwitch = ctl.showHierarchyMode();
      return okSwitch ? ok({ view: 'hierarchy' }) : err('could not switch to hierarchy view');
    }
    return err(`unknown view: ${mode} — use "file" or "hierarchy"`);
  },

  /** Report which tree view is currently active. */
  async getView() {
    const ctl = window.fileTreeViewController;
    if (!ctl) return ok({ view: 'unknown', hierarchyAvailable: false });
    return ok({
      view: ctl.getActiveView?.() || 'verilog',
      hierarchyAvailable: !!ctl.getHierarchyData?.(),
    });
  },
};

/* ============================================================
 *  compile — pipeline triggers (the same ones the toolbar uses)
 * ========================================================== */

const compileNs = {
  /** Run the full project pipeline (cmm → verilog → wave → prism). */
  async compileAll() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    emit('compile:started', { scope: 'all' });
    try { await cf.runAll(); return ok(); }
    catch (e) { return err(e?.message || 'compileAll failed'); }
  },

  /**
   * Run a single pipeline step.
   *   - 'cmm'   : cmmcomp + asmcomp (regenerates .asm from .cmm)
   *   - 'asm'   : asmcomp + iverilog + vvp (SKIPS cmmcomp — used by Aurora
   *               Intelligence to test a hand-optimised .asm without losing it)
   *   - 'verilog'/'wave'/'prism'/'verilator-proc': existing
   *   - 'verilator-fast': Verilator headless run (no waveform), Verilator-only
   */
  async compileStep(step) {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    if (!['cmm', 'asm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast'].includes(step)) {
      return err(`unknown compile step: ${step}`);
    }
    emit('compile:started', { scope: step });
    try { await cf.runSingleStep(step); return ok({ step }); }
    catch (e) { return err(e?.message || 'compileStep failed'); }
  },

  /**
   * Run the ACTIVE SAPHO processor's generated top-level (`<proc>.v`) under
   * Verilator as a hardware test — the `verilatorproc` toolbar button. Drives
   * SAPHO's predictable wiring (req_in/out_en one-hot, decimal
   * input_<N>.txt/output_<N>.txt under the processor's Simulation/ folder) and
   * recompiles cmm+asm first so the .v/_tb.v/.mif are fresh. Acts on the
   * processor currently shown in the status bar — fails if none is active.
   * Thin wrapper over compileStep('verilator-proc') so validation + the
   * compile:started event stay single-sourced. Calls through `compileNs`
   * (not `this`): the AI tool_runner invokes namespace methods as bare
   * `fn(...args)`, so `this` is undefined inside them.
   */
  async runVerilatorProc() {
    return compileNs.compileStep('verilator-proc');
  },

  /**
   * Run the project's testbench headless via Verilator — NO waveform, NO
   * GTKWave — the `fastsim` toolbar button, optimised purely for speed.
   * Needs a testbench set; a Verilog testbench requires the simulator to be
   * Verilator (see wave.setSimulator), while a Python cocotb (.py) testbench
   * runs headless on any engine. Recompiles cmm+asm first when the top-level
   * instantiates SAPHO processors. Thin wrapper over
   * compileStep('verilator-fast'). Calls through `compileNs` (not `this`):
   * the AI tool_runner invokes namespace methods as bare `fn(...args)`.
   */
  async runFastSim() {
    return compileNs.compileStep('verilator-fast');
  },

  async cancel() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    try { cf.cancelAll(); emit('compile:cancelled', null); return ok(); }
    catch (e) { return err(e?.message || 'cancel failed'); }
  },

  // -----------------------------------------------------------------
  // Aurora-Intelligence-driven command overrides. Each toolchain step
  // (cmm, asm, iverilog-check, iverilog-build, vvp-run,
  // verilator-build/run, fst2vcd, gtkwave, yosys-hierarchy,
  // prism-yosys) can have an override that appends/prepends/removes
  // args and tweaks env. See command_overrides.js + protected_flags.js.
  // -----------------------------------------------------------------

  /** Enumerate every step the override system knows about. */
  async listSteps() {
    try {
      const { STEP_IDS, STEP_DESCRIPTIONS } = await import('../compilation/command_spec.js');
      return ok({ steps: STEP_IDS.map((id) => ({ id, description: STEP_DESCRIPTIONS[id] })) });
    } catch (e) { return err(e?.message || 'listSteps failed'); }
  },

  /**
   * Build the base spec for `step` AND apply any active override.
   * Returns { base, applied, formatted, formattedBase, diff, sources }.
   */
  async inspectCommand(step, processorName) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const { resolveSpec } = await import('../compilation/spec_runner.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
        sources: resolved.sources,
        hasOverride: !!resolved.override,
      });
    } catch (e) { return err(e?.message || 'inspectCommand failed'); }
  },

  /**
   * Preview a spec with `extraOverride` layered ON TOP of the active
   * override, WITHOUT registering it. Lets the AI show the user
   * "here's what would happen if I added these flags".
   */
  async previewCommand(step, override, processorName) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const { resolveSpec } = await import('../compilation/spec_runner.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base, override || null);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
      });
    } catch (e) { return err(e?.message || 'previewCommand failed'); }
  },

  /** List every registered override across both layers. */
  async listOverrides() {
    try {
      const { listOverrides } = await import('../compilation/command_overrides.js');
      const items = await listOverrides();
      return ok({ overrides: items });
    } catch (e) { return err(e?.message || 'listOverrides failed'); }
  },

  /**
   * Register an override. `persist:true` writes to .spf (survives
   * sessions); default is ephemeral (consumed on the next matching
   * step run).
   *
   * Shape: { step, processorName?, appendArgs?, prependArgs?, removeArgs?,
   *          envSet?, envUnset?, persist?, note? }
   */
  async setOverride(payload) {
    try {
      const { setOverride } = await import('../compilation/command_overrides.js');
      const { step, processorName, persist, note, ...rest } = payload || {};
      const result = await setOverride({
        step, processorName, override: rest, persist: !!persist, note,
      });
      emit('compile:override-set', { step, processorName, persist: !!persist });
      return ok(result);
    } catch (e) { return err(e?.message || 'setOverride failed'); }
  },

  async clearOverride(step, processorName, scope) {
    try {
      const { clearOverride } = await import('../compilation/command_overrides.js');
      const result = await clearOverride({ step, processorName, scope: scope || 'both' });
      emit('compile:override-cleared', { step, processorName });
      return ok(result);
    } catch (e) { return err(e?.message || 'clearOverride failed'); }
  },

  /** Per-step list of flags the override system refuses to touch. */
  async listProtectedFlags(step) {
    try {
      const result = await window.electronAPI.getProtectedFlags(step);
      return ok({ step: step || null, protected: result });
    } catch (e) { return err(e?.message || 'listProtectedFlags failed'); }
  },

  /** Read-only: which binaries the main-process executor will spawn. */
  async listAllowedBinaries() {
    try {
      const result = await window.electronAPI.listAllowedBinaries();
      return ok({ binaries: result });
    } catch (e) { return err(e?.message || 'listAllowedBinaries failed'); }
  },
};

/* ============================================================
 *  wave — GTKWave signal selection (the Wave Configuration modal)
 * ========================================================== */

function collectWaveSignalPaths(node, out) {
  if (!node) return;
  for (const sig of (node.signals || [])) {
    out.push(`${node.scopePath}.${sig.name}`);
  }
  for (const child of (node.children || [])) collectWaveSignalPaths(child, out);
}

const waveNs = {
  /**
   * Every signal discovered for the current testbench, plus which are
   * currently ticked to be dumped into GTKWave.
   */
  async listSignals() {
    const wc = window.waveConfigManager;
    if (!wc) return err('Wave Configuration is not available');
    if (!wc.tree) { try { await wc.refresh(); } catch (_) { /* handled below */ } }
    if (!wc.tree) return ok({ all: [], selected: [] });
    const all = [];
    collectWaveSignalPaths(wc.tree, all);
    return ok({ all: all.sort(), selected: [...(wc.selected || [])].sort() });
  },

  /**
   * Replace the GTKWave signal selection with exactly `paths` and
   * persist it — the same effect as ticking boxes in the Wave
   * Configuration modal and pressing Save. Paths not present in the
   * discovered signal tree are ignored (returned under `ignored`).
   */
  async setSignals(paths) {
    const wc = window.waveConfigManager;
    if (!wc) return err('Wave Configuration is not available');
    if (!wc.tree) {
      try { await wc.refresh(); }
      catch (e) { return err(e?.message || 'could not load signals'); }
    }
    if (!wc.tree) return err('no signals discovered — open a project with a testbench');
    const valid = [];
    collectWaveSignalPaths(wc.tree, valid);
    const validSet = new Set(valid);
    const list = Array.isArray(paths) ? paths : [];
    const selected = list.filter((p) => validSet.has(p));
    const ignored = list.filter((p) => !validSet.has(p));
    wc.selected = new Set(selected);
    if (typeof wc.renderTree === 'function') wc.renderTree();
    if (typeof wc.save === 'function') await wc.save();
    emit('wave:signals-changed', { selected });
    return ok({ selected: selected.sort(), ignored });
  },

  /** Open the Wave Configuration modal for the user. */
  async openConfig() {
    const wc = window.waveConfigManager;
    if (!wc) return err('Wave Configuration is not available');
    try { await wc.open(); return ok(); }
    catch (e) { return err(e?.message || 'could not open Wave Configuration'); }
  },

  /**
   * Read which Verilog simulator the Wave button runs. One of:
   *   - 'iverilog'  — vvp/iverilog (bundled, default). Preserves every
   *                   internal SAPHO signal, slower on long testbenches.
   *   - 'verilator' — Verilator (bundled, opt-in). Transpiles to C++ and
   *                   builds a native .exe — 5–10× faster on long runs,
   *                   but aggressively elides internal SAPHO signals
   *                   (only top-level testbench signals are visible).
   * The choice persists per-user (localStorage `aurora.waveSimulator`).
   */
  async getSimulator() {
    return ok({ simulator: getWaveSimulator() });
  },

  /**
   * Choose which simulator the Wave button runs. Accepts 'iverilog' or
   * 'verilator'; any other value is normalized to 'iverilog'. Persisted
   * across app restarts. Re-running Wave after this picks up the new
   * choice without further action.
   */
  async setSimulator({ simulator } = {}) {
    if (simulator !== 'iverilog' && simulator !== 'verilator') {
      return err('simulator must be "iverilog" or "verilator"');
    }
    const applied = setWaveSimulator(simulator);
    emit('wave:simulator-changed', { simulator: applied });
    // Nudge the toolbar simulator toggle (and any other DOM listener) so
    // its icon/tooltip refresh to the new choice without further action.
    try {
      window.dispatchEvent(new CustomEvent('aurora:wave-simulator-changed', { detail: { simulator: applied } }));
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ simulator: applied });
  },

  /**
   * Which waveform viewer the Wave button opens. 'gtkwave' = the bundled
   * GTKWave (external window, the default); 'surfer' = the embedded Surfer
   * viewer (waves inside the IDE). Persists per-user (localStorage
   * `aurora.waveViewer`).
   */
  async getViewer() {
    return ok({ viewer: getWaveViewer() });
  },

  /**
   * Choose which waveform viewer the Wave button opens. Accepts 'gtkwave'
   * or 'surfer'; any other value is normalized to 'gtkwave'. Persisted
   * across app restarts. Re-running Wave after this picks up the new
   * choice without further action.
   */
  async setViewer({ viewer } = {}) {
    if (viewer !== 'gtkwave' && viewer !== 'surfer') {
      return err('viewer must be "gtkwave" or "surfer"');
    }
    const applied = setWaveViewer(viewer);
    emit('wave:viewer-changed', { viewer: applied });
    // Nudge the toolbar viewer toggle (and any other DOM listener) so its
    // highlight/tooltip refresh to the new choice without further action.
    try {
      window.dispatchEvent(new CustomEvent('aurora:wave-viewer-changed', { detail: { viewer: applied } }));
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ viewer: applied });
  },

  /**
   * Whether the Surfer viewer keeps multiple windows open. false (default) =
   * one window (AURORA closes the previous Surfer before each launch); true =
   * keep windows open so you can compare different simulation runs side by
   * side. Persists per-user (localStorage `aurora.surferMultiWindow`).
   * Surfer-only — GTKWave has its own window lifecycle.
   */
  async getSurferMultiWindow() {
    return ok({ multiWindow: getSurferMultiWindow() });
  },

  /**
   * Enable/disable multiple Surfer windows. Accepts a boolean `enabled`.
   * true = keep windows open to compare runs; false = single window (the
   * default; the previous window is closed on each Wave). Persisted across
   * restarts; the next Wave picks it up. Mirrors the checkbox in the Wave
   * Configuration modal.
   */
  async setSurferMultiWindow({ enabled } = {}) {
    if (typeof enabled !== 'boolean') {
      return err('enabled must be a boolean (true = multiple windows, false = single)');
    }
    const applied = setSurferMultiWindow(enabled);
    // Sync the modal checkbox if it's currently in the DOM.
    try {
      const cb = document.getElementById('waveConfigSurferMultiWindow');
      if (cb) cb.checked = applied;
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ multiWindow: applied });
  },

  /**
   * List every .gtkw file currently registered for the active testbench
   * (one list per tb). Includes the active flag and absolute paths.
   */
  async listGtkwFiles() {
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set — mark a testbench top first');
    const ws = await window.WaveStore?.read(projectPath, tbKey);
    const files = Array.isArray(ws?.gtkwFiles) ? ws.gtkwFiles : [];
    return ok({
      testbench: tbKey,
      files: files.map((f) => ({
        name: f?.name || (f?.path || '').split(/[\\/]/).pop(),
        path: f?.path || '',
        isActive: !!f?.isActive,
      })),
    });
  },

  /**
   * Find every .gtkw save file inside the open project folder, optionally
   * filtered by a name fragment. The user only has to say the file's name —
   * this resolves the absolute path for them (and for the AI). Returns each
   * match with both project-relative and absolute paths.
   */
  async findGtkwFiles(query = '') {
    const root = window.currentProjectPath || window.ProjectStore?.getProjectPath?.() || null;
    if (!root) return err('No project open');
    const treeRes = await projectNs.getTree(root);
    if (!treeRes.ok) return treeRes;
    const rel = Array.isArray(treeRes.data) ? treeRes.data : [];
    const needle = String(query || '').trim().toLowerCase().replace(/\.gtkw$/i, '');
    const files = rel
      .filter((p) => /\.gtkw$/i.test(p))
      .filter((p) => !needle || p.toLowerCase().includes(needle))
      .map((p) => ({
        name: p.split('/').pop(),
        relPath: p,
        path: `${root}\\${p.replace(/\//g, '\\')}`,
      }));
    return ok({ query: query || null, count: files.length, files });
  },

  /**
   * One-shot: the user names a .gtkw (with or without the extension, or a
   * path fragment) and Aurora locates it in the project, registers it for the
   * active testbench, and marks it active — so the next Wave run loads it.
   * If the name is ambiguous (several .gtkw match) the candidates are reported
   * instead of guessing.
   */
  async useGtkwByName(name) {
    const q = String(name || '').trim();
    if (!q) return err('name required (the .gtkw file name)');
    const found = await waveNs.findGtkwFiles(q);
    if (!found.ok) return found;
    const files = found.data.files || [];
    if (!files.length) return err(`no .gtkw matching "${q}" found in the project`);
    // Prefer an exact basename match (e.g. "foo" or "foo.gtkw" → foo.gtkw).
    const wanted = q.toLowerCase().replace(/\.gtkw$/i, '');
    const exact = files.filter((f) => f.name.toLowerCase().replace(/\.gtkw$/i, '') === wanted);
    const pick = exact.length ? exact : files;
    if (pick.length > 1) {
      const names = pick.map((f) => f.relPath).join(', ');
      return err(`"${q}" matches ${pick.length} .gtkw files (${names}). Re-run with a more specific name, or add the exact path.`, 'AMBIGUOUS');
    }
    const target = pick[0];
    const reg = await waveNs.addGtkwFile({ filePath: target.path, setActive: true });
    if (!reg.ok) return reg;
    return ok({ name: target.name, path: target.path, relPath: target.relPath, active: true });
  },

  /**
   * Register a .gtkw file from anywhere in the project tree as available
   * for the active testbench. The file must exist on disk and end in
   * .gtkw. If `setActive:true` (default) it is also marked active.
   */
  async addGtkwFile({ filePath, setActive = true } = {}) {
    if (!filePath) return err('filePath required');
    if (!/\.gtkw$/i.test(filePath)) return err('only .gtkw files are accepted');
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set — mark a testbench top first');
    // Resolve to an absolute path inside the project; verify the file exists.
    const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    const abs = isAbs ? filePath : `${projectPath}\\${filePath.replace(/^[\\/]+/, '')}`;
    try {
      const exists = await window.electronAPI.fileExists(abs);
      if (!exists) return err(`file not found: ${abs}`);
    } catch (e) { return err(e?.message || 'fileExists failed'); }
    const name = abs.split(/[\\/]/).pop();
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.gtkwFiles) ? state.gtkwFiles : [];
        let existing = files.find((f) => f?.path === abs);
        if (!existing) {
          existing = { name, path: abs, isActive: false };
          files.push(existing);
        }
        if (setActive) {
          for (const f of files) f.isActive = (f === existing);
        }
        state.gtkwFiles = files;
      });
    } catch (e) { return err(e?.message || 'addGtkwFile failed'); }
    window.gtkwPickerManager?.refresh?.();
    return ok({ path: abs, isActive: !!setActive });
  },

  /**
   * Mark one of the registered .gtkw files as active (the one that
   * GTKWave will open). Pass `null` / no path to revert to the default
   * (Aurora auto-generates a layout).
   */
  async setActiveGtkwFile(filePath) {
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set');
    let foundEntry = !filePath;
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.gtkwFiles) ? state.gtkwFiles : [];
        for (const f of files) {
          const match = filePath && f?.path === filePath;
          if (match) foundEntry = true;
          f.isActive = !!match;
        }
        state.gtkwFiles = files;
      });
    } catch (e) { return err(e?.message || 'setActiveGtkwFile failed'); }
    if (filePath && !foundEntry) return err(`.gtkw not registered — call add_gtkw_file first: ${filePath}`);
    window.gtkwPickerManager?.refresh?.();
    return ok({ active: filePath || null });
  },

  /** Drop one .gtkw entry from the active testbench's list. */
  async removeGtkwFile(filePath) {
    if (!filePath) return err('filePath required');
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set');
    let removed = 0;
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.gtkwFiles) ? state.gtkwFiles : [];
        const before = files.length;
        state.gtkwFiles = files.filter((f) => f?.path !== filePath);
        removed = before - state.gtkwFiles.length;
      });
    } catch (e) { return err(e?.message || 'removeGtkwFile failed'); }
    if (!removed) return err(`.gtkw not in list: ${filePath}`);
    window.gtkwPickerManager?.refresh?.();
    return ok({ removed });
  },

  // ---- Surfer layout files (mirror of the .gtkw handlers, viewer 'surfer') ----
  // Surfer loads either a .surf.ron saved state (launched with -s) or a .sucl
  // command file (launched with -c) the same way GTKWave loads a .gtkw. Same
  // per-testbench list shape, stored separately in WaveStore.surferFiles so the
  // two viewers never cross-contaminate. The toolbar picker is viewer-aware and
  // shows whichever list matches the active viewer.

  /** List every Surfer layout (.surf.ron/.sucl) registered for the active testbench. */
  async listSurferFiles() {
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set — mark a testbench top first');
    const ws = await window.WaveStore?.read(projectPath, tbKey);
    const files = Array.isArray(ws?.surferFiles) ? ws.surferFiles : [];
    return ok({
      testbench: tbKey,
      files: files.map((f) => ({
        name: f?.name || (f?.path || '').split(/[\\/]/).pop(),
        path: f?.path || '',
        isActive: !!f?.isActive,
      })),
    });
  },

  /** Find every Surfer layout file (.surf.ron/.sucl) in the project, optional name filter. */
  async findSurferFiles(query = '') {
    const root = window.currentProjectPath || window.ProjectStore?.getProjectPath?.() || null;
    if (!root) return err('No project open');
    const treeRes = await projectNs.getTree(root);
    if (!treeRes.ok) return treeRes;
    const rel = Array.isArray(treeRes.data) ? treeRes.data : [];
    const needle = String(query || '').trim().toLowerCase().replace(/(\.surf\.ron|\.ron|\.sucl)$/i, '');
    const files = rel
      .filter((p) => /(\.ron|\.sucl)$/i.test(p))
      .filter((p) => !needle || p.toLowerCase().includes(needle))
      .map((p) => ({
        name: p.split('/').pop(),
        relPath: p,
        path: `${root}\\${p.replace(/\//g, '\\')}`,
      }));
    return ok({ query: query || null, count: files.length, files });
  },

  /** One-shot: name a Surfer layout → locate, register, activate for the active tb. */
  async useSurferByName(name) {
    const q = String(name || '').trim();
    if (!q) return err('name required (the Surfer layout file name)');
    const found = await waveNs.findSurferFiles(q);
    if (!found.ok) return found;
    const files = found.data.files || [];
    if (!files.length) return err(`no Surfer layout (.surf.ron/.sucl) matching "${q}" found in the project`);
    const wanted = q.toLowerCase().replace(/(\.surf\.ron|\.ron|\.sucl)$/i, '');
    const exact = files.filter((f) => f.name.toLowerCase().replace(/(\.surf\.ron|\.ron|\.sucl)$/i, '') === wanted);
    const pick = exact.length ? exact : files;
    if (pick.length > 1) {
      const names = pick.map((f) => f.relPath).join(', ');
      return err(`"${q}" matches ${pick.length} Surfer layouts (${names}). Re-run with a more specific name.`, 'AMBIGUOUS');
    }
    const target = pick[0];
    const reg = await waveNs.addSurferFile({ filePath: target.path, setActive: true });
    if (!reg.ok) return reg;
    return ok({ name: target.name, path: target.path, relPath: target.relPath, active: true });
  },

  /** Register a Surfer layout (.surf.ron/.sucl) for the active testbench. */
  async addSurferFile({ filePath, setActive = true } = {}) {
    if (!filePath) return err('filePath required');
    if (!/(\.ron|\.sucl)$/i.test(filePath)) return err('only .surf.ron / .sucl files are accepted');
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set — mark a testbench top first');
    const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    const abs = isAbs ? filePath : `${projectPath}\\${filePath.replace(/^[\\/]+/, '')}`;
    try {
      const exists = await window.electronAPI.fileExists(abs);
      if (!exists) return err(`file not found: ${abs}`);
    } catch (e) { return err(e?.message || 'fileExists failed'); }
    const name = abs.split(/[\\/]/).pop();
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.surferFiles) ? state.surferFiles : [];
        let existing = files.find((f) => f?.path === abs);
        if (!existing) {
          existing = { name, path: abs, isActive: false };
          files.push(existing);
        }
        if (setActive) {
          for (const f of files) f.isActive = (f === existing);
        }
        state.surferFiles = files;
      });
    } catch (e) { return err(e?.message || 'addSurferFile failed'); }
    window.gtkwPickerManager?.refresh?.();
    return ok({ path: abs, isActive: !!setActive });
  },

  /** Mark one registered Surfer layout active (or null to clear → raw VCD). */
  async setActiveSurferFile(filePath) {
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set');
    let foundEntry = !filePath;
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.surferFiles) ? state.surferFiles : [];
        for (const f of files) {
          const match = filePath && f?.path === filePath;
          if (match) foundEntry = true;
          f.isActive = !!match;
        }
        state.surferFiles = files;
      });
    } catch (e) { return err(e?.message || 'setActiveSurferFile failed'); }
    if (filePath && !foundEntry) return err(`Surfer layout not registered — call add_surfer_file first: ${filePath}`);
    window.gtkwPickerManager?.refresh?.();
    return ok({ active: filePath || null });
  },

  /** Drop one Surfer layout entry from the active testbench's list. */
  async removeSurferFile(filePath) {
    if (!filePath) return err('filePath required');
    const projectPath = window.ProjectStore?.getProjectPath?.();
    const spfPath     = window.ProjectStore?.getSpfPath?.();
    if (!projectPath || !spfPath) return err('No project open');
    const cfg = await window.SpfStore.read(spfPath);
    const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (!tbKey) return err('No testbench top set');
    let removed = 0;
    try {
      await window.WaveStore.update(projectPath, tbKey, (state) => {
        const files = Array.isArray(state.surferFiles) ? state.surferFiles : [];
        const before = files.length;
        state.surferFiles = files.filter((f) => f?.path !== filePath);
        removed = before - state.surferFiles.length;
      });
    } catch (e) { return err(e?.message || 'removeSurferFile failed'); }
    if (!removed) return err(`Surfer layout not in list: ${filePath}`);
    window.gtkwPickerManager?.refresh?.();
    return ok({ removed });
  },
};

/* ============================================================
 *  rules — static yanc knowledge base
 *
 *  `resources/sapho_rules.json` is regenerated by
 *  `scripts/sync-sapho-rules.js` whenever the yanc source tree
 *  changes (see the script header for the why). The file is bundled
 *  with the installer, so the AI never depends on yanc being
 *  present on the user's machine.
 *
 *  Loaded lazily on first access — boot time stays unaffected if
 *  Aurora Intelligence is never opened.
 * ========================================================== */

let rulesPromise = null;
function loadRules() {
  if (!rulesPromise) {
    rulesPromise = fetch('./resources/sapho_rules.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return rulesPromise;
}

const rulesNs = {
  /** Full rules document. `null` if the file is missing. */
  async get() {
    return ok(await loadRules());
  },

  /** Look up a single hardware directive (case-insensitive: 'NBMANT'/'nbmant'). */
  async getDirective(name) {
    const rules = await loadRules();
    if (!rules?.directives) return err('rules not available');
    const key = String(name || '').replace(/^#/, '').toUpperCase();
    const hit = rules.directives[key];
    return hit ? ok(hit) : err(`unknown directive: ${name}`);
  },

  /** Names of all known hardware directives (e.g. ['NBMANT', 'NBEXPO', ...]). */
  async listDirectives() {
    const rules = await loadRules();
    return ok(rules?.directives ? Object.keys(rules.directives) : []);
  },

  /** Reserved language keywords (if/else/while/...). */
  async getKeywords() {
    const rules = await loadRules();
    return ok(rules?.language?.keywords ?? []);
  },

  /**
   * Look up a compiler message by its `MSG_*` code. Returns the
   * bilingual entry `{ code, severity, category, pt, en }`.
   */
  async lookupMessage(code) {
    const rules = await loadRules();
    const msg = rules?.messages?.find((m) => m.code === code);
    return msg ? ok(msg) : err(`unknown message code: ${code}`);
  },

  /**
   * Enumerate every SAPHO assembly opcode known to yanc, grouped by
   * family. Useful when the AI needs the full ISA at once (e.g. to
   * reason about which opcode pair would shrink a loop). Each entry
   * carries the numeric opcode, operand kind, family label, and the
   * one-line description scraped from ASMComp.l.
   */
  async listOpcodes() {
    const rules = await loadRules();
    return ok(rules?.asm?.opcodes ?? []);
  },

  /** Look up one opcode by mnemonic (case-insensitive). */
  async getOpcode(mnemonic) {
    const rules = await loadRules();
    if (!rules?.asm?.opcodes) return err('opcode table not available');
    const key = String(mnemonic || '').toUpperCase();
    const hit = rules.asm.opcodes.find((o) => o.mnemonic === key);
    return hit ? ok(hit) : err(`unknown opcode: ${mnemonic}`);
  },
};

/* ============================================================
 *  ui — notifications, modals, locale
 * ========================================================== */

const uiNs = {
  /** Pop a toast using the existing notification system. */
  async showNotification(message, type = 'info', duration = 5000, title) {
    if (typeof window.showNotification !== 'function') {
      return err('notification system not available');
    }
    window.showNotification(String(message ?? ''), type, duration, title);
    return ok();
  },

  /** Open the Settings modal (same effect as clicking the toolbar gear). */
  async openSettings() {
    const btn = document.getElementById('aurora-settings');
    if (!btn) return err('settings button not found');
    btn.click();
    return ok();
  },

  async getLocale() {
    return ok(window.getLocale ? window.getLocale() : null);
  },

  async setLocale(locale) {
    if (typeof window.setLocale !== 'function') return err('i18n not loaded');
    try { await window.setLocale(locale); return ok({ locale }); }
    catch (e) { return err(e?.message || 'setLocale failed'); }
  },

  /**
   * Pause the AI turn and show an inline question card in the chat
   * panel. The card lets the user pick from {options}, optionally
   * multi-select, and (always) write a free-form "Other" answer.
   *
   * Resolves with `{ answer: <text>, selected: [<labels>] }` once the
   * user submits. The promise also resolves if the AI turn aborts.
   *
   * @param {object} params
   * @param {string} params.question
   * @param {Array<{label:string, description?:string}>} [params.options]
   * @param {boolean} [params.multiSelect]
   */
  async askUserQuestion({ question, options = [], multiSelect = false } = {}) {
    if (!question || typeof question !== 'string') return err('question required');
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.showAskUserQuestionInline !== 'function') {
      return err('AI panel is not available');
    }
    const result = await mgr.showAskUserQuestionInline({
      question, options: Array.isArray(options) ? options : [], multiSelect: !!multiSelect,
    });
    if (result == null) return err('user dismissed the question');
    return ok(result);
  },
};

/* ============================================================
 *  ai — drive the Aurora Intelligence chat panel
 * ========================================================== */

const aiNs = {
  /** Open the AI assistant panel (idempotent). */
  async open() {
    const mgr = window.aiAssistantManager;
    if (!mgr) return err('AI panel is not available');
    mgr.ensureOpen();
    return ok();
  },

  /**
   * Open the panel and seed the composer with a code snippet the user
   * selected in the editor — the backing call for the Monaco selection
   * "star" widget. With a concrete `intent` and `send:true` the message is
   * dispatched immediately; otherwise the composer is just pre-filled.
   *
   * @param {object} p
   * @param {string} p.code        the selected source text (required)
   * @param {string} [p.language]  monaco language id (verilog, cmm, python…)
   * @param {string} [p.filePath]  absolute path of the file
   * @param {number} [p.lineStart] 1-based first selected line
   * @param {number} [p.lineEnd]   1-based last selected line
   * @param {string} [p.intent]    'explain'|'fix'|'improve'|'comment'|'doc'|''
   * @param {boolean}[p.send]      send immediately (only with an intent)
   */
  async askAboutSelection(p = {}) {
    if (!p || !String(p.code || '').trim()) return err('code (a non-empty selection) required');
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.askAboutSelection !== 'function') {
      return err('AI panel is not available');
    }
    try {
      mgr.askAboutSelection(p);
      return ok();
    } catch (e) {
      return err(e?.message || 'askAboutSelection failed');
    }
  },

  /**
   * Start a long task in the background and return IMMEDIATELY so the current
   * turn can end. When the task finishes, the assistant auto-continues the
   * conversation with the result — i.e. it runs the work "under the hood",
   * lets the chat finish, then posts a follow-up message on its own.
   *
   * @param {{task:'compile_all'|'compile_step', step?:string, note?:string}} p
   */
  async runInBackground(p = {}) {
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.runInBackground !== 'function') {
      return err('AI panel is not available');
    }
    const r = mgr.runInBackground(p || {});
    return (r && r.ok) ? ok(r.data) : err((r && r.error) || 'runInBackground failed');
  },
};

/* ============================================================
 *  settings — read/update the user-facing IDE settings
 * ========================================================== */

const SETTINGS_KEY = 'aurora-settings';

function readSettingsStore() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

const settingsNs = {
  /** Snapshot of every user-facing setting Aurora exposes. */
  async getAll() {
    const s = readSettingsStore();
    return ok({
      locale: window.getLocale ? window.getLocale() : null,
      tooltipsEnabled: s.tooltipsEnabled !== false,
      verboseMode: !!s.verboseMode,
    });
  },

  /**
   * Update one setting. `key` is 'locale' | 'tooltipsEnabled' |
   * 'verboseMode'. Persists to localStorage and broadcasts so the
   * live UI reacts immediately.
   */
  async set(key, value) {
    if (key === 'locale') {
      if (typeof window.setLocale !== 'function') return err('i18n not loaded');
      await window.setLocale(value);
      return ok({ key, value });
    }
    if (key === 'tooltipsEnabled' || key === 'verboseMode') {
      const s = readSettingsStore();
      s[key] = !!value;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
      catch (e) { return err(e?.message || 'could not persist setting'); }
      window.dispatchEvent(new CustomEvent('aurora-settings-updated', { detail: s }));
      if (key === 'tooltipsEnabled') {
        setTooltipsEnabled(!!value);
      }
      return ok({ key, value: !!value });
    }
    return err(`unknown setting: ${key}`);
  },
};

/* ============================================================
 *  _meta — introspection
 *
 *  `schema()` describes the whole surface: every namespace, each
 *  function with a one-line description, and the event catalog.
 *  It is the canonical, machine-readable description of AuroraAPI
 *  — handy for docs, for tests asserting coverage, and for the AI
 *  runner to reason about what the IDE can do.
 *
 *  (The AI's *executable* tool schemas — JSON Schema for function
 *  calling — live separately in main/ai/tools.js, a curated subset
 *  with access levels. This `schema()` is the full developer view.)
 * ========================================================== */

const NAMESPACES = Object.freeze({
  editor: {
    getActiveFilePath: 'Path of the file focused in the editor',
    getOpenFiles:      'Paths of every open editor tab',
    getActiveText:     'Full text of the focused file',
    setActiveText:     'Replace the focused file’s entire content',
    insertAt:          'Insert text at a position (or the cursor)',
    replaceRange:      'Replace a 1-indexed line/column range',
    getCursor:         'Current cursor line/column',
    setCursor:         'Move the cursor and reveal it',
    getLanguage:       'Monaco language id of the focused file',
    newFile:           'Create a new untitled editor buffer',
    save:              'Save the focused file',
    saveAll:           'Save every open file',
    closeTab:          'Close a tab (the active one by default)',
    reopenLastTab:     'Reopen the most recently closed tab',
    openFile:          'Open any project file in the editor (optionally in a new split)',
    createSplit:       'Create a new editor split pane',
  },
  terminal: {
    list:    'Ids of every terminal panel',
    getText: 'Visible text of one terminal panel',
    getAll:  'Visible text of every terminal panel, keyed by id',
    clear:   'Clear a terminal panel',
  },
  project: {
    getCurrent:         'Path and metadata of the open project',
    getTree:            'Files and folders of the open project',
    readFile:           'Read any file inside the project folder, at any depth',
    createFile:         'Create (or overwrite) a file',
    createFolder:       'Create a directory',
    deleteFile:         'Delete a file or directory',
    renameFile:         'Rename or move a file',
    listProcessors:     'Processors of the open project + their config',
    createProcessor:    'Generate a processor in the open project (refuses to duplicate one whose folder already exists on disk; recreates a name that is only a dangling .spf reference)',
    renameProcessor:    'Rename a processor (dir, .cmm, #PRNAME, .spf, artifacts)',
    createProject:      'Create a new SAPHO project and open it',
    renameProject:      'Rename the open project (folder + .spf + every stored path)',
    openProject:        'Open an existing project by its .spf file',
    getProcessorConfig: 'Read clk/numClocks/simTime for one (or all) processors',
    setProcessorConfig: 'Update clk/numClocks/showArrays for one processor',
    refreshTree:        'Force a fresh repaint of the file tree',
    setView:            'Switch the left panel: "file" or "hierarchy"',
    getView:            'Which tree view is active right now',
    analyzeAsm:         'Parse a SAPHO .asm and return instruction counts, families, labels and loops',
  },
  compile: {
    compileAll:  'Run the full CMM→ASM→Verilog→wave→PRISM pipeline',
    compileStep: 'Run one pipeline step (cmm|asm|verilog|wave|prism|verilator|verilator-proc|verilator-fast)',
    cancel:      'Cancel a running compilation or simulation',
    listSteps:           'List every toolchain step the override system knows about',
    inspectCommand:      'Show the CommandSpec (base + override-applied) for a step',
    previewCommand:      'Dry-run a hypothetical override on top of the current spec',
    listOverrides:       'List every registered command override (ephemeral + persisted)',
    setOverride:         'Register a command override for a step (ephemeral by default)',
    clearOverride:       'Remove a registered override',
    listProtectedFlags:  'List flags that overrides cannot remove or replace for a step',
    listAllowedBinaries: 'List binaries the main-process executor will spawn',
  },
  wave: {
    listSignals:        'Signals discovered for the testbench + which are selected',
    setSignals:         'Choose which signals are dumped into GTKWave',
    openConfig:         'Open the Wave Configuration modal',
    listGtkwFiles:      'List .gtkw save files registered for the active testbench',
    findGtkwFiles:      'Find .gtkw files in the project by name (resolves the path for you)',
    useGtkwByName:      'Locate a .gtkw by name and set it active for the testbench in one step',
    addGtkwFile:        'Register a .gtkw file from the project for the active testbench',
    setActiveGtkwFile:  'Pick which registered .gtkw file GTKWave loads',
    removeGtkwFile:     'Drop a .gtkw file from the active testbench list',
    listSurferFiles:    'List Surfer layouts (.surf.ron/.sucl) registered for the active testbench',
    findSurferFiles:    'Find Surfer layout files (.surf.ron/.sucl) in the project by name',
    useSurferByName:    'Locate a Surfer layout by name and set it active for the testbench in one step',
    addSurferFile:      'Register a Surfer layout (.surf.ron/.sucl) for the active testbench',
    setActiveSurferFile:'Pick which registered Surfer layout the Surfer viewer loads (null = raw VCD)',
    removeSurferFile:   'Drop a Surfer layout from the active testbench list',
    getSimulator:       'Which simulator the Wave button runs (iverilog | verilator)',
    setSimulator:       'Switch the Wave-button simulator (iverilog | verilator)',
    getViewer:          'Which waveform viewer the Wave button opens (gtkwave | surfer)',
    setViewer:          'Switch the waveform viewer (gtkwave external window | surfer embedded)',
    getSurferMultiWindow: 'Whether Surfer keeps multiple windows open (false = single window, default)',
    setSurferMultiWindow: 'Enable/disable multiple Surfer windows to compare runs ({ enabled: boolean })',
  },
  settings: {
    getAll: 'Snapshot of every user-facing IDE setting',
    set:    'Update one setting (locale / tooltipsEnabled / verboseMode)',
  },
  rules: {
    get:            'The full sapho_rules.json knowledge base',
    getDirective:   'Details of one hardware directive',
    listDirectives: 'Names of every hardware directive',
    getKeywords:    'CMM language keywords',
    lookupMessage:  'A yanc compiler message by its code',
    listOpcodes:    'Every SAPHO assembly opcode (mnemonic, number, family, description)',
    getOpcode:      'One opcode by mnemonic',
  },
  ui: {
    showNotification: 'Show a toast notification',
    openSettings:     'Open the Settings modal',
    getLocale:        'The active UI locale',
    setLocale:        'Switch the UI locale',
  },
  ai: {
    open:              'Open the Aurora Intelligence chat panel',
    askAboutSelection: 'Open the chat seeded with a selected code snippet (Explain/Fix/Improve/Comment)',
    runInBackground:   'Run a compile task in the background; the assistant auto-reports when it finishes',
  },
  events: {
    on:   'Subscribe to a bus event; returns an unsubscribe fn',
    off:  'Unsubscribe a handler',
    emit: 'Publish a bus event',
  },
});

const metaNs = Object.freeze({
  version: '1.0.0',
  /** Machine-readable description of the whole AuroraAPI surface. */
  schema() {
    return {
      version: '1.0.0',
      namespaces: NAMESPACES,
      events: {
        // Emitted directly by AuroraAPI methods.
        emitted: ['compile:started', 'compile:cancelled', 'editor:new-file', 'editor:saved'],
        // Legacy window CustomEvents re-broadcast on the bus.
        bridged: { ...WINDOW_EVENT_BRIDGE },
      },
    };
  },
});

/* ============================================================
 *  Mount
 * ========================================================== */

export function initAuroraAPI() {
  if (window.AuroraAPI) return window.AuroraAPI;
  // Re-broadcast legacy window CustomEvents onto the bus so there is a
  // single place to observe IDE activity.
  bridgeWindowEvents();
  window.AuroraAPI = Object.freeze({
    editor:   Object.freeze(editorNs),
    terminal: Object.freeze(terminalNs),
    project:  Object.freeze(projectNs),
    compile:  Object.freeze(compileNs),
    wave:     Object.freeze(waveNs),
    rules:    Object.freeze(rulesNs),
    settings: Object.freeze(settingsNs),
    ui:       Object.freeze(uiNs),
    ai:       Object.freeze(aiNs),
    events:   Object.freeze({ on, off, emit }),
    _meta:    metaNs,
  });
  return window.AuroraAPI;
}
