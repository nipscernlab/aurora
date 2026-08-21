/**
 * Os agentes de IA como componentes (main/components/ia.js).
 *
 * A versao mora no nome da pasta do cache, e e dela que sai o estado. O que
 * precisa de prova e a leitura desse nome nos tres estados (em dia, outra
 * versao, ausente) e a remocao levar TODAS as versoes, porque e isso que a
 * pessoa espera de um botao chamado Remover.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// O cache aponta para uma pasta temporaria ANTES dos modulos serem carregados:
// `AURORA_CLI_CACHE` e lido a cada chamada, mas `it.skipIf` abaixo roda na
// coleta, quando nenhum beforeEach aconteceu ainda.
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-ia-'));
process.env.AURORA_CLI_CACHE = cache;

const ia = require('../../main/components/ia.js');
const downloader = require('../../main/ai/cli_downloader.js');

beforeEach(() => {
  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });
});

afterEach(() => {
  fs.rmSync(cache, { recursive: true, force: true });
});

const baixavel = () => downloader.isDownloadable('claude');

function criarExe(dir, relativo) {
  const p = path.join(dir, ...relativo.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'MZ');
  return p;
}

describe('catalogo', () => {
  it('tem os dois agentes, com tamanhos declarados', () => {
    expect(ia.CATALOGO.map((c) => c.chave).sort()).toEqual(['claude', 'codex']);
    for (const c of ia.CATALOGO) {
      expect(c.downloadMB).toBeGreaterThan(0);
      expect(c.tamanhoMB).toBeGreaterThanOrEqual(c.downloadMB);
    }
    expect(ia.conhece('claude')).toBe(true);
    expect(ia.conhece('msys')).toBe(false);
  });
});

describe('diagnosticar', () => {
  it.skipIf(!baixavel())('ausente quando o cache esta vazio', () => {
    expect(ia.diagnosticar('claude')).toEqual({ chave: 'claude', estado: 'ausente', faltando: [], versaoInstalada: null });
  });

  it.skipIf(!baixavel())('ok, com a versao do manifesto, quando o binario esta na pasta da versao fixada', () => {
    const { dir, entry } = downloader.installPaths('claude');
    criarExe(dir, entry.exe);
    const d = ia.diagnosticar('claude');
    expect(d.estado).toBe('ok');
    expect(d.versaoInstalada).toBe(entry.version);
  });

  it.skipIf(!baixavel())('desatualizado quando so existe a pasta de outra versao', () => {
    const { dir, entry } = downloader.installPaths('claude');
    const antiga = dir.replace(/@[^@]*$/, '@0.0.1');
    criarExe(antiga, entry.exe);
    const d = ia.diagnosticar('claude');
    expect(d.estado).toBe('desatualizado');
    expect(d.versaoInstalada).toBe('0.0.1');
  });

  it.skipIf(!baixavel())('pasta de outra versao SEM o binario e resto de download, nao instalacao', () => {
    const { dir } = downloader.installPaths('claude');
    fs.mkdirSync(dir.replace(/@[^@]*$/, '@0.0.1'), { recursive: true });
    expect(ia.diagnosticar('claude').estado).toBe('ausente');
  });
});

describe('listar', () => {
  it.skipIf(!baixavel())('fala a lingua do painel', () => {
    const lista = ia.listar();
    const claude = lista.find((c) => c.chave === 'claude');
    expect(claude).toMatchObject({ essencial: false, requerParaCompilar: false, instalado: false, estado: 'ausente' });
    expect(typeof claude.versao).toBe('string');
    expect(claude.baixavel).toBe(true);
  });
});

describe('remover', () => {
  it.skipIf(!baixavel())('leva todas as versoes do cache, e nada fora dele', async () => {
    const { dir, entry } = downloader.installPaths('claude');
    criarExe(dir, entry.exe);
    criarExe(dir.replace(/@[^@]*$/, '@0.0.1'), entry.exe);
    const outro = downloader.installPaths('codex');
    if (outro) criarExe(outro.dir, outro.entry.exe);

    const r = await ia.remover('claude');
    expect(r.ok).toBe(true);
    expect(r.liberadoMB).toBeGreaterThan(0);
    expect(ia.diagnosticar('claude').estado).toBe('ausente');
    if (outro) expect(ia.diagnosticar('codex').estado).toBe('ok');
  });

  it('chave desconhecida e recusada', async () => {
    expect((await ia.remover('nao-existe')).ok).toBe(false);
  });
});
