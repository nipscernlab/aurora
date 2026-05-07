/**
 * shared_models.js — Reference-counted Monaco model registry.
 *
 * Splitting the editor used to clone the file's text into a brand-new model
 * per pane, which meant edits never propagated and only the main pane's tab
 * picked up the dirty marker. With shared models, every editor showing the
 * same file points to the same `ITextModel`: edits, undo/redo, and decorations
 * stay in sync, and the dirty/save flow works no matter which pane the user
 * is typing in.
 *
 * We can't let Monaco own model lifetime here — it auto-disposes a model
 * when the editor that *created* it is disposed, which would yank the model
 * out from under the other panes. So the rule is:
 *
 *   - Always pass `model:` explicitly to `monaco.editor.create(...)`.
 *   - Acquire the model through this registry (refCount += 1).
 *   - Release the model when the corresponding editor is disposed
 *     (refCount -= 1; dispose at zero).
 */

const entries = new Map(); // filePath -> { model, refCount }

function uriFor(filePath) {
  // monaco.Uri.file normalises Windows backslashes and ensures a stable URI
  // string, which is what Monaco keys models by internally.
  return monaco.Uri.file(filePath);
}

export const SharedModelRegistry = {
  /**
   * Get (or create) the shared model for `filePath`. If the model already
   * exists, `content` is ignored — the existing in-memory text is the
   * source of truth (so a second pane opening the file sees the user's
   * unsaved edits, not the on-disk content).
   *
   * Increments the ref count by one. Each `acquire` MUST be balanced by a
   * matching `release` when the owning editor is disposed.
   */
  acquire(filePath, content, language) {
    let entry = entries.get(filePath);
    if (!entry) {
      const uri = uriFor(filePath);
      // A model with this URI may already exist if another subsystem
      // (e.g. a search-by-uri call) created it; reuse it instead of
      // throwing on duplicate URIs.
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(content || '', language, uri);
      } else if (typeof content === 'string' && model.getValue() === '') {
        // Empty existing model + we have content → seed it.
        model.setValue(content);
      }
      entry = { model, refCount: 0 };
      entries.set(filePath, entry);
    }
    entry.refCount += 1;
    return entry.model;
  },

  /**
   * Decrement the ref count. When it hits zero, the model is disposed
   * and the entry is removed. Safe to call with a path we don't track
   * (e.g. binary files that were never registered).
   */
  release(filePath) {
    const entry = entries.get(filePath);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try {
        entry.model.dispose();
      } catch (_) {
        // Already disposed — fine.
      }
      entries.delete(filePath);
    }
  },

  /** Read-only access to the shared model, or null if none is held. */
  getModel(filePath) {
    return entries.get(filePath)?.model ?? null;
  },

  /** Has any pane currently registered this file? */
  has(filePath) {
    return entries.has(filePath);
  },
};

if (typeof window !== 'undefined') {
  // Exposed for split_editor.js and TabManager save-from-split paths,
  // both of which live outside the editor module's import graph.
  window.SharedModelRegistry = SharedModelRegistry;
}
