// @ts-check
/**
 * prism_sim_target.js: de que modulo, com que parametros, a simulacao parte.
 *
 * O PRISM guarda o nome CRU que o yosys deu ao modulo aberto, e para um modulo
 * parametrizado esse nome nao e o do Verilog: e algo como
 * `$paramod\ula_fdiv\NBMANT=s32'000...010111`, ou, quando o yosys resolve
 * abreviar, `$paramod$<hash>\core`. Mandar isso para `hierarchy -top` nao
 * acha modulo nenhum, e a primeira versao caia no topo do projeto em silencio:
 * a pessoa clicava Simular na ula_fdiv e via o processador inteiro estourar o
 * tempo, sem entender por que.
 *
 * Aqui o nome cru vira o nome do Verilog mais a lista de `-chparam`, para a
 * simulacao ser DO MODULO COM OS PARAMETROS QUE ELE TEM no projeto, e nao do
 * modulo com os padroes. Na forma com hash os parametros nao estao no nome;
 * ai sobra o modulo com os padroes, e isso e dito, nao escondido.
 *
 * Puro, sem yosys e sem Electron: e o tipo de conversao que so se confia
 * depois de testada contra nomes reais.
 */

'use strict';

/**
 * Um valor de parametro como o yosys escreve no nome: `s32'0101...` (com
 * sinal, largura, binario), ou um numero decimal simples.
 * @param {string} bruto
 * @returns {string|null} o valor como o `-chparam` aceita, ou null se nao der
 */
function valorDeParametro(bruto) {
  const m = /^(s?)(\d+)'([01xz]+)$/i.exec(bruto);
  if (m) {
    const bits = m[3].toLowerCase();
    if (/[xz]/.test(bits)) return null;
    let n = BigInt('0b' + bits);
    // Com sinal e o bit alto ligado, e negativo em complemento de dois.
    if (m[1] && bits.length > 0 && bits[0] === '1') n -= (1n << BigInt(bits.length));
    return n.toString();
  }
  if (/^-?\d+$/.test(bruto)) return bruto;
  return null;
}

/**
 * @param {string} nomeCru
 * @returns {{ modulo: string, chparams: Array<[string, string]>, parametrosPerdidos: boolean }}
 *   `parametrosPerdidos` e true quando o nome nao carrega os parametros (forma
 *   com hash) e a simulacao vai sair com os padroes do Verilog.
 */
function alvoDaSimulacao(nomeCru) {
  const nome = String(nomeCru || '').trim();
  if (!nome.startsWith('$paramod')) {
    return { modulo: nome, chparams: [], parametrosPerdidos: false };
  }
  // `$paramod\base\K=V\K2=V2` ou `$paramod$hash\base`
  const partes = nome.split('\\').filter(Boolean);
  const cabeca = partes.shift() || '';
  const modulo = partes.shift() || '';
  const comHash = cabeca.length > '$paramod'.length; // `$paramod$<hash>`
  /** @type {Array<[string, string]>} */
  const chparams = [];
  let perdidos = comHash;
  for (const p of partes) {
    const i = p.indexOf('=');
    if (i <= 0) { perdidos = true; continue; }
    // A chave entra no script do Yosys como esta, e uma linha comecada por `!`
    // la e comando de shell: so identificador Verilog puro passa.
    const chave = p.slice(0, i);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) { perdidos = true; continue; }
    const v = valorDeParametro(p.slice(i + 1));
    if (v === null) { perdidos = true; continue; }
    chparams.push([chave, v]);
  }
  return { modulo, chparams, parametrosPerdidos: perdidos };
}

module.exports = { alvoDaSimulacao, valorDeParametro };
