/**
 * indicadores_do_turno.ts: o que o painel mostra enquanto o turno anda.
 *
 * A palavra de "pensando" com os tres pontos, enquanto nada chegou; o aviso de
 * download quando a CLI de assinatura e baixada no primeiro uso (so de tela,
 * nunca gravado); e o contador de tokens da conversa, com o que veio do cache
 * de prompt contado a parte.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). Os elementos e os totais sao
 * estado do painel; cada funcao o recebe como contexto.
 */

import { formatTokens, isSubProvider } from './ai_metadata.js';
import { escapeHtml } from './chat_render.js';

/** O que os indicadores leem e escrevem do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDosIndicadores {
  messagesEl: HTMLElement;
  thinkingEl: HTMLElement | null;
  cliDownloadEl?: HTMLElement | null;
  tokenCounter: HTMLElement;
  cumulativeTokens: number;
  cacheLidos?: number;
  cacheEscritos?: number;
  currentProvider: string | null;
  modelPopoverOpen: boolean;
  scrollToBottom(): void;
  refreshSubStatus?(): unknown;
  refreshSubUsage(): unknown;
}

/** Um pacote `cli-download` do main, numa das fases do primeiro uso. */
export interface PacoteDeDownload { phase?: string; cli?: string; pct?: number; received?: number; total?: number }

/** O uso de um turno, nos formatos em que os provedores o mandam. */
export interface UsoDoTurno {
  totalTokens?: number;
  inputTokens?: number; outputTokens?: number;
  promptTokens?: number; completionTokens?: number;
  cacheAurora?: { lidos?: number; escritos?: number };
}

const PALAVRAS = [
  'Descombobulating', 'Reticulating splines', 'Calibrating flux',
  'Summoning quarks', 'Consulting the oracle', 'Defragmenting neurons',
  'Reverse-engineering vibes', 'Untangling spaghetti', 'Overclocking brain cells',
  'Pondering the imponderables', 'Aligning the qubits', 'Polishing the silicon',
  'Sweet-talking the compiler', 'Negotiating with yanc', 'Routing the nets',
  'Charging the flux capacitor', 'Counting to NUBITS', 'Folding the bitstream',
  'Tuning the oscillators', 'Herding the electrons', 'Waxing the waveforms',
  'Compiling confidence', 'Synthesizing brilliance', 'Asking the rubber duck',
  'Dividing by NUGAIN', 'Probing the testbench', 'Warming up the ALU',
  'Annealing the lattice', 'Sampling the aurora', 'Buffering inspiration',
  'Convincing the linter', 'Greasing the pipeline',
];

/** Os tres pontos que fazem as vezes de reticencias. */
const PONTOS = '<span class="ai-thinking-dots"><span></span><span></span><span></span></span>';

/** Mostra ou tira a palavra de pensando; mostrar de novo nao duplica. */
export function mostrarPensando(p: PainelDosIndicadores, mostrar: boolean): void {
  if (mostrar && !p.thinkingEl) {
    const word = PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)];
    const el = document.createElement('div');
    el.className = 'ai-thinking-wrap';
    // A palavra e os pontos dividem a linha; os pontos sao as reticencias,
    // entao nao vai "…" literal.
    el.innerHTML = `<em class="ai-thinking-word">${word}</em>` + PONTOS;
    p.messagesEl.appendChild(el);
    p.scrollToBottom();
    p.thinkingEl = el;
  } else if (!mostrar && p.thinkingEl) {
    p.thinkingEl.remove();
    p.thinkingEl = null;
  }
}

/**
 * O aviso enquanto a CLI de assinatura e baixada no primeiro uso. Usa a mesma
 * cara da palavra de pensando. A fase `done` (e o fim de qualquer turno) o tira.
 */
export function mostrarDownloadDaCli(p: PainelDosIndicadores, ev: PacoteDeDownload | null | undefined): void {
  if (!ev || ev.phase === 'done') {
    limparDownloadDaCli(p);
    if (ev && ev.phase === 'done') {
      // A CLI acabou de instalar. A palavra de pensando cobre o intervalo ate o
      // primeiro token, para o painel nao parecer travado depois de um download
      // longo, e a linha de estado deixa o "baixa no primeiro uso".
      mostrarPensando(p, true);
      p.refreshSubStatus?.();
    }
    return;
  }
  mostrarPensando(p, false); // a palavra brigaria com esta linha
  // Recria se faltar OU se ficou fora do documento (trocar ou limpar a
  // conversa esvazia as mensagens e deixaria uma referencia velha).
  if (!p.cliDownloadEl || !p.cliDownloadEl.isConnected) {
    const el = document.createElement('div');
    el.className = 'ai-thinking-wrap ai-cli-download';
    p.messagesEl.appendChild(el);
    p.cliDownloadEl = el;
  }
  const cli = ev.cli || 'AI CLI';
  let label: string;
  if (ev.phase === 'verify') label = `Verifying ${cli}…`;
  else if (ev.phase === 'extract') label = `Installing ${cli}…`;
  else {
    const mb = (n: number | undefined) => (Number(n || 0) / 1e6).toFixed(0);
    const size = (ev.total as number) > 0 ? ` · ${mb(ev.received)}/${mb(ev.total)} MB` : '';
    label = `Downloading ${cli} (first use)… ${ev.pct || 0}%${size}`;
  }
  p.cliDownloadEl.innerHTML = `<em class="ai-thinking-word">${escapeHtml(label)}</em>` + PONTOS;
  p.scrollToBottom();
}

export function limparDownloadDaCli(p: PainelDosIndicadores): void {
  if (p.cliDownloadEl) {
    p.cliDownloadEl.remove();
    p.cliDownloadEl = null;
  }
}

/**
 * Soma o uso do turno. O total chega como `totalTokens` ou como entrada mais
 * saida, conforme o provedor. O que veio do cache custou um decimo e e contado
 * a parte, para o titulo do contador dizer quanto saiu de graca.
 */
export function somarUso(p: PainelDosIndicadores, usage: UsoDoTurno | null | undefined): void {
  if (!usage) return;
  const total = usage.totalTokens ??
    ((usage.inputTokens ?? usage.promptTokens ?? 0) +
     (usage.outputTokens ?? usage.completionTokens ?? 0));
  if (total > 0) {
    p.cumulativeTokens += total;
  }
  const cache = usage.cacheAurora;
  if (cache && (cache.lidos || cache.escritos)) {
    p.cacheLidos = (p.cacheLidos || 0) + (cache.lidos || 0);
    p.cacheEscritos = (p.cacheEscritos || 0) + (cache.escritos || 0);
  }
  if (total > 0 || cache) atualizarContador(p);
}

/** O contador do composer, e o uso da assinatura se o popover estiver aberto. */
export function atualizarContador(p: PainelDosIndicadores): void {
  p.tokenCounter.textContent = formatTokens(p.cumulativeTokens);
  const doCache = p.cacheLidos
    ? ` (${p.cacheLidos.toLocaleString()} read from the prompt cache at a tenth of the price)`
    : '';
  p.tokenCounter.title = `${p.cumulativeTokens.toLocaleString()} tokens this conversation${doCache}`;
  // Com o popover aberto numa assinatura, o uso vivo pode ter andado com o turno.
  if (isSubProvider(p.currentProvider) && p.modelPopoverOpen) {
    p.refreshSubUsage();
  }
}
