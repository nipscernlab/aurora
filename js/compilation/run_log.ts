/**
 * O registro de uma execucao de compilacao.
 *
 * O PROBLEMA, que e o que decide o desenho: nao da para saber de antemao o que
 * o usuario vai compilar. Ele pode pedir so o C±, so o Verilog, a onda, o
 * PRISM, ou a compilacao inteira, e cada um desses aciona um numero diferente
 * de ferramentas. Um "log de compilacao" com formato fixo nao cabe nisso.
 *
 * A SAIDA e inverter a unidade. O que se grava nao e "a compilacao", e sim uma
 * EXECUCAO: um clique num botao abre uma, e ela guarda o que de fato
 * aconteceu, sejam quatro ferramentas ou uma. Compilar so o C± vira uma
 * execucao de um passo; a compilacao inteira vira uma de varios. Nenhum dos
 * dois precisou ser previsto.
 *
 * O que transforma isso num HISTORICO COERENTE, que e o pedido de verdade, e o
 * retrato que vai junto: quais arquivos eram as entradas, qual era o topo de
 * sintese e o de simulacao, qual simulador e qual visualizador estavam
 * escolhidos. Com ele, "o que aconteceu nesta compilacao" tem resposta, e a
 * pergunta mais util, "por que o resultado de ontem era diferente", vira
 * comparar dois retratos em vez de lembrar.
 *
 * Este modulo e puro: monta, fecha e poda. Quem escreve em disco e o processo
 * principal, e quem sabe quando uma execucao comeca e termina e o
 * compilation_flow.
 */

import type { RunObservation } from './spec_runner.js';

/** Versao do formato. Mudou o formato, muda aqui, e quem le sabe o que esperar. */
export const FORMATO = 1;

/** O que o compilation_flow junta do .spf e das preferencias no clique. */
export interface ConfigDoRetrato {
  topLevelFile?: string | null;
  testbenchFile?: string | null;
  synthesizableFiles?: string[];
  simulador?: string | null;
  visualizador?: string | null;
  processadores?: string[];
}

/** O retrato gravado: so o que muda o resultado. */
export interface Retrato {
  topoSintese: string | null;
  topoSimulacao: string | null;
  fontes: string[];
  simulador: string | null;
  visualizador: string | null;
  processadores: string[];
}

/** Uma ferramenta que rodou. */
export interface PassoGravado {
  step: string | null;
  ferramenta: string | null;
  args: string[];
  code: number | null;
  ms: number | null;
  concorrente?: boolean;
}

/** Um problema como vai para o registro. */
export interface ProblemaNoRegistro {
  arquivo: string;
  linha: number;
  coluna: number | null;
  severidade?: string;
  ferramenta?: string;
  mensagem: string;
}

/** O registro de uma execucao, como vai para o disco. */
export interface Execucao {
  formato: number;
  id: string;
  pedido: string;
  projeto: string | null;
  inicio: number;
  fim: number | null;
  ms?: number;
  ok: boolean | null;
  erro: string | null;
  cancelada: boolean;
  passos: PassoGravado[];
  estado: Retrato | null;
  problemas?: ProblemaNoRegistro[];
}

/** Uma linha da lista: o mesmo formato para a gravada e para a viva. */
export interface ResumoDeExecucao {
  id: string;
  pedido?: string;
  inicio: number;
  ms?: number;
  passos?: number;
  ok?: boolean | null;
  cancelada?: boolean;
  andando?: boolean;
}

/**
 * Abre uma execucao.
 *
 *   `pedido` e o que o usuario clicou ('cmm', 'wave', 'all', ...), e nao o que
 *   o sistema decidiu fazer: e a intencao que da sentido ao resto.
 */
export function abrirExecucao({ pedido, projeto = null, config = null, agora = Date.now() }: { pedido: string; projeto?: string | null; config?: ConfigDoRetrato | null; agora?: number }): Execucao {
  return {
    formato: FORMATO,
    id: idDe(agora, pedido),
    pedido,
    projeto,
    inicio: agora,
    fim: null,
    ok: null,
    erro: null,
    cancelada: false,
    passos: [],
    estado: retrato(config),
  };
}

/** `2026-08-29T14-22-31-wave`, que ordena por nome e diz o que foi. */
export function idDe(ms: number, pedido: string | null | undefined): string {
  const iso = new Date(ms).toISOString().replace(/\.\d+Z$/, '').replace(/[:]/g, '-');
  return `${iso}-${String(pedido || 'exec').replace(/[^\w-]/g, '')}`;
}

/**
 * O retrato do projeto no momento da execucao.
 *
 * So o que muda o RESULTADO: os arquivos que entram, quem e topo de cada
 * categoria, e as duas preferencias que trocam a ferramenta usada. Nao e um
 * despejo do `.spf`; um retrato que guarda tudo nao se compara com outro.
 */
export function retrato(config: ConfigDoRetrato | null | undefined): Retrato | null {
  if (!config) return null;
  return {
    topoSintese: config.topLevelFile || null,
    topoSimulacao: config.testbenchFile || null,
    fontes: Array.isArray(config.synthesizableFiles) ? config.synthesizableFiles.slice().sort() : [],
    simulador: config.simulador || null,
    visualizador: config.visualizador || null,
    processadores: Array.isArray(config.processadores) ? config.processadores.slice().sort() : [],
  };
}

/**
 * Anota uma ferramenta que rodou.
 *
 * `concorrente` marca o passo que aconteceu com MAIS DE UMA execucao no ar. Com
 * duas abertas ao mesmo tempo, e o caso comum e clicar no PRISM enquanto a onda
 * roda, nao da para saber qual delas causou cada ferramenta; as duas recebem o
 * aviso. Marcar e melhor do que escolher uma e mentir, e melhor do que perder o
 * passo, que foi o que a primeira versao fez.
 */
export function anotarPasso(exec: Execucao | null, obs: Partial<RunObservation> | null, { concorrente = false } = {}): Execucao | null {
  if (!exec || !obs) return exec;
  const passo: PassoGravado = {
    step: obs.step || null,
    ferramenta: nomeDoBinario(obs.binary),
    args: Array.isArray(obs.args) ? obs.args : [],
    code: typeof obs.code === 'number' ? obs.code : null,
    ms: typeof obs.ms === 'number' ? obs.ms : null,
  };
  if (concorrente) passo.concorrente = true;
  exec.passos.push(passo);
  return exec;
}

/** `C:/comp/.../iverilog.exe` vira `iverilog.exe`; o caminho inteiro fica nos args. */
function nomeDoBinario(caminho: string | undefined): string | null {
  return String(caminho || '').split(/[\\/]/).pop() || null;
}

/**
 * O desfecho de uma execucao, a partir dos tres fatos que existem sobre ela.
 *
 * O registro marcava OK sempre que a promessa do corpo resolvia, e a promessa
 * resolve QUASE SEMPRE: o executor nunca rejeita (devolve `{ code }` mesmo com
 * saida diferente de zero), e cada handler captura o erro do compilador, mostra
 * "Erro Fatal" no terminal e retorna normalmente. Resultado medido no disco:
 * `cmmcomp.exe code=1` gravado como `ok: true`, o historico dizendo OK para a
 * compilacao que a pessoa acabou de ver falhar.
 *
 * O codigo de saida dos passos NAO serve de criterio, e isto e deliberado. O
 * passo de hierarquia do yosys falha com code=1 e e tratado como AVISO (a arvore
 * ja esta montada, o resumo e cortesia); uma regra "qualquer passo nao zero
 * falhou" marcaria como falha as rodadas do PRISM que funcionaram. O que vale e
 * o que o handler decidiu: se ele chamou o funil de erro fatal, falhou.
 *
 * Cancelar nao e falhar: e um terceiro estado, e o que era OK-por-engano em
 * cancelamento engolido vira "cancelada".
 *
 */
export function desfechoDaExecucao({ resolveu, falha = null, cancelada = false, erro = null }: { resolveu: boolean; falha?: { mensagem?: string; }|null; cancelada?: boolean; erro?: unknown; }): { ok: boolean; erro: string|null; cancelada: boolean; } {
  if (cancelada) return { ok: false, erro: null, cancelada: true };
  if (!resolveu) {
    return { ok: false, erro: erro == null ? null : String(erro && (erro as Error).message ? (erro as Error).message : erro), cancelada: false };
  }
  if (falha) return { ok: false, erro: falha.mensagem ? String(falha.mensagem) : null, cancelada: false };
  return { ok: true, erro: null, cancelada: false };
}

/**
 * Quantos problemas cabem no registro de uma execucao.
 *
 * O registro vai para o disco e e lido inteiro pela tela; um build que falha em
 * cascata pode imprimir centenas de linhas de erro, e guardar todas transforma
 * um arquivo de historico em um log. Os primeiros sao os que importam: em
 * compilador, o primeiro erro costuma ser a causa dos outros.
 */
const MAX_PROBLEMAS_NO_REGISTRO = 20;

/**
 * Os problemas de uma execucao, achatados e cortados para caber no registro.
 *
 * Entra o que a leitura da saida (js/terminal/error_locations.js) ja
 * estruturou: arquivo, linha, gravidade e a MENSAGEM DO COMPILADOR. Antes
 * disto o registro guardava apenas o texto que a AURORA montou a partir do
 * codigo de saida ("CMM compilation failed with code 1"), que diz que falhou e
 * nao diz o que houve; o erro de verdade existia so no terminal, e sumia com
 * ele.
 *
 */
export function problemasParaRegistro(porArquivo: Array<{ arquivo: string; problemas: Array<{ linha: number; coluna?: number | null; severidade?: string; ferramenta?: string; mensagem?: string }> }>, limite = MAX_PROBLEMAS_NO_REGISTRO): ProblemaNoRegistro[] {
  const saida: ProblemaNoRegistro[] = [];
  for (const grupo of (porArquivo || [])) {
    for (const p of (grupo.problemas || [])) {
      if (saida.length >= limite) return saida;
      saida.push({
        arquivo: grupo.arquivo,
        linha: p.linha,
        coluna: p.coluna ?? null,
        severidade: p.severidade,
        ferramenta: p.ferramenta,
        mensagem: String(p.mensagem || '').slice(0, 500),
      });
    }
  }
  return saida;
}

/** Fecha a execucao com o desfecho. */
export function fecharExecucao(exec: Execucao | null, { ok, erro = null, cancelada = false, problemas = null, agora = Date.now() }: { ok: boolean; erro?: string | null; cancelada?: boolean; problemas?: ProblemaNoRegistro[] | null; agora?: number }): Execucao | null {
  if (!exec) return exec;
  exec.fim = agora;
  exec.ms = agora - exec.inicio;
  exec.ok = !!ok;
  exec.cancelada = !!cancelada;
  exec.erro = erro ? String(erro).slice(0, 2000) : null;
  if (Array.isArray(problemas) && problemas.length) exec.problemas = problemas;
  return exec;
}

/**
 * Quais arquivos apagar para o historico nao crescer sem fim.
 *
 * Guardar tudo para sempre transforma a pasta do projeto em deposito, e o
 * valor do historico esta nas ultimas execucoes: e nelas que a pergunta "por
 * que mudou" e feita. Cinquenta cobre semanas de uso normal.
 *
 * @param nomes nomes de arquivo, como estao no disco
 * @param limite quantos manter
 * @returns os que devem sair, do mais antigo para o mais novo
 */
export function podar(nomes: string[], limite: number = 50): string[] {
  const ordenados = (nomes || []).filter((n) => /\.json$/i.test(n)).sort();
  return ordenados.length <= limite ? [] : ordenados.slice(0, ordenados.length - limite);
}

/**
 * O resumo de uma execucao, no MESMO formato que a listagem do disco devolve.
 *
 * Existe por causa da tela ao vivo: a execucao em andamento ainda nao tem
 * arquivo, porque so se grava no fim, e mesmo assim precisa aparecer na lista
 * ao lado das que ja terminaram. Se a linha viva tivesse um formato proprio, a
 * tela teria dois desenhos de linha e duas chances de divergirem; com o mesmo
 * formato, ela tem um so e a linha viva simplesmente vira a linha gravada
 * quando a execucao acaba.
 *
 * `ms` de quem ainda roda e o tempo ATE AGORA, e nao nulo: numa execucao longa
 * o que a pessoa quer saber e ha quanto tempo aquilo esta rodando.
 */
export function resumo(exec: Execucao | null, agora = Date.now()): ResumoDeExecucao | null {
  if (!exec) return null;
  const terminou = typeof exec.fim === 'number';
  return {
    id: exec.id,
    pedido: exec.pedido,
    inicio: exec.inicio,
    ms: terminou ? (exec.ms ?? (exec.fim as number) - exec.inicio) : Math.max(0, agora - exec.inicio),
    ok: exec.ok,
    cancelada: !!exec.cancelada,
    passos: Array.isArray(exec.passos) ? exec.passos.length : 0,
    andando: !terminou,
  };
}
