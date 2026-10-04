/**
 * ai_ns.ts: o namespace `AuroraAPI.ai`, o que a API pede ao painel da Aurora
 * Intelligence: abrir, perguntar sobre um trecho selecionado e rodar uma
 * tarefa longa em segundo plano.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiUiAiSettings.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num ai_ns.js ao lado, e esse .js que
 * o runtime carrega; os imports usam a extensao `.js`.
 */

import { ok, err } from './api_core.js';

/** O pedido do botao de estrela da selecao no editor. */
interface PerguntaSobreSelecao {
  /** O texto selecionado (obrigatorio). */
  code?: string;
  /** O id de linguagem do Monaco (verilog, cmm, python...). */
  language?: string;
  filePath?: string;
  /** Primeira e ultima linhas selecionadas, a partir de 1. */
  lineStart?: number;
  lineEnd?: number;
  /** 'explain' | 'fix' | 'improve' | 'comment' | 'doc' | '' */
  intent?: string;
  /** Enviar na hora (so com intent). */
  send?: boolean;
  [k: string]: unknown;
}

export const aiNs = {
  /** Open the AI assistant panel (idempotent). */
  async open() {
    const mgr = window.aiAssistantManager;
    if (!mgr) return err('AI panel is not available');
    mgr.ensureOpen();
    return ok();
  },

  /**
   * Open the panel and seed the composer with a code snippet the user
   * selected in the editor, the backing call for the Monaco selection
   * "star" widget. With a concrete `intent` and `send:true` the message is
   * dispatched immediately; otherwise the composer is just pre-filled.
   */
  async askAboutSelection(p: PerguntaSobreSelecao | null = {}) {
    if (!p || !String(p.code || '').trim()) return err('code (a non-empty selection) required');
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.askAboutSelection !== 'function') {
      return err('AI panel is not available');
    }
    try {
      mgr.askAboutSelection(p);
      return ok();
    } catch (e) {
      return err((e as Error | null)?.message || 'askAboutSelection failed');
    }
  },

  /**
   * Start a long task in the background and return IMMEDIATELY so the current
   * turn can end. When the task finishes, the assistant auto-continues the
   * conversation with the result, i.e. it runs the work "under the hood",
   * lets the chat finish, then posts a follow-up message on its own.
   *
   * `p`: { task: 'compile_all' | 'compile_step', step?, note? }
   */
  async runInBackground(p: Record<string, unknown> | null = {}) {
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.runInBackground !== 'function') {
      return err('AI panel is not available');
    }
    const r = mgr.runInBackground(p || {});
    return (r && r.ok) ? ok(r.data) : err((r && r.error) || 'runInBackground failed');
  },
};
