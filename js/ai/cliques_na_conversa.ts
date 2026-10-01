/**
 * cliques_na_conversa.ts: o que um clique dentro das mensagens faz.
 *
 * Link externo passa pelo aviso antes de ir ao navegador (o modelo controla
 * essas URLs; a ancora e so um marcador, a URL vem em `data-href`). Caminho
 * absoluto abre: pasta no explorador, texto no editor, o resto no programa do
 * sistema. Referencia a arquivo do projeto (`core.v`, `proc.cmm:25`) abre no
 * editor, na linha quando ela veio. Imagem anexada abre em tamanho cheio. O
 * botao do bloco de codigo copia o codigo.
 *
 * Saiu do attachListeners do ai_assistant_manager.js (TODO 13.3).
 */

import { confirmarLinkExterno } from './link_externo.js';
import { abrirCaminhoDoChat, abrirReferencia } from './abrir_referencia.js';
import { abrirImagem } from './anexos_do_chat.js';

export function ligarCliquesNaConversa(messagesEl: HTMLElement): void {
  messagesEl.addEventListener('click', (e) => {
    const alvo = e.target as Element;
    const img = alvo.closest?.('.ai-att-thumb-lg');
    if (img) {
      e.preventDefault();
      abrirImagem(img.getAttribute('src') as string, img.getAttribute('alt') as string);
      return;
    }
    const ref = alvo.closest?.<HTMLElement>('.ai-file-ref');
    if (!ref) return;
    e.preventDefault();
    abrirReferencia(ref.dataset.file as string, ref.dataset.line ? parseInt(ref.dataset.line, 10) : null);
  });

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
