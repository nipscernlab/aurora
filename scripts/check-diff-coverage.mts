/**
 * check-diff-coverage.mts: toda linha de codigo que a mudanca toca tem de
 * estar exercitada por um teste unitario.
 *
 * A regra esta no CONTRIBUTING.md ("Changing a file"). Ate aqui ela valia so
 * de boca, e a conta de 24/09/2026 mostrou por que isso nao basta: cerca de
 * 32% das linhas cobertas e 130 de 359 arquivos sem teste nenhum. Corrigir
 * erro de tipo quase sempre acrescenta uma guarda de null, e numa linha que
 * nenhum teste roda essa guarda muda o comportamento sem ninguem ver.
 *
 * O que faz: pega as linhas acrescentadas ou alteradas desde a base
 * (`git diff -M`, entao renomear x.js para x.ts conta so o que mudou de fato,
 * e nao o arquivo inteiro) e cruza com o coverage/lcov.info que o
 * `npm run test:coverage` acabou de gravar. Linha que o lcov lista com zero
 * execucoes e linha descoberta. Linha que o lcov nem lista (comentario, tipo,
 * linha em branco) nao conta. Arquivo que nenhum teste carregou nao aparece no
 * lcov; nele conta toda linha alterada que nao seja comentario nem branco.
 *
 * A base: DIFF_BASE, se definida (a CI passa o sha de antes do push ou a base
 * do pull request); senao o merge-base com origin/main. O diff e contra a
 * arvore de trabalho, e os arquivos novos ainda fora do git entram inteiros,
 * entao rodar localmente antes do commit ja mostra o que vai falhar.
 *
 * Saida de emergencia, e so ela: as marcas de ignore do v8 (o par start e
 * stop, ou o next) em volta do trecho, com o motivo num comentario ao lado. O
 * vitest ja tira essas linhas do lcov; aqui as mesmas marcas valem para arquivo
 * que nenhum teste carrega. Este cabecalho nao escreve a marca por extenso de
 * proposito, senao ela valeria aqui dentro.
 *
 * Uso: npm run test:coverage && npm run coverage:diff
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Pastas cujo codigo a regra cobre. Testes e configs ficam de fora. */
export const ESCOPO: readonly string[] = ['js/', 'main/', 'html/', 'scripts/', 'main.js'];

const EXTENSOES = /\.(?:js|mjs|cjs|ts|mts|cts)$/;

/** O arquivo esta no escopo da regra? Recebe caminho relativo com `/`. */
export function noEscopo(arquivo: string): boolean {
  if (arquivo.endsWith('.d.ts') || !EXTENSOES.test(arquivo)) return false;
  return ESCOPO.some((p) => (p.endsWith('/') ? arquivo.startsWith(p) : arquivo === p));
}

/**
 * Linhas novas de cada arquivo num `git diff --unified=0`, na numeracao do
 * arquivo como ele esta agora.
 */
export function linhasDoDiff(texto: string): Map<string, Set<number>> {
  const mapa = new Map<string, Set<number>>();
  let atual: Set<number> | null = null;
  for (const linha of texto.split('\n')) {
    if (linha.startsWith('+++ ')) {
      const alvo = linha.slice(4).trim();
      if (alvo === '/dev/null') {
        atual = null;
        continue;
      }
      const arquivo = alvo.replace(/^b\//, '');
      atual = mapa.get(arquivo) ?? new Set<number>();
      mapa.set(arquivo, atual);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(linha);
    if (hunk && atual) {
      const inicio = Number(hunk[1]);
      const quantas = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = inicio; n < inicio + quantas; n++) atual.add(n);
    }
  }
  return mapa;
}

/**
 * Execucoes por linha de cada arquivo do lcov, com o caminho relativo a raiz
 * e separado por `/` (o vitest grava `\` no Windows).
 */
export function lerLcov(texto: string, raiz: string): Map<string, Map<number, number>> {
  const mapa = new Map<string, Map<number, number>>();
  let atual: Map<number, number> | null = null;
  const raizNormal = path.resolve(raiz);
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.startsWith('SF:')) {
      const absoluto = path.resolve(raizNormal, linha.slice(3));
      const relativo = path.relative(raizNormal, absoluto).split(path.sep).join('/');
      atual = new Map<number, number>();
      mapa.set(relativo, atual);
    } else if (linha.startsWith('DA:') && atual) {
      const [n, hits] = linha.slice(3).split(',');
      atual.set(Number(n), Number(hits));
    } else if (linha === 'end_of_record') {
      atual = null;
    }
  }
  return mapa;
}

/** Linhas dentro de `v8 ignore start/stop` ou logo depois de `v8 ignore next`. */
export function linhasIgnoradas(fonte: string): Set<number> {
  const ignoradas = new Set<number>();
  const linhas = fonte.split(/\r?\n/);
  let dentro = false;
  let proximas = 0;
  linhas.forEach((texto, i) => {
    const n = i + 1;
    const marcas = [...texto.matchAll(/\/\*\s*(?:v8|c8|istanbul) ignore (start|stop|next)(?:\s+(\d+))?\s*\*\//g)];
    if (marcas.length > 0) {
      ignoradas.add(n);
      for (const m of marcas) {
        if (m[1] === 'start') dentro = true;
        else if (m[1] === 'stop') dentro = false;
        else proximas = m[2] === undefined ? 1 : Number(m[2]);
      }
      return;
    }
    if (dentro) {
      ignoradas.add(n);
    } else if (proximas > 0 && texto.trim() !== '') {
      ignoradas.add(n);
      proximas--;
    }
  });
  return ignoradas;
}

/**
 * Linhas que tem codigo: nem em branco nem so comentario. Serve para arquivo
 * que nenhum teste carregou, que nao tem o lcov para dizer o que executa.
 */
export function linhasDeCodigo(fonte: string): Set<number> {
  const codigo = new Set<number>();
  let emBloco = false;
  fonte.split(/\r?\n/).forEach((texto, i) => {
    let resto = texto.trim();
    if (emBloco) {
      const fim = resto.indexOf('*/');
      if (fim === -1) return;
      emBloco = false;
      resto = resto.slice(fim + 2).trim();
    }
    while (resto.startsWith('/*')) {
      const fim = resto.indexOf('*/', 2);
      if (fim === -1) {
        emBloco = true;
        resto = '';
        break;
      }
      resto = resto.slice(fim + 2).trim();
    }
    if (resto === '' || resto.startsWith('//')) return;
    codigo.add(i + 1);
  });
  return codigo;
}

export interface Descoberto {
  arquivo: string;
  /** false quando nenhum teste carregou o arquivo */
  carregado: boolean;
  linhas: number[];
}

/**
 * O cruzamento em si. `lerFonte` devolve o texto atual do arquivo, ou null se
 * ele nao existe mais.
 */
export function avaliar(
  alteradas: Map<string, Set<number>>,
  cobertura: Map<string, Map<number, number>>,
  lerFonte: (arquivo: string) => string | null,
): Descoberto[] {
  const saida: Descoberto[] = [];
  for (const [arquivo, linhas] of [...alteradas].sort(([a], [b]) => a.localeCompare(b))) {
    if (!noEscopo(arquivo) || linhas.size === 0) continue;
    const fonte = lerFonte(arquivo);
    if (fonte === null) continue;
    const ignoradas = linhasIgnoradas(fonte);
    const hits = cobertura.get(arquivo);
    const candidatas = [...linhas].filter((n) => !ignoradas.has(n)).sort((a, b) => a - b);
    let faltam: number[];
    if (hits) {
      faltam = candidatas.filter((n) => hits.get(n) === 0);
    } else {
      const codigo = linhasDeCodigo(fonte);
      faltam = candidatas.filter((n) => codigo.has(n));
    }
    if (faltam.length > 0) saida.push({ arquivo, carregado: Boolean(hits), linhas: faltam });
  }
  return saida;
}

/** [3,4,5,9] vira "3-5, 9". */
export function faixas(linhas: number[]): string {
  const partes: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    let j = i;
    while (j + 1 < linhas.length && linhas[j + 1] === linhas[j] + 1) j++;
    partes.push(i === j ? `${linhas[i]}` : `${linhas[i]}-${linhas[j]}`);
    i = j + 1;
  }
  return partes.join(', ');
}

function git(cwd: string, args: string[], calado = false): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', calado ? 'ignore' : 'inherit'],
  });
}

function existeCommit(cwd: string, ref: string): boolean {
  try {
    git(cwd, ['cat-file', '-e', `${ref}^{commit}`], true);
    return true;
  } catch {
    return false;
  }
}

/**
 * A base do diff. Um sha so de zeros e o que o GitHub manda no primeiro push
 * de um branch; nesse caso, e se o sha nao existe no clone, cai para o
 * merge-base.
 */
export function resolverBase(cwd: string, pedida: string | undefined): string {
  if (pedida && !/^0+$/.test(pedida) && existeCommit(cwd, pedida)) return pedida;
  if (existeCommit(cwd, 'origin/main')) return git(cwd, ['merge-base', 'HEAD', 'origin/main']).trim();
  return 'HEAD';
}

export interface Relatorio {
  base: string;
  descobertos: Descoberto[];
}

/** Tudo menos imprimir e sair: base, diff, lcov e o cruzamento. */
export function verificar(opcoes: { cwd: string; base?: string; lcov: string }): Relatorio {
  const { cwd } = opcoes;
  const base = resolverBase(cwd, opcoes.base);
  const diff = git(cwd, ['diff', '--unified=0', '--no-color', '--no-ext-diff', '-M', '--diff-filter=AMR', base, '--']);
  const alteradas = linhasDoDiff(diff);
  const novos = git(cwd, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  for (const arquivo of novos) {
    const texto = fs.readFileSync(path.join(cwd, arquivo), 'utf8');
    alteradas.set(arquivo, new Set(texto.split(/\r?\n/).map((_, i) => i + 1)));
  }
  const cobertura = lerLcov(fs.readFileSync(opcoes.lcov, 'utf8'), cwd);
  const lerFonte = (arquivo: string): string | null => {
    const p = path.join(cwd, arquivo);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  return { base, descobertos: avaliar(alteradas, cobertura, lerFonte) };
}

/** O texto que a CI e o terminal mostram. */
export function relatar(r: Relatorio): string {
  const curta = r.base.length > 12 ? r.base.slice(0, 8) : r.base;
  if (r.descobertos.length === 0) {
    return `[coverage:diff] OK: toda linha alterada desde ${curta} esta coberta por teste.`;
  }
  const total = r.descobertos.reduce((s, d) => s + d.linhas.length, 0);
  const corpo = r.descobertos.map((d) => {
    const nota = d.carregado ? '' : ' (nenhum teste carrega este arquivo)';
    return `  ${d.arquivo}${nota}\n    linhas ${faixas(d.linhas)}`;
  });
  return [
    `[coverage:diff] ${total} linha(s) alterada(s) desde ${curta} sem teste que as execute:`,
    ...corpo,
    '',
    'Escreva o teste que passa por elas (CONTRIBUTING.md, "Changing a file").',
    'Se o trecho de fato nao tem como ser testado em unidade, cerque-o com as',
    'marcas de ignore do v8 (start e stop) e diga o motivo ao lado.',
  ].join('\n');
}

/* v8 ignore start */ // a cola da linha de comando: ler o ambiente, imprimir e sair
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cwd = process.cwd();
  const lcov = path.join(cwd, 'coverage', 'lcov.info');
  if (!fs.existsSync(lcov)) {
    console.error('[coverage:diff] coverage/lcov.info nao existe. Rode antes: npm run test:coverage');
    process.exit(2);
  }
  const r = verificar({ cwd, base: process.env.DIFF_BASE, lcov });
  const texto = relatar(r);
  if (r.descobertos.length === 0) {
    console.log(texto);
  } else {
    console.error(texto);
    process.exit(1);
  }
}
/* v8 ignore stop */
