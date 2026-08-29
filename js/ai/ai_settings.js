import { electronAPI } from '../app/electron_api.js';
/**
 * ai_settings.js: the "AI Assistant" pane of the Settings modal.
 *
 * Bring-your-own-key (BYOK) management: one card per provider. The user
 * doesn't choose "which AI" in a separate step, each card *is* a
 * provider, so they just paste the key into the card for the service
 * they have an account with and hit Save.
 *
 * The key flows renderer → main once (on Save), where `keystore`
 * encrypts it with the OS keychain. It is never read back into the
 * renderer, the UI only ever learns "configured / not configured".
 */

const PROVIDER_META = {
  openai: {
    label: 'OpenAI',
    icon: './assets/icons/ai_chatgpt.svg',
    placeholder: 'sk-proj-…',
    console: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic · Claude',
    icon: './assets/icons/ai_claude.svg',
    placeholder: 'sk-ant-api03-…',
    console: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    label: 'Google · Gemini',
    icon: './assets/icons/ai_gemini.webp',
    placeholder: 'AIza…',
    console: 'https://aistudio.google.com/apikey',
  },
  deepseek: {
    label: 'DeepSeek',
    icon: './assets/icons/ai_deepseek.svg',
    placeholder: 'sk-…',
    console: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    label: 'Groq',
    icon: './assets/icons/ai_groq.svg',
    placeholder: 'gsk_…',
    console: 'https://console.groq.com/keys',
  },
  ollama: {
    label: 'Ollama',
    icon: './assets/icons/ai_ollama.svg',
    placeholder: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1:8b',
    console: 'https://ollama.com',
    isLocal: true,
  },
};

const tr = (key, params) => (window.t ? window.t(key, params) : key);

/** Map a card's data-provider id back to its DOM card. */
/**
 * As opcoes da lista de modelos de um provedor, vindas do main
 * (aiAPI.modelPresets). Sem resposta ainda, lista vazia: o campo continua
 * livre, e a lista se enche quando o main responder (ver preencherPresets).
 */
let PRESETS = {};
function presetsHtml(provider) {
  const lista = PRESETS[provider] || [];
  return lista.map((m) => `<option value="${m.id}">${m.nota ? m.nota : ''}</option>`).join('');
}
async function carregarPresets() {
  try {
    const r = await window.aiAPI?.modelPresets?.();
    if (r && r.ok && r.presets) PRESETS = r.presets;
  } catch (_) { /* a lista e sugestao; sem ela o campo segue livre */ }
}

function cardFor(provider) {
  return document.querySelector(`.ai-provider-card[data-provider="${provider}"]`);
}

function setBadge(card, configured) {
  const badge = card.querySelector('.ai-pc-badge');
  badge.dataset.state = configured ? 'on' : 'off';
  badge.textContent = configured
    ? tr('modal.settings.aiConfigured')
    : tr('modal.settings.aiNotConfigured');
  // The per-provider "Remove key" button is ALWAYS visible (so every provider
  // visibly offers it) but disabled when there's no stored key to remove.
  const rm = card.querySelector('.ai-pc-remove');
  rm.disabled = !configured;
  rm.title = configured ? tr('modal.settings.aiRemove') : tr('modal.settings.aiNotConfigured');
}

function setFeedback(card, state, text) {
  const fb = card.querySelector('.ai-pc-feedback');
  if (!text) { fb.hidden = true; fb.textContent = ''; return; }
  fb.hidden = false;
  fb.dataset.state = state;       // 'info' | 'success' | 'error'
  fb.textContent = text;
}

function busy(card, isBusy) {
  // The Remove button's enabled state is owned by setBadge (it depends on
  // whether a key exists), so don't let the generic busy-toggle flip it back on.
  card.querySelectorAll('button, input').forEach((el) => {
    if (el.classList.contains('ai-pc-remove')) return;
    el.disabled = isBusy;
  });
}

/**
 * Fetch available models from a running Ollama instance.
 * `baseUrl` is the OpenAI-compat base URL, e.g. http://localhost:11434/v1.
 * Returns an array of model name strings, or [] on failure.
 */
async function fetchOllamaModels(baseUrl) {
  try {
    const origin = new URL(baseUrl || 'http://localhost:11434/v1').origin;
    const resp = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.models || []).map((m) => m.name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Build the DOM for one provider card and wire its actions. */
function buildCard(provider, model, defaultModel) {
  const meta = PROVIDER_META[provider];
  const isLocal = !!meta.isLocal;
  const dlId = `ai-models-${provider}`;

  const card = document.createElement('div');
  card.className = 'ai-provider-card';
  card.dataset.provider = provider;
  card.innerHTML = `
    <div class="ai-pc-head">
      <img class="ai-pc-logo" src="${meta.icon}" alt="">
      <span class="ai-pc-name">${meta.label}</span>
      <span class="ai-pc-badge" data-state="off"></span>
    </div>
    <div class="ai-pc-modelrow">
      <label class="ai-pc-modellabel"></label>
      <input type="text" class="ai-pc-model-input" spellcheck="false"
             autocomplete="off" placeholder="${defaultModel || ''}"
             list="${dlId}">
      <datalist id="${dlId}">${presetsHtml(provider)}</datalist>
      ${isLocal ? `<button class="btn btn-secondary ai-pc-detect"></button>` : ''}
    </div>
    <div class="ai-pc-keyrow">
      <input type="${isLocal ? 'text' : 'password'}" class="ai-pc-input"
             placeholder="${meta.placeholder}"
             autocomplete="off" spellcheck="false"
             aria-label="${meta.label} ${isLocal ? 'Base URL' : 'API key'}">
      <button class="btn btn-primary ai-pc-save"></button>
      <button class="btn btn-secondary ai-pc-test"></button>
    </div>
    <div class="ai-pc-feedback" hidden></div>
    <div class="ai-pc-footer">
      <a class="ai-pc-getkey" href="#" data-href="${meta.console}"></a>
      <button class="ai-pc-remove" disabled></button>
    </div>
  `;

  const input      = card.querySelector('.ai-pc-input');
  const modelInput = card.querySelector('.ai-pc-model-input');
  const saveBtn    = card.querySelector('.ai-pc-save');
  const testBtn    = card.querySelector('.ai-pc-test');
  const getKey     = card.querySelector('.ai-pc-getkey');
  const removeBtn  = card.querySelector('.ai-pc-remove');
  const detectBtn  = card.querySelector('.ai-pc-detect');
  const datalist   = card.querySelector('datalist');
  // O provedor local preenche a lista pelo Detect; os outros ja nascem com os
  // presets da casa (main/ai/provider.js, MODEL_PRESETS), que sao sugestao e
  // nao cerco: qualquer id digitado continua valendo.

  // i18n: bind via data-i18n + a real English fallback (NOT the raw key). These
  // cards are built imperatively, possibly BEFORE the locale catalog finishes
  // loading, so a plain tr() would bake the key path in. data-i18n lets
  // applyDOM() (called on the host below, and again on every locale change)
  // resolve them once the catalog is ready, while the fallback shows clean
  // English in the meantime instead of a raw `modal.settings.aiSave` string.
  const bindI18n = (el, key, fallback) => { el.setAttribute('data-i18n', key); el.textContent = fallback; };
  bindI18n(saveBtn,   'modal.settings.aiSave',   'Save');
  bindI18n(testBtn,   'modal.settings.aiTest',   'Test');
  bindI18n(removeBtn, 'modal.settings.aiRemove', 'Remove key');
  bindI18n(getKey,    'modal.settings.aiGetKey', 'Get a key');
  bindI18n(card.querySelector('.ai-pc-modellabel'), 'modal.settings.aiModel', 'Model');
  if (detectBtn) detectBtn.textContent = 'Detect';
  modelInput.value = model || '';

  setBadge(card, false);

  // Model override, committed on change (blur / Enter).
  modelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modelInput.blur(); }
  });
  modelInput.addEventListener('change', async () => {
    try {
      const r = await window.aiAPI.setModel(provider, modelInput.value.trim());
      if (r && r.ok) {
        modelInput.value = r.model || '';
        setFeedback(card, 'info', tr('modal.settings.aiModelSet'));
        window.dispatchEvent(new CustomEvent('aurora-ai-settings-changed'));
      } else {
        setFeedback(card, 'error', (r && r.error) || 'Failed to set model');
      }
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    }
  });

  // Detect button (Ollama only), fetches available models and fills the datalist.
  if (detectBtn && datalist) {
    detectBtn.addEventListener('click', async () => {
      detectBtn.disabled = true;
      setFeedback(card, 'info', 'Detecting models…');
      const baseUrl = input.value.trim() || meta.placeholder;
      const names = await fetchOllamaModels(baseUrl);
      if (names.length) {
        datalist.innerHTML = names.map((n) => `<option value="${n}"></option>`).join('');
        if (!modelInput.value) modelInput.value = names[0];
        setFeedback(card, 'success', `Found: ${names.join(', ')}`);
      } else {
        setFeedback(card, 'error', 'No models found — is Ollama running?');
      }
      detectBtn.disabled = false;
    });
  }

  // Save, for local providers persists the base URL (keeps it visible so the
  // user can edit it); for cloud providers clears the field after saving.
  saveBtn.addEventListener('click', async () => {
    const raw = input.value.trim();
    const value = isLocal ? (raw || meta.placeholder) : raw;
    if (!value) {
      setFeedback(card, 'error', tr('modal.settings.aiEnterKey'));
      return;
    }
    busy(card, true);
    setFeedback(card, 'info', '…');
    try {
      const r = await window.aiAPI.setKey(provider, value);
      if (r && r.ok) {
        if (!isLocal) input.value = '';
        setBadge(card, true);
        setFeedback(card, 'success', tr('modal.settings.aiSaved'));
        window.dispatchEvent(new CustomEvent('aurora-ai-settings-changed'));
      } else {
        setFeedback(card, 'error', (r && r.error) || 'Failed to save');
      }
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    } finally {
      busy(card, false);
    }
  });

  // Test, exercises the *stored* configuration with a tiny request.
  testBtn.addEventListener('click', async () => {
    busy(card, true);
    setFeedback(card, 'info', tr('modal.settings.aiTesting'));
    try {
      const r = await window.aiAPI.testConnection(provider);
      if (r && r.ok) {
        setFeedback(card, 'success', tr('modal.settings.aiTestOk', { ms: r.latencyMs ?? '?' }));
      } else {
        setFeedback(card, 'error', (r && r.error) || 'Connection failed');
      }
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    } finally {
      busy(card, false);
    }
  });

  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true; // guard against a double-click during the op
    busy(card, true);
    try {
      await window.aiAPI.clearKey(provider);
      if (isLocal) input.value = '';
      setBadge(card, false);
      setFeedback(card, 'info', tr('modal.settings.aiRemoved'));
      window.dispatchEvent(new CustomEvent('aurora-ai-settings-changed'));
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    } finally {
      busy(card, false);
    }
  });

  // "Get a key" / site link, opens in system browser.
  getKey.addEventListener('click', (e) => {
    e.preventDefault();
    electronAPI?.openExternal?.(meta.console);
  });

  return card;
}

/** Pull the live key-configured status and reflect it on every card. */
async function refreshStatuses() {
  if (!window.aiAPI) return;
  let configured = {};
  try {
    const r = await window.aiAPI.getKeyStatus();
    configured = r?.configured || {};
  } catch (_) { /* leave every card "not configured" */ }
  for (const provider of Object.keys(PROVIDER_META)) {
    const card = cardFor(provider);
    if (card) setBadge(card, !!configured[provider]);
  }
}

/**
 * Build the provider cards and start tracking key status. Safe to call
 * once at renderer boot, the cards live inside the (always-present,
 * just-hidden) Settings modal markup.
 */
export async function initAiSettings() {
  await carregarPresets();
  const host = document.getElementById('ai-provider-cards');
  if (!host || !window.aiAPI) return;

  let providers = [];
  try {
    const r = await window.aiAPI.listProviders();
    providers = r?.providers || [];
  } catch (_) { /* fall through — host stays empty */ }

  host.innerHTML = '';
  for (const p of providers) {
    if (!PROVIDER_META[p.name]) continue;
    host.appendChild(buildCard(p.name, p.model, p.defaultModel));
  }
  // Resolve the data-i18n bindings on the freshly-built cards. applyDOM is a
  // no-op for keys whose catalog isn't loaded yet (the English fallback stays),
  // and boot()/locale-change run it again, so the labels are always correct.
  try { window.i18nApplyDOM?.(host); } catch (_) { /* i18n optional */ }

  await refreshStatuses();

  // Re-sync the badges each time the user lands on the AI tab, a key
  // could have been changed from DevTools or another window.
  document
    .querySelector('.settings-nav-item[data-pane="ai"]')
    ?.addEventListener('click', refreshStatuses);

  // Keep button/label text correct after a locale switch.
  window.addEventListener('aurora:locale-changed', () => {
    document.querySelectorAll('.ai-provider-card').forEach((card) => {
      card.querySelector('.ai-pc-save').textContent       = tr('modal.settings.aiSave');
      card.querySelector('.ai-pc-test').textContent       = tr('modal.settings.aiTest');
      card.querySelector('.ai-pc-remove').textContent     = tr('modal.settings.aiRemove');
      card.querySelector('.ai-pc-getkey').textContent     = tr('modal.settings.aiGetKey');
      card.querySelector('.ai-pc-modellabel').textContent = tr('modal.settings.aiModel');
      const configured = card.querySelector('.ai-pc-badge').dataset.state === 'on';
      setBadge(card, configured);
    });
  });
}
