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
 */

const VARIANT_ICONS = {
    info:    'ph ph-info',
    warning: 'ph ph-warning',
    error:   'ph ph-x-circle',
    success: 'ph ph-check-circle'
};

function inferVariant(buttons) {
    if (buttons?.some(b => b.type === 'danger')) return 'warning';
    return 'info';
}

export function showDialog({ title, message, buttons, variant }) {
    return new Promise((resolve) => {
        // Replace any existing dialog
        document.querySelectorAll('.confirm-modal').forEach(el => el.remove());

        const v = variant || inferVariant(buttons);
        const iconClass = VARIANT_ICONS[v] || VARIANT_ICONS.info;

        const buttonsHTML = (buttons || []).map(btn => {
            const safeType = ['cancel', 'save', 'dont-save', 'danger'].includes(btn.type)
                ? btn.type : 'cancel';
            // `iconHtml` e opcional e vem de quem chama (hoje so o relatorio de
            // problema, que mostra a marca de cada provedor de e-mail).
            const icone = btn.iconHtml ? `${btn.iconHtml}` : '';
            return `<button class="confirm-btn ${safeType}" data-action="${btn.action}">${icone}${btn.label}</button>`;
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.id = 'custom-dialog-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.dataset.variant = v;
        modal.innerHTML = `
            <div class="confirm-modal-content" role="document">
                <header class="confirm-modal-header">
                    <span class="confirm-modal-icon" aria-hidden="true"><i class="${iconClass}"></i></span>
                    <h3 class="confirm-modal-title">${title || ''}</h3>
                </header>
                <div class="confirm-modal-message">${message || ''}</div>
                <footer class="confirm-modal-actions">${buttonsHTML}</footer>
            </div>
        `;
        document.body.appendChild(modal);

        const cleanup = (action) => {
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
                if (primary) {
                    cleanup(primary.getAttribute('data-action'));
                }
            }
        };

        modal.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (btn) {
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
