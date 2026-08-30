/**
 * prism_wave_layout.js: o layout da onda da simulacao do PRISM.
 *
 * O monitor do PRISM grava um .vcd com os sinais que a pessoa escolheu, e o
 * visualizador o abria vazio: a lista de variaveis a esquerda e nenhuma onda
 * na tela, cada sinal a ser arrastado de novo. Aqui os mesmos sinais viram um
 * layout, no formato de cada visualizador, para a onda abrir ja montada.
 *
 * A curadoria e a do monitor: os sinais que estavam nele, na base em que ele
 * os mostrava. O que se acrescenta e a ordem por papel, relogio, entradas,
 * saidas e internos, cada grupo sob um divisor e com uma cor propria, para
 * quem olha saber de longe o que entra e o que sai do modulo. Um grupo so
 * dispensa o divisor.
 *
 * Dois formatos, os mesmos do passo Wave: o estado do Surfer (.surf.ron,
 * buildSurferState) e o save do GTKWave (.gtkw, buildCustomGtkw). Os nomes
 * seguem os do .vcd escrito por main/ipc/prism_vcd.js: o modulo e o escopo de
 * cima, cada segmento do caminho de submodulos e um escopo dentro dele, e um
 * barramento de N bits chama-se `nome[N-1:0]` no GTKWave.
 *
 * Modulo puro: entra a lista de sinais, saem dois textos. Nao grava nada.
 */

import { buildSurferState } from './surfer_layout_writer.js';
import { buildCustomGtkw } from './gtkw_custom.js';

/** Os papeis, na ordem em que os grupos aparecem, com o titulo do divisor. */
const PAPEIS = Object.freeze([
  ['clock', 'Clock'],
  ['input', 'Inputs'],
  ['output', 'Outputs'],
  ['internal', 'Internal'],
]);

/** A cor de cada papel no Surfer; o relogio fica na cor padrao, mais baixo. */
const COR_SURFER = Object.freeze({ clock: null, input: 'Yellow', output: 'Green', internal: 'Orange' });

/** A base do monitor no nome do tradutor do Surfer. */
const FORMATO_SURFER = Object.freeze({ hex: 'Hexadecimal', dec: 'Unsigned', bin: 'Binary', oct: 'Octal' });

/** A base do monitor na radix do .gtkw; o GTKWave da casa nao tem octal. */
const RADIX_GTKW = Object.freeze({ hex: 'hex', dec: 'dec', bin: 'bin', oct: 'hex' });

/**
 * @typedef {object} SinalDoMonitor
 * @property {string} nome
 * @property {string[]} [caminho]  submodulos ate o sinal, do topo para dentro
 * @property {number} [bits]
 * @property {string} [base]       hex | dec | bin | oct (so vale para barramento)
 * @property {string} [papel]      clock | input | output | internal
 */

/**
 * Normaliza um sinal como veio do monitor; devolve null se nao tem nome.
 * @param {any} s
 */
function normalizar(s) {
  const nome = s && typeof s.nome === 'string' ? s.nome.trim() : '';
  if (!nome) return null;
  const bits = Math.max(1, Math.floor(Number(s.bits) || 1));
  const caminho = Array.isArray(s.caminho) ? s.caminho.map((c) => String(c)).filter(Boolean) : [];
  const base = String(s.base || (bits > 1 ? 'hex' : 'bin')).toLowerCase();
  const papel = PAPEIS.some(([p]) => p === s.papel) ? s.papel : 'internal';
  return { nome, bits, caminho, base, papel };
}

/**
 * Monta os dois layouts a partir dos sinais do monitor.
 *
 * @param {{ modulo: string, vcdPath: string, sinais: SinalDoMonitor[] }} entrada
 * @returns {{ surfer: string|null, gtkw: string|null, quantidade: number }}
 */
export function montarLayoutDaOndaDoPrism({ modulo, vcdPath, sinais } = {}) {
  const raiz = String(modulo || '').trim();
  const lista = (Array.isArray(sinais) ? sinais : []).map(normalizar).filter(Boolean);
  if (!raiz || !lista.length) return { surfer: null, gtkw: null, quantidade: 0 };

  // Um grupo por papel, na ordem dos papeis; dentro do grupo, a ordem do
  // monitor. Grupos vazios nao aparecem, e com um so nao ha o que separar.
  const grupos = PAPEIS
    .map(([papel, titulo]) => ({ papel, titulo, sinais: lista.filter((s) => s.papel === papel) }))
    .filter((g) => g.sinais.length);
  const comDivisores = grupos.length > 1;

  const itens = [];
  const gtkwSinais = [];
  for (const g of grupos) {
    if (comDivisores) itens.push({ kind: 'divider', name: g.titulo });
    for (const s of g.sinais) {
      itens.push({
        kind: 'variable',
        scope: [raiz, ...s.caminho],
        name: s.nome,
        // 'Bit' e o tradutor que desenha onda quadrada; 'Binary' desenharia
        // uma caixa com 0 ou 1 dentro, e um relogio viraria numero.
        format: s.bits > 1 ? (FORMATO_SURFER[s.base] || 'Hexadecimal') : 'Bit',
        color: COR_SURFER[g.papel],
        heightScale: g.papel === 'clock' ? 0.8 : null,
      });
      gtkwSinais.push({
        path: `${[raiz, ...s.caminho, s.nome].join('.')}${s.bits > 1 ? `[${s.bits - 1}:0]` : ''}`,
        radix: s.bits > 1 ? (RADIX_GTKW[s.base] || 'hex') : 'bin',
        group: comDivisores ? g.titulo : null,
      });
    }
  }

  const surfer = buildSurferState({ vcdPath: String(vcdPath || ''), sourceFormat: 'Vcd', items: itens });
  const gtkw = buildCustomGtkw({
    signals: gtkwSinais,
    dumpPath: vcdPath || null,
    title: `PRISM ${raiz}`,
  });
  return { surfer, gtkw: gtkw.conteudo || null, quantidade: lista.length };
}
