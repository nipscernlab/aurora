// provider_view.js — pure provider/model view helpers for the AI assistant,
// extracted from ai_assistant_manager.js (A2 god-file decomposition).
//
// Pure: no DOM, no instance state. The render* methods stay in the class (they
// own the popover elements + state); they call these to build the markup and
// the switch-marker label. The provider/model DATA lives in ai_metadata.js.

import { PROVIDER_META, SUB_META, shortModelName } from './ai_metadata.js';

// Radio markup for the provider picker. `providers` is providersAvailable;
// `currentProvider` is the selected name. Subscription providers show a SUB tag
// + tagline; API providers show their configured (or default) model as the hint.
export function providerOptionsHtml(providers, currentProvider) {
    return providers.map((p) => {
        const meta = PROVIDER_META[p.name] || { label: p.name };
        const checked = p.name === currentProvider ? ' checked' : '';
        const hint = meta.subscription ? meta.tagline : (p.model || 'default model');
        return `
        <label class="ai-mp-opt">
          <input type="radio" name="ai-provider" value="${p.name}"${checked}>
          <img class="ai-mp-opt-icon" src="${meta.icon}" alt="">
          <span class="ai-mp-opt-text">
            <span class="ai-mp-opt-label">${meta.label}${
    meta.subscription ? '<span class="ai-mp-opt-tag">SUB</span>' : ''}</span>
            <span class="ai-mp-opt-hint">${hint}</span>
          </span>
        </label>
      `;
    }).join('');
}

// Segmented-button markup for the subscription CLI model presets. `models` is
// SUB_META[provider].models; `active` is the chosen preset id.
export function modelPresetsHtml(models, active) {
    return models.map((m) =>
        `<button type="button" data-model="${m.id}" class="ai-seg-btn${
            m.id === active ? ' active' : ''}">${m.label}</button>`).join('');
}

// The model name to show in the "--- Modelo: ... ---" switch marker — faithful
// to what the user picked. For the subscription CLIs that's the chosen preset
// label (Default / Sonnet / Opus / Haiku); for API providers it's the real
// model id (lightly shortened), falling back to the provider default so the
// marker is never blank.
export function faithfulModelName(entry, provider) {
    const model = entry?.model || '';
    const sm = SUB_META[provider];
    if (sm) {
        const preset = sm.models.find((m) => m.id === (model || 'default'));
        return preset ? preset.label : (model || 'Default');
    }
    if (model && model !== 'default') return shortModelName(model) || model;
    const fallback = entry?.defaultModel && entry.defaultModel !== 'default'
        ? entry.defaultModel : '';
    return fallback ? (shortModelName(fallback) || fallback) : '';
}
