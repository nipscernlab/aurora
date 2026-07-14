// shell_terminal.js — drives the TCMD tab's embedded interactive shell.
//
// The main process (main/ipc/shell.js) owns a persistent PowerShell over pipes;
// this module renders its stream and feeds it the user's typed lines. The shell
// echoes each command and prints its own prompt (which tracks the cwd as `cd`
// runs), so we just render stdout/stderr faithfully — no prompt/echo of our own.
//
// Rendering is a tiny terminal line-model: it strips ANSI escapes, treats CRLF
// as newline, a lone CR as "overwrite this line" (progress bars) and BS as
// backspace. The session starts lazily the first time the TCMD tab is opened so
// we don't spawn a shell for users who never touch it.

import { electronAPI } from '../app/electron_api.js';

const SESSION_ID = 'tcmd';
const MAX_LINES = 5000;                 // bound the scrollback like the log panels
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

class ShellTerminal {
  constructor() {
    this.panel = document.getElementById('terminal-tcmd');
    this.body = this.panel?.querySelector('.terminal-body') || null;
    this.input = this.panel?.querySelector('.terminal-input') || null;
    this.tab = document.querySelector('.tab[data-terminal="tcmd"]');
    this._startPromise = null;          // in-flight/settled shellStart (shared, race-free)
    this._cur = null;                   // the current (not-yet-newline) line node
    this._history = [];
    this._histIdx = -1;
    this._draft = '';
    this._unsub = [];
  }

  init() {
    if (!this.panel || !this.body || !this.input) return;

    // Stream from the main-process shell.
    this._unsub.push(electronAPI.onShellData(({ id, type, data }) => {
      if (id !== SESSION_ID) return;
      this._write(data, type);
    }));
    this._unsub.push(electronAPI.onShellExit(({ id, code }) => {
      if (id !== SESSION_ID) return;
      this._writeLine(`\n[processo encerrado (código ${code ?? 0})] — reabra a aba para um novo shell.`, 'warning');
      this._startPromise = null;        // next activation restarts a fresh shell
    }));

    // Lazy start + focus when the TCMD tab is opened. Both the generic tab strip
    // (terminal.js) and TerminalManager already toggle visibility; we just need
    // to know the panel became visible to boot the shell and focus the input.
    this.tab?.addEventListener('click', () => this._onActivate());
    // Clicking anywhere in the panel focuses the input (terminal ergonomics).
    this.panel.addEventListener('mousedown', (e) => {
      if (e.target.closest('.terminal-input-line')) return; // let the field handle it
      // Defer so a text selection in the scrollback isn't stolen by focus().
      if (window.getSelection()?.toString()) return;
      setTimeout(() => this.input.focus(), 0);
    });

    this.input.addEventListener('keydown', (e) => this._onKey(e));

    // If TCMD is already the active tab at load (unlikely, tcmm is default), boot.
    if (!this.panel.classList.contains('hidden')) this._onActivate();
  }

  async _onActivate() {
    await this._ensureStarted();
    setTimeout(() => this.input?.focus(), 0);
  }

  // Returns a shared promise that resolves true once the shell session is live
  // in the main process. Concurrent callers (tab click + first Enter) await the
  // SAME promise, so a command is never written before the session exists.
  _ensureStarted() {
    if (this._startPromise) return this._startPromise;
    this._startPromise = (async () => {
      const cwd = window.currentProjectPath || undefined;
      try {
        const res = await electronAPI.shellStart({ id: SESSION_ID, cwd });
        if (!res?.ok) {
          this._startPromise = null;
          this._writeLine(`[não foi possível iniciar o shell] ${res?.error || ''}`, 'error');
          return false;
        }
        return true;
      } catch (err) {
        this._startPromise = null;
        this._writeLine(`[não foi possível iniciar o shell] ${err?.message || err}`, 'error');
        return false;
      }
    })();
    return this._startPromise;
  }

  _onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = this.input.value;
      this.input.value = '';
      if (line.trim()) { this._history.push(line); }
      this._histIdx = this._history.length;
      this._draft = '';
      // The shell echoes the command + prints the next prompt, so we don't echo.
      this._send(line + '\r\n');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this._history.length) return;
      if (this._histIdx === this._history.length) this._draft = this.input.value;
      this._histIdx = Math.max(0, this._histIdx - 1);
      this.input.value = this._history[this._histIdx];
      this._moveCaretToEnd();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this._histIdx >= this._history.length) return;
      this._histIdx += 1;
      this.input.value = this._histIdx === this._history.length ? this._draft : this._history[this._histIdx];
      this._moveCaretToEnd();
      return;
    }
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      // Best-effort interrupt. Over a pipe (no PTY) this may not always reach a
      // running child, but it does end the current PowerShell input line.
      if (!window.getSelection()?.toString()) { // let Ctrl+C copy a selection
        e.preventDefault();
        this._send('\x03');
      }
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      this.clear();
    }
  }

  _moveCaretToEnd() {
    const v = this.input.value; this.input.value = ''; this.input.value = v;
  }

  async _send(data) {
    const ok = await this._ensureStarted();
    if (ok) electronAPI.shellInput(SESSION_ID, data);
  }

  // ---- stream rendering -----------------------------------------------------

  _ensureCurLine() {
    // Recreate if missing or detached (e.g. the Clear button wiped the body).
    if (!this._cur || !this._cur.isConnected) {
      this._cur = document.createElement('div');
      this._cur.className = 'terminal-line';
      this.body.appendChild(this._cur);
    }
    return this._cur;
  }

  _newLine(cls) {
    const el = document.createElement('div');
    el.className = 'terminal-line' + (cls ? ' ' + cls : '');
    this.body.appendChild(el);
    this._cur = el;
    this._trim();
    return el;
  }

  /** Append a whole pre-formatted line as its own entry (used for our notices). */
  _writeLine(text, cls) {
    // Close any partial current line first so notices don't merge into it.
    if (this._cur && this._cur.textContent) this._cur = null;
    const el = this._newLine(cls);
    el.textContent = text.replace(/^\n+/, '');
    this._newLine();
    this._scroll();
  }

  _write(raw, streamType) {
    if (!raw) return;
    const text = String(raw).replace(ANSI_RE, '').replace(/\r\n/g, '\n');
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      let seg = parts[i];
      const cur = this._ensureCurLine();
      // Lone CR: overwrite from the start of the line (progress bars).
      if (seg.indexOf('\r') !== -1) {
        cur.textContent = '';
        seg = seg.slice(seg.lastIndexOf('\r') + 1);
      }
      // Backspaces: apply against the accumulated line text.
      if (seg.indexOf('\b') !== -1) {
        let t = cur.textContent;
        for (const ch of seg) t = ch === '\b' ? t.slice(0, -1) : t + ch;
        cur.textContent = t;
      } else if (seg) {
        cur.textContent += seg;
      }
      // stderr gets a subtle tint without hijacking real error styling.
      if (streamType === 'stderr' && seg && !cur.classList.contains('stderr')) {
        cur.classList.add('stderr');
      }
      if (i < parts.length - 1) this._newLine();  // the split point was a newline
    }
    this._scroll();
  }

  _trim() {
    let excess = this.body.childElementCount - MAX_LINES;
    while (excess-- > 0 && this.body.firstElementChild) {
      this.body.removeChild(this.body.firstElementChild);
    }
  }

  _scroll() {
    if (this._scrollPending) return;
    this._scrollPending = true;
    requestAnimationFrame(() => {
      this._scrollPending = false;
      this.body.scrollTop = this.body.scrollHeight;
    });
  }

  clear() {
    this.body.innerHTML = '';
    this._cur = null;
  }

  dispose() {
    this._unsub.forEach((fn) => { try { fn?.(); } catch (_) { /* noop */ } });
    this._unsub = [];
    try { electronAPI.shellKill(SESSION_ID); } catch (_) { /* noop */ }
  }
}

let instance = null;
function initShellTerminal() {
  if (instance) return instance;
  const boot = () => { instance = new ShellTerminal(); instance.init(); };
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
