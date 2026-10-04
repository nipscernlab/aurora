// @vitest-environment happy-dom
//
// O namespace editor da AuroraAPI, pela API montada, que e por onde a IA le e
// escreve no editor, abre, salva, fecha e formata arquivos. Escrito contra o
// aurora_api.js antes de o namespace sair para editor_ns.ts. Erro sai como
// { ok: false, error: { message, code } } (api_core.ts).
//
// O Monaco, as abas, o editor ativo e a busca de arquivo no projeto sao
// simulados: aqui se confere o que o namespace decide, nao o que eles fazem.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const EditorManager = { getEditorForFile: vi.fn() };
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));
const TabManager = {};
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));
const electronAPI = { readFile: vi.fn(async () => 'conteudo') };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const ativo = { editor: null };
const flashLines = vi.fn();
const magicWandReveal = vi.fn();
vi.mock('../../js/api/editor_ativo.js', () => ({
  activeEditor: () => ativo.editor,
  activeModel: () => ativo.editor?.getModel() || null,
  flashLines, magicWandReveal,
}));
const acharArquivoNoProjeto = vi.fn(async (f) => {
  if (f === 'some.v') return null;
  return f.startsWith('C:/p/') ? f : `C:/p/${f}`;
});
vi.mock('../../js/api/arvore_do_projeto.js', async (orig) => ({ ...(await orig()), acharArquivoNoProjeto }));
vi.mock('../../js/api/abas_e_arvore.js', async (orig) => ({ ...(await orig()), arquivosAbertos: () => ['C:/p/a.v'] }));
const projeto = { raiz: 'C:/p' };
vi.mock('../../js/project/project_store.js', async (orig) => {
  const real = await orig();
  return { ...real, ProjectStore: { ...real.ProjectStore, getProjectPath: () => projeto.raiz } };
});

let API;
let eventos;

beforeAll(async () => {
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
  for (const nome of ['editor:new-file', 'editor:saved']) API.events.on(nome, (p) => eventos.push([nome, p]));
});

/** Um editor do Monaco de mentira, com modelo, cursor e edicoes registradas. */
function editorFalso(texto = 'linha1\nlinha2', lingua = 'verilog') {
  let valor = texto;
  const model = { getValue: () => valor, setValue: vi.fn((v) => { valor = v; }), getLanguageId: () => lingua };
  return {
    model,
    getModel: () => model,
    getPosition: vi.fn(() => ({ lineNumber: 2, column: 3 })),
    setPosition: vi.fn(), revealPositionInCenter: vi.fn(), focus: vi.fn(),
    executeEdits: vi.fn(),
    getAction: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eventos = [];
  ativo.editor = null;
  projeto.raiz = 'C:/p';
  for (const k of Object.keys(TabManager)) delete TabManager[k];
  delete window.SplitEditorManager;
});

describe('editor: ler e escrever no editor ativo', () => {
  it('sem editor ativo, tudo que mexe nele recusa', async () => {
    for (const r of [await API.editor.getActiveText(), await API.editor.setActiveText('x'),
      await API.editor.insertAt('x'), await API.editor.replaceRange({}), await API.editor.getCursor(),
      await API.editor.setCursor({ line: 1, column: 1 }), await API.editor.getLanguage()]) {
      expect(r.error.message).toBe('No active editor');
    }
  });

  it('getActiveFilePath e getOpenFiles', async () => {
    expect((await API.editor.getActiveFilePath()).data).toBeNull();
    TabManager.activeTab = 'C:/p/a.v';
    expect((await API.editor.getActiveFilePath()).data).toBe('C:/p/a.v');
    expect((await API.editor.getOpenFiles()).data).toEqual(['C:/p/a.v']);
  });

  it('getActiveText, setActiveText (com a varinha) e getLanguage', async () => {
    ativo.editor = editorFalso('abc', 'cmm');
    expect((await API.editor.getActiveText()).data).toBe('abc');
    expect((await API.editor.setActiveText(null)).ok).toBe(true);
    expect(ativo.editor.model.setValue).toHaveBeenCalledWith('');
    expect(magicWandReveal).toHaveBeenCalledWith(ativo.editor);
    expect((await API.editor.getLanguage()).data).toBe('cmm');
    ativo.editor.getModel = () => null;
    expect((await API.editor.setActiveText('x')).error.message).toBe('No active editor');
  });

  it('insertAt usa a posicao dada ou o cursor, e pisca as linhas inseridas', async () => {
    ativo.editor = editorFalso();
    await API.editor.insertAt('a\nb\nc', { line: 5, column: 1 });
    expect(ativo.editor.executeEdits).toHaveBeenCalledWith('aurora-api', [{
      range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 1 }, text: 'a\nb\nc', forceMoveMarkers: true,
    }]);
    expect(flashLines).toHaveBeenCalledWith(ativo.editor, 5, 7);
    await API.editor.insertAt(7);
    expect(ativo.editor.executeEdits.mock.calls[1][1][0]).toMatchObject({ text: '7', range: { startLineNumber: 2, startColumn: 3 } });
    ativo.editor.getPosition.mockReturnValue(null);
    expect((await API.editor.insertAt('x')).error.message).toBe('Cursor position unavailable');
  });

  it('replaceRange exige as quatro coordenadas', async () => {
    ativo.editor = editorFalso();
    expect((await API.editor.replaceRange({ startLine: 1, startColumn: 1, endLine: 2 })).error.message)
      .toBe('replaceRange requires startLine, startColumn, endLine, endColumn');
    await API.editor.replaceRange({ startLine: 1, startColumn: 1, endLine: 2, endColumn: 4, text: 'x\ny' });
    expect(ativo.editor.executeEdits.mock.calls[0][1][0].range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 4 });
    expect(flashLines).toHaveBeenCalledWith(ativo.editor, 1, 2);
  });

  it('getCursor e setCursor', async () => {
    ativo.editor = editorFalso();
    expect((await API.editor.getCursor()).data).toEqual({ line: 2, column: 3 });
    ativo.editor.getPosition.mockReturnValue(null);
    expect((await API.editor.getCursor()).error.message).toBe('Cursor unavailable');
    await API.editor.setCursor({ line: 9, column: 2 });
    expect(ativo.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 9, column: 2 });
    expect(ativo.editor.revealPositionInCenter).toHaveBeenCalledWith({ lineNumber: 9, column: 2 });
    expect(ativo.editor.focus).toHaveBeenCalled();
  });
});

describe('editor: abas', () => {
  it('newFile cria, avisa e devolve o caminho; recusa sem o gerenciador', async () => {
    expect((await API.editor.newFile()).error.message).toBe('newFile unavailable');
    TabManager.createNewFile = vi.fn(() => 'C:/p/sem_titulo.v');
    expect((await API.editor.newFile()).data).toEqual({ filePath: 'C:/p/sem_titulo.v' });
    expect(eventos).toEqual([['editor:new-file', { filePath: 'C:/p/sem_titulo.v' }]]);
    TabManager.createNewFile = vi.fn(() => { throw new Error('cheio'); });
    expect((await API.editor.newFile()).error.message).toBe('cheio');
  });

  it('save grava a aba ativa e avisa; saveAll grava todas', async () => {
    expect((await API.editor.save()).error.message).toBe('No active file');
    TabManager.activeTab = 'C:/p/a.v';
    TabManager.saveCurrentFile = vi.fn(async () => {});
    TabManager.saveAllFiles = vi.fn(async () => {});
    expect((await API.editor.save()).data).toEqual({ filePath: 'C:/p/a.v' });
    expect((await API.editor.saveAll()).ok).toBe(true);
    expect(eventos).toEqual([['editor:saved', { filePath: 'C:/p/a.v' }], ['editor:saved', { filePath: null, all: true }]]);
    TabManager.saveCurrentFile = vi.fn(async () => { throw new Error('disco'); });
    TabManager.saveAllFiles = vi.fn(async () => { throw new Error('disco2'); });
    expect((await API.editor.save()).error.message).toBe('disco');
    expect((await API.editor.saveAll()).error.message).toBe('disco2');
  });

  it('closeTab fecha a dada ou a ativa; reopenLastTab reabre', async () => {
    expect((await API.editor.closeTab()).error.message).toBe('No tab to close');
    expect((await API.editor.closeTab('C:/p/a.v')).error.message).toBe('TabManager.closeTab unavailable');
    TabManager.activeTab = 'C:/p/b.v';
    TabManager.closeTab = vi.fn(async () => {});
    expect((await API.editor.closeTab()).data).toEqual({ filePath: 'C:/p/b.v' });
    TabManager.closeTab = vi.fn(async () => { throw new Error('preso'); });
    expect((await API.editor.closeTab('x')).error.message).toBe('preso');

    expect((await API.editor.reopenLastTab()).error.message).toBe('reopen history unavailable');
    TabManager.reopenLastClosedTab = vi.fn(async () => {});
    expect((await API.editor.reopenLastTab()).ok).toBe(true);
    TabManager.reopenLastClosedTab = vi.fn(async () => { throw new Error('vazio'); });
    expect((await API.editor.reopenLastTab()).error.message).toBe('vazio');
  });
});

describe('editor: abrir arquivo e dividir', () => {
  it('openFile exige caminho e projeto, e acha o arquivo pelo nome aproximado', async () => {
    expect((await API.editor.openFile({})).error.message).toBe('filePath required');
    expect((await API.editor.openFile()).error.message).toBe('filePath required');
    projeto.raiz = '';
    expect((await API.editor.openFile({ filePath: 'a.v' })).error.message).toBe('No project open');
    projeto.raiz = 'C:/p';
    expect((await API.editor.openFile({ filePath: 'some.v' })).error.message).toMatch(/^"some.v" not found anywhere/);
    electronAPI.readFile.mockRejectedValueOnce(new Error('negado'));
    expect((await API.editor.openFile({ filePath: 'a.v' })).error.message).toBe('Found "C:/p/a.v" but could not read it: negado');
  });

  it('openFile vai para o painel em foco, para um painel novo, ou para a barra principal', async () => {
    TabManager.addTab = vi.fn();
    expect((await API.editor.openFile({ filePath: 'a.v' })).data).toEqual({ filePath: 'C:/p/a.v' });
    expect(TabManager.addTab).toHaveBeenCalledWith('C:/p/a.v', 'conteudo');

    window.SplitEditorManager = { openInFocusedPane: vi.fn(async () => {}), createSplit: vi.fn(async () => {}) };
    await API.editor.openFile({ filePath: 'b.v' });
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalledWith('C:/p/b.v', 'conteudo');
    expect(window.SplitEditorManager.createSplit).not.toHaveBeenCalled();
    await API.editor.openFile({ filePath: 'c.v', inNewSplit: true });
    expect(window.SplitEditorManager.createSplit).toHaveBeenCalled();
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenLastCalledWith('C:/p/c.v', 'conteudo');

    window.SplitEditorManager.openInFocusedPane = vi.fn(async () => { throw new Error('painel'); });
    expect((await API.editor.openFile({ filePath: 'd.v' })).error.message).toBe('painel');
  });

  it('createSplit pede ao editor dividido', async () => {
    expect((await API.editor.createSplit()).error.message).toBe('SplitEditorManager unavailable');
    window.SplitEditorManager = { createSplit: vi.fn(async () => {}) };
    expect((await API.editor.createSplit()).ok).toBe(true);
    window.SplitEditorManager.createSplit = vi.fn(async () => { throw new Error('x'); });
    expect((await API.editor.createSplit()).error.message).toBe('x');
  });
});

describe('editor: formatFile', () => {
  /** Um editor aberto para o arquivo, com a acao de formatar. */
  function comFormatador({ suportado = true, formata = (v) => `${v}!`, lingua = 'verilog' } = {}) {
    const ed = editorFalso('x', lingua);
    const action = {
      isSupported: vi.fn(() => { if (suportado === 'explode') throw new Error('?'); return suportado; }),
      run: vi.fn(async () => { ed.model.setValue(formata(ed.model.getValue())); }),
    };
    ed.getAction.mockReturnValue(action);
    EditorManager.getEditorForFile.mockReturnValue(ed);
    return { ed, action };
  }

  it('sem arquivo e sem aba ativa recusa; caminho dado precisa existir no projeto', async () => {
    expect((await API.editor.formatFile()).error.message).toBe('No file given and no active file');
    expect((await API.editor.formatFile({ filePath: 'some.v' })).error.message).toBe('"some.v" not found anywhere in the project.');
  });

  it('formata, salva e avisa; arquivo ja formatado nao e salvo', async () => {
    TabManager.saveFile = vi.fn(async () => {});
    comFormatador();
    expect((await API.editor.formatFile({ filePath: 'a.v' })).data).toEqual({ filePath: 'C:/p/a.v', changed: true, language: 'verilog' });
    expect(TabManager.saveFile).toHaveBeenCalledWith('C:/p/a.v');
    expect(eventos).toEqual([['editor:saved', { filePath: 'C:/p/a.v' }]]);

    TabManager.activeTab = 'C:/p/b.v';
    comFormatador({ formata: (v) => v });
    expect((await API.editor.formatFile()).data).toEqual({ filePath: 'C:/p/b.v', changed: false, message: 'Already formatted' });
    expect(TabManager.saveFile).toHaveBeenCalledTimes(1);
  });

  it('sem formatador para a lingua, ou com a acao quebrando, diz o porque', async () => {
    TabManager.activeTab = 'C:/p/a.txt';
    comFormatador({ suportado: false, lingua: 'plaintext' });
    expect((await API.editor.formatFile()).error.message).toMatch(/^No formatter is registered for "plaintext"/);
    comFormatador({ suportado: 'explode' });
    expect((await API.editor.formatFile()).error.message).toMatch(/^No formatter is registered/);
    const { action } = comFormatador();
    action.run.mockRejectedValueOnce(new Error('clang'));
    expect((await API.editor.formatFile()).error.message).toBe('clang');
    const { ed } = comFormatador();
    ed.getAction.mockReturnValue(null);
    expect((await API.editor.formatFile()).error.message).toBe('Format action unavailable');
  });

  it('formatou mas nao salvou: diz isso', async () => {
    TabManager.activeTab = 'C:/p/a.v';
    TabManager.saveFile = vi.fn(async () => { throw new Error('travado'); });
    comFormatador();
    expect((await API.editor.formatFile()).error.message).toBe('Formatted the buffer but could not save: travado');
  });

  it('arquivo fechado: abre antes de formatar, e devolve a recusa da abertura', async () => {
    TabManager.addTab = vi.fn();
    TabManager.saveFile = vi.fn(async () => {});
    const { ed } = comFormatador();
    EditorManager.getEditorForFile.mockReturnValueOnce(null).mockReturnValueOnce(ed);
    expect((await API.editor.formatFile({ filePath: 'a.v' })).data.changed).toBe(true);
    expect(TabManager.addTab).toHaveBeenCalledWith('C:/p/a.v', 'conteudo');

    EditorManager.getEditorForFile.mockReturnValue(null);
    projeto.raiz = '';
    TabManager.activeTab = 'C:/p/z.v';
    expect((await API.editor.formatFile()).error.message).toBe('No project open');
    projeto.raiz = 'C:/p';
    expect((await API.editor.formatFile()).error.message).toBe('Could not open an editor for "C:/p/z.v"');
  });
});
