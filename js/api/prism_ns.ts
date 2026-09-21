/**
 * prism_ns.ts: o namespace `AuroraAPI.prism`.
 *
 * Extraido VERBATIM do js/api/aurora_api.js (item 4 do roadmap: dividir aquele
 * arquivo em um modulo por namespace), pela mesma razao do git_ns.js: aqui
 * dentro nao entra a cadeia de imports do editor, entao o modulo carrega num
 * teste sem subir a IDE inteira. O aurora_api.js importa `prismNs` daqui e o
 * expoe como `AuroraAPI.prism`.
 *
 * Compilado por `tsc` (npm run build:ts) num prism_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ok, err } from './api_core.js';

/** O `unknown` do catch, normalizado sem mudar o que corre em execucao. */
function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}


/* ============================================================
 *  prism, o Simular do PRISM (a simulacao logica interativa)
 *
 *  A pagina do PRISM nao e este renderer: ela mora numa janela propria ou
 *  num <webview> da aba, com preload proprio. Todo metodo daqui e uma
 *  mensagem que o main entrega a ela e cuja resposta ele traz de volta
 *  (main/ipc/prism.js), na mesma forma { ok, data } do resto da API.
 *
 *  O que isto abre: ate aqui a assistente nao tinha como LER um valor de
 *  simulacao. GTKWave e Surfer sao janelas externas, e a onda era sempre
 *  uma figura para o humano olhar. Por aqui ela poe entradas, anda um
 *  numero exato de ticks e le o que os sinais valem, que e o laco de um
 *  teste, sem depender de pixel nenhum.
 * ========================================================== */

/** Manda um comando a pagina do PRISM. Nunca lanca. */
async function prismCmd(cmd: Record<string, unknown>) {
  if (!electronAPI.prismCommand) return err('this build cannot talk to the PRISM page');
  try {
    const r = await electronAPI.prismCommand(cmd);
    if (!r) return err('the PRISM page answered nothing');
    return r.ok ? ok(r.data) : err(r.error || 'the PRISM command failed');
  } catch (e) {
    return err(mensagemDe(e));
  }
}

export const prismNs = {
  /**
   * Estado da simulacao: modulo, tick, se roda, velocidade, meio periodo, os
   * niveis abertos, e o valor de cada entrada, saida e sinal do monitor.
   * Responde tambem com o PRISM fechado ou no esquematico, e e assim que se
   * descobre que ainda e preciso abrir.
   */
  async simStatus() {
    return prismCmd({ op: 'status' });
  },

  /**
   * Entra no modo Simular do modulo que esta na tela do PRISM. Sintetiza o
   * circuito com o Yosys, o que leva segundos; ja estando dentro, so devolve
   * o estado. Exige o PRISM aberto (compile_step 'prism').
   */
  async simEnter() {
    return prismCmd({ op: 'enter' });
  },

  /** Volta da simulacao para o esquematico estatico. */
  async simExit() {
    return prismCmd({ op: 'exit' });
  },

  /**
   * Comanda o tempo: run, pause, tick (um passo), next (proxima mudanca de
   * sinal), fast (sem espera entre ticks) ou reset (tick zero, registradores
   * no valor inicial, sem recompilar).
   */
  async simControl(action: string) {
    return prismCmd({ op: 'control', acao: action });
  },

  /** Velocidade em ticks por segundo enquanto roda; ajusta para a mais proxima da lista. */
  async simSetSpeed(ticksPerSecond: number) {
    return prismCmd({ op: 'speed', ticksPorSegundo: ticksPerSecond });
  },

  /** Meio periodo do relogio, em ticks. */
  async simSetHalfPeriod(ticks: number) {
    return prismCmd({ op: 'period', ticks });
  },

  /** Escreve numa entrada: 0 ou 1 num bit, ou o valor na base pedida num barramento. */
  async simSetInput({ name, value, base }: { name?: string, value?: unknown, base?: string } = {}) {
    return prismCmd({ op: 'input', nome: name, valor: value, base });
  },

  /** Os fios do nivel visivel que se pode levar ao monitor, com o valor de agora. */
  async simListWires() {
    return prismCmd({ op: 'wires' });
  },

  /**
   * Mexe no monitor de formas de onda: add, remove, base, trigger (o "parar
   * em", que interrompe a simulacao quando o sinal chega ao valor) ou clear.
   */
  async simMonitor({ action, signal, base, value }: {
    action?: string, signal?: string, base?: string, value?: unknown,
  } = {}) {
    return prismCmd({ op: 'monitor', acao: action, sinal: signal, base, valor: value });
  },

  /**
   * Anda um numero exato de ticks, ou ate um sinal valer o que se espera, e
   * responde com onde parou (motivo: ticks, valor ou tempo) e o estado ali.
   * E a forma de observar a simulacao sem ficar perguntando o estado em laco.
   */
  async simRunUntil({ ticks, signal, value, base, timeoutMs }: {
    ticks?: number, signal?: string, value?: unknown, base?: string, timeoutMs?: number,
  } = {}) {
    return prismCmd({ op: 'runUntil', ticks, sinal: signal, valor: value, base, limiteMs: timeoutMs });
  },

  /** Grava os sinais do monitor num .vcd e o abre no visualizador de ondas. */
  async simExportWave() {
    return prismCmd({ op: 'export' });
  },

  /** Navega os niveis: enter num submodulo pelo nome, back um nivel, top o de cima. */
  async simLevel({ action, name }: { action?: string, name?: string } = {}) {
    return prismCmd({ op: 'level', acao: action, nome: name });
  },
};

