/**
 * O extrator paralelo (components/Scripts/lib/extract.js).
 *
 * Ele substitui o Expand-Archive em todos os instaladores de componentes, e a
 * cadeia de compilacao inteira passa por ele. O que precisa de prova:
 *
 * 1. O que sai do zip e o que entrou, byte a byte, nos dois metodos (stored e
 *    deflate), em pasta aninhada, e tanto no caminho em memoria quanto no
 *    caminho em fluxo (entrada grande).
 * 2. Um zip que tente escrever fora da pasta de destino nao escreve NADA, nem
 *    a parte boa. A validacao vem antes do primeiro byte.
 * 3. Dado corrompido nao vira arquivo silenciosamente: CRC errado e erro.
 * 4. O que o extrator nao sabe ler (cifrado, metodo desconhecido) e recusado
 *    com o erro proprio, que e o que faz o chamador cair no Expand-Archive.
 *
 * Os zips sao montados aqui mesmo, a mao, para o teste nao depender de
 * PowerShell nem de biblioteca: o formato e pequeno o bastante para isso.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  extractZip, extrairEmParalelo, lerDiretorioCentral, caminhoSeguro, ZipNaoSuportado,
} = require('../../components/Scripts/lib/extract.js');

const STORED = 0;
const DEFLATE = 8;

/**
 * Monta um zip com as entradas dadas.
 * @param {{nome: string, dados?: Buffer|string, metodo?: number, crc?: number, flags?: number}[]} entradas
 */
function montarZip(entradas) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const dados = Buffer.isBuffer(e.dados) ? e.dados : Buffer.from(e.dados || '');
    const metodo = e.metodo ?? DEFLATE;
    const comprimido = metodo === DEFLATE ? zlib.deflateRawSync(dados) : dados;
    const nome = Buffer.from(e.nome, 'utf8');
    const crc = e.crc ?? zlib.crc32(dados);
    const flags = e.flags ?? 0x800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(e.nome.endsWith('/') ? 0x10 : 0, 38);
    central.writeUInt32LE(deslocamento, 42);

    locais.push(local, nome, comprimido);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

let pasta;
beforeEach(() => { pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-extract-')); });
afterEach(() => { fs.rmSync(pasta, { recursive: true, force: true }); });

function gravar(nome, buf) {
  const p = path.join(pasta, nome);
  fs.writeFileSync(p, buf);
  return p;
}

describe('extrairEmParalelo', () => {
  it('devolve o que entrou, byte a byte, em memoria e em fluxo', async () => {
    // 9 MB passam do limite em memoria (8 MB) e tomam o caminho em fluxo; o
    // conteudo se repete para o deflate ter o que comprimir.
    const grande = Buffer.alloc(9 * 1024 * 1024);
    for (let i = 0; i < grande.length; i++) grande[i] = (i * 7 + (i >> 10)) & 0xff;
    const zip = gravar('a.zip', montarZip([
      { nome: 'pasta/', dados: '' },
      { nome: 'pasta/texto.txt', dados: 'ola, mundo' },
      { nome: 'pasta/sub/guardado.bin', dados: Buffer.from([1, 2, 3, 4, 5]), metodo: STORED },
      { nome: 'grande.bin', dados: grande },
      { nome: 'vazio.txt', dados: '' },
    ]));
    const destino = path.join(pasta, 'saida');
    const r = await extrairEmParalelo(zip, destino);
    expect(r.entradas).toBe(5);
    expect(fs.readFileSync(path.join(destino, 'pasta', 'texto.txt'), 'utf8')).toBe('ola, mundo');
    expect([...fs.readFileSync(path.join(destino, 'pasta', 'sub', 'guardado.bin'))]).toEqual([1, 2, 3, 4, 5]);
    expect(fs.readFileSync(path.join(destino, 'grande.bin')).equals(grande)).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'vazio.txt')).length).toBe(0);
    expect(fs.statSync(path.join(destino, 'pasta')).isDirectory()).toBe(true);
  });

  it('sobrescreve o que ja existia, como o Expand-Archive -Force fazia', async () => {
    const destino = path.join(pasta, 'saida');
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, 'x.txt'), 'velho');
    await extrairEmParalelo(gravar('b.zip', montarZip([{ nome: 'x.txt', dados: 'novo' }])), destino);
    expect(fs.readFileSync(path.join(destino, 'x.txt'), 'utf8')).toBe('novo');
  });

  it('nao escreve nada quando uma entrada tenta sair da pasta', async () => {
    const zip = gravar('c.zip', montarZip([
      { nome: 'bom.txt', dados: 'bom' },
      { nome: '../fora.txt', dados: 'mal' },
    ]));
    const destino = path.join(pasta, 'saida');
    await expect(extrairEmParalelo(zip, destino)).rejects.toBeInstanceOf(ZipNaoSuportado);
    expect(fs.existsSync(path.join(destino, 'bom.txt'))).toBe(false);
    expect(fs.existsSync(path.join(pasta, 'fora.txt'))).toBe(false);
  });

  it('recusa CRC que nao confere em vez de gravar lixo', async () => {
    const zip = gravar('d.zip', montarZip([{ nome: 'x.txt', dados: 'conteudo', crc: 0xDEADBEEF }]));
    await expect(extrairEmParalelo(zip, path.join(pasta, 'saida'))).rejects.toThrow(/CRC/);
  });

  it('recusa zip cifrado e metodo que nao conhece, com o erro proprio', async () => {
    const cifrado = gravar('e.zip', montarZip([{ nome: 'x.txt', dados: 'a', flags: 0x801 }]));
    await expect(extrairEmParalelo(cifrado, path.join(pasta, 's1'))).rejects.toBeInstanceOf(ZipNaoSuportado);
    const bzip2 = gravar('f.zip', montarZip([{ nome: 'x.txt', dados: 'a', metodo: 12 }]));
    await expect(extrairEmParalelo(bzip2, path.join(pasta, 's2'))).rejects.toBeInstanceOf(ZipNaoSuportado);
  });

  it('recusa um arquivo que nao e zip', async () => {
    const lixo = gravar('g.zip', Buffer.from('isto nao e um zip, e um texto qualquer'));
    await expect(extrairEmParalelo(lixo, path.join(pasta, 'saida'))).rejects.toBeInstanceOf(ZipNaoSuportado);
  });
});

describe('lerDiretorioCentral', () => {
  it('lista as entradas com tamanho e metodo, sem descompactar', async () => {
    const zip = gravar('h.zip', montarZip([
      { nome: 'a.txt', dados: 'aaaa', metodo: STORED },
      { nome: 'b/c.txt', dados: 'cccccccc' },
    ]));
    const fd = await fs.promises.open(zip, 'r');
    try {
      const entradas = await lerDiretorioCentral(fd, (await fd.stat()).size);
      expect(entradas.map((e) => e.nome)).toEqual(['a.txt', 'b/c.txt']);
      expect(entradas[0].metodo).toBe(STORED);
      expect(entradas[0].tamanho).toBe(4);
      expect(entradas[1].metodo).toBe(DEFLATE);
      expect(entradas[1].tamanho).toBe(8);
      expect(entradas[1].diretorio).toBe(false);
    } finally {
      await fd.close();
    }
  });
});

describe('caminhoSeguro', () => {
  const destino = path.resolve('C:\\destino');
  it('aceita caminhos normais e normaliza a barra', () => {
    expect(caminhoSeguro(destino, 'a/b/c.txt')).toBe(path.join(destino, 'a', 'b', 'c.txt'));
    expect(caminhoSeguro(destino, 'a\\b.txt')).toBe(path.join(destino, 'a', 'b.txt'));
  });
  it('recusa o que sai da pasta', () => {
    for (const nome of ['../x', 'a/../../x', '/abs', 'C:/abs', 'C:\\abs', '', './a/./b']) {
      expect(() => caminhoSeguro(destino, nome), nome).toThrow(ZipNaoSuportado);
    }
  });
});

describe('extractZip (o que os instaladores chamam)', () => {
  it('extrai um zip valido', async () => {
    const zip = gravar('i.zip', montarZip([{ nome: 'p/q.txt', dados: 'q' }]));
    const destino = path.join(pasta, 'saida');
    const linhas = [];
    await extractZip(zip, destino, { log: (m) => linhas.push(m), tag: 'teste' });
    expect(fs.readFileSync(path.join(destino, 'p', 'q.txt'), 'utf8')).toBe('q');
    expect(linhas.some((l) => /Extracted 1 entries/.test(l))).toBe(true);
  });

  it('rejeita zip inexistente antes de abrir processo algum', async () => {
    await expect(extractZip(path.join(pasta, 'nao-existe.zip'), path.join(pasta, 's'))).rejects.toThrow(/not found/);
  });
});
