// @ts-check
/**
 * prism_yosys_script.js: the Yosys script PRISM synthesises with.
 *
 * Split out of prism.js so the toolchain integration test can run the SAME
 * script the viewer runs, instead of a copy that would silently drift from
 * it. Pure string assembly: no I/O, no Electron.
 */

'use strict';

/**
 * Build the PRISM synthesis script.
 *
 * Every pass here is load-bearing:
 *
 * - `read_verilog -setattr src` records `src="file.v:line.col-line.col"` on
 *   each cell derived from the source. The @silimate/netlistsvg fork reads
 *   that attribute and emits an `onclick="gotosrc(...)"` per cell, which is
 *   what lets a double-click in the schematic open the right source line.
 * - `setundef -zero` replaces don't-care (x) values with constant 0. Without
 *   it, a `$pmux` with `full_case` yields `A=[x,x]` as an unreachable default
 *   branch, and netlistsvg draws those don't-cares as diagonal "ghost lines"
 *   (an invisible constant with fanout feeding several muxes). The default
 *   branch is unreachable, so substituting 0 does not change semantics.
 * - `opt_clean -purge` drops the wires and cells left dangling by that
 *   substitution.
 *
 * @param {string[]} fileList          absolute .v paths, forward slashes preferred
 * @param {string} topLevelModule      module name for `hierarchy -top`
 * @param {string} hierarchyJsonPath   where `write_json` should write
 * @returns {string} the .ys script contents
 */
function buildPrismYosysScript(fileList, topLevelModule, hierarchyJsonPath) {
  const top = validarIdentificadorVerilog(topLevelModule, 'top-level module');
  const readCommands = fileList
    .map((file) => `read_verilog -setattr src "${caminhoParaScript(file)}"`)
    .join('\n');

  return `
${readCommands}
hierarchy -top ${top}
proc
setundef -zero
opt_clean -purge
write_json "${hierarchyJsonPath}"
`;
}

/** Um identificador Verilog simples: e o que `hierarchy -top` e `-chparam` aceitam sem surpresa. */
const RE_IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Confere que um nome pode entrar no script do Yosys como esta.
 *
 * O script e texto interpretado linha a linha, e uma linha que comeca com `!`
 * e comando de shell para o Yosys. O nome do top level vem do .spf (basename
 * do topLevelFile) e o de um submodulo vem do renderer; nenhum dos dois passa
 * por escape, entao so o identificador puro entra. Lanca com mensagem que diz
 * qual nome e por que, porque um nome com espaco ou acento so quebrava a
 * sintese com erro obscuro do Yosys.
 *
 * @param {any} nome
 * @param {string} papel  como o nome aparece na mensagem (`top-level module`, `parameter`)
 * @returns {string} o proprio nome, validado
 */
function validarIdentificadorVerilog(nome, papel = 'module') {
  const s = typeof nome === 'string' ? nome : '';
  if (!s) throw new Error(`${papel} name is missing (is the top-level set in the .spf?)`);
  if (!RE_IDENTIFICADOR.test(s)) {
    throw new Error(`${papel} name is not a plain Verilog identifier: ${JSON.stringify(s)}`);
  }
  return s;
}

/**
 * Um caminho que pode ir entre aspas num `read_verilog "..."`.
 *
 * Aspas duplas fechariam o argumento no meio e quebra de linha viraria um
 * comando novo; nenhum caminho legitimo do projeto tem isso, entao e recusa e
 * nao escape. Espaco e acento passam, porque estao entre aspas.
 *
 * @param {any} file
 * @returns {string}
 */
function caminhoParaScript(file) {
  const s = typeof file === 'string' ? file : '';
  if (!s || /["\r\n]/.test(s)) {
    throw new Error(`Verilog source path cannot be written into the Yosys script: ${JSON.stringify(s)}`);
  }
  return s;
}

module.exports = { buildPrismYosysScript, validarIdentificadorVerilog, caminhoParaScript };
