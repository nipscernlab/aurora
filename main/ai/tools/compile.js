// @ts-check
/**
 * Compile tools — `api` namespace 'compile' (run pipeline steps, inspect/override commands).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'compile_all',
    description: 'Run the full SAPHO compilation pipeline (CMM, ASM, Verilog, wave, PRISM).',
    access: 'write',
    api: [ 'compile', 'compileAll' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'compile_step',
    description: 'Run a single compilation step. "cmm" regenerates the .asm from .cmm and assembles; "asm" SKIPS cmmcomp and runs asmcomp + iverilog -tnull (use this to test an .asm you hand-optimised — typically combined with a `set_command_override` on the asm step\'s -i flag pointing at <proc>/Software/_aurora_opt/<proc>.asm); "verilog" elaborates the project Verilog; "wave" opens GTKWave; "prism" opens the PRISM RTL viewer; "verilator-proc" runs the ACTIVE processor\'s generated top-level under Verilator as a hardware test; "verilator-fast" runs the testbench headless under Verilator (no waveform, fastest). For the two Verilator simulations the dedicated run_verilator_proc / run_fast_sim tools are equivalent and clearer.',
    access: 'write',
    api: [ 'compile', 'compileStep' ],
    argStyle: 'positional',
    argNames: [ 'step' ],
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          enum: [ 'cmm', 'asm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast' ]
        }
      },
      required: [ 'step' ]
    }
  },
  {
    name: 'run_verilator_proc',
    description: `Run the ACTIVE SAPHO processor's generated top-level (<proc>.v) under Verilator as a hardware test — the "Verilator (processor)" toolbar button (id: verilatorproc). Uses SAPHO's predictable wiring (req_in/out_en one-hot, decimal input_<N>.txt/output_<N>.txt in the processor's Simulation/ folder) and recompiles cmm+asm first so the .v/_tb.v/.mif are fresh. Acts on the processor currently focused/shown in the status bar — fails if no processor is active. Output lands in the hardware-test (thtest) terminal; read it with get_terminal_output("thtest"). This can be slow — for long runs prefer run_in_background({task:"compile_step", step:"verilator-proc"}).`,
    access: 'write',
    api: [ 'compile', 'runVerilatorProc' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'run_fast_sim',
    description: 'Run the project testbench headless via Verilator with NO waveform and NO GTKWave — the "Fast Sim" toolbar button (id: fastsim), optimised purely for speed. Requires a testbench to be set (set_testbench_top). A Verilog testbench requires the simulator to be Verilator (set_simulator("verilator")); a Python cocotb (.py) testbench runs headless on any engine. Recompiles cmm+asm first when the top-level instantiates SAPHO processors. Output lands in the wave (twave) terminal; read it with get_terminal_output("twave"). For long runs prefer run_in_background({task:"compile_step", step:"verilator-fast"}).',
    access: 'write',
    api: [ 'compile', 'runFastSim' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cancel_compilation',
    description: 'Cancel a running compilation or simulation.',
    access: 'write',
    api: [ 'compile', 'cancel' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_compile_steps',
    description: 'Enumerate every toolchain step whose command line Aurora Intelligence can override (cmm, asm, iverilog-check, iverilog-build, vvp-run, verilator-build, verilator-run, fst2vcd, gtkwave, yosys-hierarchy, prism-yosys). Each entry includes a short description of when the step runs.',
    access: 'read',
    api: [ 'compile', 'listSteps' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'inspect_compile_command',
    description: 'Return the structured CommandSpec ({binary, args, cwd, env, prependPath}) that would be executed for one toolchain step RIGHT NOW, including any override the AI or the user has registered. Includes a printable command line and a diff vs. the base spec.',
    access: 'read',
    api: [ 'compile', 'inspectCommand' ],
    argStyle: 'positional',
    argNames: [ 'step', 'processorName' ],
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          description: 'One of: cmm, asm-pre, asm, iverilog-check, iverilog-build, vvp-run, verilator-build, verilator-run, fst2vcd, gtkwave, yosys-hierarchy, prism-yosys'
        },
        processorName: {
          type: 'string',
          description: 'For per-processor steps (cmm, asm-pre, asm). Omit for global steps.'
        }
      },
      required: [ 'step' ]
    }
  },
  {
    name: 'preview_compile_command',
    description: 'Dry-run a hypothetical override on a step WITHOUT registering it. Returns the same shape as inspect_compile_command, but with the proposed override layered on top of the current state. Use this to show the user what the resulting command line would look like before calling set_command_override.',
    access: 'read',
    api: [ 'compile', 'previewCommand' ],
    argStyle: 'positional',
    argNames: [ 'step', 'override', 'processorName' ],
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string' },
        override: {
          type: 'object',
          properties: {
            appendArgs: { type: 'array', items: { type: 'string' } },
            prependArgs: { type: 'array', items: { type: 'string' } },
            removeArgs: { type: 'array', items: { type: 'string' } },
            envSet: { type: 'object' },
            envUnset: { type: 'array', items: { type: 'string' } }
          }
        },
        processorName: { type: 'string' }
      },
      required: [ 'step', 'override' ]
    }
  },
  {
    name: 'list_command_overrides',
    description: 'List every registered command override across the ephemeral (in-memory, consumed on next run) and persisted (.spf, survives sessions) layers.',
    access: 'read',
    api: [ 'compile', 'listOverrides' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_protected_compile_flags',
    description: 'List the flags that the override system refuses to remove or stomp for one (or every) step — Aurora pipeline invariants like iverilog -o, gtkwave --script, verilator --binary. Omit step to get the whole table.',
    access: 'read',
    api: [ 'compile', 'listProtectedFlags' ],
    argStyle: 'positional',
    argNames: [ 'step' ],
    inputSchema: { type: 'object', properties: { step: { type: 'string' } } }
  },
  {
    name: 'list_allowed_compile_binaries',
    description: 'List the binaries the main-process executor will spawn. Aurora Intelligence cannot redirect a step to a binary outside this allowlist — only flags and env are editable.',
    access: 'read',
    api: [ 'compile', 'listAllowedBinaries' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_command_override',
    description: 'Register an override for one toolchain step. By default the override is EPHEMERAL — consumed on the next time that step runs. Pass persist:true to write it into the .spf so it survives across sessions. Supplying both global (no processorName) and per-processor overrides for the same step is allowed; the per-processor one wins for that processor. Use preview_compile_command first to verify the resulting command line. The main-process executor re-checks protected flags before spawn — if the override would strip a pipeline-critical flag (iverilog -o, gtkwave --script, etc.), the step run fails with a clear error.',
    access: 'write',
    api: [ 'compile', 'setOverride' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', description: 'See list_compile_steps for the full set' },
        processorName: { type: 'string', description: 'For per-processor steps only' },
        appendArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Flags appended after the existing args'
        },
        prependArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Flags inserted right after the binary'
        },
        removeArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tokens removed by exact match (protected flags rejected)'
        },
        envSet: { type: 'object', description: 'Env vars to set (string values)' },
        envUnset: { type: 'array', items: { type: 'string' }, description: 'Env vars to unset' },
        persist: {
          type: 'boolean',
          description: 'true → write to .spf; false (default) → ephemeral, consumed on next run'
        },
        note: {
          type: 'string',
          description: 'Free-text note that lands in the audit log + terminal hint'
        }
      },
      required: [ 'step' ]
    }
  },
  {
    name: 'clear_command_override',
    description: 'Remove a registered override. `scope` controls which layer: "ephemeral" (in-memory only), "persisted" (.spf only), or "both" (default).',
    access: 'write',
    api: [ 'compile', 'clearOverride' ],
    argStyle: 'positional',
    argNames: [ 'step', 'processorName', 'scope' ],
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string' },
        processorName: { type: 'string' },
        scope: { type: 'string', enum: [ 'ephemeral', 'persisted', 'both' ] }
      },
      required: [ 'step' ]
    }
  }
];
