/**
 * Tipos de notification.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * notification.js virar .ts.
 */

/** O cartao de aviso no canto. `type`: info, success, warning ou error. */
export function showCardNotification(
  message: string,
  type?: string,
  duration?: number,
  title?: string,
  options?: Record<string, unknown>,
): unknown;
