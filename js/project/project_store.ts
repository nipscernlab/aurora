/**
 * project_store.ts: Single source of truth for "which project is open".
 *
 * Aurora used to track the current project in three places that drifted:
 *   - window.currentProjectPath / window.currentSpfPath (set by loadProject)
 *   - ProjectTreeManager.currentProjectPath (cached on activate)
 *   - main-process state read via getCurrentProject() IPC
 *
 * That drift caused real bugs (e.g. closing a project left the verilog
 * manager pointing at the old path; reopening rendered against stale state).
 * This module owns project state in the renderer. Callers go through
 * `setProject` / `clearProject` instead of touching window.* directly.
 *
 * O store ainda espelha o caminho do projeto em window.currentProjectPath,
 * para os poucos leitores que nao o importam (TODO 13.2 lista quais). O
 * espelho do .spf, window.currentSpfPath, saiu em 25/09/2026: ninguem mais o
 * lia. Codigo novo usa ProjectStore.getProjectPath() / getSpfPath().
 */

export interface ProjectSnapshot {
  projectPath: string | null;
  spfPath: string | null;
}

type Subscriber = (snapshot: ProjectSnapshot) => void;

const subscribers = new Set<Subscriber>();
let projectPath: string | null = null;
let spfPath: string | null = null;

function notify(): void {
  const snapshot: ProjectSnapshot = { projectPath, spfPath };
  subscribers.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (err) {
      // A subscriber blowing up shouldn't stop the others from running.
      console.error('ProjectStore subscriber threw:', err);
    }
  });
}

function mirrorToWindow(): void {
  if (typeof window === 'undefined') return;
  window.currentProjectPath = projectPath;
}

export const ProjectStore = {
  getProjectPath(): string | null {
    return projectPath;
  },
  getSpfPath(): string | null {
    return spfPath;
  },
  hasProject(): boolean {
    return projectPath !== null;
  },

  setProject(newSpfPath: string | null | undefined, newProjectPath: string | null | undefined): void {
    if (projectPath === newProjectPath && spfPath === newSpfPath) return;
    projectPath = newProjectPath || null;
    spfPath = newSpfPath || null;
    mirrorToWindow();
    notify();
  },

  clearProject(): void {
    if (projectPath === null && spfPath === null) return;
    projectPath = null;
    spfPath = null;
    mirrorToWindow();
    notify();
  },

  subscribe(fn: Subscriber): () => boolean {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

if (typeof window !== 'undefined') {
  // Exposed globally so code that can't import (or that loaded before this
  // module) can still consult the store via window.ProjectStore. Prefer
  // importing where possible.
  window.ProjectStore = ProjectStore;
}
