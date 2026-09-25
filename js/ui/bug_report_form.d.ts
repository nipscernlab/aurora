/**
 * Tipos de bug_report_form.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * bug_report_form.js virar .ts.
 */

/**
 * O formulario de relato: reune o diagnostico, pergunta, envia. `porEmail` e
 * a reserva, que abre o webmail com o mesmo texto e o diagnostico do main.
 */
export function abrirFormulario(
  porEmail: (texto: Record<string, unknown>, diag: Record<string, unknown> | null) => Promise<void>,
): Promise<void>;
