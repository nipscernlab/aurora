/**
 * main/treesitter/grammars: os dois canais que servem ao renderer os bytes do
 * tree-sitter. So um conjunto fixo de nomes logicos vira arquivo; o renderer
 * nao pede caminho.
 *
 * Os arquivos vem do bootstrap e podem nao estar na maquina (na CI nao estao),
 * entao o teste compara com o que o disco tem de fato, em vez de supor.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

const electronFalso = vi.hoisted(() => ({
  ipcMain: { handle: (canal, fn) => { globalThis.__tsHandlers.set(canal, fn); } },
}));
const handlers = new Map();
globalThis.__tsHandlers = handlers;
vi.mock('electron', () => ({ default: electronFalso, ...electronFalso }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electronFalso };

let dir;
const ARQUIVOS = {
  runtime: 'web-tree-sitter.wasm',
  systemverilog: 'tree-sitter-systemverilog.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
};
const tem = (nome) => fs.existsSync(path.join(dir, ARQUIVOS[nome]));

beforeAll(async () => {
  const { componentsPath } = req('../../main/paths.js');
  dir = path.join(componentsPath, 'Packages', 'tree-sitter');
  const mod = await import('../../main/treesitter/grammars.js');
  (mod.default ?? mod).register();
});

describe('treesitter:status', () => {
  it('diz o que o disco tem, e so e instalado com o runtime e alguma gramatica', () => {
    const s = handlers.get('treesitter:status')();
    expect(s).toEqual({
      installed: tem('runtime') && (tem('systemverilog') || tem('c') || tem('cpp')),
      runtime: tem('runtime'),
      grammars: { systemverilog: tem('systemverilog'), c: tem('c'), cpp: tem('cpp') },
    });
  });
});

describe('treesitter:wasm', () => {
  it('um nome conhecido devolve os bytes do arquivo, ou null se ele falta', async () => {
    for (const nome of Object.keys(ARQUIVOS)) {
      const bytes = await handlers.get('treesitter:wasm')({}, nome);
      if (tem(nome)) expect(Buffer.compare(bytes, fs.readFileSync(path.join(dir, ARQUIVOS[nome])))).toBe(0);
      else expect(bytes).toBeNull();
    }
  });

  it('nome fora da lista devolve null, sem ler nada', async () => {
    for (const nome of ['', 'python', '../paths.js', 'C:\\Windows\\win.ini', undefined]) {
      expect(await handlers.get('treesitter:wasm')({}, nome), String(nome)).toBeNull();
    }
  });

  it('nome herdado do objeto (toString) rejeita em vez de devolver null: comportamento atual, registrado', async () => {
    await expect(handlers.get('treesitter:wasm')({}, 'toString')).rejects.toThrow();
  });
});
