/**
 * editor_ns.ts: o namespace `AuroraAPI.editor`, o editor visto pela API: ler e
 * escrever no editor ativo, cursor, abas (novo, salvar, fechar, reabrir),
 * abrir um arquivo do projeto, dividir o editor e formatar um arquivo.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), com o comportamento
 * travado antes por tests/unit/auroraApiEditor.test.js.
 *
 * Compilado por `tsc` (npm run build:ts) num editor_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ok, err, emit } from './api_core.js';
import { arquivosAbertos } from './abas_e_arvore.js';
import { activeEditor, activeModel, flashLines, magicWandReveal } from './editor_ativo.js';
import { acharArquivoNoProjeto } from './arvore_do_projeto.js';

/** A mensagem de uma excecao qualquer, ou a de reserva. */
const motivo = (e: unknown, reserva: string): string => (e as Error | null)?.message || reserva;

/** Uma posicao no editor, em linha e coluna a partir de 1. */
interface Posicao {
  line: number;
  column: number;
}

/** Um trecho a trocar: inicio e fim (a coluna final nao entra) e o texto novo. */
interface Trecho {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  text?: unknown;
}

/** Quantas quebras de linha o texto tem, para piscar todas as linhas escritas. */
const quebras = (texto: string): number => (texto.match(/\n/g) || []).length;

export const editorNs = {
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

  async setActiveText(text?: unknown) {
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
  async insertAt(text?: unknown, position?: Partial<Posicao> | null) {
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
    flashLines(ed, pos.lineNumber, pos.lineNumber + quebras(insertText));
    return ok();
  },

  /**
   * Replace the text in `{ startLine, startColumn, endLine, endColumn }`
   * (1-indexed, end-exclusive in column) with `text`.
   */
  async replaceRange({ startLine, startColumn, endLine, endColumn, text }: Trecho) {
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
    flashLines(ed, startLine, startLine + quebras(replaceText));
    return ok();
  },

  async getCursor() {
    const ed = activeEditor();
    if (!ed) return err('No active editor');
    const p = ed.getPosition();
    return p ? ok({ line: p.lineNumber, column: p.column }) : err('Cursor unavailable');
  },

  async setCursor({ line, column }: Posicao) {
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
      return err(motivo(e, 'newFile failed'));
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
      return err(motivo(e, 'save failed'));
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
  async formatFile({ filePath }: { filePath?: string } = {}) {
    let alvo = filePath || TabManager?.activeTab || null;
    if (!alvo) return err('No file given and no active file');

    // Aceita o mesmo tipo de caminho aproximado que openFile aceita.
    if (filePath) {
      const root = ProjectStore.getProjectPath() || '';
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
    const model = ed?.getModel?.();
    if (!ed || !model) return err(`Could not open an editor for "${alvo}"`);

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
      return err(motivo(e, 'format failed'));
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
      return err(`Formatted the buffer but could not save: ${(e as Error | null)?.message || e}`);
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
      return err(motivo(e, 'saveAll failed'));
    }
  },

  /** Close `filePath`, or the active tab if no path is given. */
  async closeTab(filePath?: string) {
    const target = filePath || TabManager?.activeTab;
    if (!target) return err('No tab to close');
    if (typeof TabManager?.closeTab !== 'function') return err('TabManager.closeTab unavailable');
    try {
      await TabManager.closeTab(target);
      return ok({ filePath: target });
    } catch (e) {
      return err(motivo(e, 'closeTab failed'));
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
      return err(motivo(e, 'reopenLastTab failed'));
    }
  },

  /** Open a project file in the editor, optionally in a new split pane. */
  async openFile({ filePath, inNewSplit = false }: { filePath?: string; inNewSplit?: boolean } = {}) {
    if (!filePath) return err('filePath required');
    const root = ProjectStore.getProjectPath() || '';
    if (!root) return err('No project open');
    // Find the file anywhere in the project (basename / partial path / casing),
    // not just at the literal path the AI guessed.
    const absPath = await acharArquivoNoProjeto(filePath, root);
    if (!absPath) {
      return err(`"${filePath}" not found anywhere in the project. Use get_project_tree to list available paths.`);
    }
    let content: string;
    try {
      content = await electronAPI.readFile(absPath);
    } catch (e) {
      return err(`Found "${absPath}" but could not read it: ${(e as Error | null)?.message || e}`);
    }
    const sem = window.SplitEditorManager;
    try {
      if (inNewSplit && sem?.createSplit) {
        await sem.createSplit();          // creates pane from current file + focuses it
        // Sem openInFocusedPane a chamada falha e cai no catch, como antes.
        await (sem.openInFocusedPane as (f: string, c: string) => Promise<unknown>)(absPath, content);  // replace with target file
      } else if (sem?.openInFocusedPane) {
        await sem.openInFocusedPane(absPath, content);
      } else {
        TabManager.addTab(absPath, content);
      }
      return ok({ filePath: absPath });
    } catch (e) {
      return err(motivo(e, 'openFile failed'));
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
      return err(motivo(e, 'createSplit failed'));
    }
  },
};
