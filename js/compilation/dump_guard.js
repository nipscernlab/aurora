/**
 * dump_guard.js: as regras puras da blindagem do dump de simulação.
 *
 * O problema que isto resolve (relato do laboratório, 25/08/2026): em máquina
 * travada por antivírus/política de administrador, o simulador não consegue
 * SOBRESCREVER o `.vcd`/`.fst` da rodada anterior na pasta do projeto. O vvp
 * até avisa (`FST Error: Unable to open ... for output`, exit 1), mas a
 * mensagem se perde no meio da saída e o aluno só vê "a simulação falhou",
 * sem saber que a correção é destravar UM arquivo. Criar arquivo novo
 * funciona (a AURORA cria pela árvore normalmente) porque criar e sobrescrever
 * são operações diferentes para essas políticas — foi por isso que "deletar o
 * .vcd à mão" resolvia.
 *
 * Duas defesas, e quem as executa é compilation_module:
 *
 *   1. ANTES de simular: conferir que os dumps esperados, SE existirem, podem
 *      ser abertos em escrita (IPC file:check-writable, um open 'r+' que não
 *      altera nada). Bloqueado → erro imediato dizendo qual arquivo e o que
 *      fazer, sem gastar a simulação. Medido no Windows real: viewer prendendo
 *      o arquivo dá EBUSY; somente-leitura/política dá EPERM. GTKWave aberto
 *      NÃO bloqueia sobreposição (fopen compartilha escrita), então o teste é
 *      de escrita, nunca de deleção — deleção falha com o viewer aberto num
 *      caso que simularia normalmente.
 *
 *   2. DEPOIS de simular: conferir que o dump resolvido é DESTA corrida, pelo
 *      mtime contra o instante em que a simulação começou. Pega qualquer
 *      escritor que falhe sem exit code (e o caso do $dumpfile de nome custom
 *      adotado pelo resolver), e transforma "onda velha abrindo como se fosse
 *      nova" em erro nomeado.
 *
 * Este módulo guarda só o que é puro (nomes e o veredito de frescor), para o
 * teste de unidade cobrir as bordas sem subir Electron.
 */

/** Nomes de dump que os fluxos vvp/Verilator produzem para um sim-top. */
export function nomesDeDumpEsperados(simTopModule) {
  return [`${simTopModule}.fst`, `${simTopModule}.vcd`];
}

/** O runner do cocotb nomeia o dump ele mesmo, sempre `dump.*`. */
export const NOMES_DE_DUMP_COCOTB = ['dump.fst', 'dump.vcd'];

/**
 * O dump é desta corrida? `mtimeMs >= inicioMs - folgaMs`.
 *
 * A folga de 2 s absorve a granularidade de mtime de FAT/exFAT (2 s) e
 * arredondamento de relógio; só afrouxa no sentido seguro (aceitar um dump
 * legítimo escrito logo no início), nunca aceita o de uma corrida anterior,
 * que é minutos ou dias mais velho.
 *
 * Entrada sem número utilizável (stat falhou, campo ausente) devolve true:
 * fail-open de propósito, porque as defesas primárias são o exit code do
 * simulador e a checagem de escrita pré-simulação; um stat quebrado não pode
 * derrubar uma onda boa.
 */
export function dumpEstaFresco(mtimeMs, inicioMs, folgaMs = 2000) {
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(inicioMs)) return true;
  return mtimeMs >= inicioMs - folgaMs;
}
