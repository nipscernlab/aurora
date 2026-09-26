/**
 * anexos_do_chat.ts: os anexos do composer do painel de IA, a parte que toca
 * DOM e FileReader.
 *
 * Imagem e arquivo de texto entram por arrastar, colar ou escolher, viram
 * chips acima da caixa de texto, vao na bolha enviada, e a imagem abre em tela
 * cheia. O desenho de cada chip e puro e mora em chat_attachments.ts; aqui fica
 * ler os arquivos, montar os nos e ligar os cliques. Saiu do
 * ai_assistant_manager.js (TODO 13.3).
 */

import { bubbleChipHtml, composerChipHtml, formatAttachmentSize } from './chat_attachments.js';
import type { Anexo } from './chat_attachments.js';

const MAX_IMAGE = 8 * 1024 * 1024;   // 8 MB per image
const MAX_TEXT = 256 * 1024;         // 256 KB of text context per file
const MAX_ANEXOS = 10;

/** O que o composer recebe: um File, ou algo com a mesma forma. */
type Arquivo = Blob & { name?: string };

export function lerArquivo(file: Arquivo, como: 'dataURL' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    if (como === 'dataURL') r.readAsDataURL(file); else r.readAsText(file);
  });
}

export function idDeAnexo(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapa texto para entrar no HTML dos chips, inclusive dentro de atributo.
 * O escape anterior passava pelo textContent do DOM, que nao escapa aspas: um
 * nome com aspas fechava o title ou o alt onde entrava.
 */
export function escaparHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Le os arquivos para dentro de `pendentes`, com os limites de tamanho e de
 * quantidade. O que for recusado vira um aviso por `avisar`.
 */
export async function adicionarArquivos(
  pendentes: Anexo[],
  fileList: ArrayLike<Arquivo> | Iterable<Arquivo> | null | undefined,
  avisar: (texto: string) => void,
): Promise<void> {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (pendentes.length >= MAX_ANEXOS) {
      avisar('_Up to 10 attachments per message._');
      break;
    }
    const isImage = (file.type || '').startsWith('image/');
    try {
      if (isImage) {
        if (file.size > MAX_IMAGE) {
          avisar(`_"${file.name}" is too large (images max 8 MB)._`);
          continue;
        }
        const dataUrl = await lerArquivo(file, 'dataURL');
        pendentes.push({
          id: idDeAnexo(), kind: 'image', name: file.name || 'image.png',
          mime: file.type || 'image/png', size: file.size, dataUrl,
        });
      } else {
        const text = await lerArquivo(file, 'text');
        const clipped = text.length > MAX_TEXT;
        pendentes.push({
          id: idDeAnexo(), kind: 'file', name: file.name || 'file.txt',
          mime: file.type || 'text/plain', size: file.size,
          text: clipped ? text.slice(0, MAX_TEXT) : text, clipped,
        });
      }
    } catch (_) {
      avisar(`_Could not read "${file.name}"._`);
    }
  }
}

/** Os chips acima do composer, com o botao de tirar ligado a `aoRemover`. */
export function desenharAnexos(el: HTMLElement, lista: Anexo[], aoRemover: (id: string) => void): void {
  el.hidden = lista.length === 0;
  el.innerHTML = lista
    .map((a) => composerChipHtml(a, escaparHtml, formatAttachmentSize))
    .join('');
  el.querySelectorAll<HTMLElement>('.ai-att-remove').forEach((btn) => {
    btn.addEventListener('click', () => aoRemover(btn.dataset.id as string));
  });
}

/** A faixa so de leitura com os anexos, dentro de uma bolha enviada. */
export function desenharAnexosNaBolha(bubble: Element | null | undefined, atts: Anexo[] | null | undefined): void {
  if (!bubble || !atts || !atts.length) return;
  const strip = document.createElement('div');
  strip.className = 'ai-msg-attachments';
  strip.innerHTML = atts.map((a) => bubbleChipHtml(a, escaparHtml, formatAttachmentSize)).join('');
  const content = bubble.querySelector('.ai-msg-content');
  (content || bubble).appendChild(strip);
}

/**
 * A imagem anexada em tela cheia: fundo escurecido com a imagem ajustada a
 * tela; clique no fundo ou no x, ou Esc, fecha.
 */
export function abrirImagem(src: string | null | undefined, alt: string | null | undefined): void {
  if (!src) return;
  const overlay = document.createElement('div');
  overlay.className = 'ai-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Image preview');
  overlay.innerHTML =
    `<img class="ai-lightbox-img" src="${src}" alt="${escaparHtml(alt || '')}">` +
    `<button class="ai-lightbox-close" type="button" aria-label="Close"><i class="ph ph-x"></i></button>`;
  const close = () => {
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => overlay.remove(), 160);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('click', (e) => {
    // Close on the backdrop or the ×, but not when clicking the image itself.
    const alvo = e.target as Element;
    if (alvo.closest('.ai-lightbox-img') && !alvo.closest('.ai-lightbox-close')) return;
    close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}
