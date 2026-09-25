// @vitest-environment happy-dom
//
// O namespace AuroraAPI.wave (js/api/wave_ns): sinais, simulador,
// visualizador e os layouts do GTKWave e do Surfer do testbench ativo. O
// disco e o WaveStore sao falsos e em memoria; o resto e o codigo de verdade.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const disco = new Map();          // caminho -> conteudo
const pastas = new Map();         // pasta -> [{ path, isDirectory }]
const electronAPI = {
  fileExists: vi.fn(async (p) => disco.has(p)),
  joinPath: vi.fn(async (...p) => p.join('\\')),
  writeFile: vi.fn(async (p, c) => { disco.set(p, c); }),
  getFolderFiles: vi.fn(async (d) => pastas.get(d) || []),
  getComponentsPath: vi.fn(async () => 'C:\\comp'),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

const spf = { testbenchFile: 'C:\\p\\tb_top.v' };
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: { read: vi.fn(async () => spf) } }));

const estados = new Map();
const waveStore = {
  read: vi.fn(async (proj, tb) => estados.get(`${proj}|${tb}`) || { gtkwFiles: [], surferFiles: [] }),
  update: vi.fn(async (proj, tb, fn) => {
    const k = `${proj}|${tb}`;
    const s = estados.get(k) || {};
    await fn(s);
    estados.set(k, s);
    return s;
  }),
};
vi.mock('../../js/wave/wave_state_store.js', () => ({ WaveStore: waveStore }));
vi.mock('../../js/compilation/wave_toolchain.js', () => ({ resolveWaveToolchain: vi.fn(async () => ({ surferBin: 'x' })) }));

let wave;
let ProjectStore;
let api;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  disco.clear();
  pastas.clear();
  estados.clear();
  localStorage.clear();
  spf.testbenchFile = 'C:\\p\\tb_top.v';
  document.body.innerHTML = '';
  for (const k of ['waveConfigManager', 'compilationModule', 'gtkwPickerManager']) delete window[k];
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  api = await import('../../js/api/api_core.js');
  ({ waveNs: wave } = await import('../../js/api/wave_ns.js'));
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
  pastas.set('C:\\p', [
    { path: 'C:\\p\\view.gtkw' },
    { path: 'C:\\p\\sub', isDirectory: true },
    { path: 'C:\\p\\a.surf.ron' },
    { path: 'C:\\p\\top.v' },
  ]);
  pastas.set('C:\\p\\sub', [{ path: 'C:\\p\\sub\\view2.gtkw' }, { path: 'C:\\p\\sub\\b.sucl' }]);
  for (const f of ['C:\\p\\view.gtkw', 'C:\\p\\sub\\view2.gtkw', 'C:\\p\\a.surf.ron', 'C:\\p\\sub\\b.sucl']) disco.set(f, '');
});

const msg = (r) => r.error?.message;

describe('sinais e o modal Wave Configuration', () => {
  const tree = { scopePath: 'tb', signals: [{ name: 'clk' }], children: [{ scopePath: 'tb.dut', signals: [{ name: 'acc' }] }] };

  it('sem o modal, os tres metodos dizem que nao esta disponivel', async () => {
    for (const r of [await wave.listSignals(), await wave.setSignals([]), await wave.openConfig()]) {
      expect(msg(r)).toBe('Wave Configuration is not available');
    }
  });

  it('lista todos os sinais e os marcados, carregando a arvore se preciso', async () => {
    const wc = { tree: null, selected: new Set(['tb.clk']), refresh: vi.fn(async () => { wc.tree = tree; }) };
    window.waveConfigManager = wc;
    const r = await wave.listSignals();
    expect(r.data).toEqual({ all: ['tb.clk', 'tb.dut.acc'], selected: ['tb.clk'] });
  });

  it('sem arvore mesmo depois de carregar, lista vazia', async () => {
    window.waveConfigManager = { tree: null, refresh: vi.fn(async () => { throw new Error('x'); }) };
    expect((await wave.listSignals()).data).toEqual({ all: [], selected: [] });
  });

  it('marcar sinais guarda so os que existem, salva e avisa', async () => {
    const wc = { tree, selected: new Set(), refresh: vi.fn(), renderTree: vi.fn(), save: vi.fn(async () => {}) };
    window.waveConfigManager = wc;
    const ouvinte = vi.fn();
    api.on('wave:signals-changed', ouvinte);
    const r = await wave.setSignals(['tb.dut.acc', 'tb.nada']);
    expect(r.data).toEqual({ selected: ['tb.dut.acc'], ignored: ['tb.nada'] });
    expect([...wc.selected]).toEqual(['tb.dut.acc']);
    expect(wc.renderTree).toHaveBeenCalled();
    expect(wc.save).toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalled();
    expect((await wave.setSignals('nao e lista')).data.selected).toEqual([]);
  });

  it('marcar sinais sem arvore: o erro de carregar, ou nenhum sinal descoberto', async () => {
    window.waveConfigManager = { tree: null, refresh: vi.fn(async () => { throw new Error('sem tb'); }) };
    expect(msg(await wave.setSignals([]))).toBe('sem tb');
    window.waveConfigManager = { tree: null, refresh: vi.fn(async () => { throw {}; }) };
    expect(msg(await wave.setSignals([]))).toBe('could not load signals');
    window.waveConfigManager = { tree: null, refresh: vi.fn(async () => {}) };
    expect(msg(await wave.setSignals([]))).toMatch(/no signals discovered/);
  });

  it('abrir o modal, e o erro dele', async () => {
    window.waveConfigManager = { open: vi.fn(async () => {}) };
    expect((await wave.openConfig()).ok).toBe(true);
    window.waveConfigManager = { open: vi.fn(async () => { throw new Error('quebrou'); }) };
    expect(msg(await wave.openConfig())).toBe('quebrou');
    window.waveConfigManager = { open: vi.fn(async () => { throw {}; }) };
    expect(msg(await wave.openConfig())).toBe('could not open Wave Configuration');
  });
});

describe('simulador, visualizador e janelas do Surfer', () => {
  it('simulador: le, grava, avisa a barra e recusa o desconhecido', async () => {
    expect((await wave.getSimulator()).data).toEqual({ simulator: 'iverilog' });
    const barra = vi.fn();
    window.addEventListener('aurora:wave-simulator-changed', barra);
    expect((await wave.setSimulator({ simulator: 'verilator' })).data).toEqual({ simulator: 'verilator' });
    window.removeEventListener('aurora:wave-simulator-changed', barra);
    expect(barra).toHaveBeenCalled();
    expect((await wave.getSimulator()).data.simulator).toBe('verilator');
    expect(msg(await wave.setSimulator({ simulator: 'modelsim' }))).toMatch(/iverilog/);
    expect(msg(await wave.setSimulator())).toMatch(/iverilog/);
  });

  it('visualizador: le, grava, avisa a barra e recusa o desconhecido', async () => {
    expect((await wave.getViewer()).data).toEqual({ viewer: 'gtkwave' });
    const barra = vi.fn();
    window.addEventListener('aurora:wave-viewer-changed', barra);
    expect((await wave.setViewer({ viewer: 'surfer' })).data).toEqual({ viewer: 'surfer' });
    window.removeEventListener('aurora:wave-viewer-changed', barra);
    expect(barra).toHaveBeenCalled();
    expect(msg(await wave.setViewer({ viewer: 'x' }))).toMatch(/gtkwave/);
    expect(msg(await wave.setViewer())).toMatch(/gtkwave/);
  });

  it('janelas do Surfer: exige booleano e sincroniza o checkbox do modal', async () => {
    document.body.innerHTML = '<input type="checkbox" id="waveConfigSurferMultiWindow">';
    expect((await wave.getSurferMultiWindow()).data).toEqual({ multiWindow: false });
    expect((await wave.setSurferMultiWindow({ enabled: true })).data).toEqual({ multiWindow: true });
    expect(document.getElementById('waveConfigSurferMultiWindow').checked).toBe(true);
    expect(msg(await wave.setSurferMultiWindow({ enabled: 'sim' }))).toMatch(/boolean/);
    expect(msg(await wave.setSurferMultiWindow())).toMatch(/boolean/);
  });
});

// Os dois visualizadores passam pelos mesmos casos, cada um com a sua
// extensao, o seu campo no WaveStore e as suas mensagens.
const TIPOS = [
  {
    nome: 'GTKWave',
    campo: 'gtkwFiles',
    list: 'listGtkwFiles', find: 'findGtkwFiles', use: 'useGtkwByName', add: 'addGtkwFile',
    active: 'setActiveGtkwFile', remove: 'removeGtkwFile',
    arquivo: 'C:\\p\\view.gtkw', rel: 'view.gtkw', outro: 'C:\\p\\top.v',
    unico: { q: 'view2', name: 'view2.gtkw', relPath: 'sub/view2.gtkw', path: 'C:\\p\\sub\\view2.gtkw' },
    qAmbiguo: 'vie',
    msgAceita: 'only .gtkw files are accepted',
    msgSemNome: 'name required (the .gtkw file name)',
    msgNenhum: 'no .gtkw matching "zzz" found in the project',
    msgAmbiguo: '"vie" matches 2 .gtkw files (view.gtkw, sub/view2.gtkw). Re-run with a more specific name, or add the exact path.',
    msgNaoRegistrado: '.gtkw not registered — call add_gtkw_file first: C:\\p\\nada.gtkw',
    msgNaoNaLista: '.gtkw not in list: C:\\p\\nada.gtkw',
    nada: 'C:\\p\\nada.gtkw',
    falhas: ['addGtkwFile failed', 'setActiveGtkwFile failed', 'removeGtkwFile failed'],
  },
  {
    nome: 'Surfer',
    campo: 'surferFiles',
    list: 'listSurferFiles', find: 'findSurferFiles', use: 'useSurferByName', add: 'addSurferFile',
    active: 'setActiveSurferFile', remove: 'removeSurferFile',
    arquivo: 'C:\\p\\a.surf.ron', rel: 'a.surf.ron', outro: 'C:\\p\\top.v',
    unico: { q: 'a', name: 'a.surf.ron', relPath: 'a.surf.ron', path: 'C:\\p\\a.surf.ron' },
    qAmbiguo: 's',
    msgAceita: 'only .surf.ron / .sucl files are accepted',
    msgSemNome: 'name required (the Surfer layout file name)',
    msgNenhum: 'no Surfer layout (.surf.ron/.sucl) matching "zzz" found in the project',
    msgAmbiguo: '"s" matches 2 Surfer layouts (sub/b.sucl, a.surf.ron). Re-run with a more specific name.',
    msgNaoRegistrado: 'Surfer layout not registered — call add_surfer_file first: C:\\p\\nada.sucl',
    msgNaoNaLista: 'Surfer layout not in list: C:\\p\\nada.sucl',
    nada: 'C:\\p\\nada.sucl',
    falhas: ['addSurferFile failed', 'setActiveSurferFile failed', 'removeSurferFile failed'],
  },
];

describe.each(TIPOS)('layouts do $nome', (t) => {
  const chave = 'C:\\p|tb_top';
  const lista = () => estados.get(chave)?.[t.campo] || [];

  it('sem projeto aberto, todos os metodos recusam', async () => {
    ProjectStore.clearProject();
    for (const r of [
      await wave[t.list](), await wave[t.find](''), await wave[t.add]({ filePath: t.arquivo }),
      await wave[t.active](t.arquivo), await wave[t.remove](t.arquivo),
    ]) {
      expect(msg(r)).toBe('No project open');
    }
  });

  it('sem testbench marcado, a mensagem longa para listar e registrar, a curta para ativar e remover', async () => {
    spf.testbenchFile = '';
    expect(msg(await wave[t.list]())).toBe('No testbench top set — mark a testbench top first');
    expect(msg(await wave[t.add]({ filePath: t.arquivo }))).toBe('No testbench top set — mark a testbench top first');
    expect(msg(await wave[t.active](t.arquivo))).toBe('No testbench top set');
    expect(msg(await wave[t.remove](t.arquivo))).toBe('No testbench top set');
  });

  it('registrar: recusa sem caminho, com extensao errada ou arquivo inexistente', async () => {
    expect(msg(await wave[t.add]())).toBe('filePath required');
    expect(msg(await wave[t.add]({ filePath: t.outro }))).toBe(t.msgAceita);
    expect(msg(await wave[t.add]({ filePath: t.nada }))).toBe(`file not found: ${t.nada}`);
    electronAPI.fileExists.mockRejectedValueOnce(new Error('ipc'));
    expect(msg(await wave[t.add]({ filePath: t.arquivo }))).toBe('ipc');
    electronAPI.fileExists.mockRejectedValueOnce({});
    expect(msg(await wave[t.add]({ filePath: t.arquivo }))).toBe('fileExists failed');
  });

  it('registrar, listar, ativar, desativar e remover, no testbench ativo', async () => {
    const refresh = vi.fn();
    window.gtkwPickerManager = { refresh };
    expect((await wave[t.add]({ filePath: t.arquivo })).data).toEqual({ path: t.arquivo, isActive: true });
    // caminho relativo resolve na raiz do projeto; registrar de novo nao duplica
    const rel = await wave[t.add]({ filePath: `\\${t.rel}`, setActive: false });
    expect(rel.data).toEqual({ path: t.arquivo, isActive: false });
    expect(lista()).toHaveLength(1);
    expect(lista()[0].isActive).toBe(true);

    const l = await wave[t.list]();
    expect(l.data).toEqual({ testbench: 'tb_top', files: [{ name: t.rel, path: t.arquivo, isActive: true }] });

    expect((await wave[t.active](null)).data).toEqual({ active: null });
    expect(lista()[0].isActive).toBe(false);
    expect((await wave[t.active](t.arquivo)).data).toEqual({ active: t.arquivo });
    expect(lista()[0].isActive).toBe(true);
    expect(msg(await wave[t.active](t.nada))).toBe(t.msgNaoRegistrado);

    expect(msg(await wave[t.remove]())).toBe('filePath required');
    expect(msg(await wave[t.remove](t.nada))).toBe(t.msgNaoNaLista);
    expect((await wave[t.remove](t.arquivo)).data).toEqual({ removed: 1 });
    expect(lista()).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it('lista com entrada sem nome usa o nome do arquivo; estado sem lista vira lista vazia', async () => {
    estados.set(chave, { [t.campo]: [{ path: t.arquivo }, {}] });
    expect((await wave[t.list]()).data.files).toEqual([
      { name: t.rel, path: t.arquivo, isActive: false },
      { name: '', path: '', isActive: false },
    ]);
    estados.set(chave, {});
    expect((await wave[t.list]()).data.files).toEqual([]);
  });

  it('o WaveStore que falha vira erro com a mensagem dele, ou a do metodo', async () => {
    for (const [metodo, arg, padrao] of [[t.add, { filePath: t.arquivo }, t.falhas[0]], [t.active, t.arquivo, t.falhas[1]], [t.remove, t.arquivo, t.falhas[2]]]) {
      waveStore.update.mockRejectedValueOnce(new Error('disco cheio'));
      expect(msg(await wave[metodo](arg))).toBe('disco cheio');
      waveStore.update.mockRejectedValueOnce({});
      expect(msg(await wave[metodo](arg))).toBe(padrao);
    }
  });

  it('achar pelo nome em todo o projeto, e usar pelo nome', async () => {
    const todos = await wave[t.find]();
    expect(todos.data.count).toBe(2);
    expect(todos.data.query).toBeNull();
    const um = await wave[t.find](t.unico.q);
    expect(um.data.files).toEqual([{ name: t.unico.name, relPath: t.unico.relPath, path: t.unico.path }]);

    expect(msg(await wave[t.use]())).toBe(t.msgSemNome);
    expect(msg(await wave[t.use]('zzz'))).toBe(t.msgNenhum);
    const amb = await wave[t.use](t.qAmbiguo);
    expect(amb.error).toEqual({ message: t.msgAmbiguo, code: 'AMBIGUOUS' });

    const usado = await wave[t.use](t.unico.q);
    expect(usado.data).toEqual({ name: t.unico.name, path: t.unico.path, relPath: t.unico.relPath, active: true });
    expect(lista()[0]).toMatchObject({ path: t.unico.path, isActive: true });
  });

  it('usar pelo nome sem projeto, ou com o registro recusado, devolve o erro', async () => {
    spf.testbenchFile = '';
    expect(msg(await wave[t.use](t.unico.q))).toMatch(/No testbench top set/);
    ProjectStore.clearProject();
    expect(msg(await wave[t.use](t.unico.q))).toBe('No project open');
  });
});

describe('abrir o Surfer', () => {
  it('exige o dump e o modulo de compilacao', async () => {
    expect(msg(await wave.openSurfer())).toMatch(/file is required/);
    expect(msg(await wave.openSurfer({ file: 'C:\\p\\w.vcd' }))).toBe('compilation module unavailable');
  });

  it('abre pelo lancador do modulo, com a toolchain do projeto', async () => {
    const lancar = vi.fn(async () => {});
    window.compilationModule = { _waveLaunchSurfer: lancar };
    const r = await wave.openSurfer({ file: ' C:\\p\\w.vcd ', layout: 'C:\\p\\a.sucl' });
    expect(r.data).toEqual({ opened: 'C:\\p\\w.vcd', layout: 'C:\\p\\a.sucl' });
    expect(lancar).toHaveBeenCalledWith('C:\\p\\w.vcd', 'C:\\p\\a.sucl', { surferBin: 'x' });
    const { resolveWaveToolchain } = await import('../../js/compilation/wave_toolchain.js');
    expect(resolveWaveToolchain).toHaveBeenCalledWith('C:\\comp', 'C:\\p');
  });

  it('o lancador que falha vira erro', async () => {
    window.compilationModule = { _waveLaunchSurfer: vi.fn(async () => { throw new Error('sem exe'); }) };
    expect(msg(await wave.openSurfer({ file: 'w.vcd' }))).toBe('sem exe');
    window.compilationModule = { _waveLaunchSurfer: vi.fn(async () => { throw {}; }) };
    expect(msg(await wave.openSurfer({ file: 'w.vcd' }))).toBe('surfer launch failed');
  });
});

describe('criar layouts', () => {
  it('GTKWave: escreve o .gtkw na raiz, registra e ativa', async () => {
    const r = await wave.createGtkwLayout({ name: 'minha vista', signals: ['tb.clk', { path: 'tb.acc', radix: 'hex' }, ''] });
    expect(r.data).toEqual({ filePath: 'C:\\p\\minha_vista.gtkw', signals: 2, ignored: [''], isActive: true });
    expect(disco.get('C:\\p\\minha_vista.gtkw')).toContain('tb.acc');
    expect(lista('gtkwFiles')[0]).toMatchObject({ path: 'C:\\p\\minha_vista.gtkw', isActive: true });
  });

  it('GTKWave: recusa sem nome, sem projeto, sem sinal, e devolve a falha de escrever ou registrar', async () => {
    expect(msg(await wave.createGtkwLayout())).toBe('name required');
    expect(msg(await wave.createGtkwLayout({ name: 'v', signals: [] }))).toMatch(/signals required/);
    electronAPI.writeFile.mockRejectedValueOnce(new Error('protegido'));
    expect(msg(await wave.createGtkwLayout({ name: 'v', signals: ['tb.clk'] }))).toBe('Could not write C:\\p\\v.gtkw: protegido');
    spf.testbenchFile = '';
    expect(msg(await wave.createGtkwLayout({ name: 'v', signals: ['tb.clk'] }))).toMatch(/No testbench top set/);
    ProjectStore.clearProject();
    expect(msg(await wave.createGtkwLayout({ name: 'v', signals: ['tb.clk'] }))).toBe('No project open');
  });

  it('Surfer: escreve o .sucl, registra e devolve o resultado da criacao, e nao o do registro', async () => {
    const r = await wave.createSurferLayout({ name: 'vista', commands: ['add_variable tb.clk', '  ', 'zoom_fit'] });
    expect(r.data).toEqual({ filePath: 'C:\\p\\vista.sucl', opened: false, commands: 2 });
    expect(disco.get('C:\\p\\vista.sucl')).toBe('# Gerado pela Aurora Intelligence.\n# Arquivo de comandos do Surfer (.sucl): um comando por linha.\nadd_variable tb.clk\nzoom_fit\n');
    expect(lista('surferFiles')[0]).toMatchObject({ path: 'C:\\p\\vista.sucl', isActive: true });
  });

  it('Surfer com open: a abertura roda, e a recusa dela volta em openError', async () => {
    const r = await wave.createSurferLayout({ name: 'vista', commands: 'zoom_fit', open: true });
    expect(r.data.opened).toBe(false);
    expect(r.data.openError.message).toMatch(/file is required/);
  });

  it('Surfer: recusa sem nome, sem projeto, sem comando, e devolve a falha de escrever ou registrar', async () => {
    expect(msg(await wave.createSurferLayout())).toBe('name required');
    expect(msg(await wave.createSurferLayout({ name: 'v', commands: [' '] }))).toMatch(/commands required/);
    expect(msg(await wave.createSurferLayout({ name: 'v' }))).toMatch(/commands required/);
    electronAPI.writeFile.mockRejectedValueOnce(new Error('protegido'));
    expect(msg(await wave.createSurferLayout({ name: 'v', commands: ['x'] }))).toBe('Could not write C:\\p\\v.sucl: protegido');
    spf.testbenchFile = '';
    expect(msg(await wave.createSurferLayout({ name: 'v', commands: ['x'] }))).toMatch(/No testbench top set/);
    ProjectStore.clearProject();
    expect(msg(await wave.createSurferLayout({ name: 'v', commands: ['x'] }))).toBe('No project open');
  });

  function lista(campo) { return estados.get('C:\\p|tb_top')?.[campo] || []; }
});
