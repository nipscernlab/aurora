/**
 * modal_system.js
 *
 * Sistema unificado de modais SAPHO. Comportamento global, aditivo:
 *  - Click no backdrop fecha (com data-dismiss-on-backdrop="true")
 *  - ESC fecha o último modal aberto
 *  - Stack: múltiplos modais abrem/fecham na ordem correta
 *  - data-modal-close="id" / data-dismiss-modal fecham via delegação
 *
 * Não substitui handlers existentes — é aditivo. Se outro JS já controla um
 * modal, esse continua funcionando; aqui apenas garantimos comportamento
 * consistente em modais que ainda não têm handler.
 *
 * Módulo de side-effect: importar/carregar já instala os listeners. O
 * antigo objeto `window.SaphoModal` (open/close/closeAll/... com
 * auto-focus no open) foi removido na conversão pra módulo ES — não
 * tinha nenhum consumidor. Se um dia precisar abrir modal por aqui,
 * exporte uma função deste módulo em vez de recriar um global.
 */

const MODAL_OVERLAY_SELECTOR = '.modal-overlay';

// Track stack of open modals (ordered)
const openStack = [];

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

// Sync stack on load — qualquer modal já aberto via classe `show` ou
// aria-hidden="false" entra no stack.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach((modal) => {
    if (isOpen(modal) && !openStack.includes(modal)) {
      openStack.push(modal);
    }
  });
});
