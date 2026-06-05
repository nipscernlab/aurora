// @ts-check
/**
 * process_registry.js — central registry of every toolchain child process
 * Aurora spawns (CMM/ASM compilers, iverilog, vvp, Verilator + g++/make/ccache,
 * yosys for PRISM, gtkwave, cocotb/python) plus the single routine that
 * force-stops all of them.
 *
 * Why a registry: cleanup used to kill a hardcoded short list (vvp.exe,
 * gtkwave.exe) + anything under components/Temp/. That missed yosys — PRISM
 * runs it straight from the bundled mingw64/bin, not Temp/ — and any tool that
 * fans out a process tree (Verilator → make → g++). Tracking the actual
 * ChildProcess objects lets us tree-kill them by PID (taskkill /F /T)
 * regardless of binary name or location, so closing the main interface never
 * leaves a compile, simulation, GTKWave or PRISM synthesis running.
 */

'use strict';

const path = require('path');

const state = require('./state');
const { componentsPath } = require('./paths');
const {
  killProcessSilently,
  killProcessesByName,
  killProcessesByPathPrefix,
} = require('./utils');

/**
 * Register a freshly-spawned toolchain child so stopAllToolchain() can
 * force-kill it. Auto-unregisters when the child exits, so the set only ever
 * holds live processes. Returns the same child for call-site chaining:
 * `const c = trackChild(spawn(...))`.
 *
 * @template {import('child_process').ChildProcess} T
 * @param {T} child
 * @returns {T}
 */
function trackChild(child) {
  if (!child || typeof child.pid !== 'number') return child;
  state.childProcesses.add(child);
  const drop = () => state.childProcesses.delete(child);
  child.once('exit', drop);
  child.once('close', drop);
  child.once('error', drop);
  return child;
}

/**
 * Force-stop everything Aurora launched in the background. Best-effort and
 * idempotent — safe to call on both main-window close and app before-quit.
 *
 * Covers, in order:
 *   1. every tracked child, tree-killed by PID (iverilog, vvp, Verilator +
 *      its g++/make/ccache workers, yosys, cocotb/python, gtkwave, …);
 *   2. the legacy single-slot simulation process, in case it wasn't tracked;
 *   3. the bundled vvp/gtkwave by name — a backstop for grandchildren that
 *      outlived their parent's tree-kill;
 *   4. any Verilator-built V<top>.exe still running under components/Temp/;
 *   5. the AI agent CLIs (Claude Code / Codex) and their subprocess trees;
 *   6. in-flight AI chat generations (e.g. gemini) — the HTTP streams are
 *      aborted so a long generation stops the instant the interface closes.
 *
 * @returns {Promise<void>}
 */
async function stopAllToolchain() {
  const tasks = [];

  // 1) Tracked children — precise tree-kill by PID.
  for (const child of state.childProcesses) {
    if (child && typeof child.pid === 'number' && !child.killed) {
      tasks.push(killProcessSilently(child.pid));
    }
  }
  state.childProcesses.clear();

  // 2) Legacy single-slot sim process (executor keeps it in sync).
  if (state.currentVvpProcess && !state.currentVvpProcess.killed && state.currentVvpProcess.pid) {
    tasks.push(killProcessSilently(state.currentVvpProcess.pid));
  }

  // 3) Name sweeps — backstop for detached/re-spawned bundled tools.
  tasks.push(killProcessesByName('vvp.exe'));
  tasks.push(killProcessesByName('gtkwave.exe'));

  // 4) Verilator emits V<top>.exe under components/Temp/obj_dir_*; its name
  //    varies per testbench, so sweep the whole scratch tree by path prefix.
  tasks.push(killProcessesByPathPrefix(path.join(componentsPath, 'Temp') + path.sep));

  // 5) AI agent CLIs (Claude Code / Codex) own their own subprocess trees.
  try { require('./ai/claude_code').killAll(); } catch (_) { /* not loaded */ }
  try { require('./ai/codex_cli').killAll(); } catch (_) { /* not loaded */ }

  // 6) In-flight AI chat generations (gemini, etc.) — abort the HTTP streams.
  try { require('./ai/chat').abortAll(); } catch (_) { /* not loaded */ }

  await Promise.all(tasks);

  state.currentVvpProcess = null;
  state.vvpProcessPid = null;
  state.currentGtkwaveProcesses.clear();
}

module.exports = { trackChild, stopAllToolchain };
