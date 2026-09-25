/**
 * check-window-globals.mts: impede que nasca global nova em `window`.
 *
 * O grafo de `import` do renderer e limpo; o emaranhado esta no que um arquivo
 * poe em `window` e outro le de la. Essa dependencia nao aparece em `import`,
 * nao tem tipo (para o TypeScript e `any`) e qualquer um pode trocar o valor.
 * Estado mutavel solto assim foi a raiz do bug do git que caia no projeto de
 * outra janela.
 *
 * E uma CATRACA, como o check-design-tokens: nao exige limpar as 45 globais
 * de 25/09/2026, exige que nenhuma nova nasca. A linha de base guarda os
 * NOMES, nao so a contagem, para que trocar uma global por outra tambem
 * acuse. Tirar uma global faz o verificador pedir que a base desca junto.
 *
 * O que conta: um nome atribuido como `window.X = ...` num arquivo versionado
 * de js/ e lido como `window.X` em OUTRO arquivo. Usado so no arquivo que o
 * define nao e dependencia entre arquivos e fica de fora; `(window as T).X`
 * conta como `window.X`. `window['x']` e
 * nome lido sem o `window.` na frente escapam da conta: e medida, nao prova.
 *
 * Uso:  node scripts/check-window-globals.mts
 *       node scripts/check-window-globals.mts --update   (regrava a base)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Global {
  definidaEm: string[];
  lidaEm: string[];
}

// `(window as T).X` tambem conta: o cast e o jeito de um .ts por em window um
// nome que o tipo de Window nao declara, e nao pode esconder a global. O tipo
// pode ter parenteses (`{ f?: () => void }`), entao o cast vai ate o primeiro
// `).` da linha, e nao ate o primeiro `)`.
const ATRIBUICAO = /\bwindow(?:\s+as\s+[^;\n]*?\))?\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
const LEITURA = /\bwindow(?:\s+as\s+[^;\n]*?\))?\.([A-Za-z_$][\w$]*)/g;

function juntar(mapa: Map<string, Set<string>>, nome: string, rel: string): void {
  let s = mapa.get(nome);
  if (!s) mapa.set(nome, (s = new Set()));
  s.add(rel);
}

/** As globais que um arquivo define e outro le, por nome, em ordem. */
export function globaisCruzadas(arquivos: { rel: string; src: string }[]): Record<string, Global> {
  const definidas = new Map<string, Set<string>>();
  const lidas = new Map<string, Set<string>>();
  for (const { rel, src } of arquivos) {
    for (const m of src.matchAll(ATRIBUICAO)) juntar(definidas, m[1], rel);
    for (const m of src.matchAll(LEITURA)) juntar(lidas, m[1], rel);
  }
  const out: Record<string, Global> = {};
  for (const nome of [...definidas.keys()].sort()) {
    const def = definidas.get(nome)!;
    const outros = [...(lidas.get(nome) ?? [])].filter((rel) => !def.has(rel));
    if (outros.length) out[nome] = { definidaEm: [...def].sort(), lidaEm: outros.sort() };
  }
  return out;
}

/** Nomes que apareceram e que sumiram em relacao a linha de base. */
export function comparar(atual: string[], base: string[]): { novas: string[]; sumiram: string[] } {
  const a = new Set(atual);
  const b = new Set(base);
  return {
    novas: [...a].filter((n) => !b.has(n)).sort(),
    sumiram: [...b].filter((n) => !a.has(n)).sort(),
  };
}

/* v8 ignore start */ // a cola da linha de comando: git, ler, gravar, sair
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cwd = process.cwd();
  const BASE = path.join(cwd, 'scripts', 'window-globals-baseline.json');
  // So o versionado: um .js gerado ao lado do .ts, ou velho esquecido na
  // pasta, contaria em dobro aqui e nao existe na copia limpa da CI.
  const rels = execFileSync('git', ['ls-files', '--', 'js'], { cwd, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((rel) => /\.(m?js|m?ts)$/.test(rel));
  const atual = globaisCruzadas(rels.map((rel) => ({ rel, src: fs.readFileSync(path.join(cwd, rel), 'utf8') })));
  const nomes = Object.keys(atual);

  if (process.argv.includes('--update')) {
    const base = Object.fromEntries(nomes.map((n) => [n, atual[n].definidaEm]));
    fs.writeFileSync(BASE, `${JSON.stringify(base, null, 2)}\n`);
    console.log(`[globais] base regravada: ${nomes.length} globais em window.`);
    process.exit(0);
  }

  if (!fs.existsSync(BASE)) {
    console.error('[globais] base ausente. Rode: node scripts/check-window-globals.mts --update');
    process.exit(1);
  }
  const { novas, sumiram } = comparar(nomes, Object.keys(JSON.parse(fs.readFileSync(BASE, 'utf8'))));

  if (novas.length) {
    console.error('[globais] global nova em window:\n');
    for (const n of novas) {
      console.error(`  window.${n}: definida em ${atual[n].definidaEm.join(', ')}; lida em ${atual[n].lidaEm.join(', ')}`);
    }
    console.error('\nExporte do modulo que cria o valor e importe onde ele e lido.');
    console.error('Se nao houver outro jeito, explique no codigo e rode --update.');
    process.exit(1);
  }
  if (sumiram.length) {
    console.log('[globais] saiu global de window, e a base pode descer:\n');
    for (const n of sumiram) console.log(`  window.${n}`);
    console.log('\nRode: node scripts/check-window-globals.mts --update');
    process.exit(1);
  }
  console.log(`[globais] OK: ${nomes.length} globais em window, nenhuma nova.`);
}
/* v8 ignore stop */
