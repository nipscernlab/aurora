/**
 * Tipos de terminal.js, para os modulos .ts que o importam sem o tsc reclamar
 * de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * terminal.js virar .ts.
 */

/** Traz para a frente a aba do terminal `targetId` (ex.: 'terminal-tcmm'). */
export function switchTerminal(targetId: string): void;
