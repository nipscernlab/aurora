/**
 * Tipos de rewind.js, para os modulos .ts que o importam sem o tsc reclamar de
 * modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * rewind.js virar .ts.
 */

/** Abre um ponto de retorno. Melhor esforco: falha vira null, sem lancar. */
export function marcarPonto(meta?: Record<string, unknown>): Promise<unknown>;
