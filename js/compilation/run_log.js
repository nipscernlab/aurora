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

/** Versao do formato. Mudou o formato, muda aqui, e quem le sabe o que esperar. */
export const FORMATO = 1;

/**
 * Abre uma execucao.
 *
 * @param {{pedido:string, projeto?:string, config?:object, agora?:number}} p
 *   `pedido` e o que o usuario clicou ('cmm', 'wave', 'all', ...), e nao o que
 *   o sistema decidiu fazer: e a intencao que da sentido ao resto.
 */
export function abrirExecucao({ pedido, projeto = null, config = null, agora = Date.now() }) {
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
export function idDe(ms, pedido) {
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
export function retrato(config) {
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
export function anotarPasso(exec, obs, { concorrente = false } = {}) {
  if (!exec || !obs) return exec;
  const passo = {
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
function nomeDoBinario(caminho) {
  return String(caminho || '').split(/[\\/]/).pop() || null;
}

/** Fecha a execucao com o desfecho. */
export function fecharExecucao(exec, { ok, erro = null, cancelada = false, agora = Date.now() }) {
  if (!exec) return exec;
  exec.fim = agora;
  exec.ms = agora - exec.inicio;
  exec.ok = !!ok;
  exec.cancelada = !!cancelada;
  exec.erro = erro ? String(erro).slice(0, 2000) : null;
  return exec;
}

/**
 * Quais arquivos apagar para o historico nao crescer sem fim.
 *
 * Guardar tudo para sempre transforma a pasta do projeto em deposito, e o
 * valor do historico esta nas ultimas execucoes: e nelas que a pergunta "por
 * que mudou" e feita. Cinquenta cobre semanas de uso normal.
 *
 * @param {string[]} nomes nomes de arquivo, como estao no disco
 * @param {number} limite quantos manter
 * @returns {string[]} os que devem sair, do mais antigo para o mais novo
 */
export function podar(nomes, limite = 50) {
  const ordenados = (nomes || []).filter((n) => /\.json$/i.test(n)).sort();
  return ordenados.length <= limite ? [] : ordenados.slice(0, ordenados.length - limite);
}
