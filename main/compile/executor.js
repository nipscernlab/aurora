// @ts-check
/**
 * executor.js — spawn-shell-false runner for structured CommandSpec.
 *
 * Replaces the `exec-command` + raw-shell-string idiom that the old
 * compile pipeline used (see TODO at top of main/ipc/compile.js). A
 * spec describes WHAT to run; this module is the only thing that
 * actually fires `spawn(binary, args, { cwd, env, shell:false })`.
 * With shell:false, every arg goes to the child as-is — there is no
 * shell parsing, so no quoting bugs and no injection vector. That is
 * the whole reason the AI-driven override system can exist safely.
 *
 * The executor enforces, in order:
 *   1) the binary is on the toolchain allowlist (binary_allowlist.js),
 *   2) any registered command override has been applied by the
 *      renderer (the spec is already merged on arrival — we don't
 *      re-merge here), and
 *   3) the *resulting* spec preserves protected flags
 *      (protected_flags.js).
 *
 * Two IPC handlers are registered:
 *   - `exec-spec`           : one-shot, returns { code, stdout, stderr }
 *   - `exec-spec-streamed`  : streams stdout/stderr lines as they
 *                             arrive via `exec-spec-stream` events,
 *                             returns { code } on close. Used by the
 *                             vvp/verilator pass-2 simulations so the
 *                             user sees $display lines live.
 */

'use strict';

const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const log = require('electron-log');

const state = require('../state');
const { getCPUCount } = require('../utils');
const { isAllowed } = require('./binary_allowlist');
const protectedFlags = require('./protected_flags');

/**
 * Build the child-process env. We merge in three layers:
 *   process.env → toolchain perf defaults → spec.env (overrides win).
 * If `spec.prependPath` is set, those dirs are prefixed onto PATH
 * AFTER the merge so they always take precedence.
 *
 * @param {object} spec
 */
function buildChildEnv(spec) {
  const cpuCount = getCPUCount();
  const env = {
    ...process.env,
    OMP_NUM_THREADS: cpuCount.toString(),
    OMP_THREAD_LIMIT: cpuCount.toString(),
    ...(spec.env || {}),
  };
  if (Array.isArray(spec.prependPath) && spec.prependPath.length) {
    const sep = process.platform === 'win32' ? ';' : ':';
    env.PATH = spec.prependPath.join(sep) + sep + (env.PATH || '');
  }
  return env;
}

/**
 * Common validation shared by both handlers.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
function validateSpecForExec(spec, baseSpecForProtection) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' };
  if (typeof spec.binary !== 'string' || !spec.binary) {
    return { ok: false, error: 'spec.binary must be a non-empty string' };
  }
  if (!Array.isArray(spec.args)) return { ok: false, error: 'spec.args must be an array' };
  for (let i = 0; i < spec.args.length; i++) {
    if (typeof spec.args[i] !== 'string') {
      return { ok: false, error: `spec.args[${i}] must be a string (got ${typeof spec.args[i]})` };
    }
  }
  if (typeof spec.cwd !== 'string' || !spec.cwd) {
    return { ok: false, error: 'spec.cwd must be a non-empty string' };
  }
  const allowed = isAllowed(spec.binary);
  if (!allowed.ok) return allowed;

  // Protected-flag check only applies when the caller supplied a base
  // spec (i.e., overrides were applied). Same-spec call (no overrides)
  // trivially preserves the base shape.
  if (baseSpecForProtection && baseSpecForProtection.step) {
    const guard = protectedFlags.check(baseSpecForProtection.step, baseSpecForProtection, spec);
    if (!guard.ok) return guard;
  }
  return { ok: true };
}

function register() {
  /**
   * One-shot: spawn the binary, capture stdout+stderr to strings,
   * resolve when the child exits. Same shape `exec-command` returns
   * so the renderer's `processExecutableOutput` keeps working.
   *
   * Payload: { spec, baseSpec?, displayCommand? }
   *   - spec        : the spec to actually run (overrides already applied)
   *   - baseSpec    : the un-overridden spec; if present, executor
   *                   re-runs the protected-flags check
   *   - displayCommand : optional pre-formatted command line for logs;
   *                      executor logs this verbatim
   */
  ipcMain.handle('exec-spec', async (_event, payload) => {
    const spec = payload?.spec;
    const baseSpec = payload?.baseSpec || null;
    const v = validateSpecForExec(spec, baseSpec);
    if (!v.ok) {
      log.warn('[exec-spec] rejected:', v.error);
      return { code: -1, stdout: '', stderr: v.error, error: v.error };
    }

    return new Promise((resolve) => {
      const env = buildChildEnv(spec);
      const child = spawn(spec.binary, spec.args, {
        cwd: spec.cwd,
        env,
        windowsHide: true,
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid }));
      child.on('error', (err) => {
        resolve({ code: -1, stdout, stderr: stderr + (err?.message || String(err)), error: err?.message || String(err) });
      });
    });
  });

  /**
   * Streaming: same payload, but stdout/stderr chunks fire
   * `exec-spec-stream` events as they arrive. The renderer subscribes
   * via electronAPI.onExecSpecStream before invoking. Used by
   * vvp/verilator pass-2 so $display output shows up live in twave.
   *
   * The child is parked in state.currentVvpProcess so `cancel-vvp-
   * process` can kill it (works for any long-running toolchain step,
   * not just vvp — the slot name is historical).
   */
  ipcMain.handle('exec-spec-streamed', async (event, payload) => {
    const spec = payload?.spec;
    const baseSpec = payload?.baseSpec || null;
    const v = validateSpecForExec(spec, baseSpec);
    if (!v.ok) {
      log.warn('[exec-spec-streamed] rejected:', v.error);
      return { code: -1, error: v.error };
    }

    return new Promise((resolve) => {
      const env = buildChildEnv(spec);
      const child = spawn(spec.binary, spec.args, {
        cwd: spec.cwd,
        env,
        windowsHide: true,
        shell: false,
      });

      state.currentVvpProcess = child;
      state.vvpProcessPid = child.pid;

      child.stdout?.on('data', (data) => {
        event.sender.send('exec-spec-stream', { type: 'stdout', data: data.toString() });
      });
      child.stderr?.on('data', (data) => {
        event.sender.send('exec-spec-stream', { type: 'stderr', data: data.toString() });
      });
      child.on('close', (code) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        resolve({ code });
      });
      child.on('error', (err) => {
        state.currentVvpProcess = null;
        state.vvpProcessPid = null;
        resolve({ code: -1, error: err?.message || String(err) });
      });
    });
  });

  /**
   * Diagnostic — lets the renderer (and via tool_bridge, the AI)
   * fetch the list of allowed binaries without trying to spawn one.
   * Used by the `list_allowed_binaries` MCP tool.
   */
  ipcMain.handle('exec-spec-allowed-binaries', async () => {
    const { listAllowedBinaries } = require('./binary_allowlist');
    return listAllowedBinaries();
  });

  /**
   * Diagnostic — protected flag table per step. Used by the
   * `list_allowed_flags` MCP tool so the AI can introspect WHAT it
   * is and is not allowed to mutate before attempting an override.
   */
  ipcMain.handle('exec-spec-protected-flags', async (_e, step) => {
    if (step) return protectedFlags.describe(step);
    // No step → list all.
    const out = {};
    for (const stepId of Object.keys(protectedFlags.RULES || {})) {
      out[stepId] = protectedFlags.describe(stepId);
    }
    return out;
  });
}

module.exports = { register };
