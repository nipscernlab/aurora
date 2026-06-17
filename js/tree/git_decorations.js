/**
 * git_decorations.js — VSCode-style git status decorations on the file tree.
 *
 * Paints a small coloured LETTER badge on each changed file row (M = modified,
 * amber; A/? = added/untracked, green; D = deleted, red; R = renamed, blue;
 * U/C = conflict) and a coloured DOT on folders that contain changes — across
 * BOTH file-tree views:
 *   - the "files" (verilog) view  → rows are `.verilog-file-item[data-file-path]`
 *   - the "folders" (standard) view → rows are `.file-tree-item[data-path]`
 * The filename is also tinted with the status colour, exactly like VS Code.
 *
 * Driven by the LOCAL git status of the open project (window.gitAPI). It shows
 * NOTHING when the project isn't a git repo, so non-git SAPHO projects stay
 * clean — the decorations only appear for cloned/initialised repos.
 *
 * Two clocks, kept apart:
 *   - refresh(): re-fetch git status, rebuild the path→letter map + the
 *     changed-folders set, then apply(). Runs on the same signals the Source
 *     Control badge already uses (file saved / project changed / disk changed)
 *     plus a slow periodic fallback for external git ops (commit in a terminal).
 *   - apply(): re-paint the CURRENT rows from the cached map. The tree renderers
 *     wipe and rebuild rows on every refresh, so a MutationObserver re-applies
 *     the decorations after each re-render WITHOUT re-fetching git.
 */

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Status letter → CSS modifier + human label (PT, matching git_panel STATUS_LABEL).
const STATUS = {
  M: { cls: 'modified',  label: 'modificado' },
  A: { cls: 'added',     label: 'adicionado' },
  '?': { cls: 'untracked', label: 'novo' },
  D: { cls: 'deleted',   label: 'deletado' },
  R: { cls: 'renamed',   label: 'renomeado' },
  C: { cls: 'copied',    label: 'copiado' },
  U: { cls: 'conflict',  label: 'conflito' },
};

/** Effective single-letter flag for a status file — prefer the working-tree
 *  char, else the index char (untracked is '?'). Mirrors git_panel's fileFlag
 *  so the tree and the Source Control panel always agree. */
function letterOf(f) {
  const w = (f.working || '').trim();
  const i = (f.index || '').trim();
  return w || (i === '?' ? '?' : i) || '?';
}

function t(key, fallback) {
  try { const v = window.t?.(key); if (v && v !== key) return v; } catch (_) { /* ignore */ }
  return fallback;
}

class GitDecorations {
  constructor() {
    this._fileStatus = new Map();   // normAbsPath → status letter
    this._changedDirs = new Set();  // normAbsPath of dirs that contain a change
    this._applyTimer = null;
    this._refreshTimer = null;
    this._observer = null;
    this._started = false;
  }

  /** Wire observers + event subscriptions. Idempotent. */
  start() {
    if (this._started) return;
    this._started = true;

    const treeRoot = document.getElementById('file-tree');
    if (treeRoot && typeof MutationObserver !== 'undefined') {
      // Re-decorate after every re-render. Disconnected during apply() so our
      // own badge insertions don't retrigger it (which would loop).
      this._observer = new MutationObserver(() => this._scheduleApply());
      this._observer.observe(treeRoot, { childList: true, subtree: true });
    }

    const onChange = () => this._scheduleRefresh();
    window.addEventListener('aurora:file-saved', onChange);
    window.addEventListener('aurora:spf-changed', onChange);   // project open / switch / structure change
    document.addEventListener('aurora:file-saved', onChange);
    try { window.electronAPI?.onDirectoryChanged?.(() => onChange()); } catch (_) { /* optional */ }
    try { window.electronAPI?.onFileChanged?.(() => onChange()); } catch (_) { /* optional */ }
    // Slow fallback: catches commits / checkouts done outside Aurora.
    setInterval(() => this.refresh(), 10000);

    this.refresh();
  }

  _scheduleRefresh() { clearTimeout(this._refreshTimer); this._refreshTimer = setTimeout(() => this.refresh(), 350); }
  _scheduleApply() { clearTimeout(this._applyTimer); this._applyTimer = setTimeout(() => this.apply(), 80); }

  /** Re-fetch git status for the open project and rebuild the decoration maps. */
  async refresh() {
    const root = window.currentProjectPath;
    if (!root || !window.gitAPI || typeof window.gitAPI.status !== 'function') { this._clear(); return; }

    let st;
    try { st = await window.gitAPI.status(); } catch (_) { st = null; }
    if (!st || st.ok === false || !st.isRepo || !Array.isArray(st.files)) { this._clear(); return; }

    const rootN = norm(root);
    const fileStatus = new Map();
    const changedDirs = new Set();
    for (const f of st.files) {
      // status paths are relative to the repo root (== the open project root in
      // our flow) and forward-slashed. Resolve to a normalised absolute path so
      // it matches the rows' data-path / data-file-path.
      const rel = String(f.path || '').replace(/^\/+/, '').toLowerCase();
      if (!rel) continue;
      const absN = `${rootN}/${rel}`;
      fileStatus.set(absN, letterOf(f));
      // Roll the change up to every ancestor folder (VS Code shows a dot on
      // folders that contain changes).
      let dir = absN;
      while (dir.length > rootN.length) {
        const slash = dir.lastIndexOf('/');
        if (slash < 0) break;
        dir = dir.slice(0, slash);
        if (dir.length < rootN.length) break;
        changedDirs.add(dir);
      }
    }
    this._fileStatus = fileStatus;
    this._changedDirs = changedDirs;
    this.apply();
  }

  _clear() {
    if (this._fileStatus.size === 0 && this._changedDirs.size === 0) { this.apply(); return; }
    this._fileStatus = new Map();
    this._changedDirs = new Set();
    this.apply();
  }

  /** Re-paint the current rows from the cached maps. */
  apply() {
    const treeRoot = document.getElementById('file-tree');
    if (!treeRoot) return;
    if (this._observer) this._observer.disconnect();          // ignore our own mutations
    try {
      // --- "folders" (standard) view: files AND folders ---
      treeRoot.querySelectorAll('.file-tree-item[data-path]').forEach((wrap) => {
        const row = wrap.querySelector(':scope > .file-item');   // the flex row; badge is a flex sibling of .file-item-row
        if (!row) return;
        const nameEl = row.querySelector('.file-item-name');
        const isFolder = !!wrap.querySelector(':scope > .folder-content');
        const p = norm(wrap.getAttribute('data-path'));
        if (isFolder) {
          this._paint(row, nameEl, this._changedDirs.has(p) ? 'dir' : null);
        } else {
          this._paint(row, nameEl, this._fileStatus.get(p) || null);
        }
      });
      // --- "files" (verilog) view: file items ---
      treeRoot.querySelectorAll('.verilog-file-item[data-file-path]').forEach((item) => {
        const host = item.querySelector('.verilog-file-info') || item;
        const nameEl = item.querySelector('.verilog-file-name');
        const p = norm(item.getAttribute('data-file-path'));
        this._paint(host, nameEl, this._fileStatus.get(p) || null);
      });
    } finally {
      if (this._observer) this._observer.observe(treeRoot, { childList: true, subtree: true });
    }
  }

  /**
   * Add/update/remove the badge inside `host` and tint `nameEl`.
   * `flag` is a status letter (M/A/?/D/R/C/U), 'dir' for a folder rollup dot,
   * or null to clear.
   */
  _paint(host, nameEl, flag) {
    let badge = host.querySelector(':scope > .git-deco');
    if (nameEl) nameEl.className = nameEl.className.replace(/\s*git-st-\S+|\s*git-st-deleted/g, '');

    if (!flag) { if (badge) badge.remove(); return; }

    const isDir = flag === 'dir';
    const cls = isDir ? 'dir' : (STATUS[flag]?.cls || 'modified');
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute('aria-hidden', 'true');
      host.appendChild(badge);
    }
    badge.className = `git-deco git-st-${cls}`;
    badge.textContent = isDir ? '•' : flag;   // • for folders, the letter for files
    if (!isDir) badge.title = t(`git.status.${cls}`, STATUS[flag]?.label || '');
    else badge.removeAttribute('title');

    if (nameEl && !isDir) {
      nameEl.classList.add(`git-st-${cls}`);
      if (flag === 'D') nameEl.classList.add('git-st-deleted');
    }
  }
}

const gitDecorations = new GitDecorations();

if (typeof window !== 'undefined') {
  window.gitDecorations = gitDecorations;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => gitDecorations.start());
  } else {
    gitDecorations.start();
  }
}

export { gitDecorations, GitDecorations };
