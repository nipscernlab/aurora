/**
 * spec_runner.ts: the renderer-side wrapper that turns a base
 * CommandSpec into a real exec call.
 *
 * Pipeline:
 *   base spec (from a builder)
 *     → applyResolved() merges persisted + ephemeral overrides
 *     → terminal hint logged if any override fired
 *     → exec-spec / exec-spec-streamed via electronAPI (main side
 *       re-validates against the binary allowlist + protected flags)
 *     → result returned to caller
 *
 * Each step's invocation through this wrapper is the single chokepoint
 * the AI's override system uses. Anything that bypasses spec_runner
 * (legacy execCommand calls, the prism IPC) won't honor overrides:
 * intentional: those are non-toolchain or main-managed paths.
 *
 * Compilado por `tsc` (npm run build:ts) num spec_runner.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { applyResolved } from './command_overrides.js';
import * as CommandSpec from './command_spec.js';
import type { CommandSpec as CommandSpecType, CommandOverride } from './command_spec.js';
import type { OverrideSource } from './command_overrides.js';

/** Details handed to the audit hook once per run. */
export interface AuditInfo {
  step: string;
  processorName: string | null;
  sources: OverrideSource[];
  diff: ReturnType<typeof CommandSpec.diffSpecs>;
  note: string | null;
}

type AuditHook = (info: AuditInfo) => void;
type TerminalHook = (channel: string, message: string, level: string) => void;

/** Optional callback fired once per run with the resolved spec details. */
let auditHook: AuditHook | null = null;
/** Optional callback fired with `(channel, message, level)` for terminal hints. */
let terminalHook: TerminalHook | null = null;

export function setAuditHook(fn: unknown): void { auditHook = typeof fn === 'function' ? fn as AuditHook : null; }
export function setTerminalHook(fn: unknown): void { terminalHook = typeof fn === 'function' ? fn as TerminalHook : null; }

/** O que o observador recebe por ferramenta executada. */
export interface RunObservation {
  step: string;
  binary: string;
  args: string[];
  cwd: string | null;
  code: number | null;
  ms: number;
}
type RunObserver = (obs: RunObservation) => void;

/**
 * Observador de TODA execucao, e nao so das que levaram override.
 *
 * O `auditHook` acima parece servir para isto e nao serve: ele so dispara
 * quando ha override da IA, porque nasceu para auditar exatamente isso. O
 * registro de execucao precisa da ferramenta que rodou mesmo quando nada foi
 * sobrescrito, que e o caso normal.
 *
 * Fica aqui porque este modulo e o unico ponto de passagem de todo comando da
 * toolchain; qualquer outro lugar veria uma parte.
 */
let runObserver: RunObserver | null = null;
export function setRunObserver(fn: unknown): void { runObserver = typeof fn === 'function' ? fn as RunObserver : null; }

function observar(spec: CommandSpecType, resultado: ExecSpecResult, inicio: number): ExecSpecResult {
  if (runObserver) {
    try {
      runObserver({
        step: spec.step,
        binary: spec.binary,
        args: Array.isArray(spec.args) ? spec.args.slice() : [],
        cwd: spec.cwd ?? null,
        code: resultado && typeof resultado.code === 'number' ? resultado.code : null,
        ms: Math.round(performance.now() - inicio),
      });
    } catch { /* o registro nunca pode derrubar a compilacao */ }
  }
  return resultado;
}

function logOverride(
  spec: CommandSpecType,
  baseSpec: CommandSpecType,
  override: CommandOverride | null,
  sources: OverrideSource[],
  channel: string | null,
): void {
  if (!override) return;
  const diff = CommandSpec.diffSpecs(baseSpec, spec);
  const parts: string[] = [];
  if (diff.added.length)   parts.push(`+args: ${diff.added.join(' ')}`);
  if (diff.removed.length) parts.push(`-args: ${diff.removed.join(' ')}`);
  for (const [k, v] of Object.entries(diff.envAdded))   parts.push(`+env: ${k}=${v}`);
  for (const k of diff.envRemoved)                       parts.push(`-env: ${k}`);
  for (const [k, c] of Object.entries(diff.envChanged)) parts.push(`~env: ${k}: ${c.from} → ${c.to}`);

  const msg = `[AI override${override.note ? ' — ' + override.note : ''}] ${parts.join('; ') || '(no diff)'}`;
  if (channel && terminalHook) terminalHook(channel, msg, 'tips');
  if (auditHook) {
    auditHook({
      step: baseSpec.step,
      processorName: baseSpec.processorName || null,
      sources,
      diff,
      note: override.note || null,
    });
  }
}

/** Pick the terminal id Aurora uses for a given step. */
function terminalForStep(step: string): string | null {
  if (step === 'cmm')                          return 'tcmm';
  if (step === 'asm-pre' || step === 'asm')    return 'tasm';
  if (step.startsWith('iverilog'))             return 'tveri';
  if (step.startsWith('vvp'))                  return 'twave';
  if (step.startsWith('cocotb'))               return 'twave';
  if (step.startsWith('verilator'))            return 'twave';
  if (step === 'fst2vcd' || step === 'gtkwave') return 'twave';
  if (step === 'yosys-hierarchy')              return 'twave';
  if (step === 'prism-yosys')                  return 'tveri';
  return null;
}

/**
 * Run a base spec through the override pipeline and dispatch via the
 * one-shot exec-spec IPC. Returns whatever main returns:
 *   { code, stdout, stderr, pid }
 * On allowlist or protected-flag rejection, returns { code:-1, stderr:<reason> }.
 */
export async function runSpec(baseSpec: CommandSpecType, options: { consumeEphemeral?: boolean } = {}): Promise<ExecSpecResult> {
  if (!baseSpec) throw new Error('runSpec: baseSpec is required');
  const shape = CommandSpec.validateShape(baseSpec);
  if (!shape.ok) throw new Error(`runSpec: invalid base spec: ${shape.error}`);

  const { appliedSpec, override, sources } =
    await applyResolved(baseSpec, { consumeEphemeral: !!options.consumeEphemeral });

  logOverride(appliedSpec, baseSpec, override, sources, terminalForStep(baseSpec.step));

  const inicio = performance.now();
  return observar(appliedSpec, await electronAPI.execSpec({
    spec: appliedSpec,
    baseSpec, // main re-runs protected-flag check
  }), inicio);
}

/**
 * Streaming variant: same pipeline, but stdout/stderr fire
 * `exec-spec-stream` events. Caller wires onExecSpecStream BEFORE
 * invoking and unsubscribes when this promise resolves.
 */
export async function runSpecStreamed(baseSpec: CommandSpecType, options: { consumeEphemeral?: boolean } = {}): Promise<ExecSpecResult> {
  if (!baseSpec) throw new Error('runSpecStreamed: baseSpec is required');
  const shape = CommandSpec.validateShape(baseSpec);
  if (!shape.ok) throw new Error(`runSpecStreamed: invalid base spec: ${shape.error}`);

  const { appliedSpec, override, sources } =
    await applyResolved(baseSpec, { consumeEphemeral: !!options.consumeEphemeral });

  logOverride(appliedSpec, baseSpec, override, sources, terminalForStep(baseSpec.step));

  const inicio = performance.now();
  return observar(appliedSpec, await electronAPI.execSpecStreamed({
    spec: appliedSpec,
    baseSpec,
  }), inicio);
}

/** Result of {@link resolveSpec}, an override-applied spec without running it. */
export interface ResolvedSpecPreview {
  baseSpec: CommandSpecType;
  appliedSpec: CommandSpecType;
  override: CommandOverride | null;
  sources: OverrideSource[];
  formatted: string;
  formattedBase: string;
  diff: ReturnType<typeof CommandSpec.diffSpecs>;
}

/**
 * Build the override-applied spec WITHOUT running it. Used by the
 * AI's inspect_compile_command / preview_compile_command tools.
 *
 * Pass `extraOverride` to layer a hypothetical AI-proposed override
 * on top of what's already registered, that's preview semantics.
 */
export async function resolveSpec(baseSpec: CommandSpecType, extraOverride: CommandOverride | null = null): Promise<ResolvedSpecPreview> {
  const { appliedSpec, override, sources } = await applyResolved(baseSpec);
  let finalSpec = appliedSpec;
  let finalOverride: CommandOverride | null = override;
  if (extraOverride) {
    finalSpec = CommandSpec.applyOverride(finalSpec, extraOverride);
    finalOverride = finalOverride ? { ...finalOverride } : {};
    if (extraOverride.appendArgs)  finalOverride.appendArgs  = [...(finalOverride.appendArgs || []), ...extraOverride.appendArgs];
    if (extraOverride.prependArgs) finalOverride.prependArgs = [...(finalOverride.prependArgs || []), ...extraOverride.prependArgs];
    if (extraOverride.removeArgs)  finalOverride.removeArgs  = [...(finalOverride.removeArgs || []), ...extraOverride.removeArgs];
    if (extraOverride.envSet)      finalOverride.envSet      = { ...(finalOverride.envSet || {}), ...extraOverride.envSet };
    if (extraOverride.envUnset)    finalOverride.envUnset    = [...(finalOverride.envUnset || []), ...extraOverride.envUnset];
  }
  return {
    baseSpec,
    appliedSpec: finalSpec,
    override: finalOverride,
    sources,
    formatted: CommandSpec.formatSpec(finalSpec),
    formattedBase: CommandSpec.formatSpec(baseSpec),
    diff: CommandSpec.diffSpecs(baseSpec, finalSpec),
  };
}
