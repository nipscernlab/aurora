# Renderer architecture — load-bearing invariants

This is **not** a project overview or onboarding doc. Read [README.md](README.md) for that.

This file lists the implicit contracts the renderer process depends on but doesn't enforce. Every entry here was learned by something breaking in subtle ways. **Read this before refactoring anything in [js/app/](js/app/), [js/project/](js/project/), [js/tree/](js/tree/), [js/editor/](js/editor/), [js/tabs/](js/tabs/), [js/wave/](js/wave/), or the wave-flow paths in [js/compilation/](js/compilation/).**

When you change something here, update this doc.

---

## 1. Script load order is part of the contract

[index.html](index.html) loads renderer scripts in a specific order. Some pieces (like `window.appInitializer`, `window.verilogModeManager`, `window.SharedModelRegistry`) are exposed via `window.*` for non-module callers and are referenced by name elsewhere. Loading them out of order produces silent `undefined` reads.

The order matters in three groups:

1. **Monaco loader** ([index.html:1117](index.html#L1117)) — must come before any `type="module"` script that imports `monaco_editor.js`. Monaco's AMD loader (`require([...])`) is a global side-effect; without it, `initMonaco()` rejects.
2. **Classic scripts** (`ui_state.js`, `terminal.js`, etc.) — define globals via `<script>` (no `type="module"`). They run synchronously, before module scripts.
3. **Module scripts** — deferred by spec; execute in source order **after** all classic scripts. The dependency graph for these is encoded in `import` statements, but module-level side-effects (like `window.appInitializer = ...`) still depend on file order.

**Concrete dependencies:**

- [`file_mode.js`](js/project/file_mode.js) registers `DOMContentLoaded` listeners in its constructor and must load **before** [`app_initializer.js`](js/app/app_initializer.js). Ambos chamam `activateVerilogMode` no mesmo tick (loadProject + initializeTreeBasedOnMode), coalescido via §6.
- [`monaco_editor.js`](js/editor/monaco_editor.js) must be initialized before any `TabManager.addTab` runs against a text file. The `EditorManager.ready` promise (see §7) gates this.

If you reorder these, things break in ways that don't always show up in dev.

---

## 2. State has one owner per concept

Drift between multiple "sources of truth" was responsible for several bugs in 2026. The current design assigns each piece of cross-cutting state to exactly one owner:

| Concept | Owner | How others read |
|---|---|---|
| Current project (path + spf) | [`ProjectStore`](js/project/project_store.js) | `ProjectStore.getProjectPath()` / `getSpfPath()`, mirrored to `window.currentProjectPath` / `window.currentSpfPath` for legacy reads |
| Current IDE mode (hardcoded `'project'` post-2026-05) | `AppInitializer.getCurrentMode()` ([app_initializer.js](js/app/app_initializer.js)) — compat shim, sempre retorna `'project'` | `window.appInitializer.getCurrentMode()`. Existiam tres modos (processor/project/verilog) antes da consolidacao; o shim fica pra nao quebrar callers historicos. **Nao volte a derivar do DOM** (ver §8). |
| Open tabs (filePath → content) | `TabManager.tabs` Map ([tab_manager.js](js/tabs/tab_manager.js)) | `TabManager.tabs.get(filePath)` |
| Monaco editor instances (filePath → `{editor, container}`) | `EditorManager.editors` Map ([monaco_editor.js](js/editor/monaco_editor.js)) | `EditorManager.getEditorForFile(filePath)` |
| Shared text models (filePath → `{model, refCount, savedAltVersionId}`) | `SharedModelRegistry` ([shared_models.js](js/editor/shared_models.js)) | `SharedModelRegistry.getModel(filePath)` |
| Verilog tree state (`isVerilogModeActive`, `verilogFiles`) | `VerilogModeManager` ([file_mode.js](js/project/file_mode.js)) | Don't read from outside; call its methods |

**Rule:** if you find yourself caching one of these on `this.*` somewhere, you're recreating the bug. Read from the owner.

**Resetting state:** owners must expose explicit `reset()` / `clearProject()` rather than letting external code mutate fields. [`close_project.js`](js/project/close_project.js) calls `ProjectStore.clearProject()` and `verilogModeManager.reset()` — that's the pattern.

---

## 3. Single-writer invariants

Some shared resources have a designated writer. Other call sites must not write to them, even when it would be convenient.

| Resource | Sole writer | Why |
|---|---|---|
| Monaco editor instances (creation) | `TabManager.addTab` IIFE ([tab_manager.js:565](js/tabs/tab_manager.js#L565)) | An auto-create fallback in `setActiveEditor` racing this path produced two stacked editor divs sharing a model. User saw artefacts and "can't type". Removed in `e2c82f8`. |
| `window.currentProjectPath` / `window.currentSpfPath` | `ProjectStore.setProject` / `clearProject` | Multiple writers drift; the cache vs. live state mismatch caused the "file outside folder disappears on reopen" bug. Migrated in `e01e406`. |

**`projectOriented.json` writes go through [ProjectConfigStore](js/project/project_config_store.js).** Os escritores hoje sao `VerilogModeManager` (file tree picker — synthesizableFiles, testbenchFiles, topLevelFile, testbenchFile) e `GtkwPickerManager` (toolbar — gtkwFiles). Todos chamam `ProjectConfigStore.update(projectPath, mutator)` que serializa read-mutate-write por path. Cada mutator so toca os campos que seu manager possui; defaults pro resto vem de `ProjectConfigStore.DEFAULTS` — campos desconhecidos que um futuro escritor adicione sobrevivem ao round trip. **Se voce adicionar um terceiro escritor, use `update()` — nao escreva o arquivo direto.**

---

## 4. Editor creation must go through `addTab`

This is so important it gets its own section.

The contract: **only `TabManager.addTab` (text-file branch) calls `EditorManager.createEditorInstance`.** `setActiveEditor` switches between existing editors but does not create them.

The IIFE in `addTab` ([tab_manager.js:565](js/tabs/tab_manager.js#L565)):

```js
(async () => {
    await EditorManager.ready;          // gate: Monaco + initialize() done
    const editor = createEditorInstance(filePath, content);
    if (!editor) { closeTab(filePath); return; }
    setupContentChangeListener(filePath, editor);
    activateTab(filePath);              // → setActiveEditor (editor now in map)
})();
```

`createEditorInstance` is **idempotent** for the same `filePath` — second call returns the existing instance and seeds the model from `initialContent` if it was empty. This survives accidental double-creation, but the contract is still "addTab is the entry point".

**`setActiveEditor` returns `null` if the editor isn't in the map yet.** Callers (mainly `TabManager.activateTab`) must tolerate this. The IIFE above will call `activateTab` again once it succeeds.

**`navigateToSearchResult`** is the one search-result jump; it expects the editor to already be open. Don't add other consumers without thinking about content seeding.

---

## 5. Startup sequence

Aurora roda em modo unico hoje (**Project**). Historicamente existiram tres modos — Processor (PRISM single-processor), Project (com ou sem processadores), e Verilog (gated por um checkbox "Compile & Simulate"). Verilog merged em Project em maio/2026; Processor foi removido nas fases 1–2.5 (commits `b66bd6d` em diante). O pipeline auto-decide hoje sim-completa vs verilog-only via `projectConfig.processors`.

Em app start:

```
DOMContentLoaded
├── monaco_editor.js DOMContentLoaded handler
│   ├── await initMonaco()              // load Monaco AMD modules
│   ├── await EditorManager.initialize() // grab #monaco-editor, set theme
│   └── _resolveEditorManagerReady()    // unblock TabManager.addTab IIFEs
│
├── renderer.js DOMContentLoaded handler
│   ├── TabManager.initialize()         // restore tab order, listeners
│   ├── fileTreeManager.initialize()    // schedules initializeTreeBasedOnMode +100ms
│   ├── projectManager.initialize()     // wire Open Project buttons
│   └── ...
│
└── app_initializer.js DOMContentLoaded handler
    └── await restoreLastSession()
        └── await projectManager.loadProject(lastSpf)
            ├── ProjectStore.setProject(spf, base)
            ├── activateVerilogMode()   // sempre (modo unico)
            └── ...
```

**Gotchas:**

- `initializeTreeBasedOnMode` em [`fileTreeManager.initialize`](js/tree/file_tree_manager.js) roda apos `setTimeout(100ms)` e tambem chama `activateVerilogMode`. A coalescencia interna (§6) garante que so um `loadConfiguration` roda mesmo se as duas chamadas batem no mesmo tick.
- Monaco's AMD modules load asynchronously. A `TabManager.addTab` call before `EditorManager.ready` resolves will block on the IIFE's `await` — the tab DOM is created immediately, the editor isn't.

---

## 6. `activateVerilogMode` is coalesced

[`file_mode.js`](js/project/file_mode.js) wraps `activateVerilogMode` in a `_activatePromise` que retorna a mesma promise in-flight pra callers concorrentes. Pelo menos duas paths podem chama-la no mesmo tick durante session-restore:

1. `projectManager.loadProject` → `activateVerilogMode`
2. `fileTreeManager.initializeTreeBasedOnMode` (`setTimeout(100ms)`) → `activateVerilogMode`

Sem coalescencia, ambos rodavam `loadConfiguration` em paralelo — cada um fazia `verilogFiles = []` e aguardava I/O — entao o reset da chamada B limpava os pushes da chamada A em pleno meio de iteracao, deixando linhas duplicadas.

**A promise tambem e gated em `this.initPromise`** (cache de elementos DOM) pra que uma ativacao programatica precoce nao caia antes do `cacheElements()` rodar.

**Nao chame `activateVerilogMode` de dentro dela** (recursao), e nao contorne o wrapper chamando `loadConfiguration` direto.

---

## 7. `EditorManager.ready`

[`monaco_editor.js`](js/editor/monaco_editor.js) exposes `EditorManager.ready` — a promise resolved (in `finally`) after `initMonaco()` and `EditorManager.initialize()` complete or throw.

`TabManager.addTab` awaits this before calling `createEditorInstance`. Without it, a fast user click during the brief AMD-load window produces "EditorManager has not been initialized" because `editorContainer` is still `null`.

**The promise resolves even on init failure** (the `finally` runs unconditionally). `createEditorInstance` defends against this with a lazy fallback (re-fetches `#monaco-editor` from DOM) and a `window.monaco` check. If both fail it logs and returns `undefined` — `addTab` then closes the tab.

---

## 8. Known fragilities (don't refactor without thinking)

These are areas where we have evidence things break in non-obvious ways. Touch with care.

- **monaco-editor must be exactly 0.52.2.** 0.53.0 throws inside its own `css/monaco.contribution.js` during init, which blocks `EditorManager.initialize()` and leaves the editor half-broken — cursor renders, typing is dead. Symptom is intermittent (depends on which contribution module fails first) and dodges casual testing. The version is pinned exactly in [package.json](package.json) (no caret) and verified by [scripts/check-pinned-versions.js](scripts/check-pinned-versions.js), which runs on `npm start` (`prestart`) and in CI after `npm ci`. **Don't relax the pin** until upstream Monaco actually fixes 0.53+.

  The same script auto-watches any other dependency you pin exactly. To opt a package into strict checking, drop its caret/tilde in package.json — no other plumbing needed.

- **`getCurrentMode` e um shim hardcoded — nao volte a deriva-lo do DOM.** Pre-`b046e5a`, `appInitializer.getCurrentMode()` retornava `null` ate `switchToMode` rodar. A maioria dos callers comparava contra literais de modo, entao `null` significava "trate como nao-esse-modo". Uma tentativa em 2026-05 (`b046e5a`, revertida em `ecb3591`) fez derivar do DOM — quebrou Monaco editing em sessoes restauradas, de forma reproducivel mas com interacao nao pinada. Apos a consolidacao de modos (fases 1–2.5), o shim retorna literal `'project'` e nao deve ler DOM. **Se voce repensar getCurrentMode (ex: trazer modos de volta), rode o smoke test open-close-reopen-edit manualmente** ate termos um integration test que pegue essa classe de regressao.
- **`#file-tree` has three view subcontainers + ONE controller.** Three views render the file tree (standard folder listing, verilog picker, module hierarchy). The whole subsystem went through a five-bug debugging chain before settling on a two-layer design that prevents the regression class entirely:

  **Layer 1 — physically separate DOM subtrees** ([`treeView`](js/tree/tree_view.js)). Each view writes only into its own subtree. Renderers literally cannot collide.
  **Layer 2 — single controller** ([`fileTreeViewController`](js/tree/file_tree_view_controller.js)) that owns:
    - the toggle button click listener (exactly one, attached once),
    - the active-view name (`'standard' | 'verilog' | 'hierarchy'`),
    - the hierarchy data (so the toggle's enabled state is a function of "is data available"),
    - the "what does file-mode mean?" decision (modo unico hoje — sempre verilog picker; o branch standard fica como renderer registrado pra compat).
    ```html
    <div id="file-tree" data-active-view="…">
      <div class="tree-view tree-view-standard">…</div>
      <div class="tree-view tree-view-verilog">…</div>
      <div class="tree-view tree-view-hierarchy">…</div>
    </div>
    ```
    - **Each renderer writes only into its own subtree.** Standard tree → `treeView.getContainer('standard')`. Verilog picker → `treeView.getContainer('verilog')`. Hierarchy view → `treeView.getContainer('hierarchy')`. Renderers literally cannot collide because they target different DOM trees.
    - **CSS shows only the active subtree** based on `[data-active-view]`. Switching views is a single attribute change (`treeView.setActive('verilog')`); no DOM mutation needed, and inactive subtrees keep their content for cheap toggling back.
    - **All view-switching goes through `fileTreeViewController`.** Public API: `showFileMode()`, `showHierarchyMode()`, `setHierarchyData(data)`, `registerRenderer(name, fn)`. Compile flow calls `setHierarchyData(...)` when it produces hierarchy data — that single call enables the toggle and updates its icon. No direct `enable/disableToggle()`, no direct `innerHTML=''`, no direct `setActive(...)` outside the controller for switching purposes.
    - **`TreeViewState` is now a thin façade** in `file_tree_manager.js` whose getters/setters all route to the controller. It used to be the source of truth and there used to be TWO different `TreeViewState` instances in different files (`file_tree_manager.js` AND a deleted `tree_view_state_module.js`) — they never agreed and that produced an invisible bug class. The façade preserves the old API surface for legacy callers while making drift impossible (no private fields = nothing can drift).
    - **The verilog renderer is a key-based reconciler** ([file_mode.js](js/project/file_mode.js) `renderVerilogTree`) — diffs `verilogFiles` against existing `.verilog-file-item` rows by `data-file-path` and applies minimal DOM mutations. Multiple identical-data renders are zero-mutation no-ops. Don't replace this with destroy-and-rebuild.
    - **Adding a fourth view?** Add the name to `VIEW_NAMES` in tree_view.js, add the corresponding CSS rule in file_tree.css, write a renderer that targets `treeView.getContainer('<name>')`, and register it via `fileTreeViewController.registerRenderer(name, fn)`. Don't introduce a writer that touches `#file-tree` directly or attaches its own click listener to the toggle button.
    - **Don't go back to lock-based ownership or duplicate state.** Six previous attempts (commits `f196e2d`, `02f7e9c`, `b379dd4`, `c4c59ce`, `fb43adb`, `b6ec26a`, plus smaller patches) tried variations on shared-DOM-with-class-lock or per-instance hierarchyData fields synchronised by hand. Each closed the visible bug but left a new corner case open. The separate-subtree + single-controller design has no equivalent corner case — the properties are enforced by physics (separate DOMs) and by topology (one click listener, one data slot).
- **Manager constructors do I/O.** `VerilogModeManager`, `GtkwPickerManager`, etc. chamam `this.init()` no construtor, que aguarda `DOMContentLoaded`, cacheia elementos do DOM, attacha listeners, possivelmente bate em IPC. A ordem de load de scripts (§1) e a ordem implicita de init. **Mover essas chamadas e exatamente a classe de mudanca que quebra startup de forma sutil.**

---

## 9. Wave flow — VCD is the ground truth

The Wave button (Verilog-Only) goes through eight named phases. The orchestrator is `runVerilogOnlyGtkWave` in [compilation_module.js](js/compilation/compilation_module.js); each phase is a private `_wave*` method right below it. The orchestrator is intentionally short — it documents the order of operations, nothing else. **All wave-flow behaviour changes belong inside one phase.** If you find yourself touching two phases for one feature, you've found a missing abstraction; surface it before merging.

```
Click "Wave" button (Verilog-Only)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 0. validateVerilogOnlyConfig + bail-if-no-testbench            │
│    (orchestrator body, not a separate phase)                   │
├───────────────────────────────────────────────────────────────┤
│ 1. _waveResolveToolchain                                       │
│    → { tempBaseDir, scriptsPath, gtkwaveBin, vvpBin }          │
├───────────────────────────────────────────────────────────────┤
│ 2. _waveDeriveSimTopModule(config) → "tb_counter"              │
├───────────────────────────────────────────────────────────────┤
│ 3. _waveBuildAndVerifyVvp                                      │
│    runs iverilog (Phase 2 selection-validation fires here)     │
│    → ${tempBaseDir}/${simTop}.vvp on disk                      │
├───────────────────────────────────────────────────────────────┤
│ 4. _waveRunVvpSimulation                                       │
│    cd tempBaseDir && vvp <vvpFile>                             │
│    → some .vcd on disk in tempBaseDir                          │
├───────────────────────────────────────────────────────────────┤
│ 5. _waveResolveVcdFile                                         │
│    expected name? ✅ done.                                     │
│    not found? scan dir → exactly one .vcd? adopt it.           │
│    zero or multiple? throw with concrete fix instructions.     │
│    → absolute vcdFile path                                     │
├───────────────────────────────────────────────────────────────┤
│ 6. _waveStageFixVcd                                            │
│    cp ${scripts}/fix.vcd ${tempBaseDir}/fix.vcd (GTK3 redraw)  │
├───────────────────────────────────────────────────────────────┤
│ 7. _waveResolveGtkwSaveFile                                    │
│    user-curated .gtkw set? validate vs VCD, return its path.   │
│    else: generateGtkwForVcd (uses _validatedWaveSelection      │
│    cached by phase 3) → tempBaseDir/${simTop}.gtkw or null.    │
│    → absolute .gtkw path or null                               │
├───────────────────────────────────────────────────────────────┤
│ 8. _waveLaunchGtkwave                                          │
│    builds command line, execs gtkwave.exe, monitors PID        │
└───────────────────────────────────────────────────────────────┘
```

Each phase's JSDoc states inputs / returns / throws / side-effects. **Don't rely on documentation in this file alone — the in-source contracts are authoritative.** This section gives the bird's-eye view; refining a phase is a code-doc-then-code task.

The Wave button (Verilog-Only) goes through three steps with a single guiding rule: anything we ask GTKWave to display must be present in the VCD that vvp actually produced. The user can request signals from three different places, but the VCD wins.

**Sources of truth, in priority order:**

1. **User-written `$dumpfile` / `$dumpvars` in the testbench** — if the source already has either, `instrumentTestbenchSource` ([testbench_instrumenter.js](js/wave/testbench_instrumenter.js)) leaves the file alone and returns `reason: 'user-defined'`. The compile flow ([compilation_module.js](js/compilation/compilation_module.js)) then forces the cached selection to `[]` so the .gtkw step falls through to the default top-scope. **The picker selection is intentionally ignored when the user has taken control** — anything else would emit traces for signals the user's `$dumpvars` never dumped.
2. **Wave Configuration picker selection** (`projectConfig.waveSignals`) — fed verbatim into `$dumpvars(0, sig1, sig2, ...)` after validation (next bullet). The picker UI ([wave_config_manager.js](js/wave/wave_config_manager.js)) only ever shows signals that exist in the parsed hierarchy, so a stale dotted-path entry has no UI representation and can't be unchecked from the modal.
3. **Default** — empty selection produces `$dumpvars(1, <tb>)`, which dumps every signal at the testbench-module scope. The .gtkw mirrors this: every top-scope signal in the VCD ends up as a trace.

**Three validation gates, all reading the same VCD-as-truth principle:**

- `validateSelection` ([selection_validator.js](js/wave/selection_validator.js)) — runs against the regex-parsed hierarchy. Stale entries (renamed signal, removed instance) are auto-pruned out of `projectConfig.waveSignals` and a `Note: ... ignored (not added to $dumpvars)` is logged in `twave`. Fires both at WC modal open and at compile time, so the cleanup happens regardless of which path the user takes.
- **VCD-vs-selection cross-check em `_waveResolveGtkwSaveFile`** ([compilation_module.js](js/compilation/compilation_module.js)) — depois do vvp produzir o VCD, Aurora compara cada item de `_validatedWaveSelection` contra os scope paths parseados do VCD. Sinais ausentes geram um aviso `Note: ... not in the generated VCD and were omitted from the .gtkw layout.` em `twave`. Cobre o gap "selection era valida contra sources mas o `$dumpvars` rodante dumpou menos sinais que o esperado". Last-line-of-defense antes do GTKWave abrir.
- `instrumentTestbenchSource.reason` — the user-defined override. The compile-flow caller ([compilation_module.js](js/compilation/compilation_module.js)) reads this and zeroes the cached selection, which is what makes the .gtkw fall back to default top-scope when the user has hand-written `$dumpvars`.

**Why the cache `_validatedWaveSelection`:** a validacao roda durante `iverilogCompile({buildVvp: true})`. A .gtkw e escrita depois, em `runGtkWave` apos vvp produzir o VCD. Os dois passos precisam da mesma selecao pruned-e-talvez-zerada, entao o passo de compile escreve em `this._validatedWaveSelection` pro passo de .gtkw ler. Sem o cache, ou voce re-roda (regex parse + projectOriented.json write) ou re-avisa o usuario sobre sinais ja pruned.

**What you can't change without thinking:**

- **Don't add a fourth source of "what to dump."** Se usuarios querem um layout curated, importam um `.gtkw` custom via toolbar dropdown (`gtkwPickerSelect`, gerenciado por `gtkw_picker.js`) — esse e o escape hatch existente e o wave-flow ja detecta (Source 1 do `_waveResolveGtkwSaveFile`). Adicionar uma quinta path significa mais uma decisao de prioridade e mais uma classe de silent-mismatch.
- **Don't bypass `_validateWaveSelection` to inject `$dumpvars` directly.** If the path you write isn't in the parsed hierarchy, iverilog fails with `port "X" is not a port of dut` or similar — exactly the bug we hit when we shipped the picker without validation. Always go through the validator.
- **The `reason: 'user-defined'` override is one-directional.** When the user has manual `$dumpvars`, the picker selection is ignored, but we don't proactively clear `waveSignals` from disk — the user might remove their `$dumpvars` later and want the picker back. Only `validateSelection` writes to `waveSignals`; `'user-defined'` just suppresses use of it.
- **Don't inline phase logic back into the orchestrator.** The 8-phase structure exists so future "GTKWave doesn't open right" bug reports can be triaged to one phase at a time. Inlining trades that property for a few lines of locality and we lose more than we gain.
- **Don't merge phases unless they share a real invariant.** "These two phases both touch tempBaseDir" is not a real invariant — most phases touch tempBaseDir. Real reasons to merge: shared in-flight state that doesn't belong on `this`, or a contract that only makes sense as a unit (e.g., "build vvp + run vvp" is two phases because building can fail without running, and the in-between has no meaningful state to pass).
- **Phase JSDoc is the contract.** When you change behaviour, update the input/return/throws/side-effects block first, then the implementation. If the JSDoc doesn't change, the behaviour shouldn't have changed either — that's the audit trail.

---

## 10. Refactoring checklist

Before merging any change to this layer, walk through:

- [ ] Did you add or remove a `window.*` global? If yes, update §2.
- [ ] Did you change script load order in [index.html](index.html)? If yes, sanity-check §1.
- [ ] Did you add a writer to a single-writer resource (§3)? Don't.
- [ ] Did you add a `getCurrentMode()` reader? Hoje e modo unico (`'project'`) — se voce volta a precisar de modos, leia de `window.appInitializer.getCurrentMode()`, nao redirive do DOM (ver §8).
- [ ] Did you cache project path on `this.*`? Don't — read from the owner.
- [ ] Did you call `EditorManager.createEditorInstance` outside `TabManager.addTab`? See §4.
- [ ] Did you re-introduzir modos diferentes? Smoke-test open-close-reopen-edit manualmente — historicamente quebra Monaco em sessoes restauradas (ver §8).
- [ ] Did you add a `DOMContentLoaded` listener? Verify it doesn't depend on later listeners having run.
- [ ] Did you add a path that decides what gets `$dumpvars`'d or what goes into the .gtkw? Re-read §9 — if the path bypasses `validateSelection` or `pickSignalsToEmit`, you're recreating a class of bug we've already fixed.

Smoke test (manual, ~2 min):
1. Open Aurora. Last project should auto-load.
2. Click a `.v` file in the tree. Editor should open. Type — text should insert at cursor.
3. Close project, reopen via Recent. Editor + edit should still work.
4. Toggle simulation on/off. Trees should swap cleanly. Edit should still work.
5. Sem mais switch Processor ↔ Project — modo unico hoje.

Smoke test (automated, runs in CI):
- [tests/e2e/smoke.test.js](tests/e2e/smoke.test.js) launches a real Aurora via Playwright's Electron API and asserts Monaco initializes without the failure markers we've hit (notably "EditorManager has not been initialized" and the Monaco 0.53 contribution-module crash). Run locally with `npm run test:e2e`.
