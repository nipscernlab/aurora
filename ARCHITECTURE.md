# Renderer architecture — load-bearing invariants

This is **not** a project overview or onboarding doc. Read [README.md](README.md) for that.

This file lists the implicit contracts the renderer process depends on but doesn't enforce. Every entry here was learned by something breaking in subtle ways. **Read this before refactoring anything in [js/app/](js/app/), [js/project/](js/project/), [js/tree/](js/tree/), [js/editor/](js/editor/), or [js/tabs/](js/tabs/).**

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

**Not yet single-writer (known TODO):**

- [`projectOriented.json`](https://github.com/nipscernlab/aurora) is written by both `VerilogModeManager.saveConfiguration` ([file_mode.js](js/project/file_mode.js)) and `ProjectOrientedManager.saveConfiguration` ([project_oriented.js](js/project/project_oriented.js)). Each does `read → mutate → write` independently with overlapping fields (`synthesizableFiles`, `testbenchFiles`, `topLevelFile`). Last writer wins. **If you're adding a third writer, stop and consolidate first.**

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
    ├── setupSimulationToggle()         // RESTORE saved sim toggle (no event)
    └── await restoreLastSession()
        ├── await projectManager.loadProject(lastSpf)
        │   ├── ProjectStore.setProject(spf, base)
        │   ├── if mode==='verilog': activateVerilogMode()
        │   │   else: fileTreeManager.updateFileTree(files)
        │   └── ...
        └── await switchToMode(lastMode)
            ├── this.currentMode = mode
            ├── activateModeUI(mode)    // sets radios programmatically
            ├── dispatch('mode-state-changed')   // see §6
            ├── if mode==='verilog': switchToVerilogFileMode → activateVerilogMode (coalesced, see §7)
            └── ...
```

**Gotchas:**

- `setupSimulationToggle` writes `simToggle.checked` programmatically. **Programmatic `.checked = ...` does NOT fire a `change` event.** That's why `mode-state-changed` was added (see §6).
- `initializeTreeBasedOnMode` runs after a `setTimeout(100ms)` in `fileTreeManager.initialize`. By that time `restoreLastSession` may or may not have called `activateModeUI` yet. The mode it reads is racy. Don't depend on this firing in any specific order relative to `switchToMode`.
- Monaco's AMD modules load asynchronously. A `TabManager.addTab` call before `EditorManager.ready` resolves will block on the IIFE's `await` — the tab DOM is created immediately, the editor isn't.

---

## 6. The `mode-state-changed` event

`AppInitializer.activateModeUI` sets `projectModeRadio.checked` / `simToggle.checked` programmatically. Programmatic `.checked` writes don't fire `change` events, so listeners that derive state from the toolbar (e.g. `file_mode.js`'s `syncFromState`) miss session-restore transitions.

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

- **monaco-editor must be exactly 0.52.2.** 0.53.0 throws inside its own `css/monaco.contribution.js` during init, which blocks `EditorManager.initialize()` and leaves the editor half-broken — cursor renders, typing is dead. Symptom is intermittent (depends on which contribution module fails first) and dodges casual testing. The version is pinned exactly in [package.json](package.json) (no caret) and verified by [scripts/check-monaco-version.js](scripts/check-monaco-version.js), which runs on `npm start` (`prestart`) and in CI after `npm ci`. **Don't relax the pin** until upstream Monaco actually fixes 0.53+.

- **`getCurrentMode` callers' tolerance for `null`.** Pre-`b046e5a`, `appInitializer.getCurrentMode()` returned `null` until `switchToMode` ran. Most callers compared against literal mode strings, so `null` silently meant "treat as not-this-mode". A 2026-05 attempt (`b046e5a`, reverted in `ecb3591`) made it derive from DOM instead — reproducibly broke Monaco editing in restored sessions. The interaction was not pinned down. **If you change what `getCurrentMode` returns at startup, run the full open-close-reopen-edit smoke test manually** until we have an integration test that catches this class of regression.
- **Two trees sharing `#file-tree`.** Standard tree (`refreshFileTree`) and verilog tree (`renderVerilogTree`) both `innerHTML = ''` and re-render the same DOM container. `refreshFileTree` defends with `if (fileTree.classList.contains('verilog-mode-active')) return` ([file_tree_manager.js:112](js/tree/file_tree_manager.js#L112)). Don't add a third writer without the same guard.
- **Manager constructors do I/O.** `VerilogModeManager`, `ProjectOrientedManager`, etc. call `this.init()` from their constructors, which awaits `DOMContentLoaded`, caches DOM elements, attaches listeners, possibly hits IPC. The script load order (§1) is the implicit init order. **Moving these calls is exactly the class of change that breaks startup in subtle ways.**

---

## 10. Refactoring checklist

Before merging any change to this layer, walk through:

- [ ] Did you add or remove a `window.*` global? If yes, update §2.
- [ ] Did you change script load order in [index.html](index.html)? If yes, sanity-check §1.
- [ ] Did you add a writer to a single-writer resource (§3)? Don't.
- [ ] Did you add a `getCurrentMode()` reader? It should delegate to `window.appInitializer.getCurrentMode()`, not re-derive from DOM.
- [ ] Did you cache project path or mode on `this.*`? Don't — read from the owner.
- [ ] Did you call `EditorManager.createEditorInstance` outside `TabManager.addTab`? See §4.
- [ ] Did you change what `getCurrentMode` returns at startup or how soon? Smoke-test open-close-reopen-edit manually.
- [ ] Did you add a `DOMContentLoaded` listener? Verify it doesn't depend on later listeners having run.

Smoke test (manual, ~2 min):
1. Open Aurora. Last project should auto-load in saved mode.
2. Click a `.v` file in the tree. Editor should open. Type — text should insert at cursor.
3. Close project, reopen via Recent. Editor + edit should still work.
4. Toggle simulation on/off. Trees should swap cleanly. Edit should still work.
5. Switch Processor ↔ Project mode. No console errors.
