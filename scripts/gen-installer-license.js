// gen-installer-license.js: produce the text the installer's licence page
// shows, at build time.
//
// Wired into `build.beforePack` in package.json, so it runs on EVERY
// electron-builder invocation, the release workflow calls electron-builder
// directly (`npx electron-builder`, not `npm run build`), which is exactly why
// this is an electron-builder hook and not an npm `prebuild` step: the npm
// hook would fire locally and silently never fire in CI.
//
// WHAT IT WRITES
// --------------
// `build/license.txt` = the NIPS-CERN base licence ONCE, then the AURORA annex,
// then the SAPHO annex.
//
// The earlier version concatenated LICENSE + LICENSE-SAPHO.md whole. Both of
// those files are "base + their own annex", so the installer showed the entire
// base licence TWICE, and the reader had no way to know the second copy was the
// same text. Reading the base from LICENSE-BASE.md and slicing only the annexes
// out of the product files fixes that, and keeps the single-source rule the base
// itself sets: it is still reproduced from the canonical file, not hand-copied.
//
// PLAIN TEXT, NOT MARKDOWN
// ------------------------
// The source files are Markdown, and NSIS renders whatever it is handed as
// literal characters, so `##`, `**`, `|` table pipes and `[text](url)` all
// showed up on screen as punctuation soup. This converts them to plain text.
//
// That does not violate the base licence's "copie este arquivo inteiro, sem
// alterar uma vírgula": the words, their order and their punctuation are
// untouched. What is removed is the Markdown decoration around them, which is
// presentation, not text. The canonical file in the repository stays exactly as
// written.
//
// Why the BOM: electron-builder hands this file to NSIS's licence page, and
// Unicode NSIS decides the encoding by sniffing the file, without a BOM it
// assumes the system ANSI codepage and every accented character in the
// Portuguese text renders as mojibake. The BOM makes it unambiguous UTF-8.
//
// The licence page itself does not touch elevation: the installer stays
// per-user `oneClick` with no admin prompt (TODO.md section 2 depends on
// that), the page is just an accept/decline gate shown before the copy runs.

'use strict';

const fs = require('fs');
const path = require('path');

/** Largura de quebra. Confortável na janela do NSIS sem forçar rolagem lateral. */
const COLUNAS = 78;

/**
 * Quebra um parágrafo em linhas, sem cortar palavra.
 *
 * O recuo é PENDENTE: vale da segunda linha em diante. Quem chama já põe o
 * marcador na primeira ("- ", "a. "), e recuar a primeira também alinharia a
 * continuação com o marcador em vez de com o texto.
 */
function quebrar(texto, largura, recuo = '') {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const prefixo = linhas.length ? recuo : '';
    if (atual && (atual + ' ' + p).length > largura) {
      linhas.push(atual);
      atual = (linhas.length ? recuo : '') + p;
    } else {
      atual = atual ? `${atual} ${p}` : prefixo + p;
    }
  }
  if (atual.trim()) linhas.push(atual);
  return linhas;
}

/** Tira a marcação de trecho: negrito, itálico, código e link. */
function limparInline(s) {
  return s
    // [texto](url) vira "texto (url)", porque o endereço é informação real
    // numa licença: é para onde a pessoa vai reclamar ou pedir autorização.
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // Italico so e resolvido DEPOIS de o paragrafo ser juntado; enquanto o
    // texto estava quebrado em linhas, um `*...*` que atravessava a quebra nao
    // casava e o asterisco vazava para a tela.
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** Uma linha de tabela Markdown vira "célula: célula; célula". */
function celulas(linha) {
  return linha.replace(/^\||\|$/g, '').split('|').map((c) => limparInline(c));
}

/**
 * Markdown para texto puro.
 *
 * Nao e um conversor geral: cobre exatamente o que estes documentos usam, que e
 * titulo, paragrafo, lista, tabela e regua. Um conversor geral aqui seria
 * dependencia nova no caminho de build para resolver um problema que tem cinco
 * construcoes.
 *
 * O passo que nao e obvio: o texto-fonte ja vem quebrado em ~78 colunas, entao
 * reembrulhar linha a linha produz saida esfarrapada, com uma palavra sozinha
 * em cada terceira linha. As linhas de um mesmo paragrafo sao JUNTADAS primeiro
 * e so entao quebradas de novo. Vale igual para o item de lista, que continua
 * ate a linha em branco ou o proximo item, e cuja continuacao mantem o recuo.
 */
function paraTextoPuro(md) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n');
  const saida = [];

  let tabela = null;
  /** Paragrafo em montagem: {tipo:'p'|'li', partes:[], marca, recuo} */
  let bloco = null;

  const despejarBloco = () => {
    if (!bloco) return;
    const texto = limparInline(bloco.partes.join(' '));
    if (texto) {
      if (bloco.tipo === 'li') {
        saida.push(...quebrar(`${bloco.marca} ${texto}`, COLUNAS, bloco.recuo));
      } else {
        saida.push(...quebrar(texto, COLUNAS));
      }
    }
    bloco = null;
  };

  const despejarTabela = () => {
    if (!tabela) return;
    // Tabela vira lista de itens, um por linha de dados, no formato
    // "cabecalho: valor". Colunas alinhadas com espaco desalinham assim que a
    // janela do NSIS usa fonte proporcional.
    const [cab, ...dados] = tabela;
    for (const linha of dados) {
      const partes = linha.map((v, i) => (cab[i] ? `${cab[i]}: ${v}` : v)).filter(Boolean);
      saida.push(...quebrar(`- ${partes.join('; ')}`, COLUNAS, '  '));
    }
    saida.push('');
    tabela = null;
  };

  const fechar = () => { despejarBloco(); despejarTabela(); };

  for (const bruta of linhas) {
    const linha = bruta.replace(/\s+$/, '');

    // Tabela
    if (/^\s*\|.*\|\s*$/.test(linha)) {
      despejarBloco();
      const c = celulas(linha.trim());
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) continue;   // a linha |---|
      if (!tabela) tabela = [c]; else tabela.push(c);
      continue;
    }
    despejarTabela();

    if (!linha.trim()) { despejarBloco(); saida.push(''); continue; }

    // Regua horizontal
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      fechar();
      saida.push('', '-'.repeat(COLUNAS), '');
      continue;
    }

    // Titulos: nivel 1 em caixa alta e sublinhado; os demais em caixa alta.
    const t = linha.match(/^(#{1,6})\s+(.*)$/);
    if (t) {
      fechar();
      const texto = limparInline(t[2]);
      saida.push('');
      saida.push(texto.toUpperCase());
      if (t[1].length === 1) saida.push('='.repeat(Math.min(COLUNAS, texto.length)));
      saida.push('');
      continue;
    }

    // Inicio de item de lista
    const item = linha.match(/^(\s*)([-*+]|\w{1,2}[.)])\s+(.*)$/);
    if (item) {
      despejarBloco();
      const marca = /^[-*+]$/.test(item[2]) ? '-' : item[2];
      bloco = { tipo: 'li', partes: [item[3]], marca, recuo: ' '.repeat(marca.length + 1) };
      continue;
    }

    // Continuacao: do item de lista ou do paragrafo corrente.
    if (bloco) bloco.partes.push(linha.trim());
    else bloco = { tipo: 'p', partes: [linha.trim()] };
  }
  fechar();

  // Colapsa linhas em branco repetidas, que a conversao gera de sobra.
  const limpo = [];
  for (const l of saida) {
    if (!l.trim() && !limpo.length) continue;
    if (!l.trim() && !limpo[limpo.length - 1].trim()) continue;
    limpo.push(l);
  }
  return limpo.join('\n').trimEnd();
}

/**
 * A parte do arquivo que vem DEPOIS da base, ou seja, o anexo do produto.
 *
 * Os arquivos de produto são "base + anexo", e o anexo começa no primeiro
 * título de nível 1 que diz "Anexo". Procurar pelo título, e não contar linhas,
 * é o que faz isto continuar certo quando a base ganhar um parágrafo.
 */
function extrairAnexo(conteudo, rotulo) {
  const i = conteudo.search(/^#\s+Anexo\b/mi);
  if (i < 0) throw new Error(`nao achei o anexo em ${rotulo}: falta um titulo "# Anexo"`);
  return conteudo.slice(i);
}

module.exports = async function genInstallerLicense() {
  const root = path.join(__dirname, '..');
  const ler = (f) => fs.readFileSync(path.join(root, f), 'utf8');

  const base = ler('LICENSE-BASE.md');
  const anexoAurora = extrairAnexo(ler('LICENSE'), 'LICENSE');
  const anexoSapho = extrairAnexo(ler('LICENSE-SAPHO.md'), 'LICENSE-SAPHO.md');

  const separador = `\n\n${'='.repeat(COLUNAS)}\n\n`;
  const corpo = [
    paraTextoPuro(base),
    paraTextoPuro(anexoAurora),
    paraTextoPuro(anexoSapho),
  ].join(separador);

  const out = '﻿' + corpo + '\n';
  const dest = path.join(root, 'build', 'license.txt');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out, 'utf8');
  console.log(`  • licence page: wrote ${path.relative(root, dest)} `
    + `(base + anexo AURORA + anexo SAPHO, texto puro, ${out.length} chars)`);
};

// Exportado para teste: a conversão é a parte que pode quebrar em silêncio.
module.exports.paraTextoPuro = paraTextoPuro;
module.exports.extrairAnexo = extrairAnexo;
