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

import { electronAPI } from '../app/electron_api.js';
import { listOverrides, setOverride, clearOverride } from '../compilation/command_overrides.js';
import { resolveSpec } from '../compilation/spec_runner.js';
import { STEP_IDS, STEP_DESCRIPTIONS } from '../compilation/command_spec.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { TabManager } from '../tabs/tab_manager.js';
import { SharedModelRegistry } from '../editor/shared_models.js';
import { setTooltipsEnabled } from '../ui/tooltip.js';
import { gitNs } from './git_ns.js';
import { prismNs } from './prism_ns.js';
import { waveNs } from './wave_ns.js';
import { memoriasDoProjeto } from './memorias_ns.js';
import { processadoresDoProjeto } from './processadores_ns.js';
import { arquivosDoProjeto } from './arquivos_ns.js';
import { cicloDoProjeto } from './ciclo_do_projeto_ns.js';
import { renomearProjeto } from './renomear_projeto_ns.js';
import { arquivosAbertos } from './abas_e_arvore.js';
import { activeEditor, activeModel, flashLines, magicWandReveal } from './editor_ativo.js';
import { acharArquivoNoProjeto, listarArquivosDoProjeto } from './arvore_do_projeto.js';
import { examplesNs } from './examples_ns.js';
import { manualNs } from './manual_ns.js';
import { switchTerminal } from '../terminal/terminal.js';
import { ehPassoDaApi } from '../compilation/api_steps.js';

// Envelope de resposta e barramento de eventos. Moram em api_core.js, que nao
// importa nada, porque importar ESTE arquivo inicializa a IDE inteira e por
// isso nenhum teste alcancava o nucleo. Ver js/api/api_core.js.
import { ok, err, on, off, emit, WINDOW_EVENT_BRIDGE } from './api_core.js';
import { motivoDe } from '../app/api_reply.js';



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

/* ============================================================
 *  editor, Monaco interactions
 * ========================================================== */

// O editor em foco, o piscar das linhas e a varinha moram em editor_ativo.ts.

const editorNs = {
  async getActiveFilePath() {
    return ok(TabManager?.activeTab || null);
  },

  async getOpenFiles() {
    // Todo painel, do editor dividido e da barra principal (abas_e_arvore.ts).
    return ok(arquivosAbertos());
  },

  async getActiveText() {
    const model = activeModel();
    if (!model) return err('No active editor');
    return ok(model.getValue());
  },

  async setActiveText(text) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const model = ed.getModel();
    if (!model) return err('No active editor');
    model.setValue(String(text ?? ''));
    magicWandReveal(ed);
    return ok();
  },

  /**
   * Insert `text` at `{ line, column }` (1-indexed Monaco coordinates).
   * Omit the position to insert at the current cursor.
   */
  async insertAt(text, position) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const pos = position && position.line && position.column
      ? { lineNumber: position.line, column: position.column }
      : ed.getPosition();
    if (!pos) return err('Cursor position unavailable');
    const insertText = String(text ?? '');
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: insertText,
      forceMoveMarkers: true,
    }]);
    const newLines = (insertText.match(/\n/g) || []).length;
    flashLines(ed, pos.lineNumber, pos.lineNumber + newLines);
    return ok();
  },

  /**
   * Replace the text in `{ startLine, startColumn, endLine, endColumn }`
   * (1-indexed, end-exclusive in column) with `text`.
   */
  async replaceRange({ startLine, startColumn, endLine, endColumn, text }) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    if (!startLine || !startColumn || !endLine || !endColumn) {
      return err('replaceRange requires startLine, startColumn, endLine, endColumn');
    }
    const replaceText = String(text ?? '');
    ed.executeEdits('aurora-api', [{
      range: {
        startLineNumber: startLine, startColumn,
        endLineNumber:   endLine,   endColumn,
      },
      text: replaceText,
      forceMoveMarkers: true,
    }]);
    const newLines = (replaceText.match(/\n/g) || []).length;
    flashLines(ed, startLine, startLine + newLines);
    return ok();
  },

  async getCursor() {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const p = ed.getPosition();
    return p ? ok({ line: p.lineNumber, column: p.column }) : err('Cursor unavailable');
  },

  async setCursor({ line, column }) {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    ed.setPosition({ lineNumber: line, column });
    ed.revealPositionInCenter({ lineNumber: line, column });
    ed.focus();
    return ok();
  },

  async getLanguage() {
    const model = activeModel();
    if (!model) return err('No active editor');
    return ok(model.getLanguageId?.() ?? null);
  },

  async newFile() {
    if (typeof TabManager?.createNewFile !== 'function') {
      return err('newFile unavailable');
    }
    try {
      const filePath = TabManager.createNewFile();
      emit('editor:new-file', { filePath });
      return ok({ filePath });
    } catch (e) {
      return err(e?.message || 'newFile failed');
    }
  },

  async save() {
    const path = TabManager?.activeTab;
    if (!path) return err('No active file');
    try {
      await TabManager.saveCurrentFile();
      emit('editor:saved', { filePath: path });
      return ok({ filePath: path });
    } catch (e) {
      return err(e?.message || 'save failed');
    }
  },

  /**
   * Formata um arquivo pelo formatador da própria AURORA, o mesmo da varinha
   * e do Shift+Alt+F.
   *
   * Isto existe para a IA não precisar reescrever um arquivo inteiro só para
   * arrumar indentação e espaçamento. Reescrever é caro, arrisca perder código
   * e produz um diff enorme onde o certo seria um diff de formatação. Aqui ela
   * delega ao clang-format (C, C++ e C±), ao black (Python) ou ao Verible
   * (Verilog), conforme o idioma do arquivo, e o resultado é exatamente o que
   * o usuário obteria clicando na varinha.
   */
  async formatFile({ filePath } = {}) {
    let alvo = filePath || TabManager?.activeTab || null;
    if (!alvo) return err('No file given and no active file');

    // Aceita o mesmo tipo de caminho aproximado que openFile aceita.
    if (filePath) {
      const root = window.currentProjectPath || '';
      const abs = root ? await acharArquivoNoProjeto(filePath, root) : null;
      if (!abs) return err(`"${filePath}" not found anywhere in the project.`);
      alvo = abs;
    }

    // O provedor de formatação mora no Monaco, então o arquivo precisa de um
    // modelo. Se não estiver aberto, abrimos.
    let ed = EditorManager.getEditorForFile?.(alvo) ?? null;
    if (!ed) {
      const r = await editorNs.openFile({ filePath: alvo });
      // O envelope da API e `{ ok, data }`. Ate 25/09/2026 isto conferia um
      // `.success` que ele nao tem, e formatar um arquivo fechado parava aqui,
      // devolvendo o resultado do openFile no lugar do da formatacao.
      if (!r?.ok) return r;
      ed = EditorManager.getEditorForFile?.(alvo) ?? null;
    }
    if (!ed?.getModel) return err(`Could not open an editor for "${alvo}"`);

    const model = ed.getModel();
    const antes = model.getValue();
    const action = ed.getAction?.('editor.action.formatDocument');
    if (!action) return err('Format action unavailable');
    let suportado = false;
    try { suportado = action.isSupported(); } catch { suportado = false; }
    if (!suportado) {
      return err(`No formatter is registered for "${model.getLanguageId()}". `
        + 'Aurora formats C, C++, C± (clang-format), Python (black) and Verilog (Verible).');
    }

    try { await action.run(); } catch (e) {
      return err(e?.message || 'format failed');
    }

    const depois = model.getValue();
    if (depois === antes) {
      return ok({ filePath: alvo, changed: false, message: 'Already formatted' });
    }
    try {
      await TabManager.saveFile(alvo);
    } catch (e) {
      // A formatação está no buffer; só o salvamento falhou. Dizer isso é mais
      // útil do que fingir que nada aconteceu.
      return err(`Formatted the buffer but could not save: ${e?.message || e}`);
    }
    emit('editor:saved', { filePath: alvo });
    return ok({ filePath: alvo, changed: true, language: model.getLanguageId() });
  },

  async saveAll() {
    try {
      await TabManager.saveAllFiles();
      emit('editor:saved', { filePath: null, all: true });
      return ok();
    } catch (e) {
      return err(e?.message || 'saveAll failed');
    }
  },

  /** Close `filePath`, or the active tab if no path is given. */
  async closeTab(filePath) {
    const target = filePath || TabManager?.activeTab;
    if (!target) return err('No tab to close');
    if (typeof TabManager?.closeTab !== 'function') return err('TabManager.closeTab unavailable');
    try {
      await TabManager.closeTab(target);
      return ok({ filePath: target });
    } catch (e) {
      return err(e?.message || 'closeTab failed');
    }
  },

  /** Re-open the most-recently closed tab (TabManager keeps a small history). */
  async reopenLastTab() {
    if (typeof TabManager?.reopenLastClosedTab !== 'function') {
      return err('reopen history unavailable');
    }
    try {
      await TabManager.reopenLastClosedTab();
      return ok();
    } catch (e) {
      return err(e?.message || 'reopenLastTab failed');
    }
  },

  /** Open a project file in the editor, optionally in a new split pane. */
  async openFile({ filePath, inNewSplit = false } = {}) {
    if (!filePath) return err('filePath required');
    const root = window.currentProjectPath || '';
    if (!root) return err('No project open');
    // Find the file anywhere in the project (basename / partial path / casing),
    // not just at the literal path the AI guessed.
    const absPath = await acharArquivoNoProjeto(filePath, root);
    if (!absPath) {
      return err(`"${filePath}" not found anywhere in the project. Use get_project_tree to list available paths.`);
    }
    let content;
    try {
      content = await electronAPI.readFile(absPath);
    } catch (e) {
      return err(`Found "${absPath}" but could not read it: ${e?.message || e}`);
    }
    const sem = window.SplitEditorManager;
    try {
      if (inNewSplit && sem?.createSplit) {
        await sem.createSplit();          // creates pane from current file + focuses it
        await sem.openInFocusedPane(absPath, content);  // replace with target file
      } else if (sem?.openInFocusedPane) {
        await sem.openInFocusedPane(absPath, content);
      } else {
        TabManager.addTab(absPath, content);
      }
      return ok({ filePath: absPath });
    } catch (e) {
      return err(e?.message || 'openFile failed');
    }
  },

  /** Create a new editor split pane. */
  async createSplit() {
    const sem = window.SplitEditorManager;
    if (!sem?.createSplit) return err('SplitEditorManager unavailable');
    try {
      await sem.createSplit();
      return ok();
    } catch (e) {
      return err(e?.message || 'createSplit failed');
    }
  },
};

/* ============================================================
 *  terminal, read/clear the per-area panels at the bottom
 *
 *  Terminals are addressed by their content id: 'tcmm', 'tasm',
 *  'tveri', 'twave', 'tprism' (the panes wired by the
 *  compilation-flow buttons). Pass `undefined` to operate on
 *  the currently visible terminal.
 * ========================================================== */

function visibleTerminalEl() {
  return document.querySelector('.terminal-content:not(.hidden)') || null;
}
function terminalElById(id) {
  if (!id) return visibleTerminalEl();
  // Match either the content div id (`tcmm`) or the wrapper `terminal-tcmm`.
  return document.getElementById(id) || document.getElementById(`terminal-${id}`) || null;
}
function extractTerminalText(el) {
  const lines = Array.from(el.querySelectorAll('.message, .entry, .terminal-line, .terminal-card'))
    .map((n) => n.textContent?.trim())
    .filter(Boolean);
  return lines.length ? lines.join('\n') : (el.textContent || '').trim();
}

const terminalNs = {
  /** List the ids of every terminal panel (tcmm, tasm, tveri, twave, ...). */
  async list() {
    const ids = Array.from(document.querySelectorAll('.terminal-content'))
      .map((el) => el.id)
      .filter(Boolean);
    return ok(ids);
  },

  /**
   * Return the visible text content of one terminal. Cards/messages get
   * concatenated with newlines so the result reads like the user sees
   * the panel. Omit `id` for the currently visible terminal.
   */
  async getText(id) {
    const el = terminalElById(id);
    if (!el) return err(id ? `terminal "${id}" not found` : 'no visible terminal');
    return ok(extractTerminalText(el));
  },

  /** Visible text of *every* terminal panel, keyed by id. */
  async getAll() {
    const out = {};
    for (const el of document.querySelectorAll('.terminal-content')) {
      if (el.id) out[el.id] = extractTerminalText(el);
    }
    return ok(out);
  },

  async clear(id) {
    const tm = window.globalTerminalManager;
    if (!tm) return err('terminal manager not initialised');
    const target = id || visibleTerminalEl()?.id || null;
    if (!target) return err('no terminal to clear');
    try {
      if (typeof tm.clearTerminal === 'function') {
        await tm.clearTerminal(target);
      } else if (typeof tm.clearTerminalImmediate === 'function') {
        tm.clearTerminalImmediate(target);
      } else {
        const el = terminalElById(target);
        if (!el) return err(`terminal "${target}" not found`);
        el.innerHTML = '';
      }
      return ok({ id: target });
    } catch (e) {
      return err(e?.message || 'clear failed');
    }
  },

  /**
   * Type, and optionally run, a command in the user's TCMD shell (their real
   * PowerShell/bash, the one they see). `execute:false` just places the command
   * on the input line for the user to review and run; `execute:true` (default)
   * runs it and returns a best-effort snapshot of the output. `cd` persists in
   * the user's shell. This is the HUMAN shell, not the sandboxed compile path;
   * prefer compile_all / compile_step / run_fast_sim for real builds.
   */
  async runInShell(args = {}) {
    const command = typeof args === 'string' ? args : (args?.command ?? '');
    if (!String(command).trim()) return err('command is required');
    const execute = args?.execute !== false;   // default true
    const st = window.shellTerminal;
    if (!st || typeof st.runCommand !== 'function') return err('TCMD shell unavailable');
    // Bring the TCMD terminal into view so the user watches it happen (this
    // module owns the tab switch; shell_terminal deliberately doesn't).
    try { switchTerminal('terminal-tcmd'); } catch (_) { /* best-effort */ }
    try {
      const res = await st.runCommand(command, { execute });
      if (!res?.ok) return err(motivoDe(res, 'shell command failed'));
      // `complete:false` means the capture hit its cap while the shell was
      // still talking: the output is a prefix and the command may still be
      // running. Say so explicitly, so the model never mistakes a truncated
      // log for a finished one.
      const complete = res.executed ? res.complete !== false : true;
      return ok({
        command: res.command,
        executed: res.executed,
        complete,
        output: res.output ?? '',
        ...(complete ? {} : { note: 'output truncated: the command was still producing output when the capture window closed and may still be running; check the TCMD terminal before assuming it finished' }),
      });
    } catch (e) {
      return err(e?.message || 'shell command failed');
    }
  },
};

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

  /**
   * Parse a SAPHO assembly (.asm) file and return a structured summary
   * the AI can reason about without re-reading the whole text.
   *
   * Resolution order (one of these must work):
   *   1. explicit `filePath` (absolute, or relative to project root)
   *   2. `processorName`  → <root>/<proc>/Software/<proc>.asm
   *   3. neither          → active editor (must be .asm)
   *
   * The returned shape lets the AI ask "how many instructions are in
   * the loop at @L3?" or "how many floating-point multiplications does
   * this processor do?" in O(1) after one call.
   */
  async analyzeAsm({ filePath, processorName } = {}) {
    const root = window.currentProjectPath || null;
    let target = null;

    if (filePath) {
      target = String(filePath).trim();
    } else if (processorName) {
      if (!root) return err('No project open');
      target = `${root}\\${processorName}\\Software\\${processorName}.asm`;
    } else {
      const active = window.tabManager?.getEditingFilePath?.()
                  || window.TabManager?.getEditingFilePath?.();
      if (!active || !active.toLowerCase().endsWith('.asm')) {
        return err('no filePath/processorName and active file is not .asm');
      }
      target = active;
    }

    if (target.includes('..')) return err('path must not contain ".."');
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\');
    if (!isAbsolute && root) target = `${root}\\${target.replace(/^[\\/]+/, '')}`;

    // Stay inside the project folder, same boundary as readFile.
    if (root) {
      const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
      const r = norm(root);
      const t = norm(target);
      if (t !== r && !t.startsWith(r + '\\')) {
        return err('file is outside the open project folder');
      }
    }

    // Read text (live model wins if the file is open in Monaco, so the
    // analysis tracks unsaved edits, same contract as readFile).
    let text;
    const liveModel = SharedModelRegistry.getModel(target);
    if (liveModel) {
      text = liveModel.getValue();
    } else {
      try { text = String(await electronAPI.readFile(target) ?? ''); }
      catch (e) { return err(`File not found: "${target}"`); }
    }

    // Load the opcode table so we recognise mnemonics. Without rules
    // we fall back to a regex-only parser (every uppercase identifier
    // is treated as a mnemonic).
    const rules    = await loadRules();
    const opcodes  = (rules?.asm?.opcodes) || [];
    const mneSet   = new Set(opcodes.map((o) => o.mnemonic));
    const families = new Map(opcodes.map((o) => [o.mnemonic, o.family]));

    /** @type {Record<string, number>} */
    const byOpcode = Object.create(null);
    /** @type {Record<string, number>} */
    const byFamily = Object.create(null);
    /** @type {{name:string,line:number}[]} */
    const labelDefs = [];
    /** @type {{from:number, target:string, mnemonic:string}[]} */
    const branches = [];
    /** @type {string[]} */
    const unknownMnemonics = [];

    const lines = text.split(/\r?\n/);
    let total = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      // Strip block-end comments (`//...`) but keep the body.
      const noComment = raw.replace(/\/\/.*$/, '').trim();
      if (!noComment) continue;
      // Header directives (#PRNAME, #NUBITS, ...) are not instructions.
      if (noComment.startsWith('#')) continue;

      // Pull every leading `@label` (a single .asm line can carry
      // several labels, e.g. `@main @L1 LOD 1`).
      let rest = noComment;
      while (rest.startsWith('@')) {
        const m = /^@([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(rest);
        if (!m) break;
        labelDefs.push({ name: m[1], line: i + 1 });
        rest = m[2];
      }
      if (!rest) continue;

      // First whitespace-separated token after labels = mnemonic.
      const tokens = rest.split(/\s+/);
      const mne = tokens[0];
      if (!mne) continue;
      // Mnemonics are uppercase letters/digits/underscore.
      if (!/^[A-Z][A-Z0-9_]*$/.test(mne)) continue;

      total++;
      byOpcode[mne] = (byOpcode[mne] || 0) + 1;
      const fam = families.get(mne) || 'other';
      byFamily[fam] = (byFamily[fam] || 0) + 1;

      if (!mneSet.has(mne) && unknownMnemonics.indexOf(mne) < 0) {
        unknownMnemonics.push(mne);
      }

      // Branches: JMP/JIZ/CAL take a single label-name operand. Record
      // so we can identify loops below.
      if (mne === 'JMP' || mne === 'JIZ' || mne === 'CAL') {
        const tgt = tokens[1];
        if (tgt && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tgt)) {
          branches.push({ from: i + 1, target: tgt, mnemonic: mne });
        }
      }
    }

    // Loop detection: a branch is a back-edge if its target label was
    // defined on or before the branch's own line (classic JMP-loop).
    // For each loop we estimate body size as branch_line − label_line.
    const labelLine = new Map();
    for (const l of labelDefs) {
      if (!labelLine.has(l.name)) labelLine.set(l.name, l.line);
    }
    const loops = [];
    for (const b of branches) {
      const lineOfLabel = labelLine.get(b.target);
      if (lineOfLabel == null) continue;
      if (lineOfLabel <= b.from) {
        loops.push({
          label:   b.target,
          labelLine: lineOfLabel,
          branchLine: b.from,
          branchMnemonic: b.mnemonic,
          bodyInstructions: Math.max(0, b.from - lineOfLabel),
        });
      }
    }
    loops.sort((a, b) => b.bodyInstructions - a.bodyInstructions);

    return ok({
      filePath: target,
      total,
      byOpcode,
      byFamily,
      labels: labelDefs,
      loops,
      unknownMnemonics,        // warns if .asm has opcodes not in sapho_rules
    });
  },

  // As memorias do projeto (listMemories, remember, forget) moram em
  // memorias_ns.ts.
  ...memoriasDoProjeto,

  // Os processadores (listar, criar, apagar, renomear e a config de
  // simulacao) moram em processadores_ns.ts.
  ...processadoresDoProjeto,



};

/* ============================================================
 *  compile, pipeline triggers (the same ones the toolbar uses)
 * ========================================================== */

const ERRO_JA_RODANDO =
  'a compilation is already running; wait for it to finish or cancel it first';

const compileNs = {
  /** Run the full project pipeline (cmm → verilog → wave → prism). */
  async compileAll() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    emit('compile:started', { scope: 'all' });
    // Uma execucao de cada vez. Quem chega em cima de outra recebe a recusa,
    // e nao um ok mentiroso que a faria esperar por um resultado que nunca
    // vem. O aviso no terminal sai de dentro do runAll, que e' por onde o
    // botao da toolbar tambem passa.
    try {
      if (await cf.runAll() === false) return err(ERRO_JA_RODANDO);
      return ok();
    }
    catch (e) { return err(e?.message || 'compileAll failed'); }
  },

  /**
   * Run a single pipeline step.
   *   - 'cmm'   : cmmcomp + asmcomp (regenerates .asm from .cmm)
   *   - 'asm'   : asmcomp + iverilog + vvp (SKIPS cmmcomp, used by Aurora
   *               Intelligence to test a hand-optimised .asm without losing it)
   *   - 'verilog'/'wave'/'prism'/'verilator-proc': existing
   *   - 'verilator-fast': Verilator headless run (no waveform), Verilator-only
   */
  async compileStep(step) {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    // 'cpp' e o mesmo passo de fonte que 'cmm'; o despacho por linguagem
    // (processor_dispatch.ts) escolhe o front end pelo fonte em foco.
    if (!ehPassoDaApi(step)) {
      return err(`unknown compile step: ${step}`);
    }
    emit('compile:started', { scope: step });
    try {
      if (await cf.runSingleStep(step) === false) return err(ERRO_JA_RODANDO);
      return ok({ step });
    }
    catch (e) { return err(e?.message || 'compileStep failed'); }
  },

  /**
   * Run the ACTIVE SAPHO processor's generated top-level (`<proc>.v`) under
   * Verilator as a hardware test, the `verilatorproc` toolbar button. Drives
   * SAPHO's predictable wiring (req_in/out_en one-hot, decimal
   * input_<N>.txt/output_<N>.txt under the processor's Simulation/ folder) and
   * recompiles cmm+asm first so the .v/_tb.v/.mif are fresh. Acts on the
   * processor currently shown in the status bar, fails if none is active.
   * Thin wrapper over compileStep('verilator-proc') so validation + the
   * compile:started event stay single-sourced. Calls through `compileNs`
   * (not `this`): the AI tool_runner invokes namespace methods as bare
   * `fn(...args)`, so `this` is undefined inside them.
   */
  async runVerilatorProc() {
    return compileNs.compileStep('verilator-proc');
  },

  /**
   * Run the project's testbench headless via Verilator, NO waveform, NO
   * GTKWave, the `fastsim` toolbar button, optimised purely for speed.
   * Needs a testbench set; a Verilog testbench requires the simulator to be
   * Verilator (see wave.setSimulator), while a Python cocotb (.py) testbench
   * runs headless on any engine. Recompiles cmm+asm first when the top-level
   * instantiates SAPHO processors. Thin wrapper over
   * compileStep('verilator-fast'). Calls through `compileNs` (not `this`):
   * the AI tool_runner invokes namespace methods as bare `fn(...args)`.
   */
  async runFastSim() {
    return compileNs.compileStep('verilator-fast');
  },

  async cancel() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    // O evento sai de dentro do cancelAll, e nao daqui: cancelar pelo botao da
    // interface nao passa por esta funcao, e emitir nos dois lugares faria a
    // ferramenta da IA disparar o evento duas vezes.
    try { cf.cancelAll(); return ok(); }
    catch (e) { return err(e?.message || 'cancel failed'); }
  },

  /**
   * Como terminou a ultima execucao: rodando, concluida ou cancelada.
   *
   * A IA sabia quando uma compilacao ACABAVA, mas nao quando era cancelada, e a
   * diferenca importa: um turno que pediu para compilar e ficava sem resposta
   * concluia sozinho que algo travou, e seguia investigando um problema que nao
   * existia. Com isto ela pergunta e descobre que o usuario simplesmente parou.
   *
   * O estado e lido do gerenciador de compilacao, que ja o mantem; nao ha
   * estado novo para desincronizar.
   */
  async runStatus() {
    const cf = window.compilationFlowManager;
    if (!cf) return err('compilation flow not initialised');
    const cancelada = !!cf.wasCancelled?.();
    const rodando = !!cf.isRunning?.();
    return ok({
      running: rodando,
      cancelled: cancelada,
      state: rodando ? 'running' : (cancelada ? 'cancelled' : 'idle'),
      note: cancelada
        ? 'The user cancelled the last run. Do not treat the missing result as a failure or a hang.'
        : undefined,
    });
  },

  // -----------------------------------------------------------------
  // Aurora-Intelligence-driven command overrides. Each toolchain step
  // (cmm, asm, iverilog-check, iverilog-build, vvp-run,
  // verilator-build/run, fst2vcd, gtkwave, yosys-hierarchy,
  // prism-yosys) can have an override that appends/prepends/removes
  // args and tweaks env. See command_overrides.js + protected_flags.js.
  // -----------------------------------------------------------------

  /** Enumerate every step the override system knows about. */
  async listSteps() {
    try {
      return ok({ steps: STEP_IDS.map((id) => ({ id, description: STEP_DESCRIPTIONS[id] })) });
    } catch (e) { return err(e?.message || 'listSteps failed'); }
  },

  /**
   * Build the base spec for `step` AND apply any active override.
   * Returns { base, applied, formatted, formattedBase, diff, sources }.
   */
  async inspectCommand(step, processorName) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
        sources: resolved.sources,
        hasOverride: !!resolved.override,
      });
    } catch (e) { return err(e?.message || 'inspectCommand failed'); }
  },

  /**
   * Preview a spec with `extraOverride` layered ON TOP of the active
   * override, WITHOUT registering it. Lets the AI show the user
   * "here's what would happen if I added these flags".
   */
  async previewCommand(step, override, processorName) {
    try {
      const { buildSpecForStep } = await import('../compilation/spec_factory.js');
      const base = await buildSpecForStep(step, processorName);
      const resolved = await resolveSpec(base, override || null);
      return ok({
        step,
        processorName: processorName || null,
        base,
        applied: resolved.appliedSpec,
        formatted: resolved.formatted,
        formattedBase: resolved.formattedBase,
        diff: resolved.diff,
      });
    } catch (e) { return err(e?.message || 'previewCommand failed'); }
  },

  /** List every registered override across both layers. */
  async listOverrides() {
    try {
      const items = await listOverrides();
      return ok({ overrides: items });
    } catch (e) { return err(e?.message || 'listOverrides failed'); }
  },

  /**
   * Register an override. `persist:true` writes to .spf (survives
   * sessions); default is ephemeral (consumed on the next matching
   * step run).
   *
   * Shape: { step, processorName?, appendArgs?, prependArgs?, removeArgs?,
   *          envSet?, envUnset?, persist?, note? }
   */
  async setOverride(payload) {
    try {
      const { step, processorName, persist, note, ...rest } = payload || {};
      const result = await setOverride({
        step, processorName, override: rest, persist: !!persist, note,
      });
      emit('compile:override-set', { step, processorName, persist: !!persist });
      return ok(result);
    } catch (e) { return err(e?.message || 'setOverride failed'); }
  },

  async clearOverride(step, processorName, scope) {
    try {
      const result = await clearOverride({ step, processorName, scope: scope || 'both' });
      emit('compile:override-cleared', { step, processorName });
      return ok(result);
    } catch (e) { return err(e?.message || 'clearOverride failed'); }
  },

  /** Per-step list of flags the override system refuses to touch. */
  async listProtectedFlags(step) {
    try {
      const result = await electronAPI.getProtectedFlags(step);
      return ok({ step: step || null, protected: result });
    } catch (e) { return err(e?.message || 'listProtectedFlags failed'); }
  },

  /** Read-only: which binaries the main-process executor will spawn. */
  async listAllowedBinaries() {
    try {
      const result = await electronAPI.listAllowedBinaries();
      return ok({ binaries: result });
    } catch (e) { return err(e?.message || 'listAllowedBinaries failed'); }
  },
};

/* ============================================================
 *  wave: mora em js/api/wave_ns.ts
 * ========================================================== */

/* ============================================================
 *  rules, static yanc knowledge base
 *
 *  `resources/sapho_rules.json` is regenerated by
 *  `scripts/sync-sapho-rules.js` whenever the yanc source tree
 *  changes (see the script header for the why). The file is bundled
 *  with the installer, so the AI never depends on yanc being
 *  present on the user's machine.
 *
 *  Loaded lazily on first access, boot time stays unaffected if
 *  Aurora Intelligence is never opened.
 * ========================================================== */

let rulesPromise = null;
function loadRules() {
  if (!rulesPromise) {
    rulesPromise = fetch('./resources/sapho_rules.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return rulesPromise;
}

const rulesNs = {
  /** Full rules document. `null` if the file is missing. */
  async get() {
    return ok(await loadRules());
  },

  /** Look up a single hardware directive (case-insensitive: 'NBMANT'/'nbmant'). */
  async getDirective(name) {
    const rules = await loadRules();
    if (!rules?.directives) return err('rules not available');
    const key = String(name || '').replace(/^#/, '').toUpperCase();
    const hit = rules.directives[key];
    return hit ? ok(hit) : err(`unknown directive: ${name}`);
  },

  /** Names of all known hardware directives (e.g. ['NBMANT', 'NBEXPO', ...]). */
  async listDirectives() {
    const rules = await loadRules();
    return ok(rules?.directives ? Object.keys(rules.directives) : []);
  },

  /** Reserved language keywords (if/else/while/...). */
  async getKeywords() {
    const rules = await loadRules();
    return ok(rules?.language?.keywords ?? []);
  },

  /**
   * Look up a compiler message by its `MSG_*` code. Returns the
   * bilingual entry `{ code, severity, category, pt, en }`.
   */
  async lookupMessage(code) {
    const rules = await loadRules();
    const msg = rules?.messages?.find((m) => m.code === code);
    return msg ? ok(msg) : err(`unknown message code: ${code}`);
  },

  /**
   * Enumerate every SAPHO assembly opcode known to yanc, grouped by
   * family. Useful when the AI needs the full ISA at once (e.g. to
   * reason about which opcode pair would shrink a loop). Each entry
   * carries the numeric opcode, operand kind, family label, and the
   * one-line description scraped from ASMComp.l.
   */
  async listOpcodes() {
    const rules = await loadRules();
    return ok(rules?.asm?.opcodes ?? []);
  },

  /** Look up one opcode by mnemonic (case-insensitive). */
  async getOpcode(mnemonic) {
    const rules = await loadRules();
    if (!rules?.asm?.opcodes) return err('opcode table not available');
    const key = String(mnemonic || '').toUpperCase();
    const hit = rules.asm.opcodes.find((o) => o.mnemonic === key);
    return hit ? ok(hit) : err(`unknown opcode: ${mnemonic}`);
  },
};

/* ============================================================
 *  ui, notifications, modals, locale
 * ========================================================== */

const uiNs = {
  /** Pop a toast using the existing notification system. */
  async showNotification(message, type = 'info', duration = 5000, title) {
    if (typeof window.showNotification !== 'function') {
      return err('notification system not available');
    }
    window.showNotification(String(message ?? ''), type, duration, title);
    return ok();
  },

  /** Open the Settings modal (same effect as clicking the toolbar gear). */
  async openSettings() {
    const btn = document.getElementById('aurora-settings');
    if (!btn) return err('settings button not found');
    btn.click();
    return ok();
  },

  async getLocale() {
    return ok(window.getLocale ? window.getLocale() : null);
  },

  async setLocale(locale) {
    if (typeof window.setLocale !== 'function') return err('i18n not loaded');
    try { await window.setLocale(locale); return ok({ locale }); }
    catch (e) { return err(e?.message || 'setLocale failed'); }
  },

  /**
   * Pause the AI turn and show an inline question card in the chat
   * panel. The card lets the user pick from {options}, optionally
   * multi-select, and (always) write a free-form "Other" answer.
   *
   * Resolves with `{ answer: <text>, selected: [<labels>] }` once the
   * user submits. The promise also resolves if the AI turn aborts.
   *
   * @param {object} params
   * @param {string} params.question
   * @param {Array<{label:string, description?:string}>} [params.options]
   * @param {boolean} [params.multiSelect]
   */
  async askUserQuestion({ question, options = [], multiSelect = false } = {}) {
    if (!question || typeof question !== 'string') return err('question required');
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.showAskUserQuestionInline !== 'function') {
      return err('AI panel is not available');
    }
    const result = await mgr.showAskUserQuestionInline({
      question, options: Array.isArray(options) ? options : [], multiSelect: !!multiSelect,
    });
    if (result == null) return err('user dismissed the question');
    return ok(result);
  },
};

/* ============================================================
 *  ai, drive the Aurora Intelligence chat panel
 * ========================================================== */

const aiNs = {
  /** Open the AI assistant panel (idempotent). */
  async open() {
    const mgr = window.aiAssistantManager;
    if (!mgr) return err('AI panel is not available');
    mgr.ensureOpen();
    return ok();
  },

  /**
   * Open the panel and seed the composer with a code snippet the user
   * selected in the editor, the backing call for the Monaco selection
   * "star" widget. With a concrete `intent` and `send:true` the message is
   * dispatched immediately; otherwise the composer is just pre-filled.
   *
   * @param {object} p
   * @param {string} p.code        the selected source text (required)
   * @param {string} [p.language]  monaco language id (verilog, cmm, python…)
   * @param {string} [p.filePath]  absolute path of the file
   * @param {number} [p.lineStart] 1-based first selected line
   * @param {number} [p.lineEnd]   1-based last selected line
   * @param {string} [p.intent]    'explain'|'fix'|'improve'|'comment'|'doc'|''
   * @param {boolean}[p.send]      send immediately (only with an intent)
   */
  async askAboutSelection(p = {}) {
    if (!p || !String(p.code || '').trim()) return err('code (a non-empty selection) required');
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.askAboutSelection !== 'function') {
      return err('AI panel is not available');
    }
    try {
      mgr.askAboutSelection(p);
      return ok();
    } catch (e) {
      return err(e?.message || 'askAboutSelection failed');
    }
  },

  /**
   * Start a long task in the background and return IMMEDIATELY so the current
   * turn can end. When the task finishes, the assistant auto-continues the
   * conversation with the result, i.e. it runs the work "under the hood",
   * lets the chat finish, then posts a follow-up message on its own.
   *
   * @param {{task:'compile_all'|'compile_step', step?:string, note?:string}} p
   */
  async runInBackground(p = {}) {
    const mgr = window.aiAssistantManager;
    if (!mgr || typeof mgr.runInBackground !== 'function') {
      return err('AI panel is not available');
    }
    const r = mgr.runInBackground(p || {});
    return (r && r.ok) ? ok(r.data) : err((r && r.error) || 'runInBackground failed');
  },
};

/* ============================================================
 *  settings, read/update the user-facing IDE settings
 * ========================================================== */

const SETTINGS_KEY = 'aurora-settings';

function readSettingsStore() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

const settingsNs = {
  /** Snapshot of every user-facing setting Aurora exposes. */
  async getAll() {
    const s = readSettingsStore();
    return ok({
      locale: window.getLocale ? window.getLocale() : null,
      tooltipsEnabled: s.tooltipsEnabled !== false,
      verboseMode: !!s.verboseMode,
    });
  },

  /**
   * Update one setting. `key` is 'locale' | 'tooltipsEnabled' |
   * 'verboseMode'. Persists to localStorage and broadcasts so the
   * live UI reacts immediately.
   */
  async set(key, value) {
    if (key === 'locale') {
      if (typeof window.setLocale !== 'function') return err('i18n not loaded');
      await window.setLocale(value);
      return ok({ key, value });
    }
    if (key === 'tooltipsEnabled' || key === 'verboseMode') {
      const s = readSettingsStore();
      s[key] = !!value;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
      catch (e) { return err(e?.message || 'could not persist setting'); }
      window.dispatchEvent(new CustomEvent('aurora-settings-updated', { detail: s }));
      if (key === 'tooltipsEnabled') {
        setTooltipsEnabled(!!value);
      }
      return ok({ key, value: !!value });
    }
    return err(`unknown setting: ${key}`);
  },
};

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
