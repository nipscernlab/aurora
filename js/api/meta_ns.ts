/**
 * meta_ns.ts: o namespace `AuroraAPI._meta`, o catalogo da superficie: cada
 * namespace, cada funcao com uma linha de descricao, e os eventos.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO). tests/unit/auroraApiMeta
 * trava que toda funcao exposta tem a sua linha aqui, e que nenhuma linha
 * descreve uma funcao que nao existe: quem acrescenta funcao a um namespace
 * acrescenta a linha no mesmo commit.
 *
 * Compilado por `tsc` (npm run build:ts) num meta_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { WINDOW_EVENT_BRIDGE } from './api_core.js';

/* ============================================================
 *  _meta, introspection
 *
 *  `schema()` describes the whole surface: every namespace, each
 *  function with a one-line description, and the event catalog.
 *  It is the canonical, machine-readable description of AuroraAPI
 * , handy for docs, for tests asserting coverage, and for the AI
 *  runner to reason about what the IDE can do.
 *
 *  (The AI's *executable* tool schemas, JSON Schema for function
 *  calling, live separately in main/ai/tools.js, a curated subset
 *  with access levels. This `schema()` is the full developer view.)
 * ========================================================== */

const NAMESPACES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  editor: {
    getActiveFilePath: 'Path of the file focused in the editor',
    getOpenFiles:      'Paths of every open editor tab',
    getActiveText:     'Full text of the focused file',
    setActiveText:     'Replace the focused file’s entire content',
    insertAt:          'Insert text at a position (or the cursor)',
    replaceRange:      'Replace a 1-indexed line/column range',
    getCursor:         'Current cursor line/column',
    setCursor:         'Move the cursor and reveal it',
    getLanguage:       'Monaco language id of the focused file',
    newFile:           'Create a new untitled editor buffer',
    save:              'Save the focused file',
    saveAll:           'Save every open file',
    closeTab:          'Close a tab (the active one by default)',
    reopenLastTab:     'Reopen the most recently closed tab',
    openFile:          'Open any project file in the editor (optionally in a new split)',
    formatFile:        'Format a file with Aurora’s own formatter instead of rewriting it',
    createSplit:       'Create a new editor split pane',
  },
  terminal: {
    list:    'Ids of every terminal panel',
    getText: 'Visible text of one terminal panel',
    getAll:  'Visible text of every terminal panel, keyed by id',
    clear:   'Clear a terminal panel',
    runInShell: 'Type, and optionally run, a command in the TCMD shell, the real PowerShell or bash of the user',
  },
  project: {
    close:              'Close the open project and return to the empty state',
    getCurrent:         'Path and metadata of the open project',
    getTree:            'Files and folders of the open project',
    readFile:           'Read any file inside the project folder, at any depth',
    createFile:         'Create (or overwrite) a file',
    createFolder:       'Create a directory',
    deleteFile:         'Delete a file or directory',
    renameFile:         'Rename or move a file',
    listProcessors:     'Processors of the open project + their config',
    createProcessor:    'Generate a processor in the open project, C± or C++ (refuses to duplicate one whose folder already exists on disk; recreates a name that is only a dangling .spf reference)',
    renameProcessor:    'Rename a processor (dir, .cmm, #PRNAME, .spf, artifacts)',
    createProject:      'Create a new SAPHO project and open it',
    renameProject:      'Rename the open project (folder + .spf + every stored path)',
    getRenameStatus:    'Progress or final verdict of a renameProject job',
    listRecents:        'Recently opened projects, most recent first',
    backup:             'Zip the open project into <root>/Backup/',
    setTopLevel:        'Mark a synthesizable Verilog file as the Top Level module',
    setTestbenchTop:    'Mark a Verilog file as the Testbench Top module',
    importFile:         'Import a Verilog or cocotb file into the project and register it in the .spf',
    removeImportedFile: 'Remove a file from the .spf lists, optionally deleting it from disk',
    renameImportedFile: 'Rename an imported file on disk and in its .spf entry',
    deleteProcessor:    'Delete a processor folder and its .spf entry',
    openProject:        'Open an existing project by its .spf file',
    getProcessorConfig: 'Read clk/numClocks/simTime for one (or all) processors',
    setProcessorConfig: 'Update clk/numClocks/showArrays for one processor',
    refreshTree:        'Force a fresh repaint of the file tree',
    setView:            'Switch the left panel: "file" or "hierarchy"',
    getView:            'Which tree view is active right now',
    analyzeAsm:         'Parse a SAPHO .asm and return instruction counts, families, labels and loops',
    getMissingFiles:    'Paths the .spf still references but that are gone from disk',
    dismissMissingFiles:'Prune every dangling .spf reference to a missing file',
    listMemories:       'Facts remembered about this project (<root>/.aurora/memory/)',
    remember:           'Save one durable fact about this project (overwrites the same name)',
    forget:             'Delete one project memory by name',
  },
  compile: {
    compileAll:  'Run the full CMM→ASM→Verilog→wave→PRISM pipeline',
    compileStep: 'Run one pipeline step (cmm|asm|verilog|wave|prism|verilator|verilator-proc|verilator-fast)',
    cancel:      'Cancel a running compilation or simulation',
    runStatus:   'Whether the last run is running, finished or was cancelled by the user',
    runVerilatorProc: 'Hardware test of the active SAPHO processor under Verilator (the verilatorproc button)',
    runFastSim:       'Run the testbench headless, no waveform (the fastsim button)',
    listSteps:           'List every toolchain step the override system knows about',
    inspectCommand:      'Show the CommandSpec (base + override-applied) for a step',
    previewCommand:      'Dry-run a hypothetical override on top of the current spec',
    listOverrides:       'List every registered command override (ephemeral + persisted)',
    setOverride:         'Register a command override for a step (ephemeral by default)',
    clearOverride:       'Remove a registered override',
    listProtectedFlags:  'List flags that overrides cannot remove or replace for a step',
    listAllowedBinaries: 'List binaries the main-process executor will spawn',
  },
  wave: {
    listSignals:        'Signals discovered for the testbench + which are selected',
    setSignals:         'Choose which signals are dumped into GTKWave',
    openConfig:         'Open the Wave Configuration modal',
    listGtkwFiles:      'List .gtkw save files registered for the active testbench',
    findGtkwFiles:      'Find .gtkw files in the project by name (resolves the path for you)',
    useGtkwByName:      'Locate a .gtkw by name and set it active for the testbench in one step',
    addGtkwFile:        'Register a .gtkw file from the project for the active testbench',
    setActiveGtkwFile:  'Pick which registered .gtkw file GTKWave loads',
    removeGtkwFile:     'Drop a .gtkw file from the active testbench list',
    createSurferLayout: 'Write a .sucl Surfer layout and register it for the testbench',
    createGtkwLayout: 'Write a .gtkw layout from a signal list and register it for the testbench',
    listSurferFiles:    'List Surfer layouts (.surf.ron/.sucl) registered for the active testbench',
    openSurfer:         'Open a waveform file in Surfer, optionally with a saved layout',
    findSurferFiles:    'Find Surfer layout files (.surf.ron/.sucl) in the project by name',
    useSurferByName:    'Locate a Surfer layout by name and set it active for the testbench in one step',
    addSurferFile:      'Register a Surfer layout (.surf.ron/.sucl) for the active testbench',
    setActiveSurferFile:'Pick which registered Surfer layout the Surfer viewer loads (null = raw VCD)',
    removeSurferFile:   'Drop a Surfer layout from the active testbench list',
    getSimulator:       'Which simulator the Wave button runs (iverilog | verilator)',
    setSimulator:       'Switch the Wave-button simulator (iverilog | verilator)',
    getViewer:          'Which waveform viewer the Wave button opens (gtkwave | surfer)',
    setViewer:          'Switch the waveform viewer (gtkwave external window | surfer embedded)',
    getSurferMultiWindow: 'Whether Surfer keeps multiple windows open (false = single window, default)',
    setSurferMultiWindow: 'Enable/disable multiple Surfer windows to compare runs ({ enabled: boolean })',
  },
  prism: {
    simStatus:        'State of the PRISM interactive simulation: module, tick, running, speed, levels, every port and monitored signal with its value',
    simEnter:         'Enter Simulate mode for the module on screen in PRISM (synthesises with Yosys, takes seconds)',
    simExit:          'Leave the simulation and go back to the static schematic',
    simControl:       'Drive time: run | pause | tick | next | fast | reset',
    simSetSpeed:      'Ticks per second while it runs',
    simSetHalfPeriod: 'Clock half period, in ticks',
    simSetInput:      'Write a value into one input port',
    simListWires:     'Wires of the visible level that can be monitored, with their current value',
    simMonitor:       'Waveform monitor: add | remove | base | trigger (stop at a value) | clear',
    simRunUntil:      'Advance an exact number of ticks, or until a signal reaches a value, and report where it stopped',
    simExportWave:    'Write the monitored signals as a .vcd and open it in the waveform viewer',
    simLevel:         'Walk the hierarchy inside the simulation: enter a submodule, back, or top',
  },
  examples: {
    list:    'The five ready-made example projects: what each one teaches and which processor it carries',
    install: 'Create all five in a folder the user picks, and return the .spf path of each',
  },
  manual: {
    search: 'Search the offline SAPHO manual and get the closest pages with a snippet of each',
    read:   'Read one page of the manual as plain text, by the path search returned',
    cite:   'Verify a quote against the manual file and get the full sentence back',
    status: 'Whether the manual is installed on this machine, and which version',
  },
  settings: {
    getAll: 'Snapshot of every user-facing IDE setting',
    set:    'Update one setting (locale / tooltipsEnabled / verboseMode)',
  },
  rules: {
    get:            'The full sapho_rules.json knowledge base',
    getDirective:   'Details of one hardware directive',
    listDirectives: 'Names of every hardware directive',
    getKeywords:    'CMM language keywords',
    lookupMessage:  'A yanc compiler message by its code',
    listOpcodes:    'Every SAPHO assembly opcode (mnemonic, number, family, description)',
    getOpcode:      'One opcode by mnemonic',
  },
  ui: {
    showNotification: 'Show a toast notification',
    openSettings:     'Open the Settings modal',
    getLocale:        'The active UI locale',
    setLocale:        'Switch the UI locale',
    askUserQuestion:  'Pause the AI turn and ask the user an inline question',
  },
  ai: {
    open:              'Open the Aurora Intelligence chat panel',
    askAboutSelection: 'Open the chat seeded with a selected code snippet (Explain/Fix/Improve/Comment)',
    runInBackground:   'Run a compile task in the background; the assistant auto-reports when it finishes',
  },
  // O `git` mora em ./git_ns.js, mas descrever-se e obrigacao de quem entra na
  // superficie: o commit que criou o namespace (e5c9a244) o expos como `git:` e
  // esqueceu esta entrada, entao a schema(), que se anuncia como a superficie
  // INTEIRA, omitia quatorze metodos. Quem achou foi o api-surface.test.js.
  git: {
    status:       'Working tree status: branch, ahead/behind, staged and unstaged files',
    log:          'Recent commits, newest first: hash, subject, author and date',
    branches:     'Local and remote branches, and which one is checked out',
    diff:         'Diff of one file or of the whole tree, staged or unstaged',
    stage:        'Stage files (add to the index)',
    unstage:      'Unstage files, keeping the changes',
    discard:      'Throw away the uncommitted changes of files',
    commit:       'Commit what is staged, optionally amending the last one',
    createBranch: 'Create a branch from HEAD and switch to it',
    switchBranch: 'Check out an existing branch',
    fetch:        'Fetch from the remote, without touching the working tree',
    pull:         'Pull from the remote (fetch + merge, with autostash)',
    push:         'Push the current branch to the remote',
    stash:        'Stash the uncommitted changes, including untracked files',
  },
  events: {
    on:   'Subscribe to a bus event; returns an unsubscribe fn',
    off:  'Unsubscribe a handler',
    emit: 'Publish a bus event',
  },
});

export const metaNs = Object.freeze({
  version: '1.0.0',
  /** Machine-readable description of the whole AuroraAPI surface. */
  schema() {
    return {
      version: '1.0.0',
      namespaces: NAMESPACES,
      events: {
        // Emitted directly by AuroraAPI methods.
        emitted: ['compile:started', 'compile:cancelled', 'editor:new-file', 'editor:saved'],
        // Legacy window CustomEvents re-broadcast on the bus.
        bridged: { ...WINDOW_EVENT_BRIDGE },
      },
    };
  },
});
