/**
 * Tipos de file_tree_manager.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * file_tree_manager.js virar .ts.
 */

export const fileTreeManager: {
  /** O vigia de pastas do projeto aberto, quando ja existe. */
  readonly watcher?: { startWatching?(path: string | null): unknown } | null;
};

export const TreeViewState: Record<string, unknown>;
