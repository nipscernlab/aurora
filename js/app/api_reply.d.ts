/**
 * Tipos de api_reply.js, para os modulos .ts lerem o motivo de uma resposta
 * que falhou sem o tsc reclamar de modulo sem declaracao. Mesma razao do
 * electron_api.d.ts ao lado do electron_api.js.
 *
 * Declaracao PARCIAL: so o `motivoDe`, que e o que os .ts ja migrados usam.
 * Apague este arquivo quando o api_reply.js virar .ts.
 */

/**
 * O motivo de `res` ter falhado, em texto. Quando a resposta nao traz motivo
 * nenhum, devolve `padrao` acrescido de um retrato do que chegou, porque um
 * "Falhou." seco e uma resposta incompleta disfarcada de tratada.
 */
export function motivoDe(res: unknown, padrao: string): string;
