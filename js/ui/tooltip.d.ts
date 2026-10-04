/**
 * Tipos de tooltip.js, para os modulos .ts que o importam sem o tsc reclamar
 * de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam
 * (js/api/settings_ns.ts). Acrescente o proximo quando ele for preciso, e
 * apague o arquivo quando o tooltip.js virar .ts.
 */

/** Liga ou desliga as dicas de toda a interface, na hora. */
export function setTooltipsEnabled(enabled: boolean): void;
