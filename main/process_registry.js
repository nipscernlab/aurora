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
const { spawn } = require('child_process');

const state = require('./state');
const { componentsPath } = require('./paths');
const {
  killProcessSilently,
  killProcessesByName,
  killProcessesByPathPrefix,
} = require('./utils');

// Did ANY toolchain child spawn this session? The name/path sweeps below are
// backstops for grandchildren that outlived their parent's tree-kill — they can
// only exist if a parent ran. Each sweep costs real time (a cold-started
// taskkill, and a PowerShell `Get-CimInstance Win32_Process` that enumerates
// EVERY process on the box — ~1-3 s), so when nothing ever ran we skip them and
// an edit-only session closes instantly instead of paying for a teardown with
// nothing to tear down. Set in trackChild, read in stopAllToolchain.
let toolchainEverRan = false;

// Memoize the teardown. The main-window 'close' handler fires it (best-effort),
// then app before-quit fires it again (authoritative). Both must share ONE run
// so the expensive sweeps don't execute twice on a single close.
let stopPromise = null;

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
  toolchainEverRan = true; // a real toolchain child ran → arm the close-time sweeps
  state.childProcesses.add(child);
  const drop = () => state.childProcesses.delete(child);
  child.once('exit', drop);
  child.once('close', drop);
  child.once('error', drop);
  return child;
}

/**
 * G9: the single, mandatory spawn entry point for toolchain children.
 * `spawnTracked(...)` is exactly `trackChild(spawn(...))` — spawning through
 * it makes "register for tree-kill on close" automatic, so a new toolchain
 * spawn can't forget `trackChild` and leak a zombie (yosys/verilator/g++/make,
 * the LSP servers, clang-format, gtkwave, and any future OSS tool). Same
 * signature + return value as child_process.spawn (throws synchronously on bad
 * args just like spawn, so existing try/catch around a spawn keeps working).
 *
 * NB: the AI-agent CLIs (claude_code/codex_cli) deliberately do NOT go through
 * here — they own their own process trees and are torn down via their killAll()
 * in stopAllToolchain(); double-tracking them would fight that lifecycle.
 *
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {import('child_process').SpawnOptions} [options]
 * @returns {import('child_process').ChildProcess}
 */
function spawnTracked(command, args, options) {
  return trackChild(spawn(command, /** @type {any} */ (args), /** @type {any} */ (options)));
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
function stopAllToolchain() {
  if (!stopPromise) stopPromise = runStopAllToolchain();
  return stopPromise;
}

async function runStopAllToolchain() {
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

  // 3+4) Expensive external-process sweeps — ONLY if a toolchain child actually
  //   ran this session. These are backstops for detached/re-spawned bundled
  //   tools (3, by name) and Verilator's per-testbench V<top>.exe under
  //   components/Temp/ (4, by path prefix). Each one cold-starts a process and
  //   (for 4) makes PowerShell enumerate EVERY process via WMI — the dominant
  //   cost of closing the IDE. If nothing ever spawned, there are provably no
  //   orphans, so we skip them and the close is instant.
  if (toolchainEverRan) {
    tasks.push(killProcessesByName('vvp.exe'));
    tasks.push(killProcessesByName('gtkwave.exe'));
    tasks.push(killProcessesByPathPrefix(path.join(componentsPath, 'Temp') + path.sep));
  }

  // 5) AI agent CLIs (Claude Code / Codex) own their own subprocess trees.
  //    Cheap — these kill only their OWN tracked PIDs (no global scan).
  try { require('./ai/claude_code').killAll(); } catch (_) { /* not loaded */ }
  try { require('./ai/codex_cli').killAll(); } catch (_) { /* not loaded */ }

  // 6) In-flight AI chat generations (gemini, etc.) — abort the HTTP streams.
  try { require('./ai/chat').abortAll(); } catch (_) { /* not loaded */ }

  await Promise.all(tasks);

  state.currentVvpProcess = null;
  state.vvpProcessPid = null;
  state.currentGtkwaveProcesses.clear();
}

module.exports = { trackChild, spawnTracked, stopAllToolchain };
