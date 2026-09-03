/**
 * Testes da varredura da busca no projeto (main/ipc/search_core.js) e do seu
 * transporte por worker thread (main/ipc/search.js, buscarNoWorker).
 *
 * Por que os dois: o nucleo e o que decide o que aparece no painel de busca;
 * o worker e o que impede a varredura (e um RegExp que nao volta) de congelar
 * o processo principal. O worker recebe o codigo como TEXTO (eval), por causa
 * do app.asar, entao vale provar aqui que a montagem core+corpo roda e devolve
 * exatamente o que o nucleo devolve.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buscar } from '../../main/ipc/search_core.js';
import { buscarNoWorker } from '../../main/ipc/search.js';

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-busca-'));
  fs.mkdirSync(path.join(raiz, 'proc1', 'Hardware'), { recursive: true });
  fs.mkdirSync(path.join(raiz, '.git'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'Temp'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'proc1', 'Hardware', 'top.v'), 'module top;\n  wire clk;\n  assign clk = 1;\nendmodule\n');
  fs.writeFileSync(path.join(raiz, 'proc1', 'main.cmm'), 'void main() {\n  int clk = 2;\n}\n');
  fs.writeFileSync(path.join(raiz, '.git', 'config'), 'clk = escondido\n');
  fs.writeFileSync(path.join(raiz, 'Temp', 'saida.txt'), 'clk = saida\n');
  fs.writeFileSync(path.join(raiz, 'dump.bin'), Buffer.from([0x63, 0x6c, 0x6b, 0x00, 0x01, 0x02]));
});

afterAll(() => {
  try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

describe('buscar', () => {
  it('acha em todos os arquivos de texto, com linha e coluna, e pula .git, Temp e binario', () => {
    const r = buscar(raiz, { query: 'clk' });
    expect(r.ok).toBe(true);
    const arquivos = r.results.map((x) => x.file).sort();
    expect(arquivos).toEqual(['proc1/Hardware/top.v', 'proc1/main.cmm']);
    const top = r.results.find((x) => x.file === 'proc1/Hardware/top.v');
    expect(top.matches).toEqual([
      { line: 2, col: 8, preview: '  wire clk;' },
      { line: 3, col: 10, preview: '  assign clk = 1;' },
    ]);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('palavra inteira e caixa', () => {
    expect(buscar(raiz, { query: 'cl', wholeWord: true }).total).toBe(0);
    expect(buscar(raiz, { query: 'CLK' }).total).toBe(3);
    expect(buscar(raiz, { query: 'CLK', caseSensitive: true }).total).toBe(0);
  });

  it('modo regex funciona e padrao invalido volta como erro, nao como excecao', () => {
    expect(buscar(raiz, { query: 'assign\\s+\\w+', regex: true }).total).toBe(1);
    const r = buscar(raiz, { query: '(', regex: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid regular expression|Unterminated/);
  });
});

describe('buscarNoWorker', () => {
  it('devolve o mesmo resultado do nucleo, vindo de outro thread', async () => {
    const direto = buscar(raiz, { query: 'clk' });
    const worker = await buscarNoWorker(raiz, { query: 'clk' });
    expect(worker).toEqual(direto);
  }, 20_000);

  it('erro de padrao dentro do worker tambem volta como {ok:false}', async () => {
    const r = await buscarNoWorker(raiz, { query: '[', regex: true });
    expect(r.ok).toBe(false);
  }, 20_000);
});
