// @ts-check
/**
 * effort_policy.js: quanto raciocinio cada operacao pede.
 *
 * ATE AQUI ERA UM VALOR SO. A Aurora Intelligence usava o mesmo esforco para
 * tudo, vindo de um controle na interface. Diagnosticar um erro de compilacao e
 * comentar um trecho de codigo nao pedem o mesmo, e pagar o maior dos dois em
 * toda chamada e latencia jogada fora numa ferramenta em que quem paga a conta
 * e quem usa.
 *
 * A REGRA DE DECISAO E O RACIOCINIO QUE A TAREFA EXIGE, e nao o cache.
 *
 * Isto e deliberado, e foi a escolha do Chrysthofer entre duas saidas. Cada
 * valor distinto de esforco cria uma LINHAGEM DE CACHE separada: o prefixo de
 * 10,4 mil tokens do system prompt e aquecido uma vez por valor em uso. Como o
 * cache dura 5 minutos por padrao, escrever custa 1,25x a entrada e ler custa
 * 0,1x, uma operacao rara quase nunca acha o prefixo quente: paga a escrita
 * toda vez e nunca colhe a leitura, ficando 25% mais cara do que seria sem
 * cache nenhum. "Comentar codigo" e o caso suspeito: ninguem pede isso duas
 * vezes em cinco minutos.
 *
 * A saida escolhida nao foi comprar TTL de uma hora para todas as linhagens, e
 * sim justificar cada linha pelo raciocinio: `low` em comentar existe para a
 * resposta vir rapida, `high` em achar erro existe porque muda o resultado. Se
 * o cache vier junto, melhor; se nao vier, a decisao continua certa. A medicao
 * mede as duas coisas SEPARADAS, senao uma esconde a outra.
 *
 * POR ISSO ISTO NASCEU JUNTO COM A SEPARACAO DO CACHE (prompt_cache.js), e nao
 * depois: esforco distinto cria linhagem distinta, entao medir o cache antes de
 * fixar esta politica mediria uma coisa que ia deixar de existir.
 *
 * TRES VALORES, E SO TRES. Cada valor a mais e mais um prefixo a aquecer. O
 * turno livre, que e o caminho dominante, fica no valor unico da interface,
 * para o prefixo quente continuar quente; as operacoes tipadas sao desvios
 * pontuais.
 */

'use strict';

/**
 * A politica, operacao por operacao. O comentario de cada linha e o motivo
 * PELA TAREFA; se um dia ele nao se sustentar, a linha esta errada.
 *
 * `null` significa "nao ha intencao conhecida aqui": vale o que a pessoa
 * escolheu na interface.
 *
 * @type {Record<string, {esforco: 'low'|'medium'|'high'|null, porque: string}>}
 */
const POLITICA = {
  // Transformacao local e determinista: ler o trecho e descrever o que ele faz.
  // Nao ha espaco de busca nem decisao a tomar, entao raciocinio extra so custa
  // o tempo que a pessoa passa esperando.
  comentar: {
    esforco: 'low',
    porque: 'transformacao local, sem espaco de busca; o que importa e a resposta vir rapida',
  },

  // Exige simular a execucao de cabeca, considerar caso de borda e comparar
  // hipoteses. E o caso em que raciocinio muda o RESULTADO, e nao so o tempo.
  acharErros: {
    esforco: 'high',
    porque: 'exige simular execucao e comparar hipoteses; raciocinio muda o resultado',
  },

  // Compilou. A continuacao e resumir o que saiu e seguir: o dado esta pronto e
  // nao ha causa a inferir.
  posCompilacaoOk: {
    esforco: 'low',
    porque: 'resumir uma saida que ja veio pronta; nao ha causa a inferir',
  },

  // Falhou, e este e o caso dificil do SAPHO. Inferir a causa de um erro do C+-
  // nao se deduz da mensagem: a linguagem tem restricoes que NAO estao na
  // documentacao. A portacao de uma CNN para o SAPHO gastou a maior parte do
  // esforco exatamente nisso. O identificador `i` e reservado, por ser a
  // unidade imaginaria da linguagem; array nao pode ser parametro de funcao;
  // array global nao aceita inicializacao direta; e o editor convertia `>=`
  // em silencio. Nenhuma dessas aparece no texto do erro.
  posCompilacaoFalha: {
    esforco: 'high',
    porque: 'a causa de um erro do C+- nao esta na mensagem; as restricoes da linguagem nao estao documentadas',
  },

  // A mensagem que a pessoa escreveu. A intencao nao e conhecida antes de o
  // modelo ler, e adivinhar erraria nos dois sentidos. Fica no valor da
  // interface, que e tambem o que mantem o prefixo dominante quente.
  livre: {
    esforco: null,
    porque: 'intencao desconhecida antes da leitura; e o caminho dominante, que mantem o prefixo quente',
  },
};

/**
 * O esforco para uma operacao, com queda para o valor da interface.
 *
 * Operacao desconhecida cai no valor da interface, e nao num padrao nosso:
 * inventar esforco para algo que ninguem classificou seria decidir por quem
 * paga a conta sem ter motivo.
 *
 * @param {string|null|undefined} operacao
 * @param {string|null|undefined} daInterface o esforco escolhido pela pessoa
 * @returns {string|null} o esforco a enviar, ou null para nao enviar nenhum
 */
function esforcoPara(operacao, daInterface) {
  const linha = operacao ? POLITICA[operacao] : null;
  if (linha && linha.esforco) return linha.esforco;
  return daInterface || null;
}

/** O motivo de uma operacao, para log e para teste. */
function porqueDe(operacao) {
  const linha = operacao ? POLITICA[operacao] : null;
  return linha ? linha.porque : null;
}

/**
 * Quantas linhagens de cache distintas esta politica cria, dado o valor da
 * interface. E o numero de prefixos de ~10,4 mil tokens a aquecer, e a razao de
 * a tabela ter tres valores e nao cinco.
 * @param {string|null|undefined} daInterface
 */
function linhagensDeCache(daInterface) {
  const valores = new Set();
  for (const k of Object.keys(POLITICA)) valores.add(esforcoPara(k, daInterface) || '(nenhum)');
  return valores.size;
}

module.exports = { POLITICA, esforcoPara, porqueDe, linhagensDeCache };
