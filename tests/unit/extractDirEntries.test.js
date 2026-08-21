/**
 * Extracao de zip cujas pastas nao vem marcadas como pasta.
 *
 * O gtkwave-nipscern traz entradas como `lib/gdk-pixbuf-2.0` sem barra final,
 * sem o bit 0x10 do DOS e sem S_IFDIR no modo Unix. A pasta era criada de
 * qualquer jeito, porque outra entrada mora dentro dela, e entao a escrita
 * batia numa pasta existente: EISDIR, a extracao rapida abortava e o
 * instalador caia no Expand-Archive, que leva minutos onde a rapida leva
 * segundos.
 *
 * O teste monta o zip byte a byte, com o mesmo defeito, porque nenhuma
 * biblioteca de empacotamento produz esse formato de proposito, e e
 * exatamente o formato que apareceu na maquina do usuario.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { extrairEmParalelo } from '../../components/Scripts/lib/extract.js';

/** CRC-32, para o zip ser aceito pela verificacao da extracao. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

/**
 * Monta um zip minimo (metodo "stored"), controlando os atributos externos de
 * cada entrada. `atributos: 0` e o que reproduz a pasta sem marcador.
 *
 * @param {Array<{nome: string, dados: Buffer, atributos: number}>} itens
 */
function montarZip(itens) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const item of itens) {
    const nome = Buffer.from(item.nome, 'utf8');
    const crc = crc32(item.dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versao necessaria
    local.writeUInt16LE(0, 6);           // sem flags
    local.writeUInt16LE(0, 8);           // metodo: stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(item.dados.length, 18);
    local.writeUInt32LE(item.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, item.dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(item.dados.length, 20);
    central.writeUInt32LE(item.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(item.atributos, 38);   // atributos externos
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += local.length + nome.length + item.dados.length;
  }

  const corpo = Buffer.concat(locais);
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(itens.length, 8);
  fim.writeUInt16LE(itens.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(corpo.length, 16);
  return Buffer.concat([corpo, diretorio, fim]);
}

describe('extracao com pastas sem marcador', () => {
  let tmp;

  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-zip-')); });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ } });

  it('nao estoura EISDIR quando a pasta vem como entrada sem barra', async () => {
    // Exatamente o caso do gtkwave: `lib/gdk-pixbuf-2.0` como entrada de zero
    // byte e atributos zerados, seguida de um arquivo DENTRO dela.
    const zip = path.join(tmp, 'gtk.zip');
    fs.writeFileSync(zip, montarZip([
      { nome: 'lib/gdk-pixbuf-2.0', dados: Buffer.alloc(0), atributos: 0 },
      { nome: 'lib/gdk-pixbuf-2.0/loaders.cache', dados: Buffer.from('cache'), atributos: 0 },
      { nome: 'gtkwave.exe', dados: Buffer.from('MZ'), atributos: 0 },
    ]));

    const destino = path.join(tmp, 'saida');
    await expect(extrairEmParalelo(zip, destino)).resolves.toBeTruthy();

    // A pasta e pasta, o arquivo de dentro chegou, e o resto tambem.
    expect(fs.statSync(path.join(destino, 'lib', 'gdk-pixbuf-2.0')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'lib', 'gdk-pixbuf-2.0', 'loaders.cache'), 'utf8')).toBe('cache');
    expect(fs.readFileSync(path.join(destino, 'gtkwave.exe'), 'utf8')).toBe('MZ');
  });

  it('a ordem das entradas nao importa', async () => {
    // O arquivo de dentro vindo ANTES da entrada da pasta ja cria o diretorio,
    // que era o gatilho do EISDIR no relato.
    const zip = path.join(tmp, 'ordem.zip');
    fs.writeFileSync(zip, montarZip([
      { nome: 'lib/x/a.txt', dados: Buffer.from('a'), atributos: 0 },
      { nome: 'lib/x', dados: Buffer.alloc(0), atributos: 0 },
    ]));

    const destino = path.join(tmp, 'saida2');
    await expect(extrairEmParalelo(zip, destino)).resolves.toBeTruthy();
    expect(fs.statSync(path.join(destino, 'lib', 'x')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'lib', 'x', 'a.txt'), 'utf8')).toBe('a');
  });

  it('arquivo vazio de verdade continua sendo arquivo', async () => {
    // A correcao nao pode transformar todo arquivo de zero byte em pasta: o
    // .gitkeep e o marcador vazio sao comuns e precisam existir no disco.
    const zip = path.join(tmp, 'vazio.zip');
    fs.writeFileSync(zip, montarZip([
      { nome: 'pasta/.gitkeep', dados: Buffer.alloc(0), atributos: 0 },
    ]));

    const destino = path.join(tmp, 'saida3');
    await extrairEmParalelo(zip, destino);
    const alvo = path.join(destino, 'pasta', '.gitkeep');
    expect(fs.existsSync(alvo)).toBe(true);
    expect(fs.statSync(alvo).isFile()).toBe(true);
  });

  it('conteudo comprimido continua chegando inteiro', async () => {
    // Guarda contra a correcao mexer no caminho normal por descuido.
    const grande = Buffer.from('x'.repeat(5000));
    const zip = path.join(tmp, 'normal.zip');
    fs.writeFileSync(zip, montarZip([
      { nome: 'bin/dado.txt', dados: grande, atributos: 0 },
    ]));

    const destino = path.join(tmp, 'saida4');
    await extrairEmParalelo(zip, destino);
    expect(fs.readFileSync(path.join(destino, 'bin', 'dado.txt')).equals(grande)).toBe(true);
  });

  void zlib;
});
