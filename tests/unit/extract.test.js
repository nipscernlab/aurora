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
 *
 * `atributos` sao os atributos externos da entrada no diretorio central. Por
 * padrao um nome terminado em barra ganha o bit de pasta do DOS (0x10) e o
 * resto fica em zero; passar `atributos: 0` num nome SEM barra reproduz a
 * pasta sem marcador nenhum, que e o formato que o gtkwave-nipscern traz.
 *
 * @param {{nome: string, dados?: Buffer|string, metodo?: number, crc?: number, flags?: number, atributos?: number}[]} entradas
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
    central.writeUInt32LE(e.atributos ?? (e.nome.endsWith('/') ? 0x10 : 0), 38);
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

/**
 * Pastas que o zip nao marca como pasta.
 *
 * O gtkwave-nipscern traz entradas como `lib/gdk-pixbuf-2.0` sem barra final,
 * sem o bit 0x10 do DOS e sem S_IFDIR no modo Unix. A pasta era criada de
 * qualquer jeito, porque outra entrada mora dentro dela, e entao a escrita
 * batia numa pasta existente: EISDIR, a extracao rapida abortava e o
 * instalador caia no Expand-Archive, que leva minutos onde a rapida leva
 * segundos. Os zips aqui reproduzem esse defeito de proposito.
 */
describe('pastas sem marcador', () => {
  const semMarcador = (nome) => ({ nome, dados: '', metodo: STORED, atributos: 0 });

  it('nao estoura EISDIR quando a pasta vem como entrada sem barra', async () => {
    const zip = gravar('gtk.zip', montarZip([
      semMarcador('lib/gdk-pixbuf-2.0'),
      { nome: 'lib/gdk-pixbuf-2.0/loaders.cache', dados: 'cache' },
      { nome: 'gtkwave.exe', dados: 'MZ' },
    ]));
    const destino = path.join(pasta, 'saida');
    await expect(extrairEmParalelo(zip, destino)).resolves.toBeTruthy();
    expect(fs.statSync(path.join(destino, 'lib', 'gdk-pixbuf-2.0')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'lib', 'gdk-pixbuf-2.0', 'loaders.cache'), 'utf8')).toBe('cache');
    expect(fs.readFileSync(path.join(destino, 'gtkwave.exe'), 'utf8')).toBe('MZ');
  });

  it('a ordem das entradas nao importa', async () => {
    // O arquivo de dentro vindo ANTES da entrada da pasta ja cria o diretorio,
    // que era o gatilho do EISDIR no relato.
    const zip = gravar('ordem.zip', montarZip([
      { nome: 'lib/x/a.txt', dados: 'a' },
      semMarcador('lib/x'),
    ]));
    const destino = path.join(pasta, 'saida');
    await expect(extrairEmParalelo(zip, destino)).resolves.toBeTruthy();
    expect(fs.statSync(path.join(destino, 'lib', 'x')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'lib', 'x', 'a.txt'), 'utf8')).toBe('a');
  });

  it('reconhece a pasta mesmo com barra invertida no nome', async () => {
    // A classificacao usa a mesma normalizacao do caminho de destino. Se usasse
    // outra, `lib\x` nao casaria com `lib/x/a.txt` e o EISDIR voltaria so para
    // zips escritos por ferramenta do Windows.
    const zip = gravar('barra.zip', montarZip([
      semMarcador('lib\\x'),
      { nome: 'lib\\x\\a.txt', dados: 'a' },
    ]));
    const destino = path.join(pasta, 'saida');
    await expect(extrairEmParalelo(zip, destino)).resolves.toBeTruthy();
    expect(fs.readFileSync(path.join(destino, 'lib', 'x', 'a.txt'), 'utf8')).toBe('a');
  });

  it('a classificacao ja sai de lerDiretorioCentral, para quem so lista ver o mesmo', async () => {
    const zip = gravar('lista.zip', montarZip([
      semMarcador('lib/x'),
      { nome: 'lib/x/a.txt', dados: 'a' },
      semMarcador('lib/vazia'),
    ]));
    const fd = await fs.promises.open(zip, 'r');
    try {
      const entradas = await lerDiretorioCentral(fd, (await fd.stat()).size);
      const porNome = Object.fromEntries(entradas.map((e) => [e.nome, e.diretorio]));
      expect(porNome).toEqual({ 'lib/x': true, 'lib/x/a.txt': false, 'lib/vazia': false });
    } finally {
      await fd.close();
    }
  });

  it('arquivo vazio de verdade continua sendo arquivo', async () => {
    // A correcao nao pode transformar todo arquivo de zero byte em pasta: o
    // .gitkeep e o marcador vazio sao comuns e precisam existir no disco.
    const zip = gravar('vazio.zip', montarZip([semMarcador('pasta/.gitkeep')]));
    const destino = path.join(pasta, 'saida');
    await extrairEmParalelo(zip, destino);
    expect(fs.statSync(path.join(destino, 'pasta', '.gitkeep')).isFile()).toBe(true);
  });

  it('recusa arquivo COM conteudo que tambem e pasta de outra entrada', async () => {
    // Reclassificar descartaria os bytes dele em silencio e ainda relataria
    // sucesso. Recusar manda o instalador para o Expand-Archive, que e o
    // contrato para zip que este modulo nao sabe extrair corretamente.
    const zip = gravar('conflito.zip', montarZip([
      { nome: 'lib/link', dados: 'alvo-do-link', atributos: 0 },
      { nome: 'lib/link/x.dll', dados: 'x' },
    ]));
    await expect(extrairEmParalelo(zip, path.join(pasta, 'saida'))).rejects.toBeInstanceOf(ZipNaoSuportado);
  });

  it('reinstalacao por cima: pasta existente onde o zip traz entrada vazia fica, com aviso', async () => {
    // A pasta vazia sem marcador e sem filhos e indistinguivel de arquivo
    // vazio. Numa segunda instalacao ja existe uma pasta ali, e escrever
    // daria EISDIR; a pasta fica, e quem instala e avisado.
    const destino = path.join(pasta, 'saida');
    fs.mkdirSync(path.join(destino, 'lib', 'vazia'), { recursive: true });
    const zip = gravar('reinst.zip', montarZip([semMarcador('lib/vazia'), { nome: 'a.txt', dados: 'a' }]));
    const avisos = [];
    await extrairEmParalelo(zip, destino, { onAviso: (m) => avisos.push(m) });
    expect(fs.statSync(path.join(destino, 'lib', 'vazia')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(destino, 'a.txt'), 'utf8')).toBe('a');
    expect(avisos).toEqual([expect.stringContaining('lib/vazia')]);
  });

  it('reinstalacao por cima: arquivo vazio da versao anterior da lugar a pasta, com aviso', async () => {
    // O espelho do caso acima. A versao anterior gravou `lib/vazia` como
    // arquivo (nada morava dentro); a nova passa a por conteudo dentro. Sem
    // conserto o mkdir falha, a rapida aborta e o Expand-Archive tropeca no
    // mesmo arquivo: componente sem conserto naquela maquina.
    const destino = path.join(pasta, 'saida');
    fs.mkdirSync(path.join(destino, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(destino, 'lib', 'vazia'), '');
    const zip = gravar('reinst2.zip', montarZip([
      semMarcador('lib/vazia'),
      { nome: 'lib/vazia/fundo/a.txt', dados: 'a' },
    ]));
    const avisos = [];
    await extrairEmParalelo(zip, destino, { onAviso: (m) => avisos.push(m) });
    expect(fs.readFileSync(path.join(destino, 'lib', 'vazia', 'fundo', 'a.txt'), 'utf8')).toBe('a');
    expect(avisos).toEqual([expect.stringContaining('vazia')]);
  });

  it('arquivo com conteudo no lugar de uma pasta nao e apagado', async () => {
    const destino = path.join(pasta, 'saida');
    fs.mkdirSync(path.join(destino, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(destino, 'lib', 'cheio'), 'dado de alguem');
    const zip = gravar('reinst3.zip', montarZip([{ nome: 'lib/cheio/a.txt', dados: 'a' }]));
    await expect(extrairEmParalelo(zip, destino)).rejects.toThrow(/no lugar de uma pasta/);
    expect(fs.readFileSync(path.join(destino, 'lib', 'cheio'), 'utf8')).toBe('dado de alguem');
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
