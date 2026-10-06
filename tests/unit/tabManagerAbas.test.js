// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
//
// js/tabs/tab_manager: o ciclo de uma aba. Abrir (texto, binario, previa,
// num painel dividido), ativar (editor ou visualizador), marcar suja, fechar
// (com a pergunta de salvar so na ultima instancia), reabrir, e as abas do
// PRISM e do Surfer.
//
// Caracterizacao escrita antes de o modulo virar .ts, contra o .js antigo.
// O TabManager de verdade, carregado sobre o mundo de tests/helpers/
// abasFalsas.js: Monaco, ponte, dialogo e projeto sao falsos.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = await vi.hoisted(async () => (await import('../helpers/abasFalsas.js')).criarMundo());

vi.mock('../../js/components/aurora-tabs.js', () => ({}));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: m.editores }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: m.showCardNotification }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog: m.showDialog }));
vi.mock('../../js/project/project_store.js', () => ({ ProjectStore: m.ProjectStore }));
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: m.SpfStore }));
vi.mock('../../js/project/processor_list.js', () => ({ addAvailableProcessor: m.addAvailableProcessor }));

import { TabManager, showUnsavedChangesDialog } from '../../js/tabs/tab_manager.js';
import { editorFalso } from '../helpers/abasFalsas.js';

const A = 'C:/p/a.v';
const B = 'C:/p/b.v';
const barra = () => document.getElementById('tabs-container');
const abaDe = (p) => barra().querySelector(`.tab[data-path="${window.CSS.escape(p)}"]`);
const nomes = () => Array.from(barra().querySelectorAll('.tab')).map((t) => t.dataset.path);
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** Abre como o app abre: addTab e espera o editor nascer. */
async function abrir(p, texto = 'module x; endmodule', opcoes) {
  TabManager.addTab(p, texto, opcoes);
  await tick();
}

beforeEach(() => {
  m.zerar(TabManager);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  window.requestAnimationFrame = (cb) => { cb(); return 1; };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => m.zerar(TabManager));

describe('carga do modulo', () => {
  it('liga os ouvintes da ponte; mudanca externa avisada vai para o tratamento', () => {
    expect(typeof m.ponte.ouvintes.mudou).toBe('function');
    const tratar = vi.spyOn(TabManager, 'handleExternalFileChange').mockResolvedValue();
    m.ponte.ouvintes.mudou(A);
    expect(tratar).toHaveBeenCalledWith(A);
  });

  it('initialize e idempotente; com a barra no DOM, toda mudanca nela grava a ordem', async () => {
    TabManager._initialized = false;
    TabManager.initialize();
    TabManager.initialize();
    await abrir(A);
    await tick();
    expect(JSON.parse(localStorage.getItem('editorTabOrder'))).toEqual([A]);
  });

  it('o load cria a faixa #editor-tabs uma vez; sair da pagina para os vigias', () => {
    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));
    expect(document.querySelectorAll('#editor-tabs')).toHaveLength(1);
    const parar = vi.spyOn(TabManager, 'stopAllWatchers');
    window.dispatchEvent(new Event('beforeunload'));
    expect(parar).toHaveBeenCalled();
  });
});

describe('veu e barra', () => {
  it('sem delegado, esconde e mostra o veu; com delegado, so chama o delegado', () => {
    const veu = document.getElementById('editor-overlay');
    TabManager.hideOverlay();
    expect(veu.classList.contains('hidden')).toBe(true);
    TabManager.showOverlay();
    expect(veu.classList.contains('hidden')).toBe(false);
    TabManager.overlayDelegate = vi.fn();
    TabManager.hideOverlay();
    TabManager.showOverlay();
    expect(TabManager.overlayDelegate).toHaveBeenCalledTimes(2);
    expect(veu.classList.contains('hidden')).toBe(false);
  });

  it('a barra so aparece com abas; sem veu nem barra no DOM, nada quebra', async () => {
    TabManager.updateTabsContainerVisibility();
    expect(barra().style.display).toBe('none');
    await abrir(A);
    expect(barra().style.display).toBe('flex');
    const veu = document.getElementById('editor-overlay');
    const pai = barra().parentNode;
    const b = barra();
    veu.remove();
    b.remove();
    TabManager.hideOverlay();
    TabManager.showOverlay();
    TabManager.updateTabsContainerVisibility();
    TabManager.addTab(B, '');
    expect(console.error).toHaveBeenCalledWith('Tabs container not found');
    document.body.prepend(veu);
    pai.prepend(b);
  });
});

describe('abrir', () => {
  it('texto: cria a aba, o editor, ativa e vigia o arquivo', async () => {
    const vigiar = vi.spyOn(TabManager, 'startWatchingFile');
    const ronda = vi.spyOn(TabManager, 'startPeriodicFileCheck').mockImplementation(() => {});
    window.t = (k) => `[${k}]`;
    await abrir(A, 'conteudo');

    expect(nomes()).toEqual([A]);
    const aba = abaDe(A);
    expect(aba.title).toBe(A);
    expect(aba.querySelector('.tab-name').textContent).toBe('a.v');
    expect(aba.querySelector('.close-tab').title).toBe('[tabs.close]');
    expect(TabManager.tabs.get(A)).toBe('conteudo');
    expect(TabManager.activeTab).toBe(A);
    expect(aba.classList.contains('active')).toBe(true);
    expect(m.editores.ativo).toBe(A);
    expect(vigiar).toHaveBeenCalledWith(A);
    expect(ronda).toHaveBeenCalledTimes(1);
    await abrir(B, null);
    expect(ronda).toHaveBeenCalledTimes(1);
    expect(TabManager.tabs.get(B)).toBe('');
  });

  it('ja aberta: so ativa; a previa aberta de novo como permanente perde o italico', async () => {
    await abrir(A, 'x', { preview: true });
    expect(TabManager.previewTab).toBe(A);
    expect(abaDe(A).classList.contains('preview')).toBe(true);
    await abrir(B);
    await abrir(A, 'x', { preview: true });
    expect(TabManager.activeTab).toBe(A);
    expect(TabManager.previewTab).toBe(A);
    await abrir(A);
    expect(TabManager.previewTab).toBeNull();
    expect(abaDe(A).classList.contains('preview')).toBe(false);
  });

  it('nova previa fecha a anterior sem perguntar', async () => {
    await abrir(A, 'x', { preview: true });
    TabManager.unsavedChanges.add(A);
    await abrir(B, 'y', { preview: true });
    expect(nomes()).toEqual([B]);
    expect(TabManager.previewTab).toBe(B);
    expect(TabManager.unsavedChanges.has(A)).toBe(false);
  });

  it('com um painel dividido em foco, vai para ele', () => {
    window.SplitEditorManager = { focusedPane: 1, openInFocusedPane: vi.fn() };
    TabManager.addTab(A, null, { preview: true });
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalledWith(A, '', { preview: true });
    expect(nomes()).toEqual([]);
    TabManager.addTab(A, 'x', { _fromSplit: true });
    expect(nomes()).toEqual([A]);
  });

  it('binario: aba marcada, sem editor, com o visualizador', async () => {
    TabManager.addTab('C:/p/foto.png');
    expect(abaDe('C:/p/foto.png').classList.contains('binary-file')).toBe(true);
    expect(TabManager.tabs.get('C:/p/foto.png')).toBe('[BINARY_FILE]');
    expect(document.querySelector('#monaco-editor .image-viewer').style.display).toBe('flex');
  });

  it('editor que nao nasce, ou que lanca: a aba fecha', async () => {
    m.editores.criar = () => null;
    await abrir(A);
    expect(nomes()).toEqual([]);
    m.editores.criar = () => { throw new Error('monaco'); };
    await abrir(B);
    expect(nomes()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('Error creating editor:', expect.any(Error));
  });

  it('ir a uma linha, ou repor a vista, depois de o editor existir', async () => {
    await abrir(A, 'x', { revealPosition: { line: 7, column: 3 } });
    const e = m.editores.getEditorForFile(A);
    expect(e.posicao).toEqual({ lineNumber: 7, column: 3 });
    expect(e.revelada).toBe(7);
    expect(e.focado).toBe(true);

    await abrir(B, 'x', { revealPosition: {} });
    expect(m.editores.getEditorForFile(B).posicao).toEqual({ lineNumber: 1, column: 1 });

    await abrir('C:/p/c.v', 'x', { viewState: { cursor: 1 } });
    expect(m.editores.getEditorForFile('C:/p/c.v').estadoDeVista).toEqual({ cursor: 1 });

    m.editores.criar = (p, t) => Object.assign(editorFalso(p, t), {
      restoreViewState: () => { throw new Error('estado de outra versao'); },
    });
    await abrir('C:/p/d.v', 'x', { viewState: {} });
    expect(TabManager.tabs.has('C:/p/d.v')).toBe(true);
  });

  it('cliques na aba: clicar ativa e devolve o foco ao painel principal; duplo promove; meio fecha', async () => {
    window.SplitEditorManager = { setFocus: vi.fn() };
    await abrir(A, 'x', { preview: true });
    await abrir(B);
    abaDe(A).dispatchEvent(new Event('click'));
    expect(TabManager.activeTab).toBe(A);
    expect(window.SplitEditorManager.setFocus).toHaveBeenCalledWith(0);
    abaDe(A).dispatchEvent(new Event('dblclick'));
    expect(TabManager.previewTab).toBeNull();

    const meio = Object.assign(new Event('mousedown', { cancelable: true }), { button: 1 });
    abaDe(A).dispatchEvent(meio);
    expect(meio.defaultPrevented).toBe(true);
    const esquerdo = Object.assign(new Event('mousedown', { cancelable: true }), { button: 0 });
    abaDe(A).dispatchEvent(esquerdo);
    expect(esquerdo.defaultPrevented).toBe(false);

    abaDe(A).dispatchEvent(Object.assign(new Event('auxclick', { cancelable: true }), { button: 2 }));
    expect(nomes()).toEqual([A, B]);
    abaDe(A).dispatchEvent(Object.assign(new Event('auxclick', { cancelable: true }), { button: 1 }));
    await tick();
    expect(nomes()).toEqual([B]);

    abaDe(B).querySelector('.close-tab').dispatchEvent(new Event('click', { bubbles: true }));
    await tick();
    expect(nomes()).toEqual([]);
  });
});

describe('ativar', () => {
  it('troca de aba de texto para binario e de volta: editores e visualizadores se alternam', async () => {
    const eventos = [];
    document.addEventListener('aurora:editing-file-changed', (e) => eventos.push(e.detail.filePath));
    await abrir(A);
    TabManager.addTab('C:/p/doc.pdf');
    const editorDiv = document.querySelector(`.editor-instance[data-file-path="${A}"]`);
    expect(editorDiv.style.display).toBe('none');
    const pdf = document.querySelector('.pdf-viewer');
    expect(pdf.style.display).toBe('flex');

    TabManager.activateTab(A);
    expect(pdf.style.display).toBe('none');
    expect(editorDiv.style.display).toBe('block');
    expect(editorDiv.classList.contains('active')).toBe(true);
    expect(eventos).toEqual([A, 'C:/p/doc.pdf', A]);
  });

  it('sair de um PDF guarda a posicao dele; voltar repoe', async () => {
    const guardar = vi.spyOn(TabManager, 'savePdfViewerState');
    const repor = vi.spyOn(TabManager, 'restorePdfViewerState');
    TabManager.addTab('C:/p/doc.pdf');
    TabManager.addTab('C:/p/foto.png');
    expect(guardar).toHaveBeenCalledWith('C:/p/doc.pdf');
    TabManager.activateTab('C:/p/doc.pdf');
    expect(repor).toHaveBeenCalled();
    // O visualizador ja esta no container: nao e posto de novo.
    TabManager.activateTab('C:/p/doc.pdf');
    expect(document.querySelectorAll('.pdf-viewer')).toHaveLength(1);
  });

  it('caminho sem aba nao faz nada', () => {
    TabManager.activateTab('C:/p/nada.v');
    expect(TabManager.activeTab).toBeNull();
  });

  it('a aba ativa do painel principal nao tira o destaque das abas dos paineis divididos', async () => {
    const dividida = document.createElement('div');
    dividida.className = 'tab split-tab active';
    dividida.dataset.path = B;
    document.body.appendChild(dividida);
    await abrir(A);
    expect(dividida.classList.contains('active')).toBe(true);
    dividida.remove();
  });
});

describe('suja e salva', () => {
  it('o ponto amarelo aparece em toda aba do arquivo, e some ao salvar', async () => {
    await abrir(A);
    const dividida = document.createElement('div');
    dividida.className = 'tab split-tab';
    dividida.dataset.path = A;
    dividida.innerHTML = '<button class="close-tab">×</button>';
    document.body.appendChild(dividida);
    const semBotao = document.createElement('div');
    semBotao.className = 'tab';
    semBotao.dataset.path = A;
    document.body.appendChild(semBotao);

    TabManager.markFileAsModified(A);
    expect(TabManager.unsavedChanges.has(A)).toBe(true);
    for (const b of document.querySelectorAll(`.tab[data-path="${A}"] .close-tab`)) {
      expect(b.innerHTML).toBe('•');
      expect(b.style.color).toBe('#ffd700');
    }
    TabManager.markFileAsSaved(A);
    expect(TabManager.unsavedChanges.has(A)).toBe(false);
    for (const b of document.querySelectorAll(`.tab[data-path="${A}"] .close-tab`)) expect(b.innerHTML).toBe('×');
    TabManager.markFileAsModified('');
    TabManager.markFileAsSaved(null);
    dividida.remove();
    semBotao.remove();
  });

  it('editar suja pelo registro de modelos; voltar ao salvo limpa; editar promove a previa', async () => {
    let sujo = true;
    window.SharedModelRegistry = { isDirty: () => sujo };
    await abrir(A, 'x', { preview: true });
    const e = m.editores.getEditorForFile(A);
    e.setValue('y');
    expect(TabManager.unsavedChanges.has(A)).toBe(true);
    expect(TabManager.previewTab).toBeNull();
    sujo = false;
    e.setValue('x');
    expect(TabManager.unsavedChanges.has(A)).toBe(false);
    // Reabrir o mesmo editor nao liga um segundo ouvinte.
    TabManager.setupContentChangeListener(A, e);
    expect(e.mudancas).toHaveLength(1);
    delete window.SharedModelRegistry;
    e.setValue('z');
    expect(TabManager.unsavedChanges.has(A)).toBe(false);
    sujo = true;
    window.SharedModelRegistry = { isDirty: () => true };
    TabManager.previewTab = null;
    e.setValue('w');
    expect(TabManager.unsavedChanges.has(A)).toBe(true);
  });

  it('instancias: o painel principal e cada painel dividido que mostra o arquivo', async () => {
    expect(TabManager.getInstanceCount('')).toBe(0);
    await abrir(A);
    expect(TabManager.getInstanceCount(A)).toBe(1);
    window.SplitEditorManager = { panes: [{ tabs: new Map([[A, {}]]) }, null, { tabs: new Map() }] };
    expect(TabManager.getInstanceCount(A)).toBe(2);
  });
});

describe('fechar', () => {
  it('limpa a aba, o editor e o estado; ativa a ultima que sobrou; empilha para reabrir', async () => {
    await abrir(A, 'texto a');
    await abrir(B);
    TabManager.activateTab(A);
    await TabManager.closeTab(A);
    expect(nomes()).toEqual([B]);
    expect(TabManager.activeTab).toBe(B);
    expect(m.chamadas).toContainEqual(['closeEditor', A]);
    expect(TabManager.closedTabsStack.at(-1)).toMatchObject({ filePath: A, content: 'texto a' });
  });

  it('a ultima aba fechada: veu de volta, editor limpo, aviso de nenhum arquivo', async () => {
    const modelo = {};
    const principal = { setValue: vi.fn(), getModel: () => modelo };
    window.monaco = globalThis.monaco = { editor: { setModelLanguage: vi.fn() } };
    const eventos = [];
    document.addEventListener('aurora:editing-file-changed', (e) => eventos.push(e.detail.filePath));
    await abrir(A);
    m.editores.activeEditor = principal;
    await TabManager.closeTab(A);
    expect(TabManager.activeTab).toBeNull();
    expect(document.getElementById('editor-overlay').classList.contains('hidden')).toBe(false);
    expect(principal.setValue).toHaveBeenCalledWith('');
    expect(window.monaco.editor.setModelLanguage).toHaveBeenCalledWith(modelo, 'plaintext');
    expect(eventos.at(-1)).toBeNull();

    principal.getModel = () => null;
    await abrir(B);
    await TabManager.closeTab(B);
    m.editores.activeEditor = null;
    await abrir(A);
    await TabManager.closeTab(A);
    delete globalThis.monaco;
  });

  it('fecha sem perguntar quando outro painel ainda mostra o arquivo; aviso sujo sobrevive', async () => {
    await abrir(A);
    TabManager.unsavedChanges.add(A);
    window.SplitEditorManager = { panes: [{ tabs: new Map([[A, {}]]) }] };
    window.SharedModelRegistry = { has: () => true, isDirty: () => true };
    await TabManager.closeTab(A);
    expect(nomes()).toEqual([]);
    expect(TabManager.unsavedChanges.has(A)).toBe(true);
  });

  it('PRISM e Surfer: fechar esquece a aba; o Surfer derruba o servidor; o visualizador sai', async () => {
    TabManager.openSurferWave('C:/p/w.vcd', 'about:blank#w', 'wave:C:/p/w.vcd');
    expect(document.querySelector('.surfer-viewer')).not.toBeNull();
    TabManager.pdfStateIntervals.set('C:/p/w.vcd', setInterval(() => {}, 10000));
    await TabManager.closeTab('C:/p/w.vcd');
    expect(m.chamadas).toContainEqual(['surferTabStop', 'wave:C:/p/w.vcd']);
    expect(TabManager.surferViews.size).toBe(0);
    expect(document.querySelector('.surfer-viewer')).toBeNull();
    expect(TabManager.pdfStateIntervals.size).toBe(0);

    window.electronAPI.surferTabStop = () => { throw new Error('ja caiu'); };
    TabManager.openSurferWave('C:/p/w.vcd', 'about:blank#u', 't');
    await TabManager.closeTab('C:/p/w.vcd');
    window.electronAPI.surferTabStop = m.ponte.surferTabStop;

    TabManager.viewerInstances.set('solto', document.createElement('div'));
    TabManager.tabs.set('solto', '[BINARY_FILE]');
    await TabManager.closeTab('solto');
    expect(TabManager.viewerInstances.has('solto')).toBe(false);
  });

  it('pilha de reabrir guarda 10; documento sem nome nao entra; fechar em andamento ignora outro pedido', async () => {
    for (let i = 0; i < 12; i++) {
      TabManager.tabs.set(`C:/p/f${i}.v`, `${i}`);
      await TabManager.closeTab(`C:/p/f${i}.v`);
    }
    expect(TabManager.closedTabsStack).toHaveLength(10);
    expect(TabManager.closedTabsStack[0].filePath).toBe('C:/p/f2.v');

    const sem = TabManager.createNewFile();
    await tick();
    TabManager.unsavedChanges.delete(sem);
    await TabManager.closeTab(sem);
    expect(TabManager.closedTabsStack.at(-1).filePath).toBe('C:/p/f11.v');
    expect(TabManager.untitledDocuments.has(sem)).toBe(false);

    TabManager.isClosingTab = true;
    TabManager.tabs.set(A, 'x');
    await TabManager.closeTab(A);
    expect(TabManager.tabs.has(A)).toBe(true);
  });

  it('fechar a previa limpa a marca; fechar o que nao esta aberto para a ronda se nao ha abas', async () => {
    await abrir(A, 'x', { preview: true });
    await TabManager.closeTab(A);
    expect(TabManager.previewTab).toBeNull();
    const parar = vi.spyOn(TabManager, 'stopPeriodicFileCheck');
    await TabManager.closeTab('C:/p/nunca.v');
    expect(parar).toHaveBeenCalled();
  });

  it('a previa que sai em silencio: sem aba nao faz nada; ativa a ultima que sobrou; sem nome sai do registro', async () => {
    TabManager._closePreviewSilently('C:/p/nada.v');
    await abrir(A);
    const sem = TabManager.createNewFile();
    await tick();
    TabManager.previewTab = sem;
    TabManager._closePreviewSilently(sem);
    expect(TabManager.activeTab).toBe(A);
    expect(TabManager.untitledDocuments.has(sem)).toBe(false);
    expect(TabManager.previewTab).toBeNull();
  });

  it('fechar todas', async () => {
    await abrir(A);
    await abrir(B);
    await TabManager.closeAllTabs();
    expect(nomes()).toEqual([]);
  });
});

describe('fechar com a pergunta', () => {
  /** Responde o dialogo de salvar assim que ele aparecer. */
  function responder(acao) {
    const obs = new window.MutationObserver(() => {
      const b = document.querySelector(`#unsaved-changes-modal [data-action="${acao}"]`);
      if (b) { obs.disconnect(); b.click(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  it('cancelar mantem a aba; nao salvar fecha; salvar grava e fecha; salvar que volta false mantem', async () => {
    vi.useFakeTimers();
    await abrir(A);
    TabManager.unsavedChanges.add(A);

    responder('cancel');
    let p = TabManager.closeTab(A);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(nomes()).toEqual([A]);

    const salvar = vi.spyOn(TabManager, 'saveFile').mockResolvedValueOnce(false);
    responder('save');
    p = TabManager.closeTab(A);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(nomes()).toEqual([A]);

    salvar.mockRejectedValueOnce(new Error('disco'));
    responder('save');
    p = TabManager.closeTab(A);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(nomes()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('Failed to save file:', expect.any(Error));

    TabManager.tabs.set(B, 'x');
    TabManager.unsavedChanges.add(B);
    responder('dont-save');
    p = TabManager.closeTab(B);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(TabManager.tabs.has(B)).toBe(false);

    TabManager.tabs.set(B, 'x');
    TabManager.unsavedChanges.add(B);
    salvar.mockResolvedValueOnce(true);
    responder('save');
    p = TabManager.closeTab(B);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(TabManager.tabs.has(B)).toBe(false);
  });

  it('o dialogo: Esc cancela, clique fora de botao nao decide, e um dialogo velho sai', async () => {
    vi.useFakeTimers();
    const velho = document.createElement('div');
    velho.className = 'confirm-modal';
    document.body.appendChild(velho);
    const p = showUnsavedChangesDialog('a.v');
    expect(velho.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    const modal = document.getElementById('unsaved-changes-modal');
    expect(modal.classList.contains('show')).toBe(true);
    expect(modal.textContent).toContain('"a.v"');
    modal.querySelector('.confirm-modal-message').click();
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'a' }));
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toBe('cancel');
    expect(document.getElementById('unsaved-changes-modal')).toBeNull();
  });
});

describe('reabrir', () => {
  it('reabre com o texto do disco; o guardado so volta se o editor ja existir', async () => {
    // Achado: o editor da aba reaberta nasce depois de um await dentro do
    // addTab, e a conferencia vem logo em seguida, entao pelo painel
    // principal o texto guardado nunca e reposto. Fica registrado no TODO.
    m.ponte.readFile = async () => 'do disco';
    TabManager.closedTabsStack.push({ filePath: A, content: 'meu' });
    await TabManager.reopenLastClosedTab();
    await tick();
    expect(m.editores.getEditorForFile(A).getValue()).toBe('do disco');
    expect(TabManager.unsavedChanges.has(A)).toBe(false);

    // Com um editor que ja existe para o arquivo, o guardado volta como edicao.
    const ja = editorFalso(B, 'do disco');
    m.editores.porArquivo.set(B, ja);
    TabManager.closedTabsStack.push({ filePath: B, content: 'meu' });
    await TabManager.reopenLastClosedTab();
    expect(ja.getValue()).toBe('meu');
    expect(TabManager.unsavedChanges.has(B)).toBe(true);
  });

  it('arquivo sumido usa o texto guardado; ja aberta so ativa; pilha vazia, nada', async () => {
    m.ponte.readFile = async () => { throw new Error('ENOENT'); };
    TabManager.closedTabsStack.push({ filePath: B, content: 'guardado' });
    await TabManager.reopenLastClosedTab();
    expect(TabManager.tabs.get(B)).toBe('guardado');

    await abrir(A);
    TabManager.closedTabsStack.push({ filePath: B, content: 'x' });
    await TabManager.reopenLastClosedTab();
    expect(TabManager.activeTab).toBe(B);
    await TabManager.reopenLastClosedTab();

    // Texto diferente mas sem editor ainda: nao marca.
    m.ponte.readFile = async () => 'outro';
    TabManager.closedTabsStack.push({ filePath: 'C:/p/n.v', content: 'meu' });
    await TabManager.reopenLastClosedTab();
    expect(TabManager.unsavedChanges.has('C:/p/n.v')).toBe(false);

    vi.spyOn(TabManager, 'addTab').mockImplementationOnce(() => { throw new Error('x'); });
    TabManager.closedTabsStack.push({ filePath: 'C:/p/z.v', content: '' });
    await TabManager.reopenLastClosedTab();
    expect(console.error).toHaveBeenCalledWith('Error reopening tab:', expect.any(Error));
  });
});

describe('PRISM e Surfer', () => {
  it('Surfer: abre com o logo e o visualizador; reabrir troca a url e traz para a frente', () => {
    TabManager.openSurferWave('C:/p/w.vcd', 'about:blank#1', 't1');
    const aba = abaDe('C:/p/w.vcd');
    expect(aba.querySelector('img.tab-logo').getAttribute('src')).toBe('./assets/icons/Surfer_logo.svg');
    expect(TabManager.isEmbeddedView('C:/p/w.vcd')).toBe(true);
    const recarregar = vi.spyOn(TabManager, 'refreshSurferViewer');
    TabManager.openSurferWave('C:/p/w.vcd', 'about:blank#2', 't2');
    expect(recarregar).toHaveBeenCalledWith('C:/p/w.vcd', 'about:blank#2');
    expect(TabManager.surferViews.get('C:/p/w.vcd')).toEqual({ tabId: 't2', pageUrl: 'about:blank#2' });
  });

  it('PRISM: a pagina num webview, com o resultado entregue no dom-ready e a cada recompilacao', async () => {
    TabManager.openPrismTab({ n: 1 });
    const aba = abaDe(TabManager.PRISM_TAB);
    expect(aba.title).toBe('PRISM');
    expect(aba.querySelector('img.tab-logo').getAttribute('src')).toBe('./assets/icons/aurora_prism.svg');
    await tick();
    const wv = document.querySelector('webview.prism-frame');
    expect(wv.getAttribute('src')).toBe('aurora-prism://x');
    expect(wv.getAttribute('preload')).toBe('pre.js');
    wv.send = vi.fn();
    wv.dispatchEvent(new Event('dom-ready'));
    expect(wv.send).toHaveBeenCalledWith('compilation-complete', { n: 1 });

    TabManager.openPrismTab({ n: 2 });
    expect(wv.send).toHaveBeenLastCalledWith('compilation-complete', { n: 2 });
    wv.send = () => { throw new Error('ainda nao'); };
    TabManager.refreshPrismViewer(TabManager.PRISM_TAB, { n: 3 });
    wv.dispatchEvent(new Event('dom-ready'));
    expect(document.querySelector('.prism-viewer-erro').textContent).toBe('PRISM: ainda nao');
    TabManager.refreshPrismViewer('nada', {});
  });

  it('PRISM: pagina recusada, sem resposta ou que lanca vira aviso na aba; dom-ready sem resultado nao envia', async () => {
    const casos = [
      [async () => ({ ok: false, error: 'sem yosys' }), 'PRISM: sem yosys'],
      [async () => null, 'PRISM: prism-tab:page respondeu sem URL nem erro'],
      [async () => { throw new Error('ipc'); }, 'PRISM: ipc'],
      [async () => { throw 'texto'; }, 'PRISM: texto'],
    ];
    const original = window.electronAPI.prismTabPage;
    for (const [pagina, msg] of casos) {
      window.electronAPI.prismTabPage = pagina;
      const v = TabManager.createPrismViewer(`p${msg}`);
      await tick();
      expect(v.querySelector('.prism-viewer-erro').textContent).toBe(msg);
    }
    window.electronAPI.prismTabPage = original;
    const v = TabManager.createPrismViewer('vazio');
    await tick();
    const wv = v.querySelector('webview');
    wv.send = vi.fn();
    wv.dispatchEvent(new Event('dom-ready'));
    expect(wv.send).not.toHaveBeenCalled();
  });
});

describe('caminho no topo do editor', () => {
  it('com a barra no DOM: pastas, nome, e o tipo das abas que nao sao texto', () => {
    const barraCaminho = document.createElement('div');
    barraCaminho.id = 'context-path';
    document.body.appendChild(barraCaminho);
    TabManager.updateContextPath('C:/p/a.v');
    expect(barraCaminho.className).toBe('context-path-container');
    expect(Array.from(barraCaminho.querySelectorAll('.context-path-segment')).map((s) => s.textContent)).toEqual(['C:', 'p']);
    expect(barraCaminho.querySelector('.context-path-filename').textContent).toBe('a.v');
    expect(barraCaminho.querySelector('.file-type-indicator')).toBeNull();

    TabManager.surferViews.set('w.vcd', {});
    TabManager.prismViews.set('prism://PRISM', {});
    const tipos = ['w.vcd', 'prism://PRISM', 'C:/f.png', 'C:/d.pdf'].map((p) => {
      TabManager.updateContextPath(p);
      return barraCaminho.querySelector('.file-type-indicator').textContent;
    });
    expect(tipos).toEqual(['Wave', 'RTL', 'Image', 'PDF']);

    TabManager.updateContextPath(null);
    expect(barraCaminho.className).toBe('context-path-container empty');
    expect(barraCaminho.innerHTML).toBe('');
  });
});

describe('foco do editor', () => {
  it('foco no editor do painel principal ativa a aba dele e devolve o foco ao painel 0', async () => {
    window.SplitEditorManager = { setFocus: vi.fn() };
    await abrir(A, 'x', { preview: true });
    await abrir(B);
    const focar = (detail) => document.dispatchEvent(new CustomEvent('aurora-editor-focused', { detail }));
    focar({ filePath: A, paneIndex: 0 });
    expect(TabManager.activeTab).toBe(A);
    expect(TabManager.previewTab).toBeNull();
    expect(window.SplitEditorManager.setFocus).toHaveBeenCalledWith(0);

    // Ativa mas sem o destaque na aba: reativa.
    abaDe(A).classList.remove('active');
    focar({ filePath: A, paneIndex: 0 });
    expect(abaDe(A).classList.contains('active')).toBe(true);
    focar({ filePath: A, paneIndex: 0 });

    const ativar = vi.spyOn(TabManager, 'activateTab');
    focar({ filePath: B, paneIndex: 1 });
    focar({});
    document.dispatchEvent(new CustomEvent('aurora-editor-focused'));
    expect(ativar).not.toHaveBeenCalled();
  });

  it('o destaque da arvore: liga no foco, desliga 150 ms depois do blur, e o foco de volta cancela', () => {
    vi.useFakeTimers();
    const estado = (focused) => document.dispatchEvent(new CustomEvent('aurora-editor-focusstate', { detail: { focused } }));
    estado(true);
    expect(document.body.classList.contains('editor-has-focus')).toBe(true);
    estado(false);
    estado(false);
    vi.advanceTimersByTime(100);
    estado(true);
    vi.advanceTimersByTime(200);
    expect(document.body.classList.contains('editor-has-focus')).toBe(true);
    estado(false);
    vi.advanceTimersByTime(150);
    expect(document.body.classList.contains('editor-has-focus')).toBe(false);
    document.dispatchEvent(new CustomEvent('aurora-editor-focusstate'));
    estado(true);
    TabManager._bindEditorFocusActivation();
  });
});

describe('o que e cada aba', () => {
  it('icone, imagem, PDF, binario', () => {
    expect(TabManager.getFileIcon('a.v')).toMatch(/^ph /);
    expect(TabManager.isImageFile('a.PNG')).toBe(true);
    expect(TabManager.isPdfFile('a.pdf')).toBe(true);
    expect(TabManager.isBinaryFile('a.zip')).toBe(false);
    expect(TabManager.isBinaryFile('a.v')).toBe(false);
  });

  it('promover previa que nao e a atual nao faz nada; sem a aba no DOM so zera', () => {
    TabManager.previewTab = A;
    TabManager.promotePreviewToPermanent(B);
    expect(TabManager.previewTab).toBe(A);
    TabManager.promotePreviewToPermanent(A);
    expect(TabManager.previewTab).toBeNull();
  });
});
