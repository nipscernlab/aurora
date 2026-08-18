/**
 * modal_system.js
 *
 * Sistema unificado de modais SAPHO. Comportamento global, aditivo:
 *  - Click no backdrop fecha (com data-dismiss-on-backdrop="true")
 *  - ESC fecha o último modal aberto
 *  - Stack: múltiplos modais abrem/fecham na ordem correta
 *  - data-modal-close="id" / data-dismiss-modal fecham via delegação
 *
 * Não substitui handlers existentes, é aditivo. Se outro JS já controla um
 * modal, esse continua funcionando; aqui apenas garantimos comportamento
 * consistente em modais que ainda não têm handler.
 *
 * Módulo de side-effect: importar/carregar já instala os listeners. O
 * antigo objeto `window.SaphoModal` (open/close/closeAll/... com
 * auto-focus no open) foi removido na conversão pra módulo ES, não
 * tinha nenhum consumidor. Se um dia precisar abrir modal por aqui,
 * exporte uma função deste módulo em vez de recriar um global.
 */

import '../components/aurora-modal.js';

const MODAL_OVERLAY_SELECTOR = '.modal-overlay';

// Track stack of open modals (ordered)
const openStack = [];

// <aurora-modal> is a drop-in for the legacy `.modal-overlay` div: it shows/hides
// from the SAME `aria-hidden` / `.show` signals via its shadow CSS, so the
// functions below work unchanged for both. The only extra wiring it needs is the
// `aurora-modal-close` listener (its backdrop + ✕ live in a shadow root).
function isOpen(modal) {
  return modal && (
    modal.getAttribute('aria-hidden') === 'false' ||
    modal.classList.contains('show')
  );
}

function closeModal(modal) {
  if (!modal || !isOpen(modal)) return;

  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('show');

  const idx = openStack.indexOf(modal);
  if (idx >= 0) openStack.splice(idx, 1);

  if (openStack.length === 0) {
    document.body.style.overflow = '';
  }
}

function closeTopModal() {
  if (openStack.length === 0) return;
  const top = openStack[openStack.length - 1];
  closeModal(top);
}

/**
 * Open a modal. Both the `.show` class and `aria-hidden="false"` drive
 * visibility (modal_config.css), so we set both; we also lock body scroll,
 * focus the first control, and push onto the stack so ESC / backdrop close it
 * through the unified path below.
 */
function openModal(modal) {
  if (!modal || isOpen(modal)) return;
  modal.classList.remove('hidden');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (!openStack.includes(modal)) openStack.push(modal);
  const focusable = modal.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  (focusable || modal).focus();
}

// Wire automatic backdrop dismiss
document.addEventListener('click', (e) => {
  const overlay = e.target.closest(MODAL_OVERLAY_SELECTOR);
  if (!overlay) return;

  // Só fecha se o clique foi no overlay direto (não no container)
  if (e.target !== overlay) return;

  // Permite opt-out via data-dismiss-on-backdrop="false"
  if (overlay.getAttribute('data-dismiss-on-backdrop') === 'false') return;

  closeModal(overlay);
});

// <aurora-modal> self-manages its own backdrop + ✕ (its overlay lives in a shadow
// root the delegation above can't reach) and emits this to request a close.
document.addEventListener('aurora-modal-close', (e) => {
  closeModal(e.target);
});

// Wire data-modal-close="modalId" or data-dismiss-modal
document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-modal-close], [data-dismiss-modal]');
  if (!closer) return;
  const targetId = closer.getAttribute('data-modal-close') ||
                   closer.getAttribute('data-dismiss-modal');
  const modal = targetId ? document.getElementById(targetId)
                          : closer.closest(MODAL_OVERLAY_SELECTOR);
  if (modal) closeModal(modal);
});

// ESC key fecha o topo
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    // Se há modal aberto, fecha apenas o topo (não propaga)
    if (openStack.length > 0) {
      closeTopModal();
      e.stopPropagation();
    }
  }
});

// Sync stack on load, qualquer modal já aberto via classe `show` ou
// aria-hidden="false" entra no stack.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach((modal) => {
    if (isOpen(modal) && !openStack.includes(modal)) {
      openStack.push(modal);
    }
  });
});

/* ---------------------------------------------------------------------------
 *  Opener + trigger wiring
 *
 *  Relocated here from a parallel modal script that used to live inline in
 *  index.html: so there is now ONE modal system. The buttons that open the
 *  New Project and Processor Hub modals open them authoritatively on the
 *  capture phase (before any other click handler on the same button, e.g.
 *  processor_hub.js), exactly as the old inline code did. ESC / backdrop now
 *  close them through the unified stack above (the inline copy is gone).
 * ------------------------------------------------------------------------- */
const TRIGGER_TO_MODAL = {
  newProjectBtn: 'newProjectModal',
  newProjectBtnWelcome: 'newProjectModal',
  processorHub: 'modalContainer',
};
// Buttons that close a modal on click, in addition to their own submit/cancel
// handlers (mirrors the old explicit listeners).
const CLOSE_TO_MODAL = {
  cancelProjectBtn: 'newProjectModal',
  generateProjectBtn: 'newProjectModal',
  cancelProcessorHub: 'modalContainer',
  generateProcessor: 'modalContainer',
};

document.addEventListener('DOMContentLoaded', () => {
  for (const [triggerId, modalId] of Object.entries(TRIGGER_TO_MODAL)) {
    const btn = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    if (!btn || !modal) continue;
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    btn.disabled = false;
    btn.classList.remove('disabled');
    btn.removeAttribute('disabled');
    document.addEventListener('click', (e) => {
      if (e.target === btn || btn.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        openModal(modal);
      }
    }, true);
  }
  for (const [btnId, modalId] of Object.entries(CLOSE_TO_MODAL)) {
    document.getElementById(btnId)?.addEventListener('click', () => {
      const modal = document.getElementById(modalId);
      if (modal) closeModal(modal);
    });
  }
  // Back-compat shim for any dynamic / onclick code that reached for these.
  window.__modalHelpers = {
    openModalById: (id) => openModal(document.getElementById(id)),
    closeModalById: (id) => closeModal(document.getElementById(id)),
  };
});
