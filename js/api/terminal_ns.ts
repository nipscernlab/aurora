/**
 * terminal_ns.ts: o namespace `AuroraAPI.terminal`, os paineis de terminal
 * (TCMM, TASM, TVERI, TWAVE, THTEST, TCMD) vistos pela API: listar, ler o
 * texto, limpar e rodar um comando na shell TCMD da pessoa.
 *
 * Os terminais sao enderecados pelo id do conteudo: 'tcmm', 'tasm', 'tveri',
 * 'twave', 'tprism' (os paineis dos botoes do fluxo de compilacao). Sem id, a
 * operacao vale para o terminal visivel.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiTerminal.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num terminal_ns.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { ok, err } from './api_core.js';
import { motivoDe } from '../app/api_reply.js';
import { switchTerminal } from '../terminal/terminal.js';

/** O que a shell TCMD devolve de um comando (js/terminal/shell_terminal.ts). */
interface RespostaDaShell {
  ok?: boolean;
  command?: string;
  executed?: boolean;
  /** false quando a captura fechou com a shell ainda escrevendo. */
  complete?: boolean;
  output?: string;
}

function visibleTerminalEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.terminal-content:not(.hidden)') || null;
}

function terminalElById(id?: string | null): HTMLElement | null {
  if (!id) return visibleTerminalEl();
  // Match either the content div id (`tcmm`) or the wrapper `terminal-tcmm`.
  return document.getElementById(id) || document.getElementById(`terminal-${id}`) || null;
}

function extractTerminalText(el: Element): string {
  const lines = Array.from(el.querySelectorAll('.message, .entry, .terminal-line, .terminal-card'))
    .map((n) => n.textContent?.trim())
    .filter(Boolean);
  return lines.length ? lines.join('\n') : (el.textContent || '').trim();
}

export const terminalNs = {
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
  async getText(id?: string) {
    const el = terminalElById(id);
    if (!el) return err(id ? `terminal "${id}" not found` : 'no visible terminal');
    return ok(extractTerminalText(el));
  },

  /** Visible text of *every* terminal panel, keyed by id. */
  async getAll() {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll('.terminal-content')) {
      if (el.id) out[el.id] = extractTerminalText(el);
    }
    return ok(out);
  },

  async clear(id?: string) {
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
      return err((e as Error | null)?.message || 'clear failed');
    }
  },

  /**
   * Type, and optionally run, a command in the user's TCMD shell (their real
   * PowerShell/bash, the one they see). `execute:false` just places the command
   * on the input line for the user to review and run; `execute:true` (default)
   * runs it and returns a best-effort snapshot of the output. `cd` persists in
   * the user's shell. This is the HUMAN shell, not the sandboxed compile path;
   * prefer compile_all / compile_step / run_fast_sim for real builds.
   */
  async runInShell(args: string | { command?: string; execute?: boolean } | null = {}) {
    const command = typeof args === 'string' ? args : (args?.command ?? '');
    if (!String(command).trim()) return err('command is required');
    const execute = typeof args === 'string' || args?.execute !== false;   // default true
    const st = window.shellTerminal;
    if (!st || typeof st.runCommand !== 'function') return err('TCMD shell unavailable');
    // Bring the TCMD terminal into view so the user watches it happen (this
    // module owns the tab switch; shell_terminal deliberately doesn't).
    try { switchTerminal('terminal-tcmd'); } catch (_) { /* best-effort */ }
    try {
      const res = await st.runCommand(command, { execute }) as RespostaDaShell | null | undefined;
      if (!res?.ok) return err(motivoDe(res, 'shell command failed'));
      // `complete:false` means the capture hit its cap while the shell was
      // still talking: the output is a prefix and the command may still be
      // running. Say so explicitly, so the model never mistakes a truncated
      // log for a finished one.
      const complete = res.executed ? res.complete !== false : true;
      return ok({
        command: res.command,
        executed: res.executed,
        complete,
        output: res.output ?? '',
        ...(complete ? {} : { note: 'output truncated: the command was still producing output when the capture window closed and may still be running; check the TCMD terminal before assuming it finished' }),
      });
    } catch (e) {
      return err((e as Error | null)?.message || 'shell command failed');
    }
  },
};
