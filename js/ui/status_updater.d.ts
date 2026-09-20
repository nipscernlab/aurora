/**
 * Tipos de status_updater.js, para os modulos .ts dirigirem a barra de status
 * sem o tsc reclamar de modulo sem declaracao. Mesma razao do
 * electron_api.d.ts ao lado do electron_api.js.
 *
 * Declaracao PARCIAL: so os tres metodos que os passos de compilacao ja
 * migrados chamam. Acrescente aqui o proximo que um .ts precisar, e apague o
 * arquivo quando o status_updater.js virar .ts.
 */

export interface StatusUpdater {
  /** `type` e o id do passo ('cmm', 'asm', ...), o mesmo do CommandSpec. */
  startCompilation(type: string): void;
  compilationSuccess(type: string): void;
  compilationError(type: string, errorMsg?: string): void;
}

export const statusUpdater: StatusUpdater;
