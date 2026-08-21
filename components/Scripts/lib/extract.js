// @ts-check
/**
 * extract.js: descompactar um zip usando a maquina inteira.
 *
 * POR QUE NAO O Expand-Archive
 * ----------------------------
 * Ate aqui cada instalador chamava o `Expand-Archive` do PowerShell. Ele vem em
 * todo Windows, e por isso foi a primeira escolha, mas e um so fio de execucao
 * em .NET Framework abrindo e fechando um arquivo por vez: a cadeia de
 * compilacao sao dezessete mil arquivos, e o aluno ficava minutos olhando uma
 * barra parada em 100% sem saber se tinha travado. Com o antivirus examinando
 * cada arquivo escrito, pior ainda.
 *
 * O QUE ESTE MODULO FAZ
 * ---------------------
 * Le o diretorio central do zip (a lista de entradas que fica no fim do
 * arquivo), e entao descompacta MUITAS entradas ao mesmo tempo. A leitura, a
 * descompressao (zlib, codigo nativo) e a escrita rodam no pool de threads do
 * Node, que aqui e dimensionado pelo numero de nucleos da maquina. E por isso
 * que o modulo precisa ser carregado ANTES de qualquer I/O do script: o pool
 * nasce no primeiro uso e nao muda mais de tamanho.
 *
 * So Node embutido, de proposito: os scripts rodam na maquina do usuario com
 * o Electron em modo Node, onde nao ha node_modules.
 *
 * O QUE ACONTECE QUANDO ALGO SAI DO ESPERADO
 * ------------------------------------------
 * Um zip cifrado, um metodo de compressao que nao seja deflate/stored, um
 * nome que tente escapar da pasta de destino, um CRC que nao confere: tudo
 * isso interrompe a extracao rapida, e o chamador cai no Expand-Archive, que
 * e o caminho que funcionava antes. Rapido quando da, correto sempre.
 *
 * O QUE E IGUAL AO Expand-Archive, DE PROPOSITO
 * ---------------------------------------------
 * Entrada de link simbolico vira arquivo comum com o alvo como conteudo, e
 * arquivo existente e sobrescrito. Sao os dois comportamentos que os pacotes
 * ja instalados nesta base de usuarios tiveram, e mudar qualquer um deles
 * agora seria criar duas populacoes de instalacao.
 */

'use strict';

const os = require('os');

// O pool de threads do Node tem 4 fios por padrao e cresce so por esta
// variavel, lida no primeiro uso. Carregar este modulo no topo do script e o
// que garante que ela chega antes de qualquer acesso a disco ou rede.
const FIOS = Math.min(16, Math.max(4, os.cpus().length));
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(FIOS);

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { execSync } = require('child_process');

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_EOCD64 = 0x06064b50;
const ASSINATURA_LOCALIZADOR64 = 0x07064b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

const METODO_STORED = 0;
const METODO_DEFLATE = 8;

/** Acima disto a entrada e descompactada em fluxo, para a memoria nao crescer com o maior arquivo do zip. */
const LIMITE_EM_MEMORIA = 8 * 1024 * 1024;

/** Quantas entradas em voo ao mesmo tempo: o dobro dos fios mantem o pool sempre ocupado. */
const EM_VOO = FIOS * 2;

/**
 * @typedef {{
 *   nome: string, metodo: number, crc: number, tamanhoComprimido: number,
 *   tamanho: number, deslocamentoLocal: number, diretorio: boolean,
 * }} Entrada
 */

class ZipNaoSuportado extends Error {}

/**
 * Le o diretorio central do zip. Nao descompacta nada.
 *
 * @param {import('fs/promises').FileHandle} fd
 * @param {number} tamanhoArquivo
 * @returns {Promise<Entrada[]>}
 */
async function lerDiretorioCentral(fd, tamanhoArquivo) {
  // O registro de fim (EOCD) fica nos ultimos 22 bytes mais um comentario de
  // ate 64 KB. Le essa cauda inteira e procura a assinatura de tras para frente.
  const cauda = Math.min(tamanhoArquivo, 22 + 0xFFFF);
  const buf = Buffer.alloc(cauda);
  await lerEm(fd, buf, tamanhoArquivo - cauda);
  let pos = -1;
  for (let i = cauda - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) { pos = i; break; }
  }
  if (pos < 0) throw new ZipNaoSuportado('fim do diretorio central nao encontrado (zip truncado?)');

  let totalEntradas = buf.readUInt16LE(pos + 10);
  let tamanhoCentral = buf.readUInt32LE(pos + 12);
  let inicioCentral = buf.readUInt32LE(pos + 16);

  // Zip64: os campos de 32 bits saturam em 0xFFFFFFFF e o valor real mora num
  // registro proprio, apontado por um localizador logo antes do EOCD.
  if (totalEntradas === 0xFFFF || tamanhoCentral === 0xFFFFFFFF || inicioCentral === 0xFFFFFFFF) {
    const posLocalizador = tamanhoArquivo - cauda + pos - 20;
    const loc = Buffer.alloc(20);
    await lerEm(fd, loc, posLocalizador);
    if (loc.readUInt32LE(0) !== ASSINATURA_LOCALIZADOR64) {
      throw new ZipNaoSuportado('zip64 sem localizador');
    }
    const posEocd64 = Number(loc.readBigUInt64LE(8));
    const eocd64 = Buffer.alloc(56);
    await lerEm(fd, eocd64, posEocd64);
    if (eocd64.readUInt32LE(0) !== ASSINATURA_EOCD64) {
      throw new ZipNaoSuportado('zip64 com registro de fim invalido');
    }
    totalEntradas = Number(eocd64.readBigUInt64LE(32));
    tamanhoCentral = Number(eocd64.readBigUInt64LE(40));
    inicioCentral = Number(eocd64.readBigUInt64LE(48));
  }

  const central = Buffer.alloc(tamanhoCentral);
  await lerEm(fd, central, inicioCentral);

  /** @type {Entrada[]} */
  const entradas = [];
  let p = 0;
  for (let i = 0; i < totalEntradas; i++) {
    if (p + 46 > central.length || central.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new ZipNaoSuportado(`diretorio central corrompido na entrada ${i}`);
    }
    const flags = central.readUInt16LE(p + 8);
    const metodo = central.readUInt16LE(p + 10);
    const crc = central.readUInt32LE(p + 16);
    let tamanhoComprimido = central.readUInt32LE(p + 20);
    let tamanho = central.readUInt32LE(p + 24);
    const tamNome = central.readUInt16LE(p + 28);
    const tamExtra = central.readUInt16LE(p + 30);
    const tamComentario = central.readUInt16LE(p + 32);
    const atributosExternos = central.readUInt32LE(p + 38);
    let deslocamentoLocal = central.readUInt32LE(p + 42);
    const nome = central.toString('utf8', p + 46, p + 46 + tamNome);

    if (flags & 0x1) throw new ZipNaoSuportado(`entrada cifrada: ${nome}`);
    if (metodo !== METODO_STORED && metodo !== METODO_DEFLATE) {
      throw new ZipNaoSuportado(`metodo de compressao ${metodo} em ${nome}`);
    }

    // Campo extra zip64 (id 0x0001): so os campos saturados aparecem, nesta ordem.
    let e = p + 46 + tamNome;
    const fimExtra = e + tamExtra;
    while (e + 4 <= fimExtra) {
      const id = central.readUInt16LE(e);
      const tam = central.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (tamanho === 0xFFFFFFFF) { tamanho = Number(central.readBigUInt64LE(q)); q += 8; }
        if (tamanhoComprimido === 0xFFFFFFFF) { tamanhoComprimido = Number(central.readBigUInt64LE(q)); q += 8; }
        if (deslocamentoLocal === 0xFFFFFFFF) { deslocamentoLocal = Number(central.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + tam;
    }

    // Diretorio: nome terminado em barra, ou bit de diretorio nos atributos
    // (DOS 0x10, ou S_IFDIR no modo Unix que vive nos 16 bits altos).
    const modoUnix = atributosExternos >>> 16;
    const diretorio = nome.endsWith('/') || (atributosExternos & 0x10) !== 0
      || (modoUnix & 0o170000) === 0o040000;

    entradas.push({ nome, metodo, crc, tamanhoComprimido, tamanho, deslocamentoLocal, diretorio });
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

/**
 * O caminho de destino de uma entrada, ou um erro se ela tentar sair da pasta.
 *
 * @param {string} destino  ja resolvido
 * @param {string} nome
 */
function caminhoSeguro(destino, nome) {
  const limpo = nome.replace(/\\/g, '/');
  if (!limpo || limpo.startsWith('/') || /^[A-Za-z]:/.test(limpo)) {
    throw new ZipNaoSuportado(`caminho absoluto dentro do zip: ${nome}`);
  }
  const partes = limpo.split('/').filter((s) => s.length > 0);
  if (partes.some((s) => s === '..' || s === '.')) {
    throw new ZipNaoSuportado(`caminho que sai da pasta dentro do zip: ${nome}`);
  }
  const alvo = path.join(destino, ...partes);
  if (alvo !== destino && !alvo.startsWith(destino + path.sep)) {
    throw new ZipNaoSuportado(`caminho fora do destino: ${nome}`);
  }
  return alvo;
}

/** @param {import('fs/promises').FileHandle} fd @param {Buffer} buf @param {number} posicao */
async function lerEm(fd, buf, posicao) {
  let lido = 0;
  while (lido < buf.length) {
    const { bytesRead } = await fd.read(buf, lido, buf.length - lido, posicao + lido);
    if (bytesRead === 0) throw new ZipNaoSuportado('zip termina antes do esperado');
    lido += bytesRead;
  }
}

/**
 * Onde comecam os dados de uma entrada: depois do cabecalho local, cujo nome
 * e campo extra podem ter tamanhos diferentes dos do diretorio central.
 *
 * @param {import('fs/promises').FileHandle} fd @param {Entrada} entrada
 */
async function inicioDosDados(fd, entrada) {
  const cab = Buffer.alloc(30);
  await lerEm(fd, cab, entrada.deslocamentoLocal);
  if (cab.readUInt32LE(0) !== ASSINATURA_LOCAL) {
    throw new ZipNaoSuportado(`cabecalho local invalido em ${entrada.nome}`);
  }
  return entrada.deslocamentoLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
}

const inflateRaw = /** @type {(b: Buffer) => Promise<Buffer>} */ (
  (b) => new Promise((resolve, reject) => zlib.inflateRaw(b, (e, r) => (e ? reject(e) : resolve(r))))
);

/** CRC-32 nativo quando o Node oferece; sem ele a conferencia e pulada, nao simulada. */
const crc32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : null;

/**
 * Extrai uma entrada de arquivo.
 *
 * @param {import('fs/promises').FileHandle} fd @param {string} zipPath @param {Entrada} entrada @param {string} alvo
 */
async function extrairEntrada(fd, zipPath, entrada, alvo) {
  // Rede de seguranca para a pasta sem marcador que a regra estrutural nao
  // alcanca: uma pasta VAZIA, que nao e ancestral de ninguem. Ela nao carrega
  // conteudo nenhum, entao pular nao perde byte, e escrever levaria ao EISDIR
  // que derrubava a extracao inteira por causa de uma entrada de zero byte.
  if (entrada.tamanho === 0) {
    try {
      if (fs.statSync(alvo).isDirectory()) return;
    } catch (_) { /* nao existe: e arquivo vazio mesmo, segue */ }
  }

  const inicio = await inicioDosDados(fd, entrada);

  if (entrada.tamanhoComprimido <= LIMITE_EM_MEMORIA) {
    const comprimido = Buffer.alloc(entrada.tamanhoComprimido);
    await lerEm(fd, comprimido, inicio);
    const dados = entrada.metodo === METODO_DEFLATE ? await inflateRaw(comprimido) : comprimido;
    if (dados.length !== entrada.tamanho) {
      throw new Error(`${entrada.nome}: tamanho ${dados.length}, esperado ${entrada.tamanho}`);
    }
    if (crc32 && crc32(dados) !== entrada.crc) throw new Error(`${entrada.nome}: CRC nao confere`);
    await fs.promises.writeFile(alvo, dados);
    return;
  }

  // Arquivo grande: em fluxo, com o CRC acumulado de passagem.
  let crcParcial = 0;
  let bytes = 0;
  const contador = new (require('stream').Transform)({
    transform(pedaco, _enc, cb) {
      bytes += pedaco.length;
      if (crc32) crcParcial = crc32(pedaco, crcParcial);
      cb(null, pedaco);
    },
  });
  const leitura = fs.createReadStream(zipPath, {
    fd: fd.fd, autoClose: false, start: inicio, end: inicio + entrada.tamanhoComprimido - 1,
  });
  const escrita = fs.createWriteStream(alvo);
  if (entrada.metodo === METODO_DEFLATE) {
    await pipeline(leitura, zlib.createInflateRaw(), contador, escrita);
  } else {
    await pipeline(leitura, contador, escrita);
  }
  if (bytes !== entrada.tamanho) {
    throw new Error(`${entrada.nome}: tamanho ${bytes}, esperado ${entrada.tamanho}`);
  }
  if (crc32 && crcParcial !== entrada.crc) throw new Error(`${entrada.nome}: CRC nao confere`);
}

/**
 * Extrai o zip inteiro, em paralelo.
 *
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{ onProgress?: (p: {feitos: number, total: number}) => void }} [opcoes]
 * @returns {Promise<{entradas: number}>}
 */
async function extrairEmParalelo(zipPath, destDir, opcoes = {}) {
  const destino = path.resolve(destDir);
  fs.mkdirSync(destino, { recursive: true });

  const fd = await fs.promises.open(zipPath, 'r');
  try {
    const { size } = await fd.stat();
    const entradas = await lerDiretorioCentral(fd, size);

    // Os caminhos sao validados TODOS antes de escrever o primeiro byte: um
    // zip malicioso nao ganha nem uma extracao parcial.
    const plano = entradas.map((e) => ({ entrada: e, alvo: caminhoSeguro(destino, e.nome) }));

    // Nem todo zip marca as pastas. O gtkwave-nipscern traz entradas como
    // `lib/gdk-pixbuf-2.0` sem barra final, sem o bit 0x10 do DOS e sem
    // S_IFDIR no modo Unix, e elas chegavam aqui classificadas como arquivo
    // vazio. A pasta era criada de qualquer forma, porque outra entrada morava
    // dentro dela, e a escrita entao batia numa pasta existente: EISDIR, a
    // extracao rapida abortava e o instalador caia no Expand-Archive.
    //
    // A prova que nao depende de marcador nenhum e estrutural: se algo mora
    // dentro de X, X e pasta. Montamos o conjunto dos ancestrais de todas as
    // entradas e reclassificamos por ele.
    const ancestrais = new Set();
    for (const { entrada } of plano) {
      const partes = entrada.nome.replace(/\/+$/, '').split('/');
      for (let i = 1; i < partes.length; i++) ancestrais.add(partes.slice(0, i).join('/'));
    }
    for (const item of plano) {
      if (item.entrada.diretorio) continue;
      if (ancestrais.has(item.entrada.nome.replace(/\/+$/, ''))) item.entrada.diretorio = true;
    }

    // Pastas primeiro, de uma vez, para os arquivos nao disputarem mkdir.
    const pastas = new Set();
    for (const { entrada, alvo } of plano) {
      pastas.add(entrada.diretorio ? alvo : path.dirname(alvo));
    }
    for (const pasta of pastas) fs.mkdirSync(pasta, { recursive: true });

    const arquivos = plano.filter((p) => !p.entrada.diretorio);
    // Os maiores primeiro: um arquivo de 60 MB que comecasse por ultimo
    // seguraria a extracao inteira sozinho no fim.
    arquivos.sort((a, b) => b.entrada.tamanhoComprimido - a.entrada.tamanhoComprimido);

    let feitos = 0;
    let proximo = 0;
    const total = arquivos.length;
    const avisar = opcoes.onProgress || (() => {});
    const trabalhador = async () => {
      while (proximo < arquivos.length) {
        const { entrada, alvo } = arquivos[proximo++];
        await extrairEntrada(fd, zipPath, entrada, alvo);
        feitos++;
        avisar({ feitos, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(EM_VOO, arquivos.length) }, trabalhador));
    return { entradas: entradas.length };
  } finally {
    await fd.close();
  }
}

/**
 * O caminho antigo, inteiro: um processo PowerShell e o Expand-Archive.
 *
 * @param {string} zipPath @param {string} destDir
 */
function extrairComPowerShell(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // $ErrorActionPreference = 'Stop' para a falha do cmdlet virar codigo de
  // saida diferente de zero; sem isso o execSync veria sucesso e o chamador
  // apagaria o zip antes de a sentinela acusar o problema.
  execSync(
    `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
    { stdio: 'inherit', windowsHide: true },
  );
}

/**
 * Extrai um zip: rapido quando da, e pelo caminho antigo quando nao da.
 *
 * O progresso sai como "[tag] extraindo 42% (7300 / 17323 arquivos)", a mesma
 * forma que o download ja usa, para a barra do painel de componentes andar
 * durante a extracao em vez de ficar parada em 100%.
 *
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{ log?: (m: string) => void, tag?: string }} [opcoes]
 */
async function extractZip(zipPath, destDir, opcoes = {}) {
  if (!fs.existsSync(zipPath)) throw new Error(`Zip file not found: ${zipPath}`);
  const log = opcoes.log || ((m) => console.log(m));
  const tag = opcoes.tag ? `[${opcoes.tag}] ` : '';

  log(`Extracting ${path.basename(zipPath)} → ${destDir} (${FIOS} threads)`);
  let ultimoAviso = 0;
  try {
    const r = await extrairEmParalelo(zipPath, destDir, {
      onProgress: ({ feitos, total }) => {
        const agora = Date.now();
        if (feitos !== total && agora - ultimoAviso < 250) return;
        ultimoAviso = agora;
        const pct = Math.round((feitos / total) * 100);
        process.stdout.write(`\r${tag}extraindo ${pct}% (${feitos} / ${total} arquivos)`);
        if (feitos === total) process.stdout.write('\n');
      },
    });
    log(`Extracted ${r.entradas} entries.`);
    return;
  } catch (e) {
    process.stdout.write('\n');
    log(`Fast extraction did not complete (${e instanceof Error ? e.message : e}); falling back to Expand-Archive.`);
  }
  extrairComPowerShell(zipPath, destDir);
}

module.exports = {
  extractZip,
  extrairEmParalelo,
  extrairComPowerShell,
  lerDiretorioCentral,
  caminhoSeguro,
  ZipNaoSuportado,
  FIOS,
};
