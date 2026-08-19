// aurora_settings.js
import { electronAPI } from '../app/electron_api.js';
import { setTooltipsEnabled } from '../ui/tooltip.js';
import { showDialog } from '../ui/dialog_manager.js';
import { avisoLigado, definirAviso, CHAVE_AVISO } from '../ui/network_watch.js';

document.addEventListener('DOMContentLoaded', () => {
    const settingsButton = document.getElementById('aurora-settings');
    const modalOverlay = document.getElementById('settings-modal');
    if (!settingsButton || !modalOverlay) return;

    const closeModalButton = document.getElementById('close-modal-btn');
    const saveButton = document.getElementById('save-settings-btn');
    const resetButton = document.getElementById('reset-settings-btn');
    const shortcutList = document.getElementById('shortcut-list');
    const shortcutWarning = document.getElementById('shortcut-warning');
    const tooltipsToggle = document.getElementById('tooltips-toggle');
    const auroraBgToggle = document.getElementById('aurora-bg-toggle');
    const trustLinksToggle = document.getElementById('trust-links-toggle');
    const networkWarnToggle = document.getElementById('network-warning-toggle');

    const SHORTCUTS_STORAGE_KEY = 'aurora-shortcuts';
    const SETTINGS_STORAGE_KEY = 'aurora-settings';
    // Shared with the AI chat's link-warning checkbox so the two stay linked.
    const TRUST_LINKS_KEY = 'aurora-ai-trust-external-links';

    // i18n note: labels resolved at render time via SHORTCUT_LABEL_KEYS,
    // not stored here, so locale switches update the UI without touching
    // localStorage-persisted shortcuts.
    const defaultShortcuts = {
        'newFile':      { ctrlKey: true,  shiftKey: false, altKey: false, key: 'N' },
        'compileAll':   { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'B' },
        'closeTab':     { ctrlKey: true,  shiftKey: false, altKey: false, key: 'W' },
        'reopenTab':    { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'T' },
        'saveFile':     { ctrlKey: true,  shiftKey: false, altKey: false, key: 'S' },
        'saveAllFiles': { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'S' },
        'openSettings': { ctrlKey: true,  shiftKey: true,  altKey: false, key: 'C' }
    };

    const SHORTCUT_LABEL_KEYS = {
        'newFile':      'shortcuts.newFile',
        'compileAll':   'shortcuts.compileAll',
        'closeTab':     'shortcuts.closeTab',
        'reopenTab':    'shortcuts.reopenTab',
        'saveFile':     'shortcuts.saveFile',
        'saveAllFiles': 'shortcuts.saveAllFiles',
        'openSettings': 'shortcuts.openSettings'
    };

    const tr = (key) => (window.t ? window.t(key) : key);

    const defaultSettings = {
        tooltipsEnabled: true,
        verboseMode: false,
        // Fundo aurora da Welcome: DESLIGADO por padrao. E um shader em GPU
        // rodando em laco continuo; numa maquina fraca ou numa bateria ele
        // custa caro por um efeito puramente decorativo, entao quem quiser
        // liga de proposito.
        auroraBackground: false
    };

    let currentShortcuts = {};
    let currentSettings = {};
    /** Esta abertura terminou em Salvar? Fechar sem isso descarta. */
    let salvouNestaAbertura = false;
    /** Valor do trust-links quando o painel abriu, para poder ser devolvido. */
    let trustLinksSnapshot = null;
    /** Idem para o aviso de rede, que tambem escreve no ato. */
    let networkWarnSnapshot = null;

    /**
     * Carrega configurações do localStorage (ou usa defaults) e aplica ao UI.
     */
    const loadSettings = () => {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        currentSettings = stored ? JSON.parse(stored) : { ...defaultSettings };

        // Apply to UI toggles (safely)
        if (tooltipsToggle) tooltipsToggle.checked = !!currentSettings.tooltipsEnabled;
        if (auroraBgToggle) auroraBgToggle.checked = !!currentSettings.auroraBackground;
        // Trust-external-links lives on its own shared key (not the settings
        // JSON) so the AI link-warning checkbox and this toggle are linked.
        if (trustLinksToggle) trustLinksToggle.checked = localStorage.getItem(TRUST_LINKS_KEY) === '1';
        // O aviso de rede tem chave propria e efeito imediato, como o
        // trust-links: nao ha o que "aplicar" ao salvar, ele so passa a valer
        // na proxima queda.
        if (networkWarnToggle) networkWarnToggle.checked = avisoLigado();

        // Aplica estado dos tooltips imediatamente
        setTooltipsEnabled(!!currentSettings.tooltipsEnabled);
        applyAuroraBackground(!!currentSettings.auroraBackground);
    };

    /**
     * Liga ou desliga o fundo aurora da Welcome.
     *
     * Marca o estado num atributo do <html> em vez de mexer no componente:
     * a <aurora-welcome> pode nem existir ainda (so aparece sem projeto
     * aberto) e pode ser recriada depois. Como atributo global, o CSS ja
     * encontra o estado certo em qualquer momento em que ela montar, e o
     * proprio componente escuta o evento para parar o laco de render.
     */
    const applyAuroraBackground = (on) => {
        document.documentElement.toggleAttribute('data-aurora-bg', !!on);
        window.dispatchEvent(new CustomEvent('aurora:background-toggled', { detail: { enabled: !!on } }));
    };

    /**
     * Salva configurações no localStorage e notifica a aplicação.
     */
    const saveSettings = () => {
        currentSettings.tooltipsEnabled = tooltipsToggle?.checked ?? true;
        currentSettings.auroraBackground = auroraBgToggle?.checked ?? false;

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
        // Evento global para quem quiser reagir às mudanças de settings
        window.dispatchEvent(new CustomEvent('aurora-settings-updated', { detail: currentSettings }));

        // Notifica especificamente sobre tooltips
        setTooltipsEnabled(currentSettings.tooltipsEnabled);
        applyAuroraBackground(currentSettings.auroraBackground);
    };

    // Efeito imediato, sem esperar o Salvar: o usuario liga e ve na hora.
    if (auroraBgToggle) {
        auroraBgToggle.addEventListener('change', () => {
            applyAuroraBackground(auroraBgToggle.checked);
        });
    }

    // Listener para toggles com efeito imediato
    if (tooltipsToggle) {
        tooltipsToggle.addEventListener('change', () => {
            setTooltipsEnabled(tooltipsToggle.checked);
        });
    }

    // Trust-external-links: applies immediately (a bypass preference), writing
    // the SAME key the AI link-warning checkbox uses and broadcasting so both
    // stay in sync without a Save round-trip.
    if (networkWarnToggle) {
        networkWarnToggle.addEventListener('change', () => definirAviso(networkWarnToggle.checked));
    }

    if (trustLinksToggle) {
        trustLinksToggle.addEventListener('change', () => {
            localStorage.setItem(TRUST_LINKS_KEY, trustLinksToggle.checked ? '1' : '0');
            window.dispatchEvent(new CustomEvent('aurora:trust-external-links-changed',
                { detail: { value: trustLinksToggle.checked } }));
        });
    }
    window.addEventListener('aurora:trust-external-links-changed', (e) => {
        if (trustLinksToggle) trustLinksToggle.checked = !!e.detail?.value;
    });

    // ---- Shortcuts UI / gravação ----
    const formatShortcutText = ({ ctrlKey, shiftKey, altKey, key }) => {
        if (!key) return tr('shortcuts.notSet');
        const parts = [];
        if (ctrlKey) parts.push('Ctrl');
        if (shiftKey) parts.push('Shift');
        if (altKey) parts.push('Alt');
        parts.push(key.length === 1 ? key.toUpperCase() : key);
        return parts.join(' + ');
    };

    const renderShortcuts = () => {
        if (!shortcutList) return;
        shortcutList.innerHTML = '';
        for (const action in currentShortcuts) {
            const item = document.createElement('div');
            item.className = 'shortcut-item';
            const labelKey = SHORTCUT_LABEL_KEYS[action] || action;
            item.innerHTML = `
                <span class="action">${tr(labelKey)}</span>
                <div class="shortcut-input" data-action="${action}" tabindex="0">${formatShortcutText(currentShortcuts[action])}</div>
            `;
            shortcutList.appendChild(item);
        }
    };

    // Re-render the shortcut list whenever the locale flips, otherwise
    // the action labels and "Not Set" placeholder would stay stuck in
    // the previously-active language.
    window.addEventListener('aurora:locale-changed', () => {
        if (modalOverlay.classList.contains('visible')) renderShortcuts();
    });

    let recordingInput = null;
    let activeKeys = new Set();
    const isModifier = (key) => ['Control', 'Shift', 'Alt', 'Meta'].includes(key);

    const stopRecording = () => {
        if (!recordingInput) return;
        document.removeEventListener('keydown', handleRecordingKeyDown, { capture: true });
        document.removeEventListener('keyup', handleRecordingKeyUp, { capture: true });
        recordingInput.classList.remove('recording');
        const action = recordingInput.dataset.action;
        recordingInput.textContent = formatShortcutText(currentShortcuts[action]);
        recordingInput = null;
        activeKeys.clear();
    };

    const handleRecordingKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isModifier(e.key)) activeKeys.add(e.key.toUpperCase());
        if (e.ctrlKey) activeKeys.add('Control');
        if (e.shiftKey) activeKeys.add('Shift');
        if (e.altKey) activeKeys.add('Alt');

        const parts = [];
        if (activeKeys.has('Control')) parts.push('Ctrl');
        if (activeKeys.has('Shift')) parts.push('Shift');
        if (activeKeys.has('Alt')) parts.push('Alt');
        const mainKey = Array.from(activeKeys).find(k => !isModifier(k));
        if (mainKey) parts.push(mainKey);

        if (recordingInput) recordingInput.textContent = parts.join(' + ');
    };

    const isShortcutDuplicate = (newShortcut, actionToExclude) => {
        for (const action in currentShortcuts) {
            if (action === actionToExclude) continue;
            const existing = currentShortcuts[action];
            if (existing.key === newShortcut.key && existing.ctrlKey === newShortcut.ctrlKey &&
                existing.shiftKey === newShortcut.shiftKey && existing.altKey === newShortcut.altKey) {
                return true;
            }
        }
        return false;
    };

    const handleRecordingKeyUp = (e) => {
        if (!recordingInput) return;

        e.preventDefault();
        e.stopPropagation();
        if (activeKeys.size === 0) return;

        const finalShortcut = {
            ctrlKey: activeKeys.has('Control'),
            shiftKey: activeKeys.has('Shift'),
            altKey: activeKeys.has('Alt'),
            key: Array.from(activeKeys).find(k => !isModifier(k) && k.toUpperCase() !== 'ESCAPE')
        };

        if (!finalShortcut.key) return;

        const action = recordingInput.dataset.action;
        if (isShortcutDuplicate(finalShortcut, action)) {
            if (shortcutWarning) {
                shortcutWarning.style.display = 'block';
                setTimeout(() => { if (shortcutWarning) shortcutWarning.style.display = 'none'; }, 2500);
            }
        } else {
            currentShortcuts[action] = finalShortcut;
            if (shortcutWarning) shortcutWarning.style.display = 'none';
        }
        stopRecording();
    };

    if (shortcutList) {
        shortcutList.addEventListener('click', (e) => {
            const target = e.target.closest('.shortcut-input');
            if (!target) return;
            if (recordingInput) stopRecording();

            recordingInput = target;
            recordingInput.textContent = tr('shortcuts.recording');
            recordingInput.classList.add('recording');

            document.addEventListener('keydown', handleRecordingKeyDown, { capture: true });
            document.addEventListener('keyup', handleRecordingKeyUp, { capture: true });
        });
    }

    // ---- Sidebar nav (tabs → panes) ----
    //
    // The redesigned settings modal uses a vertical sidebar with five
    // sections (General / Appearance / Language / Terminal / Shortcuts).
    // Clicking a .settings-nav-item activates its matching .settings-pane
    // by `data-pane`. We rely on the `hidden` attribute (not just a
    // class) so screen readers correctly skip inactive panes; the visual
    // active state lives on a class so transitions stay snappy.
    const navButtons = modalOverlay.querySelectorAll('.settings-nav-item');
    const panes = modalOverlay.querySelectorAll('.settings-pane');
    const navContainer = modalOverlay.querySelector('.settings-nav');

    // A single highlight pill that GLIDES to the active section (the same
    // affordance as the terminal tab bar). Replaces the per-item .active::before
    // accent bar so the highlight slides instead of popping between items.
    const positionNavIndicator = (activeBtn, animate = true) => {
        if (!navContainer || !activeBtn) return;
        let ind = navContainer.querySelector(':scope > .settings-nav-indicator');
        if (!ind) {
            ind = document.createElement('div');
            ind.className = 'settings-nav-indicator';
            navContainer.insertBefore(ind, navContainer.firstChild);
        }
        if (!animate) ind.style.transition = 'none';
        ind.style.height = `${activeBtn.offsetHeight}px`;
        ind.style.transform = `translateY(${activeBtn.offsetTop}px)`;
        ind.classList.add('visible');
        if (!animate) {
            // Re-enable the transition after the instant placement settles.
            requestAnimationFrame(() => { ind.style.transition = ''; });
        }
    };

    const setActivePane = (name) => {
        let activeBtn = null;
        navButtons.forEach((btn) => {
            const isActive = btn.dataset.pane === name;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
            if (isActive) activeBtn = btn;
        });
        panes.forEach((pane) => {
            const isActive = pane.dataset.pane === name;
            pane.classList.toggle('active', isActive);
            if (isActive) pane.removeAttribute('hidden');
            else pane.setAttribute('hidden', '');
        });
        // Animate unless the modal isn't visible yet (first open → place instantly).
        positionNavIndicator(activeBtn, modalOverlay.classList.contains('visible'));
    };

    navButtons.forEach((btn) => {
        btn.addEventListener('click', () => setActivePane(btn.dataset.pane));
    });

    // ---- Modal open/close and persistence ----
    const openModal = () => {
        currentShortcuts = {
            ...JSON.parse(JSON.stringify(defaultShortcuts)),
            ...(JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) || {}),
        };
        loadSettings();
        renderShortcuts();
        // O que reverter, se esta abertura terminar sem salvar.
        salvouNestaAbertura = false;
        trustLinksSnapshot = localStorage.getItem(TRUST_LINKS_KEY);
        networkWarnSnapshot = localStorage.getItem(CHAVE_AVISO);
        // Display BEFORE picking the pane so the nav items have a real layout:
        // otherwise the sliding pill measures offsetTop/Height on a display:none
        // modal (both 0) and lands nowhere on first open.
        modalOverlay.style.display = 'flex';
        // Always land on General when re-opening, the previous pane is
        // not worth persisting across sessions, and it avoids the
        // surprise of "I closed it on Shortcuts and now it opens on
        // Shortcuts forever". The pill is placed instantly here (modal not yet
        // .visible) so it's already on General when the modal fades in.
        setActivePane('general');
        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    };

    // Abrir as configuracoes ja numa aba, de fora deste modulo. Existe para o
    // terminal poder transformar "componente ausente" num clique que leva
    // direto ao painel de Componentes, em vez de instrucao para navegar a mao.
    // O clique no item da navegacao (e nao setActivePane) e proposital: os
    // paineis que se redesenham ao ganhar foco escutam esse clique.
    window.auroraAbrirConfiguracoes = (pane) => {
        openModal();
        if (pane) {
            document.querySelector(`[data-pane="${pane}"].settings-nav-item`)?.click();
        }
    };

    /**
     * Devolve tudo ao que esta gravado em disco.
     *
     * Vários toggles aqui têm efeito imediato, de propósito: o usuário liga e vê
     * na hora. O problema era que fechar sem salvar deixava aquele efeito
     * valendo, então "não salvei" e "não mudou" deixavam de ser a mesma coisa, e
     * na abertura seguinte o painel mostrava o estado gravado enquanto a
     * interface mostrava o descartado. Descartar de verdade é reler o disco e
     * reaplicar, que é exatamente o que loadSettings faz.
     */
    const descartarAlteracoes = () => {
        // O trust-links mora numa chave própria e é escrito no ato, para ficar
        // em sincronia com a caixa equivalente no painel de IA. Por isso ele
        // precisa ser devolvido à mão, e a sincronia reavisada.
        if (networkWarnSnapshot !== null) definirAviso(networkWarnSnapshot !== '0');
        if (trustLinksSnapshot !== null) {
            localStorage.setItem(TRUST_LINKS_KEY, trustLinksSnapshot);
            window.dispatchEvent(new CustomEvent('aurora:trust-external-links-changed',
                { detail: { value: trustLinksSnapshot === '1' } }));
        }
        currentShortcuts = {
            ...JSON.parse(JSON.stringify(defaultShortcuts)),
            ...(JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) || {}),
        };
        loadSettings();
        renderShortcuts();
    };

    const closeModal = () => {
        stopRecording();
        // Fechar sem salvar descarta. Sair pelo X, pelo Esc ou clicando fora
        // são todos "não salvei".
        if (!salvouNestaAbertura) descartarAlteracoes();
        modalOverlay.classList.remove('visible');
        setTimeout(() => modalOverlay.style.display = 'none', 300);
    };

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(currentShortcuts));
            saveSettings();
            window.dispatchEvent(new CustomEvent('aurora-shortcuts-updated'));
            salvouNestaAbertura = true;
            closeModal();
        });
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            currentShortcuts = JSON.parse(JSON.stringify(defaultShortcuts));
            currentSettings = { ...defaultSettings };
            loadSettings();
            renderShortcuts();
        });
    }

    settingsButton.addEventListener('click', openModal);
    if (closeModalButton) closeModalButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => (e.target === modalOverlay) && closeModal());
    document.addEventListener('keydown', (e) => (e.key === 'Escape' && modalOverlay.classList.contains('visible')) && closeModal());

    // ---- Inicialização ----
    loadSettings();

    // ---- About pane wiring ----
    //
    // Version badge: filled once on DOMContentLoaded so the value is in
    // place even before the user opens the modal, avoiding a flash of
    // the em-dash placeholder. The string from package.json may or may
    // not carry the leading "v", so we normalise it.
    const aboutVersion = document.getElementById('about-version');
    if (aboutVersion && electronAPI?.getAppVersion) {
        electronAPI.getAppVersion()
            .then((v) => {
                if (v) aboutVersion.textContent = 'v' + String(v).replace(/^v/i, '');
            })
            .catch(() => { /* keep the placeholder */ });
    }

    // ---- Update-system health ----
    //
    // Why this panel exists: SAPHO is installed once on a fleet of lab
    // machines and updated only over the network. When one of them stops
    // updating, the maintainer is not standing at it, so "is it checking at
    // all, against which channel, and what failed last?" has to be readable
    // from inside the app instead of from main.log on that machine's disk.
    //
    // Everything here is a snapshot pulled on demand; there is no live
    // subscription, because the panel is only visible while the modal is open.
    const updatesCard = document.getElementById('about-updates');
    if (updatesCard && electronAPI?.getUpdateDiagnostics) {
        const tr = (key, fallback, vars) => {
            const s = window.t ? window.t(key, vars) : null;
            if (s && s !== key) return s;
            return String(fallback).replace(/\{\{(\w+)\}\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
        };

        /** "3 min ago" / "in 2 h", coarse on purpose; exact clock times add noise. */
        const relative = (timestamp, future) => {
            if (!timestamp) return tr('modal.settings.updNever', 'Never');
            const deltaMs = future ? timestamp - Date.now() : Date.now() - timestamp;
            const mins = Math.round(deltaMs / 60000);
            if (mins <= 0) return tr('modal.settings.updJustNow', 'Just now');
            if (mins < 60) {
                return future
                    ? tr('modal.settings.updInMinutes', 'in {{n}} min', { n: mins })
                    : tr('modal.settings.updMinutesAgo', '{{n}} min ago', { n: mins });
            }
            const hours = Math.round(mins / 60);
            return future
                ? tr('modal.settings.updInHours', 'in {{n}} h', { n: hours })
                : tr('modal.settings.updHoursAgo', '{{n}} h ago', { n: hours });
        };

        const statusLabel = (d) => {
            if (d.isDev) return tr('modal.settings.updStateDev', 'Disabled in development mode');
            if (d.downloading) return tr('modal.settings.updStateDownloading', 'Downloading update');
            if (d.updateAvailable) return tr('modal.settings.updStateAvailable', 'Update available');
            if (d.checking) return tr('modal.settings.updStateChecking', 'Checking…');
            // A single blip is normal and self-heals via the backoff; only a
            // repeated failure is worth alarming the user about.
            if (d.consecutiveFailures > 1) {
                return tr('modal.settings.updStateFailing', 'Cannot reach the update server');
            }
            return tr('modal.settings.updStateIdle', 'Up to date');
        };

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const refreshDiagnostics = () => electronAPI.getUpdateDiagnostics()
            .then((d) => {
                if (!d) return;
                setText('upd-status', statusLabel(d));
                setText('upd-last-check', relative(d.lastCheckAt, false));
                setText('upd-next-check', d.nextCheckAt ? relative(d.nextCheckAt, true) : '—');
                setText('upd-channel', d.feed || '—');
                const errRow = document.getElementById('upd-error-row');
                if (errRow) {
                    // Only show the error row when the error is still the most
                    // recent thing that happened, a stale error under a
                    // successful check reads as a live problem when it is not.
                    const errIsCurrent = !!d.lastError && d.lastCheckResult === 'error';
                    errRow.hidden = !errIsCurrent;
                    if (errIsCurrent) setText('upd-last-error', d.lastError);
                }
            })
            .catch(() => { /* diagnostics are informational; never break the modal */ });

        // Refresh whenever the modal opens, so the numbers are never stale.
        settingsButton.addEventListener('click', refreshDiagnostics);
        refreshDiagnostics();

        document.getElementById('upd-check-now')?.addEventListener('click', () => {
            electronAPI.checkForUpdates?.();
            // The check is asynchronous; re-read shortly after so the panel
            // reflects the attempt rather than the pre-click state.
            setTimeout(refreshDiagnostics, 1500);
        });
        document.getElementById('upd-open-log')?.addEventListener('click', () => {
            electronAPI.openUpdateLog?.();
        });
    }

    // External links: a plain <a href> would navigate this renderer
    // window (Electron treats it as a navigation, not a "open in browser"
    // intent). Each .about-link stores its destination in data-href and
    // delegates to openExternal so the link lands in the user's browser.
    modalOverlay.querySelectorAll('.about-link[data-href]').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const href = a.getAttribute('data-href');
            if (href) electronAPI?.openExternal?.(href);
        });
    });

    // Manual offline. Fica fora do esquema data-href acima porque openExternal
    // recusa file:// de proposito: o destino e montado no processo principal,
    // que nao recebe caminho nenhum daqui.
    const offlineLink = modalOverlay.querySelector('#about-docs-offline');
    if (offlineLink && electronAPI?.docsStatus) {
        const meta = modalOverlay.querySelector('#about-docs-offline-meta');

        electronAPI.docsStatus()
            .then((s) => {
                // Sem pacote instalado o item continua oculto, e sobra apenas o
                // manual online, melhor do que um botao que nao faz nada.
                if (!s?.hasOffline) return;
                offlineLink.hidden = false;
                if (meta) meta.textContent = s.version ? `versão ${s.version}` : 'no computador';
            })
            .catch(() => { /* mantem oculto */ });

        offlineLink.addEventListener('click', async (e) => {
            e.preventDefault();
            // Quem tem navegador ganha abas, busca e favoritos de graca; quem
            // nao tem, ou esta numa maquina com a associacao de .html removida,
            // le na janela propria da AURORA. Como nao da para saber qual e o
            // caso daqui, quem escolhe e o usuario.
            const onde = await showDialog({
                title: 'Abrir o manual',
                message: 'No navegador voce ganha abas, busca e favoritos. '
                    + 'Na AURORA o manual abre numa janela nossa, sem depender '
                    + 'de navegador nenhum.',
                variant: 'info',
                buttons: [
                    { label: 'Na AURORA',    action: 'aurora',  type: 'cancel' },
                    { label: 'No navegador', action: 'browser', type: 'save' },
                ],
            });
            // Fechar no X ou no Esc nao e escolha: nao abre nada.
            if (onde !== 'aurora' && onde !== 'browser') return;
            electronAPI.docsOpenOffline?.(onde);
        });
    }

    // Procura documentacao mais nova uma vez por sessao, quando o painel abre.
    // Nao roda na inicializacao para nao competir por rede com o que o usuario
    // esta esperando ao abrir o aplicativo. Se achar versao nova, ela vale na
    // proxima vez que o manual for aberto.
    let updateChecked = false;
    if (electronAPI?.docsCheckUpdate) {
        settingsButton.addEventListener('click', () => {
            if (updateChecked) return;
            updateChecked = true;
            electronAPI.docsCheckUpdate()
                .then((r) => {
                    if (!r?.updated || !offlineLink) return;
                    // A copia trocou embaixo do painel ja aberto; reflete agora
                    // para o rotulo nao mentir a versao.
                    offlineLink.hidden = false;
                    const m = modalOverlay.querySelector('#about-docs-offline-meta');
                    if (m && r.version) m.textContent = `versão ${r.version}`;
                })
                .catch(() => { /* segue com o que ja tem */ });
        });
    }
});
