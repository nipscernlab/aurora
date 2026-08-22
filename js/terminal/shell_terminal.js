// shell_terminal.js: the TCMD tab's real terminal (xterm.js + a PTY).
//
// The main process (main/ipc/shell.js) owns a pseudo-terminal; xterm renders it
// and forwards keystrokes. Because it's a true PTY, we get inline editing, the
// shell's own Tab autocomplete, colours and a cursor for free, this module only
// wires xterm to the IPC, keeps the PTY sized to the panel, and adds copy/paste,
// clickable URLs and clickable Windows file paths. The session starts lazily the
// first time the TCMD tab is opened.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { electronAPI } from '../app/electron_api.js';

const SESSION_ID = 'tcmd';
// Windows-style absolute paths: `C:\...` or UNC `\\host\...`, stopping at
// whitespace / quotes / shell metacharacters.
const WIN_PATH_RE = /(?:[A-Za-z]:\\|\\\\)[^\s"'<>|)}\]]+/g;

// Strip ANSI escape sequences (colours/cursor moves, window-title OSC) from
// captured PTY output so the AI's run_in_terminal tool gets plain, readable text.
// Keeps \t \n \r; drops other C0 control bytes.
function stripAnsi(s) {
  /* eslint-disable no-control-regex -- stripping ANSI/control bytes needs them */
  return String(s)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')   // OSC (e.g. window title) … BEL/ST
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')        // CSI (SGR colours, cursor)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');    // stray control chars
  /* eslint-enable no-control-regex */
}
const TEXT_EXT_RE = /\.(v|sv|svh|vh|cmm|asm|c|h|cpp|py|txt|md|json|jsonc|log|csv|sdc|tcl|vhd|vhdl|xdc|ys|do|f|mk|cfg|ini|yml|yaml)$/i;

class ShellTerminal {
  constructor() {
    this.panel = document.getElementById('terminal-tcmd');
    this.mount = this.panel?.querySelector('.tcmd-xterm') || null;
    this.tab = document.querySelector('.tab[data-terminal="tcmd"]');
    this.term = null;
    this.fit = null;
    this._ro = null;
    this._startPromise = null;
    this._unsub = [];
  }

  init() {
    if (!this.panel || !this.mount) return;
    this.tab?.addEventListener('click', () => this._onActivate());
    // If TCMD is already the active tab at load (tcmm is default, so unlikely).
    if (!this.panel.classList.contains('hidden')) this._onActivate();
  }

  // Pull a few brand colours from CSS so the terminal matches the theme.
  _theme() {
    const css = getComputedStyle(document.documentElement);
    const v = (n, f) => (css.getPropertyValue(n).trim() || f);
    return {
      background: v('--bg', '#0A0D14'),
      foreground: v('--text', '#E8ECF3'),
      cursor: v('--accent', '#8E83E8'),
      cursorAccent: v('--bg', '#0A0D14'),
      selectionBackground: 'rgba(142,131,232,0.35)',
      black: '#11131c', red: '#E26C6C', green: '#5FE0B0', yellow: '#E8C97D',
      blue: '#5BB8E8', magenta: '#B58AE8', cyan: '#4FD3C2', white: '#C5C9D6',
      brightBlack: '#5A6072', brightRed: '#FF8A8A', brightGreen: '#7FF0C6', brightYellow: '#FFE0A0',
      brightBlue: '#8CD0FF', brightMagenta: '#D0B0FF', brightCyan: '#7FEFE0', brightWhite: '#FFFFFF',
    };
  }

  _ensureTerm() {
    if (this.term) return;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      || 'Consolas, "Cascadia Mono", monospace';
    this.term = new Terminal({
      fontFamily: mono,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: this._theme(),
      allowProposedApi: true,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    // http(s) URLs → open in the default browser.
    this.term.loadAddon(new WebLinksAddon((_e, uri) => electronAPI.openExternal?.(uri)));
    this.term.open(this.mount);
    this._registerFileLinks();
    this._wireClipboard();

    // Keystrokes → PTY (xterm handles inline editing; the PTY gives real Tab
    // completion, history, Ctrl+C, etc.).
    this.term.onData((d) => this._send(d));
    this.term.onResize(({ cols, rows }) => electronAPI.shellResize?.(SESSION_ID, cols, rows));

    // Keep the PTY grid matched to the panel size.
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this.mount);

    // Stream from the PTY.
    this._unsub.push(electronAPI.onShellData(({ id, data }) => {
      if (id === SESSION_ID) this.term.write(data);
    }));
    this._unsub.push(electronAPI.onShellExit(({ id, code }) => {
      if (id !== SESSION_ID) return;
      this.term.write(`\r\n\x1b[33m[processo encerrado (código ${code ?? 0})] — reabra a aba para um novo shell.\x1b[0m\r\n`);
      this._startPromise = null;   // next activation restarts a fresh shell
    }));
  }

  _fit() {
    try { this.fit?.fit(); } catch (_) { /* not laid out yet */ }
  }

  async _onActivate() {
    this._ensureTerm();
    // The tab switch toggles display; fit + focus once the panel is visible.
    requestAnimationFrame(() => { this._fit(); this.term?.focus(); });
    await this._ensureStarted();
  }

  // Shared promise so the tab click and the first keystroke await the SAME start
  // and never write to a PTY that doesn't exist yet.
  _ensureStarted() {
    if (this._startPromise) return this._startPromise;
    this._startPromise = (async () => {
      this._fit();
      const cwd = window.currentProjectPath || undefined;
      const cols = this.term?.cols || 80;
      const rows = this.term?.rows || 24;
      try {
        const res = await electronAPI.shellStart({ id: SESSION_ID, cwd, cols, rows });
        if (!res?.ok) {
          this._startPromise = null;
          this.term?.write(`\x1b[31m[não foi possível iniciar o shell] ${res?.error || ''}\x1b[0m\r\n`);
          return false;
        }
        return true;
      } catch (err) {
        this._startPromise = null;
        this.term?.write(`\x1b[31m[erro ao iniciar o shell] ${err?.message || err}\x1b[0m\r\n`);
        return false;
      }
    })();
    return this._startPromise;
  }

  async _send(data) {
    const ok = await this._ensureStarted();
    if (ok) electronAPI.shellInput(SESSION_ID, data);
  }

  /**
   * "Open terminal here" (file-tree context menu): make sure the terminal
   * exists/started, focus it and `cd` the live shell into `dirPath`. The PTY
   * runs PowerShell on Windows (see main/ipc/shell.js), where `cd "path"`
   * (Set-Location) already handles drive changes, no `/d` needed. Quotes in
   * the path are escaped PowerShell-style by doubling them.
   * The caller is responsible for making the TCMD tab visible (switchTerminal).
   */
  async openAt(dirPath) {
    if (!dirPath) return;
    this._ensureTerm();
    requestAnimationFrame(() => { this._fit(); this.term?.focus(); });
    const ok = await this._ensureStarted();
    if (!ok) return;
    const q = String(dirPath).replace(/"/g, '""');
    electronAPI.shellInput(SESSION_ID, `cd "${q}"\r`);
  }

  /**
   * Programmatic command entry, backs Aurora Intelligence's `run_in_terminal`
   * tool. Ensures the shell is live, then EITHER just types `command` (execute
   * false, the user reviews and presses Enter themselves) OR runs it (execute
   * true) and returns a best-effort snapshot of the output it produced. Output is
   * captured from the PTY stream and resolves once the stream goes idle for
   * `idleMs` (command finished) or `maxMs` elapses (safety cap so a long-running
   * or interactive command can never block the AI turn). The caller switches the
   * TCMD tab into view (this module deliberately doesn't import switchTerminal).
   *
   * @param {string} command
   * @param {{execute?: boolean, idleMs?: number, maxMs?: number}} [opts]
   * @returns {Promise<{ok:boolean, executed?:boolean, command?:string, output?:string, error?:string}>}
   */
  async runCommand(command, { execute = true, idleMs = 500, maxMs = 15000 } = {}) {
    const cmd = String(command ?? '');
    if (!cmd.trim()) return { ok: false, error: 'empty command' };
    this._ensureTerm();
    const started = await this._ensureStarted();
    if (!started) return { ok: false, error: 'shell could not start' };
    requestAnimationFrame(() => { this._fit(); this.term?.focus(); });

    if (!execute) {
      // Place the command on the input line WITHOUT a carriage return so the user
      // reviews it and presses Enter (the "what's that command again?" case).
      electronAPI.shellInput(SESSION_ID, cmd);
      return { ok: true, executed: false, command: cmd };
    }

    return await new Promise((resolve) => {
      const chunks = [];
      let idle = null;
      let hard = null;
      let unsub = null;
      // `complete` tells the caller WHICH timer ended the capture. Idle means
      // the shell went quiet, so the command most likely finished; the hard
      // cap means it was still talking, so the output is a prefix and the
      // command may still be running. Before this flag both looked identical
      // (`ok: true`), and the AI took a truncated build log for a finished one.
      const finish = (complete) => {
        if (idle) clearTimeout(idle);
        if (hard) clearTimeout(hard);
        try { unsub?.(); } catch (_) { /* already gone */ }
        resolve({ ok: true, executed: true, complete, command: cmd, output: stripAnsi(chunks.join('')) });
      };
      unsub = electronAPI.onShellData(({ id, data }) => {
        if (id !== SESSION_ID) return;
        chunks.push(data);
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => finish(true), idleMs);   // idle stream: command likely done
      });
      hard = setTimeout(() => finish(false), maxMs);       // cap for long/interactive cmds
      electronAPI.shellInput(SESSION_ID, cmd + '\r');
    });
  }

  // ---- copy / paste ---------------------------------------------------------

  _wireClipboard() {
    // Ctrl+C copies the selection if there is one; otherwise ^C reaches the
    // shell as an interrupt. Ctrl+V pastes. Right-click: copy-or-paste.
    //
    // e.preventDefault() is REQUIRED on both: returning false only tells xterm
    // to skip the key, it does NOT stop the browser default. Without it the
    // native paste event still fires on xterm's hidden textarea and xterm
    // forwards the clipboard to the PTY via onData, so Ctrl+V pasted TWICE
    // (and Ctrl+C ran the native copy in parallel with ours).
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const ctrl = e.ctrlKey && !e.altKey;
      if (ctrl && (e.key === 'c' || e.key === 'C')) {
        const sel = this.term.getSelection();
        if (sel) { e.preventDefault(); navigator.clipboard?.writeText(sel); return false; }
        return true;
      }
      if (ctrl && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); this._paste(); return false; }
      return true;
    });
    this.mount.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const sel = this.term.getSelection();
      if (sel) { navigator.clipboard?.writeText(sel); this.term.clearSelection(); }
      else this._paste();
    });
  }

  async _paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) this._send(t);
    } catch (_) { /* clipboard denied */ }
  }

  // ---- clickable file paths -------------------------------------------------

  _registerFileLinks() {
    this.term.registerLinkProvider({
      provideLinks: (lineNo, cb) => {
        const text = this.term.buffer.active.getLine(lineNo - 1)?.translateToString(true) || '';
        const links = [];
        let m;
        WIN_PATH_RE.lastIndex = 0;
        while ((m = WIN_PATH_RE.exec(text)) !== null) {
          const start = m.index;
          const p = m[0].replace(/[.,;:)]+$/, ''); // trim trailing punctuation
          if (p.length < 4) continue;
          links.push({
            range: { start: { x: start + 1, y: lineNo }, end: { x: start + p.length, y: lineNo } },
            text: p,
            activate: () => this._openPath(p),
          });
        }
        cb(links.length ? links : undefined);
      },
    });
  }

  async _openPath(p) {
    try {
      const exists = await electronAPI.fileExists?.(p);
      if (!exists) return;
      if (TEXT_EXT_RE.test(p)) {
        const content = await electronAPI.readFile(p);
        if (typeof content === 'string') window.TabManager?.addTab?.(p, content);
      } else {
        // Non-text (e.g. the generated .html plots) → open with the OS default.
        electronAPI.openExternal?.('file:///' + p.replace(/\\/g, '/'));
      }
    } catch (_) { /* noop */ }
  }

  clear() { this.term?.clear(); }

  dispose() {
    this._unsub.forEach((fn) => { try { fn?.(); } catch (_) { /* noop */ } });
    this._unsub = [];
    try { this._ro?.disconnect(); } catch (_) { /* noop */ }
    try { electronAPI.shellKill(SESSION_ID); } catch (_) { /* noop */ }
    try { this.term?.dispose(); } catch (_) { /* noop */ }
  }
}

let instance = null;
function initShellTerminal() {
  if (instance) return instance;
  const boot = () => {
    instance = new ShellTerminal();
    instance.init();
    // Reachable from the file tree's "Open terminal here" without an import
    // cycle (tree → terminal); mirrors the other window-exposed singletons.
    window.shellTerminal = instance;
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  return instance;
}

// Self-initialize on import (renderer.js pulls this in as a side-effect).
initShellTerminal();

export { ShellTerminal, initShellTerminal };
