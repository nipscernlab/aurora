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
  getEditorForFile(filePath: string): Monaco.editor.IStandaloneCodeEditor | null | undefined;
  /** Fecha e descarta o editor do arquivo. */
  closeEditor(filePath: string): void;
  /** Resolve quando o Monaco e o EditorManager terminaram de subir. */
  ready: Promise<unknown>;
  /** Cria (ou devolve, se ja existe) o editor do arquivo; nulo se o container nao existe. */
  createEditorInstance(filePath: string, initialContent?: string): Monaco.editor.IStandaloneCodeEditor | null;
  /** Mostra o editor do arquivo no painel principal. */
  setActiveEditor(filePath: string): void;
};

export function initMonaco(...args: unknown[]): unknown;
