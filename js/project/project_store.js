/**
 * project_store.js: Single source of truth for "which project is open".
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
 * For backward compatibility the store mirrors its values to
 * window.currentProjectPath / window.currentSpfPath on every change, so
 * the dozens of existing read sites keep working unchanged. New code
 * should prefer ProjectStore.getProjectPath() / getSpfPath().
 */

const subscribers = new Set();
let projectPath = null;
let spfPath = null;

function notify() {
  const snapshot = { projectPath, spfPath };
  subscribers.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (err) {
      // A subscriber blowing up shouldn't stop the others from running.
      console.error('ProjectStore subscriber threw:', err);
    }
  });
}

function mirrorToWindow() {
  if (typeof window === 'undefined') return;
  window.currentProjectPath = projectPath;
  window.currentSpfPath = spfPath;
}

export const ProjectStore = {
  getProjectPath() {
    return projectPath;
  },
  getSpfPath() {
    return spfPath;
  },
  hasProject() {
    return projectPath !== null;
  },

  setProject(newSpfPath, newProjectPath) {
    if (projectPath === newProjectPath && spfPath === newSpfPath) return;
    projectPath = newProjectPath || null;
    spfPath = newSpfPath || null;
    mirrorToWindow();
    notify();
  },

  clearProject() {
    if (projectPath === null && spfPath === null) return;
    projectPath = null;
    spfPath = null;
    mirrorToWindow();
    notify();
  },

  subscribe(fn) {
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
