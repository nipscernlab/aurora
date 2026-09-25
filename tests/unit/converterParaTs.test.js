/**
 * scripts/converter-para-ts.mts: o conversor que faz a parte mecanica de
 * transformar um .js em .ts. Um erro dele passa despercebido do jeito mais
 * caro: o arquivo convertido compila, os testes passam, e um comentario de
 * cabecalho sumiu, ou um `fs.existsSync` virou `existsSync` e deixou de ser
 * trocavel pelo teste. Estes casos fixam o que ele deve e nao deve tocar.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  anotar,
  converterArquivo,
  converterTexto,
  especificador,
  limparParamVazio,
  limparTagsDeTipo,
  limparTypeAvulso,
  limparTypeRedundante,
  paraEsm,
  registrarNoGitignore,
} from '../../scripts/converter-para-ts.mts';

let tmp;
const barra = (p) => p.split(path.sep).join('/');

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-conv-'));
  fs.writeFileSync(path.join(tmp, 'ja_ts.ts'), 'export const x = 1;\n');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('especificador', () => {
  it('builtin ganha node:, relativo sem extensao ganha .js, o resto fica', () => {
    expect(especificador('path')).toBe('node:path');
    expect(especificador('child_process')).toBe('node:child_process');
    expect(especificador('./x')).toBe('./x.js');
    expect(especificador('../a/b')).toBe('../a/b.js');
    expect(especificador('./dados.json')).toBe('./dados.json');
    expect(especificador('./x.js')).toBe('./x.js');
    expect(especificador('electron')).toBe('electron');
  });
});

describe('paraEsm', () => {
  const ENTRADA = [
    '// @ts-check',
    '/**',
    ' * mod.js: o cabecalho que tem de ficar.',
    ' */',
    '',
    "'use strict';",
    '',
    "const path = require('path');",
    "const fsp = require('fs').promises;",
    "const { spawn, execFile: rodar } = require('child_process');",
    "const log = require('electron-log');",
    "const vizinho = require('./vizinho');",
    "const jaTs = require('./ja_ts');",
    '',
    'function f() {',
    "  return require('../tarde').x + path.join('a', 'b');",
    '}',
    '',
    'module.exports = { f, interno: vizinho, spawn };',
  ].join('\n');

  let saida;
  let avisos;
  beforeAll(() => {
    avisos = [];
    saida = paraEsm(`${barra(tmp)}/mod.js`, ENTRADA, avisos);
  });

  it('o cabecalho fica, e o use strict sai com a linha em branco dele', () => {
    expect(saida).toContain(' * mod.js: o cabecalho que tem de ficar.');
    expect(saida).not.toContain('use strict');
  });

  it('cada forma de require vira o import equivalente', () => {
    expect(saida).toContain("import path from 'node:path';");
    expect(saida).toContain("import { promises as fsp } from 'node:fs';");
    expect(saida).toContain("import { spawn, execFile as rodar } from 'node:child_process';");
    expect(saida).toContain("import log from 'electron-log';");
    expect(saida).toContain("import vizinho from './vizinho.js';");
    // o alvo ja e .ts: ESM sem default, entao namespace
    expect(saida).toContain("import * as jaTs from './ja_ts.js';");
  });

  it('o corpo nao muda: path.join continua chamado pelo objeto', () => {
    expect(saida).toContain("path.join('a', 'b')");
  });

  it('require dentro de funcao vira requireTarde, com o createRequire depois dos imports', () => {
    expect(saida).toContain("requireTarde('../tarde').x");
    const posImport = saida.indexOf("import * as jaTs");
    const posCreate = saida.indexOf("import { createRequire } from 'node:module';");
    expect(posCreate).toBeGreaterThan(posImport);
    expect(saida).toContain('const requireTarde = createRequire(__filename);');
    expect(avisos.some((a) => a.startsWith('havia require fora do topo'))).toBe(true);
  });

  it('module.exports vira export, com o apelido', () => {
    expect(saida).toContain('export { f, vizinho as interno, spawn };');
    expect(saida).not.toContain('module.exports');
  });

  it('avisa do import por nome de child_process, que um teste nao consegue trocar', () => {
    expect(avisos.some((a) => a.includes("'node:child_process'") && a.includes('spawn'))).toBe(true);
  });

  it('avisa do que nao sabe converter, sem inventar', () => {
    const av = [];
    const s = paraEsm(`${barra(tmp)}/m2.js`, "module.exports = { a: 1 + 2 };\nmodule.exports.b = 3;\n", av);
    expect(av).toHaveLength(2);
    expect(av[0]).toMatch(/valor que nao e um nome/);
    expect(av[1]).toMatch(/export fora do padrao/);
    expect(s).toContain('module.exports.b = 3;');
  });

  it('require numa forma que nao reconhece fica como esta, sem virar import errado', () => {
    const texto = "const [a] = require('m');\nconst { b } = require('n').promises;\n";
    const s = paraEsm(`${barra(tmp)}/m4.js`, texto, []);
    expect(s).not.toMatch(/^import .* from 'm'/m);
    expect(s).toContain("const [a] = requireTarde('m');");
    expect(s).toContain("const { b } = requireTarde('n').promises;");
  });

  it('arquivo sem nada de CommonJS sai igual', () => {
    const texto = 'export const a = 1;\n';
    expect(paraEsm(`${barra(tmp)}/m3.js`, texto, [])).toBe(texto);
  });
});

describe('anotar', () => {
  it('passa os tipos do JSDoc para a assinatura', () => {
    const s = anotar(`${barra(tmp)}/a.ts`, '/**\n * @param {string} nome\n * @param {number} [n]\n */\nfunction f(nome, n) { return nome + n; }\n');
    expect(s).toContain('function f(nome: string, n?: number)');
  });
});

describe('o acabamento', () => {
  it('limparTypeRedundante tira o @type colado num parametro ja anotado, e so esse', () => {
    expect(limparTypeRedundante('f(/** @type {string} */ a: string)')).toBe('f(a: string)');
    expect(limparTypeRedundante('f(/** @type {{x: {y: number}}} */ b: { x: { y: number } })')).toBe('f(b: { x: { y: number } })');
    // cast de expressao nao e parametro: fica
    expect(limparTypeRedundante('const e = /** @type {any} */ (err);')).toBe('const e = /** @type {any} */ (err);');
    expect(limparTypeRedundante('sem marca nenhuma')).toBe('sem marca nenhuma');
  });

  it('limparTagsDeTipo tira o tipo das tags e a @returns que ficou vazia', () => {
    const s = limparTagsDeTipo(' * @param {string} [x] o nome\n * @returns {number}\n * @param {{a: string,\n * texto\n');
    expect(s).toBe(' * @param [x] o nome\n * @param {{a: string,\n * texto\n');
  });

  it('limparTypeAvulso tira a linha de @type acima de declaracao com tipo, e so dela', () => {
    const s = limparTypeAvulso('/** @type {number} */\nlet a: number = 1;\n/** @type {number} */\nlet b = 2;\n');
    expect(s).toBe('let a: number = 1;\n/** @type {number} */\nlet b = 2;\n');
  });

  it('limparParamVazio tira @param sem descricao e mantem a que explica', () => {
    const s = limparParamVazio(' * @param uri\n * @param [dono=null]\n * @param canal o canal do IPC\n');
    expect(s).toBe(' * @param canal o canal do IPC\n');
  });
});

describe('converterTexto', () => {
  it('o caminho inteiro: sem @ts-check, cabecalho com o nome novo, tipos na assinatura', () => {
    const { texto, avisos } = converterTexto(`${barra(tmp)}/util.js`, [
      '// @ts-check',
      '/**',
      ' * util.js: soma.',
      ' */',
      "'use strict';",
      '/** @param {number} a @param {number} b */',
      'function soma(a, b) { return a + b; }',
      'module.exports = { soma };',
      '',
    ].join('\n'));
    expect(texto.startsWith('/**\n * util.ts: soma.')).toBe(true);
    expect(texto).toContain('function soma(a: number, b: number)');
    expect(texto).toContain('export { soma };');
    expect(avisos).toEqual([]);
  });
});

describe('registrarNoGitignore', () => {
  const GI = [
    '# --- TypeScript compiler output (.ts -> .js) ---',
    '# These are build artefacts.',
    'js/a.js',
    '# html/ (paginas)',
    'html/p.js',
    '',
    '# main/ (CommonJS)',
    'main/x.js',
    '',
    'node_modules/',
  ].join('\n');

  it('poe cada .js no bloco do lugar dele', () => {
    const s = registrarNoGitignore(registrarNoGitignore(registrarNoGitignore(GI, 'main/y.js'), 'js/b.js'), 'html/q.js');
    expect(s.split('\n')).toEqual([
      '# --- TypeScript compiler output (.ts -> .js) ---',
      '# These are build artefacts.',
      'js/a.js',
      'js/b.js',
      '# html/ (paginas)',
      'html/p.js',
      'html/q.js',
      '',
      '# main/ (CommonJS)',
      'main/x.js',
      'main/y.js',
      '',
      'node_modules/',
    ]);
  });

  it('o que ja esta la fica como esta, e bloco que falta e erro', () => {
    expect(registrarNoGitignore(GI, 'main/x.js')).toBe(GI);
    expect(() => registrarNoGitignore('node_modules/\n', 'main/z.js')).toThrow(/nao tem o bloco/);
  });
});

describe('converterArquivo', () => {
  it('faz o git mv, grava o .ts e registra o .js gerado', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'main'), { recursive: true });
    const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    });
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'main', 'm.js'), "'use strict';\nconst fs = require('fs');\nmodule.exports = { fs };\n");
    fs.writeFileSync(path.join(repo, '.gitignore'), '# main/ (CommonJS)\nmain/x.js\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');

    const r = converterArquivo(repo, 'main/m.js');

    expect(r).toEqual({ relTs: 'main/m.ts', avisos: [] });
    expect(fs.existsSync(path.join(repo, 'main', 'm.js'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'main', 'm.ts'), 'utf8')).toBe("import fs from 'node:fs';\nexport { fs };\n");
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('# main/ (CommonJS)\nmain/x.js\nmain/m.js\n');
    expect(git('status', '--porcelain')).toContain('RM main/m.js -> main/m.ts');
    expect(() => converterArquivo(repo, 'main/m.ts')).toThrow(/nao e \.js/);
  });
});
