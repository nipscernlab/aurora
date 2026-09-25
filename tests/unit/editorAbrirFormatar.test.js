// @vitest-environment happy-dom
//
// AuroraAPI.editor.openFile e formatFile, e project.readFile, com o arquivo
// dado pelo nome aproximado que a IA usa. Montado como no auroraApiMontagem:
// os quatro modulos que sobem a interface sao falsos.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const editores = new Map();
const EditorManager = { getEditorForFile: vi.fn((p) => editores.get(p) ?? null) };
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));
const TabManager = { activeTab: null, addTab: vi.fn(), saveFile: vi.fn(async () => {}) };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const modelos = new Map();
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: { getModel: (p) => modelos.get(p) ?? null } }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));

const arquivos = new Map([['C:\\p\\top.v', 'module top;endmodule'], ['C:\\p\\P\\Software\\P.cmm', 'void main(){}']]);
const electronAPI = {
  readFile: vi.fn(async (p) => { if (!arquivos.has(p)) throw new Error('ENOENT'); return arquivos.get(p); }),
  getFolderFiles: vi.fn(async (d) => {
    if (d === 'C:\\p') return [{ path: 'C:\\p\\top.v' }, { path: 'C:\\p\\P', isDirectory: true }];
    if (d === 'C:\\p\\P') return [{ path: 'C:\\p\\P\\Software', isDirectory: true }];
    if (d === 'C:\\p\\P\\Software') return [{ path: 'C:\\p\\P\\Software\\P.cmm' }];
    return [];
  }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

let API;
let ProjectStore;
const msg = (r) => r.error?.message;

/** Um editor com modelo e a acao de formatar, que troca o texto por `depois`. */
function editorCom(texto, { depois = texto, suporta = true, lingua = 'verilog' } = {}) {
  let valor = texto;
  return {
    getModel: () => ({ getValue: () => valor, getLanguageId: () => lingua }),
    getAction: vi.fn(() => ({ isSupported: () => suporta, run: vi.fn(async () => { valor = depois; }) })),
  };
}

beforeAll(async () => {
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

beforeEach(() => {
  vi.clearAllMocks();
  editores.clear();
  modelos.clear();
  TabManager.activeTab = null;
  delete window.SplitEditorManager;
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

describe('editor.openFile', () => {
  it('acha pelo nome em qualquer pasta e abre no painel em foco', async () => {
    const sem = { openInFocusedPane: vi.fn(async () => {}), createSplit: vi.fn(async () => {}) };
    window.SplitEditorManager = sem;
    const r = await API.editor.openFile({ filePath: 'p.cmm' });
    expect(r.data).toEqual({ filePath: 'C:\\p\\P\\Software\\P.cmm' });
    expect(sem.openInFocusedPane).toHaveBeenCalledWith('C:\\p\\P\\Software\\P.cmm', 'void main(){}');
    await API.editor.openFile({ filePath: 'top.v', inNewSplit: true });
    expect(sem.createSplit).toHaveBeenCalled();
  });

  it('sem editor dividido, abre como aba', async () => {
    await API.editor.openFile({ filePath: 'top.v' });
    expect(TabManager.addTab).toHaveBeenCalledWith('C:\\p\\top.v', 'module top;endmodule');
  });

  it('recusa sem caminho, sem projeto, ou arquivo que nao existe', async () => {
    expect(msg(await API.editor.openFile())).toBe('filePath required');
    expect(msg(await API.editor.openFile({ filePath: 'sumiu.v' }))).toMatch(/not found anywhere/);
    ProjectStore.clearProject();
    expect(msg(await API.editor.openFile({ filePath: 'top.v' }))).toBe('No project open');
  });
});

describe('editor.formatFile', () => {
  it('arquivo fechado: abre, formata e salva', async () => {
    const ed = editorCom('module  top;', { depois: 'module top;' });
    window.SplitEditorManager = { openInFocusedPane: vi.fn(async (p) => { editores.set(p, ed); }) };
    const r = await API.editor.formatFile({ filePath: 'top.v' });
    expect(r.data).toEqual({ filePath: 'C:\\p\\top.v', changed: true, language: 'verilog' });
    expect(TabManager.saveFile).toHaveBeenCalledWith('C:\\p\\top.v');
  });

  it('arquivo aberto e ja formatado: nada muda', async () => {
    editores.set('C:\\p\\top.v', editorCom('module top;'));
    const r = await API.editor.formatFile({ filePath: 'top.v' });
    expect(r.data).toEqual({ filePath: 'C:\\p\\top.v', changed: false, message: 'Already formatted' });
  });

  it('sem caminho, formata a aba ativa', async () => {
    TabManager.activeTab = 'C:\\p\\top.v';
    editores.set('C:\\p\\top.v', editorCom('x', { depois: 'y' }));
    expect((await API.editor.formatFile()).data.changed).toBe(true);
  });

  it('as recusas: nada dado, arquivo que nao existe, abrir que falha, sem formatador', async () => {
    expect(msg(await API.editor.formatFile())).toBe('No file given and no active file');
    expect(msg(await API.editor.formatFile({ filePath: 'sumiu.v' }))).toMatch(/not found anywhere/);
    window.SplitEditorManager = { openInFocusedPane: vi.fn(async () => { throw new Error('painel morto'); }) };
    expect(msg(await API.editor.formatFile({ filePath: 'top.v' }))).toBe('painel morto');
    delete window.SplitEditorManager;
    editores.set('C:\\p\\top.v', editorCom('x', { suporta: false, lingua: 'plaintext' }));
    expect(msg(await API.editor.formatFile({ filePath: 'top.v' }))).toMatch(/No formatter is registered for "plaintext"/);
  });
});

describe('project.readFile', () => {
  it('le pelo caminho dado, ou acha pelo nome quando o caminho erra', async () => {
    expect((await API.project.readFile('top.v')).data).toMatchObject({ filePath: 'C:\\p\\top.v', content: 'module top;endmodule' });
    expect((await API.project.readFile('Software/P.cmm')).data.filePath).toBe('C:\\p\\P\\Software\\P.cmm');
    expect(msg(await API.project.readFile('sumiu.v'))).toMatch(/File not found/);
  });

  it('o arquivo aberto no editor vem do buffer, com o que ainda nao foi salvo', async () => {
    modelos.set('C:\\p\\top.v', { getValue: () => 'editado' });
    expect((await API.project.readFile('top.v')).data).toMatchObject({ content: 'editado', fromEditor: true });
  });
});
