// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
//
// js/tabs/tab_manager: salvar. O arquivo aberto, todos de uma vez, o
// documento sem nome (que detecta o tipo, expande o atalho $cmm e na hora de
// salvar pede o nome e entra no projeto) e o arquivo novo pelo dialogo.
//
// Caracterizacao escrita antes de o modulo virar .ts, contra o .js antigo,
// sobre o mesmo mundo falso de tests/helpers/abasFalsas.js.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = await vi.hoisted(async () => (await import('../helpers/abasFalsas.js')).criarMundo());

vi.mock('../../js/components/aurora-tabs.js', () => ({}));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: m.editores }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: m.showCardNotification }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog: m.showDialog }));
vi.mock('../../js/project/project_store.js', () => ({ ProjectStore: m.ProjectStore }));
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: m.SpfStore }));
vi.mock('../../js/project/processor_list.js', () => ({ addAvailableProcessor: m.addAvailableProcessor }));

import { TabManager } from '../../js/tabs/tab_manager.js';
import { editorFalso, modeloFalso } from '../helpers/abasFalsas.js';

const A = 'C:/p/a.v';
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const escritas = () => m.chamadas.filter((c) => c[0] === 'writeFile').map((c) => c.slice(1));

/** O monaco global que o TabManager usa sem importar. */
function monacoFalso() {
  const mon = { editor: { setModelLanguage: vi.fn() } };
  window.monaco = mon;
  globalThis.monaco = mon;
  return mon;
}

/** Um registro de modelos compartilhados de mentira. */
function registro(modelos = {}, sujos = new Set()) {
  const r = {
    modelos: new Map(Object.entries(modelos)),
    sujos,
    getModel: (p) => r.modelos.get(p),
    has: (p) => r.modelos.has(p),
    isDirty: (p) => r.sujos.has(p),
    markSaved: vi.fn((p) => r.sujos.delete(p)),
    release: vi.fn(),
  };
  window.SharedModelRegistry = r;
  return r;
}

beforeEach(() => {
  m.zerar(TabManager);
  delete globalThis.monaco;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => m.zerar(TabManager));

describe('documento sem nome', () => {
  it('Untitled-N pula os nomes em uso, abre focado no painel principal e ja nasce sujo', async () => {
    window.SplitEditorManager = { setFocus: vi.fn() };
    TabManager.tabs.set('Untitled-1', '');
    const p = TabManager.createNewFile();
    await tick();
    expect(p).toBe('Untitled-2');
    expect(TabManager.untitledCounter).toBe(2);
    expect(TabManager.isUntitledPath(p)).toBe(true);
    expect(window.SplitEditorManager.setFocus).toHaveBeenCalledWith(0);
    expect(TabManager.unsavedChanges.has(p)).toBe(true);
    expect(document.querySelector(`.tab[data-path="${p}"]`).title).toBe('Untitled-2');
  });

  it('o tipo e detectado do texto: muda a linguagem do modelo e o nome da aba', async () => {
    const mon = monacoFalso();
    const p = TabManager.createNewFile();
    await tick();
    const barra = document.createElement('div');
    barra.id = 'context-path';
    document.body.appendChild(barra);

    expect(TabManager.updateUntitledDocumentType(p, 'module m; endmodule')).toBe('verilog');
    expect(mon.editor.setModelLanguage).toHaveBeenCalledWith(m.editores.getEditorForFile(p).getModel(), 'verilog');
    expect(document.querySelector(`.tab[data-path="${p}"] .tab-name`).textContent).toBe(`${p}.v`);
    expect(barra.querySelector('.context-path-filename').textContent).toBe(`${p}.v`);
    // Mesmo tipo: nada muda.
    mon.editor.setModelLanguage.mockClear();
    expect(TabManager.updateUntitledDocumentType(p, 'module n; endmodule')).toBe('verilog');
    expect(mon.editor.setModelLanguage).not.toHaveBeenCalled();

    // Pelo registro compartilhado, e sem modelo nenhum.
    const modelo = modeloFalso();
    registro({ [p]: modelo });
    TabManager.updateUntitledDocumentType(p, 'import cocotb');
    expect(mon.editor.setModelLanguage).toHaveBeenLastCalledWith(modelo, 'python');
    window.SharedModelRegistry.modelos.clear();
    m.editores.porArquivo.clear();
    TabManager.updateUntitledDocumentType(p, '#PRNAME x');
  });

  it('nao e sem nome, ou sem monaco: nao detecta', () => {
    expect(TabManager.updateUntitledDocumentType(A, 'x')).toBeNull();
    TabManager.untitledDocuments.set('Untitled-9', { detectedType: null });
    expect(TabManager.updateUntitledDocumentType('Untitled-9', 'x')).toBeNull();
  });

  it('digitar $cmm vira o molde de processador C+-, uma vez so', async () => {
    const mon = monacoFalso();
    const p = TabManager.createNewFile();
    await tick();
    const e = m.editores.getEditorForFile(p);
    TabManager.unsavedChanges.clear();
    e.setValue('  $cmm ');
    expect(e.getValue()).toMatch(/#PRNAME processor/);
    expect(TabManager.untitledDocuments.get(p)).toMatchObject({ detectedType: 'cmm', snippetApplied: true });
    expect(mon.editor.setModelLanguage).toHaveBeenCalledWith(e.getModel(), 'cmm');
    expect(e.posicao).toEqual({ lineNumber: 13, column: 5 });
    expect(TabManager.unsavedChanges.has(p)).toBe(true);

    e.modelo.texto = '$cmm';
    expect(TabManager.expandUntitledSnippet(p, e)).toBe(false);
  });

  it('o atalho nao se aplica: sem nome nao, sem editor, durante a propria troca, outro texto, sem modelo', () => {
    const e = editorFalso('Untitled-1', '$cmm');
    expect(TabManager.expandUntitledSnippet(A, e)).toBe(false);
    TabManager.untitledDocuments.set('Untitled-1', { detectedType: null });
    expect(TabManager.expandUntitledSnippet('Untitled-1', null)).toBe(false);
    TabManager.applyingSnippet.add('Untitled-1');
    expect(TabManager.expandUntitledSnippet('Untitled-1', e)).toBe(false);
    TabManager.applyingSnippet.clear();
    e.modelo.texto = 'outro';
    expect(TabManager.expandUntitledSnippet('Untitled-1', e)).toBe(false);
    e.modelo.texto = '$cmm';
    e.getModel = () => null;
    expect(TabManager.expandUntitledSnippet('Untitled-1', e)).toBe(true);
  });

  it('editar um sem nome que nao e o atalho: detecta o tipo, suja e promove a previa', async () => {
    monacoFalso();
    TabManager.untitledDocuments.set('Untitled-3', { detectedType: null });
    TabManager.addTab('Untitled-3', '', { preview: true });
    await tick();
    m.editores.getEditorForFile('Untitled-3').setValue('module m; endmodule');
    expect(TabManager.untitledDocuments.get('Untitled-3').detectedType).toBe('verilog');
    expect(TabManager.previewTab).toBeNull();
    TabManager.unsavedChanges.clear();
    m.editores.getEditorForFile('Untitled-3').setValue('module n; endmodule');
    expect(TabManager.unsavedChanges.has('Untitled-3')).toBe(true);
  });

  it('a apresentacao da aba nao mexe no caminho quando o sem nome nao e o ativo', () => {
    TabManager.untitledDocuments.set('Untitled-4', { detectedType: 'python' });
    const aba = document.createElement('div');
    aba.className = 'tab';
    aba.dataset.path = 'Untitled-4';
    document.body.appendChild(aba);
    const caminho = vi.spyOn(TabManager, 'updateContextPath');
    TabManager.updateUntitledTabPresentation('Untitled-4');
    expect(aba.title).toBe('Untitled-4.py');
    expect(caminho).not.toHaveBeenCalled();
    aba.remove();
  });
});

describe('sobrescrever', () => {
  it('arquivo que nao existe, ou que nao da para conferir: pode; existente pergunta', async () => {
    expect(await TabManager.confirmOverwrite(A)).toBe(true);
    m.ponte.fileExists = async () => { throw new Error('x'); };
    expect(await TabManager.confirmOverwrite(A)).toBe(true);
    m.ponte.fileExists = async () => true;
    window.t = (k, p) => (p ? `${k}:${p.name}` : k);
    expect(await TabManager.confirmOverwrite(A)).toBe(false);
    expect(m.dialogo.pedidos[0].message).toBe('dialog.overwriteFile.message:a.v');
    m.dialogo.resposta = 'overwrite';
    delete window.t;
    expect(await TabManager.confirmOverwrite(A)).toBe(true);
    m.ponte.fileExists = async () => false;
  });
});

describe('salvar o sem nome', () => {
  async function semNome(texto) {
    const p = TabManager.createNewFile();
    await tick();
    m.editores.getEditorForFile(p).modelo.texto = texto;
    return p;
  }

  it('Verilog no projeto: pede o nome, grava, entra no .spf e a aba vira a do arquivo', async () => {
    m.projeto.caminho = 'C:/p';
    m.projeto.spf = 'C:/p/p.spf';
    m.spf.estrutura = { synthesizableFiles: [{ path: 'C:/p/top.v' }], testbenchFiles: 'x' };
    m.ponte.getFileStats = async () => ({ mtime: 77 });
    const p = await semNome('module top(input a); endmodule');
    m.ponte.showSaveDialog = vi.fn(async () => ({ filePath: 'C:/p/top' }));

    expect(await TabManager.saveFile(p)).toBe(true);

    expect(m.ponte.showSaveDialog.mock.calls[0][0].defaultPath).toBe('C:/p/untitled.v');
    expect(escritas()).toEqual([['C:/p/top.v', 'module top(input a); endmodule']]);
    // Ja estava na sintese: salvar por cima nao mexe na entrada (TODO 13b).
    expect(m.spf.estrutura.synthesizableFiles).toEqual([{ path: 'C:/p/top.v' }]);
    expect(m.spf.estrutura.testbenchFiles).toBe('x');
    expect(TabManager.tabs.has(p)).toBe(false);
    expect(TabManager.untitledDocuments.has(p)).toBe(false);
    expect(TabManager.tabs.get('C:/p/top.v')).toBe('module top(input a); endmodule');
    expect(TabManager.lastModifiedTimes.get('C:/p/top.v')).toBe(77);
    expect(m.chamadas).toContainEqual(['refresh']);
    m.ponte.getFileStats = async () => ({ mtime: 1000 });
  });

  it('nome invalido: avisa e pergunta de novo com a sugestao; cancelar desiste', async () => {
    const p = await semNome('import cocotb');
    const respostas = [{ filePath: 'C:/x/meu teste.py' }, { canceled: true }];
    m.ponte.showSaveDialog = vi.fn(async () => respostas.shift());
    window.showNotification = vi.fn();
    expect(await TabManager.saveUntitledFile(p)).toBe(false);
    expect(window.showNotification).toHaveBeenCalledWith(expect.stringContaining('meu teste.py'), 'warning', 4000);
    expect(m.ponte.showSaveDialog.mock.calls[0][0].defaultPath).toBe('test_dut.py');
    expect(m.ponte.showSaveDialog.mock.calls[1][0].defaultPath).toBe('meu_teste.py');

    window.t = (k) => `[${k}]`;
    delete window.showNotification;
    const r2 = [{ filePath: 'C:/x/a b.py' }, { filePath: '' }];
    m.ponte.showSaveDialog = async () => r2.shift();
    await TabManager.saveUntitledFile(p);
    expect(m.avisos.at(-1)).toEqual(['[notification.tree.invalidName]', 'warning']);
    expect(m.ponte.showSaveDialog).toBeDefined();
  });

  it('Python vai para os testbenches; arquivo de outro tipo nao entra no .spf', async () => {
    m.projeto.spf = 'C:/p/p.spf';
    m.spf.estrutura = {};
    const p = await semNome('import cocotb');
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/p/t.py' });
    m.ponte.getFileStats = async () => { throw new Error('x'); };
    expect(await TabManager.saveUntitledFile(p)).toBe(true);
    expect(m.spf.estrutura.testbenchFiles).toEqual([{ name: 't.py', path: 'C:/p/t.py', isTopLevel: false }]);
    expect(m.chamadas).not.toContainEqual(['refresh']);

    m.spf.escritas = 0;
    await TabManager.registerSavedProjectFile('C:/p/notas.txt', '');
    m.projeto.spf = null;
    await TabManager.registerSavedProjectFile('C:/p/x.v', '');
    expect(m.spf.escritas).toBe(0);
    m.ponte.getFileStats = async () => ({ mtime: 1000 });
  });

  it('Verilog salvo entra sem papel; ja listado fica onde estava, com o papel que tinha (TODO 13b)', async () => {
    m.projeto.spf = 'C:/p/p.spf';
    m.spf.estrutura = { synthesizableFiles: [{ path: 'C:/p/a.v' }, { path: 'C:/P/TB.V' }, { path: 'C:/p/z.v' }] };
    // Parece testbench pelo conteudo, mas o papel nao vem mais do conteudo:
    // continua na sintese, no mesmo lugar.
    await TabManager.registerSavedProjectFile('C:/p/tb.v', 'module tb; initial begin $dumpvars; $finish; end endmodule');
    expect(m.spf.estrutura.synthesizableFiles).toEqual([{ path: 'C:/p/a.v' }, { path: 'C:/P/TB.V' }, { path: 'C:/p/z.v' }]);
    await TabManager.registerSavedProjectFile('C:/p/novo.v', 'module novo(input a); endmodule');
    expect(m.spf.estrutura.unclassifiedFiles).toEqual([{ name: 'novo.v', path: 'C:/p/novo.v', isTopLevel: false }]);
  });

  it('C+- no projeto: cria as pastas do processador, grava o .cmm com o #PRNAME e registra', async () => {
    m.projeto.caminho = 'C:/p';
    m.projeto.spf = 'C:/p/p.spf';
    m.spf.estrutura = { processors: ['OUTRO'] };
    const p = await semNome('#PRNAME velho\nint main() {}');
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/p/cpu.cmm' });
    expect(await TabManager.saveUntitledFile(p)).toBe(true);
    expect(m.chamadas.filter((c) => c[0] === 'mkdir').map((c) => c[1])).toEqual([
      'C:/p/cpu/Software', 'C:/p/cpu/Hardware', 'C:/p/cpu/Simulation',
    ]);
    expect(escritas()[0][0]).toBe('C:/p/cpu/Software/cpu.cmm');
    expect(escritas()[0][1]).toMatch(/#PRNAME cpu/);
    expect(m.spf.estrutura.processors).toEqual(['OUTRO', { name: 'cpu' }]);
    expect(m.processadores).toEqual(['cpu']);
    expect(TabManager.tabs.has('C:/p/cpu/Software/cpu.cmm')).toBe(true);

    // Ja registrado: nao duplica.
    await TabManager.registerProcessor('CPU');
    expect(m.spf.estrutura.processors).toHaveLength(2);
    m.spf.estrutura = { processors: 'x' };
    await TabManager.registerProcessor('dsp');
    expect(m.spf.estrutura.processors).toEqual([{ name: 'dsp' }]);
    m.spf.escritas = 0;
    await TabManager.registerProcessor('');
    m.projeto.spf = null;
    await TabManager.registerProcessor('x');
    expect(m.spf.escritas).toBe(0);
  });

  it('C+- sem projeto: grava onde a pessoa escolheu; recusar sobrescrever desiste', async () => {
    const p = await semNome('#PRNAME x');
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/solto/cpu.cmm' });
    m.ponte.fileExists = async () => true;
    expect(await TabManager.saveUntitledFile(p)).toBe(false);
    m.dialogo.resposta = 'overwrite';
    expect(await TabManager.saveUntitledFile(p)).toBe(true);
    expect(escritas()[0][0]).toBe('C:/solto/cpu.cmm');

    m.projeto.caminho = 'C:/p';
    m.dialogo.resposta = 'cancel';
    expect(await TabManager.saveCmmProcessorFile('C:/p/dsp.cmm', '')).toBeNull();
    m.ponte.fileExists = async () => false;
  });

  it('sem modelo nao salva', async () => {
    TabManager.untitledDocuments.set('Untitled-7', {});
    expect(await TabManager.saveUntitledFile('Untitled-7')).toBe(false);
  });

  it('o refresh da arvore que falha nao estraga o salvar', async () => {
    m.projeto.caminho = 'C:/p';
    const p = await semNome('module m; endmodule');
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/p/m.v' });
    m.ponte.triggerFileTreeRefresh = async () => { throw new Error('x'); };
    expect(await TabManager.saveUntitledFile(p)).toBe(true);
    m.ponte.triggerFileTreeRefresh = async () => { m.chamadas.push(['refresh']); };
  });
});

describe('trocar a aba sem nome pela salva', () => {
  it('nos paineis divididos tambem: abre o salvo, descarta o sem nome, ativa o salvo onde o sem nome era ativo', async () => {
    const p = TabManager.createNewFile();
    await tick();
    const editorDoPainel = { dispose: vi.fn() };
    const div = document.createElement('div');
    const elemento = document.createElement('div');
    elemento.innerHTML = `<div class="split-tab" data-path="${p}"></div>`;
    const painel = {
      tabs: new Map([[p, { editor: editorDoPainel, editorDiv: div }]]),
      activeFile: p,
      element: elemento,
      openFile: vi.fn(async (sp) => { painel.tabs.set(sp, {}); }),
      _activateFile: vi.fn(),
    };
    const quebrado = {
      tabs: new Map([[p, { editor: { dispose: () => { throw new Error('x'); } } }]]),
      activeFile: 'outro',
      openFile: vi.fn(async () => {}),
    };
    window.SplitEditorManager = { panes: [painel, null, quebrado] };
    const salvo = modeloFalso('velho');
    const reg = registro({ 'C:/p/s.v': salvo });
    reg.modelos.set(p, modeloFalso());

    await TabManager.replaceUntitledWithSavedFile(p, 'C:/p/s.v', 'novo');
    await tick();

    expect(salvo.texto).toBe('novo');
    expect(reg.markSaved).toHaveBeenCalledWith('C:/p/s.v');
    expect(painel.openFile).toHaveBeenCalledWith('C:/p/s.v', 'novo');
    expect(editorDoPainel.dispose).toHaveBeenCalled();
    expect(painel.tabs.has(p)).toBe(false);
    expect(elemento.querySelector('.split-tab')).toBeNull();
    expect(painel._activateFile).toHaveBeenCalledWith('C:/p/s.v');
    expect(reg.release).toHaveBeenCalledWith(p);
    // O registro ainda tem o modelo sem nome: o documento fica registrado.
    expect(TabManager.untitledDocuments.has(p)).toBe(true);
    // Achado, registrado como esta: o salvo ja tinha modelo (aberto so no
    // painel dividido), entao entrou no mapa de abas do painel principal sem
    // aba no DOM, e o activateTab nao acha o que ativar. O activeTab fica no
    // sem nome que ja saiu. Anotado no TODO.
    expect(TabManager.tabs.has('C:/p/s.v')).toBe(true);
    expect(document.querySelector('.tab[data-path="C:/p/s.v"]')).toBeNull();
    expect(TabManager.activeTab).toBe(p);
  });

  it('sem aba no painel principal: so os paineis; com a aba salva ja aberta, so ativa', async () => {
    TabManager.untitledDocuments.set('Untitled-5', {});
    await TabManager.replaceUntitledWithSavedFile('Untitled-5', 'C:/p/x.v', 'x');
    expect(TabManager.tabs.has('C:/p/x.v')).toBe(false);

    TabManager.addTab('C:/p/x.v', 'x');
    await tick();
    const p = TabManager.createNewFile();
    await tick();
    TabManager.previewTab = p;
    await TabManager.replaceUntitledWithSavedFile(p, 'C:/p/x.v', 'x');
    expect(TabManager.activeTab).toBe('C:/p/x.v');
    expect(TabManager.previewTab).toBeNull();
  });
});

describe('arquivo novo pelo dialogo', () => {
  it('sem extensao vira Verilog vazio; grava, entra no projeto, abre e avisa', async () => {
    m.projeto.caminho = 'C:/p';
    m.projeto.spf = 'C:/p/p.spf';
    m.ponte.showSaveDialog = vi.fn(async () => ({ filePath: 'C:/p/novo' }));
    expect(await TabManager.createNewFileFromDialog()).toBe(true);
    expect(m.ponte.showSaveDialog.mock.calls[0][0].defaultPath).toBe('C:/p/untitled.v');
    expect(escritas()).toEqual([['C:/p/novo.v', '']]);
    expect(TabManager.tabs.has('C:/p/novo.v')).toBe(true);
    expect(m.avisos.at(-1)).toEqual(['Created "novo.v" successfully', 'success']);

    window.t = (k) => `[${k}]`;
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/p/t.py' });
    m.ponte.triggerFileTreeRefresh = async () => { throw new Error('x'); };
    await TabManager.createNewFileFromDialog();
    expect(escritas().at(-1)[1]).toMatch(/import cocotb/);
    expect(m.avisos.at(-1)).toEqual(['[notification.tree.created]', 'success']);
    m.ponte.triggerFileTreeRefresh = async () => { m.chamadas.push(['refresh']); };
  });

  it('C+- cria o processador; nome invalido, cancelar e recusar sobrescrever desistem', async () => {
    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/x/cpu.cmm' });
    expect(await TabManager.createNewFileFromDialog()).toBe(true);
    expect(escritas()[0]).toEqual(['C:/x/cpu.cmm', expect.stringContaining('#PRNAME cpu')]);
    expect(m.ponte.showSaveDialog).toBeDefined();

    m.ponte.fileExists = async () => true;
    expect(await TabManager.createNewFileFromDialog()).toBe(false);
    m.ponte.fileExists = async () => false;

    m.ponte.showSaveDialog = async () => ({ filePath: 'C:/x/meu arquivo.v' });
    expect(await TabManager.createNewFileFromDialog()).toBe(false);
    expect(m.avisos.at(-1)[1]).toBe('warning');
    window.t = (k) => `[${k}]`;
    expect(await TabManager.createNewFileFromDialog()).toBe(false);
    expect(m.avisos.at(-1)).toEqual(['[notification.tree.invalidName]', 'warning']);

    m.ponte.showSaveDialog = async () => ({ canceled: true });
    expect(await TabManager.createNewFileFromDialog()).toBe(false);
  });

  it('o conteudo inicial por tipo', () => {
    expect(TabManager.initialContentForType('cmm', 'C:/x/meu-proc.cmm')).toMatch(/#PRNAME meu-proc/);
    expect(TabManager.initialContentForType('python', 'x.py')).toMatch(/@cocotb.test\(\)/);
    expect(TabManager.initialContentForType('verilog', 'x.v')).toBe('');
  });

  it('o alvo do processador: com projeto, as quatro pastas; sem, o proprio caminho', async () => {
    expect(await TabManager.getProcessorCmmTarget('C:/x/meu proc.cmm')).toEqual({
      processorName: 'meu_proc', cmmPath: 'C:/x/meu proc.cmm', projectPath: null,
    });
    m.projeto.caminho = 'C:/p';
    expect(await TabManager.getProcessorCmmTarget('C:/x/cpu.cmm')).toEqual({
      processorName: 'cpu', processorPath: 'C:/p/cpu', softwarePath: 'C:/p/cpu/Software',
      hardwarePath: 'C:/p/cpu/Hardware', simulationPath: 'C:/p/cpu/Simulation',
      cmmPath: 'C:/p/cpu/Software/cpu.cmm', projectPath: 'C:/p',
    });
  });
});

describe('salvar o aberto', () => {
  it('saveFile: grava pelo registro, marca salvo, guarda a data e avisa que salvou', async () => {
    const reg = registro({ [A]: modeloFalso('texto') }, new Set([A]));
    m.ponte.getFileStats = async () => ({ mtime: 55 });
    TabManager.tabs.set(A, 'velho');
    TabManager.unsavedChanges.add(A);
    const salvos = [];
    window.addEventListener('aurora:file-saved', (e) => salvos.push(e.detail));
    expect(await TabManager.saveFile(A)).toBe(true);
    expect(escritas()).toEqual([[A, 'texto']]);
    expect(TabManager.tabs.get(A)).toBe('texto');
    expect(reg.markSaved).toHaveBeenCalledWith(A);
    expect(TabManager.unsavedChanges.has(A)).toBe(false);
    expect(TabManager.lastModifiedTimes.get(A)).toBe(55);
    expect(salvos.at(-1)).toEqual({ path: A, source: 'editor' });
    m.ponte.getFileStats = async () => { throw new Error('x'); };
    expect(await TabManager.saveFile(A)).toBe(true);
    m.ponte.getFileStats = async () => ({ mtime: 1000 });
  });

  it('saveFile: o arquivo em edicao; nenhum; binario; sem nome; sem modelo lanca; falha de escrita lanca', async () => {
    expect(await TabManager.saveFile()).toBe(false);
    TabManager.activeTab = 'C:/p/f.png';
    expect(await TabManager.saveFile()).toBe(true);
    TabManager.untitledDocuments.set('Untitled-1', {});
    expect(await TabManager.saveFile('Untitled-1')).toBe(false);
    await expect(TabManager.saveFile(A)).rejects.toThrow('Editor model not found for file');
    m.editores.porArquivo.set(A, editorFalso(A, 'pelo editor'));
    m.ponte.writeFile = async () => { throw new Error('disco'); };
    await expect(TabManager.saveFile(A)).rejects.toThrow('disco');
    m.ponte.writeFile = async (p, t) => { m.chamadas.push(['writeFile', p, t]); };
    expect(await TabManager.saveFile(A)).toBe(true);
    expect(escritas()).toEqual([[A, 'pelo editor']]);
  });

  it('saveCurrentFile: o arquivo do painel em foco, pelo registro ou pelo editor', async () => {
    expect(await TabManager.saveCurrentFile()).toBeUndefined();
    window.SplitEditorManager = { getFocusedFile: () => A };
    expect(TabManager.getEditingFilePath()).toBe(A);
    const reg = registro({ [A]: modeloFalso('do painel') });
    m.ponte.getFileStats = async () => ({ mtime: 9 });
    expect(await TabManager.saveCurrentFile()).toBe(true);
    expect(escritas()).toEqual([[A, 'do painel']]);
    expect(reg.markSaved).toHaveBeenCalledWith(A);
    expect(TabManager.lastModifiedTimes.get(A)).toBe(9);

    m.ponte.getFileStats = async () => { throw new Error('x'); };
    delete window.SharedModelRegistry;
    m.editores.porArquivo.set(A, editorFalso(A, 'do editor'));
    expect(await TabManager.saveCurrentFile()).toBe(true);
    m.ponte.getFileStats = async () => ({ mtime: 1000 });

    window.SplitEditorManager = { getFocusedFile: () => null };
    TabManager.activeTab = 'C:/p/f.png';
    expect(await TabManager.saveCurrentFile()).toBeUndefined();
    TabManager.untitledDocuments.set('Untitled-2', {});
    TabManager.activeTab = 'Untitled-2';
    expect(await TabManager.saveCurrentFile()).toBe(false);
    TabManager.activeTab = 'C:/p/sem.v';
    expect(await TabManager.saveCurrentFile()).toBe(false);
    m.editores.porArquivo.set('C:/p/sem.v', editorFalso('C:/p/sem.v'));
    m.ponte.writeFile = async () => { throw new Error('disco'); };
    expect(await TabManager.saveCurrentFile()).toBe(false);
    m.ponte.writeFile = async (p, t) => { m.chamadas.push(['writeFile', p, t]); };
  });

  it('saveAllFiles: todo arquivo sujo, do painel principal e dos divididos; sem nome sujo pede nome', async () => {
    const B = 'C:/p/b.v';
    const C = 'C:/p/c.v';
    expect(await TabManager.saveAllFiles()).toBeUndefined();
    const reg = registro({ [A]: modeloFalso('a'), [B]: modeloFalso('b') }, new Set([A, B, 'Untitled-1', 'C:/p/sem.v', C]));
    TabManager.tabs.set(A, '').set('C:/p/f.png', '').set('C:/p/limpo.v', '').set('Untitled-1', '').set('Untitled-2', '');
    TabManager.tabs.set('C:/p/sem.v', '');
    TabManager.untitledDocuments.set('Untitled-1', {}).set('Untitled-2', {});
    TabManager.unsavedChanges.add('Untitled-2');
    window.SplitEditorManager = { panes: [{ tabs: new Map([[B, {}]]) }, null, {}] };
    m.editores.porArquivo.set(C, editorFalso(C, 'c'));
    TabManager.tabs.set(C, '');
    const semNome = vi.spyOn(TabManager, 'saveUntitledFile').mockResolvedValue(true);
    let falhar = false;
    m.ponte.writeFile = async (p, t) => {
      if (falhar && p === C) throw new Error('disco');
      m.chamadas.push(['writeFile', p, t]);
    };
    m.ponte.getFileStats = async (p) => { if (p === B) throw new Error('x'); return { mtime: 3 }; };
    falhar = true;

    await TabManager.saveAllFiles();

    expect(escritas().map((e) => e[0]).sort()).toEqual([A, B]);
    expect(semNome.mock.calls.map((c) => c[0]).sort()).toEqual(['Untitled-1', 'Untitled-2']);
    expect(console.error).toHaveBeenCalledWith(`Error saving file ${C}:`, expect.any(Error));
    expect(reg.markSaved).toHaveBeenCalledWith(A);
    m.ponte.writeFile = async (p, t) => { m.chamadas.push(['writeFile', p, t]); };
    m.ponte.getFileStats = async () => ({ mtime: 1000 });
  });
});

// A guarda de fechamento (09/10/2026) esta ligada no TabManager de verdade:
// com um documento sem nome com texto, fechar a janela e cancelado e o
// dialogo pergunta; sem nada por salvar, a janela fecha.
describe('fechar a janela', () => {
  it('com trabalho nao salvo, segura e pergunta; sem nada, deixa fechar', async () => {
    const fechar = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    registro({});
    expect(fechar()).toBe(false);

    const p = TabManager.createNewFile();
    TabManager.unsavedChanges.add(p);
    window.AuroraUI = { dialog: vi.fn(async () => 'cancel') };
    expect(fechar()).toBe(true);
    await vi.waitFor(() => expect(window.AuroraUI.dialog).toHaveBeenCalledTimes(1));
    delete window.AuroraUI;
  });
});
