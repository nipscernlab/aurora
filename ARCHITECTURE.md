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

- [`file_mode.js`](js/project/file_mode.js) registers `DOMContentLoaded` listeners in its constructor and must load **before** [`app_initializer.js`](js/app/app_initializer.js). The latter dispatches `mode-state-changed` (see §6) which the former listens for.
- [`monaco_editor.js`](js/editor/monaco_editor.js) must be initialized before any `TabManager.addTab` runs against a text file. The `EditorManager.ready` promise (see §8) gates this.

If you reorder these, things break in ways that don't always show up in dev.

---

## 2. State has one owner per concept

Drift between multiple "sources of truth" was responsible for several bugs in 2026. The current design assigns each piece of cross-cutting state to exactly one owner:

| Concept | Owner | How others read |
|---|---|---|
| Current project (path + spf) | [`ProjectStore`](js/project/project_store.js) | `ProjectStore.getProjectPath()` / `getSpfPath()`, mirrored to `window.currentProjectPath` / `window.currentSpfPath` for legacy reads |
| Current IDE mode (`processor` / `project` / `verilog`) | `AppInitializer.currentMode` ([app_initializer.js](js/app/app_initializer.js)) | `window.appInitializer.getCurrentMode()` — every other `getCurrentMode()` delegates here. `compilation_flow.getCurrentMode()` is the **only** exception: it answers a different question (returns `'project-verilog-only'` etc. for compilation routing) |
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
| `appInitializer.currentMode` | `AppInitializer.switchToMode` only | Anyone setting it directly bypasses the persisted-mode `localStorage` write, the radio sync, and the `mode-state-changed` dispatch. |

**`projectOriented.json` writes go through [ProjectConfigStore](js/project/project_config_store.js).** Two managers update it (`VerilogModeManager` for the picker, `ProjectOrientedManager` for the modal); both call `ProjectConfigStore.update(projectPath, mutator)` which serializes per-path read-mutate-write. Each mutator only touches the fields its manager owns; defaults for everything else come from `ProjectConfigStore.DEFAULTS`, so unknown fields a future writer might add survive the round trip. **If you're adding a third writer, use `update()` — don't write the file directly.**

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

Two IDE modes today: **Processor** (legacy single-processor PRISM workflow) and **Project** (everything else — synth/sim of `.v` files, with or without configured processors). The old "Verilog Mode" was a third mode driven by a Compile & Simulate checkbox; it merged into Project Mode in May 2026 and the pipeline now auto-decides full-simulation vs verilog-only by checking `projectConfig.processors`.

Roughly, on app start:

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
    ├── setupModeSwitchers()            // attach radio change listeners
    └── await restoreLastSession()
        ├── await projectManager.loadProject(lastSpf)
        │   ├── ProjectStore.setProject(spf, base)
        │   ├── if mode==='project': activateVerilogMode()
        │   │   else (processor): fileTreeManager.updateFileTree(files)
        │   └── ...
        └── await switchToMode(lastMode)         // 'verilog' migrates to 'project'
            ├── this.currentMode = mode
            ├── activateModeUI(mode)    // sets radios programmatically
            ├── dispatch('mode-state-changed')   // see §6
            ├── if mode==='project': switchToVerilogFileMode → activateVerilogMode (coalesced, see §7)
            └── ...
```

**Gotchas:**

- `activateModeUI` writes `radio.checked` programmatically. **Programmatic `.checked = ...` does NOT fire a `change` event.** That's why `mode-state-changed` was added (see §6).
- `initializeTreeBasedOnMode` runs after a `setTimeout(100ms)` in `fileTreeManager.initialize`. By that time `restoreLastSession` may or may not have called `activateModeUI` yet. The mode it reads is racy. Don't depend on this firing in any specific order relative to `switchToMode`.
- Monaco's AMD modules load asynchronously. A `TabManager.addTab` call before `EditorManager.ready` resolves will block on the IIFE's `await` — the tab DOM is created immediately, the editor isn't.

---

## 6. The `mode-state-changed` event

`AppInitializer.activateModeUI` sets `projectModeRadio.checked` programmatically. Programmatic `.checked` writes don't fire `change` events, so listeners that derive state from the toolbar (e.g. `file_mode.js`'s `syncFromState`) miss session-restore transitions.

**Fix:** [`activateModeUI`](js/app/app_initializer.js) dispatches `document.dispatchEvent(new CustomEvent('mode-state-changed', { detail: { mode } }))` after every programmatic flip.

**Listeners:**
- [`file_mode.js`](js/project/file_mode.js) — calls `syncFromState`, which (de)activates the verilog picker.

**If you add a new listener:** the event fires once per `switchToMode` call. Coalesce if your handler is expensive.

---

## 7. `activateVerilogMode` is coalesced

[`file_mode.js`](js/project/file_mode.js) wraps `activateVerilogMode` in a `_activatePromise` that returns the same in-flight promise to concurrent callers. Two paths can call it in the same tick during session-restore:

1. `mode-state-changed` → `syncFromState` → `activateVerilogMode`
2. `app_initializer.switchToVerilogFileMode` → `activateVerilogMode`

Without coalescing, both ran `loadConfiguration` in parallel — each did `verilogFiles = []` then awaited disk I/O — so call B's reset wiped call A's pushes mid-iteration, leaving duplicate rows.

**The promise is also gated on `this.initPromise`** (DOM-element caching) so an early programmatic activation can't land before `cacheElements()` runs.

**Don't call `activateVerilogMode` from inside it** (recursion), and don't bypass the wrapper to call `loadConfiguration` directly.

---

## 8. `EditorManager.ready`

[`monaco_editor.js`](js/editor/monaco_editor.js) exposes `EditorManager.ready` — a promise resolved (in `finally`) after `initMonaco()` and `EditorManager.initialize()` complete or throw.

`TabManager.addTab` awaits this before calling `createEditorInstance`. Without it, a fast user click during the brief AMD-load window produces "EditorManager has not been initialized" because `editorContainer` is still `null`.

**The promise resolves even on init failure** (the `finally` runs unconditionally). `createEditorInstance` defends against this with a lazy fallback (re-fetches `#monaco-editor` from DOM) and a `window.monaco` check. If both fail it logs and returns `undefined` — `addTab` then closes the tab.

---

## 9. Known fragilities (don't refactor without thinking)

These are areas where we have evidence things break in non-obvious ways. Touch with care.

- **monaco-editor must be exactly 0.52.2.** 0.53.0 throws inside its own `css/monaco.contribution.js` during init, which blocks `EditorManager.initialize()` and leaves the editor half-broken — cursor renders, typing is dead. Symptom is intermittent (depends on which contribution module fails first) and dodges casual testing. The version is pinned exactly in [package.json](package.json) (no caret) and verified by [scripts/check-pinned-versions.js](scripts/check-pinned-versions.js), which runs on `npm start` (`prestart`) and in CI after `npm ci`. **Don't relax the pin** until upstream Monaco actually fixes 0.53+.

  The same script auto-watches any other dependency you pin exactly. To opt a package into strict checking, drop its caret/tilde in package.json — no other plumbing needed.

- **`getCurrentMode` callers' tolerance for `null`.** Pre-`b046e5a`, `appInitializer.getCurrentMode()` returned `null` until `switchToMode` ran. Most callers compared against literal mode strings, so `null` silently meant "treat as not-this-mode". A 2026-05 attempt (`b046e5a`, reverted in `ecb3591`) made it derive from DOM instead — reproducibly broke Monaco editing in restored sessions. The interaction was not pinned down. **If you change what `getCurrentMode` returns at startup, run the full open-close-reopen-edit smoke test manually** until we have an integration test that catches this class of regression.
- **Two trees sharing `#file-tree`.** Standard tree (`refreshFileTree`) and verilog tree (`renderVerilogTree`) both `innerHTML = ''` and re-render the same DOM container. `refreshFileTree` defends with `if (fileTree.classList.contains('verilog-mode-active')) return` ([file_tree_manager.js:112](js/tree/file_tree_manager.js#L112)). Don't add a third writer without the same guard.
- **Manager constructors do I/O.** `VerilogModeManager`, `ProjectOrientedManager`, etc. call `this.init()` from their constructors, which awaits `DOMContentLoaded`, caches DOM elements, attaches listeners, possibly hits IPC. The script load order (§1) is the implicit init order. **Moving these calls is exactly the class of change that breaks startup in subtle ways.**

---

## 10. Wave flow — VCD is the ground truth

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
- `pickSignalsToEmit` ([gtkw_writer.js](js/wave/gtkw_writer.js)) — runs against the VCD's parsed scopes. Anything in the selection that vvp didn't actually dump is reported back as `dropped`; the .gtkw still writes for the rest, and the warning surfaces in `twave`. This is the second-to-last line of defense before GTKWave opens.
- `instrumentTestbenchSource.reason` — the user-defined override. The compile-flow caller ([compilation_module.js](js/compilation/compilation_module.js)) reads this and zeroes the cached selection, which is what makes the .gtkw fall back to default top-scope when the user has hand-written `$dumpvars`.

**Why the cache `_validatedWaveSelection`:** the validation runs during `iverilogVerilogOnlyCompilation({buildVvp: true})`. The .gtkw is written later, in `runVerilogOnlyGtkWave` after vvp produces the VCD. Both steps need the same pruned-and-possibly-zeroed selection, so the compile step writes it onto `this._validatedWaveSelection` for the .gtkw step to read. Without the cache, you either re-run the (regex parse + projectOriented.json write) or you re-warn the user about signals you already pruned.

**What you can't change without thinking:**

- **Don't add a fourth source of "what to dump."** If users want a curated layout, they import a custom `.gtkw` via Project Settings — that's the existing escape hatch and the wave-flow code already detects it (`_waveResolveGtkwSaveFile`'s Source 1 branch). Adding a fifth path means another priority decision and another silent-mismatch class.
- **Don't bypass `_validateWaveSelection` to inject `$dumpvars` directly.** If the path you write isn't in the parsed hierarchy, iverilog fails with `port "X" is not a port of dut` or similar — exactly the bug we hit when we shipped the picker without validation. Always go through the validator.
- **The `reason: 'user-defined'` override is one-directional.** When the user has manual `$dumpvars`, the picker selection is ignored, but we don't proactively clear `waveSignals` from disk — the user might remove their `$dumpvars` later and want the picker back. Only `validateSelection` writes to `waveSignals`; `'user-defined'` just suppresses use of it.
- **Don't inline phase logic back into the orchestrator.** The 8-phase structure exists so future "GTKWave doesn't open right" bug reports can be triaged to one phase at a time. Inlining trades that property for a few lines of locality and we lose more than we gain.
- **Don't merge phases unless they share a real invariant.** "These two phases both touch tempBaseDir" is not a real invariant — most phases touch tempBaseDir. Real reasons to merge: shared in-flight state that doesn't belong on `this`, or a contract that only makes sense as a unit (e.g., "build vvp + run vvp" is two phases because building can fail without running, and the in-between has no meaningful state to pass).
- **Phase JSDoc is the contract.** When you change behaviour, update the input/return/throws/side-effects block first, then the implementation. If the JSDoc doesn't change, the behaviour shouldn't have changed either — that's the audit trail.

---

## 11. Refactoring checklist

Before merging any change to this layer, walk through:

- [ ] Did you add or remove a `window.*` global? If yes, update §2.
- [ ] Did you change script load order in [index.html](index.html)? If yes, sanity-check §1.
- [ ] Did you add a writer to a single-writer resource (§3)? Don't.
- [ ] Did you add a `getCurrentMode()` reader? It should delegate to `window.appInitializer.getCurrentMode()`, not re-derive from DOM.
- [ ] Did you cache project path or mode on `this.*`? Don't — read from the owner.
- [ ] Did you call `EditorManager.createEditorInstance` outside `TabManager.addTab`? See §4.
- [ ] Did you change what `getCurrentMode` returns at startup or how soon? Smoke-test open-close-reopen-edit manually.
- [ ] Did you add a `DOMContentLoaded` listener? Verify it doesn't depend on later listeners having run.
- [ ] Did you add a path that decides what gets `$dumpvars`'d or what goes into the .gtkw? Re-read §10 — if the path bypasses `validateSelection` or `pickSignalsToEmit`, you're recreating a class of bug we've already fixed.

Smoke test (manual, ~2 min):
1. Open Aurora. Last project should auto-load in saved mode.
2. Click a `.v` file in the tree. Editor should open. Type — text should insert at cursor.
3. Close project, reopen via Recent. Editor + edit should still work.
4. Toggle simulation on/off. Trees should swap cleanly. Edit should still work.
5. Switch Processor ↔ Project mode. No console errors.

Smoke test (automated, runs in CI):
- [tests/e2e/smoke.test.js](tests/e2e/smoke.test.js) launches a real Aurora via Playwright's Electron API and asserts Monaco initializes without the failure markers we've hit (notably "EditorManager has not been initialized" and the Monaco 0.53 contribution-module crash). Run locally with `npm run test:e2e`.
