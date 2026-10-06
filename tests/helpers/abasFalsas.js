/* global window, document, CSS, localStorage, clearInterval */
/**
 * tests/helpers/abasFalsas.js: o mundo em volta do TabManager
 * (js/tabs/tab_manager), para os testes que o carregam de verdade.
 *
 * O TabManager se inicializa na carga do modulo (liga ouvintes da ponte, le a
 * barra de abas do DOM), entao o mundo tem de existir ANTES do import. Cada
 * teste o cria dentro de um `vi.hoisted` assincrono e passa as pecas para os
 * `vi.mock`:
 *
 *   const m = await vi.hoisted(async () =>
 *     (await import('../helpers/abasFalsas.js')).criarMundo());
 *   vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: m.editores }));
 *
 * Os falsos guardam o que recebem; `m.zerar(TabManager)` limpa o estado
 * estatico da classe e o dos falsos entre os casos.
 */

/** Um modelo do Monaco de mentira: o texto, as linhas, desfazer. */
export function modeloFalso(texto = '') {
  const m = {
    texto,
    getValue: () => m.texto,
    setValue: (t) => { m.texto = t; },
    getLineCount: () => m.texto.split('\n').length,
    getLineLength: (n) => (m.texto.split('\n')[n - 1] || '').length,
  };
  return m;
}

/** Um editor do Monaco de mentira, com o que o TabManager usa. */
export function editorFalso(caminho, texto = '') {
  const modelo = modeloFalso(texto);
  const e = {
    caminho,
    modelo,
    mudancas: [],
    getValue: () => modelo.texto,
    setValue: (t) => { modelo.texto = t; e.mudancas.forEach((cb) => cb()); },
    getModel: () => modelo,
    onDidChangeModelContent: (cb) => { e.mudancas.push(cb); return { dispose() {} }; },
    layout: () => {},
    setPosition: (p) => { e.posicao = p; },
    revealLineInCenter: (l) => { e.revelada = l; },
    focus: () => { e.focado = true; },
    restoreViewState: (v) => { e.estadoDeVista = v; },
    dispose: () => {},
  };
  return e;
}

export function criarMundo() {
  document.body.innerHTML = `
    <div id="editor-overlay"></div>
    <div id="area"><div id="tabs-container"></div><div id="monaco-editor"></div></div>`;

  const chamadas = [];
  const anotar = (nome) => (...args) => { chamadas.push([nome, ...args]); };

  const ponte = {
    ouvintes: {},
    onFileChanged(cb) { ponte.ouvintes.mudou = cb; },
    onFileWatcherError(cb) { ponte.ouvintes.erroDoVigia = cb; },
    getFileStats: async () => ({ mtime: 1000 }),
    watchFile: async (p) => `vigia:${p}`,
    stopWatchingFile: async () => {},
    readFile: async () => '',
    writeFile: async (p, t) => { chamadas.push(['writeFile', p, t]); },
    fileExists: async () => false,
    joinPath: async (...partes) => partes.join('/'),
    mkdir: async (p) => { chamadas.push(['mkdir', p]); },
    showSaveDialog: async () => ({ canceled: true }),
    triggerFileTreeRefresh: async () => { chamadas.push(['refresh']); },
    surferTabStop: (id) => { chamadas.push(['surferTabStop', id]); },
    prismTabPage: async () => ({ ok: true, url: 'aurora-prism://x', preload: 'pre.js' }),
    readFileBuffer: async () => new Uint8Array([1]),
  };
  window.electronAPI = ponte;

  const porArquivo = new Map();
  const editores = {
    ready: Promise.resolve(),
    activeEditor: null,
    ativo: null,
    criar: (caminho, texto) => editorFalso(caminho, texto),
    createEditorInstance(caminho, texto) {
      const e = editores.criar(caminho, texto);
      if (!e) return e;
      porArquivo.set(caminho, e);
      const div = document.createElement('div');
      div.className = 'editor-instance';
      div.dataset.filePath = caminho;
      document.getElementById('monaco-editor').appendChild(div);
      return e;
    },
    getEditorForFile: (caminho) => porArquivo.get(caminho) ?? null,
    setActiveEditor: (caminho) => { editores.ativo = caminho; },
    closeEditor(caminho) {
      porArquivo.delete(caminho);
      document.querySelector(`.editor-instance[data-file-path="${CSS.escape(caminho)}"]`)?.remove();
      chamadas.push(['closeEditor', caminho]);
    },
    porArquivo,
  };

  const dialogo = { resposta: 'cancel', pedidos: [] };
  const showDialog = async (o) => { dialogo.pedidos.push(o); return dialogo.resposta; };

  const avisos = [];
  const showCardNotification = (msg, tipo) => { avisos.push([msg, tipo]); };

  const projeto = { caminho: null, spf: null };
  const ProjectStore = {
    getProjectPath: () => projeto.caminho,
    getSpfPath: () => projeto.spf,
  };

  const spf = { estrutura: {}, escritas: 0 };
  const SpfStore = {
    update: async (_p, mutar) => { spf.escritas += 1; await mutar(spf.estrutura); return spf.estrutura; },
  };

  const processadores = [];
  const addAvailableProcessor = (n) => { processadores.push(n); };

  return {
    ponte, editores, dialogo, showDialog, avisos, showCardNotification,
    projeto, ProjectStore, spf, SpfStore, processadores, addAvailableProcessor,
    chamadas, anotar,
    /** Limpa o estado estatico do TabManager e o dos falsos. */
    zerar(TabManager) {
      for (const k of ['tabs', 'editorStates', 'viewerInstances', 'surferViews', 'prismViews',
        'pdfViewerStates', 'untitledDocuments', 'fileWatchers', 'lastModifiedTimes', 'pdfStateIntervals']) {
        TabManager[k].clear();
      }
      for (const k of ['unsavedChanges', 'externalChangeQueue', 'applyingSnippet']) TabManager[k].clear();
      TabManager.closedTabsStack.length = 0;
      TabManager.activeTab = null;
      TabManager.previewTab = null;
      TabManager.untitledCounter = 0;
      TabManager.isClosingTab = false;
      TabManager.overlayDelegate = null;
      clearInterval(TabManager.periodicCheckInterval);
      TabManager.periodicCheckInterval = null;
      document.getElementById('tabs-container').innerHTML = '';
      document.getElementById('monaco-editor').innerHTML = '';
      document.getElementById('editor-overlay').className = '';
      document.getElementById('context-path')?.remove();
      document.querySelectorAll('.confirm-modal').forEach((n) => n.remove());
      porArquivo.clear();
      editores.activeEditor = null;
      editores.ativo = null;
      editores.criar = (caminho, texto) => editorFalso(caminho, texto);
      dialogo.resposta = 'cancel';
      dialogo.pedidos.length = 0;
      avisos.length = 0;
      projeto.caminho = null;
      projeto.spf = null;
      spf.estrutura = {};
      spf.escritas = 0;
      processadores.length = 0;
      chamadas.length = 0;
      delete window.SplitEditorManager;
      delete window.SharedModelRegistry;
      delete window.monaco;
      delete window.t;
      delete window.showNotification;
      localStorage.clear();
    },
  };
}
