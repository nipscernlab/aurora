/**
 * converter-para-ts.mts: converte um .js do repositorio em .ts, mexendo no
 * minimo de linhas.
 *
 * POR QUE EXISTE
 * --------------
 * O objetivo e nao sobrar JavaScript escrito a mao (CONTRIBUTING.md, "Changing
 * a file"). A conversao tem uma parte mecanica, a mesma em todo arquivo, e uma
 * parte que pede julgamento. Este script faz a mecanica:
 *
 *   1. os `require` do topo viram `import` e o `module.exports = { ... }`
 *      vira `export { ... }`, lidos da arvore sintatica. O corpo das funcoes
 *      nao muda: `path.join`, `log.warn` e `fs.existsSync` continuam chamados
 *      pelo objeto, o que mantem a troca que os testes fazem nesses objetos
 *      valendo, e mantem pequeno o diff que o coverage:diff cobra;
 *   2. os tipos do JSDoc passam para a assinatura, pela correcao
 *      annotateWithTypeFromJSDoc do TypeScript. E a unica razao da dependencia
 *      typescript-5: o TypeScript 7, que compila o projeto, e a versao em Go e
 *      nao expoe o servico de linguagem;
 *   3. o acabamento: some o `// @ts-check` e o `'use strict'`, o comentario
 *      de @type que ficou redundante ao lado do tipo novo, e o tipo das tags
 *      @param.
 *
 * O que sobra fica para quem converte: os erros de tipo que o tsc apontar, e
 * os testes das linhas tocadas. Os avisos no fim dizem onde olhar.
 *
 * Uso: npm run converter:ts -- main/lsp/verible_lsp.js
 * Faz o git mv, grava o .ts e poe o .js gerado no bloco certo do .gitignore.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript-5';

const BUILTINS = new Set(builtinModules);

interface Troca {
  inicio: number;
  fim: number;
  novo: string;
}

function aplicar(texto: string, trocas: Troca[]): string {
  let s = texto;
  for (const c of [...trocas].sort((a, b) => b.inicio - a.inicio)) s = s.slice(0, c.inicio) + c.novo + s.slice(c.fim);
  return s;
}

/** O especificador do import: builtin ganha `node:`, relativo sem extensao ganha `.js`. */
export function especificador(spec: string): string {
  if (BUILTINS.has(spec)) return `node:${spec}`;
  if (spec.startsWith('.') && !/\.(js|json|ts|mjs|cjs)$/.test(spec)) return `${spec}.js`;
  return spec;
}

/** O alvo relativo ja e .ts? Entao e ESM de verdade, sem default: import * as. */
function alvoEhTs(dir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  return fs.existsSync(`${path.resolve(dir, spec.replace(/\.js$/, ''))}.ts`);
}

/** Passo 1: require do topo e module.exports, sem tocar no corpo. */
export function paraEsm(abs: string, texto: string, avisos: string[]): string {
  const sf = ts.createSourceFile(abs, texto, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const dir = path.dirname(abs);
  const trocas: Troca[] = [];
  const exportados: string[] = [];
  for (const st of sf.statements) {
    // 'use strict';  So o comando: o getFullStart levaria junto o comentario de
    // cabecalho que vem antes dele.
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && st.expression.text === 'use strict') {
      let fim = st.getEnd();
      while (texto[fim] === '\r' || texto[fim] === '\n') fim += 1;
      trocas.push({ inicio: st.getStart(sf), fim, novo: '' });
      continue;
    }
    const novo = importDoRequire(st, sf, dir, avisos);
    if (novo !== null) {
      trocas.push({ inicio: st.getStart(sf), fim: st.getEnd(), novo });
      continue;
    }
    // module.exports = { a, b: c };
    if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression)
      && st.expression.left.getText(sf) === 'module.exports' && ts.isObjectLiteralExpression(st.expression.right)) {
      for (const p of st.expression.right.properties) {
        if (ts.isShorthandPropertyAssignment(p)) exportados.push(p.name.text);
        else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) {
          const chave = p.name.getText(sf);
          exportados.push(chave === p.initializer.text ? chave : `${p.initializer.text} as ${chave}`);
        } else {
          avisos.push(`module.exports com valor que nao e um nome, converter a mao: ${p.getText(sf).slice(0, 60)}`);
        }
      }
      trocas.push({ inicio: st.getStart(sf), fim: st.getEnd(), novo: `export { ${exportados.join(', ')} };` });
      continue;
    }
    if (/\bmodule\.exports\b|\bexports\.\w+\s*=/.test(st.getText(sf))) {
      avisos.push(`export fora do padrao, converter a mao: ${st.getText(sf).slice(0, 60)}`);
    }
  }
  let s = aplicar(texto, trocas);
  // require que sobrou esta dentro de funcao: carregamento preguicoso, quase
  // sempre de proposito. Vira createRequire, que vale no CommonJS emitido e no
  // vitest, onde um require solto nao existe.
  if (/\brequire\(/.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) {
    s = s.replace(/(^|[^.\w])require\(/g, '$1requireTarde(');
    const ultimo = [...s.matchAll(/^import .*?;[ \t]*$/gm)].pop();
    const ponto = ultimo && ultimo.index !== undefined ? ultimo.index + ultimo[0].length : 0;
    s = `${s.slice(0, ponto)}\nimport { createRequire } from 'node:module';\n\nconst requireTarde = createRequire(__filename);\n${s.slice(ponto)}`;
    avisos.push('havia require fora do topo: virou requireTarde (createRequire). Conferir se era preguica de proposito');
  }
  return s;
}

/** `const X = require('m')` e variantes viram o import equivalente, ou null. */
function importDoRequire(st: ts.Statement, sf: ts.SourceFile, dir: string, avisos: string[]): string | null {
  if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) return null;
  const d = st.declarationList.declarations[0];
  let chamada: ts.Expression | undefined = d.initializer;
  let membro: string | null = null;
  // const p = require('fs').promises;
  if (chamada && ts.isPropertyAccessExpression(chamada) && ts.isCallExpression(chamada.expression)) {
    membro = chamada.name.text;
    chamada = chamada.expression;
  }
  if (!chamada || !ts.isCallExpression(chamada) || !ts.isIdentifier(chamada.expression)
    || chamada.expression.text !== 'require' || chamada.arguments.length !== 1) return null;
  const arg = chamada.arguments[0];
  if (!ts.isStringLiteral(arg)) return null;
  const bruto = arg.text;
  const spec = especificador(bruto);
  if (ts.isIdentifier(d.name) && membro !== null) {
    return `import { ${membro === d.name.text ? membro : `${membro} as ${d.name.text}`} } from '${spec}';`;
  }
  if (ts.isIdentifier(d.name)) {
    return alvoEhTs(dir, bruto) ? `import * as ${d.name.text} from '${spec}';` : `import ${d.name.text} from '${spec}';`;
  }
  if (ts.isObjectBindingPattern(d.name) && membro === null) {
    const nomes = d.name.elements.map((e) => {
      const local = e.name.getText(sf);
      const de = e.propertyName ? e.propertyName.getText(sf) : local;
      return de === local ? local : `${de} as ${local}`;
    });
    if (/^node:(child_process|https|http)$/.test(spec)) {
      avisos.push(`import por nome de '${spec}' (${nomes.join(', ')}): se um teste troca essa funcao, chamar pelo objeto do modulo`);
    }
    return `import { ${nomes.join(', ')} } from '${spec}';`;
  }
  return null;
}

/** Um servico de linguagem com um arquivo so em memoria; o resto vem do disco. */
function servico(nome: string, texto: string): ts.LanguageService {
  const opcoes: ts.CompilerOptions = {
    allowJs: true, checkJs: false, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, esModuleInterop: true,
  };
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [nome],
    getScriptVersion: () => '1',
    getScriptSnapshot: (f) => {
      if (f === nome) return ts.ScriptSnapshot.fromString(texto);
      return fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined;
    },
    getCurrentDirectory: () => path.dirname(nome),
    getCompilationSettings: () => opcoes,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === nome || fs.existsSync(f),
    readFile: (f) => (f === nome ? texto : fs.readFileSync(f, 'utf8')),
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

/** Passo 2: os tipos do JSDoc vao para a assinatura. `absTs` e o nome .ts, com `/`. */
export function anotar(absTs: string, texto: string): string {
  const fix = servico(absTs, texto).getCombinedCodeFix({ type: 'file', fileName: absTs }, 'annotateWithTypeFromJSDoc', {}, {});
  const trocas = fix.changes.filter((c) => c.fileName === absTs).flatMap((c) => c.textChanges)
    .map((t) => ({ inicio: t.span.start, fim: t.span.start + t.span.length, novo: t.newText }));
  return opcionaisDoJsdoc(absTs, aplicar(texto, trocas));
}

/**
 * A correcao do TS anota `@param {number} [n]` como `n: number`, perdendo o
 * opcional dos colchetes. Sem isto a assinatura sairia mais estrita que a do
 * JSDoc, e quem chama sem o argumento passaria a ser erro. O parametro entre
 * colchetes, sem valor padrao e sem `?`, ganha o `?`.
 */
function opcionaisDoJsdoc(absTs: string, texto: string): string {
  const sf = ts.createSourceFile(absTs, texto, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const trocas: Troca[] = [];
  const visitar = (no: ts.Node): void => {
    if (ts.isParameter(no) && !no.initializer && !no.questionToken && !no.dotDotDotToken && ts.isIdentifier(no.name)) {
      const nome = no.name.text;
      const opcional = ts.getJSDocParameterTags(no).some((t) => t.isBracketed && t.name.getText(sf) === nome);
      if (opcional) trocas.push({ inicio: no.name.getEnd(), fim: no.name.getEnd(), novo: '?' });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return aplicar(texto, trocas);
}

/** Onde fecha o `{` que abre em `abre`, contando os aninhados; -1 se nao fecha. */
function fechoDaChave(s: string, abre: number): number {
  let nivel = 0;
  for (let k = abre; k < s.length; k++) {
    if (s[k] === '{') nivel += 1;
    else if (s[k] === '}') { nivel -= 1; if (nivel === 0) return k; }
  }
  return -1;
}

/** Tira o `/** @type {T} *\/ ` que sobrou colado num parametro ja anotado. */
export function limparTypeRedundante(s: string): string {
  const marca = '/** @type {';
  let saida = '';
  let i = 0;
  for (;;) {
    const j = s.indexOf(marca, i);
    if (j < 0) return saida + s.slice(i);
    const fechaTipo = fechoDaChave(s, j + marca.length - 1);
    const fecho = fechaTipo < 0 ? -1 : s.indexOf('*/', fechaTipo);
    const redundante = fecho > 0 && s.slice(fechaTipo + 1, fecho).trim() === ''
      && /^\s*(\.\.\.)?\w+\??\s*:/.test(s.slice(fecho + 2));
    if (redundante) {
      saida += s.slice(i, j);
      i = fecho + 2;
      while (s[i] === ' ') i += 1;
    } else {
      saida += s.slice(i, j + marca.length);
      i = j + marca.length;
    }
  }
}

/** `@param {T} x` e `@returns {T}` perdem o tipo, que agora mora na assinatura. */
export function limparTagsDeTipo(s: string): string {
  const tirarChaves = (linha: string, tag: string): string => {
    const p = linha.indexOf(`@${tag} {`);
    if (p < 0) return linha;
    const fim = fechoDaChave(linha, p + tag.length + 2);
    if (fim < 0) return linha; // tipo que continua na linha de baixo: fica
    return `${linha.slice(0, p)}@${tag}${linha.slice(fim + 1)}`;
  };
  return s.split('\n').map((l) => tirarChaves(tirarChaves(l, 'param'), 'returns')).join('\n')
    .replace(/^[ \t]*\* @returns[ \t]*\r?\n/gm, '');
}

/** A linha avulsa `/** @type {T} *\/` acima de uma declaracao que ja ganhou tipo. */
export function limparTypeAvulso(s: string): string {
  const linhas = s.split('\n');
  return linhas.filter((l, i) => !(/^\s*\/\*\* @type \{.*\} \*\/\s*$/.test(l)
    && /^\s*(export\s+)?(const|let|var)\s+\w+\s*:/.test(linhas[i + 1] ?? ''))).join('\n');
}

/** `* @param nome` sem descricao nao diz nada que a assinatura nao diga. */
export function limparParamVazio(s: string): string {
  return s.replace(/^[ \t]*\* @param \[?[\w.]+(=[^\]]*)?\]?[ \t]*\r?\n/gm, '');
}

/** A conversao inteira de um texto. `abs` e o caminho do .js, com `/`. */
export function converterTexto(abs: string, original: string): { texto: string; avisos: string[] } {
  const avisos: string[] = [];
  let texto = original.replace(/^\/\/ @ts-check\r?\n/, '');
  texto = paraEsm(abs, texto, avisos);
  texto = anotar(abs.replace(/\.js$/, '.ts'), texto);
  texto = limparTypeRedundante(texto);
  texto = limparTagsDeTipo(texto);
  texto = limparTypeAvulso(texto);
  texto = limparParamVazio(texto);
  const base = path.basename(abs);
  texto = texto.replace(new RegExp(`(\\* )${base.replace('.', '\\.')}:`), `$1${base.replace(/\.js$/, '.ts')}:`);
  return { texto, avisos };
}

/**
 * Poe o .js que o build vai gerar no .gitignore, no bloco do lugar dele: o do
 * main/, o do html/ ou o do renderer. Devolve o conteudo novo; se ja estava, o
 * mesmo.
 */
export function registrarNoGitignore(conteudo: string, relJs: string): string {
  const linhas = conteudo.split('\n');
  if (linhas.some((l) => l.trim() === relJs)) return conteudo;
  const cabecalho = relJs.startsWith('main/') ? /^# main\//
    : relJs.startsWith('html/') ? /^# html\//
      : /^# --- TypeScript compiler output/;
  const inicio = linhas.findIndex((l) => cabecalho.test(l));
  if (inicio < 0) throw new Error(`o .gitignore nao tem o bloco de ${relJs}`);
  // O bloco acaba na linha em branco ou no comentario que abre o proximo; o
  // "# These are build artefacts" logo abaixo do cabecalho do renderer ainda e
  // dele.
  let fim = inicio + 1;
  while (fim < linhas.length && linhas[fim].trim() !== ''
    && (!linhas[fim].startsWith('#') || linhas[fim].startsWith('# These'))) fim += 1;
  linhas.splice(fim, 0, relJs);
  return linhas.join('\n');
}

/** Converte um arquivo do repositorio: git mv, grava o .ts, registra o .js gerado. */
export function converterArquivo(cwd: string, relJs: string): { relTs: string; avisos: string[] } {
  const rel = relJs.split(path.sep).join('/');
  if (!rel.endsWith('.js')) throw new Error(`nao e .js: ${rel}`);
  const abs = path.resolve(cwd, rel).split(path.sep).join('/');
  const { texto, avisos } = converterTexto(abs, fs.readFileSync(abs, 'utf8'));
  const relTs = rel.replace(/\.js$/, '.ts');
  execFileSync('git', ['mv', rel, relTs], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  fs.writeFileSync(path.join(cwd, relTs), texto);
  const gi = path.join(cwd, '.gitignore');
  fs.writeFileSync(gi, registrarNoGitignore(fs.readFileSync(gi, 'utf8'), rel));
  return { relTs, avisos };
}

/* v8 ignore start */ // a cola da linha de comando
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const alvos = process.argv.slice(2);
  if (!alvos.length) {
    console.error('uso: npm run converter:ts -- <arquivo.js> [outro.js ...]');
    process.exit(2);
  }
  for (const alvo of alvos) {
    const { relTs, avisos } = converterArquivo(process.cwd(), alvo);
    console.log(`[converter:ts] ${alvo} -> ${relTs}`);
    for (const a of avisos) console.log(`  AVISO: ${a}`);
  }
  console.log('\nAgora: npx tsc --noEmit -p tsconfig.json, os testes das linhas tocadas, npm run coverage:diff.');
}
/* v8 ignore stop */
