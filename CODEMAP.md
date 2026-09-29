# How AURORA is put together

A map for your first week. It says where things live and which rules are not
obvious from the code. It does not describe features: for those, read the
[README](README.md) and the manual. Before refactoring the renderer, also read
[ARCHITECTURE.md](ARCHITECTURE.md) (in Portuguese): the contracts the renderer
depends on but does not enforce, each learned from something breaking.

## Three processes, one bridge

AURORA is an Electron app, so code runs in three places that cannot call each
other directly.

- **Main process** (`main.js`, `main/`). Node.js: files, child processes (the
  compilers, simulators, Git), windows, updates. Most files are CommonJS
  `.js`; the `.ts` ones are compiled to CommonJS by `tsconfig.main.json`.
- **Preload** (`js/app/preload*.js`). One per window. It runs sandboxed, so
  it may only `require('electron')` (`tests/unit/preloadSandbox.test.js`
  enforces this). Its only job is to expose the bridge.
- **Renderer** (`js/`, `index.html`, `html/`). The UI. ES modules bundled by
  Vite into `dist/`, and **the app always loads `dist/`, never the sources**
  (`main/render_loader.js`). The main window's entry point is
  `js/app/renderer.js`.

The bridge is a set of objects on `window`: `electronAPI` (files, projects,
compilation, dialogs, terminal), `aiAPI`, `gitAPI`, `lspAPI`, `slangAPI`,
`treeSitterAPI`, `pyLibsAPI`, and two format APIs. Renderer code imports
`electronAPI` from `js/app/electron_api.js`, a live proxy over
`window.electronAPI`, so tests can swap the object.

**Adding a bridge method** touches three places: an `ipcMain.handle` in
`main/ipc/`, the method in the matching section of `js/app/preload.js`, and,
if TypeScript code calls it, its signature in `js/types/aurora-globals.d.ts`.
`tests/unit/contratoDaPonte.test.js` runs the preload and fails if a channel
has no handler, a method the renderer calls is not exposed, or a typed method
does not exist.

## TypeScript and the generated `.js`

The code is halfway through a move from JavaScript to strict TypeScript (see
"Changing a file" in [CONTRIBUTING](CONTRIBUTING.md)). When a folder has both
`x.ts` and `x.js`, **the `.ts` is the source**: `npm run build:ts` writes the
`.js` next to it, and `.gitignore` lists every such `.js`. Imports keep saying
`./x.js`; the bundler and the test runner resolve it to the `.ts`.
`scripts/check-no-generated-js.js` fails CI if a generated `.js` gets committed.

A few JavaScript modules that TypeScript code imports have a hand-written,
partial `.d.ts` next to them (`tab_manager.d.ts`, `monaco_editor.d.ts`,
...). They describe only what the `.ts` files use
and disappear when the module is converted.

## Globals on `window`

Many modules still share state by writing `window.X` in one file and reading
it in another (`window.TabManager`, `window.AuroraAPI`, `window.t`, ...). That
dependency does not show in any `import`, has no type, and depends on load
order, because several modules set themselves up the moment they are imported
(`js/terminal/shell_terminal.ts`, `js/terminal/terminal.ts`, the file tree).
`js/app/renderer.js` imports everything, partly just for those side effects.

New code imports what it needs. `scripts/check-window-globals.mts` (in CI)
keeps a list of the globals that exist and fails when a new one appears. The
project path is the example of the way out: it lives in
`js/project/project_store.ts`, which modules import; `window.currentProjectPath`
is only a mirror for the one reader left (TODO section 13).

## The toolchain is downloaded, not versioned

`components/` holds the compilers, simulators and viewers, and almost none of
it is in Git. `npm start` runs `bootstrap`, which downloads them:
`components/Packages/` (Icarus, Verilator, Python, Yosys, GTKWave, ...) and,
from a pinned [yanc](https://github.com/nipscernlab/yanc) release,
`components/bin`, `SAPHO`, `Header` and `Macros`. The pin is `YANC_TAG` in
`components/Scripts/download-yanc.js`. The SAPHO Verilog and the yanc assembler
must come from the same yanc version. To try an unreleased yanc, see "Testing a
local yanc build" in the README.

`resources/sapho_rules.json`, which the AI assistant reads, is generated from a
yanc checkout by `npm run rules:sync` and committed.

## Following a feature

| You want to change | Start here |
|---|---|
| A toolbar compile button | `js/compilation/compilation_flow.ts` → `compilation_module.ts` (the state of one compile; each step lives in its own module: `processor_compiler.ts`, `checagem_de_sintaxe.ts`, `icarus_da_onda.ts`, `verilator_da_onda.ts`, `cocotb_da_onda.ts`, `teste_de_hardware.ts`, ...) → `builders/` (the command line of each tool) → `spec_runner.ts` → `electronAPI.execSpec` → `main/ipc/compile.js` and `main/compile/` |
| The AI panel | `js/ui/ai_assistant_manager.js` (the panel and the turn) and `js/ai/` (rendering, attachments, queue, provider status); main side in `main/ai/` |
| What the AI can do in the IDE | `js/api/aurora_api.js` and `js/api/*_ns.ts` (the AuroraAPI), tool list in `main/ai/tools.js` |
| The file tree | `js/tree/` (Folders view: `standard_tree_*`), `js/project/file_mode.js` (Verilog view) |
| The terminals | `js/terminal/terminal_module.ts` (output terminals), `shell_terminal.ts` (TCMD) |
| Tabs and the editor | `js/tabs/tab_manager.js`, `js/editor/` |
| Opening, creating, closing projects | `js/project/project_manager.ts`, `project_store.ts`, `main/ipc/project.js` |
| Waveforms | `js/wave/`, `js/api/wave_ns.ts` |
| PRISM (schematic and logic simulation) | `html/prism/`, `main/ipc/prism.js` |

## Tests

- `npm test`: unit tests (Vitest, happy-dom for DOM code), in `tests/unit/`.
  Every changed line needs one; `npm run test:coverage && npm run
  coverage:diff` checks it.
- `npm run test:e2e`: drives the real app. It builds `dist/` first, because
  the app loads `dist/` and not the sources. Running the E2E config directly
  without that step tests an old bundle.
- `npm run test:toolchain`: compiles and simulates real SAPHO programs with the
  downloaded toolchain. It needs `components/` in place (run `npm start` once);
  CI runs it only in the release workflow.

## Where the history lives

`TODO.md` is the working plan and, section by section, the record of why
things are the way they are. Section 13 is the current restructuring (globals,
large files) and section 14 the rest of the TypeScript migration.
