/**
 * @file Toast notification system — bottom-right card stack.
 *       This is one of TWO canonical UI surfaces (the other is showDialog).
 *       All other ad-hoc inline-notifications, alert(), confirm() are forbidden.
 * @module notification
 */

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
        if (!card.dismissing) {
            card.dismiss?.();
        }
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
 */
export function showCardNotification(message, type = 'info', duration = 5000, title) {
    createContainer();

    const validType = TYPE_TITLES[type] ? type : 'info';
    const titleText = title || TYPE_TITLES[validType];

    const card = document.createElement('div');
    card.className = `notification-card ${validType} enter-start`;
    card.innerHTML = `
        <div class="notification-sidebar"></div>
        <div class="notification-content">
            <div class="notification-text">
                <div class="notification-title"></div>
                <div class="notification-message"></div>
            </div>
        </div>
        <button class="notification-close" aria-label="Dismiss"><i class="ph ph-x"></i></button>
        <div class="notification-progress"></div>
    `;

    card.querySelector('.notification-title').textContent = titleText;
    card.querySelector('.notification-message').innerHTML = message;

    notificationContainer.appendChild(card);
    trimStack();

    // Trigger entry animation
    requestAnimationFrame(() => card.classList.remove('enter-start'));

    // Progress bar + auto-dismiss
    const progressBar = card.querySelector('.notification-progress');
    let timerId = null;
    let startTime = Date.now();
    let remainingTime = duration;
    const isSticky = duration <= 0;

    const dismiss = () => {
        if (card.dismissing) return;
        card.dismissing = true;
        clearTimeout(timerId);
        card.classList.add('exit');
        card.addEventListener('transitionend', () => card.remove(), { once: true });
        // Hard-fallback in case transitionend doesn't fire
        setTimeout(() => card.remove(), 400);
    };
    card.dismiss = dismiss;

    const resume = () => {
        if (isSticky) {
            progressBar.style.display = 'none';
            return;
        }
        startTime = Date.now();
        clearTimeout(timerId);
        timerId = setTimeout(dismiss, remainingTime);
        progressBar.style.transition = `width ${remainingTime}ms linear`;
        progressBar.style.width = '0%';
    };

    const pause = () => {
        if (isSticky) return;
        clearTimeout(timerId);
        remainingTime -= Date.now() - startTime;
        const computedWidth = getComputedStyle(progressBar).width;
        progressBar.style.transition = 'none';
        progressBar.style.width = computedWidth;
    };

    card.querySelector('.notification-close').addEventListener('click', dismiss);
    card.addEventListener('mouseenter', pause);
    card.addEventListener('mouseleave', resume);

    if (!isSticky) {
        // Set initial width for the transition origin
        progressBar.style.width = '100%';
        requestAnimationFrame(resume);
    } else {
        progressBar.style.display = 'none';
    }
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
 * window.showNotification(message, type, duration) — same semantics.
 */
if (typeof window !== 'undefined') {
    window.showNotification = (message, type = 'info', duration = 5000, title) => {
        showCardNotification(message, type, duration, title);
    };
    // Compatibility shim: replace older inline-notification helpers if present.
    window.AuroraUI = window.AuroraUI || {};
    window.AuroraUI.notify = window.showNotification;
}
