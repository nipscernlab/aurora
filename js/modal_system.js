/**
 * modal_system.js
 *
 * Sistema unificado de modais SAPHO. Mantém a API existente (open/close por
 * data-attributes e por ID) e adiciona:
 *  - Click no backdrop fecha (com data-dismiss-on-backdrop="true")
 *  - ESC fecha o último modal aberto
 *  - Auto-focus no primeiro elemento focável
 *  - Stack: múltiplos modais abrem/fecham na ordem correta
 *  - Animação centralizada (aria-hidden="false" + .show ambos suportados)
 *
 * Não substitui handlers existentes — é aditivo. Se outro JS já controla um
 * modal, esse continua funcionando; aqui apenas garantimos comportamento
 * consistente em modais que ainda não têm handler.
 */

(function () {
  'use strict';

  const MODAL_OVERLAY_SELECTOR = '.modal-overlay';
  const FOCUSABLE = 'button:not(:disabled):not([aria-hidden="true"]), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

  // Track stack of open modals (ordered)
  const openStack = [];

  function isOpen(modal) {
    return modal && (
      modal.getAttribute('aria-hidden') === 'false' ||
      modal.classList.contains('show')
    );
  }

  function openModal(modal) {
    if (!modal || isOpen(modal)) return;

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('show');
    modal.classList.remove('hidden');

    if (!openStack.includes(modal)) openStack.push(modal);
    document.body.style.overflow = 'hidden';

    // Focus o primeiro focável dentro do modal
    requestAnimationFrame(() => {
      const focusable = modal.querySelector(FOCUSABLE);
      if (focusable) focusable.focus({ preventScroll: true });
      else modal.setAttribute('tabindex', '-1'), modal.focus({ preventScroll: true });
    });
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

  // Expose API global
  window.SaphoModal = {
    open: (modalOrId) => {
      const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      openModal(modal);
    },
    close: (modalOrId) => {
      const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      closeModal(modal);
    },
    closeAll: () => {
      [...openStack].forEach(closeModal);
    },
    closeTop: closeTopModal,
    isOpen: (modalOrId) => {
      const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      return isOpen(modal);
    },
    getOpenModals: () => [...openStack],
  };
})();
