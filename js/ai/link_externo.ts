/**
 * link_externo.ts: o aviso antes de abrir no navegador um link que a IA
 * escreveu.
 *
 * Mostra o destino exato como TEXTO (a URL vem do modelo e nao pode virar
 * marcacao) e so abre com confirmacao. A pessoa pode marcar "sempre", que vale
 * tambem para o interruptor das Configuracoes. O openExternal do main recusa
 * esquema que nao seja http, https ou mailto, como segunda defesa. Saiu do
 * ai_assistant_manager.js (TODO 13.3).
 */

import { electronAPI } from '../app/electron_api.js';
import { TRUST_LINKS_KEY } from './chat_render.js';

export function confiaEmLinksExternos(): boolean {
  try { return localStorage.getItem(TRUST_LINKS_KEY) === '1'; } catch (_) { return false; }
}

export function definirConfiancaEmLinks(v: boolean): void {
  try { localStorage.setItem(TRUST_LINKS_KEY, v ? '1' : '0'); } catch (_) { /* ignore */ }
  // Keep any Settings toggle bound to the same preference in sync, live.
  window.dispatchEvent(new CustomEvent('aurora:trust-external-links-changed', { detail: { value: !!v } }));
}

export function confirmarLinkExterno(url: string | null | undefined): void {
  if (!url) return;

  // Bypass the warning entirely when the user has chosen to trust external
  // links (the dialog checkbox, mirrored by the Settings toggle).
  if (confiaEmLinksExternos()) {
    electronAPI?.openExternal?.(url);
    return;
  }

  document.querySelector('.ai-link-warning')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ai-link-warning';
  overlay.innerHTML =
    '<div class="ai-link-warning-card" role="dialog" aria-modal="true" aria-label="Open external link">' +
      '<div class="ai-link-warning-head"><i class="ph ph-arrow-square-out"></i>' +
        '<span>Open external link?</span></div>' +
      '<p class="ai-link-warning-text">This leaves Aurora and opens in your default browser:</p>' +
      '<div class="ai-link-warning-url"></div>' +
      '<label class="ai-link-warning-trust">' +
        '<input type="checkbox" class="ai-link-warning-trust-cb">' +
        '<span>Always open external links without asking</span>' +
      '</label>' +
      '<div class="ai-link-warning-actions">' +
        '<button class="ai-link-warning-cancel" type="button">Cancel</button>' +
        '<button class="ai-link-warning-open" type="button">Open link</button>' +
      '</div>' +
    '</div>';
  // textContent, never innerHTML, the URL is untrusted model output.
  (overlay.querySelector('.ai-link-warning-url') as HTMLElement).textContent = url;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  (overlay.querySelector('.ai-link-warning-cancel') as HTMLElement).addEventListener('click', close);
  const abrir = overlay.querySelector('.ai-link-warning-open') as HTMLElement;
  abrir.addEventListener('click', () => {
    // If "always" was ticked, persist the bypass before opening.
    if ((overlay.querySelector('.ai-link-warning-trust-cb') as HTMLInputElement | null)?.checked) {
      definirConfiancaEmLinks(true);
    }
    electronAPI?.openExternal?.(url);
    close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  abrir.focus();
}
