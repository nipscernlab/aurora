/**
 * git_ns.js: the `AuroraAPI.git` namespace (G1): version control over the open
 * project's local git repo, exposed to Aurora Intelligence as the git_* tools.
 *
 * Thin wrappers over the window.gitAPI preload bridge (main/ipc/git.js /
 * simple-git), with a gitCall() that normalises errors + the not-a-repo case.
 * Read methods run immediately; write methods are gated by the Allow/Deny card
 * (access:'write' in main/ai/tools.js). Everything no-ops with a clear error
 * when the open project is not a git repository.
 *
 * Lives in its own module (rather than inside aurora_api.js) so it can be unit
 * tested without pulling in the editor/monaco import chain. aurora_api.js
 * imports `gitNs` from here and exposes it as `AuroraAPI.git`.
 */

// Result helpers, same shape as aurora_api.js's ok/err, inlined so this module
// stays standalone and testable.
function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function err(message, code) {
  return { ok: false, error: { message: String(message || 'Unknown error'), code: code || null } };
}

const _toFiles = (files) => (Array.isArray(files) ? files : (files != null && files !== '' ? [files] : []));

/** Call a window.gitAPI method, normalising errors + the not-a-repo case. */
async function gitCall(method, arg, { needRepo = true } = {}) {
  const fn = (typeof window !== 'undefined' && window.gitAPI) ? window.gitAPI[method] : null;
  if (typeof fn !== 'function') return err(`gitAPI.${method} unavailable — Source Control bridge not loaded`);
  let r;
  try { r = (arg === undefined) ? await fn() : await fn(arg); }
  catch (e) { return err(e?.message || `git ${method} failed`); }
  if (r && r.ok === false) return err(r.error || `git ${method} failed`);
  if (needRepo && r && r.isRepo === false) return err('The open project is not a git repository.');
  return r;
}

const gitNs = {
  /** Working-tree status: branch, ahead/behind, and changed files (path + index/working flags + ±lines). */
  async status() {
    const r = await gitCall('status', { stats: true });
    if (r.ok === false) return r;
    return ok({
      branch: r.branch, tracking: r.tracking, ahead: r.ahead, behind: r.behind, clean: r.clean,
      files: (r.files || []).map((f) => ({
        path: f.path, index: f.index, working: f.working, additions: f.additions, deletions: f.deletions,
      })),
    });
  },
  async log({ limit } = {}) { return gitCall('log', { limit: Math.max(1, Math.min(200, Number(limit) || 30)) }); },
  async branches() { return gitCall('branches', undefined, { needRepo: false }); },
  async diff({ file, staged } = {}) { return gitCall('diff', { file: file || undefined, staged: !!staged }, { needRepo: false }); },
  async stage({ files } = {}) { return gitCall('stage', _toFiles(files)); },
  async unstage({ files } = {}) { return gitCall('unstage', _toFiles(files)); },
  async discard({ files } = {}) { return gitCall('discard', _toFiles(files)); },
  async commit({ message, amend } = {}) {
    const msg = String(message || '').trim();
    if (!msg && !amend) return err('A commit message is required.');
    return gitCall('commit', { message: msg, amend: !!amend });
  },
  async createBranch({ name } = {}) {
    const b = String(name || '').trim();
    if (!b) return err('A branch name is required.');
    return gitCall('checkout', { branch: b, create: true });
  },
  async switchBranch({ name } = {}) {
    const b = String(name || '').trim();
    if (!b) return err('A branch name is required.');
    return gitCall('checkout', { branch: b });
  },
  async fetch() { return gitCall('fetch'); },
  async pull() { return gitCall('pull'); },
  async push() { return gitCall('push'); },
  async stash({ message } = {}) { return gitCall('stash', { message: String(message || '').trim() || undefined }); },
};

export { gitNs };
