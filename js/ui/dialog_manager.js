/**
 * @file Centralized confirm/alert dialog, one of TWO canonical UI surfaces.
 *       Shape:
 *         await showDialog({
 *           title:   'Close Project',
 *           message: 'Are you sure?',
 *           variant: 'warning',  // optional: info | warning | error | success
 *           buttons: [
 *             { label: 'Cancel',        action: 'cancel',  type: 'cancel' },
 *             { label: 'Close Project', action: 'confirm', type: 'save'   }
 *           ]
 *         });
 *       Returns the action string of whichever button was pressed (or 'cancel'
 *       on Esc / backdrop click).
 *
 *       Allowed `type` values: cancel | save | dont-save | danger
 *       Allowed `variant` values: info | warning | error | success
 *
 *       `ajuda` (opcional) e uma chave da tabela de js/ui/help_link.js: o
 *       dialogo ganha o mesmo `?` dos modais, no canto do cabecalho. Ele NAO
 *       fecha o dialogo, de proposito: um aviso de componente ausente oferece
 *       o download ali mesmo, e ler o capitulo nao pode custar a escolha.
 */

import { abrirAjudaDe } from './help_link.js';

const VARIANT_ICONS = {
    info:    'ph ph-info',
    warning: 'ph ph-warning',
    error:   'ph ph-x-circle',
    success: 'ph ph-check-circle'
};

/**
 * O rotulo de um botao que ainda conta: "Excluir (5)" ... "Excluir (1)" e, no
 * fim, o rotulo limpo. Puro, para o teste.
 * @param {string} label
 * @param {number} restante
 */
export function rotuloComContador(label, restante) {
    return restante > 0 ? `${label} (${restante})` : label;
}

function inferVariant(buttons) {
    if (buttons?.some(b => b.type === 'danger')) return 'warning';
    return 'info';
}

export function showDialog({ title, message, buttons, variant, ajuda }) {
    return new Promise((resolve) => {
        // Replace any existing dialog
        document.querySelectorAll('.confirm-modal').forEach(el => el.remove());

        const v = variant || inferVariant(buttons);
        const iconClass = VARIANT_ICONS[v] || VARIANT_ICONS.info;

        const buttonsHTML = (buttons || []).map(btn => {
            // `primary` e o nome que oito lugares do codigo escrevem para a
            // acao principal, e ele nao estava na lista: caia no `cancel`, e o
            // botao que a pessoa deve apertar ficava com a cara do que ela
            // deve ignorar. Pior, o Enter procura `.save`/`.danger` e nao
            // achava nada. Aqui os dois nomes valem a mesma coisa.
            const pedido = btn.type === 'primary' ? 'save' : btn.type;
            const safeType = ['cancel', 'save', 'dont-save', 'danger'].includes(pedido)
                ? pedido : 'cancel';
            // `iconHtml` e opcional e vem de quem chama (hoje so o relatorio de
            // problema, que mostra a marca de cada provedor de e-mail).
            const icone = btn.iconHtml ? `${btn.iconHtml}` : '';
            // `countdown` (segundos): o botao nasce travado e conta 5, 4, 3, 2, 1
            // antes de liberar. Para acoes sem volta facil, como mandar a
            // pasta do projeto para a Lixeira: e o tempo de ler e desistir.
            const seg = Number.isInteger(btn.countdown) && btn.countdown > 0 ? btn.countdown : 0;
            const travado = seg > 0 ? ` data-countdown="${seg}" disabled` : '';
            return `<button class="confirm-btn ${safeType}" data-action="${btn.action}"${travado}>${icone}<span class="confirm-btn-label">${rotuloComContador(btn.label, seg)}</span></button>`;
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.id = 'custom-dialog-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.dataset.variant = v;
        const tr = (k) => (window.t ? window.t(k) : k);
        const ajudaHTML = ajuda
            ? `<button type="button" class="confirm-modal-help" data-ajuda="${ajuda}" aria-label="${tr('modal.help')}" title="${tr('modal.help')}"><i class="ph ph-question" aria-hidden="true"></i></button>`
            : '';

        modal.innerHTML = `
            <div class="confirm-modal-content" role="document">
                <header class="confirm-modal-header">
                    <span class="confirm-modal-icon" aria-hidden="true"><i class="${iconClass}"></i></span>
                    <h3 class="confirm-modal-title">${title || ''}</h3>
                    ${ajudaHTML}
                </header>
                <div class="confirm-modal-message">${message || ''}</div>
                <footer class="confirm-modal-actions">${buttonsHTML}</footer>
            </div>
        `;
        document.body.appendChild(modal);

        // Os relogios dos botoes com contagem. Um por botao; todos morrem no
        // cleanup, para um cancelar no meio nao deixar intervalo contando.
        const relogios = [];
        for (const b of modal.querySelectorAll('button[data-countdown]')) {
            const rotulo = (buttons || []).find((x) => x.action === b.getAttribute('data-action'))?.label || '';
            let restante = Number(b.getAttribute('data-countdown')) || 0;
            const span = b.querySelector('.confirm-btn-label');
            const id = setInterval(() => {
                restante -= 1;
                if (span) span.textContent = rotuloComContador(rotulo, restante);
                if (restante <= 0) {
                    clearInterval(id);
                    b.disabled = false;
                    b.removeAttribute('data-countdown');
                }
            }, 1000);
            relogios.push(id);
        }

        const cleanup = (action) => {
            for (const id of relogios) clearInterval(id);
            document.removeEventListener('keydown', onKey);
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(action);
            }, 220);
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                cleanup('cancel');
            } else if (e.key === 'Enter') {
                const primary = modal.querySelector('.confirm-btn.save, .confirm-btn.danger');
                // Travado pela contagem, o Enter nao atravessa.
                if (primary && !primary.disabled) {
                    cleanup(primary.getAttribute('data-action'));
                }
            }
        };

        modal.addEventListener('click', (e) => {
            const ajudaBtn = e.target.closest('button[data-ajuda]');
            if (ajudaBtn) {
                abrirAjudaDe(ajudaBtn.getAttribute('data-ajuda'));
                return;
            }
            const btn = e.target.closest('button[data-action]');
            if (btn) {
                if (btn.disabled) return;   // ainda contando
                cleanup(btn.getAttribute('data-action'));
                return;
            }
            // Click on backdrop
            if (e.target === modal) {
                cleanup('cancel');
            }
        });
        document.addEventListener('keydown', onKey);

        // Trigger transition
        requestAnimationFrame(() => {
            modal.classList.add('show');
            const primary = modal.querySelector('.confirm-btn.save, .confirm-btn.danger') ||
                            modal.querySelector('.confirm-btn');
            primary?.focus();
        });
    });
}

/**
 * Convenience: simple OK alert dialog.
 *   await showAlert('Build complete', 'success');
 */
export function showAlert(message, variant = 'info', title) {
    const titleMap = {
        info: 'Notice',
        warning: 'Warning',
        error: 'Error',
        success: 'Done'
    };
    return showDialog({
        title: title || titleMap[variant] || 'Notice',
        message,
        variant,
        buttons: [{ label: 'OK', action: 'ok', type: 'cancel' }]
    });
}

/**
 * Convenience: yes/no confirm dialog.
 *   const yes = await showConfirm('Delete?', 'This cannot be undone.', { variant: 'warning' });
 */
export function showConfirm(title, message, { variant = 'info', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
    return showDialog({
        title,
        message,
        variant,
        buttons: [
            { label: cancelLabel,  action: 'cancel',  type: 'cancel' },
            { label: confirmLabel, action: 'confirm', type: danger ? 'danger' : 'save' }
        ]
    }).then(action => action === 'confirm');
}

// Global bridge for non-module callers
if (typeof window !== 'undefined') {
    window.AuroraUI = window.AuroraUI || {};
    window.AuroraUI.dialog  = showDialog;
    window.AuroraUI.alert   = showAlert;
    window.AuroraUI.confirm = showConfirm;
}
