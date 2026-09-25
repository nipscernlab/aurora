/**
 * Tipos de compilation_flow.js, para os modulos .ts que ja o importam sem o
 * tsc reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * compilation_flow.js virar .ts.
 */

import type { ResumoDeExecucao } from './run_history.js';

/** As execucoes em andamento nesta janela, mais recente primeiro. */
export function execucoesAbertas(agora?: number): Array<ResumoDeExecucao | null>;
