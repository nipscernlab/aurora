/**
 * cliques_na_conversa.ts: o que um clique dentro das mensagens faz.
 *
 * Link externo passa pelo aviso antes de ir ao navegador (o modelo controla
 * essas URLs; a ancora e so um marcador, a URL vem em `data-href`). Caminho
 * absoluto abre: pasta no explorador, texto no editor, o resto no programa do
 * sistema. O botao do bloco de codigo copia o codigo.
 *
 * Saiu do attachListeners do ai_assistant_manager.js (TODO 13.3).
 */

import { confirmarLinkExterno } from './link_externo.js';
import { abrirCaminhoDoChat } from './abrir_referencia.js';

export function ligarCliquesNaConversa(messagesEl: HTMLElement): void {
  messagesEl.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a[data-href]');
    if (!a) return;
    e.preventDefault();
    confirmarLinkExterno(a.getAttribute('data-href') as string);
  });

  messagesEl.addEventListener('click', (e) => {
    const p = (e.target as Element).closest('.ai-path');
    if (!p) return;
    e.preventDefault();
    abrirCaminhoDoChat(p.getAttribute('data-path') as string);
  });

  messagesEl.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('.ai-code-copy');
    if (!btn) return;
    const code = btn.closest('.ai-code-block')?.querySelector<HTMLElement>('code');
    if (!code) return;
    navigator.clipboard.writeText(code.innerText).then(() => {
      btn.innerHTML = '<i class="ph ph-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="ph ph-copy"></i>'; }, 2000);
    }).catch(() => {});
  });
}
