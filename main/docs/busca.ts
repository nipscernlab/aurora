/**
 * busca.ts: procurar dentro do manual do SAPHO, sem rede e sem inchar prompt.
 *
 * POR QUE EXISTE
 * --------------
 * O manual é a resposta certa para boa parte do que um aluno pergunta à Aurora
 * Intelligence, e até agora ela não sabia que ele existia. Despejar o manual no
 * prompt não é opção: são 1,2 MB de texto, mais do que a janela de contexto de
 * vários modelos e caro em todos eles. O caminho é o mesmo que uma pessoa usa,
 * procurar e ler só a página que interessa.
 *
 * POR QUE NÃO O ÍNDICE DO SPHINX
 * ------------------------------
 * O manual traz um `searchindex.js` pronto. Ele é um formato próprio, com os
 * termos já passados por um stemmer de português, e usá-lo significaria
 * reimplementar aquele stemmer aqui para que a consulta casasse com o índice.
 * Indexar os 37 arquivos direto custa alguns milissegundos, acontece uma vez
 * por sessão e não depende de detalhe interno de outro projeto.
 *
 * ACENTO NÃO PODE ATRAPALHAR
 * --------------------------
 * O manual é em português e quem digita numa conversa raramente acentua. Uma
 * busca por "notacao de dirac" tem que achar "notação de Dirac", senão a
 * ferramenta parece quebrada justamente para quem mais precisa dela. Consulta e
 * texto são comparados sem acento e sem maiúscula.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Quantos caracteres de cada página o `ler` devolve por padrão. */
const LIMITE_LEITURA = 12000;

/** As entidades que o textoDe desfaz, além das numéricas. */
const ENTIDADES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

/** Tamanho do trecho que acompanha cada resultado de busca. */
const TRECHO = 320;

/** dir -> { carimbo, paginas } */
const cache = new Map();

/**
 * Sem acento, sem maiúscula, para comparar consulta com texto.
 */
function normalizar(texto: unknown) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * O texto legível de uma página, sem marcação.
 *
 * A ordem importa: script e style saem INTEIROS antes de qualquer coisa, senão
 * o corpo deles viraria texto e a busca acharia palavra dentro de código de
 * navegação. Depois caem as tags, e por último as entidades mais comuns, numa
 * passada só: em passadas seguidas, o `&amp;lt;` escrito no manual virava `&lt;`
 * e logo `<`, um nível de escape a menos do que a página mostra (#276).
 */
function textoDe(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#\d+);/g, (_: string, e: string) =>
      (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENTIDADES[e]))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O título da página: o `<title>` sem o sufixo do tema, ou o primeiro `<h1>`.
 */
function tituloDe(html: string) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t) {
    // O tema separa o titulo do sufixo com hifen simples ("Dirac - SAPHO &
    // AURORA 6.4.2, Manual de uso"). Sem tirar isso, todo resultado da busca
    // carrega o mesmo rabo de 30 caracteres e a lista fica ilegivel.
    const limpo = textoDe(t[1]).replace(/\s*[-–—|]\s*(SAPHO|AURORA)\b.*$/i, '').trim();
    if (limpo) return limpo;
  }
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h ? textoDe(h[1]).replace(/¶$/, '').trim() : '';
}

/**
 * Todos os .html do manual, em caminho relativo, com barra normal.
 */
function listarPaginas(dir: string): string[] {
  const achados: string[] = [];
  const andar = (atual: string, prefixo: string) => {
    let entradas = [];
    try { entradas = fs.readdirSync(atual, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entradas) {
      // `_static`, `_images` e `_sources` sao apoio do tema e do build, nao
      // conteudo: indexa-los encheria a busca de resultado sem texto util.
      if (e.name.startsWith('_')) continue;
      const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
      if (e.isDirectory()) andar(path.join(atual, e.name), rel);
      else if (e.name.endsWith('.html')) achados.push(rel);
    }
  };
  andar(dir, '');
  return achados;
}

/**
 * O índice da pasta, construído uma vez e reaproveitado.
 *
 * A validade é o `mtime` do `index.html`, que a atualização do manual reescreve.
 * Assim o índice se refaz sozinho quando a documentação é atualizada com o
 * aplicativo aberto, que é exatamente quando um cache velho enganaria.
 */
function indexar(dir: string) {
  let carimbo = 0;
  try { carimbo = fs.statSync(path.join(dir, 'index.html')).mtimeMs; }
  catch (_) { return []; }

  const guardado = cache.get(dir);
  if (guardado && guardado.carimbo === carimbo) return guardado.paginas;

  const paginas = [];
  for (const rel of listarPaginas(dir)) {
    let html = '';
    try { html = fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'); }
    catch (_) { continue; }
    const texto = textoDe(html);
    if (!texto) continue;
    paginas.push({
      caminho: rel,
      titulo: tituloDe(html) || rel,
      texto,
      tituloNorm: normalizar(tituloDe(html) || rel),
      textoNorm: normalizar(texto),
    });
  }
  cache.set(dir, { carimbo, paginas });
  return paginas;
}

/**
 * Um trecho em volta da primeira ocorrência, para o resultado ter contexto.
 */
function trechoEmVolta(texto: string, textoNorm: string, alvo: string) {
  const i = textoNorm.indexOf(alvo);
  if (i < 0) return texto.slice(0, TRECHO).trim();
  const inicio = Math.max(0, i - Math.floor(TRECHO / 3));
  const bruto = texto.slice(inicio, inicio + TRECHO).trim();
  return (inicio > 0 ? '...' : '') + bruto + (inicio + TRECHO < texto.length ? '...' : '');
}

/**
 * Procura no manual.
 *
 * A pontuação é deliberadamente simples e explicável: cada termo da consulta
 * vale muito no título e pouco no corpo, e o corpo conta ocorrências até um
 * teto, para uma página longa não vencer só por ser longa. Nada de relevância
 * estatística: com 37 páginas isso seria complexidade sem ganho.
 *
 * @param dir pasta do manual
 */
function buscar(dir: string, consulta: string, opcoes: { limite?: number; } = {}) {
  const limite = Number.isFinite(opcoes.limite) ? Math.max(1, Number(opcoes.limite)) : 5;
  const termos = normalizar(consulta).split(/\s+/).filter((t) => t.length >= 2);
  if (!termos.length) return [];

  const resultados = [];
  for (const p of indexar(dir)) {
    let pontos = 0;
    let achouTodos = true;
    for (const termo of termos) {
      const noTitulo = p.tituloNorm.includes(termo);
      const ocorrencias = p.textoNorm.split(termo).length - 1;
      if (!noTitulo && ocorrencias === 0) { achouTodos = false; break; }
      if (noTitulo) pontos += 10;
      pontos += Math.min(ocorrencias, 8);
    }
    // Exige TODOS os termos. Uma busca por "dirac verilator" que devolvesse
    // paginas so de Dirac faria o modelo responder ao lado da pergunta.
    if (!achouTodos) continue;
    resultados.push({
      caminho: p.caminho,
      titulo: p.titulo,
      pontos,
      trecho: trechoEmVolta(p.texto, p.textoNorm, termos[0]),
    });
  }

  resultados.sort((a, b) => b.pontos - a.pontos || a.caminho.localeCompare(b.caminho));
  return resultados.slice(0, limite);
}

/**
 * O texto de uma página do manual.
 *
 * O caminho vem do modelo, então é validado como caminho e não como texto: ele
 * precisa terminar em `.html` e, já resolvido, continuar dentro da pasta do
 * manual. Sem isso, um `../../` transformaria a ferramenta de leitura do manual
 * numa ferramenta de leitura do disco.
 *
 */
function ler(dir: string, caminhoRelativo: string, opcoes: { limite?: number; } = {}): { ok: true; caminho: string; titulo: string; texto: string; truncado: boolean; }|{ ok: false; erro: string; } {
  const pedido = String(caminhoRelativo || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!pedido || !pedido.toLowerCase().endsWith('.html')) {
    return { ok: false, erro: 'o caminho precisa ser uma página .html do manual' };
  }
  const raiz = path.resolve(dir);
  const alvo = path.resolve(raiz, ...pedido.split('/'));
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) {
    return { ok: false, erro: 'caminho fora do manual' };
  }

  let html = '';
  try { html = fs.readFileSync(alvo, 'utf8'); }
  catch (_) { return { ok: false, erro: `página não encontrada: ${pedido}` }; }

  const texto = textoDe(html);
  const limite = Number.isFinite(opcoes.limite) ? Number(opcoes.limite) : LIMITE_LEITURA;
  return {
    ok: true,
    caminho: pedido,
    titulo: tituloDe(html) || pedido,
    texto: texto.length > limite ? `${texto.slice(0, limite)}...` : texto,
    truncado: texto.length > limite,
  };
}

/**
 * Quantas páginas o manual tem, para o diagnóstico do painel.
 */
function contar(dir: string) {
  return indexar(dir).length;
}

/** Esquece o índice. Usado pelo teste e depois de uma atualização do manual. */
function limparCache() {
  cache.clear();
}

export { buscar, ler, contar, indexar, limparCache, normalizar };
