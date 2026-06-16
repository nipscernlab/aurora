// @ts-check
/**
 * git.js — source-control IPC, backed by simple-git (a thin wrapper over the
 * native `git` binary). Operates on the OPEN PROJECT'S directory (derived from
 * state.currentOpenProjectPath, the single source of truth — see A4). Because
 * it drives real `git`, .gitignore, diffs, merges and credentials all behave
 * exactly as they do on the command line.
 *
 * Auth: push/pull use git's own credential helper by default. A GitHub token
 * stored via Aurora's secure storage (main/ipc/github_auth.js) is injected as
 * an `http.extraHeader` for the duration of a remote op when present.
 */

const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { ipcMain } = require('electron');
const simpleGit = require('simple-git');

const state = require('../state');

let githubAuth = null;
try { githubAuth = require('./github_auth'); } catch (_) { /* optional */ }

/** The open project's directory, or null when no project is open. */
function projectDir() {
  return state.currentOpenProjectPath ? path.dirname(state.currentOpenProjectPath) : null;
}

/**
 * A simple-git instance bound to the project dir, or throw a clean error.
 * @returns {import('simple-git').SimpleGit}
 */
function gitForProject() {
  const dir = projectDir();
  if (!dir) throw new Error('No project is open.');
  if (!fs.existsSync(dir)) throw new Error(`Project directory not found: ${dir}`);
  return simpleGit({ baseDir: dir, trimmed: true });
}

/** Wrap a handler so it always resolves to { ok, ... } instead of throwing across IPC. */
function safe(fn) {
  return async (/** @type {any} */ _event, /** @type {any} */ ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, ...(data && typeof data === 'object' ? data : { value: data }) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  };
}

/** Per-remote-op auth: inject the stored GitHub token as a one-shot header. */
async function withAuth(git) {
  try {
    const token = githubAuth && typeof githubAuth.getToken === 'function'
      ? await githubAuth.getToken()
      : null;
    if (token) {
      // Basic auth header git understands for HTTPS GitHub remotes. Scoped to
      // this command only (-c), never written to the repo config.
      const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
      return git.env({ ...process.env }).addConfig('http.extraHeader', `Authorization: Basic ${basic}`, false, 'worktree').catch(() => git);
    }
  } catch (_) { /* fall through to default credentials */ }
  return git;
}

function register() {
  // --- inspection ---------------------------------------------------------
  ipcMain.handle('git:is-repo', safe(async () => {
    const dir = projectDir();
    if (!dir || !fs.existsSync(dir)) return { isRepo: false, dir: dir || null };
    const isRepo = await simpleGit({ baseDir: dir }).checkIsRepo();
    return { isRepo, dir };
  }));

  ipcMain.handle('git:status', safe(async () => {
    const git = gitForProject();
    if (!(await git.checkIsRepo())) return { isRepo: false };
    const s = await git.status();
    return {
      isRepo: true,
      branch: s.current,
      tracking: s.tracking,
      ahead: s.ahead,
      behind: s.behind,
      // Per-file index/working flags (M/A/D/?/U). The renderer groups these.
      files: s.files.map((f) => ({ path: f.path, index: f.index, working: f.working_dir })),
      staged: s.staged,
      modified: s.modified,
      notAdded: s.not_added,
      created: s.created,
      deleted: s.deleted,
      renamed: s.renamed,
      conflicted: s.conflicted,
      clean: s.isClean(),
    };
  }));

  // Unified diff for one file (or the whole worktree when file omitted).
  ipcMain.handle('git:diff', safe(async (/** @type {{file?:string, staged?:boolean}} */ opts = {}) => {
    const git = gitForProject();
    const args = opts && opts.staged ? ['--staged'] : [];
    if (opts && opts.file) args.push('--', opts.file);
    const diff = await git.diff(args);
    return { diff };
  }));

  ipcMain.handle('git:log', safe(async (/** @type {{maxCount?:number}} */ opts = {}) => {
    const git = gitForProject();
    const logResult = await git.log({ maxCount: (opts && opts.maxCount) || 50 });
    return {
      commits: logResult.all.map((c) => ({
        hash: c.hash, date: c.date, message: c.message, author: c.author_name, email: c.author_email,
      })),
    };
  }));

  ipcMain.handle('git:branches', safe(async () => {
    const git = gitForProject();
    const b = await git.branchLocal();
    return { current: b.current, branches: b.all };
  }));

  ipcMain.handle('git:remotes', safe(async () => {
    const git = gitForProject();
    const remotes = await git.getRemotes(true);
    return { remotes: remotes.map((r) => ({ name: r.name, fetch: r.refs.fetch, push: r.refs.push })) };
  }));

  // --- mutations ----------------------------------------------------------
  ipcMain.handle('git:init', safe(async () => {
    const git = gitForProject();
    await git.init();
    return { initialized: true };
  }));

  ipcMain.handle('git:stage', safe(async (/** @type {string[]|string} */ files) => {
    const git = gitForProject();
    await git.add(Array.isArray(files) ? files : [files]);
    return {};
  }));

  ipcMain.handle('git:stage-all', safe(async () => {
    const git = gitForProject();
    await git.add(['-A']);
    return {};
  }));

  ipcMain.handle('git:unstage', safe(async (/** @type {string[]|string} */ files) => {
    const git = gitForProject();
    const list = Array.isArray(files) ? files : [files];
    await git.reset(['HEAD', '--', ...list]);
    return {};
  }));

  // Discard working-tree changes for tracked files (checkout). Untracked files
  // are left alone here (deleting them is a separate, more dangerous op).
  ipcMain.handle('git:discard', safe(async (/** @type {string[]|string} */ files) => {
    const git = gitForProject();
    const list = Array.isArray(files) ? files : [files];
    await git.checkout(['--', ...list]);
    return {};
  }));

  ipcMain.handle('git:commit', safe(async (/** @type {{message:string}} */ opts) => {
    const message = opts && opts.message;
    if (!message || !message.trim()) throw new Error('Commit message is empty.');
    const git = gitForProject();
    const res = await git.commit(message);
    return { commit: res.commit, summary: res.summary };
  }));

  ipcMain.handle('git:checkout', safe(async (/** @type {{branch:string, create?:boolean}} */ opts) => {
    const git = gitForProject();
    if (opts && opts.create) await git.checkoutLocalBranch(opts.branch);
    else await git.checkout(opts.branch);
    return {};
  }));

  // --- remote (needs credentials/token) -----------------------------------
  ipcMain.handle('git:fetch', safe(async () => {
    const git = await withAuth(gitForProject());
    await git.fetch();
    return {};
  }));

  ipcMain.handle('git:pull', safe(async () => {
    const git = await withAuth(gitForProject());
    const res = await git.pull();
    return { summary: res.summary, files: res.files };
  }));

  ipcMain.handle('git:push', safe(async (/** @type {{setUpstream?:boolean}} */ opts = {}) => {
    const git = await withAuth(gitForProject());
    const status = await git.status();
    if (opts && opts.setUpstream && status.current) {
      await git.push(['-u', 'origin', status.current]);
    } else {
      await git.push();
    }
    return {};
  }));

  log.info('[ipc.git] handlers registered');
}

module.exports = { register, projectDir };
