// @ts-check
/**
 * tools.js — the tool manifest Aurora Intelligence is allowed to call.
 *
 * Each entry maps a function-calling tool to an `AuroraAPI` namespace
 * method in the renderer. The manifest is *pure data* (no closures) so
 * it can be shipped over IPC verbatim — the renderer's tool_runner
 * pulls it and uses the same `api` / `argStyle` / `argNames` fields to
 * dispatch the call, which keeps a single source of truth.
 *
 * `access`:
 *   - 'read'  — pure inspection, runs without prompting.
 *   - 'write' — mutates the workspace; the renderer shows an
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
let tool, jsonSchema;
try {
  ({ tool, jsonSchema } = require('ai'));
} catch (_) {
  // Silently ignored — provider.js logs the same failure once.
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
    name: 'list_processors',
    description: 'List the processors of the open project together with their configuration.',
    access: 'read',
    api: ['project', 'listProcessors'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
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
        text: { type: 'string' },
        position: {
          type: 'object',
          properties: { line: { type: 'number' }, column: { type: 'number' } },
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
        startLine: { type: 'number' },
        startColumn: { type: 'number' },
        endLine: { type: 'number' },
        endColumn: { type: 'number' },
        text: { type: 'string' },
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
    name: 'compile_step',
    description: 'Run a single compilation step. "wave" opens GTKWave; "prism" opens the PRISM RTL viewer.',
    access: 'write',
    api: ['compile', 'compileStep'],
    argStyle: 'positional',
    argNames: ['step'],
    inputSchema: {
      type: 'object',
      properties: { step: { type: 'string', enum: ['cmm', 'verilog', 'wave', 'prism'] } },
      required: ['step'],
    },
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
    description: 'Create a directory.',
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
      properties: { filePath: { type: 'string' } },
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
      properties: { fromPath: { type: 'string' }, toPath: { type: 'string' } },
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
        processorName: { type: 'string' },
        nBits: { type: 'number', description: 'NUBITS — overall data width' },
        nbMantissa: { type: 'number', description: 'NBMANT — mantissa width' },
        nbExponent: { type: 'number', description: 'NBEXPO — exponent width' },
        dataStackSize: { type: 'number' },
        instructionStackSize: { type: 'number' },
        inputPorts: { type: 'number' },
        outputPorts: { type: 'number' },
        gain: { type: 'number' },
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
        name: { type: 'string' },
        location: { type: 'string', description: 'Parent directory for the new project folder' },
      },
      required: ['name', 'location'],
    },
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
      properties: { spfPath: { type: 'string' } },
      required: ['spfPath'],
    },
  },
  {
    name: 'set_setting',
    description: 'Change one IDE setting.',
    access: 'write',
    api: ['settings', 'set'],
    argStyle: 'positional',
    argNames: ['key', 'value'],
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['locale', 'tooltipsEnabled', 'verboseMode'] },
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
      'Mark a Verilog file as the project\'s Testbench Top module (the simulation entry point). ' +
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
        filePath: { type: 'string', description: 'Absolute or project-relative path to the testbench .v file' },
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
        processorName: { type: 'string' },
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
      properties: { mode: { type: 'string', enum: ['file', 'hierarchy'] } },
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
      properties: { filePath: { type: 'string' } },
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
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
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
    name: 'create_split',
    description: 'Create a new editor split pane.',
    access: 'write',
    api: ['editor', 'createSplit'],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * Build the Vercel-AI-SDK `tools` object. `runToolFn(name, args)` is
 * the bridge that ships the call to the renderer and resolves with the
 * AuroraAPI result — supplied by `chat.js`, bound to the right
 * webContents.
 *
 * @param {(name:string, args:object) => Promise<unknown>} runToolFn
 */
function buildTools(runToolFn) {
  if (!tool || !jsonSchema) return {};
  const tools = {};
  for (const def of TOOL_MANIFEST) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: async (args) => runToolFn(def.name, args || {}),
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
