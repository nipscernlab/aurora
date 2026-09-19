// @ts-check
/**
 * citar.js: o modelo aponta, e NOS conferimos contra o arquivo.
 *
 * POR QUE ISTO EXISTE. A citacao nativa da Anthropic e melhor do que isto: ela
 * e automatica, nao custa token de saida, e o recorte vem da API. So que ela
 * exige montar o corpo do pedido, e no caminho de assinatura quem monta o
 * pedido e a CLI do Claude Code, nao a AURORA. Resultado: a funcionalidade
 * existia so para quem traz chave de API, que e a minoria de quem usa a IDE.
 *
 * Ferramenta, por outro lado, funciona nos tres runners: a API recebe pelo
 * campo `tools`, e as CLIs recebem pelo servidor MCP (main/ai/aurora_mcp_server.js).
 * Entao a citacao passa a ser uma FERRAMENTA, e a verificacao acontece aqui,
 * no nosso processo, contra o arquivo em disco.
 *
 * O QUE ISTO NAO E. Nao e o modelo afirmando de onde tirou. Ele manda um
 * LOCALIZADOR, e este codigo procura esse localizador na pagina: se nao estiver
 * la, a citacao e RECUSADA e o modelo fica sabendo. O que aparece na tela e
 * sempre o texto do arquivo, nunca o que o modelo digitou.
 *
 * POR QUE LOCALIZADOR, E NAO A FRASE INTEIRA. Porque o modelo digitar a frase
 * inteira e saida paga, e foi exatamente o que se tirou do prompt quando as
 * citacoes nativas entraram. Com um localizador de meia duzia de palavras, ele
 * paga um endereco curto e nos expandimos ate o fim da frase lendo o arquivo.
 * A verificacao continua sendo real: o endereco tem de existir.
 *
 * O LOCALIZADOR TAMBEM ABSORVE A DOC MUDANDO. O manual se atualiza sozinho por
 * manifesto, sem esperar release da AURORA. Quanto mais longo o texto exigido,
 * maior a chance de uma palavra ter mudado e derrubar o casamento inteiro; um
 * prefixo curto sobrevive a edicao no meio e no fim da frase.
 *
 * Puro: recebe o texto da pagina, nao le disco. Quem le e o docs.js.
 */

'use strict';

/**
 * Espacos colapsados, pontas aparadas. A mesma dos dois lados da comparacao.
 * @param {unknown} texto
 */
function normalizar(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim();
}

/**
 * Minimo do localizador. Abaixo disto ele casaria em varios pontos da pagina, e
 * citar o primeiro deles seria pior do que nao citar.
 */
const MIN_LOCALIZADOR = 12;

/** Teto do que se aceita como localizador: passando disto e a frase inteira. */
const MAX_LOCALIZADOR = 200;

/** Teto do trecho devolvido, para uma frase quilometrica nao virar paragrafo. */
const MAX_TRECHO = 400;

/**
 * Onde a frase termina, a partir de uma posicao.
 *
 * Ponto final, interrogacao, exclamacao ou dois-pontos fecham. Ponto seguido de
 * minuscula NAO fecha, porque no manual isso e quase sempre abreviacao ou um
 * nome de arquivo (`main.js`, `tb_dirac.v`), e cortar ali entregaria meia frase.
 *
 * @param {string} texto ja normalizado
 * @param {number} de
 */
function fimDaFrase(texto, de) {
  const limite = Math.min(texto.length, de + MAX_TRECHO);
  for (let i = de; i < limite; i++) {
    if (!'.?!:'.includes(texto[i])) continue;
    const seguinte = texto[i + 1];
    if (seguinte === undefined) return i + 1;
    if (seguinte !== ' ') continue;               // `main.js`, `1.5`
    const depois = texto[i + 2];
    if (depois && depois === depois.toLowerCase() && depois !== depois.toUpperCase()) {
      continue;                                    // ". e por isso" segue a frase
    }
    return i + 1;
  }
  return limite;
}

/**
 * Confere o localizador contra o texto da pagina e devolve o trecho inteiro.
 *
 * @param {string} textoDaPagina o texto ja extraido (main/docs/busca.js)
 * @param {string} localizador o comeco da frase, como o modelo mandou
 * @returns {{ok: true, trecho: string} | {ok: false, erro: string}}
 */
function conferir(textoDaPagina, localizador) {
  const alvo = normalizar(localizador);
  if (alvo.length < MIN_LOCALIZADOR) {
    return {
      ok: false,
      erro: `o localizador tem ${alvo.length} caracteres e precisa de pelo menos ${MIN_LOCALIZADOR}: `
        + 'mande as primeiras palavras da frase, nao uma ou duas',
    };
  }
  if (alvo.length > MAX_LOCALIZADOR) {
    return {
      ok: false,
      erro: `o localizador tem ${alvo.length} caracteres e o teto e ${MAX_LOCALIZADOR}: `
        + 'mande so o comeco da frase, o resto e lido do arquivo',
    };
  }

  const texto = normalizar(textoDaPagina);
  const em = texto.indexOf(alvo);
  if (em < 0) {
    return {
      ok: false,
      erro: 'este texto nao existe nesta pagina do manual. Nao reescreva o localizador '
        + 'de memoria: releia a pagina com read_manual_page e copie o comeco da frase '
        + 'exatamente como ela aparece la',
    };
  }
  // Duas ocorrencias querem dizer que o localizador nao identifica lugar nenhum.
  if (texto.indexOf(alvo, em + 1) >= 0) {
    return {
      ok: false,
      erro: 'este texto aparece mais de uma vez na pagina, entao ele nao diz QUAL '
        + 'trecho sustenta a afirmacao. Mande algumas palavras a mais',
    };
  }

  return { ok: true, trecho: texto.slice(em, fimDaFrase(texto, em)).trim() };
}

module.exports = { conferir, normalizar, fimDaFrase, MIN_LOCALIZADOR, MAX_LOCALIZADOR, MAX_TRECHO };
