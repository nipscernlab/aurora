/**
 * Tipos de monaco_editor.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * monaco_editor.js virar .ts.
 */

import type * as Monaco from 'monaco-editor';

export const EditorManager: {
  /** O editor em foco, se houver um. */
  activeEditor?: Monaco.editor.IStandaloneCodeEditor | null;
  /** O editor que mostra `filePath`, se houver um aberto. */
  getEditorForFile?(filePath: string): Monaco.editor.IStandaloneCodeEditor | null | undefined;
};

export function initMonaco(...args: unknown[]): unknown;
