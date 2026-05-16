/**
 * ai_settings.js — the "AI Assistant" pane of the Settings modal.
 *
 * Bring-your-own-key (BYOK) management: one card per provider. The user
 * doesn't choose "which AI" in a separate step — each card *is* a
 * provider, so they just paste the key into the card for the service
 * they have an account with and hit Save.
 *
 * The key flows renderer → main once (on Save), where `keystore`
 * encrypts it with the OS keychain. It is never read back into the
 * renderer — the UI only ever learns "configured / not configured".
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
};

const tr = (key, params) => (window.t ? window.t(key, params) : key);

/** Map a card's data-provider id back to its DOM card. */
function cardFor(provider) {
  return document.querySelector(`.ai-provider-card[data-provider="${provider}"]`);
}

function setBadge(card, configured) {
  const badge = card.querySelector('.ai-pc-badge');
  badge.dataset.state = configured ? 'on' : 'off';
  badge.textContent = configured
    ? tr('modal.settings.aiConfigured')
    : tr('modal.settings.aiNotConfigured');
  card.querySelector('.ai-pc-remove').hidden = !configured;
}

function setFeedback(card, state, text) {
  const fb = card.querySelector('.ai-pc-feedback');
  if (!text) { fb.hidden = true; fb.textContent = ''; return; }
  fb.hidden = false;
  fb.dataset.state = state;       // 'info' | 'success' | 'error'
  fb.textContent = text;
}

function busy(card, isBusy) {
  card.querySelectorAll('button, input').forEach((el) => { el.disabled = isBusy; });
}

/** Build the DOM for one provider card and wire its actions. */
function buildCard(provider, model, defaultModel) {
  const meta = PROVIDER_META[provider];
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
             autocomplete="off" placeholder="${defaultModel || ''}">
    </div>
    <div class="ai-pc-keyrow">
      <input type="password" class="ai-pc-input" placeholder="${meta.placeholder}"
             autocomplete="off" spellcheck="false" aria-label="${meta.label} API key">
      <button class="btn btn-primary ai-pc-save"></button>
      <button class="btn btn-secondary ai-pc-test"></button>
    </div>
    <div class="ai-pc-feedback" hidden></div>
    <div class="ai-pc-footer">
      <a class="ai-pc-getkey" href="#" data-href="${meta.console}"></a>
      <button class="ai-pc-remove" hidden></button>
    </div>
  `;

  const input      = card.querySelector('.ai-pc-input');
  const modelInput = card.querySelector('.ai-pc-model-input');
  const saveBtn    = card.querySelector('.ai-pc-save');
  const testBtn    = card.querySelector('.ai-pc-test');
  const getKey     = card.querySelector('.ai-pc-getkey');
  const removeBtn  = card.querySelector('.ai-pc-remove');

  saveBtn.textContent   = tr('modal.settings.aiSave');
  testBtn.textContent   = tr('modal.settings.aiTest');
  removeBtn.textContent = tr('modal.settings.aiRemove');
  getKey.textContent    = tr('modal.settings.aiGetKey');
  card.querySelector('.ai-pc-modellabel').textContent = tr('modal.settings.aiModel');
  modelInput.value = model || '';

  setBadge(card, false);

  // Model override — committed on change (blur / Enter). An empty value
  // clears the override; main echoes back the effective model so the
  // field re-fills with the built-in default rather than going blank.
  modelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modelInput.blur(); }
  });
  modelInput.addEventListener('change', async () => {
    try {
      const r = await window.aiAPI.setModel(provider, modelInput.value.trim());
      if (r && r.ok) {
        modelInput.value = r.model || '';
        setFeedback(card, 'info', tr('modal.settings.aiModelSet'));
      } else {
        setFeedback(card, 'error', (r && r.error) || 'Failed to set model');
      }
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    }
  });

  // Save — persist the typed key, then clear the field (we never want a
  // plaintext key lingering in a DOM node).
  saveBtn.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      setFeedback(card, 'error', tr('modal.settings.aiEnterKey'));
      return;
    }
    busy(card, true);
    setFeedback(card, 'info', '…');
    try {
      const r = await window.aiAPI.setKey(provider, value);
      if (r && r.ok) {
        input.value = '';
        setBadge(card, true);
        setFeedback(card, 'success', tr('modal.settings.aiSaved'));
      } else {
        setFeedback(card, 'error', (r && r.error) || 'Failed to save key');
      }
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    } finally {
      busy(card, false);
    }
  });

  // Test — exercises the *stored* key with a tiny request.
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
    busy(card, true);
    try {
      await window.aiAPI.clearKey(provider);
      setBadge(card, false);
      setFeedback(card, 'info', tr('modal.settings.aiRemoved'));
    } catch (e) {
      setFeedback(card, 'error', e?.message || String(e));
    } finally {
      busy(card, false);
    }
  });

  // "Get a key" opens the provider's console in the system browser —
  // a bare <a href> would navigate this renderer window instead.
  getKey.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI?.openExternal?.(meta.console);
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
 * once at renderer boot — the cards live inside the (always-present,
 * just-hidden) Settings modal markup.
 */
export async function initAiSettings() {
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

  await refreshStatuses();

  // Re-sync the badges each time the user lands on the AI tab — a key
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
