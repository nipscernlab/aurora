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

// Coalesce the teardown while it is IN FLIGHT. The main-window 'close' handler
// fires it (best-effort), then app before-quit fires it again (authoritative)
// milliseconds later; both must share ONE run so the expensive sweeps don't
// execute twice on a single close.
//
// Cleared once it settles, so a LATER teardown runs for real. This used to be a
// permanent memo, which quietly made "closing the window kills every compile" a
// once-per-process guarantee: a new main window in the same process (the
// second-instance handler opens one per SAPHO launch, and `activate` re-creates
// one) would hand its close the old, already-resolved promise and kill nothing,
// leaving its compiles running headless. Same reasoning for a close that starts
// the teardown and is then vetoed.
let stopPromise = null;

/**
 * Process GROUPS — the cancellation hierarchy.
 *
 * "Cancel everything" must outrank every stage of the SAPHO flow and be able to
 * kill its PID, no matter which stage spawned it or how deep the tree goes. But
 * "everything" cannot mean literally every tracked child: the registry also
 * holds long-lived editor services (the Verible/Slang LSPs, clang-format) that
 * have nothing to do with a build. Tree-killing those on Cancel would silently
 * break diagnostics and formatting for the rest of the session.
 *
 * So each child declares which group it belongs to, and Cancel kills by group:
 *
 *   RUN     — a stage of the compile/simulate flow: cmmcomp, appcomp, asmcomp,
 *             iverilog, vvp, Verilator (+ its perl/make/g++/ccache fan-out),
 *             the built V<top>.exe, cocotb/python, yosys. Cancel kills these.
 *   VIEWER  — waveform viewers (GTKWave, Surfer) launched by a run. Cancel kills
 *             these too: the button is "cancel everything", and a viewer opened
 *             by the run being cancelled belongs to that run.
 *   SERVICE — editor infrastructure with a lifetime independent of any build.
 *             Cancel NEVER touches these; only app teardown does.
 *
 * @typedef {'run'|'viewer'|'service'} ProcGroup
 */
const GROUP = Object.freeze({ RUN: 'run', VIEWER: 'viewer', SERVICE: 'service' });

// Groups a cancel is allowed to kill. SERVICE is deliberately absent.
const CANCELLABLE = Object.freeze(new Set([GROUP.RUN, GROUP.VIEWER]));

/**
 * Register a freshly-spawned toolchain child so stopAllToolchain() can
 * force-kill it. Auto-unregisters when the child exits, so the set only ever
 * holds live processes. Returns the same child for call-site chaining:
 * `const c = trackChild(spawn(...))`.
 *
 * `group` defaults to SERVICE — the *conservative* default. A caller that
 * forgets to tag gets a process Cancel won't kill (an annoyance: the user
 * clicks Cancel and one tool runs on), never one it kills by surprise (a bug:
 * the LSP dies and the editor quietly degrades). Every stage of the SAPHO flow
 * must pass GROUP.RUN explicitly.
 *
 * @template {import('child_process').ChildProcess} T
 * @param {T} child
 * @param {ProcGroup} [group]
 * @returns {T}
 */
function trackChild(child, group = GROUP.SERVICE) {
  if (!child || typeof child.pid !== 'number') return child;
  toolchainEverRan = true; // a real toolchain child ran → arm the close-time sweeps
  /** @type {any} */ (child).__auroraGroup = group;
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
 * @param {ProcGroup} [group] - cancellation group; see GROUP. Anything that is
 *   a stage of the compile/simulate flow MUST pass GROUP.RUN, or the Cancel
 *   button will not be able to stop it.
 * @returns {import('child_process').ChildProcess}
 */
function spawnTracked(command, args, options, group) {
  return trackChild(
    spawn(command, /** @type {any} */ (args), /** @type {any} */ (options)),
    group,
  );
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
  if (!stopPromise) {
    // Release the coalescing slot once this run settles (either way) so a later
    // close/quit gets a real teardown rather than this run's stale result.
    stopPromise = runStopAllToolchain().finally(() => { stopPromise = null; });
  }
  return stopPromise;
}

/**
 * Cancel-scoped teardown: stop the CURRENT run, whatever stage it is in.
 *
 * This is what the "cancel everything" button reaches. It sits ABOVE the SAPHO
 * flow rather than inside it: it does not ask which step is running or wait for
 * a step to reach a checkpoint — it walks the registry and tree-kills every
 * live RUN/VIEWER process by PID. That is the whole point of routing spawns
 * through the registry: a stage that fans out (Verilator → perl → make → g++ →
 * ccache, cocotb → python → the simulator) dies whole, because taskkill /T
 * takes the tree, and a stage nobody remembered to special-case still dies,
 * because it is in the registry like every other.
 *
 * Deliberately NOT this function's job (unlike stopAllToolchain):
 *   • SERVICE children (LSPs, clang-format) — they outlive any single run;
 *   • the AI CLIs and in-flight chat streams — cancelling a build must not
 *     abort the user's unrelated Aurora Intelligence conversation.
 *
 * Not memoized either — stopAllToolchain runs once per app lifetime, but a
 * cancel can happen on every run.
 *
 * @returns {Promise<{hadActive: boolean, killed: number}>}
 *   `hadActive` false ⇒ the user clicked Cancel with nothing running, which the
 *   renderer surfaces as "nothing to cancel" instead of a false confirmation.
 */
async function stopToolchainRun() {
  const tasks = [];
  const seen = new Set();   // PIDs already scheduled — the slot below usually
                            // points at a child we just killed via the registry

  // 1) The registry is the authority — every live RUN/VIEWER child, tree-killed
  //    by PID regardless of binary name, location, or how it was reached.
  for (const child of [...state.childProcesses]) {
    const group = /** @type {any} */ (child).__auroraGroup;
    if (!CANCELLABLE.has(group)) continue;               // SERVICE: leave it be
    if (!child || typeof child.pid !== 'number' || child.killed) continue;
    seen.add(child.pid);
    tasks.push(killProcessSilently(child.pid));
    state.childProcesses.delete(child);
  }

  // 2) The legacy single-slot sim process, in case it escaped tracking.
  const slot = state.currentVvpProcess;
  if (slot && !slot.killed && typeof slot.pid === 'number' && !seen.has(slot.pid)) {
    seen.add(slot.pid);
    tasks.push(killProcessSilently(slot.pid));
  }

  const killed = seen.size;

  // 3) Backstops for grandchildren that outlived their parent's tree-kill:
  //    bundled tools by name, and Verilator's per-testbench V<top>.exe (whose
  //    name varies, so only a path-prefix match is safe) under components/Temp.
  //    Only worth their cost — the path sweep enumerates every process on the
  //    box — when something was actually running; a Cancel on an idle IDE stays
  //    instant.
  if (killed > 0) {
    tasks.push(killProcessesByName('vvp.exe'));
    tasks.push(killProcessesByName('gtkwave.exe'));
    tasks.push(killProcessesByPathPrefix(path.join(componentsPath, 'Temp') + path.sep));
  }

  await Promise.all(tasks);

  state.currentVvpProcess = null;
  state.vvpProcessPid = null;
  state.currentGtkwaveProcesses.clear();

  return { hadActive: killed > 0, killed };
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

/**
 * Mata o que sobrou de uma sessao anterior. Roda no arranque, DEPOIS de o
 * bloqueio de instancia unica ter sido obtido: nesse ponto somos o unico
 * aplicativo vivo, entao qualquer processo rodando de dentro da nossa pasta de
 * componentes so pode ser orfao de uma execucao que morreu mal.
 *
 * Por que existe: um vvp.exe, um gtkwave ou um servidor de linguagem que
 * sobreviva ao fechamento continua segurando arquivo dentro de components/, e
 * arquivo em uso e o que faz uma instalacao terminar pela metade, com a pasta
 * de destino vazia e o instalador sem conseguir substituir o que estava
 * travado. Limpar na saida e o certo, e e o que o stopAllToolchain faz; isto
 * aqui e a rede para quando a saida nao foi limpa, que e justamente o caso em
 * que ninguem estava olhando.
 */
async function reapOrphans() {
  if (process.platform !== 'win32') return;
  try {
    const prefix = componentsPath;
    if (!prefix) return;
    await killProcessesByPathPrefix(prefix, 8000);
  } catch (_err) {
    // Faxina nunca impede o arranque.
  }
}

module.exports = { GROUP, trackChild, spawnTracked, stopAllToolchain, stopToolchainRun, reapOrphans };
