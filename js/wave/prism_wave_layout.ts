/**
 * prism_wave_layout.ts: o layout da onda da simulacao do PRISM.
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

import { buildSurferState, type SurferColor, type SurferItem } from './surfer_layout_writer.js';
import { buildCustomGtkw } from './gtkw_custom.js';

type Papel = 'clock' | 'input' | 'output' | 'internal';

/** Os papeis, na ordem em que os grupos aparecem, com o titulo do divisor. */
const PAPEIS: ReadonlyArray<readonly [Papel, string]> = Object.freeze([
  ['clock', 'Clock'],
  ['input', 'Inputs'],
  ['output', 'Outputs'],
  ['internal', 'Internal'],
] as const);

/** A cor de cada papel no Surfer; o relogio fica na cor padrao, mais baixo. */
const COR_SURFER: Readonly<Record<Papel, SurferColor | null>> =
  Object.freeze({ clock: null, input: 'Yellow', output: 'Green', internal: 'Orange' });

/** A base do monitor no nome do tradutor do Surfer. */
const FORMATO_SURFER: Readonly<Record<string, string>> =
  Object.freeze({ hex: 'Hexadecimal', dec: 'Unsigned', bin: 'Binary', oct: 'Octal' });

/** A base do monitor na radix do .gtkw; o GTKWave da casa nao tem octal. */
const RADIX_GTKW: Readonly<Record<string, string>> = Object.freeze({ hex: 'hex', dec: 'dec', bin: 'bin', oct: 'hex' });

/** Um sinal como o monitor do PRISM o descreve. */
export interface SinalDoMonitor {
  nome: string;
  /** submodulos ate o sinal, do topo para dentro */
  caminho?: string[];
  bits?: number;
  /** hex | dec | bin | oct (so vale para barramento) */
  base?: string;
  /** clock | input | output | internal */
  papel?: string;
}

interface SinalNormalizado {
  nome: string;
  bits: number;
  caminho: string[];
  base: string;
  papel: Papel;
}

const ehPapel = (p: unknown): p is Papel => PAPEIS.some(([papel]) => papel === p);

/**
 * Normaliza um sinal como veio do monitor; devolve null se nao tem nome.
 */
function normalizar(s: Partial<SinalDoMonitor> | null | undefined): SinalNormalizado | null {
  const nome = s && typeof s.nome === 'string' ? s.nome.trim() : '';
  if (!s || !nome) return null;
  const bits = Math.max(1, Math.floor(Number(s.bits) || 1));
  const caminho = Array.isArray(s.caminho) ? s.caminho.map((c) => String(c)).filter(Boolean) : [];
  const base = String(s.base || (bits > 1 ? 'hex' : 'bin')).toLowerCase();
  const papel = ehPapel(s.papel) ? s.papel : 'internal';
  return { nome, bits, caminho, base, papel };
}

/**
 * Monta os dois layouts a partir dos sinais do monitor.
 */
export function montarLayoutDaOndaDoPrism(
  { modulo, vcdPath, sinais }: { modulo?: string; vcdPath?: string; sinais?: SinalDoMonitor[] } = {},
): { surfer: string | null; gtkw: string | null; quantidade: number } {
  const raiz = String(modulo || '').trim();
  const lista = (Array.isArray(sinais) ? sinais : []).map(normalizar)
    .filter((s): s is SinalNormalizado => s !== null);
  if (!raiz || !lista.length) return { surfer: null, gtkw: null, quantidade: 0 };

  // Um grupo por papel, na ordem dos papeis; dentro do grupo, a ordem do
  // monitor. Grupos vazios nao aparecem, e com um so nao ha o que separar.
  const grupos = PAPEIS
    .map(([papel, titulo]) => ({ papel, titulo, sinais: lista.filter((s) => s.papel === papel) }))
    .filter((g) => g.sinais.length);
  const comDivisores = grupos.length > 1;

  const itens: SurferItem[] = [];
  const gtkwSinais: { path: string; radix: string; group?: string }[] = [];
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
        // Sem divisores, sem grupo: o buildCustomGtkw le a falta como null.
        ...(comDivisores ? { group: g.titulo } : {}),
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
