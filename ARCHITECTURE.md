# Renderer architecture — load-bearing invariants

This is **not** a project overview or onboarding doc. Read [README.md](README.md) for that.

This file lists the implicit contracts the renderer process depends on but doesn't enforce. Every entry here was learned by something breaking in subtle ways. **Read this before refactoring anything in [js/app/](js/app/), [js/project/](js/project/), [js/tree/](js/tree/), [js/editor/](js/editor/), [js/tabs/](js/tabs/), [js/wave/](js/wave/), or the wave-flow paths in [js/compilation/](js/compilation/).**

Maintenance rules (the doc is only useful while it's trustworthy):

1. **When you change something covered here, update this doc in the same commit.**
2. **Reference symbols, not line numbers.** `tab_manager.js`, função `addTab` — never `tab_manager.js:565`. Line anchors rot silently; symbol names fail loudly (grep finds nothing).
3. **Link the `.ts` source for migrated modules**, not the compiled `.js` sitting next to it (tsconfig compiles in-place). The `.ts` is what you edit.
4. **In-source JSDoc is the authoritative contract** for any function mentioned here. This doc is the bird's-eye map; if it disagrees with the JSDoc, the JSDoc wins and this doc has a bug — fix it.

Last full audit against the code: 2026-06-13. §11–§12 added 2026-08-06 (identity fields and
the cocotb verdict contract) — see [docs/ESTUDO_COMPLETO_AURORA.md](docs/ESTUDO_COMPLETO_AURORA.md) §19.

---

## 1. Script load order — now almost entirely import-driven

**History (2026-06):** [index.html](index.html) used to load ~10 classic `<script>` tags (no `type="module"`) that shared state through `window.*` globals, and their tag order *was* a contract — reordering produced silent `undefined` reads. Those scripts were converted to ES modules one by one (commits from `zoom.js`/`shortcut_manager.js` through `status_updater.js`), each one replacing its `window.*` global with a real `import`. The classic-script block no longer exists.

What remains:

1. **The Monaco AMD loader is the one ordering constraint that is still load-bearing.** The `node_modules/monaco-editor/min/vs/loader.js` tag (plus its inline `require.config`) is the only non-module script left, and it must precede every `type="module"` tag: it installs a global `require()` that [`monaco_editor.js`](js/editor/monaco_editor.js) calls at import time. Without it, `initMonaco()` rejects. Keep it first; never give it `type="module"`.

2. **Module imports resolve their own order.** For anything reached through an `import` statement, tag order is irrelevant — the graph is resolved by the bundler/spec. Most cross-file dependencies are now this kind.

**Residual tag-order dependencies (the only ones left — both narrow):**

- **`DOMContentLoaded` listeners fire in registration order, which for sibling module tags is tag order.** [`file_mode.js`](js/project/file_mode.js) and [`app_initializer.js`](js/app/app_initializer.js) both register a `DOMContentLoaded` handler at module-eval time; `file_mode` must stay **before** `app_initializer` so its handler runs first (both touch `activateTree` on the same tick — coalesced via §6). This is not import-expressible, so the tag order still matters here.
- **A few modules still publish to `window.*` at eval time** — `window.appInitializer` ([app_initializer.js](js/app/app_initializer.js)), `window.projectTreeManager` ([file_mode.js](js/project/file_mode.js)), `window.SharedModelRegistry` ([shared_models.js](js/editor/shared_models.js)) — for consumers that still read them by name rather than importing. As long as those reads happen at runtime (inside handlers), tag order is moot; if you add a *module-eval-time* read of one of these globals, you reintroduce a tag-order contract. Prefer converting the consumer to an `import` instead.

- [`monaco_editor.js`](js/editor/monaco_editor.js) must be initialized before any `TabManager.addTab` runs against a text file — but that's gated by the `EditorManager.ready` promise (see §7), not by tag order.

The bottom line flipped: load order used to be a broad, fragile contract; it is now down to "Monaco loader first, `file_mode` before `app_initializer`." Converting the three remaining `window.*` publishers to imports would retire even the second clause.

---

## 2. State has one owner per concept

Drift between multiple "sources of truth" was responsible for several bugs in 2026. The current design assigns each piece of cross-cutting state to exactly one owner:

| Concept | Owner | How others read |
|---|---|---|
| Current project (path + spf) | [`ProjectStore`](js/project/project_store.js) | `ProjectStore.getProjectPath()` / `getSpfPath()`, mirrored to `window.currentProjectPath` / `window.currentSpfPath` for legacy reads |
| Open tabs (filePath → content) | `TabManager.tabs` Map ([tab_manager.js](js/tabs/tab_manager.js)) | `TabManager.tabs.get(filePath)` |
| Monaco editor instances (filePath → `{editor, container}`) | `EditorManager.editors` Map ([monaco_editor.js](js/editor/monaco_editor.js)) | `EditorManager.getEditorForFile(filePath)` |
| Shared text models (filePath → `{model, refCount, savedAltVersionId}`) | `SharedModelRegistry` ([shared_models.js](js/editor/shared_models.js)) | `SharedModelRegistry.getModel(filePath)` |
| Verilog tree state (`isTreeActive`, `verilogFiles`) | `ProjectTreeManager` ([file_mode.js](js/project/file_mode.js)) | Don't read from outside; call its methods |
| Wave state per testbench (`gtkwFiles`, `waveSignals`, `wcCustomized`, `hadOriginalDumpvars`) | `WaveStore` ([wave_state_store.ts](js/wave/wave_state_store.ts)) | `WaveStore.read/get(projectPath, tbKey)` |

**Rule:** if you find yourself caching one of these on `this.*` somewhere, you're recreating the bug. Read from the owner.

**Resetting state:** owners must expose explicit `reset()` / `clearProject()` rather than letting external code mutate fields. [`close_project.js`](js/project/close_project.js) calls `ProjectStore.clearProject()` and `projectTreeManager.reset()` — that's the pattern.

---

## 3. Single-writer invariants

Some shared resources have a designated writer. Other call sites must not write to them, even when it would be convenient.

| Resource | Sole writer | Why |
|---|---|---|
| Monaco editor instances (creation) | The `await EditorManager.ready` IIFE inside `TabManager.addTab` ([tab_manager.js](js/tabs/tab_manager.js)) | An auto-create fallback in `setActiveEditor` racing this path produced two stacked editor divs sharing a model. User saw artefacts and "can't type". Removed in `e2c82f8`. |
| `window.currentProjectPath` / `window.currentSpfPath` | `ProjectStore.setProject` / `clearProject` | Multiple writers drift; the cache vs. live state mismatch caused the "file outside folder disappears on reopen" bug. Migrated in `e01e406`. |

**`.spf` writes from the renderer go through [SpfStore](js/project/spf_store.ts).** O escritor canonico do renderer e `ProjectTreeManager` (file tree picker — synthesizableFiles, testbenchFiles, topLevelFile, testbenchFile). Chama `SpfStore.update(spfPath, mutator)` que serializa read-mutate-write por path e preserva `metadata`. Cada mutator so toca os campos que seu manager possui; defaults pro resto vem de `SpfStore.STRUCTURE_DEFAULTS` — campos desconhecidos que um futuro escritor adicione sobrevivem ao round trip. **Se voce adicionar um segundo escritor renderer-side, use `update()` — nao escreva o arquivo direto.** O main process tambem escreve o `.spf` em events de lifecycle (open/create-processor/delete-processor); race teorica com o renderer e aceitavel porque os dois sao acionados por interacao UI sequencial. Pre-2026-05 o estado de tree/picker vivia em `projectOriented.json` separado — consolidado no `.spf` pra ter uma fonte unica de config per-project.

---

## 4. Editor creation must go through `addTab`

This is so important it gets its own section.

The contract: **only `TabManager.addTab` (text-file branch) calls `EditorManager.createEditorInstance`.** `setActiveEditor` switches between existing editors but does not create them.

The IIFE in `addTab` ([tab_manager.js](js/tabs/tab_manager.js)):

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

Aurora roda em modo unico hoje (**Project**). Historicamente existiram tres modos — Processor (PRISM single-processor), Project (com ou sem processadores), e Verilog (gated por um checkbox "Compile & Simulate"). Verilog merged em Project em maio/2026; Processor foi removido nas fases 1–2.5 (commits `b66bd6d` em diante). O pipeline auto-decide hoje sim-completa vs verilog-only via `window.availableProcessors` (semeado do `.spf`).

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
│   ├── fileTreeManager.initialize()    // chama initializeTreeBasedOnMode
│   ├── projectManager.initialize()     // wire Open Project buttons
│   └── ...
│
└── app_initializer.js DOMContentLoaded handler
    └── await restoreLastSession()
        └── await projectManager.loadProject(lastSpf)
            ├── ProjectStore.setProject(spf, base)
            ├── activateTree()   // sempre (modo unico)
            └── ...
```

**Gotchas:**

- `initializeTreeBasedOnMode` ([`file_tree_manager.js`](js/tree/file_tree_manager.js)) aguarda `projectTreeManager.initPromise` — o sinal real de readiness (DOM cacheado + listeners) — antes de chamar `activateTree`. Historicamente era um `setTimeout(100ms)` chutado, que em cold start lento rodava antes do DOM da tree existir e bailava silenciosamente. **Nao volte pro sleep.** A coalescencia interna (§6) garante que so um `loadConfiguration` roda mesmo se essa chamada e a do `loadProject` batem no mesmo tick.
- Monaco's AMD modules load asynchronously. A `TabManager.addTab` call before `EditorManager.ready` resolves will block on the IIFE's `await` — the tab DOM is created immediately, the editor isn't.

---

## 6. `refreshTree` is the single entry point

[`file_mode.js`](js/project/file_mode.js) expoe **um unico ponto** pra atualizar a tree: `refreshTree()`. Ele coalesce concurrent callers via `_refreshPromise` + pending-flag loop, roda setup idempotente (DOM cache wait, project path discovery, isTreeActive flag, view switch) e faz loadConfiguration + renderTree em loop ate o estado estabilizar.

`activateTree()` ainda existe como alias historico (call sites: `projectManager.loadProject`, `fileTreeManager.initializeTreeBasedOnMode`) — chama `refreshTree()` diretamente.

Pelo menos tres paths podem chamar refreshTree no mesmo tick durante session-restore:

1. `projectManager.loadProject` → `activateTree` → `refreshTree`
2. `fileTreeManager.initializeTreeBasedOnMode` (apos `projectTreeManager.initPromise`) → `activateTree` → `refreshTree`
3. fs watcher / `aurora:spf-changed` listener → `refreshTree`

Pre-consolidation tinha LOCKS SEPARADOS (`_activatePromise` vs `_refreshPromise`) — activateTree chamava `loadConfiguration` direto, e refreshTree tambem. Os dois rodavam em paralelo — cada um fazia `verilogFiles = []` e aguardava I/O — entao o reset da chamada B limpava os pushes da chamada A em pleno meio de iteracao, duplicando entries (especialmente os auto-discovered `.cmm`/`.asm`). Consolidando num lock so eliminou essa classe de race.

**A promise tambem e gated em `this.initPromise`** (cache de elementos DOM) pra que uma chamada programatica precoce nao caia antes do `cacheElements()` rodar.

**Nao chame `refreshTree` de dentro de si mesmo** (recursao), e nao contorne o wrapper chamando `loadConfiguration` direto — `loadConfiguration` so deve ser chamado de dentro do loop do refreshTree.

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
    - **The verilog renderer is a key-based reconciler** ([project_tree_render.js](js/project/project_tree_render.js) `RenderMixin.renderTree`, mixed into `ProjectTreeManager.prototype` from [file_mode.js](js/project/file_mode.js)) — diffs `verilogFiles` against existing `.verilog-file-item` rows by `data-file-path` and applies minimal DOM mutations. Multiple identical-data renders are zero-mutation no-ops. Don't replace this with destroy-and-rebuild.
    - **Adding a fourth view?** Add the name to `VIEW_NAMES` in tree_view.js, add the corresponding CSS rule in file_tree.css, write a renderer that targets `treeView.getContainer('<name>')`, and register it via `fileTreeViewController.registerRenderer(name, fn)`. Don't introduce a writer that touches `#file-tree` directly or attaches its own click listener to the toggle button.
    - **Don't go back to lock-based ownership or duplicate state.** Six previous attempts (commits `f196e2d`, `02f7e9c`, `b379dd4`, `c4c59ce`, `fb43adb`, `b6ec26a`, plus smaller patches) tried variations on shared-DOM-with-class-lock or per-instance hierarchyData fields synchronised by hand. Each closed the visible bug but left a new corner case open. The separate-subtree + single-controller design has no equivalent corner case — the properties are enforced by physics (separate DOMs) and by topology (one click listener, one data slot).
- **Manager constructors do I/O.** `ProjectTreeManager`, `GtkwPickerManager`, etc. chamam `this.init()` no construtor, que aguarda `DOMContentLoaded`, cacheia elementos do DOM, attacha listeners, possivelmente bate em IPC. A ordem de load de scripts (§1) e a ordem implicita de init. **Mover essas chamadas e exatamente a classe de mudanca que quebra startup de forma sutil.**

---

## 9. Wave flow — o dump da simulação é a verdade

Princípio único: **qualquer coisa que pedirmos pro GTKWave exibir tem que existir no dump (`.fst`/`.vcd`) que a simulação de fato produziu.** O usuário pode pedir sinais por mais de um caminho, mas o dump vence.

O orquestrador do botão Wave é `runGtkWave` em [compilation_module.js](js/compilation/compilation_module.js). Valida via `validateForWave` (testbench obrigatório; synth e top-level opcionais — um tb standalone pode definir o DUT inline) e então roda fases privadas `_wave*`, cada uma com contrato próprio em JSDoc. O orquestrador é intencionalmente curto — documenta só a *ordem* das fases. **Mudança de comportamento pertence a uma fase.** Se você se pegar tocando duas fases pra uma feature, achou uma abstração faltando; exponha antes de mergear.

O fluxo tem dois eixos de branch — linguagem do testbench (Verilog vs Python/cocotb) e simulador (Icarus default vs Verilator, opt-in via Wave Config, flag `aurora.waveSimulator` no localStorage). Os quatro caminhos convergem em `_waveResolveVcdFile`:

```
runGtkWave
├── validateForWave(config)
├── _waveResolveToolchain          → paths absolutos (vvp, gtkwave, fst2vcd, Temp/...)
├── _waveDeriveSimTopModule        → nome do module top da simulacao
├── SIMULACAO (1 dos 4 caminhos):
│   ├── tb Verilog + Icarus:    _waveBuildAndVerifyVvp → _waveRunVvpSimulation
│   ├── tb Verilog + Verilator: _waveResolveVerilatorTools → _waveBuildVerilator
│   │                           → _waveRunVerilatorSimulation
│   └── tb Python (cocotb):     _waveValidateCocotbConfig → _waveRunCocotbSimulation
│                               (roda no simulador escolhido — Icarus ou Verilator)
├── _waveResolveVcdFile            → acha o ${simTop}.fst (ou .vcd) produzido;
│                                    1 candidato com outro nome? adota com warning;
│                                    0 ou varios? throw com instrucao concreta
├── _extractFstHeaderVcd           → header unico pros 4 caminhos (fst2vcd magic-detect;
│                                    VCD texto puro e seu proprio header)
├── _waveResolveGtkwSaveFile       → .gtkw do usuario, auto-gerado, ou null
└── _waveLaunchGtkwave             → exec gtkwave.exe, monitora PID
```

**Fontes de "o que dumpar", em ordem de precedência** — decidido por `_resolveWaveSelection` (JSDoc dele é a autoridade); estado per-testbench vive no `WaveStore` ([wave_state_store.ts](js/wave/wave_state_store.ts)):

1. **`.gtkw` ativo** (`state.gtkwFiles[].isActive`, marcado pelo dropdown custom do gtkw picker — elementos `gtkwPicker`/`gtkwPickerButton`/`gtkwPickerMenu`, gerenciados por [gtkw_picker.js](js/wave/gtkw_picker.js)). Aurora extrai os signal refs com `extractSignalRefs` ([gtkw_writer.ts](js/wave/gtkw_writer.ts)), valida contra a hierarquia parseada e usa esse conjunto. Refs que sumiram do source geram warning em `twave` + toast — o build segue sem eles.
2. **Wave Configuration customizada** (`state.wcCustomized`) — `state.waveSignals` dita o `$dumpvars`, **inclusive sobrescrevendo um `$dumpvars` hand-written do usuário**. O WC é a fonte canônica quando customizado.
3. **`$dumpvars` hand-written no testbench** (snapshot `hadOriginalDumpvars` tirado na 1ª visita ao tb) — nada é injetado; o testbench domina o que vai pro dump. Nesse caso o compile flow zera `_validatedWaveSelection` (reason `'user-defined'` de `instrumentTestbenchSource`), e o `.gtkw` auto-gerado cai pro default top-scope.
4. **Default** — `$dumpvars(1, <tbModule>)`: todos os sinais no scope do testbench, sem descer no DUT.

**Gates de validação, todos lendo o mesmo princípio dump-é-a-verdade:**

- `validateSelection` ([selection_validator.ts](js/wave/selection_validator.ts)) — roda contra a hierarquia regex-parseada ([signal_parser.ts](js/wave/signal_parser.ts)) tanto pros refs de `.gtkw` ativo quanto pra seleção do WC. Entradas stale (sinal renomeado, instância removida) são pruned com `Note: ... ignored` em `twave`. Dispara na abertura do modal WC e em compile time.
- **Cross-check dump-vs-seleção em `_waveResolveGtkwSaveFile`** — depois da simulação produzir o dump, Aurora valida o `.gtkw` do usuário contra ele (`_waveValidateUserGtkwAgainstVcd`) ou filtra o auto-gerado por `_validatedWaveSelection`. Sinais ausentes geram `Note: ... omitted` em `twave`. Last-line-of-defense antes do GTKWave abrir; nunca lança (hiccups viram warnings).
- `instrumentTestbenchSource` ([testbench_instrumenter.ts](js/wave/testbench_instrumenter.ts)) — lógica pura (unit-tested) de decidir injetar/comentar `$dumpfile`/`$dumpvars`; o método `instrumentTestbench` em compilation_module.js é a cola de I/O que escreve a cópia instrumentada em Temp/.

**Resolução do `.gtkw` save-file** (`_waveResolveGtkwSaveFile`), duas sources em prioridade: (1) `.gtkw` user-curated ativo, validado contra o dump e retornado intocado; (2) auto-gerado por `buildAuroraGtkw` ([gtkw_proc_writer.ts](js/wave/gtkw_proc_writer.ts)) — seção "Top-level" + uma seção SAPHO completa (cores/aliases/grupos) por processador detectado, filtrado pela seleção validada. Ambas falharam? `null`, e o GTKWave abre sem save-file.

**Contraparte Surfer** (`_waveResolveSurferSaveFile`, viewer opt-in) — espelha a mesma curadoria SAPHO num state-file declarativo `.surf.ron` via `buildSurferLayout` ([surfer_layout_writer.ts](js/wave/surfer_layout_writer.ts)): mesmos `detectProcessors`/cores/aliases/analógico, mas cada processador é um **`Group` colapsável** (não `divider`), os tracks Assembly/C+- decodificam via **mapping translators** (`convertTradToSurferMapping` a partir dos `trad_opcode.txt`/`trad_cmm.txt`), e números complexos via **pre-pass** `comp2gtkw.exe` (`complex_decode.ts` + IPC `decode-complex`). Mappings escritos em `%APPDATA%\surfer-project\surfer\config\mappings\`. Detalhes/decisões em [docs/surfer-feasibility.md](docs/surfer-feasibility.md) §13.

**Why the cache `_validatedWaveSelection`:** a seleção é decidida durante o build (fase de instrumentação). A `.gtkw` é escrita depois, quando a simulação já produziu o dump. Os dois passos precisam da mesma seleção pruned-e-talvez-zerada, então o build escreve em `this._validatedWaveSelection` pro passo de `.gtkw` ler. Sem o cache, ou você re-roda o parse, ou re-avisa o usuário sobre sinais já pruned.

**What you can't change without thinking:**

- **Don't add a fifth source of "what to dump."** As quatro acima já formam uma cadeia de precedência com regras de override documentadas no JSDoc de `_resolveWaveSelection`. Cada source nova significa mais uma decisão de prioridade e mais uma classe de silent-mismatch.
- **Don't bypass `validateSelection` to inject `$dumpvars` directly.** If the path you write isn't in the parsed hierarchy, iverilog fails with `port "X" is not a port of dut` or similar — exactly the bug we hit when we shipped the picker without validation. Always go through `_resolveWaveSelection`.
- **A precedência WC-sobre-testbench é intencional e one-directional.** WC customizado sobrescreve `$dumpvars` manual (source 2 > 3), mas um tb com `$dumpvars` manual e WC *não* customizado fica intocado, e nunca limpamos `waveSignals`/`wcCustomized` do disco proativamente — o usuário pode reverter a customização e querer o comportamento antigo de volta.
- **Don't inline phase logic back into the orchestrator.** A estrutura por fases existe pra que futuros bug reports "GTKWave não abre direito" sejam triados uma fase por vez. Inlining troca essa propriedade por umas linhas de localidade e perde mais do que ganha.
- **Don't merge phases unless they share a real invariant.** "These two phases both touch tempBaseDir" is not a real invariant — most phases touch tempBaseDir. Real reasons to merge: shared in-flight state that doesn't belong on `this`, or a contract that only makes sense as a unit.
- **Phase JSDoc is the contract.** When you change behaviour, update the input/return/throws/side-effects block first, then the implementation. If the JSDoc doesn't change, the behaviour shouldn't have changed either — that's the audit trail.

---

## 10. Refactoring checklist

Before merging any change to this layer, walk through:

- [ ] Did you add or remove a `window.*` global? If yes, update §2.
- [ ] Did you change script load order in [index.html](index.html)? If yes, sanity-check §1.
- [ ] Did you add a writer to a single-writer resource (§3)? Don't.
- [ ] Did you cache project path on `this.*`? Don't — read from the owner.
- [ ] Did you call `EditorManager.createEditorInstance` outside `TabManager.addTab`? See §4.
- [ ] Did you re-introduzir modos diferentes? Aurora roda em modo unico desde 2026-05 — re-introduzir multimodos exige smoke-test manual open-close-reopen-edit; historicamente quebrou Monaco em sessoes restauradas.
- [ ] Did you add a `DOMContentLoaded` listener? Verify it doesn't depend on later listeners having run.
- [ ] Did you add a path that decides what gets `$dumpvars`'d or what goes into the .gtkw? Re-read §9 — if the path bypasses `_resolveWaveSelection` / `validateSelection`, you're recreating a class of bug we've already fixed.
- [ ] Did you rename a symbol mentioned in this doc? Grep ARCHITECTURE.md for the old name and update it — and grep the codebase for `ARCHITECTURE.md §` to keep section cross-references in code comments honest.
- [ ] Did you hardcode `.cmm` in a processor path? See §13 — the processor front end is about to become language-dispatched, and every new literal `.cmm` is one more site to untangle.
- [ ] Did you add a processor capability as a button only? See §13 — it lands in `aurora_api.js` and `main/ai/tools.js` first, then in the UI.
- [ ] Did you touch `package.json` `name`, `productName`, `build.productName` or `build.appId`? Re-read §11 — each one moves state that installed copies already depend on, and `name` silently costs the whole fleet a full download.
- [ ] Did you change how a cocotb run's outcome is decided? See §12 — the exit code carries a verdict, and collapsing it back onto "non-zero means broken" reintroduces "failing testbench reported as success".
- [ ] Did you change a compile step's arguments? [tests/toolchain/](tests/toolchain/) runs the real binaries through the same builders; run `npm run test:toolchain` before merging.

Smoke test (manual, ~2 min):
1. Open Aurora. Last project should auto-load.
2. Click a `.v` file in the tree. Editor should open. Type — text should insert at cursor.
3. Close project, reopen via Recent. Editor + edit should still work.
4. Toggle simulation on/off. Trees should swap cleanly. Edit should still work.
5. Sem mais switch Processor ↔ Project — modo unico hoje.

Smoke test (automated, runs in CI):
- [tests/e2e/smoke.test.js](tests/e2e/smoke.test.js) launches a real Aurora via Playwright's Electron API and asserts Monaco initializes without the failure markers we've hit (notably "EditorManager has not been initialized" and the Monaco 0.53 contribution-module crash). Run locally with `npm run test:e2e`.

Toolchain test (automated, gates every release):
- [tests/toolchain/pipeline.test.js](tests/toolchain/pipeline.test.js) drives the REAL binaries — a C± source becomes a Verilog processor, elaborates, simulates under Icarus, Verilator and cocotb, synthesises to a PRISM schematic, and the language servers answer an LSP handshake. It builds every command with the same builders the app uses, so a changed flag fails here instead of in a lab. Not part of `npm test` (it needs `components/`, ~1 GB); run `npm run test:toolchain`. It skips with a message naming the missing binaries when the toolchain is absent.

## 11. Product identity — four names, four different consequences

Four fields spell the product's name, and each one lands somewhere different on disk.
Changing any of them moves state that installed copies are already using.

| Field | Value | What it controls |
|---|---|---|
| `package.json` `name` | `sapho` | **The updater cache dir**: `%LOCALAPPDATA%\<name>-updater`. |
| `package.json` `productName` | `SAPHO` | `app.getName()` → userData and logs at `%APPDATA%\SAPHO`. |
| `build.productName` | `SAPHO` | The `.exe` name, `INSTDIR`, Start Menu and desktop shortcuts. |
| `build.appId` | `com.nipscern.sapho` | Shortcut AppUserModelID and the uninstall registry key. |
| `build.win.artifactName` | `sapho-aurora-Setup-v${version}.exe` | The published installer's file name. |

Anything that becomes a **file or a directory** uses `SAPHO` alone. "SAPHO & AURORA" is
display text only (the About panel, the wordmark): an `&` is legal in Windows paths but
breaks any unquoted script that touches them.

**`name` is the one you must not rename.** `updaterCacheDirName` is
`sanitizeFileName(name).toLowerCase() + "-updater"`, and that directory holds
`installer.exe` — the base file the differential downloader diffs against (see
[RELEASE.md](RELEASE.md)). Rename the package and every installed copy looks for its delta
base in a directory that does not exist: no error, no warning, just a silent fall back to a
full ~500 MB download for the whole fleet. A stale `aurora-ide-updater` folder from the
April 2026 rename is what that leftover looks like on disk.

**`build.productName` moves the install directory.** A machine installed under
`%LOCALAPPDATA%\Programs\Aurora-IDE` that receives a build with a different
`build.productName` installs *alongside* the old one rather than over it — orphaned files,
duplicate shortcuts, a stale uninstall entry. Do renames before a deployment, never after.

**`build.appId` and `app.setAppUserModelId` must agree.** [main.js](main.js) sets the
AppUserModelID at boot; electron-builder stamps the shortcuts with `build.appId`. When they
differ, Windows treats the running window and the pinned shortcut as different applications,
and taskbar grouping plus the jumplist attach to the wrong identity. They **did** differ
(`com.nipscern.sapho` in main.js vs `com.nipscern.auroraide` in the build config) until
2026-08-06 — which is why the jumplist fix documented in main.js never fully took. Both are
`com.nipscern.sapho` now; keep them in lockstep.

**Comments do not go inside the `build` block.** electron-builder validates it against a
strict schema and rejects unknown keys, including `//`-prefixed ones. The identity notes live
at package.json top level as `//build-identity`.

## 12. cocotb reports a verdict, not just an exit code

A cocotb testbench exists to answer one question: did the design pass? `runner.test()` does
**not** encode that in its exit status — it returns 0 whether every test passed or every test
failed. Checking only `code !== 0`, as `_waveRunCocotbSimulation` used to, reported a failing
testbench as a successful simulation.

The runner ([cocotb_runner_source.js](js/compilation/cocotb_runner_source.js)) therefore reads
`results.xml` and encodes the verdict itself:

| Exit code | Meaning | What Aurora does |
|---|---|---|
| `0` | all tests passed | normal success path |
| `2` (`COCOTB_TESTS_FAILED`) | simulation completed, tests failed | reports the failure **and still opens the waveform** |
| anything else | infrastructure failure (build, missing module, crash) | aborts; there is nothing to show |

The middle row is the point. Aborting on a failed test would deny the student the waveform at
the exact moment it is most useful. "No tests collected" counts as a failure too: a simulation
that finished without checking anything must not read as a pass.

**If you add a fourth outcome, it needs its own code and its own row here** — reusing `1` would
make a test failure indistinguishable from a broken build.

## 13. Processor front end is language-dispatched (planned)

A SAPHO processor's source is a `.cmm` today, but the yanc toolchain also has a C++ front end
(`cpppp` + `cppcomp`) that converges on the same `Software/<proc>.asm` + `cmm_log.txt`. From
`appcomp` onward the pipeline is identical, so the split is confined to one step at the front.

Two invariants govern that work, and they apply to code written before it lands:

The front-end step is chosen from the processor's source language, not assumed. Sites that currently
assume `.cmm` and will have to dispatch: [spec_factory.ts](js/compilation/spec_factory.ts) (the
`step === 'cmm'` branch and both `replace(/\.cmm$/i, '')` calls),
[processor_compiler.js](js/compilation/processor_compiler.js) (`cmmCompilation`),
[compilation_flow.js](js/compilation/compilation_flow.js) (`STEP_TERMINALS`, `STEP_CLEARS`,
`resolveFallbackCmmPath`, `handleCmmStep`), and [file_mode.js](js/project/file_mode.js)
(`SOFTWARE_EXTENSIONS`). Don't add a fifth.

Every processor capability is an AI-callable API before it is a button.
[aurora_api.js](js/api/aurora_api.js) → [main/ai/tools.js](main/ai/tools.js) → MCP, then the panel,
and the panel calls the same API the model calls. A capability reachable only through a click is a
bug in this layer.

Full plan and gap inventory: [docs/ESTUDO_CPP_PROCESSADORES.md](docs/ESTUDO_CPP_PROCESSADORES.md).
