// @vitest-environment happy-dom
//
// Unit tests for the AuroraAPI.git namespace (G1, the git_* AI tools backend,
// js/api/git_ns.ts). The namespace is thin wrappers over the window.gitAPI
// preload bridge; these pin the bits with real logic: result shaping, argument
// validation, file-list normalisation, and error / not-a-repo handling.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gitNs } from '../../js/api/git_ns.js';

beforeEach(() => {
  window.gitAPI = {
    status: vi.fn(async () => ({
      ok: true, isRepo: true, branch: 'main', tracking: 'origin/main', ahead: 1, behind: 0, clean: false,
      files: [{ path: 'a.js', index: ' ', working: 'M', additions: 2, deletions: 1 }],
    })),
    checkout: vi.fn(async (o) => ({ ok: true, ...o })),
    commit: vi.fn(async (o) => ({ ok: true, message: o.message })),
    stage: vi.fn(async () => ({ ok: true })),
  };
});

describe('gitNs.status', () => {
  it('shapes the working-tree result into { ok, data }', async () => {
    const r = await gitNs.status();
    expect(r.ok).toBe(true);
    expect(r.data.branch).toBe('main');
    expect(r.data.ahead).toBe(1);
    expect(r.data.files[0]).toMatchObject({ path: 'a.js', working: 'M', additions: 2 });
  });

  it('returns a clear error when the project is not a git repo', async () => {
    window.gitAPI.status = vi.fn(async () => ({ ok: true, isRepo: false }));
    const r = await gitNs.status();
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/not a git repo/i);
  });

  it('surfaces a gitAPI failure as { ok:false }', async () => {
    window.gitAPI.status = vi.fn(async () => ({ ok: false, error: 'boom' }));
    const r = await gitNs.status();
    expect(r.ok).toBe(false);
    expect(r.error.message).toContain('boom');
  });

  it('errors clearly when the Source Control bridge is missing', async () => {
    delete window.gitAPI;
    const r = await gitNs.status();
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/unavailable/i);
  });
});

describe('gitNs write-method validation + mapping', () => {
  it('commit() rejects an empty message and does NOT call git', async () => {
    const r = await gitNs.commit({ message: '   ' });
    expect(r.ok).toBe(false);
    expect(window.gitAPI.commit).not.toHaveBeenCalled();
  });

  it('commit() forwards a real message with amend defaulting to false', async () => {
    await gitNs.commit({ message: 'feat: x' });
    expect(window.gitAPI.commit).toHaveBeenCalledWith({ message: 'feat: x', amend: false });
  });

  it('createBranch() requires a name and maps to checkout(create:true)', async () => {
    expect((await gitNs.createBranch({ name: '' })).ok).toBe(false);
    await gitNs.createBranch({ name: 'feature/x' });
    expect(window.gitAPI.checkout).toHaveBeenCalledWith({ branch: 'feature/x', create: true });
  });

  it('switchBranch() maps to a plain checkout', async () => {
    await gitNs.switchBranch({ name: 'dev' });
    expect(window.gitAPI.checkout).toHaveBeenCalledWith({ branch: 'dev' });
  });

  it('stage() normalises a single path into an array', async () => {
    await gitNs.stage({ files: 'a.js' });
    expect(window.gitAPI.stage).toHaveBeenCalledWith(['a.js']);
  });
});

// Os embrulhos finos, um por um: o metodo da ponte e o argumento que chega
// nele. Acrescentados quando o git_ns virou .ts (03/10/2026).
describe('gitNs: o que cada metodo pede a ponte', () => {
  beforeEach(() => {
    for (const m of ['log', 'branches', 'diff', 'unstage', 'discard', 'fetch', 'pull', 'push', 'stash']) {
      window.gitAPI[m] = vi.fn(async () => ({ ok: true, isRepo: true }));
    }
  });

  it('log limita entre 1 e 200, com 30 quando nao vem numero', async () => {
    await gitNs.log();
    await gitNs.log({ limit: 999 });
    await gitNs.log({ limit: -5 });
    expect(window.gitAPI.log.mock.calls).toEqual([[{ limit: 30 }], [{ limit: 200 }], [{ limit: 1 }]]);
  });

  it('branches e diff funcionam fora de um repositorio, o resto recusa', async () => {
    window.gitAPI.branches = vi.fn(async () => ({ ok: true, isRepo: false, branches: [] }));
    window.gitAPI.diff = vi.fn(async () => ({ ok: true, isRepo: false }));
    window.gitAPI.fetch = vi.fn(async () => ({ ok: true, isRepo: false }));
    expect((await gitNs.branches()).isRepo).toBe(false);
    expect(window.gitAPI.branches).toHaveBeenCalledWith();
    await gitNs.diff({ file: '', staged: 1 });
    expect(window.gitAPI.diff).toHaveBeenCalledWith({ file: undefined, staged: true });
    expect((await gitNs.fetch()).error.message).toBe('The open project is not a git repository.');
  });

  it('unstage e discard normalizam a lista; fetch, pull e push vao sem argumento', async () => {
    await gitNs.unstage({ files: 'a.v' });
    await gitNs.discard();
    expect(window.gitAPI.unstage).toHaveBeenCalledWith(['a.v']);
    expect(window.gitAPI.discard).toHaveBeenCalledWith([]);
    await gitNs.fetch(); await gitNs.pull(); await gitNs.push();
    for (const m of ['fetch', 'pull', 'push']) expect(window.gitAPI[m]).toHaveBeenCalledWith();
  });

  it('stash leva a mensagem aparada, ou nenhuma', async () => {
    await gitNs.stash({ message: '  wip  ' });
    await gitNs.stash();
    expect(window.gitAPI.stash.mock.calls).toEqual([[{ message: 'wip' }], [{ message: undefined }]]);
  });

  it('a excecao da ponte vira erro com a mensagem dela', async () => {
    window.gitAPI.pull = vi.fn(async () => { throw new Error('sem rede'); });
    expect((await gitNs.pull()).error.message).toBe('sem rede');
    window.gitAPI.push = vi.fn(async () => { throw null; });
    expect((await gitNs.push()).error.message).toBe('git push failed');
  });
});
