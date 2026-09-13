// @ts-check
/**
 * tool_args.js: os argumentos de uma chamada de ferramenta valem contra o
 * esquema que a propria ferramenta publica?
 *
 * ONDE ISTO ENTRA. O caminho normal nao precisa disto: quando o modelo usa o
 * campo nativo de tool-call, o SDK valida os argumentos contra o `inputSchema`
 * antes de executar. O que nao passa por essa validacao e o RESGATE de
 * chat.js: alguns modelos hospedados no Ollama escrevem a chamada como JSON no
 * meio do texto em vez de usar o campo, e a AURORA extrai esse JSON com uma
 * expressao regular para nao perder o turno. O que sai dali ia direto para o
 * tool_bridge, com um `JSON.parse` num try/catch que descartava CALADO o que
 * nao fosse JSON valido.
 *
 * Dois buracos nisso. O primeiro e o silencio: a chamada sumia e a pessoa via
 * o modelo "nao fazer nada", sem nenhuma pista. O segundo e pior: JSON valido
 * nao quer dizer argumento valido. `{"filePath": 42}` faz o parse passar e
 * chega no tool_bridge como caminho de arquivo numerico.
 *
 * O QUE ESTE VALIDADOR COBRE, e por que so isso. O subconjunto de JSON Schema
 * que o manifesto de ferramentas realmente usa: `type` (string, number,
 * integer, boolean, array, object), `required`, `properties` e `enum`. Nao ha
 * `$ref`, `oneOf` nem `allOf` no manifesto, e escrever suporte para o que
 * ninguem usa seria codigo sem teste de verdade. Se um dia aparecer, o esquema
 * passa direto (nao reprova por desconhecimento): recusar por nao entender
 * seria pior do que deixar o SDK ou a propria ferramenta reclamarem.
 *
 * Puro, sem dependencia: ajv resolveria, mas por um subconjunto deste tamanho
 * nao vale outra arvore de dependencia num aplicativo que ja empacota 158 MB.
 */

'use strict';

/** O tipo JSON de um valor, no vocabulario do esquema. */
function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

/**
 * O valor serve para o tipo pedido?
 * `integer` aceita inteiro; `number` aceita qualquer numero, inteiro incluso.
 */
function tipoServe(valor, esperado) {
  if (!esperado) return true;
  const tipos = Array.isArray(esperado) ? esperado : [esperado];
  const meu = tipoDe(valor);
  return tipos.some((t) => {
    if (t === 'number') return meu === 'number' || meu === 'integer';
    if (t === 'integer') return meu === 'integer';
    if (t === 'object') return meu === 'object' && valor !== null;
    return meu === t;
  });
}

/**
 * Valida `args` contra `schema`. Devolve os problemas, vazio quando passa.
 *
 * Nao lanca e nao conserta: quem chama decide o que fazer. Um esquema ausente
 * ou de forma inesperada nao reprova nada, porque a duvida aqui e nossa e nao
 * de quem chamou.
 *
 * @param {any} args
 * @param {any} schema um JSON Schema do manifesto de ferramentas
 * @returns {string[]} os motivos, legiveis, em ordem de campo
 */
function validar(args, schema) {
  if (!schema || typeof schema !== 'object') return [];
  const problemas = [];

  if (schema.type && !tipoServe(args, schema.type)) {
    return [`esperava ${Array.isArray(schema.type) ? schema.type.join(' ou ') : schema.type}, veio ${tipoDe(args)}`];
  }
  if (tipoDe(args) !== 'object' || args === null) return problemas;

  for (const campo of (Array.isArray(schema.required) ? schema.required : [])) {
    if (args[campo] === undefined) problemas.push(`falta \`${campo}\``);
  }

  const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : {};
  for (const [campo, regra] of Object.entries(props)) {
    const valor = args[campo];
    if (valor === undefined) continue;      // ausencia so importa se for required
    const r = /** @type {any} */ (regra);
    if (!tipoServe(valor, r.type)) {
      problemas.push(`\`${campo}\` devia ser ${Array.isArray(r.type) ? r.type.join(' ou ') : r.type}, veio ${tipoDe(valor)}`);
      continue;
    }
    if (Array.isArray(r.enum) && !r.enum.includes(valor)) {
      problemas.push(`\`${campo}\` devia ser um de ${r.enum.join(', ')}, veio ${JSON.stringify(valor)}`);
    }
  }
  return problemas;
}

/**
 * A frase que vai para o terminal quando uma chamada extraida do texto e
 * recusada. Uma linha, com o nome da ferramenta e o motivo: o que a pessoa
 * precisa para entender por que o modelo pareceu nao fazer nada.
 *
 * @param {string} ferramenta
 * @param {string[]} problemas
 */
function motivoLegivel(ferramenta, problemas) {
  const lista = (problemas || []).join('; ');
  return `A IA pediu \`${ferramenta}\` com argumentos invalidos, entao a chamada nao foi executada: ${lista}.`;
}

module.exports = { validar, motivoLegivel, tipoDe };
