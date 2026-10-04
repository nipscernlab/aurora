/**
 * compile_ns.ts: o namespace `AuroraAPI.compile`, os gatilhos do pipeline (os
 * mesmos da barra de ferramentas), o estado da ultima execucao e os overrides
 * de comando que a Aurora Intelligence registra para cada passo.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiCompile.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num compile_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { listOverrides, setOverride, clearOverride } from '../compilation/command_overrides.js';
import { resolveSpec } from '../compilation/spec_runner.js';
import { STEP_IDS, STEP_DESCRIPTIONS } from '../compilation/command_spec.js';
import type { CommandOverride } from '../compilation/command_spec.js';
import { ehPassoDaApi } from '../compilation/api_steps.js';
import { ok, err, emit } from './api_core.js';

const ERRO_JA_RODANDO =
  'a compilation is already running; wait for it to finish or cancel it first';

/**
 * O fluxo de compilacao, o mesmo objeto que a barra de ferramentas usa.
 *
 * Antes era lido da global `compilationFlowManager` do window, que o
 * renderer.js punha so para esta API ler (item 13.2 do TODO). O import e sob
 * demanda, como o do spec_factory abaixo, porque o compilation_flow arrasta o
 * modulo de compilacao, as abas e o rewind, e quem so monta a API (os testes,
 * e a IA lendo um terminal) nao precisa carregar nada disso.
 */
async function fluxoDeCompilacao() {
  return (await import('../compilation/compilation_flow.js')).compilationFlowManager;
}

/** A mensagem de uma excecao qualquer, ou a de reserva. */
const motivo = (e: unknown, reserva: string): string => (e as Error | null)?.message || reserva;

/** O pedido de override: o passo, o processador e o resto e o override em si. */
interface PedidoDeOverride extends CommandOverride {
  step?: string;
  processorName?: string | null;
  persist?: unknown;
}

export const compileNs = {
  /** Run the full project pipeline (cmm → verilog → wave → prism). */
  async compileAll() {
    const cf = await fluxoDeCompilacao();
    emit('compile:started', { scope: 'all' });
    // Uma execucao de cada vez. Quem chega em cima de outra recebe a recusa,
    // e nao um ok mentiroso que a faria esperar por um resultado que nunca
    // vem. O aviso no terminal sai de dentro do runAll, que e' por onde o
    // botao da toolbar tambem passa.
    try {
      if (await cf.runAll() === false) return err(ERRO_JA_RODANDO);
      return ok();
    }
    catch (e) { return err(motivo(e, 'compileAll failed')); }
  },

  /**
   * Run a single pipeline step.
   *   - 'cmm'   : cmmcomp + asmcomp (regenerates .asm from .cmm)
   *   - 'asm'   : asmcomp + iverilog + vvp (SKIPS cmmcomp, used by Aurora
   *               Intelligence to test a hand-optimised .asm without losing it)
   *   - 'verilog'/'wave'/'prism'/'verilator-proc': existing
   *   - 'verilator-fast': Verilator headless run (no waveform), Verilator-only
   */
  async compileStep(step: string) {
    const cf = await fluxoDeCompilacao();
    // 'cpp' e o mesmo passo de fonte que 'cmm'; o despacho por linguagem
    // (processor_dispatch.ts) escolhe o front end pelo fonte em foco.
    if (!ehPassoDaApi(step)) {
      return err(`unknown compile step: ${step}`);
    }
    emit('compile:started', { scope: step });
    try {
      if (await cf.runSingleStep(step) === false) return err(ERRO_JA_RODANDO);
      return ok({ step });
    }
    catch (e) { return err(motivo(e, 'compileStep failed')); }
  },

  /**
   * Run the ACTIVE SAPHO processor's generated top-level (`<proc>.v`) under
   * Verilator as a hardware test, the `verilatorproc` toolbar button. Drives
   * SAPHO's predictable wiring (req_in/out_en one-hot, decimal
   * input_<N>.txt/output_<N>.txt under the processor's Simulation/ folder) and
   * recompiles cmm+asm first so the .v/_tb.v/.mif are fresh. Acts on the
   * processor currently shown in the status bar, fails if none is active.
   * Thin wrapper over compileStep('verilator-proc') so validation + the
   * compile:started event stay single-sourced. Calls through `compileNs`
   * (not `this`): the AI tool_runner invokes namespace methods as bare
   * `fn(...args)`, so `this` is undefined inside them.
   */
  async runVerilatorProc() {
    return compileNs.compileStep('verilator-proc');
  },

  /**
   * Run the project's testbench headless via Verilator, NO waveform, NO
   * GTKWave, the `fastsim` toolbar button, optimised purely for speed.
   * Needs a testbench set; a Verilog testbench requires the simulator to be
   * Verilator (see wave.setSimulator), while a Python cocotb (.py) testbench
   * runs headless on any engine. Recompiles cmm+asm first when the top-level
   * instantiates SAPHO processors. Thin wrapper over
   * compileStep('verilator-fast'). Calls through `compileNs` (not `this`):
   * the AI tool_runner invokes namespace methods as bare `fn(...args)`.
   */
  async runFastSim() {
    return compileNs.compileStep('verilator-fast');
  },

  async cancel() {
    const cf = await fluxoDeCompilacao();
    // O evento sai de dentro do cancelAll, e nao daqui: cancelar pelo botao da
    // interface nao passa por esta funcao, e emitir nos dois lugares faria a
    // ferramenta da IA disparar o evento duas vezes.
    try { cf.cancelAll(); return ok(); }
    catch (e) { return err(motivo(e, 'cancel failed')); }
  },

  /**
   * Como terminou a ultima execucao: rodando, concluida ou cancelada.
   *
   * A IA sabia quando uma compilacao ACABAVA, mas nao quando era cancelada, e a
   * diferenca importa: um turno que pediu para compilar e ficava sem resposta
   * concluia sozinho que algo travou, e seguia investigando um problema que nao
   * existia. Com isto ela pergunta e descobre que o usuario simplesmente parou.
   *
   * O estado e lido do gerenciador de compilacao, que ja o mantem; nao ha
   * estado novo para desincronizar.
   */
  async runStatus() {
    const cf = await fluxoDeCompilacao();
    const cancelada = !!cf.wasCancelled?.();
    const rodando = !!cf.isRunning?.();
    return ok({
      running: rodando,
      cancelled: cancelada,
      state: rodando ? 'running' : (cancelada ? 'cancelled' : 'idle'),
      note: cancelada
        ? 'The user cancelled the last run. Do not treat the missing result as a failure or a hang.'
        : undefined,
    });
  },

  // -----------------------------------------------------------------
  // Aurora-Intelligence-driven command overrides. Each toolchain step
  // (cmm, asm, iverilog-check, iverilog-build, vvp-run,
  // verilator-build/run, fst2vcd, gtkwave, yosys-hierarchy,
  // prism-yosys) can have an override that appends/prepends/removes
  // args and tweaks env. See command_overrides.ts + protected_flags.js.
  // -----------------------------------------------------------------

  /** Enumerate every step the override system knows about. */
  async listSteps() {
    return ok({ steps: STEP_IDS.map((id) => ({ id, description: STEP_DESCRIPTIONS[id] })) });
  },

  /**
   * Build the base spec for `step` AND apply any active override.
   * Returns { base, applied, formatted, formattedBase, diff, sources }.
   */
  async inspectCommand(step: string, processorName?: string) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
        sources: resolved.sources,
        hasOverride: !!resolved.override,
      });
    } catch (e) { return err(motivo(e, 'inspectCommand failed')); }
  },

  /**
   * Preview a spec with `extraOverride` layered ON TOP of the active
   * override, WITHOUT registering it. Lets the AI show the user
   * "here's what would happen if I added these flags".
   */
  async previewCommand(step: string, override?: CommandOverride | null, processorName?: string) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base, override || null);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
      });
    } catch (e) { return err(motivo(e, 'previewCommand failed')); }
  },

  /** List every registered override across both layers. */
  async listOverrides() {
    try {
      const items = await listOverrides();
      return ok({ overrides: items });
    } catch (e) { return err(motivo(e, 'listOverrides failed')); }
  },

  /**
   * Register an override. `persist:true` writes to .spf (survives
   * sessions); default is ephemeral (consumed on the next matching
   * step run).
   *
   * Shape: { step, processorName?, appendArgs?, prependArgs?, removeArgs?,
   *          envSet?, envUnset?, persist?, note? }
   */
  async setOverride(payload: PedidoDeOverride | null) {
    try {
      const { step, processorName, persist, note, ...rest } = payload || {};
      const result = await setOverride({
        step: step as string, processorName, override: rest, persist: !!persist, note,
      });
      emit('compile:override-set', { step, processorName, persist: !!persist });
      return ok(result);
    } catch (e) { return err(motivo(e, 'setOverride failed')); }
  },

  async clearOverride(step: string, processorName?: string | null, scope?: 'ephemeral' | 'persisted' | 'both') {
    try {
      const result = await clearOverride({ step, processorName, scope: scope || 'both' });
      emit('compile:override-cleared', { step, processorName });
      return ok(result);
    } catch (e) { return err(motivo(e, 'clearOverride failed')); }
  },

  /** Per-step list of flags the override system refuses to touch. */
  async listProtectedFlags(step?: string) {
    try {
      const result = await electronAPI.getProtectedFlags(step);
      return ok({ step: step || null, protected: result });
    } catch (e) { return err(motivo(e, 'listProtectedFlags failed')); }
  },

  /** Read-only: which binaries the main-process executor will spawn. */
  async listAllowedBinaries() {
    try {
      const result = await electronAPI.listAllowedBinaries();
      return ok({ binaries: result });
    } catch (e) { return err(motivo(e, 'listAllowedBinaries failed')); }
  },
};
