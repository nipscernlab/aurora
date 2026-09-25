/**
 * cancelamento.ts: o estado de "o usuario cancelou a compilacao".
 *
 * Morava solto no compilation_flow, lido por tres caminhos (o funil de erro,
 * o registro da execucao e o botao Cancelar) e por outros tres arquivos via
 * window.isCompilationCanceled. Aqui ele tem dono e uma porta so.
 *
 * Duas bandeiras, que zeram juntas no inicio de cada rodada:
 *   - cancelada: o usuario pediu. Um cancelamento que cai DENTRO de um passo
 *     mata o processo filho, e o passo rejeita com o erro da ferramenta
 *     morrendo; e esta bandeira que faz esse erro ser lido como o cancelamento.
 *   - cartao mostrado: o cartao "compilacao cancelada" pertence ao
 *     CANCELAMENTO, nao a cada caminho que morreu por causa dele. Sem esta
 *     marca, um clique escrevia o cartao uma vez por caminho.
 *
 * Compilado por `tsc` (npm run build:ts) num cancelamento.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

const tr = (k: string): string => (typeof window !== 'undefined' && window.t ? window.t(k) : k);

const TOKEN = Symbol.for('aurora.cancelled');

let cancelada = false;
let cartaoMostrado = false;

/** Inicio de rodada: o cancelamento anterior nao vale para esta. */
export function iniciarRodada(): void {
  cancelada = false;
  cartaoMostrado = false;
}

/** O usuario pediu para cancelar. Devolve false se ja estava cancelando. */
export function pedirCancelamento(): boolean {
  if (cancelada) return false;
  cancelada = true;
  return true;
}

/**
 * Nao havia nada rodando: o pedido se desfaz, senao um `checkCancellation()`
 * perdido entre este clique e a proxima compilacao a cancelaria sozinha.
 */
export function desfazerCancelamento(): void {
  cancelada = false;
  cartaoMostrado = false;
}

/** A rodada atual (ou a ultima) foi cancelada pelo usuario? */
export function foiCancelada(): boolean {
  return cancelada;
}

/** Marca o cartao como escrito. Devolve true so na primeira vez da rodada. */
export function primeiroCartao(): boolean {
  if (cartaoMostrado) return false;
  cartaoMostrado = true;
  return true;
}

/** Erro que carrega a marca de cancelamento, para o funil de erro reconhecer. */
export function erroDeCancelamento(): Error {
  const err = new Error(tr('error.user.cancelled'));
  (err as Error & { [TOKEN]?: boolean })[TOKEN] = true;
  return err;
}

export function eCancelamento(error: unknown): boolean {
  return !!(error && (error as { [TOKEN]?: boolean })[TOKEN]);
}

/** Entre fases: lanca o erro de cancelamento se o usuario ja cancelou. */
export function checkCancellation(): void {
  if (cancelada) throw erroDeCancelamento();
}

if (typeof window !== 'undefined') {
  // Leitura sem lancar, para quem so precisa ficar quieto depois do cancelamento
  // (a barra de progresso do terminal, que se reconstruiria de pedacos de saida
  // ainda em transito). Sai de window quando os tres leitores importarem daqui.
  window.isCompilationCanceled = foiCancelada;
}
