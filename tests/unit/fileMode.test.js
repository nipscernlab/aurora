// @vitest-environment happy-dom
//
// js/project/file_mode.js: o ProjectTreeManager, estado + ciclo de vida +
// persistencia da arvore de arquivos do projeto.
//
// Caracterizacao escrita em 09/10/2026, antes de o arquivo virar .ts e antes
// de a classificacao sintese/testbench passar a ser da pessoa (TODO 13b). Ate
// aqui nenhum teste de unidade passava pelo arquivo (0% de linhas). O que se
// prende e o comportamento de HOJE, inclusive o que vai mudar (a heuristica e
// a ordem alfabetica): quem mudar, muda o teste junto, de proposito.
//
// Falsos: a ponte com o Electron (um disco em memoria), o SpfStore (um .spf em
// memoria), o TabManager e os dois mixins de interface, que tem testes
// proprios (projectTreeRender, projectTreeActions). Reais: ProjectStore,
// processor_list, processor_source e o classificador.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const disco = vi.hoisted(() => ({
  arquivos: new Map(),   // caminho -> conteudo
  mtimes: new Map(),     // caminho -> mtime
  pastas: new Map(),     // pasta -> [nomes]
  spf: new Map(),        // caminho do .spf -> structure
  criados: [],
  atualizados: [],
}));

vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: {
    readFile: vi.fn(async (p) => {
      if (!disco.arquivos.has(p)) throw new Error(`ENOENT ${p}`);
      return disco.arquivos.get(p);
    }),
    fileExists: vi.fn(async (p) => {
      if (String(p).includes('EXPLODE')) throw new Error('fs quebrou');
      return disco.arquivos.has(p);
    }),
    getFileStats: vi.fn(async (p) => {
      if (String(p).includes('SEMSTAT')) throw new Error('stat falhou');
      return { mtime: disco.mtimes.get(p) ?? 1 };
    }),
    joinPath: vi.fn(async (...partes) => partes.join('/')),
    listFilesInDirectory: vi.fn(async (d) => {
      if (!disco.pastas.has(d)) throw new Error(`ENOENT ${d}`);
      return disco.pastas.get(d);
    }),
    getCurrentProject: vi.fn(async () => null),
    onProcessorCreated: vi.fn((cb) => { disco.criados.push(cb); }),
    onProcessorsUpdated: vi.fn((cb) => { disco.atualizados.push(cb); }),
  },
}));

vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn() } }));

vi.mock('../../js/project/spf_store.js', () => ({
  SpfStore: {
    read: vi.fn(async (p) => {
      if (!disco.spf.has(p)) throw new Error('spf ilegivel');
      return structuredClone(disco.spf.get(p));
    }),
    update: vi.fn(async (p, mutador) => {
      const cfg = structuredClone(disco.spf.get(p) || {});
      mutador(cfg);
      disco.spf.set(p, cfg);
    }),
  },
}));

vi.mock('../../js/project/project_tree_render.js', () => ({
  RenderMixin: { renderTree: vi.fn(), refreshEditorFocusHighlight: vi.fn() },
}));

vi.mock('../../js/project/project_tree_actions.js', () => ({
  ActionsMixin: {
    preventDefaults: vi.fn(),
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handleTreeContextMenu: vi.fn(),
    createNewFile: vi.fn(),
    deleteFile: vi.fn(),
    closeContextMenu: vi.fn(),
    _removeFileByPath: vi.fn(async () => {}),
    _deleteProcessorByName: vi.fn(async () => {}),
    confirmAndDismissMissingFiles: vi.fn(async () => {}),
  },
}));

let ProjectTreeManager;
let electronAPI;
let TabManager;
let SpfStore;
let ProjectStore;
let RenderMixin;
let ActionsMixin;

const RAIZ = 'C:/p';
const SPF = 'C:/p/p.spf';

function montarDom() {
  document.body.innerHTML = `
    <div class="file-tree-container"><div id="file-tree"></div></div>
    <button id="refresh-button"></button>`;
}

/** Instancia nova, ja com o init e o primeiro refresh assentados. */
async function novo() {
  const m = new ProjectTreeManager();
  await m.initPromise;
  while (m._refreshPromise) await m._refreshPromise;
  return m;
}

const SINTESE = 'module a(input clk, output y); assign y = clk; endmodule';
const TESTBENCH = 'module tb; initial begin $dumpvars; #10 $finish; end endmodule';

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  montarDom();
  ({ electronAPI } = await import('../../js/app/electron_api.js'));
  ({ TabManager } = await import('../../js/tabs/tab_manager.js'));
  ({ SpfStore } = await import('../../js/project/spf_store.js'));
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ({ RenderMixin } = await import('../../js/project/project_tree_render.js'));
  ({ ActionsMixin } = await import('../../js/project/project_tree_actions.js'));
  ({ ProjectTreeManager } = await import('../../js/project/file_mode.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  disco.arquivos.clear();
  disco.mtimes.clear();
  disco.pastas.clear();
  disco.spf.clear();
  disco.criados.length = 0;
  disco.atualizados.length = 0;
  montarDom();
  ProjectStore.clearProject();
  window.availableProcessors = [];
  delete window.showNotification;
  delete window.SplitEditorManager;
  delete window.treeView;
  delete window.fileTreeViewController;
  delete window.gtkwPickerManager;
});

/** Um projeto aberto com estas listas no .spf e estes arquivos no disco. */
function projeto({ synth = [], tb = [], arquivos = {} } = {}) {
  for (const [p, c] of Object.entries(arquivos)) disco.arquivos.set(p, c);
  disco.spf.set(SPF, { synthesizableFiles: synth, testbenchFiles: tb, topLevelFile: '', testbenchFile: '' });
  ProjectStore.setProject(SPF, RAIZ);
}

describe('modulo', () => {
  it('exporta a classe e o singleton, e pendura o singleton no window', async () => {
    const mod = await import('../../js/project/file_mode.js');
    expect(mod.projectTreeManager).toBeInstanceOf(ProjectTreeManager);
    expect(window.projectTreeManager).toBe(mod.projectTreeManager);
    expect(typeof ProjectTreeManager.prototype.renderTree).toBe('function');
    expect(typeof ProjectTreeManager.prototype.handleDrop).toBe('function');
  });
});

describe('init', () => {
  it('guarda os elementos e liga os ouvintes; sem projeto, nao ativa', async () => {
    const m = await novo();
    expect(m.elements.fileTree).toBe(document.getElementById('file-tree'));
    expect(m.elements.refreshButton).toBe(document.getElementById('refresh-button'));
    expect(m.isTreeActive).toBe(false);
    expect(m.ALLOWED_EXTENSIONS).toEqual(['.v', '.sv', '.vh', '.py']);
    expect(m.SOFTWARE_EXTENSIONS).toContain('.cmm');
    expect(electronAPI.getCurrentProject).toHaveBeenCalled();
  });

  it('com o documento ainda carregando, espera o DOMContentLoaded', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const m = new ProjectTreeManager();
    await Promise.resolve();
    expect(m.elements).toEqual({});
    delete document.readyState;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await m.initPromise;
    expect(m.elements.fileTree).toBe(document.getElementById('file-tree'));
  });

  it('falha no init vai para o console e nao derruba a instancia', async () => {
    const orig = ProjectTreeManager.prototype.cacheElements;
    ProjectTreeManager.prototype.cacheElements = () => { throw new Error('dom'); };
    try {
      const m = new ProjectTreeManager();
      await m.initPromise;
      expect(console.error).toHaveBeenCalledWith('Failed to initialize ProjectTreeManager:', expect.any(Error));
    } finally {
      ProjectTreeManager.prototype.cacheElements = orig;
    }
  });

  it('sem #file-tree no DOM, nao liga clique nem arrastar', async () => {
    document.body.innerHTML = '';
    const m = await novo();
    expect(m.elements.fileTree).toBeNull();
  });
});

describe('ouvintes de eventos', () => {
  async function ativo(opts) {
    projeto(opts);
    const m = await novo();
    expect(m.isTreeActive).toBe(true);
    m.refreshTree = vi.fn(async () => {});
    return m;
  }

  it('project-config-saved refaz a arvore so se ativa', async () => {
    const m = await ativo();
    document.dispatchEvent(new Event('project-config-saved'));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
    m.isTreeActive = false;
    document.dispatchEvent(new Event('project-config-saved'));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('aurora:spf-changed so reage ao .spf do projeto aberto', async () => {
    const m = await ativo();
    window.dispatchEvent(new CustomEvent('aurora:spf-changed', { detail: { spfPath: 'C:/outro.spf' } }));
    window.dispatchEvent(new CustomEvent('aurora:spf-changed', {}));
    expect(m.refreshTree).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('aurora:spf-changed', { detail: { spfPath: SPF } }));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('aurora:file-saved so reage a arquivo da arvore (sem diferenca de barra ou caixa)', async () => {
    const m = await ativo({ synth: [{ name: 'a.v', path: 'C:/p/a.v' }], arquivos: { 'C:/p/a.v': SINTESE } });
    window.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: { path: 'C:\\P\\b.v' } }));
    window.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: {} }));
    expect(m.refreshTree).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: { path: 'C:\\P\\A.v' } }));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
    m.isTreeActive = false;
    window.dispatchEvent(new CustomEvent('aurora:file-saved', { detail: { path: 'C:/p/a.v' } }));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('aurora:file-created reage a extensao de fonte', async () => {
    const m = await ativo();
    window.dispatchEvent(new CustomEvent('aurora:file-created', { detail: { path: 'C:/p/x.txt' } }));
    window.dispatchEvent(new CustomEvent('aurora:file-created', { detail: {} }));
    expect(m.refreshTree).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('aurora:file-created', { detail: { path: 'C:/p/X.SV' } }));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
    m.isTreeActive = false;
    window.dispatchEvent(new CustomEvent('aurora:file-created', { detail: { path: 'C:/p/y.v' } }));
    expect(m.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('aurora:editing-file-changed reacende o destaque', async () => {
    await ativo();
    document.dispatchEvent(new Event('aurora:editing-file-changed'));
    expect(RenderMixin.refreshEditorFocusHighlight).toHaveBeenCalled();
  });

  it('processador criado entra na lista e refaz; lista nova substitui e refaz', async () => {
    const m = await ativo();
    disco.criados.at(-1)({ processorName: 'cpu' });
    expect(window.availableProcessors).toEqual(['cpu']);
    disco.atualizados.at(-1)({ processors: ['dsp'] });
    expect(window.availableProcessors).toEqual(['dsp']);
    disco.atualizados.at(-1)({});
    expect(window.availableProcessors).toEqual(['dsp']);
    expect(m.refreshTree).toHaveBeenCalledTimes(3);
  });

  it('botao direito na arvore vai para o menu', async () => {
    await ativo();
    document.getElementById('file-tree').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(ActionsMixin.handleTreeContextMenu).toHaveBeenCalled();
  });

  it('arrastar sobre a arvore marca a area so quando ativa', async () => {
    const m = await ativo();
    const area = document.getElementById('file-tree');
    area.dispatchEvent(new Event('dragover', { bubbles: true }));
    expect(area.classList.contains('verilog-dragover')).toBe(true);
    area.classList.remove('verilog-dragover');
    m.isTreeActive = false;
    area.dispatchEvent(new Event('dragover', { bubbles: true }));
    expect(area.classList.contains('verilog-dragover')).toBe(false);
    for (const t of ['dragenter', 'dragleave', 'drop']) area.dispatchEvent(new Event(t, { bubbles: true }));
    expect(ActionsMixin.handleDragEnter).toHaveBeenCalled();
    expect(ActionsMixin.handleDragLeave).toHaveBeenCalled();
    expect(ActionsMixin.handleDrop).toHaveBeenCalled();
    expect(ActionsMixin.preventDefaults).toHaveBeenCalled();
  });
});

describe('clique e duplo clique nas linhas', () => {
  /** Arvore ativa com uma linha de a.v e o separador de um processador. */
  async function arvore() {
    projeto({ synth: [{ name: 'a.v', path: 'C:/p/a.v' }], arquivos: { 'C:/p/a.v': SINTESE } });
    const m = await novo();
    const arv = document.getElementById('file-tree');
    arv.innerHTML = `
      <div class="verilog-missing-notice"><button class="verilog-missing-dismiss"></button></div>
      <div class="verilog-processor-separator" data-processor-name="cpu"><button class="verilog-processor-delete"></button></div>
      <div class="verilog-processor-separator" data-processor-name="__imported__"><button class="verilog-processor-delete" id="imp"></button></div>
      <div class="verilog-file-item" data-file-path="C:/p/a.v"><span class="nome"></span><button data-action="delete"></button></div>
      <div class="verilog-file-item" data-file-path="C:/p/sumiu.v"><span class="nome"></span></div>
      <div class="verilog-file-item"><span class="nome"></span></div>
      <div class="solto"></div>`;
    return { m, arv };
  }
  const clicar = async (el, tipo = 'click') => {
    el.dispatchEvent(new MouseEvent(tipo, { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('aviso de arquivos sumidos, lixeira do processador e lixeira da linha', async () => {
    const { arv } = await arvore();
    await clicar(arv.querySelector('.verilog-missing-dismiss'));
    expect(ActionsMixin.confirmAndDismissMissingFiles).toHaveBeenCalledTimes(1);
    await clicar(arv.querySelector('.verilog-processor-delete'));
    expect(ActionsMixin._deleteProcessorByName).toHaveBeenCalledWith('cpu');
    await clicar(arv.querySelector('#imp'));
    expect(ActionsMixin._deleteProcessorByName).toHaveBeenCalledTimes(1);
    await clicar(arv.querySelector('[data-action="delete"]'));
    expect(ActionsMixin._removeFileByPath).toHaveBeenCalledWith('C:/p/a.v');
  });

  it('clique abre como previa; duplo clique abre fixo; split focado recebe', async () => {
    const { arv } = await arvore();
    const linha = arv.querySelector('[data-file-path="C:/p/a.v"] .nome');
    await clicar(linha);
    expect(TabManager.addTab).toHaveBeenLastCalledWith('C:/p/a.v', SINTESE, { preview: true });
    await clicar(linha, 'dblclick');
    expect(TabManager.addTab).toHaveBeenLastCalledWith('C:/p/a.v', SINTESE, { preview: false });
    window.SplitEditorManager = { focusedPane: 1, openInFocusedPane: vi.fn(async () => {}) };
    await clicar(linha);
    expect(window.SplitEditorManager.openInFocusedPane).toHaveBeenCalledWith('C:/p/a.v', SINTESE, { preview: true });
  });

  it('clique fora de linha, linha sem caminho ou fora da lista, e arvore inativa: nada', async () => {
    const { m, arv } = await arvore();
    await clicar(arv.querySelector('.solto'));
    await clicar(arv.querySelector('.verilog-file-item:not([data-file-path]) .nome'));
    await clicar(arv.querySelector('[data-file-path="C:/p/sumiu.v"] .nome'));
    for (const sel of ['.solto', '.verilog-file-item:not([data-file-path]) .nome', '[data-file-path="C:/p/sumiu.v"] .nome', '[data-action="delete"]']) {
      await clicar(arv.querySelector(sel), 'dblclick');
    }
    expect(TabManager.addTab).not.toHaveBeenCalled();
    m.isTreeActive = false;
    await clicar(arv.querySelector('[data-file-path="C:/p/a.v"] .nome'));
    await clicar(arv.querySelector('[data-file-path="C:/p/a.v"] .nome'), 'dblclick');
    expect(TabManager.addTab).not.toHaveBeenCalled();
  });

  it('erro ao ler o arquivo vira notificacao, traduzida quando ha i18n', async () => {
    const { arv } = await arvore();
    disco.arquivos.delete('C:/p/a.v');
    window.showNotification = vi.fn();
    await clicar(arv.querySelector('[data-file-path="C:/p/a.v"] .nome'));
    expect(window.showNotification).toHaveBeenLastCalledWith('Error opening file: a.v', 'error', 3000);
    window.t = vi.fn(() => 'Erro ao abrir');
    await clicar(arv.querySelector('[data-file-path="C:/p/a.v"] .nome'));
    expect(window.showNotification).toHaveBeenLastCalledWith('Erro ao abrir', 'error', 3000);
    delete window.t;
  });
});

describe('ajudantes de caminho', () => {
  it('ordem: topo primeiro, depois alfabetica', async () => {
    const m = await novo();
    m.verilogFiles = [{ name: 'c.v' }, { name: 'b.v', isTopLevel: true }, { name: 'a.v' }];
    m.sortFilesAlphabetically();
    expect(m.verilogFiles.map((f) => f.name)).toEqual(['b.v', 'a.v', 'c.v']);
    m.verilogFiles = [{ name: 'a.v', isTopLevel: true }, { name: 'b.v' }];
    m.sortFilesAlphabetically();
    expect(m.verilogFiles.map((f) => f.name)).toEqual(['a.v', 'b.v']);
  });

  it('extensao e caminho normalizado', async () => {
    const m = await novo();
    expect(m.getFileExtension('A.SV')).toBe('.sv');
    expect(m.getFileExtension('Makefile')).toBe('');
    expect(m._normalizePath('C:\\P\\A.v')).toBe('c:/p/a.v');
    expect(m._normalizePath(undefined)).toBe('');
  });

  it('dono de um arquivo: <proj>/<proc>/{Hardware,Software,Simulation}/', async () => {
    const m = await novo();
    const f = (path) => m._getProcessorForFile({ path });
    expect(f('C:/p/cpu/Hardware/cpu.v')).toBeNull(); // sem projeto
    ProjectStore.setProject(SPF, RAIZ);
    expect(f('C:/p/cpu/Hardware/cpu.v')).toBeNull(); // sem processadores
    window.availableProcessors = ['CPU'];
    expect(m._getProcessorForFile(null)).toBeNull();
    expect(f('C:/q/cpu/Hardware/cpu.v')).toBeNull();
    expect(f('C:/p/cpu/cpu.v')).toBeNull();
    expect(f('C:/p/cpu/Outra/cpu.v')).toBeNull();
    expect(f('C:\\p\\cpu\\Software\\cpu.cmm')).toBe('CPU');
    expect(f('C:/p/cpu/Simulation/tb.v')).toBe('CPU');
    expect(f('C:/p/dsp/Hardware/dsp.v')).toBeNull();
    window.availableProcessors = 'nao e lista';
    expect(f('C:/p/cpu/Hardware/cpu.v')).toBeNull();
  });
});

describe('_discoverProcessorFiles', () => {
  it('sem projeto ou sem processadores, nada', async () => {
    const m = await novo();
    expect(await m._discoverProcessorFiles()).toEqual({ addedPersist: 0, addedSoftware: 0 });
    ProjectStore.setProject(SPF, RAIZ);
    window.availableProcessors = undefined;
    expect(await m._discoverProcessorFiles()).toEqual({ addedPersist: 0, addedSoftware: 0 });
  });

  it('Verilog entra como sintese (persistivel), fonte do processador como software', async () => {
    const m = await novo();
    ProjectStore.setProject(SPF, RAIZ);
    window.availableProcessors = ['cpu'];
    disco.pastas.set('C:/p/cpu/Hardware', ['cpu.v', 'notas.txt', 42, 'JA.V']);
    disco.pastas.set('C:/p/cpu/Software', ['cpu.cmm', 'cpu.asm']);
    disco.pastas.set('C:/p/cpu/Simulation', 'nao e lista');
    m.verilogFiles = [{ name: 'JA.V', path: 'c:\\p\\cpu\\hardware\\ja.v' }];
    expect(await m._discoverProcessorFiles()).toEqual({ addedPersist: 1, addedSoftware: 1 });
    expect(m.verilogFiles.slice(1)).toEqual([
      { name: 'cpu.v', path: 'C:/p/cpu/Hardware/cpu.v', isTopLevel: false, category: 'synthesizable' },
      { name: 'cpu.cmm', path: 'C:/p/cpu/Software/cpu.cmm', isTopLevel: false, category: 'synthesizable', isSoftware: true },
    ]);
  });
});

describe('_classifyAll', () => {
  it('pela heuristica: .py e testbench, o conteudo decide o .v, o topo nao muda', async () => {
    const m = await novo();
    disco.arquivos.set('C:/p/a.v', SINTESE);
    disco.arquivos.set('C:/p/tb.v', TESTBENCH);
    m.verilogFiles = [
      { name: 'sw.cmm', path: 'C:/p/cpu/Software/sw.cmm', isSoftware: true, category: 'synthesizable' },
      { name: 't.py', path: 'C:/p/t.py', category: 'synthesizable', isTopLevel: true },
      { name: 'u.py', path: 'C:/p/u.py', category: 'testbench' },
      { name: 'top.v', path: 'C:/p/top.v', category: 'synthesizable', isTopLevel: true },
      { name: 'a.v', path: 'C:/p/a.v', category: 'testbench', isTopLevel: false },
      { name: 'tb.v', path: 'C:/p/tb.v', category: 'testbench' },
    ];
    expect(await m._classifyAll()).toBe(true);
    expect(m.verilogFiles.map((f) => [f.name, f.category, f.isTopLevel])).toEqual([
      ['sw.cmm', 'synthesizable', undefined],
      ['t.py', 'testbench', false],
      ['u.py', 'testbench', undefined],
      ['top.v', 'synthesizable', true],
      ['a.v', 'synthesizable', false],
      ['tb.v', 'testbench', undefined],
    ]);
    // Segunda passada: tudo igual, e o cache por mtime evita reler.
    electronAPI.readFile.mockClear();
    expect(await m._classifyAll()).toBe(false);
    expect(electronAPI.readFile).not.toHaveBeenCalled();
  });

  it('sem stat le sempre; ilegivel mantem a categoria (ou sintese, sem nenhuma)', async () => {
    const m = await novo();
    disco.arquivos.set('C:/p/SEMSTAT.v', TESTBENCH);
    m.verilogFiles = [
      { name: 'SEMSTAT.v', path: 'C:/p/SEMSTAT.v', category: 'synthesizable' },
      { name: 'x.v', path: 'C:/p/x.v', category: 'testbench' },
      { name: 'y.v', path: 'C:/p/y.v' },
    ];
    expect(await m._classifyAll()).toBe(true);
    expect(m.verilogFiles.map((f) => f.category)).toEqual(['testbench', 'testbench', 'synthesizable']);
    expect(await m._classifyAll()).toBe(false);
  });
});

describe('reset', () => {
  it('avanca a epoca, desativa, esvazia e limpa o que a arvore pintou', async () => {
    const m = await novo();
    const conteiner = document.createElement('div');
    conteiner.innerHTML = '<div class="verilog-file-item"></div><div class="verilog-processor-separator"></div><div class="verilog-missing-notice"></div><p>fica</p>';
    window.treeView = { getContainer: () => conteiner };
    m.isTreeActive = true;
    m.verilogFiles = [{}];
    const epoca = m._projectEpoch;
    m.reset();
    expect(m._projectEpoch).toBe(epoca + 1);
    expect(m.isTreeActive).toBe(false);
    expect(m.verilogFiles).toEqual([]);
    expect(m.missingFiles).toEqual([]);
    expect(conteiner.innerHTML).toBe('<p>fica</p>');
    delete window.treeView;
    m.reset();
  });
});

describe('refreshTree', () => {
  it('descobre o projeto pelo main (objeto ou texto) quando ninguem o abriu', async () => {
    const m = await novo();
    disco.spf.set(SPF, {});
    electronAPI.getCurrentProject.mockResolvedValueOnce({ projectPath: RAIZ, spfPath: SPF });
    await m.refreshTree();
    expect(ProjectStore.getProjectPath()).toBe(RAIZ);
    expect(ProjectStore.getSpfPath()).toBe(SPF);

    ProjectStore.clearProject();
    electronAPI.getCurrentProject.mockResolvedValueOnce('C:/q');
    await m.refreshTree();
    expect(ProjectStore.getProjectPath()).toBe('C:/q');
    expect(ProjectStore.getSpfPath()).toBeNull();

    ProjectStore.clearProject();
    electronAPI.getCurrentProject.mockResolvedValueOnce({});
    await m.refreshTree();
    expect(ProjectStore.hasProject()).toBe(false);

    electronAPI.getCurrentProject.mockRejectedValueOnce(new Error('ipc'));
    await m.refreshTree();
    expect(console.error).toHaveBeenCalledWith('Error getting project path:', expect.any(Error));
  });

  it('primeira ativacao troca a vista; chamadas em voo se juntam e repetem uma vez', async () => {
    projeto();
    window.fileTreeViewController = { showFileMode: vi.fn() };
    const m = new ProjectTreeManager();
    m.initPromise = null;
    const a = m.refreshTree();
    const b = m.refreshTree();
    await Promise.all([a, b]);
    expect(window.fileTreeViewController.showFileMode).toHaveBeenCalledTimes(1);
    expect(SpfStore.read.mock.calls.filter(([p]) => p === SPF).length).toBeGreaterThanOrEqual(2);
    expect(m._refreshPromise).toBeNull();
    await m.refreshTree();
    expect(window.fileTreeViewController.showFileMode).toHaveBeenCalledTimes(1);
  });

  it('activateTree e so um apelido', async () => {
    const m = await novo();
    m.refreshTree = vi.fn(async () => 'ok');
    expect(await m.activateTree()).toBe('ok');
  });

  it('init que rejeita nao impede o refresh', async () => {
    const m = await novo();
    m.initPromise = Promise.reject(new Error('x'));
    await m.refreshTree();
  });
});

describe('saveConfiguration', () => {
  it('sem .spf, so registra', async () => {
    const m = await novo();
    await m.saveConfiguration();
    expect(console.error).toHaveBeenCalledWith('Spf path not available for sync');
    expect(SpfStore.update).not.toHaveBeenCalled();
  });

  it('separa sintese e testbench, deixa software de fora, e acha os dois topos', async () => {
    projeto();
    const m = await novo();
    window.gtkwPickerManager = { refresh: vi.fn() };
    m.verilogFiles = [
      { name: 'top.v', path: 'C:/p/top.v', isTopLevel: true, category: 'synthesizable' },
      { name: 'a.v', path: 'C:/p/a.v', category: 'synthesizable' },
      { name: 'tb.v', path: 'C:/p/tb.v', isTopLevel: true, category: 'testbench' },
      { name: 'cpu.cmm', path: 'C:/p/cpu/Software/cpu.cmm', isSoftware: true, category: 'synthesizable' },
    ];
    await m.saveConfiguration();
    expect(disco.spf.get(SPF)).toMatchObject({
      synthesizableFiles: [
        { name: 'top.v', path: 'C:/p/top.v', isTopLevel: true },
        { name: 'a.v', path: 'C:/p/a.v', isTopLevel: false },
      ],
      testbenchFiles: [{ name: 'tb.v', path: 'C:/p/tb.v', isTopLevel: true }],
      topLevelFile: 'C:/p/top.v',
      testbenchFile: 'C:/p/tb.v',
    });
    expect(window.gtkwPickerManager.refresh).toHaveBeenCalled();

    m.verilogFiles = [];
    await m.saveConfiguration('C:/outro.spf');
    expect(disco.spf.get('C:/outro.spf')).toMatchObject({ topLevelFile: '', testbenchFile: '' });
  });

  it('falha na escrita vai para o console', async () => {
    projeto();
    const m = await novo();
    SpfStore.update.mockRejectedValueOnce(new Error('disco cheio'));
    await m.saveConfiguration();
    expect(console.error).toHaveBeenCalledWith('Error saving configuration:', expect.any(Error));
  });
});

describe('loadConfiguration', () => {
  it('sem .spf, so registra', async () => {
    const m = await novo();
    await m.loadConfiguration();
    expect(console.error).toHaveBeenCalledWith('Spf path not available');
  });

  it('le as duas listas, separa o que sumiu, deduplica, reclassifica, ordena e regrava', async () => {
    projeto({
      synth: [
        { name: 'z.v', path: 'C:/p/z.v' },
        { name: 'rng.v', path: 'C:/p/rng.v' },
        { name: 'sumiu.v', path: 'C:/p/sumiu.v' },
        { name: 'EXPLODE.v', path: 'C:/p/EXPLODE.v' },
        { path: 'C:/p/sem_nome.v' },
        { name: 'z.v', path: 'c:\\p\\Z.v' },
      ],
      tb: [
        { name: 'tb.v', path: 'C:/p/tb.v', isMarkedTestbench: true },
        { name: 'a.v', path: 'C:/p/a.v', isTopLevel: true },
        { name: 'foi.v', path: 'C:/p/foi.v' },
        { name: 'EXPLODE_tb.v', path: 'C:/p/EXPLODE_tb.v' },
        { name: 'sem_caminho.v' },
      ],
      arquivos: {
        'C:/p/z.v': SINTESE, 'c:\\p\\Z.v': SINTESE, 'C:/p/rng.v': TESTBENCH,
        'C:/p/tb.v': TESTBENCH, 'C:/p/a.v': SINTESE,
      },
    });
    const m = await novo();
    expect(m.missingFiles).toEqual([
      { name: 'sumiu.v', path: 'C:/p/sumiu.v', category: 'synthesizable' },
      { name: 'foi.v', path: 'C:/p/foi.v', category: 'testbench' },
    ]);
    // a.v estava no .spf como topo do testbench: a heuristica nao mexe em topo.
    expect(m.verilogFiles.map((f) => [f.name, f.category, f.isTopLevel])).toEqual([
      ['a.v', 'testbench', true],
      ['tb.v', 'testbench', true],
      ['rng.v', 'testbench', false],
      ['z.v', 'synthesizable', false],
    ]);
    expect(console.warn).toHaveBeenCalledWith('Dropped 1 duplicate file entries from .spf');
    // rng.v mudou de papel: o .spf e regravado, na ordem da arvore.
    expect(disco.spf.get(SPF).synthesizableFiles.map((f) => f.name)).toEqual(['z.v']);
    expect(disco.spf.get(SPF).testbenchFiles.map((f) => f.name)).toEqual(['a.v', 'tb.v', 'rng.v']);
  });

  it('nada mudou: nao regrava', async () => {
    projeto({ synth: [{ name: 'a.v', path: 'C:/p/a.v' }], arquivos: { 'C:/p/a.v': SINTESE } });
    await novo();
    expect(SpfStore.update).not.toHaveBeenCalled();
  });

  it('arquivo do processador descoberto: regrava', async () => {
    projeto();
    window.availableProcessors = ['cpu'];
    disco.pastas.set('C:/p/cpu/Hardware', ['cpu.v']);
    disco.arquivos.set('C:/p/cpu/Hardware/cpu.v', SINTESE);
    await novo();
    expect(disco.spf.get(SPF).synthesizableFiles.map((f) => f.name)).toEqual(['cpu.v']);
  });

  it('projeto trocado no meio da leitura: descarta sem tocar a arvore', async () => {
    projeto({ synth: [{ name: 'a.v', path: 'C:/p/a.v' }], arquivos: { 'C:/p/a.v': SINTESE } });
    const m = await novo();
    m.verilogFiles = ['antes'];
    electronAPI.fileExists.mockImplementationOnce(async () => { m._projectEpoch++; return true; });
    await m.loadConfiguration();
    expect(m.verilogFiles).toEqual(['antes']);
    expect(console.log).toHaveBeenCalledWith('loadConfiguration: project switched mid-load, discarding stale read of', SPF);
  });

  it('projeto trocado antes de regravar: nao grava no .spf de ninguem', async () => {
    projeto({ synth: [{ name: 'tb.v', path: 'C:/p/tb.v' }], arquivos: { 'C:/p/tb.v': TESTBENCH } });
    const m = await novo();
    SpfStore.update.mockClear();
    m._classifyCache = new Map();
    disco.spf.get(SPF).synthesizableFiles = [{ name: 'tb.v', path: 'C:/p/tb.v' }];
    disco.spf.get(SPF).testbenchFiles = [];
    const orig = m._classifyAll.bind(m);
    m._classifyAll = async () => { const r = await orig(); m._projectEpoch++; return r; };
    await m.loadConfiguration();
    expect(SpfStore.update).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('loadConfiguration: project switched before save, skipping persist to', SPF);
  });

  it('.spf ilegivel vai para o console', async () => {
    ProjectStore.setProject(SPF, RAIZ);
    const m = await novo();
    expect(console.error).toHaveBeenCalledWith('Error loading configuration:', expect.any(Error));
    expect(m.verilogFiles).toEqual([]);
  });

  it('listas ausentes no .spf: arvore vazia', async () => {
    disco.spf.set(SPF, {});
    ProjectStore.setProject(SPF, RAIZ);
    const m = await novo();
    expect(m.verilogFiles).toEqual([]);
  });
});

describe('showNotification', () => {
  it('usa a notificacao global, ou o console sem ela', async () => {
    const m = await novo();
    m.showNotification('oi');
    expect(console.log).toHaveBeenCalledWith('[INFO] oi');
    window.showNotification = vi.fn();
    m.showNotification('ui', 'error', 10);
    expect(window.showNotification).toHaveBeenCalledWith('ui', 'error', 10);
  });
});
