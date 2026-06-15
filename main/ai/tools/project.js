// @ts-check
/**
 * Project tools — `api` namespace 'project' (tree, files, processors, project lifecycle).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'get_current_project',
    description: 'Get the path and metadata of the SAPHO project currently open.',
    access: 'read',
    api: [ 'project', 'getCurrent' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_project_tree',
    description: 'List ALL files in the open project recursively, as relative paths (e.g. "src/main.cmm"). Use this before read_file to get the exact path of any file.',
    access: 'read',
    api: [ 'project', 'getTree' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_file',
    description: 'Read the full text of ANY file inside the open project folder, at any nesting depth — not just the focused editor tab. Use get_project_tree to discover paths first.',
    access: 'read',
    api: [ 'project', 'readFile' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path, or a path relative to the project root'
        }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'list_processors',
    description: 'List the processors of the open project together with their configuration.',
    access: 'read',
    api: [ 'project', 'listProcessors' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_missing_files',
    description: "List the project's MISSING files — paths the .spf still references but that no longer exist on disk (moved, renamed, or deleted outside Aurora). Same list the file tree's missing-files warning shows, always current. Returns { count, files:[{name, path, category}] }; empty when nothing is missing. Use this to reason about a broken build or before offering to clean up dangling references with dismiss_missing_files.",
    access: 'read',
    api: [ 'project', 'getMissingFiles' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'analyze_asm',
    description: 'Parse a SAPHO assembly (.asm) file and return a structured summary: total instruction count, count per opcode, count per family (memory/arith_float/arith_int/control/io/...), labels with line numbers, and detected loops (back-jumps with body size). Use this to find optimisation targets (the largest loops) and to verify an optimisation actually reduced the instruction count. Provide either filePath OR processorName; if neither, the active editor file is used (must be .asm).',
    access: 'read',
    api: [ 'project', 'analyzeAsm' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path to a .asm file' },
        processorName: { type: 'string', description: 'Resolves to <root>/<proc>/Software/<proc>.asm' }
      }
    }
  },
  {
    name: 'create_file',
    description: 'Create a new file (or overwrite an existing one) with the given content.',
    access: 'write',
    api: [ 'project', 'createFile' ],
    argStyle: 'positional',
    argNames: [ 'filePath', 'content' ],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path of the file' },
        content: { type: 'string', description: 'File content (empty if omitted)' }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'create_folder',
    description: 'Create a directory.',
    access: 'write',
    api: [ 'project', 'createFolder' ],
    argStyle: 'positional',
    argNames: [ 'dirPath' ],
    inputSchema: {
      type: 'object',
      properties: { dirPath: { type: 'string', description: 'Absolute path of the directory' } },
      required: [ 'dirPath' ]
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory.',
    access: 'write',
    api: [ 'project', 'deleteFile' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file from one absolute path to another.',
    access: 'write',
    api: [ 'project', 'renameFile' ],
    argStyle: 'positional',
    argNames: [ 'fromPath', 'toPath' ],
    inputSchema: {
      type: 'object',
      properties: { fromPath: { type: 'string' }, toPath: { type: 'string' } },
      required: [ 'fromPath', 'toPath' ]
    }
  },
  {
    name: 'create_processor',
    description: 'Generate a processor in the open project. Hardware widths (nBits/nbMantissa/nbExponent) are in bits.',
    access: 'write',
    api: [ 'project', 'createProcessor' ],
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
        gain: { type: 'number' }
      },
      required: [ 'processorName' ]
    }
  },
  {
    name: 'create_project',
    description: 'Create a new SAPHO project under location/name and open it. The name may contain only letters, numbers, underscore or hyphen.',
    access: 'write',
    api: [ 'project', 'createProject' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        location: { type: 'string', description: 'Parent directory for the new project folder' }
      },
      required: [ 'name', 'location' ]
    }
  },
  {
    name: 'rename_project',
    description: 'Rename the CURRENTLY OPEN SAPHO project everywhere: the project root folder (<location>/<old> → <location>/<new>), the <old>.spf project file, the .spf metadata (projectName/projectPath/basePath) and EVERY absolute path stored in the .spf (synthesizable + testbench file lists, top-level/testbench pointers, persisted command-override cwd/env). Processor folders move with the root, so their #PRNAME directives are untouched (use rename_processor for a processor). The project is reopened at its new path automatically. The name may contain only letters, numbers, underscore or hyphen.',
    access: 'write',
    api: [ 'project', 'renameProject' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        newName: { type: 'string', description: 'New project name (letters, digits, _ or -)' }
      },
      required: [ 'newName' ]
    }
  },
  {
    name: 'open_project',
    description: 'Open an existing SAPHO project by its .spf file path.',
    access: 'write',
    api: [ 'project', 'openProject' ],
    argStyle: 'positional',
    argNames: [ 'spfPath' ],
    inputSchema: {
      type: 'object',
      properties: { spfPath: { type: 'string' } },
      required: [ 'spfPath' ]
    }
  },
  {
    name: 'list_recent_projects',
    description: 'List recently opened SAPHO projects with full .spf paths and human-friendly names.',
    access: 'read',
    api: [ 'project', 'listRecents' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'backup_project',
    description: 'Create a timestamped backup (.zip) of the currently open SAPHO project. Returns the absolute path of the archive.',
    access: 'write',
    api: [ 'project', 'backup' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'delete_processor',
    description: 'Delete a processor from the open project: removes its folder (Hardware/Simulation/Software + .cmm) and its SPF entries. Irreversible — prefer backup_project first.',
    access: 'write',
    api: [ 'project', 'deleteProcessor' ],
    argStyle: 'positional',
    argNames: [ 'processorName' ],
    inputSchema: {
      type: 'object',
      properties: { processorName: { type: 'string' } },
      required: [ 'processorName' ]
    }
  },
  {
    name: 'rename_processor',
    description: 'Rename an existing processor everywhere SAPHO/Aurora cares: the processor working directory (<old> to <new>), the Software/<old>.cmm source file, the #PRNAME directive inside it, the auto-generated build artifacts (.asm, Hardware/<old>.v, Simulation/<old>_tb.v) and every reference in the .spf (the processors[] entry — clk/numClocks/showArrays are preserved — plus the top-level, testbench and synthesizable/testbench file path lists). User comments and code inside the .cmm are NOT touched, only the #PRNAME directive. Open editor tabs are re-pointed automatically. Custom user toplevels/testbenches at the project root are NOT renamed — use rename_file for those.',
    access: 'write',
    api: [ 'project', 'renameProcessor' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Current processor name' },
        newName: { type: 'string', description: 'New name (letters, digits, _ or -)' }
      },
      required: [ 'processorName', 'newName' ]
    }
  },
  {
    name: 'import_file',
    description: 'Register an existing .v / .sv / .vh / .py file as a synthesizable or testbench file in the current project SPF. Copies the file into the project root if it lives elsewhere. Python .py files are treated as cocotb testbenches.',
    access: 'write',
    api: [ 'project', 'importFile' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute source path of the file to import' },
        kind: {
          type: 'string',
          enum: [ 'synthesizable', 'testbench' ],
          description: 'Which SPF list to add to'
        }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'rename_imported_file',
    description: 'Rename an imported file (in both the SPF list and on disk).',
    access: 'write',
    api: [ 'project', 'renameImportedFile' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: { fromPath: { type: 'string' }, toPath: { type: 'string' } },
      required: [ 'fromPath', 'toPath' ]
    }
  },
  {
    name: 'remove_imported_file',
    description: 'Remove a file from the SPF synthesizable / testbench list. By default the file is kept on disk; set deleteFromDisk:true to also delete it.',
    access: 'write',
    api: [ 'project', 'removeImportedFile' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' }, deleteFromDisk: { type: 'boolean', default: false } },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'dismiss_missing_files',
    description: "Dismiss the missing-files warning by pruning every dangling reference from the .spf (the synthesizable / testbench lists, plus the top-level / testbench pointers if they point at a missing file). The files are already gone from disk — this only cleans up the project's stale references, so the warning stops reappearing. Use only when the user has confirmed they deleted those files on purpose. Returns { removed }.",
    access: 'write',
    api: [ 'project', 'dismissMissingFiles' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_top_level',
    description: "Mark a synthesizable Verilog file as the project's Top Level module (the synthesizable root). Registers the file in the project if it is not yet tracked, and refreshes the file tree. Call this after create_file and before compiling. Do NOT use on the auto-generated <proc>.v inside <proc>/Hardware/ — that file is managed by SAPHO.",
    access: 'write',
    api: [ 'project', 'setTopLevel' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path to the .v file' }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'set_testbench_top',
    description: "Mark a Verilog or cocotb Python file as the project's Testbench Top module (the simulation entry point). Registers the file in the project if it is not yet tracked, and refreshes the file tree. Call this after create_file and before compiling. Do NOT use on the auto-generated <proc>_tb.v inside <proc>/Simulation/ — that file is managed by SAPHO.",
    access: 'write',
    api: [ 'project', 'setTestbenchTop' ],
    argStyle: 'positional',
    argNames: [ 'filePath' ],
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or project-relative path to the testbench .v/.sv/.py file'
        }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'get_processor_config',
    description: 'Read the simulation config of one (or every) processor: clk (MHz), numClocks, simTime_us = numClocks/clk, showArrays, and the parsed CMM header directives (NUBITS, NBMANT, NBEXPO, ...). Omit processorName to get them all.',
    access: 'read',
    api: [ 'project', 'getProcessorConfig' ],
    argStyle: 'positional',
    argNames: [ 'processorName' ],
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string', description: 'Processor name; omit to list every processor' }
      }
    }
  },
  {
    name: 'set_processor_config',
    description: 'Update the clock frequency (clk, MHz), simulation length (numClocks), or array-debug flag of one processor. Aurora bakes `$finish` at `numClocks/clk` µs, so this is the lever to change total simulation time. Omitted fields keep their current value.',
    access: 'write',
    api: [ 'project', 'setProcessorConfig' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        processorName: { type: 'string' },
        clk: { type: 'number', description: 'Clock frequency in MHz (positive)' },
        numClocks: { type: 'number', description: 'Total clock cycles to simulate (positive int)' },
        showArrays: { type: 'boolean', description: 'Dump array contents into the waveform' }
      },
      required: [ 'processorName' ]
    }
  },
  {
    name: 'refresh_file_tree',
    description: 'Force-repaint the project file tree. Use this after creating or importing files that are not yet showing up in the tree.',
    access: 'write',
    api: [ 'project', 'refreshTree' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_tree_view',
    description: 'Switch the left panel between the file tree and the post-synthesis hierarchy tree. The hierarchy view is only populated after a successful Verilog compilation — call compile_step("verilog") first if it is empty.',
    access: 'write',
    api: [ 'project', 'setView' ],
    argStyle: 'positional',
    argNames: [ 'mode' ],
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: [ 'file', 'hierarchy' ] } },
      required: [ 'mode' ]
    }
  },
  {
    name: 'get_tree_view',
    description: 'Report which tree view is active and whether the hierarchy view is available.',
    access: 'read',
    api: [ 'project', 'getView' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  }
];
