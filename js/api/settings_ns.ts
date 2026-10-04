/**
 * settings_ns.ts: o namespace `AuroraAPI.settings`, ler e mudar as
 * configuracoes que a pessoa ve: idioma, dicas e modo detalhado.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiUiAiSettings.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num settings_ns.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { ok, err } from './api_core.js';
import { setTooltipsEnabled } from '../ui/tooltip.js';

const SETTINGS_KEY = 'aurora-settings';

/** O que fica gravado no localStorage, na chave `aurora-settings`. */
type ConfiguracoesGravadas = Record<string, unknown>;

function readSettingsStore(): ConfiguracoesGravadas {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

export const settingsNs = {
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
  async set(key: string, value: unknown) {
    if (key === 'locale') {
      if (typeof window.setLocale !== 'function') return err('i18n not loaded');
      await window.setLocale(value as string);
      return ok({ key, value });
    }
    if (key === 'tooltipsEnabled' || key === 'verboseMode') {
      const s = readSettingsStore();
      s[key] = !!value;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
      catch (e) { return err((e as Error | null)?.message || 'could not persist setting'); }
      window.dispatchEvent(new CustomEvent('aurora-settings-updated', { detail: s }));
      if (key === 'tooltipsEnabled') {
        setTooltipsEnabled(!!value);
      }
      return ok({ key, value: !!value });
    }
    return err(`unknown setting: ${key}`);
  },
};
