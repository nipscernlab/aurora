// @vitest-environment happy-dom
//
// O editor em foco e os efeitos visuais da API (js/api/editor_ativo): o
// piscar das linhas e a varinha. Tudo cosmetico, entao o que se confere e que
// aparece quando pode e que nunca quebra quando nao pode.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const EditorManager = { activeEditor: null };
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));

let m;

class Range { constructor(...a) { this.a = a; } }

function editorFalso({ comDom = true, linhas = 3 } = {}) {
  const area = document.createElement('div');
  area.className = 'editor-container';
  const dom = document.createElement('div');
  area.appendChild(dom);
  document.body.appendChild(area);
  const decoracoes = [];
  return {
    area,
    decoracoes,
    getDomNode: () => (comDom ? dom : null),
    getModel: () => ({ getLineCount: () => linhas }),
    deltaDecorations: vi.fn((velhas, novas) => { decoracoes.push({ velhas, novas }); return ['id1']; }),
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  EditorManager.activeEditor = null;
  window.monaco = { Range };
  m = await import('../../js/api/editor_ativo.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monaco;
});

describe('editor ativo', () => {
  it('sem editor em foco, nulos', () => {
    expect(m.activeEditor()).toBeNull();
    expect(m.activeModel()).toBeNull();
  });

  it('com editor em foco, ele e o modelo dele', () => {
    const ed = editorFalso();
    EditorManager.activeEditor = ed;
    expect(m.activeEditor()).toBe(ed);
    expect(m.activeModel().getLineCount()).toBe(3);
  });
});

describe('efeitos', () => {
  it('piscar marca as linhas e tira depois', () => {
    const ed = editorFalso();
    m.flashLines(ed, 2, 4);
    expect(ed.decoracoes[0].novas[0].range.a).toEqual([2, 1, 4, Number.MAX_SAFE_INTEGER]);
    expect(ed.decoracoes[0].novas[0].options.className).toBe('ai-edit-flash-line');
    vi.advanceTimersByTime(1000);
    expect(ed.decoracoes[1]).toEqual({ velhas: ['id1'], novas: [] });
  });

  it('piscar sem editor ou sem Monaco nao faz nada', () => {
    const ed = editorFalso();
    delete window.monaco;
    m.flashLines(ed, 1, 1);
    m.flashLines(null, 1, 1);
    expect(ed.deltaDecorations).not.toHaveBeenCalled();
  });

  it('a varinha poe a faixa no container, que some no fim da animacao, e tinge o arquivo', () => {
    const ed = editorFalso({ linhas: 7 });
    m.magicWandReveal(ed);
    const faixa = ed.area.querySelector('.ai-wand-overlay');
    expect(faixa).not.toBeNull();
    expect(ed.area.style.position).toBe('relative');
    faixa.dispatchEvent(new Event('animationend'));
    expect(ed.area.querySelector('.ai-wand-overlay')).toBeNull();
    expect(ed.decoracoes[0].novas[0].range.a).toEqual([1, 1, 7, Number.MAX_SAFE_INTEGER]);
    ed.deltaDecorations.mockImplementationOnce(() => { throw new Error('descartado'); });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it('a varinha sem DOM, sem Monaco, sem editor, ou com um editor que lanca, nao quebra', () => {
    const ed = editorFalso({ comDom: false });
    delete window.monaco;
    m.magicWandReveal(ed);
    expect(ed.deltaDecorations).not.toHaveBeenCalled();
    m.magicWandReveal(null);
    expect(() => m.magicWandReveal({ getDomNode: () => { throw new Error('x'); } })).not.toThrow();
  });
});
