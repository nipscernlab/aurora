/**
 * command_spec.ts: structured representation of a toolchain invocation.
 *
 * Replaces the old "concatenate a shell string" idiom that lived in
 * compilation_module.js. A CommandSpec describes WHAT to run; the
 * executor in main decides HOW (spawn with shell:false). This is the
 * shape Aurora Intelligence overrides plug into, see
 * command_overrides.js + the compile.* MCP tools.
 *
 * Invariants:
 *   - `binary` is an absolute path (validated by main against the
 *     toolchain allowlist; renderer never executes anything itself).
 *   - `args` is an array of POSITIONAL tokens; no shell quoting.
 *     A path with spaces is one element, not '"path with spaces"'.
 *   - `cwd` and `env` are optional but, when present, structured (no
 *     `cd "..." && cmd` idioms).
 *
 * Compilado por `tsc` (npm run build:ts) num command_spec.js ao lado, é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */

export type CompileStepId =
  | 'cmm' | 'asm-pre' | 'asm'
  | 'iverilog-check' | 'iverilog-build'
  | 'vvp-run' | 'cocotb-run'
  | 'verilator-build' | 'verilator-run'
  | 'verilator-json' | 'verilator-tb-build' | 'verilator-tb-run'
  | 'fst2vcd' | 'gtkwave'
  | 'yosys-hierarchy' | 'prism-yosys';

export interface CommandSpec {
  step: CompileStepId;
  /** absolute path */
  binary: string;
  args: string[];
  cwd: string;
  /** extra env vars (merged onto process.env in main) */
  env?: Record<string, string>;
  /** dirs prepended to PATH for this run */
  prependPath?: string[];
  /** when the step is per-processor */
  processorName?: string;
  /** short human-readable description ("cmm: DTW") */
  label?: string;
}

export interface CommandOverride {
  /** added at the end of args */
  appendArgs?: string[];
  /** inserted right after the binary */
  prependArgs?: string[];
  /** exact-match removed (no-op if absent) */
  removeArgs?: string[];
  envSet?: Record<string, string>;
  envUnset?: string[];
  /** free-text for audit log */
  note?: string;
  scope?: 'ephemeral' | 'persisted';
}

/** Result of {@link diffSpecs}. */
export interface SpecDiff {
  added: string[];
  removed: string[];
  envAdded: Record<string, string>;
  envRemoved: string[];
  envChanged: Record<string, { from: string; to: string }>;
}

export const STEP_IDS = Object.freeze([
  'cmm', 'asm-pre', 'asm',
  'iverilog-check', 'iverilog-build',
  'vvp-run',
  'cocotb-run',
  'verilator-build', 'verilator-run',
  'verilator-json', 'verilator-tb-build', 'verilator-tb-run',
  'fst2vcd', 'gtkwave',
  'yosys-hierarchy', 'prism-yosys',
] as const);

export const STEP_DESCRIPTIONS: Record<CompileStepId, string> = Object.freeze({
  'cmm':              'CMM compiler (cmmcomp.exe) — .cmm → .asm + cmm_log.txt',
  'asm-pre':          'Assembly preprocessor (appcomp.exe) — expand macros into Temp/',
  'asm':              'Assembly compiler (asmcomp.exe) — .asm → Hardware/<proc>.v + pc_*_mem.txt + Simulation/<proc>_tb.v',
  'iverilog-check':   'Icarus Verilog syntax/elab check (iverilog -tnull) — Verilog button + Wave-Config gate',
  'iverilog-build':   'Icarus Verilog build (iverilog -o) — produces .vvp consumed by vvp',
  'vvp-run':          'vvp — full simulation with -fst, produces FST waveform (header pulled from the FST)',
  'cocotb-run':       'cocotb Python runner — builds Verilog with Icarus and runs Python tests',
  'verilator-build':  'Verilator build — Verilog → C++ → native .exe',
  'verilator-run':    'Verilator — full simulation, native .exe (header pulled from the FST)',
  'verilator-json':   'Verilator --json-only — dump processor port AST (V<proc>.tree.json)',
  'verilator-tb-build':'Verilator --cc --exe --build with the SAPHO processor C++ harness (clock loop + req_in/out_en one-hot wiring)',
  'verilator-tb-run': 'Run V<proc>.exe (CMM-processor harness) — reads input_<N>.txt, writes output_<N>.txt',
  'fst2vcd':          'fst2vcd conversion (FST → text VCD)',
  'gtkwave':          'GTKWave launch (--dark, --rcvar, -a, --script)',
  'yosys-hierarchy':  'Yosys design hierarchy emission (write_json)',
  'prism-yosys':      'PRISM Yosys synthesis (RTL schematic for netlistsvg)',
});

/**
 * Build a copy of `spec` with the override applied. Pure, never
 * mutates the input. Protected flag enforcement is the caller's
 * responsibility (lives in protected_flags.js, called by the
 * executor in main).
 */
export function applyOverride(spec: CommandSpec, ov: CommandOverride | null | undefined): CommandSpec {
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
 * Render a spec to a printable command line (display only, never fed
 * to a shell). Tokens with whitespace are double-quoted; backslashes
 * are escaped so the displayed string is parser-safe to read.
 */
export function formatSpec(spec: CommandSpec | null | undefined): string {
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
 */
export function diffSpecs(before: CommandSpec | null | undefined, after: CommandSpec | null | undefined): SpecDiff {
  const a = new Set(before?.args || []);
  const b = new Set(after?.args || []);
  const added = [...(after?.args || [])].filter((x) => !a.has(x));
  const removed = [...(before?.args || [])].filter((x) => !b.has(x));
  const envBefore: Record<string, string> = before?.env || {};
  const envAfter: Record<string, string> = after?.env || {};
  const envAdded: Record<string, string> = {};
  const envRemoved: string[] = [];
  const envChanged: Record<string, { from: string; to: string }> = {};
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
 * Shallow validation, caller should still hand the spec to the main
 * executor, which re-validates against the binary allowlist.
 */
export function validateShape(spec: unknown): { ok: true } | { ok: false; error: string } {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' };
  const s = spec as Record<string, unknown>;
  if (!(STEP_IDS as readonly string[]).includes(s.step as string)) return { ok: false, error: `unknown step: ${String(s.step)}` };
  if (typeof s.binary !== 'string' || !s.binary) return { ok: false, error: 'binary must be a non-empty string' };
  if (!Array.isArray(s.args)) return { ok: false, error: 'args must be an array' };
  for (const a of s.args) {
    if (typeof a !== 'string') return { ok: false, error: 'every arg must be a string' };
  }
  if (typeof s.cwd !== 'string' || !s.cwd) return { ok: false, error: 'cwd must be a non-empty string' };
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
