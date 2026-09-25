// @vitest-environment happy-dom
//
// Os botoes de compilacao da barra (js/compilation/botoes_da_barra): o C±
// segue o arquivo em foco; os outros seguem o .spf do projeto aberto.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const foco = { caminho: null };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: () => foco.caminho } }));
const spf = { read: vi.fn() };
vi.mock('../../js/project/spf_store.js', () => ({ SpfStore: spf }));
const ativo = { nome: null };
vi.mock('../../js/project/active_processor.js', () => ({ getActiveProcessorName: () => ativo.nome }));

let barra;
let ProjectStore;

const IDS = ['cmmcomp', 'vericomp', 'prismcomp', 'verilatorproc', 'wavecomp', 'fastsim', 'cancel-everything', 'waveConfigBtn'];
const $ = (id) => document.getElementById(id);
const ligados = () => IDS.filter((id) => !$(id).disabled);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  foco.caminho = null;
  ativo.nome = null;
  localStorage.clear();
  delete window.t;
  delete window.gtkwPickerManager;
  document.body.innerHTML = IDS.map((id) => `<button id="${id}"></button>`).join('')
    + '<div data-terminal="tcmm"><span class="tab-label">C±</span></div>';
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  barra = await import('../../js/compilation/botoes_da_barra.js');
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

describe('botao C±', () => {
  it('habilita com fonte de processador em foco e troca o rotulo do terminal pela linguagem', () => {
    foco.caminho = 'C:/p/P/Software/P.cpp';
    barra.syncCmmcompEnabled();
    expect($('cmmcomp').disabled).toBe(false);
    expect($('cmmcomp').style.cursor).toBe('pointer');
    expect(document.querySelector('.tab-label').textContent).toBe('C++');
  });

  it('desabilita sem fonte em foco e deixa o rotulo como estava', () => {
    foco.caminho = 'C:/p/top.v';
    barra.syncCmmcompEnabled();
    expect($('cmmcomp').disabled).toBe(true);
    expect($('cmmcomp').style.cursor).toBe('not-allowed');
    expect(document.querySelector('.tab-label').textContent).toBe('C±');
  });

  it('sem o botao na pagina nao faz nada', () => {
    $('cmmcomp').remove();
    expect(() => barra.syncCmmcompEnabled()).not.toThrow();
  });
});

describe('botoes que seguem o .spf', () => {
  it('le o .spf do projeto aberto: com topo e testbench .v, e Icarus, o Fast Sim fica de fora', async () => {
    spf.read.mockResolvedValue({ topLevelFile: 'C:/p/top.v', testbenchFile: 'C:/p/tb.v' });
    const refresh = vi.fn();
    window.gtkwPickerManager = { refresh };
    await barra.syncToolbarEnabledState();
    expect(spf.read).toHaveBeenCalledWith('C:/p/p.spf');
    expect(ligados()).toEqual(['cmmcomp', 'vericomp', 'prismcomp', 'wavecomp', 'cancel-everything', 'waveConfigBtn']);
    expect(refresh).toHaveBeenCalled();
  });

  it('com Verilator escolhido, o Fast Sim liga; com processador ativo, o Verilator do processador tambem', async () => {
    spf.read.mockResolvedValue({ topLevelFile: 'C:/p/top.v', testbenchFile: 'C:/p/tb.v' });
    localStorage.setItem('aurora.waveSimulator', 'verilator');
    ativo.nome = 'P';
    await barra.syncToolbarEnabledState();
    expect($('fastsim').disabled).toBe(false);
    expect($('verilatorproc').disabled).toBe(false);
  });

  it('testbench .py (cocotb) liga o Fast Sim em qualquer simulador', async () => {
    spf.read.mockResolvedValue({ testbenchFiles: [{ path: 'C:/p/test_top.py' }] });
    await barra.syncToolbarEnabledState();
    expect($('fastsim').disabled).toBe(false);
    expect($('vericomp').disabled).toBe(true);
  });

  it('sem topo nem testbench, desabilita com o motivo no tooltip; Cancelar fica ligado', async () => {
    window.t = (k) => ({ 'statusBar.noTopLevel': 'Sem topo', 'statusBar.howTopLevel': 'Marque um' })[k] || k;
    spf.read.mockResolvedValue({});
    await barra.syncToolbarEnabledState();
    expect($('vericomp').disabled).toBe(true);
    expect($('vericomp').getAttribute('data-tooltip')).toBe('Sem topo. Marque um');
    expect($('cancel-everything').disabled).toBe(false);
  });

  it('ao religar, o tooltip volta ao texto original da chave de traducao', async () => {
    window.t = (k) => (k === 'toolbar.verilog' ? 'Compilar Verilog' : k);
    $('vericomp').dataset.i18nTooltip = 'toolbar.verilog';
    $('vericomp').setAttribute('data-tooltip', 'motivo antigo');
    spf.read.mockResolvedValue({ topLevelFile: 'C:/p/top.v' });
    await barra.syncToolbarEnabledState();
    expect($('vericomp').getAttribute('data-tooltip')).toBe('Compilar Verilog');
    $('prismcomp').dataset.i18nTooltip = 'sem.traducao';
    $('prismcomp').setAttribute('data-tooltip', 'fica');
    await barra.syncToolbarEnabledState();
    expect($('prismcomp').getAttribute('data-tooltip')).toBe('fica');
  });

  it('sem projeto aberto, ou .spf que nao se le, tudo que depende dele desliga', async () => {
    ProjectStore.clearProject();
    await barra.syncToolbarEnabledState();
    expect(spf.read).not.toHaveBeenCalled();
    expect(ligados()).toEqual(['cmmcomp', 'cancel-everything']);

    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    spf.read.mockRejectedValue(new Error('corrompido'));
    await barra.syncToolbarEnabledState();
    expect(ligados()).toEqual(['cmmcomp', 'cancel-everything']);
  });

  it('botao que nao esta na pagina e pulado', async () => {
    $('fastsim').remove();
    spf.read.mockResolvedValue({ topLevelFile: 'C:/p/top.v' });
    await expect(barra.syncToolbarEnabledState()).resolves.toBeUndefined();
  });

  it('as duas funcoes ficam em window para quem ainda nao importa', () => {
    expect(window.syncCmmcompEnabled).toBe(barra.syncCmmcompEnabled);
    expect(window.syncToolbarEnabledState).toBe(barra.syncToolbarEnabledState);
  });
});
