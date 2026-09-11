/**
 * @file Toast notification system, bottom-right card stack.
 *       This is one of TWO canonical UI surfaces (the other is showDialog).
 *       All other ad-hoc inline-notifications, alert(), confirm() are forbidden.
 *
 *       Each card is an <aurora-toast> Lit component (Shadow DOM + semantic
 *       tokens). This module owns the stack, the container and the cull, plus
 *       the public API; the component owns a card's own lifecycle (entry/exit,
 *       the auto-dismiss progress bar, hover-pause, and self-removal).
 * @module notification
 */

import '../components/aurora-toast.js';

let notificationContainer = null;
const MAX_VISIBLE = 4;

function createContainer() {
    if (notificationContainer) return;
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notification-stack-container';
    document.body.appendChild(notificationContainer);
}

function trimStack() {
    if (!notificationContainer) return;
    const cards = Array.from(notificationContainer.children);
    // Oldest = first child (because container is column-reverse). Cull beyond MAX.
    cards.slice(0, Math.max(0, cards.length - MAX_VISIBLE)).forEach(card => {
        if (!card.dismissing) card.dismiss?.();
    });
}

const TYPE_TITLES = {
    success: 'Success',
    error:   'Error',
    warning: 'Warning',
    info:    'Information'
};

/**
 * Show a toast card.
 * @param {string} message - Body text (HTML allowed).
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {number} [duration=5000] - Auto-dismiss in ms. 0 = sticky.
 * @param {string} [title] - Optional override of the card title.
 * @param {{ action?: { label: string, run: () => unknown } }} [options]
 *   `action` poe um botao no card ("Desfazer"): o card e o unico lugar onde
 *   o gesto que acabou de acontecer ainda esta na frente da pessoa, entao e
 *   onde a volta dele tem que estar. O card fecha ao clicar.
 * @returns {HTMLElement} o card, para quem precisar fecha-lo antes da hora.
 */
export function showCardNotification(message, type = 'info', duration = 5000, title, options) {
    createContainer();
    const validType = TYPE_TITLES[type] ? type : 'info';

    const card = document.createElement('aurora-toast');
    card.type = validType;
    card.heading = title || TYPE_TITLES[validType];
    card.message = message;
    card.duration = duration;
    const acao = options?.action;
    if (acao && acao.label && typeof acao.run === 'function') {
        card.actionLabel = String(acao.label);
        card.action = acao.run;
    }

    notificationContainer.appendChild(card);
    trimStack();
    return card;
}

/**
 * Convenience helpers.
 */
export const notify = {
    success: (msg, dur = 4000, title) => showCardNotification(msg, 'success', dur, title),
    error:   (msg, dur = 6000, title) => showCardNotification(msg, 'error',   dur, title),
    warning: (msg, dur = 5000, title) => showCardNotification(msg, 'warning', dur, title),
    info:    (msg, dur = 4000, title) => showCardNotification(msg, 'info',    dur, title),
};

/**
 * Global bridge for non-module legacy callers.
 * window.showNotification(message, type, duration), same semantics.
 */
if (typeof window !== 'undefined') {
    window.showNotification = (message, type = 'info', duration = 5000, title) => {
        showCardNotification(message, type, duration, title);
    };
    // Compatibility shim: replace older inline-notification helpers if present.
    window.AuroraUI = window.AuroraUI || {};
    window.AuroraUI.notify = window.showNotification;
}
