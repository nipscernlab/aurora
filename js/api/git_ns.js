/**
 * git_ns.ts: o namespace `AuroraAPI.git`, o controle de versao do repositorio
 * local do projeto aberto, que a Aurora Intelligence usa pelas ferramentas
 * git_*.
 *
 * Embrulha a ponte window.gitAPI do preload (main/ipc/git.ts, simple-git), com
 * um gitCall() que normaliza os erros e o caso de pasta que nao e repositorio.
 * Leitura roda na hora; escrita passa pelo cartao de Permitir/Negar
 * (access:'write' em main/ai/tools.js). Fora de um repositorio, tudo recusa
 * com uma mensagem clara.
 *
 * Coberto por tests/unit/gitNs.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num git_ns.js ao lado, e esse .js que
 * o runtime carrega; os imports usam a extensao `.js`.
 */
import { motivoDe } from '../app/api_reply.js';
import { ok, err } from './api_core.js';
const _toFiles = (files) => (Array.isArray(files) ? files : (files != null && files !== '' ? [files] : []));
/** Call a window.gitAPI method, normalising errors + the not-a-repo case. */
async function gitCall(method, arg, { needRepo = true } = {}) {
    const ponte = (typeof window !== 'undefined' && window.gitAPI)
        ? window.gitAPI
        : null;
    const fn = ponte ? ponte[method] : null;
    if (typeof fn !== 'function')
        return err(`gitAPI.${method} unavailable — Source Control bridge not loaded`);
    let r;
    try {
        r = (arg === undefined) ? await fn() : await fn(arg);
    }
    catch (e) {
        return err(e?.message || `git ${method} failed`);
    }
    if (r && r.ok === false)
        return err(motivoDe(r, `git ${method} failed`));
    if (needRepo && r && r.isRepo === false)
        return err('The open project is not a git repository.');
    return r;
}
export const gitNs = {
    /** Working-tree status: branch, ahead/behind, and changed files (path + index/working flags + ±lines). */
    async status() {
        const r = await gitCall('status', { stats: true });
        if (r.ok === false)
            return r;
        return ok({
            branch: r.branch, tracking: r.tracking, ahead: r.ahead, behind: r.behind, clean: r.clean,
            files: (r.files || []).map((f) => ({
                path: f.path, index: f.index, working: f.working, additions: f.additions, deletions: f.deletions,
            })),
        });
    },
    async log({ limit } = {}) {
        return gitCall('log', { limit: Math.max(1, Math.min(200, Number(limit) || 30)) });
    },
    async branches() { return gitCall('branches', undefined, { needRepo: false }); },
    async diff({ file, staged } = {}) {
        return gitCall('diff', { file: file || undefined, staged: !!staged }, { needRepo: false });
    },
    async stage({ files } = {}) { return gitCall('stage', _toFiles(files)); },
    async unstage({ files } = {}) { return gitCall('unstage', _toFiles(files)); },
    async discard({ files } = {}) { return gitCall('discard', _toFiles(files)); },
    async commit({ message, amend } = {}) {
        const msg = String(message || '').trim();
        if (!msg && !amend)
            return err('A commit message is required.');
        return gitCall('commit', { message: msg, amend: !!amend });
    },
    async createBranch({ name } = {}) {
        const b = String(name || '').trim();
        if (!b)
            return err('A branch name is required.');
        return gitCall('checkout', { branch: b, create: true });
    },
    async switchBranch({ name } = {}) {
        const b = String(name || '').trim();
        if (!b)
            return err('A branch name is required.');
        return gitCall('checkout', { branch: b });
    },
    async fetch() { return gitCall('fetch'); },
    async pull() { return gitCall('pull'); },
    async push() { return gitCall('push'); },
    async stash({ message } = {}) {
        return gitCall('stash', { message: String(message || '').trim() || undefined });
    },
};
