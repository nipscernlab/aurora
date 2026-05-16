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
 *  editor — Monaco interactions
 * ========================================================== */

function activeEditor() {
  return EditorManager?.activeEditor || null;
}
function activeModel() {
  return activeEditor()?.getModel() || null;
}

const editorNs = {
  async getActiveFilePath() {
    return ok(TabManager?.activeTab || null);
  },

  async getOpenFiles() {
    const keys = TabManager?.tabs?.keys?.();
    return ok(keys ? Array.from(keys) : []);
  },

  async getActiveText() {
    const model = activeModel();
    if (!model) return err('No active editor');
    return ok(model.getValue());
  },

  async setActiveText(text) {
    const model = activeModel();
    if (!model) return err('No active editor');
    model.setValue(String(text ?? ''));
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
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: String(text ?? ''),
      forceMoveMarkers: true,
    }]);
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
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: startLine, startColumn,
        endLineNumber:   endLine,   endColumn,
      },
      text: String(text ?? ''),
      forceMoveMarkers: true,
    }]);
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
      return ok({ filePath: path });
    } catch (e) {
      return err(e?.message || 'save failed');
    }
  },

  async saveAll() {
    try {
      await TabManager.saveAllFiles();
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

const terminalNs = {
  /**
   * Return the visible text content of a terminal. Cards/messages get
   * concatenated with newlines so the result reads like the user sees
   * the panel.
   */
  async getText(id) {
    const el = terminalElById(id);
    if (!el) return err(id ? `terminal "${id}" not found` : 'no visible terminal');
    const lines = Array.from(el.querySelectorAll('.message, .entry, .terminal-line, .terminal-card'))
      .map((n) => n.textContent?.trim())
      .filter(Boolean);
    return ok(lines.length ? lines.join('\n') : (el.textContent || '').trim());
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
 *  project — current project + filesystem tree (read-only here)
 * ========================================================== */

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
    try {
      const files = await window.electronAPI?.getFolderFiles?.(root);
      return ok(files || []);
    } catch (e) {
      return err(e?.message || 'getTree failed');
    }
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
    try { await cf.runSingleStep(step); return ok({ step }); }
    catch (e) { return err(e?.message || 'compileStep failed'); }
  },

  async cancel() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    try { cf.cancelAll(); return ok(); }
    catch (e) { return err(e?.message || 'cancel failed'); }
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
 *  _meta — introspection
 *
 *  Lists the available namespaces and functions. The AI runner
 *  will eventually translate this into a JSON-Schema tool manifest
 *  for function-calling; for Phase A it is enough that the
 *  surface is enumerable.
 * ========================================================== */

const META = Object.freeze({
  version: '0.1.0',
  phase: 'A',
  namespaces: Object.freeze({
    editor:   ['getActiveFilePath', 'getOpenFiles', 'getActiveText', 'setActiveText',
               'insertAt', 'replaceRange', 'getCursor', 'setCursor', 'getLanguage',
               'save', 'saveAll', 'closeTab', 'reopenLastTab'],
    terminal: ['getText', 'clear'],
    project:  ['getCurrent', 'getTree'],
    compile:  ['compileAll', 'compileStep', 'cancel'],
    rules:    ['get', 'getDirective', 'listDirectives', 'getKeywords', 'lookupMessage'],
    ui:       ['showNotification', 'openSettings', 'getLocale', 'setLocale'],
    events:   ['on', 'off', 'emit'],
  }),
});

const metaNs = Object.freeze({
  version: META.version,
  schema() { return META; },
});

/* ============================================================
 *  Mount
 * ========================================================== */

export function initAuroraAPI() {
  if (window.AuroraAPI) return window.AuroraAPI;
  window.AuroraAPI = Object.freeze({
    editor:   Object.freeze(editorNs),
    terminal: Object.freeze(terminalNs),
    project:  Object.freeze(projectNs),
    compile:  Object.freeze(compileNs),
    rules:    Object.freeze(rulesNs),
    ui:       Object.freeze(uiNs),
    events:   Object.freeze({ on, off, emit }),
    _meta:    metaNs,
  });
  return window.AuroraAPI;
}
