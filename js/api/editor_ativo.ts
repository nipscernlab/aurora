/**
 * editor_ativo.ts: o editor em foco e os dois efeitos visuais que a API
 * aplica quando a IA mexe no texto (o piscar das linhas e a varinha).
 *
 * Moravam no js/api/aurora_api.js, usados pelo namespace `editor` e pelo
 * `project.createFile`; saem para ca para que a parte de arquivos do
 * `project` vire modulo sem voltar ao aurora_api.js.
 *
 * O Monaco chega como global (window.monaco), carregado pelo AMD; aqui ele
 * e so consultado, e cada efeito e cosmetico: nada daqui pode quebrar a
 * escrita que o disparou.
 *
 * Compilado por `tsc` (npm run build:ts) num editor_ativo.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import type * as Monaco from 'monaco-editor';
import { EditorManager } from '../editor/monaco_editor.js';

type Editor = Monaco.editor.IStandaloneCodeEditor;

const monaco = (): typeof Monaco | undefined => (window as unknown as { monaco?: typeof Monaco }).monaco;

export function activeEditor(): Editor | null {
  return EditorManager?.activeEditor || null;
}

export function activeModel(): Monaco.editor.ITextModel | null {
  return activeEditor()?.getModel() || null;
}

/** Pisca as linhas que a IA acabou de escrever, por menos de um segundo. */
export function flashLines(ed: Editor | null, startLine: number, endLine: number): void {
  const m = monaco();
  if (!ed || !m) return;
  const ids = ed.deltaDecorations([], [{
    range: new m.Range(startLine, 1, endLine, Number.MAX_SAFE_INTEGER),
    options: { isWholeLine: true, className: 'ai-edit-flash-line' },
  }]);
  setTimeout(() => ed.deltaDecorations(ids, []), 950);
}

/**
 * Magic-wand reveal for whole-file AI edits. Two layers, both soft purple:
 *   1. a shimmer band that sweeps up the editor (.ai-wand-overlay), and
 *   2. a fading purple tint over every freshly-written line
 *      (.aurora-edit-reveal) so the new text reads as being *revealed*
 *      over the old rather than abruptly swapped.
 * Purely cosmetic, guarded so it can never break the underlying write.
 */
export function magicWandReveal(ed: Editor | null | undefined): void {
  if (!ed) return;
  try {
    const editorDom = ed.getDomNode?.();
    const container = (editorDom?.closest(
      '.split-pane-editor-area, .editor-container, #monaco-editor',
    ) || editorDom?.parentElement) as HTMLElement | null | undefined;
    if (container) {
      const wand = document.createElement('div');
      wand.className = 'ai-wand-overlay';
      container.style.position = 'relative';
      container.appendChild(wand);
      wand.addEventListener('animationend', () => wand.remove(), { once: true });
    }
    const model = ed.getModel?.();
    const m = monaco();
    if (model && m) {
      const lineCount = model.getLineCount();
      const ids = ed.deltaDecorations([], [{
        range: new m.Range(1, 1, lineCount, Number.MAX_SAFE_INTEGER),
        options: { isWholeLine: true, className: 'aurora-edit-reveal' },
      }]);
      setTimeout(() => { try { ed.deltaDecorations(ids, []); } catch (_) { /* disposed */ } }, 950);
    }
  } catch (_) { /* cosmetic only */ }
}
