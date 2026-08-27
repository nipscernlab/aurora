/**
 * O carimbo de versao dos componentes (components/Scripts/lib/version_stamp.js).
 *
 * A decisao "pular o download?" e o que faz uma tag nova chegar a quem ja tinha
 * a anterior, e ao mesmo tempo o que impede meia duzia de laboratorios de
 * re-baixar 272 MB so porque a instalacao deles e de antes do carimbo existir.
 * Os quatro casos estao aqui porque inverter qualquer um deles e silencioso.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { decidir, lerCarimbo, escreverCarimbo, NOME_PADRAO } = require('../../components/Scripts/lib/version_stamp.js');

let pasta;
beforeEach(() => { pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-stamp-')); });
afterEach(() => { fs.rmSync(pasta, { recursive: true, force: true }); });

describe('decidir', () => {
  it('ausente: baixa', () => {
    const r = decidir({ instalado: false, carimbo: path.join(pasta, NOME_PADRAO), tag: 'v2' });
    expect(r).toEqual({ pular: false, motivo: 'ausente', gravada: null });
  });

  it('instalado sem carimbo: pula, porque a versao e desconhecida, nao errada', () => {
    const r = decidir({ instalado: true, carimbo: path.join(pasta, NOME_PADRAO), tag: 'v2' });
    expect(r).toEqual({ pular: true, motivo: 'sem-carimbo', gravada: null });
  });

  it('instalado na tag fixada: pula', () => {
    const carimbo = path.join(pasta, NOME_PADRAO);
    escreverCarimbo(carimbo, 'v2');
    expect(decidir({ instalado: true, carimbo, tag: 'v2' })).toEqual({ pular: true, motivo: 'em-dia', gravada: 'v2' });
  });

  it('instalado em outra tag: re-baixa, e diz qual estava la', () => {
    const carimbo = path.join(pasta, NOME_PADRAO);
    escreverCarimbo(carimbo, 'v1');
    expect(decidir({ instalado: true, carimbo, tag: 'v2' })).toEqual({ pular: false, motivo: 'outra-versao', gravada: 'v1' });
  });
});

describe('escreverCarimbo / lerCarimbo', () => {
  it('cria a pasta, grava e le a mesma tag, ignorando espaco e quebra de linha', () => {
    const carimbo = path.join(pasta, 'sub', 'pasta', NOME_PADRAO);
    escreverCarimbo(carimbo, 'v0.7.0-nips.10');
    expect(lerCarimbo(carimbo)).toBe('v0.7.0-nips.10');
    fs.writeFileSync(carimbo, '  v5.3 \r\n');
    expect(lerCarimbo(carimbo)).toBe('v5.3');
  });

  it('carimbo vazio ou ausente e null, nunca string vazia', () => {
    const carimbo = path.join(pasta, NOME_PADRAO);
    expect(lerCarimbo(carimbo)).toBeNull();
    fs.writeFileSync(carimbo, '   \n');
    expect(lerCarimbo(carimbo)).toBeNull();
  });
});
