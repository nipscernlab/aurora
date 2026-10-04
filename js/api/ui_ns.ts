/**
 * ui_ns.ts: o namespace `AuroraAPI.ui`, a parte da interface que a API mexe:
 * aviso no canto, a janela de Configuracoes, o idioma e a pergunta que a IA
 * faz no meio do turno.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiUiAiSettings.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num ui_ns.js ao lado, e esse .js que
 * o runtime carrega; os imports usam a extensao `.js`.
 */

import { ok, err } from './api_core.js';

/** Uma opcao da pergunta inline. */
interface OpcaoDaPergunta {
  label: string;
  description?: string;
}

export const uiNs = {
  /** Pop a toast using the existing notification system. */
  async showNotification(message?: unknown, type = 'info', duration = 5000, title?: string) {
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

  async setLocale(locale: string) {
    if (typeof window.setLocale !== 'function') return err('i18n not loaded');
    try { await window.setLocale(locale); return ok({ locale }); }
    catch (e) { return err((e as Error | null)?.message || 'setLocale failed'); }
  },

  /**
   * Pause the AI turn and show an inline question card in the chat
   * panel. The card lets the user pick from {options}, optionally
   * multi-select, and (always) write a free-form "Other" answer.
   *
   * Resolves with `{ answer: <text>, selected: [<labels>] }` once the
   * user submits. The promise also resolves if the AI turn aborts.
   */
  async askUserQuestion(
    { question, options = [], multiSelect = false }:
      { question?: unknown; options?: OpcaoDaPergunta[] | unknown; multiSelect?: unknown } = {},
  ) {
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
