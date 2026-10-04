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
import { metaNs } from './meta_ns.js';

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

// O namespace _meta (o catalogo da superficie) mora em meta_ns.ts.

// The AuroraAPI.git namespace (Source Control for the AI) lives in ./git_ns.js
// (imported at the top) so it stays unit-testable without the editor/monaco
// import chain. It is exposed as `git:` in the AuroraAPI surface below.

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
