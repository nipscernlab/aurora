/**
 * aurora_api.js, `window.AuroraAPI`, the single async, JSON-serialisable
 * surface for every IDE operation.
 *
 * Phase A (this file). A thin *facade* that delegates to the existing
 * managers (EditorManager, TabManager, compilationFlowManager, …).
 * Importantly, nothing in the UI is rewired yet: toolbar buttons still
 * attach their own listeners, file-tree clicks still call into project
 * managers directly, etc. Phase A just exposes the surface so:
 *   - Aurora Intelligence can drive the IDE through stable function
 *     calls (PR 4),
 *   - dev tooling and tests can script the IDE without poking private
 *     fields,
 *   - subsequent phases can rewrite call sites to go through the API
 *     incrementally, without a big-bang refactor.
 *
 * Conventions
 * ===========
 *   - Every function is async and returns `{ ok, data?, error? }`. The
 *     shape is JSON-serialisable so the same value can travel over IPC
 *     to the AI runner without ceremony.
 *   - On error we resolve (not reject) with `ok:false` and a structured
 *     error. Tool-calling agents handle data better than they handle
 *     thrown promises.
 *   - All references to managers go through `window.*` or named imports
 *     and are resolved *at call time*, so the facade is safe to mount
 *     before every manager has finished booting.
 *
 * Future phases (next PRs):
 *   - Phase B: rewrite toolbar/shortcut handlers to call `AuroraAPI.X()`
 *     instead of touching managers directly.
 *   - Phase C: replace scattered `dispatchEvent(new CustomEvent(...))`
 *     publishers with `AuroraAPI.events.emit(...)`.
 *   - Phase D: flesh out `_meta.schema()` into a full JSON-Schema tool
 *     manifest auto-consumable by the AI runner.
 */

import { gitNs } from './git_ns.js';
import { prismNs } from './prism_ns.js';
import { waveNs } from './wave_ns.js';
import { memoriasDoProjeto } from './memorias_ns.js';
import { processadoresDoProjeto } from './processadores_ns.js';
import { arquivosDoProjeto } from './arquivos_ns.js';
import { cicloDoProjeto } from './ciclo_do_projeto_ns.js';
import { renomearProjeto } from './renomear_projeto_ns.js';
import { rulesNs } from './rules_ns.js';
import { analiseDoAsm } from './analise_asm_ns.js';
import { listarArquivosDoProjeto } from './arvore_do_projeto.js';
import { examplesNs } from './examples_ns.js';
import { manualNs } from './manual_ns.js';
import { uiNs } from './ui_ns.js';
import { aiNs } from './ai_ns.js';
import { settingsNs } from './settings_ns.js';
import { terminalNs } from './terminal_ns.js';
import { compileNs } from './compile_ns.js';
import { editorNs } from './editor_ns.js';

// Envelope de resposta e barramento de eventos. Moram em api_core.js, que nao
// importa nada, porque importar ESTE arquivo inicializa a IDE inteira e por
// isso nenhum teste alcancava o nucleo. Ver js/api/api_core.js.
import { on, off, emit, WINDOW_EVENT_BRIDGE } from './api_core.js';



// Achar um arquivo do projeto pelo nome que a IA deu mora em
// arvore_do_projeto.ts (acharArquivoNoProjeto).

/* ============================================================
 *  Event bus
 *
 *  In-renderer pub/sub. Returns an unsubscribe function from
 *  `on()` so callers don't need to retain handler references.
 *  Phase C migrates the existing `window.dispatchEvent` publishers
 *  to emit here as well.
 * ========================================================== */


/* ============================================================
 *  Legacy window-event bridge
 *
 *  Aurora predates this bus, so cross-cutting signals are still
 *  dispatched as `CustomEvent`s on `window`. Rather than a risky
 *  big-bang migration of every publisher, we bridge them: each
 *  legacy event is re-emitted on the bus under a normalised,
 *  colon-namespaced name. Existing `window.addEventListener`
 *  callers keep working untouched; new code (and Aurora
 *  Intelligence) gets one consistent surface via
 *  `AuroraAPI.events.on(...)`.
 * ========================================================== */


function bridgeWindowEvents() {
  for (const [domEvent, busEvent] of Object.entries(WINDOW_EVENT_BRIDGE)) {
    window.addEventListener(domEvent, (e) => emit(busEvent, e && e.detail != null ? e.detail : null));
  }
}

// O namespace editor mora em editor_ns.ts.

// O namespace terminal mora em terminal_ns.ts.

/* ============================================================
 *  project, current project, filesystem tree, file/processor/
 *  project lifecycle
 * ========================================================== */

// Renomear o projeto (o job em segundo plano, renameProject e getRenameStatus)
// mora em renomear_projeto_ns.ts.

const projectNs = {
  // O ciclo do projeto (fechar, o atual, criar, abrir, recentes, backup e os
  // dois topos) mora em ciclo_do_projeto_ns.ts.
  ...cicloDoProjeto,
  ...renomearProjeto,

  // A listagem mora em arvore_do_projeto.ts, que a busca de layouts do wave
  // tambem usa.
  getTree(rootPath) { return listarArquivosDoProjeto(rootPath); },

  // Os arquivos (ler, criar, apagar, renomear, importar, os que sumiram,
  // repintar e a vista da arvore) moram em arquivos_ns.ts.
  ...arquivosDoProjeto,

  // A analise de .asm (analyzeAsm) mora em analise_asm_ns.ts.
  ...analiseDoAsm,

  // As memorias do projeto (listMemories, remember, forget) moram em
  // memorias_ns.ts.
  ...memoriasDoProjeto,

  // Os processadores (listar, criar, apagar, renomear e a config de
  // simulacao) moram em processadores_ns.ts.
  ...processadoresDoProjeto,



};

// O namespace compile mora em compile_ns.ts.

/* ============================================================
 *  wave: mora em js/api/wave_ns.ts
 * ========================================================== */

// O namespace rules (a base de conhecimento do yanc) mora em rules_ns.ts.

// Os namespaces ui, ai e settings moram em ui_ns.ts, ai_ns.ts e settings_ns.ts.

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

const NAMESPACES = Object.freeze({
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

// The AuroraAPI.git namespace (Source Control for the AI) lives in ./git_ns.js
// (imported at the top) so it stays unit-testable without the editor/monaco
// import chain. It is exposed as `git:` in the AuroraAPI surface below.

const metaNs = Object.freeze({
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

/* ============================================================
 *  Mount
 * ========================================================== */

export function initAuroraAPI() {
  if (window.AuroraAPI) return window.AuroraAPI;
  // Re-broadcast legacy window CustomEvents onto the bus so there is a
  // single place to observe IDE activity.
  bridgeWindowEvents();
  window.AuroraAPI = Object.freeze({
    editor:   Object.freeze(editorNs),
    terminal: Object.freeze(terminalNs),
    project:  Object.freeze(projectNs),
    compile:  Object.freeze(compileNs),
    wave:     Object.freeze(waveNs),
    prism:    Object.freeze(prismNs),
    rules:    Object.freeze(rulesNs),
    examples: Object.freeze(examplesNs),
    manual:   Object.freeze(manualNs),
    settings: Object.freeze(settingsNs),
    ui:       Object.freeze(uiNs),
    ai:       Object.freeze(aiNs),
    git:      Object.freeze(gitNs),
    events:   Object.freeze({ on, off, emit }),
    _meta:    metaNs,
  });
  return window.AuroraAPI;
}
