// @ts-check
/**
 * Wave tools — `api` namespace 'wave' (signals, .gtkw files, simulator choice).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'list_wave_signals',
    description: 'List every signal discovered for the current testbench and which are selected to be shown in GTKWave.',
    access: 'read',
    api: [ 'wave', 'listSignals' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'select_wave_signals',
    description: 'Choose exactly which signals are dumped into GTKWave (replaces the current selection and saves it). Use list_wave_signals first to get valid signal paths.',
    access: 'write',
    api: [ 'wave', 'setSignals' ],
    argStyle: 'positional',
    argNames: [ 'paths' ],
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Full signal paths, e.g. "tb.dut.clk"'
        }
      },
      required: [ 'paths' ]
    }
  },
  {
    name: 'open_wave_config',
    description: 'Open the Wave Configuration modal for the user.',
    access: 'write',
    api: [ 'wave', 'openConfig' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_gtkw_files',
    description: 'List .gtkw save files registered for the currently active testbench, with their active flag.',
    access: 'read',
    api: [ 'wave', 'listGtkwFiles' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'find_gtkw_files',
    description: 'Find .gtkw save files anywhere inside the open project by name. The user only needs to give the file name — this resolves the full path. Pass a name fragment to filter, or omit it to list every .gtkw in the project. Returns project-relative and absolute paths.',
    access: 'read',
    api: [ 'wave', 'findGtkwFiles' ],
    argStyle: 'positional',
    argNames: [ 'query' ],
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name or name fragment of the .gtkw to find (optional)'
        }
      }
    }
  },
  {
    name: 'use_gtkw_file',
    description: 'Given just a .gtkw file NAME (with or without the .gtkw extension), locate it in the project, register it for the active testbench, and mark it active — all in one step, so the next "wave" run loads it. If the name matches several files the candidates are reported so you can pick a more specific one. This is the easiest way to set the .gtkw.',
    access: 'write',
    api: [ 'wave', 'useGtkwByName' ],
    argStyle: 'positional',
    argNames: [ 'name' ],
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The .gtkw file name, e.g. "mylayout" or "mylayout.gtkw"'
        }
      },
      required: [ 'name' ]
    }
  },
  {
    name: 'add_gtkw_file',
    description: 'Register a .gtkw save file from anywhere inside the project tree for the active testbench. The file must exist and end in .gtkw. By default the freshly added entry becomes the active one.',
    access: 'write',
    api: [ 'wave', 'addGtkwFile' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or project-relative path to a .gtkw file'
        },
        setActive: { type: 'boolean', description: 'Mark this file active (default: true)' }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'set_active_gtkw_file',
    description: 'Pick which already-registered .gtkw file GTKWave loads when "wave" is run. Omit filePath to clear the selection (Aurora auto-generates a layout).',
    access: 'write',
    api: [ 'wave', 'setActiveGtkwFile' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } }
  },
  {
    name: 'remove_gtkw_file',
    description: 'Remove a .gtkw entry from the active testbench list. Does not delete the file from disk.',
    access: 'write',
    api: [ 'wave', 'removeGtkwFile' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'get_simulator',
    description: 'Read which Verilog simulator the Wave button runs. Returns "iverilog" (bundled vvp/iverilog, default — slower but preserves every internal SAPHO signal) or "verilator" (bundled Verilator — 5-10x faster on long testbenches but elides internal signals; only top-level testbench signals stay visible).',
    access: 'read',
    api: [ 'wave', 'getSimulator' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_simulator',
    description: 'Switch which simulator the Wave button runs. Use "verilator" when a long simulation is dominating the dev loop AND only top-level testbench signals matter; use "iverilog" when you need full visibility of internal SAPHO signals (in_sim_*, me1_*, delta_*, …). The choice persists across app restarts; re-running Wave picks up the new simulator immediately.',
    access: 'write',
    api: [ 'wave', 'setSimulator' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: { simulator: { type: 'string', enum: [ 'iverilog', 'verilator' ] } },
      required: [ 'simulator' ]
    }
  }
];
