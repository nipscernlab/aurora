/**
 * A tela do historico de execucoes.
 *
 * Le o que o compilation_flow gravou em <projeto>/.aurora/execucoes e mostra
 * em duas partes: a lista, com uma linha por clique de compilar, e o detalhe
 * de uma execucao, com o retrato do projeto naquele instante e a cadeia de
 * ferramentas que rodou. So le; quem escreve e o main, e quem decide o que
 * vale a pena gravar e o run_log.js.
 *
 * A pergunta que a tela responde nao e "o que aconteceu", que o terminal ja
 * responde melhor enquanto acontece. E "dado o estado ATUAL do projeto, o que
 * houve nas compilacoes ANTERIORES": por isso o retrato vem antes da cadeia,
 * e por isso a lista mostra o desfecho e a duracao antes de qualquer outra
 * coisa. Comparar duas execucoes e olhar dois retratos lado a lado; a tela
 * nao faz a comparacao por voce, porque a diferenca que importa e a que voce
 * esta procurando, e uma tela que destaca tudo nao destaca nada.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { execucoesAbertas } from './registro_de_execucao.js';
import { nomeDoPasso as nomeDoPassoPuro } from './run_history_labels.js';
import type { ResumoDeExecucao } from './run_log.js';

/** Um problema lido da saida do compilador, com arquivo e linha. */
interface ProblemaGravado {
  arquivo?: string;
  linha?: number;
  coluna?: number;
  mensagem?: string;
  severidade?: string;
  ferramenta?: string;
}

/** Uma ferramenta da cadeia que rodou. */
interface PassoGravado {
  step: string;
  ferramenta?: string;
  args?: string[];
  ms?: number;
  code?: number;
  concorrente?: boolean;
}

/** O retrato do projeto no instante do clique. */
interface EstadoGravado {
  topoSintese?: string;
  topoSimulacao?: string;
  simulador?: string;
  visualizador?: string;
  processadores?: string[];
  fontes?: string[];
}

/** O registro inteiro de uma execucao, como o runlog:ler devolve. */
export interface ExecucaoGravada extends Omit<ResumoDeExecucao, 'passos'> {
  erro?: string;
  estado?: EstadoGravado;
  problemas?: ProblemaGravado[];
  passos?: PassoGravado[];
}

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);
const $ = (id: string): HTMLElement | null => document.getElementById(id);

let modal: HTMLElement | null = null;
let carregando = false;
let redesenhar = false;

/**
 * A tabela mora em js/compilation/run_history_labels.ts, que e dado puro e
 * por isso tem teste; aqui so se amarra a traducao desta tela.
 */
function nomeDoPasso(step: string): string {
  return nomeDoPassoPuro(step, tr);
}

/** O que o usuario clicou, com o nome que a barra de status ja usa. */
function nomeDoPedido(pedido: string | undefined): string {
  const chave = `compilation.type.${pedido}`;
  const t = tr(chave);
  return t === chave ? String(pedido || '?') : t;
}

function escapar(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function duracao(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} min ${s} s`;
}

/** `29/08 15:46`: dia e hora bastam, o ano e o do arquivo. */
function quando(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Nome curto de um caminho, para o retrato nao virar uma parede de barras. */
function base(caminho: string | undefined): string {
  return String(caminho || '').split(/[\\/]/).pop() || '';
}

function desfecho(e: Pick<ResumoDeExecucao, 'andando' | 'cancelada' | 'ok'>): { classe: string; texto: string } {
  if (e.andando) return { classe: 'andando', texto: tr('runHistory.running') };
  if (e.cancelada) return { classe: 'cancelada', texto: tr('runHistory.cancelled') };
  if (e.ok) return { classe: 'ok', texto: tr('runHistory.ok') };
  return { classe: 'erro', texto: tr('runHistory.failed') };
}

/* ------------------------------------------------------------------ lista */

async function desenharLista(): Promise<void> {
  const lista = $('run-history-list');
  if (!lista) return;
  const projeto = ProjectStore.getProjectPath();
  if (!projeto) {
    lista.innerHTML = `<p class="run-history-vazio">${escapar(tr('runHistory.noProject'))}</p>`;
    return;
  }
  // Um pedido que chega no meio da leitura anterior era descartado, e como o
  // aviso nao se repete a lista podia ficar parada num estado velho. Agora ele
  // fica marcado e a leitura se refaz ao terminar.
  if (carregando) { redesenhar = true; return; }
  carregando = true;
  try {
    const r = await electronAPI.runLogListar?.(projeto);
    // As vivas na frente, e sem a gravada de mesmo id: durante o instante entre
    // gravar e sair das abertas a execucao existe nos dois lugares, e sem esse
    // filtro ela apareceria duas vezes na lista.
    const vivas: ResumoDeExecucao[] = execucoesAbertas();
    const ids = new Set(vivas.map((e) => e.id));
    const execucoes = vivas.concat((r?.execucoes || []).filter((e) => !ids.has(e.id)));
    if (!execucoes.length) {
      lista.innerHTML = `<p class="run-history-vazio">${escapar(tr('runHistory.empty'))}</p>`;
      return;
    }
    const cabecalho = `<div class="run-history-cabecalho" aria-hidden="true">
        <span></span>
        <span>${escapar(tr('runHistory.colRequest'))}</span>
        <span class="run-history-quando">${escapar(tr('runHistory.colWhen'))}</span>
        <span class="run-history-duracao">${escapar(tr('runHistory.colDuration'))}</span>
        <span class="run-history-passos">${escapar(tr('runHistory.colSteps'))}</span>
        <span class="run-history-desfecho">${escapar(tr('runHistory.colOutcome'))}</span>
      </div>`;
    lista.innerHTML = cabecalho + execucoes.map((e) => {
      const d = desfecho(e);
      // A execucao viva sai como div, e nao botao: o detalhe le o arquivo, que
      // so existe no fim. Um botao que nao abre nada seria pior do que uma
      // linha que nao parece clicavel.
      const tag = e.andando ? 'div' : 'button';
      const attrs = e.andando ? 'class="run-history-item andando"' : `class="run-history-item" data-id="${escapar(e.id)}"`;
      return `<${tag} ${attrs}>
        <span class="run-history-marca ${d.classe}" aria-hidden="true"></span>
        <span class="run-history-pedido">${escapar(nomeDoPedido(e.pedido))}</span>
        <span class="run-history-quando">${escapar(quando(e.inicio))}</span>
        <span class="run-history-duracao">${escapar(duracao(e.ms))}</span>
        <span class="run-history-passos">${escapar(String(e.passos))}</span>
        <span class="run-history-desfecho ${d.classe}">${escapar(d.texto)}</span>
      </${tag}>`;
    }).join('');
  } catch (err) {
    lista.innerHTML = `<p class="run-history-vazio">${escapar(tr('runHistory.readFailed', { erro: (err as Error | null)?.message || err }))}</p>`;
  } finally {
    carregando = false;
    if (redesenhar) { redesenhar = false; desenharLista(); }
  }
}

/**
 * O que o COMPILADOR disse, e nao o que a AURORA concluiu.
 *
 * O detalhe mostrava apenas `e.erro`, que e a frase montada a partir do codigo
 * de saida ("Compilacao CMM falhou com codigo 1"): ela diz que falhou e nao diz
 * o que houve. A mensagem de verdade existia so no terminal e sumia com ele.
 * Agora o registro carrega os problemas lidos da saida, e eles aparecem aqui,
 * com arquivo e linha.
 *
 * Execucao gravada antes desta mudanca nao tem o campo, e o bloco simplesmente
 * nao aparece: e melhor uma tela sem a secao do que uma secao vazia dizendo que
 * nao houve erro nenhum.
 */
function problemasHtml(problemas: ProblemaGravado[] | undefined): string {
  if (!Array.isArray(problemas) || !problemas.length) return '';
  const linhas = problemas.map((p) => {
    const lugar = p.coluna ? `${p.linha}:${p.coluna}` : String(p.linha ?? '');
    return `<li class="run-history-problema ${p.severidade === 'aviso' ? 'aviso' : 'erro'}">
      <span class="run-history-problema-lugar">${escapar(base(p.arquivo))}${lugar ? `:${escapar(lugar)}` : ''}</span>
      <span class="run-history-problema-msg">${escapar(p.mensagem)}</span>
      <span class="run-history-problema-ferr">${escapar(p.ferramenta || '')}</span>
    </li>`;
  }).join('');
  return `<h4 class="run-history-secao">${escapar(tr('runHistory.problemsTitle'))}</h4>
    <ul class="run-history-problemas">${linhas}</ul>`;
}

/* ---------------------------------------------------------------- detalhe */

async function mostrarDetalhe(id: string | null): Promise<void> {
  const painel = $('run-history-detail');
  const lista = $('run-history-list');
  if (!painel || !lista) return;
  const r = await electronAPI.runLogLer?.(ProjectStore.getProjectPath(), id);
  if (!r?.ok) return;
  const e = r.execucao;
  const d = desfecho(e);
  const estado = e.estado || {};

  // O retrato vem ANTES da cadeia: e a parte que responde "em que estado o
  // projeto estava", que e a pergunta desta tela. A cadeia e o que o terminal
  // ja mostrou na hora.
  const retrato: Array<[string, string]> = [
    [tr('runHistory.topSynth'), base(estado.topoSintese) || tr('runHistory.none')],
    [tr('runHistory.topSim'), base(estado.topoSimulacao) || tr('runHistory.none')],
    [tr('runHistory.simulator'), estado.simulador || tr('runHistory.none')],
    [tr('runHistory.viewer'), estado.visualizador || tr('runHistory.none')],
    [tr('runHistory.processors'), (estado.processadores || []).join(', ') || tr('runHistory.none')],
    [tr('runHistory.sources'), (estado.fontes || []).map(base).join(', ') || tr('runHistory.none')],
  ];

  const passos = (e.passos || []).map((p) => {
    const falhou = typeof p.code === 'number' && p.code !== 0;
    return `<li class="run-history-passo${falhou ? ' falhou' : ''}${p.concorrente ? ' concorrente' : ''}"
                title="${escapar([p.ferramenta, ...(p.args || [])].join(' '))}">
      <span class="run-history-passo-nome">${escapar(nomeDoPasso(p.step))}</span>
      <span class="run-history-passo-ferramenta">${escapar(p.ferramenta || '')}</span>
      <span class="run-history-passo-ms">${escapar(duracao(p.ms))}</span>
      <span class="run-history-passo-obs">${
        falhou ? `<span class="run-history-passo-code">${escapar(tr('runHistory.exitCode', { code: p.code }))}</span>`
        : p.concorrente ? `<span class="run-history-passo-conc" title="${escapar(tr('runHistory.concurrentHint'))}">${escapar(tr('runHistory.concurrent'))}</span>`
        : ''
      }</span>
    </li>`;
  }).join('');

  painel.innerHTML = `
    <button class="run-history-voltar" id="run-history-back">
      <i class="ph ph-arrow-left" aria-hidden="true"></i>
      <span>${escapar(tr('runHistory.back'))}</span>
    </button>
    <header class="run-history-cabeca">
      <span class="run-history-marca ${d.classe}" aria-hidden="true"></span>
      <strong>${escapar(nomeDoPedido(e.pedido))}</strong>
      <span class="run-history-quando">${escapar(quando(e.inicio))}</span>
      <span class="run-history-duracao">${escapar(duracao(e.ms))}</span>
      <span class="run-history-desfecho ${d.classe}">${escapar(d.texto)}</span>
    </header>
    ${e.erro ? `<p class="run-history-erro">${escapar(e.erro)}</p>` : ''}
    ${problemasHtml(e.problemas)}
    <h4 class="run-history-secao">${escapar(tr('runHistory.stateTitle'))}</h4>
    <dl class="run-history-retrato">
      ${retrato.map(([k, v]) => `<dt>${escapar(k)}</dt><dd>${escapar(v)}</dd>`).join('')}
    </dl>
    <h4 class="run-history-secao">${escapar(tr('runHistory.chainTitle'))}</h4>
    ${passos ? `<ol class="run-history-cadeia">${passos}</ol>`
             : `<p class="run-history-vazio">${escapar(tr('runHistory.noSteps'))}</p>`}
  `;
  lista.hidden = true;
  painel.hidden = false;
  $('run-history-back')?.focus();
}

function voltarParaLista(): void {
  const painel = $('run-history-detail');
  const lista = $('run-history-list');
  if (painel) painel.hidden = true;
  if (lista) lista.hidden = false;
}

/* --------------------------------------------------------------- abre/fecha */

/** Se a lista esta visivel agora: modal aberto e detalhe fechado. */
function listaVisivel(): boolean {
  return !!modal && modal.classList.contains('show') && $('run-history-list')?.hidden === false;
}

/**
 * Redesenha por causa de um aviso do compilation_flow.
 *
 * Coalescido porque o aviso vem a cada ferramenta que roda, e cada redesenho
 * custa uma leitura da pasta; sem isso uma compilacao inteira dispararia uma
 * rajada de listagens de disco por segundo. E so quando a lista esta na tela:
 * redesenhar o que ninguem ve e trabalho jogado fora, e ao abrir a tela ela
 * desenha do zero de qualquer jeito.
 *
 * Mas o PRIMEIRO aviso pinta na hora, e nao no fim da janela. Coalescer pelo
 * fim atrasava justamente o aviso que importa, o de que uma execucao COMECOU:
 * medindo, uma execucao curta abria e fechava dentro dos 250 ms e a linha viva
 * nunca chegava a ser desenhada. Pintar na entrada e esperar depois da o
 * melhor dos dois: resposta imediata, e uma listagem por janela na rajada.
 */
let pendente: ReturnType<typeof setTimeout> | null = null;
let repetir = false;
function aoMudarRegistro(): void {
  if (!listaVisivel()) return;
  if (pendente) { repetir = true; return; }
  desenharLista();
  pendente = setTimeout(() => {
    pendente = null;
    // Redesenha uma vez pelo que chegou durante a janela, senao a lista
    // pararia no estado do primeiro aviso da rajada.
    if (repetir) { repetir = false; aoMudarRegistro(); }
  }, 250);
}

function abrir(): void {
  modal = modal || $('runHistoryModal');
  if (!modal) return;
  voltarParaLista();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  desenharLista();
}

function fechar(): void {
  if (!modal) return;
  if (pendente) { clearTimeout(pendente); pendente = null; }
  repetir = false;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function ligar(): void {
  modal = $('runHistoryModal');
  if (!modal) return;
  $('run-history')?.addEventListener('click', abrir);
  // O `?` do cabecalho NAO se liga aqui: ele esta na tabela unica de
  // js/ui/help_link.js, com os outros. Ligado a parte, como estava, ele nao
  // aparecia para quem auditava a tabela e podia apontar para uma pagina morta
  // sem ninguem notar.
  modal.addEventListener('aurora-modal-close', fechar);
  // O compilation_flow avisa ao abrir uma execucao, a cada ferramenta que roda
  // e ao gravar. E o que faz a tela mudar sozinha em vez de so na abertura.
  window.addEventListener('aurora:run-log-changed', aoMudarRegistro);

  // A lista se refaz inteira a cada abertura, entao os ouvintes moram no
  // container, nao nas linhas.
  $('run-history-list')?.addEventListener('click', (ev) => {
    const alvo = ev.target instanceof Element ? ev.target.closest('[data-id]') : null;
    if (alvo) mostrarDetalhe(alvo.getAttribute('data-id'));
  });
  $('run-history-detail')?.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.closest('#run-history-back')) voltarParaLista();
  });
}

if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', ligar);
}

export { abrir, fechar, desenharLista, mostrarDetalhe, nomeDoPasso, duracao };
