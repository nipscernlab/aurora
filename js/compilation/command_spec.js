/**
 * command_spec.js — structured representation of a toolchain invocation.
 *
 * Replaces the old "concatenate a shell string" idiom that lived in
 * compilation_module.js. A CommandSpec describes WHAT to run; the
 * executor in main decides HOW (spawn with shell:false). This is the
 * shape Aurora Intelligence overrides plug into — see
 * command_overrides.js + the compile.* MCP tools.
 *
 * Invariants:
 *   - `binary` is an absolute path (validated by main against the
 *     toolchain allowlist; renderer never executes anything itself).
 *   - `args` is an array of POSITIONAL tokens; no shell quoting.
 *     A path with spaces is one element, not '"path with spaces"'.
 *   - `cwd` and `env` are optional but, when present, structured (no
 *     `cd "..." && cmd` idioms).
 */

/**
 * @typedef {(
 *   'cmm'|'asm-pre'|'asm'|
 *   'iverilog-check'|'iverilog-build'|
 *   'vvp-header'|'vvp-run'|
 *   'verilator-build'|'verilator-header'|'verilator-run'|
 *   'verilator-json'|'verilator-tb-build'|'verilator-tb-run'|
 *   'fst2vcd'|'gtkwave'|
 *   'yosys-hierarchy'|'prism-yosys'
 * )} CompileStepId
 */

/**
 * @typedef {Object} CommandSpec
 * @property {CompileStepId} step
 * @property {string}        binary                    absolute path
 * @property {string[]}      args
 * @property {string}        cwd
 * @property {Object.<string,string>} [env]            extra env vars (merged onto process.env in main)
 * @property {string[]}      [prependPath]             dirs prepended to PATH for this run
 * @property {string}        [processorName]           when the step is per-processor
 * @property {string}        [label]                   short human-readable description ("cmm: DTW")
 */

/**
 * @typedef {Object} CommandOverride
 * @property {string[]} [appendArgs]                   added at the end of args
 * @property {string[]} [prependArgs]                  inserted right after the binary
 * @property {string[]} [removeArgs]                   exact-match removed (no-op if absent)
 * @property {Object.<string,string>} [envSet]
 * @property {string[]} [envUnset]
 * @property {string}   [note]                         free-text for audit log
 * @property {'ephemeral'|'persisted'} [scope]
 */

export const STEP_IDS = Object.freeze([
  'cmm', 'asm-pre', 'asm',
  'iverilog-check', 'iverilog-build',
  'vvp-header', 'vvp-run',
  'verilator-build', 'verilator-header', 'verilator-run',
  'verilator-json', 'verilator-tb-build', 'verilator-tb-run',
  'fst2vcd', 'gtkwave',
  'yosys-hierarchy', 'prism-yosys',
]);

export const STEP_DESCRIPTIONS = Object.freeze({
  'cmm':              'CMM compiler (cmmcomp.exe) — .cmm → .asm + cmm_log.txt',
  'asm-pre':          'Assembly preprocessor (appcomp.exe) — expand macros into Temp/',
  'asm':              'Assembly compiler (asmcomp.exe) — .asm → Hardware/<proc>.v + pc_*_mem.txt + Simulation/<proc>_tb.v',
  'iverilog-check':   'Icarus Verilog syntax/elab check (iverilog -tnull) — Verilog button + Wave-Config gate',
  'iverilog-build':   'Icarus Verilog build (iverilog -o) — produces .vvp consumed by vvp',
  'vvp-header':       'vvp pass-1 — runs instrumented testbench with +AURORA_HEADER_ONLY, produces VCD header only',
  'vvp-run':          'vvp pass-2 — full simulation with -fst, produces FST waveform',
  'verilator-build':  'Verilator build — Verilog → C++ → native .exe',
  'verilator-header': 'Verilator pass-1 — runs .exe with +AURORA_HEADER_ONLY for header capture',
  'verilator-run':    'Verilator pass-2 — full simulation, native .exe',
  'verilator-json':   'Verilator --json-only — dump top-level port AST (V<top>.tree.json)',
  'verilator-tb-build':'Verilator --cc --exe --build with a manual C++ harness — top-level clock loop + file I/O',
  'verilator-tb-run': 'Run V<top>.exe top-level harness — reads <pin>.in, writes <pin>.out',
  'fst2vcd':          'fst2vcd conversion (used after Verilator pass-1)',
  'gtkwave':          'GTKWave launch (--dark, --rcvar, -a, --script)',
  'yosys-hierarchy':  'Yosys design hierarchy emission (write_json)',
  'prism-yosys':      'PRISM Yosys synthesis (RTL schematic for netlistsvg)',
});

/**
 * Build a copy of `spec` with the override applied. Pure — never
 * mutates the input. Protected flag enforcement is the caller's
 * responsibility (lives in protected_flags.js, called by the
 * executor in main).
 *
 * @param {CommandSpec} spec
 * @param {CommandOverride} ov
 * @returns {CommandSpec}
 */
export function applyOverride(spec, ov) {
  if (!ov) return spec;
  let args = spec.args.slice();
  if (Array.isArray(ov.removeArgs) && ov.removeArgs.length) {
    const drop = new Set(ov.removeArgs);
    args = args.filter((a) => !drop.has(a));
  }
  if (Array.isArray(ov.prependArgs) && ov.prependArgs.length) {
    args = ov.prependArgs.concat(args);
  }
  if (Array.isArray(ov.appendArgs) && ov.appendArgs.length) {
    args = args.concat(ov.appendArgs);
  }
  let env = spec.env ? { ...spec.env } : undefined;
  if (ov.envSet && Object.keys(ov.envSet).length) {
    env = { ...(env || {}), ...ov.envSet };
  }
  if (Array.isArray(ov.envUnset) && ov.envUnset.length) {
    if (env) {
      for (const k of ov.envUnset) delete env[k];
    }
  }
  return { ...spec, args, env };
}

/**
 * Render a spec to a printable command line (display only — never fed
 * to a shell). Tokens with whitespace are double-quoted; backslashes
 * are escaped so the displayed string is parser-safe to read.
 *
 * @param {CommandSpec} spec
 * @returns {string}
 */
export function formatSpec(spec) {
  if (!spec) return '';
  const tokens = [spec.binary, ...(spec.args || [])];
  const out = tokens.map((t) => {
    const s = String(t ?? '');
    if (!s) return '""';
    // Quote if it contains whitespace, quote, equals, or windows path delim.
    if (/[\s"]/.test(s)) {
      return '"' + s.replace(/"/g, '\\"') + '"';
    }
    return s;
  }).join(' ');
  return out;
}

/**
 * Compare two specs (typically base vs. override-applied) and report
 * what changed. Used by the ask-before-write modal and the audit log.
 *
 * @param {CommandSpec} before
 * @param {CommandSpec} after
 */
export function diffSpecs(before, after) {
  const a = new Set(before?.args || []);
  const b = new Set(after?.args || []);
  const added = [...(after?.args || [])].filter((x) => !a.has(x));
  const removed = [...(before?.args || [])].filter((x) => !b.has(x));
  const envBefore = before?.env || {};
  const envAfter = after?.env || {};
  const envAdded = {};
  const envRemoved = [];
  const envChanged = {};
  for (const k of Object.keys(envAfter)) {
    if (!(k in envBefore)) envAdded[k] = envAfter[k];
    else if (envBefore[k] !== envAfter[k]) envChanged[k] = { from: envBefore[k], to: envAfter[k] };
  }
  for (const k of Object.keys(envBefore)) {
    if (!(k in envAfter)) envRemoved.push(k);
  }
  return { added, removed, envAdded, envRemoved, envChanged };
}

/**
 * Shallow validation — caller should still hand the spec to the main
 * executor, which re-validates against the binary allowlist.
 *
 * @param {CommandSpec} spec
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateShape(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' };
  if (!STEP_IDS.includes(spec.step)) return { ok: false, error: `unknown step: ${spec.step}` };
  if (typeof spec.binary !== 'string' || !spec.binary) return { ok: false, error: 'binary must be a non-empty string' };
  if (!Array.isArray(spec.args)) return { ok: false, error: 'args must be an array' };
  for (const a of spec.args) {
    if (typeof a !== 'string') return { ok: false, error: 'every arg must be a string' };
  }
  if (typeof spec.cwd !== 'string' || !spec.cwd) return { ok: false, error: 'cwd must be a non-empty string' };
  return { ok: true };
}

// Convenience aggregate for non-module consumers (e.g. legacy globals
// or quick console inspection). ESM importers use the named exports
// above; `import * as CommandSpec from './command_spec.js'` resolves
// against those, not this object.
if (typeof window !== 'undefined') {
  window.CommandSpec = Object.freeze({
    STEP_IDS,
    STEP_DESCRIPTIONS,
    applyOverride,
    formatSpec,
    diffSpecs,
    validateShape,
  });
}
