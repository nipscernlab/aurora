/**
 * Tipos de shared_models.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * shared_models.js virar .ts.
 */

import type * as Monaco from 'monaco-editor';

export const SharedModelRegistry: {
  /** O modelo do Monaco aberto para este arquivo, em qualquer painel, ou null. */
  getModel(filePath: string): Monaco.editor.ITextModel | null;
};
