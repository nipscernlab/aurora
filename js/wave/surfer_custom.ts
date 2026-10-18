/**
 * surfer_custom.ts: escreve um .surf.ron a partir de uma lista de sinais.
 *
 * O irmao do gtkw_custom.ts, do lado do Surfer, e com a mesma entrada: um
 * caminho por sinal, ou um objeto com base e grupo. Por cima, o que so o
 * Surfer tem: cor e rotulo por sinal.
 *
 * POR QUE .surf.ron, E NAO .sucl
 * ------------------------------
 * Ate 10/2026 a Aurora Intelligence escrevia um arquivo de comandos `.sucl`,
 * com o argumento de que o `.surf.ron` e a serializacao interna do Surfer, sem
 * esquema publicado. O argumento perdeu a forca: o fork e nosso e pinado, o
 * layout automatico e o do PRISM ja geram `.surf.ron` pelo
 * surfer_layout_writer.ts, e o `.sucl` nao monta grupo, nao da cor por sinal
 * e mira o sinal por um indice que erra em silencio (ver o cabecalho daquele
 * arquivo). O pedido explicito sai agora no mesmo formato do automatico (#185).
 *
 * O dump nao entra: o Surfer abre o que a AURORA passa na linha de comando, e
 * acha cada sinal pelo escopo e pelo nome. Um layout escrito antes da primeira
 * simulacao continua valido.
 *
 * Modulo puro, sem DOM e sem IPC: e onde o formato e testado.
 */

import { buildSurferState, type SurferColor, type SurferItem, type SurferVariableItem } from './surfer_layout_writer.js';

/** A base pedida, no nome do tradutor do Surfer. */
const TRADUTOR: Readonly<Record<string, string>> = Object.freeze({
  bin: 'Binary', dec: 'Unsigned', signed: 'Signed', hex: 'Hexadecimal', oct: 'Octal',
});

/** Os nomes de base aceitos em `radix`. */
export const RADIX_SURFER = Object.freeze(Object.keys(TRADUTOR));

/** As cores nomeadas do tema do Surfer. */
export const CORES_SURFER: readonly SurferColor[] = Object.freeze(
  ['Green', 'Red', 'Yellow', 'Blue', 'Pink', 'Orange', 'Gray', 'Violet'] as SurferColor[]);

/** Um sinal pedido: so o caminho, ou o caminho com o resto. */
type EntradaDeSinal = string | { path?: string; radix?: string; group?: string; color?: string; alias?: string } | null | undefined;

type SinalLimpo = { item: SurferVariableItem; group: string | null };

/**
 * Normaliza a entrada de um sinal, ou `null` quando ela nao aponta para nada
 * que o Surfer ache: sem caminho, ou sem escopo (o Surfer procura o sinal
 * dentro de um escopo, e `clk` sozinho nao diz qual).
 */
function normalizar(entrada: EntradaDeSinal): SinalLimpo | null {
  const bruto = typeof entrada === 'string' ? { path: entrada } : (entrada || {});
  // O range do barramento sai: o Surfer guarda o sinal pelo nome cru.
  const path = String(bruto.path || '').trim().replace(/\s*\[[^\]]*\]$/, '');
  const partes = path.split('.').filter(Boolean);
  if (partes.length < 2) return null;
  const radix = String(bruto.radix || '').toLowerCase();
  const cor = CORES_SURFER.find((c) => c === bruto.color) ?? null;
  return {
    item: {
      kind: 'variable',
      scope: partes.slice(0, -1),
      name: partes[partes.length - 1],
      format: TRADUTOR[radix] ?? null,
      color: cor,
      manualName: bruto.alias ? String(bruto.alias) : null,
    },
    group: bruto.group ? String(bruto.group).trim() || null : null,
  };
}

/**
 * Monta o texto de um .surf.ron com os sinais pedidos, na ordem dada. Sinais
 * vizinhos com o mesmo `group` ficam num grupo do Surfer, aberto, porque aqui
 * alguem pediu exatamente estes sinais e quer ve-los.
 */
export function buildCustomSurfer({ signals }: { signals?: EntradaDeSinal[] } = {}): { conteudo: string; sinais: number; ignorados: string[] } {
  const lista = Array.isArray(signals) ? signals : [];
  const ignorados: string[] = [];
  const limpos: SinalLimpo[] = [];
  for (const bruto of lista) {
    const s = normalizar(bruto);
    if (s) limpos.push(s);
    else ignorados.push(typeof bruto === 'string' ? bruto : JSON.stringify(bruto));
  }
  if (!limpos.length) return { conteudo: '', sinais: 0, ignorados };

  const itens: SurferItem[] = [];
  let grupo: { nome: string; filhos: SurferItem[] } | null = null;
  for (const s of limpos) {
    if (!s.group) { grupo = null; itens.push(s.item); continue; }
    if (!grupo || grupo.nome !== s.group) {
      grupo = { nome: s.group, filhos: [] };
      itens.push({ kind: 'group', name: s.group, isOpen: true, children: grupo.filhos });
    }
    grupo.filhos.push(s.item);
  }

  return { conteudo: buildSurferState({ vcdPath: '', items: itens }), sinais: limpos.length, ignorados };
}
