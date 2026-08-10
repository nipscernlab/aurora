// @ts-check
/**
 * docs_nav.js — a fronteira da janela do manual.
 *
 * Isto saiu de dentro do `docs_window.js` porque é a única decisão de segurança
 * daquele arquivo e é inteiramente pura: dada a pasta do manual e uma URL para
 * onde a página quer ir, seguir, abrir no navegador do sistema, ou barrar.
 *
 * POR QUE A DECISÃO EXISTE
 *
 * A janela do manual hospeda um `WebContentsView` que carrega HTML de disco. Sem
 * fronteira, um link dentro do manual levaria esse view para qualquer lugar, e a
 * janela viraria um navegador irrestrito embutido no aplicativo — com a barra da
 * AURORA em volta, o que é pior do que um navegador, porque parece nosso.
 *
 * TRÊS DESFECHOS, E CADA UM POR UM MOTIVO
 *
 *   'seguir'   — `file:` dentro da pasta do manual. É navegação interna.
 *   'externa'  — `http:` ou `https:`. Link externo é assunto do navegador do
 *                sistema, que tem abas, histórico e sandbox de verdade.
 *   'bloquear' — todo o resto, em silêncio. Aqui moram `file:` fora da pasta,
 *                que é a tentativa de escapar, e esquemas como `javascript:` e
 *                `data:`, que não têm por que existir num manual.
 *
 * A lista de permitidos é fechada de propósito: qualquer esquema novo cai no
 * bloqueio, em vez de passar por não ter sido previsto.
 */

'use strict';

const path = require('path');

/**
 * O caminho está dentro da raiz? Compara já resolvido, para `..` não escapar,
 * e trata a própria raiz como dentro.
 *
 * Em Windows, quando os dois estão em volumes diferentes, `path.relative`
 * devolve um caminho absoluto (`D:\x`), e é por isso que a checagem de absoluto
 * não é redundante com a de `..`.
 *
 * @param {string} raiz
 * @param {string} alvo
 */
function dentroDaRaiz(raiz, alvo) {
  if (!raiz || !alvo) return false;
  const rel = path.relative(path.resolve(raiz), path.resolve(alvo));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Caminho de sistema de arquivos de uma URL `file:`, ou '' se não for uma.
 *
 * O `pathname` de `file:///C:/docs/index.html` é `/C:/docs/index.html`, com a
 * barra da frente que o Windows não usa; e vem percent-encoded, então uma pasta
 * com acento ou espaço chega como `%C3%A7` e `%20`. Os dois tratamentos são
 * necessários, e a decodificação vem ANTES da comparação de contenção de
 * propósito: `%2e%2e` decodificado vira `..`, e um `..` que não fosse decodificado
 * passaria pela checagem sem ser normalizado.
 *
 * @param {string} url
 * @returns {string}
 */
function caminhoDeUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return ''; }
  if (u.protocol !== 'file:') return '';
  let p;
  try { p = decodeURIComponent(u.pathname); } catch (_) { return ''; }
  // `/C:/x` -> `C:/x`. Só quando o que vem depois é uma letra de unidade: em
  // POSIX o caminho começa com barra de verdade e tirá-la o tornaria relativo.
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

/**
 * O que fazer com uma navegação pedida pela página do manual.
 *
 * @param {string} raiz pasta do manual, já resolvida
 * @param {string} url
 * @returns {{acao: 'seguir'|'externa'|'bloquear', destino: string}}
 */
function decidirNavegacao(raiz, url) {
  const texto = String(url || '');
  const arquivo = caminhoDeUrl(texto);
  if (arquivo) {
    return dentroDaRaiz(raiz, arquivo)
      ? { acao: 'seguir', destino: arquivo }
      : { acao: 'bloquear', destino: arquivo };
  }
  if (/^https?:$/i.test(protocoloDe(texto))) return { acao: 'externa', destino: texto };
  return { acao: 'bloquear', destino: texto };
}

/** Protocolo da URL, ou '' quando ela não é analisável. */
function protocoloDe(url) {
  try { return new URL(String(url)).protocol; } catch (_) { return ''; }
}

module.exports = { dentroDaRaiz, caminhoDeUrl, decidirNavegacao };
