/**
 * estrutura_antiga.ts: converter um projeto da estrutura de pastas de antes do
 * yanc v7.1 para a de agora.
 *
 * Antes cada processador tinha tres subpastas, <proc>/Software/ (o fonte e o
 * .asm), <proc>/Hardware/ (o .v) e <proc>/Simulation/ (o _tb.v, input_N.txt e
 * output_N.txt). Desde o yanc v7.1 a estrutura e a do proprio yanc
 * (js/compilation/pastas_do_processador.ts): o que a pessoa escreve fica em
 * <proc>/, e tudo o que o yanc gera numa pasta de saida plana, <proc>/<proc>/.
 * Um projeto antigo aberto sem conversao nao compila: a AURORA procura o fonte
 * em <proc>/ e nao acha.
 *
 * A conversao MOVE e nao apaga. O que o yanc gerava (o .asm, o .v, o _tb.v, os
 * .mif, as tabelas, as saidas da simulacao) vai para a pasta de saida, onde a
 * proxima compilacao o sobrescreve; o resto, que e da pessoa (o fonte, os
 * arquivos de vetor, input_N.txt, um .v que ela pos em Hardware/), vai para a
 * pasta do processador. Um destino que ja existe nao e sobrescrito: o arquivo
 * fica onde estava e entra no relatorio. A subpasta antiga so sai quando fica
 * vazia. O `#PRNAME` (ou `#pragma yanc prname`) do fonte, que o yanc v7.1
 * recusa, sai da linha dele.
 *
 * Quem pergunta a pessoa e quem grava o .spf e o project_manager, na abertura
 * do projeto (decidido em 13/10/2026: converter ao abrir, confirmando uma vez
 * por projeto, e mostrar depois o que foi movido). Aqui ha a parte pura (o
 * plano e a troca dos caminhos do .spf) e a execucao, com o disco injetado
 * para o teste.
 *
 * Compilado por `tsc` (npm run build:ts) num estrutura_antiga.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { problemaNoNomeDoProcessador, segmentosDaSaida, segmentosDoFonte } from '../compilation/pastas_do_processador.js';
import { languageFromFileName, stripSourceExtension } from '../compilation/processor_source.js';

/** As subpastas que cada processador tinha antes do yanc v7.1. */
export const SUBPASTAS_ANTIGAS = Object.freeze(['Software', 'Hardware', 'Simulation'] as const);
export type SubpastaAntiga = typeof SUBPASTAS_ANTIGAS[number];

/** Uma entrada de uma subpasta antiga, como a listagem a devolve. */
export interface EntradaDaPasta {
  nome: string;
  pasta: boolean;
}

/** Um processador que ainda tem subpasta antiga, com o que ha em cada uma. */
export interface ProcessadorAntigo {
  nome: string;
  subpastas: Partial<Record<SubpastaAntiga, EntradaDaPasta[]>>;
}

/** Um arquivo (ou pasta) a mover, em segmentos a partir da pasta do projeto. */
export interface Movimento {
  processador: string;
  de: string[];
  para: string[];
  /** true para o que o yanc gerava (vai para a pasta de saida). */
  gerado: boolean;
}

/** Os nomes fixos das tabelas e logs que o yanc escreve ou escrevia. */
const TABELAS = new Set([
  'cmm_log.txt', 'prog_log.txt', 'trad_cmm.txt', 'trad_opcode.txt', 'src_lines.txt', 'app_log.txt',
]);

/**
 * O arquivo e algo que o yanc gera (ou gerava)? `bases` sao os nomes que o
 * processador da aos arquivos: o nome dele e a base do fonte, quando difere.
 * Saida da simulacao (output_N.txt, toma_k.txt) tambem conta: e gerada.
 */
export function ehGeradoPeloYanc(arquivo: string, bases: readonly string[]): boolean {
  const n = arquivo.toLowerCase();
  if (TABELAS.has(n)) return true;
  if (/^(output|toma)_\d+\.txt$/.test(n)) return true;
  for (const b of bases.map((x) => x.toLowerCase())) {
    const gerados = [
      `${b}.asm`, `${b}.v`, `${b}_tb.v`, `${b}_inst.mif`, `${b}_data.mif`, `pc_${b}_mem.txt`,
      `${b}_tb.vcd`, `${b}_tb.fst`, `${b}_tb.vvp`,
    ];
    if (gerados.includes(n)) return true;
  }
  return false;
}

/**
 * Para onde vai cada entrada das subpastas antigas de cada processador. As
 * bases do processador sao o nome dele e a base de cada fonte que estiver em
 * Software/ (um `filtro_v2.cmm` gera `filtro_v2.asm`).
 */
export function planoDeConversao(procs: readonly ProcessadorAntigo[]): Movimento[] {
  const plano: Movimento[] = [];
  for (const p of procs) {
    const fontes = (p.subpastas.Software || [])
      .filter((e) => !e.pasta && languageFromFileName(e.nome))
      .map((e) => stripSourceExtension(e.nome));
    const bases = [p.nome, ...fontes];
    for (const sub of SUBPASTAS_ANTIGAS) {
      for (const e of p.subpastas[sub] || []) {
        const gerado = !e.pasta && ehGeradoPeloYanc(e.nome, bases);
        const destino = gerado ? segmentosDaSaida(p.nome) : segmentosDoFonte(p.nome);
        plano.push({
          processador: p.nome,
          de: [p.nome, sub, e.nome],
          para: [...destino, e.nome],
          gerado,
        });
      }
    }
  }
  return plano;
}

/**
 * O fonte sem a linha do nome. Devolve o texto novo e o nome que a linha dava,
 * ou `null` quando nao havia linha. So a primeira declaracao conta como nome;
 * toda linha de nome sai, porque o yanc v7.1 recusa qualquer uma.
 */
export function tirarPrname(texto: string): { texto: string; nomeAntigo: string | null } {
  let nomeAntigo: string | null = null;
  const re = /^[ \t]*(?:#PRNAME|#[ \t]*pragma[ \t]+yanc[ \t]+prname)[ \t]+(\S+)[ \t]*\r?(?:\n|$)/gmi;
  const novo = texto.replace(re, (_m, nome: string) => {
    if (nomeAntigo === null) nomeAntigo = nome;
    return '';
  });
  return { texto: novo, nomeAntigo };
}

/** Uma chave de caminho para comparar sem barra nem caixa. */
export function chaveDoCaminho(caminho: string): string {
  return caminho.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** O pedaco do .spf que a conversao reescreve. */
export interface EstruturaDoSpf {
  topLevelFile?: string | null;
  testbenchFile?: string | null;
  synthesizableFiles?: unknown;
  testbenchFiles?: unknown;
  unclassifiedFiles?: unknown;
  processors?: unknown;
  [k: string]: unknown;
}

/**
 * Troca no .spf todo caminho que a conversao moveu. `mapa` vai da chave do
 * caminho velho (chaveDoCaminho) ao caminho novo, absoluto. Um arquivo dentro
 * de uma pasta movida tambem acompanha. Nas entradas de processador saem os
 * campos de pasta de antes (`softwarePath`, `hardwarePath`, `simulationPath`)
 * e um `cmmFile`/`sourceFile` com caminho vira so o nome do arquivo, que e o
 * que o resto da AURORA le.
 */
export function remapearEstrutura(estrutura: EstruturaDoSpf, mapa: ReadonlyMap<string, string>): void {
  const mover = (c: unknown): unknown => {
    if (typeof c !== 'string' || !c) return c;
    const k = chaveDoCaminho(c);
    const direto = mapa.get(k);
    if (direto) return direto;
    for (const [velho, novo] of mapa) {
      // O resto do caminho vai com as barras que ele tinha.
      if (k.startsWith(`${velho}/`)) return novo + c.slice(velho.length);
    }
    return c;
  };
  estrutura.topLevelFile = mover(estrutura.topLevelFile) as string | null | undefined;
  estrutura.testbenchFile = mover(estrutura.testbenchFile) as string | null | undefined;
  for (const chave of ['synthesizableFiles', 'testbenchFiles', 'unclassifiedFiles'] as const) {
    const lista = estrutura[chave];
    if (!Array.isArray(lista)) continue;
    estrutura[chave] = lista.map((f: unknown) => {
      if (typeof f === 'string') return mover(f);
      if (!f || typeof f !== 'object') return f;
      const o = f as { path?: string; name?: string };
      const novo = mover(o.path);
      if (novo === o.path) return f;
      return { ...o, path: novo as string, name: String(novo).split(/[\\/]/).pop() };
    });
  }
  if (Array.isArray(estrutura.processors)) {
    estrutura.processors = estrutura.processors.map((p: unknown) => {
      if (!p || typeof p !== 'object') return p;
      const o = { ...(p as Record<string, unknown>) };
      delete o.softwarePath;
      delete o.hardwarePath;
      delete o.simulationPath;
      for (const campo of ['cmmFile', 'sourceFile']) {
        if (typeof o[campo] === 'string' && /[\\/]/.test(o[campo] as string)) {
          o[campo] = (o[campo] as string).split(/[\\/]/).pop();
        }
      }
      return o;
    });
  }
}

// ---- a execucao ---------------------------------------------------------------

/** O disco que a conversao usa, na forma do electronAPI. */
export interface DiscoDaConversao {
  joinPath(...partes: string[]): Promise<string>;
  getFolderFiles(dir: string): Promise<unknown>;
  renamePath(de: string, para: string, opcoes?: { overwrite?: boolean }): Promise<{ success?: boolean; code?: string; error?: string } | null>;
  mkdir(dir: string): Promise<unknown>;
  readFile(arquivo: string, opcoes?: unknown): Promise<string>;
  writeFile(arquivo: string, texto: string): Promise<unknown>;
  deleteFileOrDirectory(alvo: string): Promise<unknown>;
}

/** A listagem de uma pasta, ou `null` quando ela nao existe ou nao lista. */
async function listar(disco: DiscoDaConversao, dir: string): Promise<EntradaDaPasta[] | null> {
  let entradas: unknown;
  try {
    entradas = await disco.getFolderFiles(dir);
  } catch {
    return null;
  }
  if (!Array.isArray(entradas)) return null;
  return entradas
    .map((e) => e as { name?: string; path?: string; isDirectory?: boolean })
    .map((e) => ({ nome: String(e.name || String(e.path || '').split(/[\\/]/).pop() || ''), pasta: !!e.isDirectory }))
    .filter((e) => e.nome);
}

/**
 * Os processadores do projeto que ainda tem alguma subpasta antiga, com o que
 * ha em cada uma. Lista vazia: nada a converter.
 */
export async function inspecionar(
  projeto: string, nomes: readonly string[], disco: DiscoDaConversao,
): Promise<ProcessadorAntigo[]> {
  const achados: ProcessadorAntigo[] = [];
  for (const nome of nomes) {
    const subpastas: ProcessadorAntigo['subpastas'] = {};
    for (const sub of SUBPASTAS_ANTIGAS) {
      const entradas = await listar(disco, await disco.joinPath(projeto, nome, sub));
      if (entradas) subpastas[sub] = entradas;
    }
    if (Object.keys(subpastas).length) achados.push({ nome, subpastas });
  }
  return achados;
}

/** O que a conversao fez, para o relatorio e para o .spf. */
export interface ResultadoDaConversao {
  movidos: Array<{ de: string; para: string }>;
  /** O que ficou onde estava, com o porque (destino ja existia, erro). */
  pulados: Array<{ de: string; para: string; motivo: string }>;
  /** Fonte cuja linha de nome saiu, e o nome que ela dava. */
  semPrname: Array<{ arquivo: string; nomeAntigo: string }>;
  /** Processador cujo nome nao serve mais (vira modulo Verilog). */
  nomesInvalidos: string[];
  /** Subpastas antigas que ficaram, por nao estarem vazias. */
  pastasQueFicaram: string[];
}

/**
 * Executa o plano: move cada entrada sem sobrescrever, tira a linha de nome
 * dos fontes, e apaga as subpastas antigas que ficaram vazias.
 */
export async function converter(
  projeto: string, procs: readonly ProcessadorAntigo[], disco: DiscoDaConversao,
): Promise<ResultadoDaConversao> {
  const r: ResultadoDaConversao = { movidos: [], pulados: [], semPrname: [], nomesInvalidos: [], pastasQueFicaram: [] };
  const plano = planoDeConversao(procs);

  for (const p of procs) {
    if (problemaNoNomeDoProcessador(p.nome)) r.nomesInvalidos.push(p.nome);
    await disco.mkdir(await disco.joinPath(projeto, ...segmentosDaSaida(p.nome)));
  }

  for (const m of plano) {
    const de = await disco.joinPath(projeto, ...m.de);
    const para = await disco.joinPath(projeto, ...m.para);
    let resposta: Awaited<ReturnType<DiscoDaConversao['renamePath']>>;
    try {
      resposta = await disco.renamePath(de, para, { overwrite: false });
    } catch (e) {
      resposta = { success: false, error: (e as Error | null)?.message || String(e) };
    }
    if (resposta && resposta.success) {
      r.movidos.push({ de, para });
      if (!m.gerado && languageFromFileName(m.para[m.para.length - 1])) {
        await tirarNomeDoFonte(disco, para, r);
      }
    } else {
      r.pulados.push({ de, para, motivo: resposta?.code === 'EEXIST' ? 'EEXIST' : (resposta?.error || resposta?.code || '?') });
    }
  }

  for (const p of procs) {
    for (const sub of SUBPASTAS_ANTIGAS) {
      if (!p.subpastas[sub]) continue;
      const dir = await disco.joinPath(projeto, p.nome, sub);
      const resto = await listar(disco, dir);
      if (resto && resto.length === 0) {
        try { await disco.deleteFileOrDirectory(dir); } catch { r.pastasQueFicaram.push(dir); }
      } else if (resto) {
        r.pastasQueFicaram.push(dir);
      }
    }
  }
  return r;
}

async function tirarNomeDoFonte(disco: DiscoDaConversao, arquivo: string, r: ResultadoDaConversao): Promise<void> {
  try {
    const texto = await disco.readFile(arquivo, { encoding: 'utf8' });
    const { texto: novo, nomeAntigo } = tirarPrname(String(texto));
    if (nomeAntigo === null) return;
    await disco.writeFile(arquivo, novo);
    r.semPrname.push({ arquivo, nomeAntigo });
  } catch { /* fonte ilegivel: a compilacao vai dizer o que falta */ }
}

/**
 * O mapa de caminhos para o .spf (remapearEstrutura), a partir do que a
 * conversao moveu de fato.
 */
export function mapaDosMovidos(r: Pick<ResultadoDaConversao, 'movidos'>): Map<string, string> {
  return new Map(r.movidos.map((m) => [chaveDoCaminho(m.de), m.para]));
}
