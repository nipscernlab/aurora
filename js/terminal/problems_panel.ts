/**
 * problems_panel.ts: a lista do que a ultima compilacao reclamou.
 *
 * O marcador no editor (problem_store.js) resolve metade do problema: ele
 * mostra o erro DENTRO do arquivo. A outra metade e saber que o erro existe
 * sem ter o arquivo aberto, e quantos ha ao todo. Num projeto com uma duzia de
 * arquivos Verilog, rolar o terminal atras da primeira linha vermelha e o que
 * se fazia ate agora.
 *
 * O CONTADOR NA BARRA e, para mim, a parte que mais muda o dia. Ele responde
 * "compilou?" sem abrir nada e sem rolar nada: aceso em vermelho, nao compilou;
 * apagado, passou. E uma pergunta que se faz dezenas de vezes por aula.
 *
 * A lista NAO reordena por gravidade. A ordem e a dos arquivos como o deposito
 * os viu, que e a ordem em que a toolchain falou. Ordenar por erro primeiro
 * parece util e desmancha a unica pista de causa que essa saida tem: o primeiro
 * erro costuma ser o que provocou os outros, e ve-lo no alto vale mais do que
 * ver o mais grave.
 */

import { electronAPI } from '../app/electron_api.js';
import { problemStore } from './problem_store.js';
import type { Problema } from './problem_store.js';

const $ = (id: string) => document.getElementById(id);

/** Igual ao painel de busca: chave faltando no locale nao vaza para a tela. */
function tt(key: string, fallback: string): string {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key);
  return (v && v !== key) ? v : fallback;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** O nome do arquivo, sem a pasta. A pasta inteira nao cabe e nao ajuda. */
function nomeCurto(caminho: string): string {
  const partes = String(caminho || '').split(/[/\\]/);
  return partes[partes.length - 1] || caminho;
}

let modal: HTMLElement | null = null;
/** O que a lista esta mostrando agora, para o clique achar o arquivo. */
let mostrando: Array<{ arquivo: string; problemas: Problema[] }> = [];

// ── o contador na barra ──────────────────────────────────────────────────────

/**
 * Pinta o botao com o que ha.
 *
 * Tres estados, e nenhum deles e "some da tela": um botao que aparece e
 * desaparece muda o lugar dos vizinhos e faz a pessoa procurar. Ele fica, e o
 * que muda e a cor e o numero.
 */
function pintarBotao() {
  const btn = $('problems-panel');
  if (!btn) return;
  const { erros, avisos } = problemStore.contagem();
  const total = erros + avisos;

  btn.classList.toggle('tem-erro', erros > 0);
  btn.classList.toggle('tem-aviso', erros === 0 && avisos > 0);

  let contador = btn.querySelector('.problems-count') as HTMLElement | null;
  if (!contador) {
    contador = document.createElement('span');
    contador.className = 'problems-count';
    btn.appendChild(contador);
  }
  contador.textContent = total ? String(total) : '';
  contador.hidden = total === 0;

  const rotulo = total === 0
    ? tt('problems.none', 'No problems')
    : tt('problems.count', 'Errors: {{errors}}  Warnings: {{warnings}}')
      .replace('{{errors}}', String(erros))
      .replace('{{warnings}}', String(avisos));
  btn.setAttribute('data-tooltip', rotulo);
  btn.setAttribute('aria-label', rotulo);
}

// ── a lista ──────────────────────────────────────────────────────────────────

function render() {
  const wrap = $('problems-list');
  if (!wrap) return;
  mostrando = problemStore.listar();

  if (!mostrando.length) {
    wrap.innerHTML = `<div class="problems-empty">
      <i class="ph ph-check-circle" aria-hidden="true"></i>
      <span>${esc(tt('problems.emptyBody', 'The last build reported nothing.'))}</span>
    </div>`;
    return;
  }

  const partes = [];
  for (const [i, grupo] of mostrando.entries()) {
    const erros = grupo.problemas.filter((p) => p.severidade !== 'aviso').length;
    const avisos = grupo.problemas.length - erros;
    partes.push(`<div class="problems-file">
      <div class="problems-file-head">
        <span class="problems-file-path" title="${esc(grupo.arquivo)}">${esc(nomeCurto(grupo.arquivo))}</span>
        <span class="problems-file-count">${erros ? `${erros}E` : ''}${erros && avisos ? ' ' : ''}${avisos ? `${avisos}A` : ''}</span>
      </div>`);
    for (const [j, p] of grupo.problemas.entries()) {
      const icone = p.severidade === 'aviso' ? 'ph-warning' : 'ph-x-circle';
      const lugar = p.coluna ? `${p.linha}:${p.coluna}` : String(p.linha);
      partes.push(`<div class="problems-row ${p.severidade}" role="button" tabindex="0"
             data-grupo="${i}" data-item="${j}">
        <i class="ph ${icone} problems-icon" aria-hidden="true"></i>
        <span class="problems-line">${esc(lugar)}</span>
        <span class="problems-msg">${esc(p.mensagem)}</span>
        <span class="problems-tool">${esc(p.ferramenta)}</span>
      </div>`);
    }
    partes.push('</div>');
  }
  wrap.innerHTML = partes.join('');
}

async function abrirProblema(gi: number, pi: number): Promise<void> {
  const grupo = mostrando[gi];
  const p = grupo && grupo.problemas[pi];
  if (!p) return;
  try {
    const conteudo = await electronAPI.readFile(grupo.arquivo, { encoding: 'utf8' });
    if (typeof conteudo !== 'string') return;
    window.TabManager?.addTab?.(grupo.arquivo, conteudo, {
      preview: false,
      revealPosition: { line: p.linha, column: p.coluna || 1 },
    });
  } catch (e) {
    console.error('[problemas] nao consegui abrir', grupo.arquivo, e);
    return;
  }
  fechar();
}

// ── abrir e fechar ───────────────────────────────────────────────────────────

function abrir() {
  modal = modal || $('problemsModal');
  if (!modal) return;
  render();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function fechar() {
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function estaAberto() {
  return !!modal && modal.classList.contains('show');
}

export function initProblemsPanel() {
  modal = $('problemsModal');
  $('problems-panel')?.addEventListener('click', abrir);
  modal?.addEventListener('aurora-modal-close', fechar);

  $('problems-list')?.addEventListener('click', (e) => {
    const linha = (e.target as Element).closest('.problems-row') as HTMLElement | null;
    if (!linha) return;
    abrirProblema(Number(linha.dataset.grupo), Number(linha.dataset.item));
  });
  $('problems-list')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const linha = (e.target as Element).closest('.problems-row') as HTMLElement | null;
    if (!linha) return;
    e.preventDefault();
    abrirProblema(Number(linha.dataset.grupo), Number(linha.dataset.item));
  });

  // O contador acompanha o deposito; a lista so se redesenha com o painel
  // aberto, para nao gastar DOM enquanto ninguem olha.
  problemStore.aoMudar(() => {
    pintarBotao();
    if (estaAberto()) render();
  });
  pintarBotao();

  window.openProblemsPanel = abrir;
}

export { abrir, fechar };

// Os dois botoes da barra nasciam sem ouvinte: este modulo exportava a funcao
// de ligar e NINGUEM a chamava. O `<script type="module">` do index carregava o
// arquivo, o codigo avaliava, e nada acontecia ao clicar. O rewind ja tinha
// esta auto-ligacao; estes dois nao.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initProblemsPanel);
  else initProblemsPanel();
}
