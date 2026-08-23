// @ts-check
/**
 * prism_labels.js: o que o PRISM escreve em cima de uma celula cujo nome o
 * Yosys inventou.
 *
 * O netlistsvg rotula cada celula com o NOME DA INSTANCIA. Para o que o
 * usuario escreveu isso e o certo (`clk`, `addr_rd`, `mem_data`). Para o que
 * o Yosys criou sozinho ao mapear memorias e registradores, o nome e um
 * rastro de fabrica: `memrd$\mem$C:\...\processor.v:77$272` ou
 * `auto$proc_memwr.cc:45:proc_memwr$1163`, com caminho absoluto, numero de
 * linha e um contador. Nada disso diz ao aluno o que a celula faz. O tipo da
 * celula diz: `$memrd` e uma porta de leitura, `$memwr` uma de escrita.
 *
 * Puro e sem electron, para ter teste.
 */

'use strict';

/** Tipos do Yosys com nome de gente. Sem `$` e sem o sufixo de versao. */
const NOMES = new Map([
  ['memrd', 'mem read'],
  ['memwr', 'mem write'],
  ['meminit', 'mem init'],
  ['mem', 'memory'],
  ['dff', 'dff'],
  ['adff', 'dff'],
  ['sdff', 'dff'],
  ['dffe', 'dff'],
  ['adffe', 'dff'],
  ['sdffe', 'dff'],
  ['dlatch', 'latch'],
  ['mux', 'mux'],
  ['pmux', 'pmux'],
]);

/**
 * Um nome de instancia que o Yosys inventou, e nao o usuario. O `$` nunca
 * aparece em identificador Verilog comum, e e o que o Yosys usa para marcar
 * os seus.
 * @param {string} instName
 */
function isAutoName(instName) {
  return typeof instName === 'string' && instName.includes('$');
}

/**
 * O rotulo para uma celula: o proprio nome quando foi o usuario que deu, e
 * uma descricao do tipo quando foi o Yosys.
 * @param {string} instName nome da instancia no JSON do Yosys
 * @param {string|undefined} type tipo da celula (`$memrd`, `$memwr_v2`, ...)
 * @returns {string}
 */
function cellLabel(instName, type) {
  if (!isAutoName(instName)) return instName;
  const base = String(type || '').replace(/^\$+/, '').replace(/_v\d+$/, '');
  if (!base) return '';
  return NOMES.get(base) || base;
}

module.exports = { isAutoName, cellLabel };
