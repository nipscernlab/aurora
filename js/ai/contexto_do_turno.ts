/**
 * contexto_do_turno.ts: o que o painel de IA le do app a cada turno para montar
 * o bloco de contexto do projeto (chat_turn.buildProjectContext).
 *
 * Relido a cada turno de proposito, nunca guardado. O caminho do projeto
 * porque sem ele o modelo gasta uma chamada de ferramenta para saber onde esta,
 * e os que nao chamam ferramenta primeiro inventam o caminho de um projeto
 * anterior; trocar de projeto no meio da conversa tem que valer no turno
 * seguinte. As memorias porque uma escrita NESTE turno tem que aparecer no
 * proximo. Os componentes ausentes porque a pessoa pode baixar um no meio da
 * conversa, e um valor guardado faria a IA continuar recusando o que ja esta
 * instalado. Nada disto pode travar um turno: o que falhar vem vazio.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3).
 */

import { ProjectStore } from '../project/project_store.js';

export interface ContextoDoTurno {
  projectPath: string | null;
  spfPath: string | null;
  memories: unknown[];
  componentes: unknown[];
}

export async function lerContextoDoTurno(): Promise<ContextoDoTurno> {
  const projectPath = ProjectStore.getProjectPath();
  const spfPath = ProjectStore.getSpfPath();

  let memories: unknown[] = [];
  try {
    const r = await window.AuroraAPI?.project?.listMemories?.();
    if (r?.ok) memories = r.data?.memories || [];
  } catch (e) {
    console.warn('[ai] could not load project memories:', e);  // never block a turn over this
  }

  let componentes: unknown[] = [];
  try {
    const r = await window.electronAPI?.componentesListar?.();
    componentes = r?.componentes || [];
  } catch (e) {
    console.warn('[ai] could not read components:', e);  // never block a turn over this
  }

  return { projectPath, spfPath, memories, componentes };
}
