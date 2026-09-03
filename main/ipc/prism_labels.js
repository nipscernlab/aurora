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

/**
 * O texto de um `<text class="nodelabel cell_x">` deve ser trocado pelo rotulo?
 *
 * So quando ele e o proprio nome automatico do Yosys, que e o rotulo de
 * referencia que o netlistsvg escreve a partir de `s:attribute="ref"`. As
 * skins aritmeticas e logicas (assets/prism-skins) desenham o OPERADOR num
 * `<text>` com a mesma classe: "+", "−", "×", "÷", "%", "&", "≥1", "<<". A
 * troca cega apagava o desenho e escrevia "add", "sub", "mul", "div" no
 * lugar, que foi como os simbolos do PRISM sumiram. O nome de referencia
 * carrega o `$` do Yosys; um glifo nunca.
 *
 * @param {string} instName nome da instancia no SVG
 * @param {unknown} textoAtual o que o `<text>` tem hoje
 */
function deveTrocarRotulo(instName, textoAtual) {
  if (!isAutoName(instName)) return false;
  const t = String(textoAtual == null ? '' : textoAtual).trim();
  return t === '' || t.includes('$');
}

module.exports = { isAutoName, cellLabel, deveTrocarRotulo };
