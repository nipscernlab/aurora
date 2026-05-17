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

/* ============================================================
 *  Result helpers
 * ========================================================== */

function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function err(message, code) {
  return { ok: false, error: { message: String(message || 'Unknown error'), code: code || null } };
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
  setTimeout(() => ed.deltaDecorations(ids, []), 750);
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
    // Magic-wand sweep: a shimmer band rises bottom→top across the editor.
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
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    let absPath = isAbsolute ? filePath : `${root}\\${filePath.replace(/^[\\/]+/, '')}`;
    let content;
    try {
      content = await window.electronAPI.readFile(absPath);
    } catch (_) {
      // Direct path failed — try fuzzy match: find any project file whose
      // name matches the basename. Handles the common case where the AI
      // passes just a filename without the processor subdirectory.
      if (!isAbsolute) {
        const base = filePath.split(/[\\/]/).pop();
        try {
          const tree = await projectNs.getTree(root);
          if (tree.ok && Array.isArray(tree.value)) {
            const match = tree.value.find(
              (p) => p === base || p.endsWith(`/${base}`) || p.endsWith(`\\${base}`),
            );
            if (match) {
              absPath = `${root}\\${match.replace(/\//g, '\\')}`;
              content = await window.electronAPI.readFile(absPath);
            }
          }
        } catch (_2) { /* fall through to error */ }
      }
      if (content === undefined) {
        return err(`"${filePath}" not found. Use get_project_tree to list available paths.`);
      }
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

    try {
      const raw = await window.electronAPI.readFile(target);
      const text = String(raw ?? '');
      const MAX = 256 * 1024;
      if (text.length > MAX) {
        return ok({ filePath: target, content: text.slice(0, MAX), length: text.length, truncated: true });
      }
      return ok({ filePath: target, content: text, length: text.length, truncated: false });
    } catch (e) {
      return err(`File not found: "${target}". Use get_project_tree to list all available paths.`);
    }
  },

  /** Create (or overwrite) a file with `content`, then refresh the tree.
   *  .v/.sv/.vh files are auto-registered in synthesizableFiles so they
   *  appear in the file tree immediately without a manual import step. */
  async createFile(filePath, content = '') {
    if (!filePath) return err('filePath required');
    try {
      await window.electronAPI.writeFile(filePath, String(content ?? ''));

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
   * Generate a processor in the open project.
   * `config`: { processorName, nBits, nbMantissa, nbExponent,
   *             dataStackSize, instructionStackSize, inputPorts,
   *             outputPorts, gain }
   */
  async createProcessor(config) {
    const root = window.currentProjectPath || null;
    if (!root) return err('No project open');
    if (!config || !config.processorName) return err('processorName required');
    try {
      const r = await window.electronAPI.createProcessorProject({
        projectLocation: root,
        ...config,
      });
      if (r && r.success) {
        await refreshTree();
        emit('project:processor-created', { name: config.processorName });
        return ok({ name: config.processorName });
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

  /** Run a single pipeline step. `step` is one of 'cmm'|'verilog'|'wave'|'prism'. */
  async compileStep(step) {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    if (!['cmm', 'verilog', 'wave', 'prism'].includes(step)) {
      return err(`unknown compile step: ${step}`);
    }
    emit('compile:started', { scope: step });
    try { await cf.runSingleStep(step); return ok({ step }); }
    catch (e) { return err(e?.message || 'compileStep failed'); }
  },

  async cancel() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    try { cf.cancelAll(); emit('compile:cancelled', null); return ok(); }
    catch (e) { return err(e?.message || 'cancel failed'); }
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
        window.auroraSettings?.updateTooltipsState?.(!!value);
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
    getCurrent:      'Path and metadata of the open project',
    getTree:         'Files and folders of the open project',
    readFile:        'Read any file inside the project folder, at any depth',
    createFile:      'Create (or overwrite) a file',
    createFolder:    'Create a directory',
    deleteFile:      'Delete a file or directory',
    renameFile:      'Rename or move a file',
    listProcessors:  'Processors of the open project + their config',
    createProcessor: 'Generate a processor in the open project',
    createProject:   'Create a new SAPHO project and open it',
    openProject:     'Open an existing project by its .spf file',
  },
  compile: {
    compileAll:  'Run the full CMM→ASM→Verilog→wave→PRISM pipeline',
    compileStep: 'Run one pipeline step (cmm|verilog|wave|prism)',
    cancel:      'Cancel a running compilation or simulation',
  },
  wave: {
    listSignals: 'Signals discovered for the testbench + which are selected',
    setSignals:  'Choose which signals are dumped into GTKWave',
    openConfig:  'Open the Wave Configuration modal',
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
  },
  ui: {
    showNotification: 'Show a toast notification',
    openSettings:     'Open the Settings modal',
    getLocale:        'The active UI locale',
    setLocale:        'Switch the UI locale',
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
        emitted: ['compile:started', 'compile:cancelled', 'editor:saved'],
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
    events:   Object.freeze({ on, off, emit }),
    _meta:    metaNs,
  });
  return window.AuroraAPI;
}
