/**
 * spec_runner.js — the renderer-side wrapper that turns a base
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
 * (legacy execCommand calls, the prism IPC) won't honor overrides —
 * intentional: those are non-toolchain or main-managed paths.
 */

import { applyResolved } from './command_overrides.js';
import * as CommandSpec from './command_spec.js';

/** Optional callback fired once per run with the resolved spec details. */
let auditHook = null;
/** Optional callback fired with `(channel, message, level)` for terminal hints. */
let terminalHook = null;

export function setAuditHook(fn) { auditHook = typeof fn === 'function' ? fn : null; }
export function setTerminalHook(fn) { terminalHook = typeof fn === 'function' ? fn : null; }

function logOverride(spec, baseSpec, override, sources, channel) {
  if (!override) return;
  const diff = CommandSpec.diffSpecs(baseSpec, spec);
  const parts = [];
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
function terminalForStep(step) {
  if (step === 'cmm')                          return 'tcmm';
  if (step === 'asm-pre' || step === 'asm')    return 'tasm';
  if (step.startsWith('iverilog'))             return 'tveri';
  if (step.startsWith('vvp'))                  return 'twave';
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
export async function runSpec(baseSpec, options = {}) {
  if (!baseSpec) throw new Error('runSpec: baseSpec is required');
  const shape = CommandSpec.validateShape(baseSpec);
  if (!shape.ok) throw new Error(`runSpec: invalid base spec: ${shape.error}`);

  const { appliedSpec, override, sources } =
    await applyResolved(baseSpec, { consumeEphemeral: !!options.consumeEphemeral });

  logOverride(appliedSpec, baseSpec, override, sources, terminalForStep(baseSpec.step));

  return window.electronAPI.execSpec({
    spec: appliedSpec,
    baseSpec, // main re-runs protected-flag check
  });
}

/**
 * Streaming variant: same pipeline, but stdout/stderr fire
 * `exec-spec-stream` events. Caller wires onExecSpecStream BEFORE
 * invoking and unsubscribes when this promise resolves.
 */
export async function runSpecStreamed(baseSpec, options = {}) {
  if (!baseSpec) throw new Error('runSpecStreamed: baseSpec is required');
  const shape = CommandSpec.validateShape(baseSpec);
  if (!shape.ok) throw new Error(`runSpecStreamed: invalid base spec: ${shape.error}`);

  const { appliedSpec, override, sources } =
    await applyResolved(baseSpec, { consumeEphemeral: !!options.consumeEphemeral });

  logOverride(appliedSpec, baseSpec, override, sources, terminalForStep(baseSpec.step));

  return window.electronAPI.execSpecStreamed({
    spec: appliedSpec,
    baseSpec,
  });
}

/**
 * Build the override-applied spec WITHOUT running it. Used by the
 * AI's inspect_compile_command / preview_compile_command tools.
 *
 * Pass `extraOverride` to layer a hypothetical AI-proposed override
 * on top of what's already registered — that's preview semantics.
 */
export async function resolveSpec(baseSpec, extraOverride = null) {
  const { appliedSpec, override, sources } = await applyResolved(baseSpec);
  let finalSpec = appliedSpec;
  let finalOverride = override;
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
