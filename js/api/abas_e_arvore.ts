/**
 * abas_e_arvore.ts: o que os namespaces da API pedem ao editor e a arvore de
 * arquivos quando mexem no disco.
 *
 * Moravam soltas no js/api/aurora_api.js e eram chamadas de varios
 * namespaces; saem para ca para que as partes do `project` que viram modulo
 * nao precisem voltar ao aurora_api.js para acha-las.
 *
 * Compilado por `tsc` (npm run build:ts) num abas_e_arvore.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';

/** Repinta a arvore de arquivos. Melhor esforco: uma falha aqui nao e erro. */
export async function atualizarArvore(): Promise<void> {
  try { await electronAPI?.triggerFileTreeRefresh?.(); }
  catch (_) { /* tree refresh is best-effort */ }
}

/**
 * Todo arquivo aberto em qualquer painel: os do editor dividido
 * (SplitEditorManager.panes[*].tabs) e os da barra principal
 * (TabManager.tabs), sem repetir.
 */
export function arquivosAbertos(): string[] {
  const seen = new Set<string>();
  const splitMgr = window.SplitEditorManager;
  if (splitMgr?.panes) {
    for (const pane of splitMgr.panes) {
      for (const fp of (pane.tabs?.keys?.() || [])) seen.add(fp);
    }
  }
  const mainKeys = TabManager?.tabs?.keys?.();
  if (mainKeys) for (const fp of mainKeys) seen.add(fp);
  return Array.from(seen);
}

/**
 * Close `filePath` in every pane that shows it, the main TabManager pane
 * and any split panes. Used when a file's on-disk path changes underneath
 * the editor (e.g. a processor rename) so no tab is left pointing at a
 * path that no longer exists.
 */
export async function fecharEmTodoLugar(filePath: string): Promise<void> {
  try {
    if (TabManager?.tabs?.has?.(filePath)) await TabManager.closeTab(filePath);
  } catch (_) { /* ignore */ }
  const sem = window.SplitEditorManager;
  if (sem?.panes) {
    for (const pane of [...sem.panes]) {
      try {
        if (pane?.tabs?.has?.(filePath) && typeof pane._closeFile === 'function') {
          await pane._closeFile(filePath);
        }
      } catch (_) { /* ignore */ }
    }
  }
}
