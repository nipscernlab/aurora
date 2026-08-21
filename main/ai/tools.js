// @ts-check
/**
 * tools.js: the tool manifest Aurora Intelligence is allowed to call.
 *
 * Each entry maps a function-calling tool to an `AuroraAPI` namespace
 * method in the renderer. The manifest is *pure data* (no closures) so
 * it can be shipped over IPC verbatim, the renderer's tool_runner
 * pulls it and uses the same `api` / `argStyle` / `argNames` fields to
 * dispatch the call, which keeps a single source of truth.
 *
 * `access`:
 *   - 'read' , pure inspection, runs without prompting.
 *   - 'write', mutates the workspace; the renderer shows an
 *               ask-before-write confirmation before executing.
 *
 * `argStyle` tells the renderer how to turn the JSON args object into
 * the AuroraAPI call:
 *   - 'none'        → fn()
 *   - 'positional'  → fn(args[argNames[0]], args[argNames[1]], ...)
 *   - 'object'      → fn(args)
 */

'use strict';

// `ai` is loaded defensively so a broken install does not crash the main
// process at module load. buildTools (which is the only function that
// actually uses these) checks for null before doing anything.
/** @type {any} */ let tool;
/** @type {any} */ let jsonSchema;
try {
  ({ tool, jsonSchema } = require('ai'));
} catch (_) {
  // Silently ignored, provider.js logs the same failure once.
}

/** @typedef {{ name:string, description:string, access:'read'|'write', api:[string,string], argStyle:'none'|'positional'|'object', argNames?:string[], inputSchema:object }} ToolDef */

/** @type {ToolDef[]} */
const TOOL_MANIFEST = [
  /* ---- read: inspection, no confirmation ---- */
  {
    name: 'get_active_file',
    description: 'Get the path of the file currently focused in the editor.',
    access: 'read',
    api: ['editor', 'getActiveFilePath'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_open_files',
    description: 'List the file paths of every open editor tab.',
    access: 'read',
    api: ['editor', 'getOpenFiles'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_active_file',
    description: 'Read the full text content of the file currently focused in the editor.',
    access: 'read',
    api: ['editor', 'getActiveText'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_cursor',
    description: 'Get the current cursor position (1-indexed line and column) in the active editor.',
    access: 'read',
    api: ['editor', 'getCursor'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_terminal_output',
    description: 'Read the visible text of a compiler terminal panel. Omit terminalId for the currently visible panel.',
    access: 'read',
    api: ['terminal', 'getText'],
    argStyle: 'positional',
    argNames: ['terminalId'],
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: 'One of: tcmm, tasm, tveri, twave, tprism' },
      },
    },
  },
  {
    name: 'get_current_project',
    description: 'Get the path and metadata of the SAPHO project currently open.',
    access: 'read',
    api: ['project', 'getCurrent'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_tree',
    description: 'List ALL files in the open project recursively, as relative paths (e.g. "src/main.cmm"). Use this before read_file to get the exact path of any file.',
    access: 'read',
    api: ['project', 'getTree'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Read the full text of ANY file inside the open project folder, at any nesting depth — not just the focused editor tab. Use get_project_tree to discover paths first.',
    access: 'read',
    api: ['project', 'readFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path, or a path relative to the project root',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'list_directives',
    description: 'List all SAPHO hardware directives (NBMANT, NBEXPO, NUBITS, ...).',
    access: 'read',
    api: ['rules', 'listDirectives'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_directive',
    description: 'Get the default value and description of one SAPHO hardware directive.',
    access: 'read',
    api: ['rules', 'getDirective'],
    argStyle: 'positional',
    argNames: ['name'],
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Directive name, e.g. NBMANT' } },
      required: ['name'],
    },
  },
  {
    name: 'lookup_compiler_message',
    description: 'Look up a yanc compiler message by code (e.g. MSG_ERR_SYNTAX); returns its bilingual text and severity.',
    access: 'read',
    api: ['rules', 'lookupMessage'],
    argStyle: 'positional',
    argNames: ['code'],
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Message code, e.g. MSG_ERR_SYNTAX' } },
      required: ['code'],
    },
  },
  {
    name: 'list_terminals',
    description: 'List the ids of every compiler terminal panel.',
    access: 'read',
    api: ['terminal', 'list'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_all_terminals',
    description: 'Read the visible text of EVERY terminal panel at once, keyed by id (tcmm, tasm, tveri, twave, ...).',
    access: 'read',
    api: ['terminal', 'getAll'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_in_terminal',
    description:
      "Type — and optionally run — a command in the user's TCMD terminal: their " +
      'REAL interactive shell (PowerShell on Windows), the one they can see, NOT a ' +
      'sandbox. Use execute:false to just place the command on the input line for the ' +
      "user to review and press Enter (great for \"what's the command to compile in " +
      'python again?"); execute:true (the default) runs it and returns a best-effort ' +
      'snapshot of the output. `cd` and environment changes PERSIST in the session, so ' +
      'you can navigate folders and chain commands. This is the human shell — for real ' +
      'SAPHO builds/sims prefer compile_all / compile_step / run_fast_sim; use this for ' +
      'ad-hoc shell commands, navigation, git one-offs, running the user\'s python, etc.',
    access: 'write',
    api: ['terminal', 'runInShell'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command line to type/run.' },
        execute: { type: 'boolean', description: 'true (default) runs it and returns output; false just types it for the user to run.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_processors',
    description: 'List the processors of the open project together with their configuration.',
    access: 'read',
    api: ['project', 'listProcessors'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_missing_files',
    description:
      'List the project\'s MISSING files — paths the .spf still references but that no longer ' +
      'exist on disk (moved, renamed, or deleted outside Aurora). Same list the file tree\'s ' +
      'missing-files warning shows, always current. Returns { count, files:[{name, path, ' +
      'category}] }; empty when nothing is missing. Use this to reason about a broken build or ' +
      'before offering to clean up dangling references with dismiss_missing_files.',
    access: 'read',
    api: ['project', 'getMissingFiles'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_memories',
    description:
      'List everything you were told to remember about THIS project (from ' +
      '<root>/.aurora/memory/). The same memories are already injected into your ' +
      'system prompt each turn, so call this only to audit or before forget().',
    access: 'read',
    api: ['project', 'listMemories'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'remember',
    description:
      'Save ONE durable fact about this project to <root>/.aurora/memory/<name>.md, ' +
      'so it survives across chats. Use it for what the code and git do NOT already ' +
      'record: a decision and its rationale, a user preference about how to work, a ' +
      'constraint, an external reference. Do NOT save what a tool can re-derive (file ' +
      'lists, paths, compile output) or what only matters to the current turn. One ' +
      'fact per name; writing an existing name OVERWRITES it, which is how you update. ' +
      'Prefer updating a related memory over creating a near-duplicate.',
    access: 'write',
    api: ['project', 'remember'],
    argStyle: 'positional',
    argNames: ['name', 'content'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short kebab-case id, e.g. "porta-adc-q20". Slugified; it is the filename.' },
        content: { type: 'string', description: 'The fact, in Markdown. State it plainly and say WHY it matters.' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'forget',
    description:
      'Delete one project memory by name — use when a remembered fact turned out to be ' +
      'wrong or went stale. Returns { removed:false } when there was no such memory.',
    access: 'write',
    api: ['project', 'forget'],
    argStyle: 'positional',
    argNames: ['name'],
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The memory id, as listed by list_memories.' } },
      required: ['name'],
    },
  },
  {
    name: 'analyze_asm',
    description:
      'Parse a SAPHO assembly (.asm) file and return a structured summary: total instruction ' +
      'count, count per opcode, count per family (memory/arith_float/arith_int/control/io/...), ' +
      'labels with line numbers, and detected loops (back-jumps with body size). Use this to ' +
      'find optimisation targets (the largest loops) and to verify an optimisation actually ' +
      'reduced the instruction count. Provide either filePath OR processorName; if neither, ' +
      'the active editor file is used (must be .asm).',
    access: 'read',
    api: ['project', 'analyzeAsm'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:      { type: 'string', description: 'Absolute or project-relative path to a .asm file' },
        processorName: { type: 'string', description: 'Resolves to <root>/<proc>/Software/<proc>.asm' },
      },
    },
  },
  {
    name: 'list_opcodes',
    description:
      'List every SAPHO assembly opcode (mnemonic, numeric opcode, operand kind, family ' +
      'classification, prefix variants, one-line description). Use this when reasoning about ' +
      'which instruction family dominates a loop and which alternative encoding might shrink it.',
    access: 'read',
    api: ['rules', 'listOpcodes'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_opcode',
    description: 'Look up one SAPHO assembly opcode by mnemonic (case-insensitive).',
    access: 'read',
    api: ['rules', 'getOpcode'],
    argStyle: 'positional',
    argNames: ['mnemonic'],
    inputSchema: {
      type: 'object',
      properties: { mnemonic: { type: 'string', description: 'e.g. F_MLT, P_LOD, NRM_M' } },
      required: ['mnemonic'],
    },
  },
  {
    name: 'get_settings',
    description: 'Read the user-facing IDE settings: locale, tooltips, verbose mode.',
    access: 'read',
    api: ['settings', 'getAll'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_wave_signals',
    description: 'List every signal discovered for the current testbench and which are selected to be shown in GTKWave.',
    access: 'read',
    api: ['wave', 'listSignals'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },

  /* ---- write: mutates the workspace, ask-before-write ---- */
  {
    name: 'write_active_file',
    description: 'Replace the ENTIRE content of the active editor file. Prefer insert_text or replace_range for smaller edits.',
    access: 'write',
    api: ['editor', 'setActiveText'],
    argStyle: 'positional',
    argNames: ['text'],
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The new full file content' } },
      required: ['text'],
    },
  },
  {
    name: 'insert_text',
    description: 'Insert text into the active editor at a 1-indexed line/column. Omit position to insert at the cursor.',
    access: 'write',
    api: ['editor', 'insertAt'],
    argStyle: 'positional',
    argNames: ['text', 'position'],
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to insert, verbatim. Include any newlines you want.' },
        position: {
          type: 'object',
          description: '1-indexed {line, column}. Omit to insert at the cursor.',
          properties: {
            line: { type: 'number', description: '1-indexed line.' },
            column: { type: 'number', description: '1-indexed column.' },
          },
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'replace_range',
    description: 'Replace a range of text in the active editor (1-indexed line/column, end-exclusive column).',
    access: 'write',
    api: ['editor', 'replaceRange'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        startLine: { type: 'number', description: 'First line of the range, 1-indexed.' },
        startColumn: { type: 'number', description: 'First column of the range, 1-indexed.' },
        endLine: { type: 'number', description: 'Last line of the range, 1-indexed and inclusive.' },
        endColumn: { type: 'number', description: 'Column just past the last character to replace, 1-indexed.' },
        text: { type: 'string', description: 'Replacement text. Empty string deletes the range.' },
      },
      required: ['startLine', 'startColumn', 'endLine', 'endColumn', 'text'],
    },
  },
  {
    name: 'save_file',
    description: 'Save the active editor file to disk.',
    access: 'write',
    api: ['editor', 'save'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'compile_all',
    description: 'Run the full SAPHO compilation pipeline (CMM, ASM, Verilog, wave, PRISM).',
    access: 'write',
    api: ['compile', 'compileAll'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_in_background',
    description:
      'Run a long compile task in the BACKGROUND and return immediately so the current turn can ' +
      'end. When the task finishes, YOU are automatically given the result as a new turn and ' +
      'should report it to the user — i.e. start the work, tell the user you will report back, ' +
      'let the turn finish, and Aurora re-invokes you on completion. Use this for long ' +
      'compiles/simulations instead of blocking on compile_all/compile_step. task is ' +
      '"compile_all" or "compile_step" (then pass step); optionally pass a short note describing ' +
      'the intent so your follow-up turn has context.',
    access: 'write',
    api: ['ai', 'runInBackground'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', enum: ['compile_all', 'compile_step'], description: 'Short description of what is running, shown to the user in the status bar.' },
        step: { type: 'string', enum: ['cmm', 'asm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast'], description: 'Required when task is compile_step' },
        note: { type: 'string', description: 'Short description of the goal, echoed back to you on completion' },
      },
      required: ['task'],
    },
  },
  {
    name: 'compile_step',
    description:
      'Run a single compilation step. "cmm" regenerates the .asm from .cmm and assembles; ' +
      '"asm" SKIPS cmmcomp and runs asmcomp + iverilog -tnull (use this to test an .asm you ' +
      'hand-optimised — typically combined with a `set_command_override` on the asm step\'s ' +
      '-i flag pointing at <proc>/Software/_aurora_opt/<proc>.asm); "verilog" elaborates the ' +
      'project Verilog; "wave" opens GTKWave; "prism" opens the PRISM RTL viewer; ' +
      '"verilator-proc" runs the ACTIVE processor\'s generated top-level under Verilator as a ' +
      'hardware test; "verilator-fast" runs the testbench headless under Verilator (no waveform, ' +
      'fastest). For the two Verilator simulations the dedicated run_verilator_proc / run_fast_sim ' +
      'tools are equivalent and clearer.',
    access: 'write',
    api: ['compile', 'compileStep'],
    argStyle: 'positional',
    argNames: ['step'],
    inputSchema: {
      type: 'object',
      properties: { step: { type: 'string', enum: ['cmm', 'asm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast'], description: 'Which pipeline step to run. Call list_compile_steps for the valid ids.' } },
      required: ['step'],
    },
  },
  {
    name: 'run_verilator_proc',
    description:
      'Run the ACTIVE SAPHO processor\'s generated top-level (<proc>.v) under Verilator as a ' +
      'hardware test — the "Verilator (processor)" toolbar button (id: verilatorproc). Uses ' +
      'SAPHO\'s predictable wiring (req_in/out_en one-hot, decimal input_<N>.txt/output_<N>.txt ' +
      'in the processor\'s Simulation/ folder) and recompiles cmm+asm first so the .v/_tb.v/.mif ' +
      'are fresh. Acts on the processor currently focused/shown in the status bar — fails if no ' +
      'processor is active. Output lands in the hardware-test (thtest) terminal; read it with ' +
      'get_terminal_output("thtest"). This can be slow — for long runs prefer ' +
      'run_in_background({task:"compile_step", step:"verilator-proc"}).',
    access: 'write',
    api: ['compile', 'runVerilatorProc'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_fast_sim',
    description:
      'Run the project testbench headless via Verilator with NO waveform and NO GTKWave — the ' +
      '"Fast Sim" toolbar button (id: fastsim), optimised purely for speed. Requires a testbench ' +
      'to be set (set_testbench_top). A Verilog testbench requires the simulator to be Verilator ' +
      '(set_simulator("verilator")); a Python cocotb (.py) testbench runs headless on any engine. ' +
      'Recompiles cmm+asm first when the top-level instantiates SAPHO processors. Output lands in ' +
      'the wave (twave) terminal; read it with get_terminal_output("twave"). For long runs prefer ' +
      'run_in_background({task:"compile_step", step:"verilator-fast"}).',
    access: 'write',
    api: ['compile', 'runFastSim'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_compilation',
    description: 'Cancel a running compilation or simulation.',
    access: 'write',
    api: ['compile', 'cancel'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_file',
    description: 'Create a new file (or overwrite an existing one) with the given content.',
    access: 'write',
    api: ['project', 'createFile'],
    argStyle: 'positional',
    argNames: ['filePath', 'content'],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path of the file' },
        content: { type: 'string', description: 'File content (empty if omitted)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a directory, including any missing parent folders. Use a project-relative path; creating one that already exists is not an error.',
    access: 'write',
    api: ['project', 'createFolder'],
    argStyle: 'positional',
    argNames: ['dirPath'],
    inputSchema: {
      type: 'object',
      properties: { dirPath: { type: 'string', description: 'Absolute path of the directory' } },
      required: ['dirPath'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory.',
    access: 'write',
    api: ['project', 'deleteFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'Absolute or project-relative path of the file to delete.' } },
      required: ['filePath'],
    },
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file from one absolute path to another.',
    access: 'write',
    api: ['project', 'renameFile'],
    argStyle: 'positional',
    argNames: ['fromPath', 'toPath'],
    inputSchema: {
      type: 'object',
      properties: { fromPath: { type: 'string', description: 'Current path of the file.' }, toPath: { type: 'string', description: 'New path. Renaming across folders moves the file.' } },
      required: ['fromPath', 'toPath'],
    },
  },
  {
    name: 'create_processor',
    description: 'Generate a processor in the open project. Hardware widths (nBits/nbMantissa/nbExponent) are in bits.',
    access: 'write',
    api: ['project', 'createProcessor'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Name of the processor. Becomes the folder name and the .cmm basename, so keep it a valid identifier.' },
        nBits: { type: 'number', description: 'NUBITS — overall data width' },
        nbMantissa: { type: 'number', description: 'NBMANT — mantissa width' },
        nbExponent: { type: 'number', description: 'NBEXPO — exponent width' },
        dataStackSize: { type: 'number', description: 'Depth of the data stack, in words.' },
        instructionStackSize: { type: 'number', description: 'Depth of the instruction (call) stack, in words.' },
        inputPorts: { type: 'number', description: 'How many input ports the processor exposes.' },
        outputPorts: { type: 'number', description: 'How many output ports the processor exposes.' },
        gain: { type: 'number', description: 'Fixed-point gain: the number of fractional bits.' },
      },
      required: ['processorName'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new SAPHO project under location/name and open it. The name may contain only letters, numbers, underscore or hyphen.',
    access: 'write',
    api: ['project', 'createProject'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name. Becomes the folder name and the .spf basename.' },
        location: { type: 'string', description: 'Parent directory for the new project folder' },
      },
      required: ['name', 'location'],
    },
  },
  {
    name: 'rename_project',
    description:
      'Rename the CURRENTLY OPEN SAPHO project everywhere: the project root folder ' +
      '(<location>/<old> → <location>/<new>), the <old>.spf project file, the .spf ' +
      'metadata (projectName/projectPath/basePath) and EVERY absolute path stored in ' +
      'the .spf. Processor folders move with the root, so their #PRNAME directives are ' +
      'untouched (use rename_processor for a processor). ' +
      'IMPORTANT: this starts a BACKGROUND JOB and returns IMMEDIATELY with a jobId — it ' +
      'does NOT wait for the rename to finish (waiting on it used to time out). After ' +
      'calling this you MUST call get_rename_status with the returned jobId, polling a few ' +
      'times if needed, until its status is "done" or "failed", to learn the real outcome ' +
      'and (on failure) the step and reason. The project reopens itself when the job ' +
      'completes. The name may contain only letters, numbers, underscore or hyphen.',
    access: 'write',
    api: ['project', 'renameProject'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        newName: { type: 'string', description: 'New project name (letters, digits, _ or -)' },
      },
      required: ['newName'],
    },
  },
  {
    name: 'get_rename_status',
    description:
      'Get the progress and final result of a project rename started by rename_project. ' +
      'Pass the jobId that rename_project returned. Returns { status: "running" | "done" | ' +
      '"failed", done, steps (the phases completed so far), result }. Poll this until status ' +
      'is "done" (success — result.newName is the new name; a result.warning means only the ' +
      'file-tree auto-reload failed, not the rename itself) or "failed" (result.failedStep and ' +
      'result.reason say which step broke and why).',
    access: 'read',
    api: ['project', 'getRenameStatus'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The jobId returned by rename_project' },
      },
      required: ['jobId'],
    },
  },

  /* ---- git / Source Control (Dagr): version control over the open project's
   *      local git repo. Reads run immediately; writes go through the Allow/Deny
   *      card. All error clearly if the open project is not a git repository. ---- */
  {
    name: 'git_status',
    description:
      'Get the working-tree git status of the OPEN project: current branch, ahead/behind the remote, ' +
      'and the changed files — each with its index (staged) flag and working-tree flag (M=modified, ' +
      'A=added, D=deleted, R=renamed, ?=untracked) plus +/- line counts. Use this first to see what changed.',
    access: 'read',
    api: ['git', 'status'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_log',
    description: 'List recent commits of the open project (newest first): hash, subject, author and date.',
    access: 'read',
    api: ['git', 'log'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'How many commits (default 30, max 200)' } } },
  },
  {
    name: 'git_branches',
    description: 'List the local and remote branches of the open project and which one is currently checked out.',
    access: 'read',
    api: ['git', 'branches'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_diff',
    description:
      'Show the unified diff of one file (or the whole working tree if `file` is omitted) in the open ' +
      'project. Size-capped. Pass staged:true for the staged (index) diff instead of the working tree.',
    access: 'read',
    api: ['git', 'diff'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path relative to the repo root; omit for the whole tree' },
        staged: { type: 'boolean', description: 'Diff the staged changes instead of the working tree' },
      },
    },
  },
  {
    name: 'git_stage',
    description: 'Stage one or more files (add to the index) in the open project. Paths are relative to the repo root.',
    access: 'write',
    api: ['git', 'stage'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths to stage, project-relative. Pass an empty list to stage everything.' } }, required: ['files'] },
  },
  {
    name: 'git_unstage',
    description: 'Unstage one or more files (remove from the index, KEEP the changes) in the open project.',
    access: 'write',
    api: ['git', 'unstage'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths to unstage, project-relative. The changes are kept in the working tree.' } }, required: ['files'] },
  },
  {
    name: 'git_commit',
    description:
      'Commit the STAGED changes of the open project with a message. Only staged changes are committed — ' +
      'stage files first with git_stage. Pass amend:true to amend the previous commit instead.',
    access: 'write',
    api: ['git', 'commit'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Commit message. First line is the subject; blank line then body for detail.' }, amend: { type: 'boolean', description: 'true rewrites the previous commit instead of creating a new one.' } },
      required: ['message'],
    },
  },
  {
    name: 'git_discard',
    description:
      'DISCARD local changes to one or more files in the open project — IRREVERSIBLE (restores them to the ' +
      'last committed state). Prefer git_stash if the user might want the changes back.',
    access: 'write',
    api: ['git', 'discard'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths whose changes are thrown away. THIS CANNOT BE UNDONE.' } }, required: ['files'] },
  },
  {
    name: 'git_create_branch',
    description: 'Create a new branch from the current HEAD and switch to it, in the open project.',
    access: 'write',
    api: ['git', 'createBranch'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Name of the new branch. It is created from the current HEAD and checked out.' } }, required: ['name'] },
  },
  {
    name: 'git_switch_branch',
    description: 'Switch the open project to an EXISTING branch (checkout). Commit or git_stash a dirty tree first.',
    access: 'write',
    api: ['git', 'switchBranch'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Branch to check out. Uncommitted changes may block the switch.' } }, required: ['name'] },
  },
  {
    name: 'git_fetch',
    description: 'Fetch from the remote for the open project (updates remote-tracking branches; does not touch the working tree).',
    access: 'write',
    api: ['git', 'fetch'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_pull',
    description: 'Pull from the remote for the open project (fetch + merge, with --autostash).',
    access: 'write',
    api: ['git', 'pull'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_push',
    description: 'Push the current branch to the remote for the open project.',
    access: 'write',
    api: ['git', 'push'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_stash',
    description: 'Stash the uncommitted changes of the open project (including untracked files). Restore later from the Source Control panel.',
    access: 'write',
    api: ['git', 'stash'],
    argStyle: 'object',
    inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'Label for the stash, so it can be recognised later.' } } },
  },
  {
    name: 'open_project',
    description: 'Open an existing SAPHO project by its .spf file path.',
    access: 'write',
    api: ['project', 'openProject'],
    argStyle: 'positional',
    argNames: ['spfPath'],
    inputSchema: {
      type: 'object',
      properties: { spfPath: { type: 'string', description: 'Absolute path of the .spf file to open.' } },
      required: ['spfPath'],
    },
  },
  {
    name: 'list_recent_projects',
    description: 'List recently opened SAPHO projects with full .spf paths and human-friendly names.',
    access: 'read',
    api: ['project', 'listRecents'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'backup_project',
    description: 'Create a timestamped backup (.zip) of the currently open SAPHO project. Returns the absolute path of the archive.',
    access: 'write',
    api: ['project', 'backup'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_processor',
    description: 'Delete a processor from the open project: removes its folder (Hardware/Simulation/Software + .cmm) and its SPF entries. Irreversible — prefer backup_project first.',
    access: 'write',
    api: ['project', 'deleteProcessor'],
    argStyle: 'positional',
    argNames: ['processorName'],
    inputSchema: {
      type: 'object',
      properties: { processorName: { type: 'string', description: 'Processor to delete, with its folder and sources. THIS CANNOT BE UNDONE.' } },
      required: ['processorName'],
    },
  },
  {
    name: 'rename_processor',
    description:
      'Rename an existing processor everywhere SAPHO/Aurora cares: the processor ' +
      'working directory (<old> to <new>), the Software/<old>.cmm source file, the ' +
      '#PRNAME directive inside it, the auto-generated build artifacts (.asm, ' +
      'Hardware/<old>.v, Simulation/<old>_tb.v) and every reference in the .spf ' +
      '(the processors[] entry — clk/numClocks/showArrays are preserved — plus the ' +
      'top-level, testbench and synthesizable/testbench file path lists). User comments ' +
      'and code inside the .cmm are NOT touched, only the #PRNAME directive. Open editor ' +
      'tabs are re-pointed automatically. Custom user toplevels/testbenches at the project ' +
      'root are NOT renamed — use rename_file for those.',
    access: 'write',
    api: ['project', 'renameProcessor'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Current processor name' },
        newName: { type: 'string', description: 'New name (letters, digits, _ or -)' },
      },
      required: ['processorName', 'newName'],
    },
  },
  {
    name: 'import_file',
    description: 'Register an existing .v / .sv / .vh / .py file as a synthesizable or testbench file in the current project SPF. Copies the file into the project root if it lives elsewhere. Python .py files are treated as cocotb testbenches.',
    access: 'write',
    api: ['project', 'importFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute source path of the file to import' },
        kind: { type: 'string', enum: ['synthesizable', 'testbench'], description: 'Which SPF list to add to' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'rename_imported_file',
    description: 'Rename an imported file (in both the SPF list and on disk).',
    access: 'write',
    api: ['project', 'renameImportedFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        fromPath: { type: 'string', description: 'Current path of the imported file.' },
        toPath:   { type: 'string', description: 'New path for it.' },
      },
      required: ['fromPath', 'toPath'],
    },
  },
  {
    name: 'remove_imported_file',
    description: 'Remove a file from the SPF synthesizable / testbench list. By default the file is kept on disk; set deleteFromDisk:true to also delete it.',
    access: 'write',
    api: ['project', 'removeImportedFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Imported file to remove from the project.' },
        deleteFromDisk: { type: 'boolean', default: false, description: 'true also erases the file; false (default) only drops it from the project.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'dismiss_missing_files',
    description:
      'Dismiss the missing-files warning by pruning every dangling reference from the .spf (the ' +
      'synthesizable / testbench lists, plus the top-level / testbench pointers if they point at ' +
      'a missing file). The files are already gone from disk — this only cleans up the project\'s ' +
      'stale references, so the warning stops reappearing. Use only when the user has confirmed ' +
      'they deleted those files on purpose. Returns { removed }.',
    access: 'write',
    api: ['project', 'dismissMissingFiles'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ask_user_question',
    description: 'Pause the turn and ask the human a question with optional choices. Use this only when truly ambiguous — prefer doing things autonomously. Returns { answer, selected }. Use sparingly; do not chain.',
    access: 'read',
    api: ['ui', 'askUserQuestion'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to display.' },
        options: {
          type: 'array',
          description: 'Optional list of pre-defined choices.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['label'],
          },
        },
        multiSelect: { type: 'boolean', default: false, description: 'true lets the user pick more than one option.' },
      },
      required: ['question'],
    },
  },
  {
    name: 'set_setting',
    description: 'Change one IDE setting and apply it immediately. Call list_settings first to see the valid keys and their current values — an unknown key is rejected rather than silently stored.',
    access: 'write',
    api: ['settings', 'set'],
    argStyle: 'positional',
    argNames: ['key', 'value'],
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['locale', 'tooltipsEnabled', 'verboseMode'], description: 'Setting id. Call list_settings for the valid keys.' },
        value: {
          type: ['string', 'boolean'],
          description: 'For locale: "pt" or "en". For the toggles: true/false.',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'select_wave_signals',
    description: 'Choose exactly which signals are dumped into GTKWave (replaces the current selection and saves it). Use list_wave_signals first to get valid signal paths.',
    access: 'write',
    api: ['wave', 'setSignals'],
    argStyle: 'positional',
    argNames: ['paths'],
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Full signal paths, e.g. "tb.dut.clk"',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'set_top_level',
    description:
      'Mark a synthesizable Verilog file as the project\'s Top Level module (the synthesizable root). ' +
      'Registers the file in the project if it is not yet tracked, and refreshes the file tree. ' +
      'Call this after create_file and before compiling. ' +
      'Do NOT use on the auto-generated <proc>.v inside <proc>/Hardware/ — that file is managed by SAPHO.',
    access: 'write',
    api: ['project', 'setTopLevel'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path to the .v file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'set_testbench_top',
    description:
      'Mark a Verilog or cocotb Python file as the project\'s Testbench Top module (the simulation entry point). ' +
      'Registers the file in the project if it is not yet tracked, and refreshes the file tree. ' +
      'Call this after create_file and before compiling. ' +
      'Do NOT use on the auto-generated <proc>_tb.v inside <proc>/Simulation/ — that file is managed by SAPHO.',
    access: 'write',
    api: ['project', 'setTestbenchTop'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path to the testbench .v/.sv/.py file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'open_wave_config',
    description: 'Open the Wave Configuration modal for the user.',
    access: 'write',
    api: ['wave', 'openConfig'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_processor_config',
    description:
      'Read the simulation config of one (or every) processor: clk (MHz), numClocks, ' +
      'simTime_us = numClocks/clk, showArrays, and the parsed CMM header directives ' +
      '(NUBITS, NBMANT, NBEXPO, ...). Omit processorName to get them all.',
    access: 'read',
    api: ['project', 'getProcessorConfig'],
    argStyle: 'positional',
    argNames: ['processorName'],
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Processor name; omit to list every processor' },
      },
    },
  },
  {
    name: 'set_processor_config',
    description:
      'Update the clock frequency (clk, MHz), simulation length (numClocks), or array-debug ' +
      'flag of one processor. Aurora bakes `$finish` at `numClocks/clk` µs, so this is the ' +
      'lever to change total simulation time. Omitted fields keep their current value.',
    access: 'write',
    api: ['project', 'setProcessorConfig'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Processor whose configuration changes.' },
        clk:           { type: 'number', description: 'Clock frequency in MHz (positive)' },
        numClocks:     { type: 'number', description: 'Total clock cycles to simulate (positive int)' },
        showArrays:    { type: 'boolean', description: 'Dump array contents into the waveform' },
      },
      required: ['processorName'],
    },
  },
  {
    name: 'refresh_file_tree',
    description:
      'Force-repaint the project file tree. Use this after creating or importing files that ' +
      'are not yet showing up in the tree.',
    access: 'write',
    api: ['project', 'refreshTree'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_tree_view',
    description:
      'Switch the left panel between the file tree and the post-synthesis hierarchy tree. ' +
      'The hierarchy view is only populated after a successful Verilog compilation — call ' +
      'compile_step("verilog") first if it is empty.',
    access: 'write',
    api: ['project', 'setView'],
    argStyle: 'positional',
    argNames: ['mode'],
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['file', 'hierarchy'], description: 'Which file-tree view to show.' } },
      required: ['mode'],
    },
  },
  {
    name: 'get_tree_view',
    description: 'Report which tree view is active and whether the hierarchy view is available.',
    access: 'read',
    api: ['project', 'getView'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_gtkw_files',
    description: 'List .gtkw save files registered for the currently active testbench, with their active flag.',
    access: 'read',
    api: ['wave', 'listGtkwFiles'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_gtkw_files',
    description:
      'Find .gtkw save files anywhere inside the open project by name. The user only needs to ' +
      'give the file name — this resolves the full path. Pass a name fragment to filter, or omit ' +
      'it to list every .gtkw in the project. Returns project-relative and absolute paths.',
    access: 'read',
    api: ['wave', 'findGtkwFiles'],
    argStyle: 'positional',
    argNames: ['query'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or name fragment of the .gtkw to find (optional)' },
      },
    },
  },
  {
    name: 'use_gtkw_file',
    description:
      'Given just a .gtkw file NAME (with or without the .gtkw extension), locate it in the ' +
      'project, register it for the active testbench, and mark it active — all in one step, so ' +
      'the next "wave" run loads it. If the name matches several files the candidates are ' +
      'reported so you can pick a more specific one. This is the easiest way to set the .gtkw.',
    access: 'write',
    api: ['wave', 'useGtkwByName'],
    argStyle: 'positional',
    argNames: ['name'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The .gtkw file name, e.g. "mylayout" or "mylayout.gtkw"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_gtkw_file',
    description:
      'Register a .gtkw save file from anywhere inside the project tree for the active testbench. ' +
      'The file must exist and end in .gtkw. By default the freshly added entry becomes the active one.',
    access: 'write',
    api: ['wave', 'addGtkwFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute or project-relative path to a .gtkw file' },
        setActive: { type: 'boolean', description: 'Mark this file active (default: true)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'set_active_gtkw_file',
    description:
      'Pick which already-registered .gtkw file GTKWave loads when "wave" is run. Omit filePath ' +
      'to clear the selection (Aurora auto-generates a layout).',
    access: 'write',
    api: ['wave', 'setActiveGtkwFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'The .gtkw save file GTKWave should open with the waveform.' } },
    },
  },
  {
    name: 'remove_gtkw_file',
    description: 'Remove a .gtkw entry from the active testbench list. Does not delete the file from disk.',
    access: 'write',
    api: ['wave', 'removeGtkwFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'The .gtkw entry to drop from the list.' } },
      required: ['filePath'],
    },
  },
  {
    name: 'list_surfer_files',
    description: 'List Surfer layout files (.surf.ron saved state / .sucl command file) registered for the active testbench, with their active flag. The Surfer counterpart of list_gtkw_files; used when the waveform viewer is Surfer.',
    access: 'read',
    api: ['wave', 'listSurferFiles'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_surfer_files',
    description:
      'Find Surfer layout files (.surf.ron saved state, or .sucl command files) anywhere inside the ' +
      'open project by name. The user only needs to give the file name — this resolves the full path. ' +
      'Pass a name fragment to filter, or omit it to list every Surfer layout. Returns project-relative ' +
      'and absolute paths.',
    access: 'read',
    api: ['wave', 'findSurferFiles'],
    argStyle: 'positional',
    argNames: ['query'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or fragment of the Surfer layout to find (optional)' },
      },
    },
  },
  {
    name: 'use_surfer_file',
    description:
      'Given just a Surfer layout file NAME (.surf.ron or .sucl, with or without the extension), locate ' +
      'it in the project, register it for the active testbench, and mark it active — so the next "wave" ' +
      'run opens Surfer with it. If the name matches several files the candidates are reported. This is ' +
      'the easiest way to set the Surfer layout.',
    access: 'write',
    api: ['wave', 'useSurferByName'],
    argStyle: 'positional',
    argNames: ['name'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The Surfer layout file name, e.g. "mylayout" or "mylayout.surf.ron"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_surfer_file',
    description:
      'Register a Surfer layout from inside the project tree for the active testbench: a .surf.ron saved ' +
      'state (loaded with -s) or a .sucl command file (loaded with -c). The file must exist. By default ' +
      'the freshly added entry becomes the active one.',
    access: 'write',
    api: ['wave', 'addSurferFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:  { type: 'string', description: 'Absolute or project-relative path to a .surf.ron / .sucl file' },
        setActive: { type: 'boolean', description: 'Mark this layout active (default: true)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'set_active_surfer_file',
    description:
      'Pick which already-registered Surfer layout the Surfer viewer loads when "wave" is run. Omit ' +
      'filePath to clear the selection (Surfer opens the raw VCD with no curated layout).',
    access: 'write',
    api: ['wave', 'setActiveSurferFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'The Surfer state file to load with the waveform.' } },
    },
  },
  {
    name: 'remove_surfer_file',
    description: 'Remove a Surfer layout entry from the active testbench list. Does not delete the file from disk.',
    access: 'write',
    api: ['wave', 'removeSurferFile'],
    argStyle: 'positional',
    argNames: ['filePath'],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'The Surfer state entry to drop from the list.' } },
      required: ['filePath'],
    },
  },
  {
    name: 'get_simulator',
    description:
      'Read which Verilog simulator the Wave button runs. Returns "iverilog" ' +
      '(bundled vvp/iverilog, default — slower but preserves every internal ' +
      'SAPHO signal) or "verilator" (bundled Verilator — 5-10x faster on long ' +
      'testbenches but elides internal signals; only top-level testbench ' +
      'signals stay visible).',
    access: 'read',
    api: ['wave', 'getSimulator'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_simulator',
    description:
      'Switch which simulator the Wave button runs. Use "verilator" when a ' +
      'long simulation is dominating the dev loop AND only top-level testbench ' +
      'signals matter; use "iverilog" when you need full visibility of internal ' +
      'SAPHO signals (in_sim_*, me1_*, delta_*, …). The choice persists across ' +
      'app restarts; re-running Wave picks up the new simulator immediately.',
    access: 'write',
    api: ['wave', 'setSimulator'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        simulator: { type: 'string', enum: ['iverilog', 'verilator'], description: 'Which simulator runs the testbench.' },
      },
      required: ['simulator'],
    },
  },
  {
    name: 'get_waveform_viewer',
    description:
      'Read which waveform viewer the Wave button opens. Returns "gtkwave" ' +
      '(the bundled GTKWave fork — opens in an EXTERNAL window, the default) ' +
      'or "surfer" (the embedded Surfer viewer — shows the waves INSIDE the ' +
      'IDE). Both read the same VCD/FST; the viewer is independent of the ' +
      'simulator choice.',
    access: 'read',
    api: ['wave', 'getViewer'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_waveform_viewer',
    description:
      'Switch which waveform viewer the Wave button opens. Use "surfer" for ' +
      'the embedded viewer (waves inside the IDE, no external window); use ' +
      '"gtkwave" for the bundled GTKWave external window (the default, with ' +
      'the curated source/opcode/complex tracks). The choice persists across ' +
      'app restarts; re-running Wave picks up the new viewer immediately.',
    access: 'write',
    api: ['wave', 'setViewer'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', enum: ['gtkwave', 'surfer'], description: 'Which viewer opens the resulting waveform.' },
      },
      required: ['viewer'],
    },
  },
  {
    name: 'open_surfer',
    description:
      'Open the Surfer waveform viewer on a specific .vcd/.fst file, in its own ' +
      'window. Optionally load a Surfer layout: a .surf.ron saved state or a .sucl ' +
      'command file. If surfer-aurora.exe is not installed it cleanly falls back to GTKWave, ' +
      'so this always produces a viewer. Pass an ABSOLUTE file path (find one with ' +
      'get_project_tree — e.g. a <proc>/Simulation/<proc>.vcd or a dump.fst). Unlike ' +
      'set_waveform_viewer (which only changes what the Wave button uses), this ' +
      'launches the viewer immediately on the file you name.',
    access: 'write',
    api: ['wave', 'openSurfer'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the .vcd/.fst wave file to open.' },
        layout: { type: 'string', description: 'Optional Surfer layout: a .surf.ron (loaded with -s) or .sucl (loaded with -c).' },
      },
      required: ['file'],
    },
  },
  {
    name: 'open_file',
    description: 'Open a project file in the editor. Set inNewSplit:true to open it in a new split pane.',
    access: 'write',
    api: ['editor', 'openFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path' },
        inNewSplit: { type: 'boolean', description: 'Open in a new split pane' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'format_file',
    description:
      'Reformat a file using Aurora\'s own formatter — the same one behind the wand '
      + 'button and Shift+Alt+F. Routes by language: clang-format for C, C++ and C± '
      + '(C± borrows C rules), black for Python, Verible for Verilog. PREFER THIS over '
      + 'rewriting a file yourself when the only problem is layout: indentation, brace '
      + 'style, line breaks, spacing, alignment. Rewriting a whole file to fix its '
      + 'formatting is slow, risks dropping code, and buries the real change in a huge '
      + 'diff. Formats the buffer and saves. Omit filePath to format the focused file. '
      + 'Returns changed:false when the file was already formatted.',
    access: 'write',
    api: ['editor', 'formatFile'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path. Defaults to the focused file.' },
      },
    },
  },
  {
    name: 'get_run_status',
    description:
      'Check whether the last compilation or simulation is still running, finished, '
      + 'or was CANCELLED by the user. Call this when a compile_* tool returned but no '
      + 'result ever appeared in the terminal: a cancelled run is not a failure and not '
      + 'a hang, so do not go looking for a bug that is not there. Returns '
      + 'state: running | cancelled | idle.',
    access: 'read',
    api: ['compile', 'runStatus'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'close_project',
    description:
      'Close the project currently open and return the IDE to its empty state. '
      + 'The user still confirms in a dialog, and unsaved files are handled there, '
      + 'so this REQUESTS the close rather than forcing it.',
    access: 'write',
    api: ['project', 'close'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_gtkw_layout',
    description:
      'Create a GTKWave layout (.gtkw) from an explicit signal list, write it at the '
      + 'project root and register it for the active testbench. This is the GTKWave '
      + 'sibling of create_surfer_layout, and the counterpart of add_gtkw_file (which '
      + 'only registers a file that already exists). Note the division of labour: when '
      + 'no .gtkw is active, Aurora GENERATES a curated layout from the dump on every '
      + 'run (processors grouped, colours, decoded Assembly/C+- traces). Prefer that '
      + 'default; create a layout here when the user asked for specific signals in a '
      + 'specific order. Signals must exist in the dump — check with list_wave_signals '
      + 'first, since GTKWave silently omits a path it cannot find.',
    access: 'write',
    api: ['wave', 'createGtkwLayout'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Layout name, without extension. Becomes <name>.gtkw at the project root.' },
        signals: {
          type: 'array',
          description: 'Signals top to bottom. Either a full path string, or an object for control over base and grouping.',
          items: {
            oneOf: [
              { type: 'string', description: 'Full signal path, e.g. "tb.dut.acc".' },
              {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Full signal path, e.g. "tb.dut.acc".' },
                  // A lista tem que ser a mesma do RADIX_VALIDOS em
                  // js/wave/gtkw_custom.js, que e quem de fato aceita ou
                  // recusa. Copiada, e nao importada, porque este manifesto e
                  // CommonJS no processo principal e aquele modulo e ESM do
                  // renderer; o tool_manifest.test.js compara as duas.
                  radix: { type: 'string', enum: ['bin', 'dec', 'signed', 'hex', 'real', 'ascii'], description: 'Display base. Default dec; use bin for single-bit signals and signed for two-complement buses.' },
                  group: { type: 'string', description: 'Consecutive signals sharing this name land in one collapsible group.' },
                },
                required: ['path'],
              },
            ],
          },
        },
        setActive: { type: 'boolean', description: 'true (default) makes it the layout GTKWave opens for this testbench.' },
      },
      required: ['name', 'signals'],
    },
  },
  {
    name: 'create_surfer_layout',
    description:
      'Create a Surfer command file (.sucl) that sets up a waveform view, register it '
      + 'for the active testbench and optionally open Surfer with it. Write ONE Surfer '
      + 'command per line (load_file, add_variable, zoom_fit, ...); see the Surfer command '
      + 'reference. NOTE: this deliberately writes .sucl and not .surf.ron — .surf.ron is '
      + "the RON serialisation of Surfer's internal state, it has no published schema and "
      + 'changes between versions, while .sucl is documented and meant to be hand-written. '
      + 'To drop a layout later, use remove_surfer_file.',
    access: 'write',
    api: ['wave', 'createSurferLayout'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Layout name, without extension. Becomes <name>.sucl at the project root.' },
        commands: { type: 'array', items: { type: 'string' }, description: 'Surfer commands, one per entry, in the order they should run.' },
        open: { type: 'boolean', description: 'true also launches Surfer with this layout. Default false.' },
        setActive: { type: 'boolean', description: 'true (default) makes it the active layout for the testbench.' },
      },
      required: ['name', 'commands'],
    },
  },
  {
    name: 'create_split',
    description: 'Create a new editor split pane.',
    access: 'write',
    api: ['editor', 'createSplit'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },

  /* ---- compilation command overrides (Aurora Intelligence-editable
   * toolchain knobs). Read-side tools are 'read' so the model can
   * introspect without asking. Write-side tools are 'write' so they
   * trigger the ask-before-write modal. */
  {
    name: 'list_compile_steps',
    description:
      'Enumerate every toolchain step whose command line Aurora Intelligence can override ' +
      '(cmm, asm, iverilog-check, iverilog-build, vvp-run, verilator-build, ' +
      'verilator-run, fst2vcd, gtkwave, yosys-hierarchy, prism-yosys). ' +
      'Each entry includes a short description of when the step runs.',
    access: 'read',
    api: ['compile', 'listSteps'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_compile_command',
    description:
      'Return the structured CommandSpec ({binary, args, cwd, env, prependPath}) ' +
      'that would be executed for one toolchain step RIGHT NOW, including any ' +
      'override the AI or the user has registered. Includes a printable command ' +
      'line and a diff vs. the base spec.',
    access: 'read',
    api: ['compile', 'inspectCommand'],
    argStyle: 'positional',
    argNames: ['step', 'processorName'],
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', description: 'One of: cmm, asm-pre, asm, iverilog-check, iverilog-build, vvp-run, verilator-build, verilator-run, fst2vcd, gtkwave, yosys-hierarchy, prism-yosys' },
        processorName: { type: 'string', description: 'For per-processor steps (cmm, asm-pre, asm). Omit for global steps.' },
      },
      required: ['step'],
    },
  },
  {
    name: 'preview_compile_command',
    description:
      'Dry-run a hypothetical override on a step WITHOUT registering it. Returns ' +
      'the same shape as inspect_compile_command, but with the proposed override ' +
      'layered on top of the current state. Use this to show the user what the ' +
      'resulting command line would look like before calling set_command_override.',
    access: 'read',
    api: ['compile', 'previewCommand'],
    argStyle: 'positional',
    argNames: ['step', 'override', 'processorName'],
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', description: 'Pipeline step whose command line you want to see.' },
        override: {
          type: 'object',
          description: 'Override applied to the PREVIEW only. Nothing is saved.',
          properties: {
            appendArgs:  { type: 'array', items: { type: 'string' } },
            prependArgs: { type: 'array', items: { type: 'string' } },
            removeArgs:  { type: 'array', items: { type: 'string' } },
            envSet:      { type: 'object' },
            envUnset:    { type: 'array', items: { type: 'string' } },
          },
        },
        processorName: { type: 'string', description: 'Processor to preview for. Omit for the active one.' },
      },
      required: ['step', 'override'],
    },
  },
  {
    name: 'list_command_overrides',
    description:
      'List every registered command override across the ephemeral (in-memory, ' +
      'consumed on next run) and persisted (.spf, survives sessions) layers.',
    access: 'read',
    api: ['compile', 'listOverrides'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_protected_compile_flags',
    description:
      'List the flags that the override system refuses to remove or stomp for one ' +
      '(or every) step — Aurora pipeline invariants like iverilog -o, gtkwave ' +
      '--script, verilator --binary. Omit step to get the whole table.',
    access: 'read',
    api: ['compile', 'listProtectedFlags'],
    argStyle: 'positional',
    argNames: ['step'],
    inputSchema: {
      type: 'object',
      properties: { step: { type: 'string', description: 'Pipeline step whose protected flags you want listed.' } },
    },
  },
  {
    name: 'list_allowed_compile_binaries',
    description:
      'List the binaries the main-process executor will spawn. Aurora Intelligence ' +
      'cannot redirect a step to a binary outside this allowlist — only flags ' +
      'and env are editable.',
    access: 'read',
    api: ['compile', 'listAllowedBinaries'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_command_override',
    description:
      'Register an override for one toolchain step. By default the override is ' +
      'EPHEMERAL — consumed on the next time that step runs. Pass persist:true ' +
      'to write it into the .spf so it survives across sessions. Supplying both ' +
      'global (no processorName) and per-processor overrides for the same step ' +
      'is allowed; the per-processor one wins for that processor. Use ' +
      'preview_compile_command first to verify the resulting command line. ' +
      'The main-process executor re-checks protected flags before spawn — if the ' +
      'override would strip a pipeline-critical flag (iverilog -o, gtkwave ' +
      '--script, etc.), the step run fails with a clear error.',
    access: 'write',
    api: ['compile', 'setOverride'],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        step:          { type: 'string', description: 'See list_compile_steps for the full set' },
        processorName: { type: 'string', description: 'For per-processor steps only' },
        appendArgs:    { type: 'array', items: { type: 'string' }, description: 'Flags appended after the existing args' },
        prependArgs:   { type: 'array', items: { type: 'string' }, description: 'Flags inserted right after the binary' },
        removeArgs:    { type: 'array', items: { type: 'string' }, description: 'Tokens removed by exact match (protected flags rejected)' },
        envSet:        { type: 'object', description: 'Env vars to set (string values)' },
        envUnset:      { type: 'array', items: { type: 'string' }, description: 'Env vars to unset' },
        persist:       { type: 'boolean', description: 'true → write to .spf; false (default) → ephemeral, consumed on next run' },
        note:          { type: 'string', description: 'Free-text note that lands in the audit log + terminal hint' },
      },
      required: ['step'],
    },
  },
  {
    name: 'clear_command_override',
    description:
      'Remove a registered override. `scope` controls which layer: "ephemeral" ' +
      '(in-memory only), "persisted" (.spf only), or "both" (default).',
    access: 'write',
    api: ['compile', 'clearOverride'],
    argStyle: 'positional',
    argNames: ['step', 'processorName', 'scope'],
    inputSchema: {
      type: 'object',
      properties: {
        step:          { type: 'string', description: 'Pipeline step whose override is removed.' },
        processorName: { type: 'string', description: 'Processor the override belongs to. Omit for the active one.' },
        scope:         { type: 'string', enum: ['ephemeral', 'persisted', 'both'], description: 'Which override to clear: this processor\'s, or the project-wide one.' },
      },
      required: ['step'],
    },
  },
];

/**
 * Build the Vercel-AI-SDK `tools` object. `runToolFn(name, args)` is
 * the bridge that ships the call to the renderer and resolves with the
 * AuroraAPI result, supplied by `chat.js`, bound to the right
 * webContents.
 *
 * @param {(name:string, args:object) => Promise<unknown>} runToolFn
 */
function buildTools(runToolFn) {
  if (!tool || !jsonSchema) return {};
  /** @type {Record<string, any>} */
  const tools = {};
  for (const def of TOOL_MANIFEST) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: async (/** @type {any} */ args) => runToolFn(def.name, args || {}),
    });
  }
  return tools;
}

/** Serialisable manifest for the renderer's tool_runner (no closures). */
function getManifest() {
  return TOOL_MANIFEST.map((d) => ({
    name: d.name,
    description: d.description,
    access: d.access,
    api: d.api,
    argStyle: d.argStyle,
    argNames: d.argNames || [],
    inputSchema: d.inputSchema,
  }));
}

module.exports = { TOOL_MANIFEST, buildTools, getManifest };
