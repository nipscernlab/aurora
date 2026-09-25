/**
 * renomear_projeto_ns.ts: renomear o projeto aberto, parte do namespace
 * `AuroraAPI.project` (renameProject, getRenameStatus).
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o job que roda o
 * renomear fora da chamada da ferramenta. O .spf aberto vem do ProjectStore
 * importado, e nao de window.
 *
 * Compilado por `tsc` (npm run build:ts) num renomear_projeto_ns.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { motivoDe } from '../app/api_reply.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from '../project/project_store.js';
import { ok, err, emit } from './api_core.js';

/* ============================================================
 *  Project rename, job-based, observable, timeout-proof
 *
 *  Renaming a project moves the whole project folder on disk,
 *  rewrites every path stored in the .spf, and then reopens the
 *  project (a slow full-tree rescan + watcher re-attach). Doing all
 *  of that inside a single AI tool call used to blow past the tool
 *  timeout: the model saw "timed out" even when the rename had
 *  actually succeeded, it only showed up after a manual refresh.
 *
 *  Instead, `renameProject` registers a JOB and returns its id at
 *  once (it never blocks, so it never times out). The job runs the
 *  rename in the background, recording each completed step and a
 *  final verdict; the model reads them back with `get_rename_status`
 *  until the job is `done` or `failed`. The user sees a start toast
 *  and a clear success/failure toast, and the project reopens itself.
 * ========================================================== */

/** Um passo concluido (ou que falhou) do renomear. */
interface PassoDoJob {
  step?: string;
  ok?: boolean;
  detail?: string | null;
  at?: number;
  [k: string]: unknown;
}

/** O veredito final do job. */
interface ResultadoDoJob {
  ok: boolean;
  oldName?: string;
  newName?: string;
  newSpfPath?: string | null;
  warning?: string | null;
  failedStep?: string;
  reason?: string;
}

/** Um renomear em curso ou recem-terminado. */
interface JobDeRenomear {
  id: string;
  newName: string;
  oldSpfPath: string;
  status: 'running' | 'done' | 'failed';
  steps: PassoDoJob[];
  result: ResultadoDoJob | null;
  startedAt: number;
  finishedAt: number | null;
  newSpfPath: string | null;
}

/** jobId → o job */
const _renameJobs = new Map<string, JobDeRenomear>();
let _renameSeq = 0;

/** Localised toast text with a Portuguese fallback when i18n is missing. */
function _renameMsg(key: string, fallback: string, params?: Record<string, unknown>): string {
  try { const v = window.t?.(key, params); if (v && v !== key) return v; } catch (_) { /* ignore */ }
  return fallback;
}

/** Append a completed (or failed) step to a rename job's timeline. */
function _renameStep(job: JobDeRenomear, step: string, okStep: boolean, detail?: string | null): void {
  job.steps.push({ step, ok: okStep !== false, detail: detail || null, at: Date.now() - job.startedAt });
}

/** Drop a finished job from memory after a grace window so the Map can't grow. */
function _finishRenameJob(job: JobDeRenomear): void {
  job.finishedAt = Date.now();
  setTimeout(() => { _renameJobs.delete(job.id); }, 5 * 60 * 1000);
}

/**
 * Run the rename in the background, OFF the AI tool-call path, updating the
 * job as it goes. Phases: prepare (save+close everything under the root) →
 * the main-process on-disk rename → reopen the project (the slow part, now
 * awaited here so we learn whether it truly took). A failed reopen does NOT
 * mean the rename failed, only that the tree couldn't auto-refresh.
 */
async function _runRenameJob(job: JobDeRenomear): Promise<void> {
  const newNm = job.newName;
  try {
    // 1. Prepare: persist edits and drop tabs/panes, every file under the
    //    project root is about to move, so nothing may keep pointing at it.
    try { await TabManager.saveAllFiles(); } catch (_) { /* best-effort */ }
    const sem = window.SplitEditorManager;
    if (sem && Array.isArray(sem.panes) && sem.panes.length) {
      for (const pane of [...sem.panes]) {
        try { sem.closePane?.(pane.paneIndex); } catch (_) { /* best-effort */ }
      }
    }
    try { await TabManager.closeAllTabs(); } catch (_) { /* best-effort */ }
    _renameStep(job, 'prepare', true);

    // 2. On-disk rename in the main process. It returns a STRUCTURED verdict
    //    (never throws raw): { success, failedStep?, error?, steps?, newSpfPath, newRoot }.
    let r;
    try { r = await electronAPI.renameProject!(newNm); }
    catch (e) {
      const reason = (e as Error | null)?.message || 'rename IPC failed';
      _renameStep(job, 'disk-rename', false, reason);
      job.status = 'failed';
      job.result = { ok: false, failedStep: 'disk-rename', reason };
      try { window.showNotification?.(_renameMsg('rename.failed', `Não foi possível renomear o projeto: ${reason}`, { reason }), 'error', 8000); } catch (_) { /* best-effort */ }
      _finishRenameJob(job);
      return;
    }
    // Fold the main-process step timeline into the job's.
    if (Array.isArray(r?.steps)) for (const s of r.steps) job.steps.push({ ...s });
    if (!r || r.success === false) {
      const reason = motivoDe(r, 'the on-disk rename failed');
      _renameStep(job, 'disk-rename', false, reason);
      job.status = 'failed';
      job.result = { ok: false, failedStep: r?.failedStep || 'disk-rename', reason };
      try { window.showNotification?.(_renameMsg('rename.failed', `Não foi possível renomear o projeto: ${reason}`, { reason }), 'error', 8000); } catch (_) { /* best-effort */ }
      _finishRenameJob(job);
      return;
    }
    _renameStep(job, 'disk-rename', true);

    const newSpfPath = r.newSpfPath || null;
    job.newSpfPath = newSpfPath;
    job.newName = r.newName || newNm;

    // 3. Reopen the project (full tree rescan + watcher re-attach). This is the
    //    slow part; because we are OFF the tool-call path we can AWAIT it and
    //    learn whether it truly succeeded, instead of firing it blind.
    //    NOTE: we deliberately do NOT pre-call ProjectStore.setProject here:
    //    loadProject sets it itself. An extra setProject fires the file tree's
    //    ProjectStore subscriber (an out-of-band refreshTree) that RACES with
    //    loadProject's own render and left the tree un-clickable until a manual
    //    refresh (the reported bug).
    let reopenOk = true;
    let reopenErr = null;
    if (newSpfPath) {
      try {
        if (window.projectManager?.loadProject) await window.projectManager.loadProject(newSpfPath);
        else await electronAPI.openProject(newSpfPath);
        try { window.recentProjectsManager?.removeProject?.(job.oldSpfPath); } catch (_) { /* best-effort */ }
      } catch (e) {
        reopenOk = false;
        reopenErr = (e as Error | null)?.message || 'reopen failed';
      }
    }
    _renameStep(job, 'reopen', reopenOk, reopenErr);

    // 5. Terminal verdict.
    job.status = 'done';
    job.result = {
      ok: true,
      oldName: r.oldName,
      newName: job.newName,
      newSpfPath,
      warning: reopenOk ? null
        : 'The rename succeeded on disk, but the editor could not auto-reload the project; reopen it manually to refresh the tree.',
    };
    if (reopenOk) {
      try { window.showNotification?.(_renameMsg('rename.success', `Projeto renomeado para "${job.newName}".`, { name: job.newName }), 'success'); } catch (_) { /* best-effort */ }
    } else {
      try { window.showNotification?.(_renameMsg('rename.successNoReload', `Projeto renomeado para "${job.newName}", mas reabra-o para atualizar a árvore.`, { name: job.newName }), 'warning', 8000); } catch (_) { /* best-effort */ }
    }
    emit('project:renamed', { oldName: r.oldName, newName: job.newName, spfPath: newSpfPath });
    _finishRenameJob(job);
  } catch (e) {
    const reason = (e as Error | null)?.message || String(e);
    _renameStep(job, 'unexpected', false, reason);
    job.status = 'failed';
    job.result = { ok: false, failedStep: 'unexpected', reason };
    try { window.showNotification?.(_renameMsg('rename.failed', `Não foi possível renomear o projeto: ${reason}`, { reason }), 'error', 8000); } catch (_) { /* best-effort */ }
    _finishRenameJob(job);
  }
}

export const renomearProjeto = {
  /**
   * Rename the currently open project, folder + .spf + every stored path:
   * as a tracked background JOB so a slow rename can never time out the AI
   * tool call. Returns a jobId immediately; the model then polls
   * `get_rename_status(jobId)` for step-by-step progress and the final
   * verdict. The user sees a start toast now and a success/failure toast when
   * the job finishes, and the project reopens itself.
   *
   * Processor folders move with the root, a project rename never touches
   * #PRNAME or per-processor names (use rename_processor for those).
   */
  async renameProject({ newName }: { newName?: string } = {}) {
    const newNm = String(newName || '').trim();
    if (!newNm) return err('newName required');
    if (/[^A-Za-z0-9_-]/.test(newNm)) {
      return err('newName may only contain letters, numbers, _ and -');
    }
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    if (typeof electronAPI?.renameProject !== 'function') {
      return err('rename-project IPC unavailable');
    }

    const jobId = `rename-${++_renameSeq}`;
    const job: JobDeRenomear = {
      id: jobId, newName: newNm, oldSpfPath: spfPath,
      status: 'running', steps: [], result: null,
      startedAt: Date.now(), finishedAt: null, newSpfPath: null,
    };
    _renameJobs.set(jobId, job);
    try { window.showNotification?.(_renameMsg('rename.started', `Renomeando projeto para "${newNm}"…`, { name: newNm }), 'info'); } catch (_) { /* best-effort */ }

    // Fire and forget, the rename runs OFF this call so we return at once
    // (no blocking → no tool-call timeout). The model reads the outcome back
    // with get_rename_status.
    _runRenameJob(job).catch(
      /* v8 ignore start */ // rede de seguranca: o _runRenameJob tem o seu proprio try/catch e nao rejeita
      (e) => {
        job.status = 'failed';
        job.result = { ok: false, failedStep: 'unexpected', reason: (e as Error | null)?.message || String(e) };
        _finishRenameJob(job);
      },
      /* v8 ignore stop */
    );

    return ok({
      jobId,
      status: 'running',
      message: `Rename started for "${newNm}". Call get_rename_status with jobId="${jobId}" (poll a few times if needed) until status is "done" or "failed" to get the final result — and, on failure, the step and reason it failed.`,
    });
  },

  /**
   * Report the progress and final verdict of a rename started by
   * `renameProject`. Safe to call repeatedly. While running it returns the
   * steps completed so far; once terminal it returns the verdict:
   * { ok:true, newName, warning? } on success (a `warning` means only the
   * editor auto-reload failed; the rename itself is fine) or
   * { ok:false, failedStep, reason } on failure.
   */
  async getRenameStatus({ jobId }: { jobId?: string } = {}) {
    const id = String(jobId || '').trim();
    if (!id) return err('jobId required');
    const job = _renameJobs.get(id);
    if (!job) {
      return err(`No rename job with id "${id}" — it may have finished and expired, or never existed. If you just renamed, assume it completed.`);
    }
    const done = job.status !== 'running';
    let message;
    if (job.status === 'running') {
      const last = job.steps[job.steps.length - 1];
      message = `Rename in progress — ${job.steps.length} step(s) done${last ? `, last: "${last.step}"` : ''}. Poll again.`;
    } else if (job.status === 'done') {
      message = job.result?.warning
        ? `Rename succeeded: project is now "${job.result.newName}". Warning: ${job.result.warning}`
        : `Rename succeeded: project renamed to "${job.result?.newName}".`;
    } else {
      message = `Rename FAILED at step "${job.result?.failedStep}": ${job.result?.reason}`;
    }
    return ok({ jobId: id, status: job.status, done, steps: job.steps, result: job.result, message });
  },

};
