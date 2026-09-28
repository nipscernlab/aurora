// @vitest-environment happy-dom
/**
 * Caracterizacao do modal Wave Configuration (js/wave/wave_config_manager).
 *
 * Fixa o comportamento de hoje antes da conversao para .ts: quais arquivos o
 * open() e o refresh() leem (inclusive a biblioteca do SAPHO em
 * components/HDL, com o caminho exato passado ao joinPath), como a selecao
 * inicial e escolhida, o filtro de texto, o filtro "processor only", as
 * linhas da arvore e o save() no WaveStore.
 *
 * O CompilationModule e o terminal sao falsos e so anotam; o parser de
 * Verilog, o de VCD e as preferencias sao os reais. O buildAliasMap e falso
 * para que o teste decida quais sinais sao "do processador".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const compilador = {
    instancias: [],
    validacoes: [],
    syntaxChecks: 0,
    limpezas: [],
};
vi.mock('../../js/compilation/compilation_module.js', () => ({
    CompilationModule: class {
        constructor(p) {
            this.projectPath = p;
            this.terminalManager = { clearTerminalImmediate: (t) => compilador.limpezas.push(t) };
            compilador.instancias.push(p);
        }
        async loadConfig() {}
        async _validateWaveSelection(raw, filePaths, tbModule, tbKey) {
            compilador.validacoes.push({ raw, filePaths: [...filePaths], tbModule, tbKey });
            return raw;
        }
        async syntaxCheck() {
            compilador.syntaxChecks++;
            return { success: true };
        }
    },
}));
const terminais = [];
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: (t) => terminais.push(t) }));
// Sinais cujo nome comeca com `proc_` sao "do processador" (tem alias).
vi.mock('../../js/wave/gtkw_proc_writer.js', () => ({
    buildAliasMap: (scopes) => {
        const m = new Map();
        for (const s of scopes) {
            for (const sig of s.signals) {
                if (sig.name.startsWith('proc_')) m.set(`${s.path}.${sig.name}`, `Alias ${sig.name}`);
            }
        }
        return m;
    },
}));

import { WaveConfigManager, waveConfigManager } from '../../js/wave/wave_config_manager.js';
import { ProjectStore } from '../../js/project/project_store.js';
import { SpfStore } from '../../js/project/spf_store.js';
import { WaveStore } from '../../js/wave/wave_state_store.js';

const MODAL_HTML = `
<div id="modalWaveConfig" aria-hidden="true">
  <div class="container">
    <button id="closeWaveConfigModal"></button>
    <p id="waveConfigHintVerilator" hidden></p>
    <input id="waveConfigFilterInput">
    <span id="waveConfigFilterCount"></span>
    <button id="waveConfigFilterCase"></button>
    <button id="waveConfigFilterRegex"></button>
    <button id="waveConfigFilterClear" hidden></button>
    <button id="waveConfigSelectDefault"></button>
    <button id="waveConfigSelectAll"></button>
    <button id="waveConfigSelectNone"></button>
    <label class="wave-tree-filter"><input type="checkbox" id="waveConfigProcessorOnly"></label>
    <label class="wave-tree-filter"><input type="checkbox" id="waveConfigSurferInTab"></label>
    <label class="wave-tree-filter"><input type="checkbox" id="waveConfigSurferMultiWindow"></label>
    <div id="waveConfigTree"></div>
    <span id="waveConfigSelectedCount"></span>
    <button id="cancelWaveConfig"></button>
    <button id="saveWaveConfig"></button>
  </div>
</div>
<button id="waveConfigBtn"></button>
`;

const TOP_V = `module top(input clk, output [3:0] q);
  reg [3:0] cnt;
  core u_core(.clk(clk));
endmodule`;
const TB_V = `module tb;
  reg clk;
  wire [3:0] q;
  top dut(.clk(clk), .q(q));
endmodule`;
const TB_DUMP_V = TB_V.replace('endmodule', '  initial begin $dumpfile("tb.vcd"); $dumpvars(0, tb); end\nendmodule');
const CORE_V = `module core(input clk);
  reg [7:0] proc_acc;
  reg me3_x;
  reg other;
endmodule`;

let arquivos;
let listagem;
let joins;
let fake;
let estadoOnda;
let cfg;

function montarApi() {
    joins = [];
    fake = {
        getComponentsPath: vi.fn(async () => 'C:/comp'),
        joinPath: vi.fn(async (...partes) => {
            joins.push(partes);
            return partes.join('/');
        }),
        listFilesInDirectory: vi.fn(async (d) => listagem(d)),
        readFile: vi.fn(async (p) => {
            if (!arquivos.has(p)) throw new Error(`ENOENT ${p}`);
            return arquivos.get(p);
        }),
        fileExists: vi.fn(async (p) => arquivos.has(p)),
    };
    window.electronAPI = fake;
}

function projeto(proj = '/proj', spf = '/proj/p.spf') {
    vi.spyOn(ProjectStore, 'getProjectPath').mockReturnValue(proj);
    vi.spyOn(ProjectStore, 'getSpfPath').mockReturnValue(spf);
}

function novo() {
    const m = new WaveConfigManager();
    m.initialize();
    return m;
}

const el = (id) => document.getElementById(id);
const linhasDeSinal = () => [...el('waveConfigTree').querySelectorAll('.signal-row')].map((r) => r.dataset.signal);
const linhasDeModulo = () => [...el('waveConfigTree').querySelectorAll('.module-row')].map((r) => r.dataset.scope);

beforeEach(() => {
    document.body.innerHTML = MODAL_HTML;
    localStorage.clear();
    compilador.instancias = [];
    compilador.validacoes = [];
    compilador.syntaxChecks = 0;
    compilador.limpezas = [];
    terminais.length = 0;
    arquivos = new Map([
        ['/proj/top.v', TOP_V],
        ['/proj/tb.v', TB_V],
        ['C:/comp/HDL/core.v', CORE_V],
    ]);
    listagem = () => ['core.v', 'core_tb.v', 'leia.txt', 42];
    montarApi();
    estadoOnda = null;
    cfg = {
        synthesizableFiles: [{ path: '/proj/top.v' }, null],
        testbenchFile: '/proj/tb.v',
        testbenchFiles: [{ path: '/proj/tb.v' }],
        topLevelFile: '/proj/top.v',
    };
    vi.spyOn(SpfStore, 'read').mockImplementation(async () => cfg);
    vi.spyOn(WaveStore, 'read').mockImplementation(async () => estadoOnda);
    vi.spyOn(WaveStore, 'update').mockImplementation(async (_p, _k, mut) => {
        const s = { ...(estadoOnda || {}) };
        await mut(s);
        estadoOnda = s;
        return s;
    });
    delete window.t;
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.electronAPI;
});

describe('carga do modulo', () => {
    it('expoe a instancia em window e nao inicializa sem o modal no DOM', () => {
        expect(window.waveConfigManager).toBe(waveConfigManager);
        expect(waveConfigManager).toBeInstanceOf(WaveConfigManager);
    });

    it('initialize sem o modal nao marca inicializado; com o modal, uma vez so', () => {
        document.body.innerHTML = '';
        const m = new WaveConfigManager();
        m.initialize();
        expect(m._initialized).toBe(false);
        expect(m.modal).toBeNull();
        document.body.innerHTML = MODAL_HTML;
        m.initialize();
        expect(m._initialized).toBe(true);
        expect(m.elements.processorOnlyFilter).toBe(el('waveConfigProcessorOnly').closest('.wave-tree-filter'));
        const spy = vi.spyOn(m, 'bindListeners');
        m.initialize();
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('open(): a validacao le o projeto e a biblioteca do SAPHO', () => {
    it('passa ao _validateWaveSelection os .v do projeto e os de components/HDL', async () => {
        projeto();
        estadoOnda = { waveSignals: ['tb.clk'] };
        const m = novo();
        await m.open();

        expect(compilador.instancias).toEqual(['/proj']);
        expect(fake.getComponentsPath).toHaveBeenCalled();
        // O diretorio da biblioteca: exatamente (componentsPath, 'HDL').
        expect(joins).toContainEqual(['C:/comp', 'HDL']);
        expect(fake.listFilesInDirectory).toHaveBeenCalledWith('C:/comp/HDL');
        expect(joins).toContainEqual(['C:/comp/HDL', 'core.v']);
        // core_tb.v (tem _tb), leia.txt (nao e .v) e 42 (nao e string) ficam de fora.
        expect(joins).not.toContainEqual(['C:/comp/HDL', 'core_tb.v']);
        const v = compilador.validacoes[0];
        expect(v.filePaths).toEqual(['/proj/top.v', '/proj/tb.v', '/proj/tb.v', 'C:/comp/HDL/core.v']);
        expect(v.tbModule).toBe('tb');
        expect(v.tbKey).toBe('tb');
        expect(v.raw).toEqual(['tb.clk']);
        expect(compilador.limpezas).toEqual(['tveri']);
        expect(terminais).toEqual(['terminal-tveri']);
        expect(compilador.syntaxChecks).toBe(1);
        expect(m.isOpen()).toBe(true);
        expect(m.modal.classList.contains('show')).toBe(true);
    });

    it('HDL indisponivel: a validacao segue sem a biblioteca', async () => {
        projeto();
        fake.getComponentsPath.mockRejectedValue(new Error('sem components'));
        const m = novo();
        await m.open();
        expect(compilador.validacoes[0].filePaths).toEqual(['/proj/top.v', '/proj/tb.v', '/proj/tb.v']);
        expect(compilador.validacoes[0].raw).toEqual([]);
    });

    it('listagem que nao e array nao acrescenta nada', async () => {
        projeto();
        listagem = () => null;
        const m = novo();
        await m.open();
        expect(compilador.validacoes[0].filePaths).toEqual(['/proj/top.v', '/proj/tb.v', '/proj/tb.v']);
    });

    it('cocotb: tira o .py, o modulo vem do topLevelFile e nao roda o syntax check', async () => {
        projeto();
        cfg = {
            synthesizableFiles: [{ path: '/proj/top.v' }],
            testbenchFile: '/proj/test_top.py',
            testbenchFiles: [{ path: '/proj/test_top.py' }, { path: '/proj/aux.v' }, {}],
            topLevelFile: '/proj/top.v',
        };
        const m = novo();
        await m.open();
        const v = compilador.validacoes[0];
        expect(v.filePaths).toEqual(['/proj/top.v', '/proj/aux.v', 'C:/comp/HDL/core.v']);
        expect(v.tbModule).toBe('top');
        expect(v.tbKey).toBe('test_top');
        expect(compilador.syntaxChecks).toBe(0);
        expect(terminais).toEqual([]);
        expect(compilador.limpezas).toEqual(['tveri']);
    });

    it('sem testbench: modulo do topLevelFile, sem tbKey e sem ler o WaveStore', async () => {
        projeto();
        cfg = { synthesizableFiles: [{ path: '/proj/top.v' }], testbenchFile: '', topLevelFile: '/proj/top.v' };
        const m = novo();
        await m.open();
        expect(compilador.validacoes[0].tbModule).toBe('top');
        expect(compilador.validacoes[0].tbKey).toBe('');
        expect(WaveStore.read).not.toHaveBeenCalled();
    });

    it('sem modulo nenhum a validacao nao roda', async () => {
        projeto();
        cfg = { synthesizableFiles: [], testbenchFile: '', topLevelFile: '' };
        listagem = () => [];
        const m = novo();
        await m.open();
        expect(compilador.validacoes).toEqual([]);
    });

    it('sem projeto: nao cria compilador e abre com a arvore vazia', async () => {
        projeto(null, null);
        const m = novo();
        await m.open();
        expect(compilador.instancias).toEqual([]);
        expect(m.tree).toBeNull();
        expect(el('waveConfigTree').querySelector('.empty-state')).not.toBeNull();
        expect(m.isOpen()).toBe(true);
    });

    it('o aviso do Verilator aparece so com o Verilator escolhido', async () => {
        projeto(null, null);
        const m = novo();
        await m.open();
        expect(el('waveConfigHintVerilator').hidden).toBe(true);
        localStorage.setItem('aurora.waveSimulator', 'verilator');
        await m.open();
        expect(el('waveConfigHintVerilator').hidden).toBe(false);
    });

    it('reinicia o filtro, os toggles e reflete as preferencias do Surfer', async () => {
        projeto(null, null);
        localStorage.setItem('aurora.surferMultiWindow', 'true');
        localStorage.setItem('aurora.surferInTab', 'false');
        const m = novo();
        m._processorOnly = true;
        m._filterText = 'x';
        m._filterCaseSensitive = true;
        m._filterIsRegex = true;
        el('waveConfigFilterCase').classList.add('active');
        el('waveConfigFilterRegex').classList.add('active');
        el('waveConfigFilterCount').classList.add('no-match');
        el('waveConfigFilterInput').value = 'x';
        await m.open();
        expect(m._processorOnly).toBe(false);
        expect(m._filterText).toBe('');
        expect(m._filterRegex).toBeNull();
        expect(el('waveConfigFilterInput').value).toBe('');
        expect(el('waveConfigFilterClear').hidden).toBe(true);
        expect(el('waveConfigFilterCase').classList.contains('active')).toBe(false);
        expect(el('waveConfigFilterRegex').getAttribute('aria-pressed')).toBe('false');
        expect(el('waveConfigFilterCount').classList.contains('no-match')).toBe(false);
        expect(el('waveConfigSurferMultiWindow').checked).toBe(true);
        expect(el('waveConfigSurferInTab').checked).toBe(false);
        expect(el('waveConfigSurferMultiWindow').disabled).toBe(false);
    });
});

describe('refresh(): a arvore e a selecao inicial', () => {
    it('le os .v do projeto e os de components/HDL, com o mesmo caminho', async () => {
        projeto();
        const m = novo();
        await m.refresh();
        expect(joins).toContainEqual(['C:/comp', 'HDL']);
        expect(fake.listFilesInDirectory).toHaveBeenCalledWith('C:/comp/HDL');
        expect(joins).toContainEqual(['C:/comp/HDL', 'core.v']);
        // O testbench e lido duas vezes: no parse e na procura de $dumpvars.
        expect(fake.readFile.mock.calls.map((c) => c[0]).sort()).toEqual(
            ['/proj/tb.v', '/proj/tb.v', '/proj/top.v', 'C:/comp/HDL/core.v'],
        );
        expect(m.tree.scopePath).toBe('tb');
        expect(m.tree.children[0].children[0].scopePath).toBe('tb.dut.u_core');
        // Default: os sinais do escopo do testbench.
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.q']);
        expect(m._initialSelection).toEqual(m.selected);
        // So o root fica aberto.
        expect([...m.collapsedScopes].sort()).toEqual(['tb.dut', 'tb.dut.u_core']);
        expect(m._scopesWithAliasedSignal).toEqual(new Set(['tb', 'tb.dut', 'tb.dut.u_core']));
        expect(el('waveConfigSelectedCount').textContent).toBe('modal.waveConfig.selectedCountOther');
    });

    it('HDL indisponivel: a arvore para no que o projeto tem', async () => {
        projeto();
        fake.listFilesInDirectory.mockRejectedValue(new Error('x'));
        const m = novo();
        await m.refresh();
        expect(m.tree.children[0].children).toEqual([]);
        expect(m._scopesWithAliasedSignal.size).toBe(0);
        expect(el('waveConfigProcessorOnly').closest('.wave-tree-filter').hidden).toBe(true);
    });

    it('listagem que nao e array: sem biblioteca', async () => {
        projeto();
        listagem = () => 'nao';
        const m = novo();
        await m.refresh();
        expect(fake.readFile.mock.calls.map((c) => c[0])).not.toContain('C:/comp/HDL/core.v');
    });

    it('arquivo que falha ao ler e pulado', async () => {
        projeto();
        arquivos.delete('C:/comp/HDL/core.v');
        const m = novo();
        await m.refresh();
        expect(m.tree.scopePath).toBe('tb');
    });

    it('sem projeto: arvore nula e estado vazio', async () => {
        projeto('/proj', null);
        const m = novo();
        m._scopesWithAliasedSignal = new Set(['velho']);
        await m.refresh();
        expect(m.tree).toBeNull();
        expect(m._scopesWithAliasedSignal.size).toBe(0);
        expect(el('waveConfigTree').querySelector('.empty-state')).not.toBeNull();
        expect(el('waveConfigSelectedCount').textContent).toBe('modal.waveConfig.selectedCountOther');
    });

    it('sem arquivo nenhum: arvore nula', async () => {
        projeto();
        cfg = { testbenchFile: '', topLevelFile: '' };
        listagem = () => [];
        const m = novo();
        await m.refresh();
        expect(m.tree).toBeNull();
    });

    it('modulo de topo que nao existe: arvore nula', async () => {
        projeto();
        cfg = { ...cfg, testbenchFile: '/proj/nada.v', testbenchFiles: [] };
        const m = novo();
        await m.refresh();
        expect(m.tree).toBeNull();
    });

    it('cocotb: o topo e o topLevelFile e o .py so e lido na procura de $dumpvars', async () => {
        projeto();
        cfg = {
            synthesizableFiles: [{ path: '/proj/top.v' }],
            testbenchFile: '/proj/test_top.py',
            testbenchFiles: [{ path: '/proj/test_top.py' }, {}],
            topLevelFile: '/proj/top.v',
        };
        const m = novo();
        await m.refresh();
        expect(m.tree.scopePath).toBe('top');
        expect(fake.readFile.mock.calls.filter((c) => c[0] === '/proj/test_top.py').length).toBe(1);
    });

    it('wcCustomized: usa a selecao salva', async () => {
        projeto();
        estadoOnda = { wcCustomized: true, waveSignals: ['tb.dut.cnt'] };
        const m = novo();
        await m.refresh();
        expect([...m.selected]).toEqual(['tb.dut.cnt']);
    });

    it('wcCustomized sem lista: selecao vazia', async () => {
        projeto();
        estadoOnda = { wcCustomized: true, waveSignals: 'x' };
        const m = novo();
        await m.refresh();
        expect(m.selected.size).toBe(0);
    });

    it('sem customizacao, com lista salva: usa a lista', async () => {
        projeto();
        estadoOnda = { waveSignals: ['tb.q'] };
        const m = novo();
        await m.refresh();
        expect([...m.selected]).toEqual(['tb.q']);
    });

    it('testbench com $dumpvars e VCD de cabecalho: deriva a selecao do VCD', async () => {
        projeto();
        arquivos.set('/proj/tb.v', TB_DUMP_V);
        arquivos.set('/proj/.aurora/Temp/tb.header.vcd',
            '$scope module tb $end\n$var wire 1 ! clk $end\n$upscope $end\n$enddefinitions $end\n#0\n');
        estadoOnda = { waveSignals: ['tb.q'] };
        const m = novo();
        await m.refresh();
        expect(joins).toContainEqual(['/proj', '.aurora', 'Temp']);
        expect(joins).toContainEqual(['/proj/.aurora/Temp', 'tb.header.vcd']);
        expect(joins).toContainEqual(['/proj/.aurora/Temp', 'tb.vcd']);
        expect([...m.selected]).toEqual(['tb.clk']);
    });

    it('sem o de cabecalho, cai no .vcd legado', async () => {
        projeto();
        arquivos.set('/proj/tb.v', TB_DUMP_V);
        arquivos.set('/proj/.aurora/Temp/tb.vcd',
            '$scope module tb $end\n$var wire 4 " q [3:0] $end\n$upscope $end\n$enddefinitions $end\n');
        const m = novo();
        await m.refresh();
        expect([...m.selected]).toEqual(['tb.q']);
    });

    it('VCD sem escopo, VCD ausente ou testbench ilegivel: segue o fluxo normal', async () => {
        projeto();
        arquivos.set('/proj/tb.v', TB_DUMP_V);
        const m = novo();
        await m.refresh();
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.q']);

        arquivos.set('/proj/.aurora/Temp/tb.vcd', '$enddefinitions $end\n');
        await m.refresh();
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.q']);

        expect(await m._tryDeriveSelectionFromVcd('/proj', { testbenchFile: '' }, 'tb')).toBeNull();
        expect(await m._tryDeriveSelectionFromVcd('/proj', { testbenchFile: '/proj/sumiu.v' }, 'tb')).toBeNull();
    });
});

describe('renderTree(): linhas, filtro de processador e cliques', () => {
    async function aberto() {
        projeto();
        const m = novo();
        await m.refresh();
        return m;
    }

    it('modulos e sinais, com colapso e aliases', async () => {
        const m = await aberto();
        expect(linhasDeModulo()).toEqual(['tb', 'tb.dut', 'tb.dut.u_core']);
        const dut = el('waveConfigTree').querySelector('[data-scope="tb.dut"]');
        expect(dut.classList.contains('hidden-by-parent')).toBe(false);
        expect(dut.querySelector('.wave-tree-instance').textContent).toBe('(dut)');
        expect(dut.querySelector('.wave-tree-chevron').classList.contains('collapsed')).toBe(true);
        const cnt = el('waveConfigTree').querySelector('[data-signal="tb.dut.cnt"]');
        expect(cnt.classList.contains('hidden-by-parent')).toBe(true);
        expect(cnt.getAttribute('data-tooltip')).toBe('tb.dut.cnt');
        expect(cnt.querySelector('.signal-range').textContent).toBe('[3:0]');
        const acc = el('waveConfigTree').querySelector('[data-signal="tb.dut.u_core.proc_acc"]');
        expect(acc.querySelector('.signal-alias').textContent).toBe('Alias proc_acc');
        expect(acc.querySelector('.signal-raw').textContent).toBe('proc_acc[7:0]');
        const other = el('waveConfigTree').querySelector('[data-signal="tb.dut.u_core.other"]');
        expect(other.querySelector('.signal-raw')).toBeNull();
        // Raiz sem instancia: sem o span de instancia.
        expect(el('waveConfigTree').querySelector('[data-scope="tb"] .wave-tree-instance')).toBeNull();
        expect(m.tree.instanceName).toBeFalsy();
    });

    it('chevron abre e fecha o escopo', async () => {
        const m = await aberto();
        el('waveConfigTree').querySelector('[data-scope="tb.dut"] .wave-tree-chevron').click();
        expect(m.collapsedScopes.has('tb.dut')).toBe(false);
        expect(el('waveConfigTree').querySelector('[data-signal="tb.dut.cnt"]').classList.contains('hidden-by-parent')).toBe(false);
        el('waveConfigTree').querySelector('[data-scope="tb.dut"] .wave-tree-chevron').click();
        expect(m.collapsedScopes.has('tb.dut')).toBe(true);
    });

    it('checkbox do modulo marca e desmarca o escopo inteiro; estado parcial', async () => {
        const m = await aberto();
        const cbDe = (s) => el('waveConfigTree').querySelector(`[data-scope="${s}"] .wave-tree-checkbox`);
        expect(cbDe('tb').indeterminate).toBe(true);
        expect(cbDe('tb.dut').checked).toBe(false);
        cbDe('tb.dut').click();
        expect(m.selected.has('tb.dut.u_core.other')).toBe(true);
        expect(cbDe('tb.dut').checked).toBe(true);
        expect(cbDe('tb').checked).toBe(true);
        cbDe('tb.dut').click();
        expect(m.selected.has('tb.dut.cnt')).toBe(false);
        expect(m._moduleCheckState({ scopePath: 'x', signals: [], children: [] })).toEqual({ all: false, partial: false });
    });

    it('checkbox do sinal liga e desliga um so', async () => {
        const m = await aberto();
        const cb = () => el('waveConfigTree').querySelector('[data-signal="tb.dut.cnt"] .wave-tree-checkbox');
        cb().click();
        expect(m.selected.has('tb.dut.cnt')).toBe(true);
        expect(cb().checked).toBe(true);
        cb().click();
        expect(m.selected.has('tb.dut.cnt')).toBe(false);
    });

    it('processor only: abre o caminho e mostra so os sinais com alias', async () => {
        const m = await aberto();
        const cb = el('waveConfigProcessorOnly');
        expect(cb.closest('.wave-tree-filter').hidden).toBe(false);
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
        expect(m._processorOnly).toBe(true);
        expect(m.collapsedScopes.size).toBe(0);
        expect(linhasDeSinal()).toEqual(['tb.dut.u_core.proc_acc']);
        expect(linhasDeModulo()).toEqual(['tb', 'tb.dut', 'tb.dut.u_core']);

        // Select all / none mexem so no que esta visivel.
        m.selectAll();
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.dut.u_core.proc_acc', 'tb.q']);
        m.selectNone();
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.q']);

        cb.checked = false;
        cb.dispatchEvent(new Event('change'));
        expect(m._processorOnly).toBe(false);
        expect(linhasDeSinal().length).toBe(9);
    });

    it('processor only esconde modulo sem alias, mantendo a profundidade do filho', async () => {
        const m = await aberto();
        m.tree.children.push({ name: 'x', instanceName: 'ix', scopePath: 'tb.ix', signals: [{ name: 'a', kind: 'reg', range: null }], children: [] });
        m._processorOnly = true;
        m.collapsedScopes = new Set();
        m.renderTree();
        expect(linhasDeModulo()).not.toContain('tb.ix');
        expect(m._procFilterVisibility('tb.ix')).toEqual({ module: false });
        expect(m._shouldRenderSignal('tb.ix.a')).toBe(false);
        m._processorOnly = false;
        expect(m._procFilterVisibility('tb.ix')).toEqual({ module: true });
        expect(m._shouldRenderSignal('tb.ix.a')).toBe(true);
    });

    it('sem processador, o filtro some e desliga', async () => {
        const m = await aberto();
        m._processorOnly = true;
        el('waveConfigProcessorOnly').checked = true;
        m._scopesWithAliasedSignal = new Set();
        m.renderTree();
        expect(m._processorOnly).toBe(false);
        expect(el('waveConfigProcessorOnly').checked).toBe(false);
        expect(el('waveConfigProcessorOnly').closest('.wave-tree-filter').hidden).toBe(true);
    });

    it('selectAll, selectNone e selectDefault pelos botoes', async () => {
        const m = await aberto();
        el('waveConfigSelectAll').click();
        expect(m.selected.size).toBe(9);
        el('waveConfigSelectNone').click();
        expect(m.selected.size).toBe(0);
        expect(el('waveConfigSelectedCount').textContent).toBe('modal.waveConfig.selectedCountOther');
        el('waveConfigSelectDefault').click();
        expect([...m.selected].sort()).toEqual(['tb.clk', 'tb.q']);
        m.selected = new Set(['tb.q']);
        window.t = (k, p) => `${k}:${p ? p.count : ''}`;
        m.renderTree();
        expect(el('waveConfigSelectedCount').textContent).toBe('modal.waveConfig.selectedCountOne:');
    });

    it('sem arvore: selectAll esvazia, default esvazia, computes vazios', async () => {
        projeto(null, null);
        const m = novo();
        m.selected = new Set(['a']);
        m.selectAll();
        expect(m.selected.size).toBe(0);
        m.selectNone();
        m._applyDefaultSelection();
        expect(m.selected.size).toBe(0);
        m._collapseAllExceptRoot();
        expect(m.collapsedScopes.size).toBe(0);
        expect(m._computeScopesWithAliasedSignal().size).toBe(0);
        expect(m._hierarchyToScopes(null)).toEqual([]);
        expect(m._hierarchyToScopes({ scopePath: 'r' })).toEqual([{ path: 'r', signals: [] }]);
    });

    it('sem o elemento da arvore, renderTree nao faz nada', () => {
        const m = new WaveConfigManager();
        expect(() => m.renderTree()).not.toThrow();
        expect(() => m._updateCounter()).not.toThrow();
        expect(() => m._updateFilterCount()).not.toThrow();
        expect(() => m._updateProcessorFilterVisibility()).not.toThrow();
        expect(() => m._syncSurferMultiWindowEnabled()).not.toThrow();
    });

    it('_escape e _isProcessorInternal', () => {
        const m = new WaveConfigManager();
        expect(m._escape('<a&b>')).toBe('&lt;a&amp;b&gt;');
        expect(m._escape(null)).toBe('');
        expect(m._isProcessorInternal('me3_x')).toBe(true);
        expect(m._isProcessorInternal('arr_me3_y')).toBe(true);
        expect(m._isProcessorInternal('comp_me3_x')).toBe(false);
        expect(m._isProcessorInternal('')).toBe(false);
    });
});

describe('filtro de texto', () => {
    async function aberto() {
        projeto();
        const m = novo();
        await m.refresh();
        return m;
    }
    const digitar = (texto) => {
        const i = el('waveConfigFilterInput');
        i.value = texto;
        i.dispatchEvent(new Event('input'));
    };

    it('literal, sem caixa: lista plana com destaque, pula o encanamento me3_', async () => {
        const m = await aberto();
        digitar('CL');
        expect(m._filterText).toBe('CL');
        expect(el('waveConfigFilterClear').hidden).toBe(false);
        expect(el('waveConfigTree').classList.contains('flat-mode')).toBe(true);
        expect(linhasDeSinal()).toEqual(['tb.clk', 'tb.dut.clk', 'tb.dut.u_core.clk']);
        expect(el('waveConfigTree').querySelector('[data-signal="tb.clk"] mark').textContent).toBe('cl');
        expect(el('waveConfigFilterCount').textContent).toBe('modal.waveConfig.filterMatchCountOther');
        expect(m._filterScopesOnPath).toEqual(new Set(['tb', 'tb.dut', 'tb.dut.u_core']));

        digitar('me3');
        expect(m._filterMatchCount).toBe(0);
        expect(el('waveConfigFilterCount').textContent).toBe('modal.waveConfig.filterNoMatch');
        expect(el('waveConfigFilterCount').classList.contains('no-match')).toBe(true);

        digitar('Alias proc');
        expect(linhasDeSinal()).toEqual(['tb.dut.u_core.proc_acc']);
        expect(el('waveConfigFilterCount').textContent).toBe('modal.waveConfig.filterMatchCountOne');
        expect(el('waveConfigFilterCount').classList.contains('no-match')).toBe(false);

        window.t = (k, p) => `${k}=${p ? p.count : '-'}`;
        digitar('q');
        expect(el('waveConfigFilterCount').textContent).toBe('modal.waveConfig.filterMatchCountOther=2');

        digitar('   ');
        expect(m._filterRegex).toBeNull();
        expect(el('waveConfigFilterCount').textContent).toBe('');
        expect(el('waveConfigTree').classList.contains('flat-mode')).toBe(false);
    });

    it('processor only junto do filtro de texto', async () => {
        const m = await aberto();
        m._processorOnly = true;
        digitar('c');
        expect(linhasDeSinal()).toEqual(['tb.dut.u_core.proc_acc']);
    });

    it('toggle de caixa e de regex; regex invalida cai no literal', async () => {
        const m = await aberto();
        digitar('CLK');
        expect(m._filterMatchCount).toBe(3);
        el('waveConfigFilterCase').click();
        expect(m._filterCaseSensitive).toBe(true);
        expect(el('waveConfigFilterCase').classList.contains('active')).toBe(true);
        expect(el('waveConfigFilterCase').getAttribute('aria-pressed')).toBe('true');
        expect(m._filterMatchCount).toBe(0);
        el('waveConfigFilterCase').click();

        digitar('^c.k$');
        expect(m._filterMatchCount).toBe(0);
        el('waveConfigFilterRegex').click();
        expect(m._filterIsRegex).toBe(true);
        expect(el('waveConfigFilterRegex').getAttribute('aria-pressed')).toBe('true');
        expect(m._filterMatchCount).toBe(3);

        digitar('(');
        expect(m._filterRegex.source).toBe('\\(');
        expect(m._filterMatchCount).toBe(0);

        // Casamento de largura zero nao trava o destaque.
        digitar('^');
        expect(m._highlightMatches('clk')).toBe('clk');
        expect(m._highlightMatches('')).toBe('');
        el('waveConfigFilterRegex').click();
        expect(m._filterIsRegex).toBe(false);
    });

    it('limpar pelo botao e o Esc em dois passos', async () => {
        const m = await aberto();
        m.modal.setAttribute('aria-hidden', 'false');
        digitar('clk');
        el('waveConfigFilterClear').click();
        expect(m._filterText).toBe('');
        expect(el('waveConfigFilterInput').value).toBe('');
        expect(el('waveConfigFilterClear').hidden).toBe(true);
        expect(document.activeElement).toBe(el('waveConfigFilterInput'));

        digitar('clk');
        el('waveConfigFilterInput').focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(m._filterText).toBe('');
        expect(m.isOpen()).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(m.isOpen()).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        expect(m.isOpen()).toBe(false);
    });

    it('_setFilterText aceita nulo e o valor ja no input', async () => {
        const m = await aberto();
        el('waveConfigFilterInput').value = 'q';
        m._setFilterText('q');
        expect(m._filterMatchCount).toBe(2);
        m._setFilterText(undefined);
        expect(m._filterText).toBe('');
    });

    it('_computeFilterMatches sem arvore so zera o contador', () => {
        const m = novo();
        m._filterText = 'x';
        m._compileFilter();
        m._computeFilterMatches();
        expect(m._filterMatchCount).toBe(0);
        expect(el('waveConfigFilterCount').textContent).toBe('modal.waveConfig.filterNoMatch');
    });

    it('Ctrl+F e Cmd+F focam a busca, dentro do modal', () => {
        const m = novo();
        const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true });
        m.modal.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(el('waveConfigFilterInput'));
        el('closeWaveConfigModal').focus();
        m.modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', metaKey: true }));
        expect(document.activeElement).toBe(el('waveConfigFilterInput'));
        const outro = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, cancelable: true });
        m.modal.dispatchEvent(outro);
        expect(outro.defaultPrevented).toBe(false);
        el('waveConfigFilterInput').remove();
        m.elements.filterInput = null;
        const semInput = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true });
        m.modal.dispatchEvent(semInput);
        expect(semInput.defaultPrevented).toBe(false);
    });
});

describe('botoes de fechar, abrir e preferencias do Surfer', () => {
    it('fechar, cancelar e clique no fundo fecham; clique dentro nao', () => {
        const m = novo();
        const abrir = () => m.modal.setAttribute('aria-hidden', 'false');
        abrir();
        el('closeWaveConfigModal').click();
        expect(m.isOpen()).toBe(false);
        abrir();
        el('cancelWaveConfig').click();
        expect(m.isOpen()).toBe(false);
        abrir();
        m.modal.querySelector('.container').click();
        expect(m.isOpen()).toBe(true);
        m.modal.dispatchEvent(new MouseEvent('click'));
        expect(m.isOpen()).toBe(false);
        expect(m.modal.classList.contains('show')).toBe(false);
    });

    it('o botao da barra abre e o Save salva', async () => {
        const m = novo();
        const abrir = vi.spyOn(m, 'open').mockResolvedValue();
        const salvar = vi.spyOn(m, 'save').mockResolvedValue();
        el('waveConfigBtn').click();
        el('saveWaveConfig').click();
        expect(abrir).toHaveBeenCalledTimes(1);
        expect(salvar).toHaveBeenCalledTimes(1);
    });

    it('as preferencias do Surfer sao gravadas e a multi-janela desabilita com a aba', () => {
        novo();
        const multi = el('waveConfigSurferMultiWindow');
        const aba = el('waveConfigSurferInTab');
        multi.checked = true;
        multi.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('aurora.surferMultiWindow')).toBe('true');
        aba.checked = true;
        aba.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('aurora.surferInTab')).toBe('true');
        expect(multi.disabled).toBe(true);
        expect(multi.closest('.wave-tree-filter').classList.contains('is-disabled')).toBe(true);
        aba.checked = false;
        aba.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('aurora.surferInTab')).toBe('false');
        expect(multi.disabled).toBe(false);
    });

    it('sem o checkbox da aba, a multi-janela segue a preferencia gravada', () => {
        const m = novo();
        m.elements.surferInTabCb = null;
        m._syncSurferMultiWindowEnabled();
        expect(el('waveConfigSurferMultiWindow').disabled).toBe(true);
    });
});

describe('save()', () => {
    it('sem projeto so fecha', async () => {
        projeto(null, null);
        const m = novo();
        m.modal.setAttribute('aria-hidden', 'false');
        await m.save();
        expect(m.isOpen()).toBe(false);
        expect(WaveStore.update).not.toHaveBeenCalled();
    });

    it('sem testbench so fecha', async () => {
        projeto();
        cfg = { testbenchFile: '' };
        const m = novo();
        m.modal.setAttribute('aria-hidden', 'false');
        await m.save();
        expect(m.isOpen()).toBe(false);
        expect(WaveStore.update).not.toHaveBeenCalled();
    });

    it('grava a lista ordenada; sem mudanca nao liga wcCustomized', async () => {
        projeto();
        const m = novo();
        m.selected = new Set(['tb.q', 'tb.clk']);
        m._initialSelection = new Set(['tb.clk', 'tb.q']);
        await m.save();
        expect(WaveStore.update).toHaveBeenCalledWith('/proj', 'tb', expect.any(Function));
        expect(estadoOnda).toEqual({ tbPath: '/proj/tb.v', tbModule: 'tb', waveSignals: ['tb.clk', 'tb.q'], wcInitialized: true });
    });

    it('com mudanca liga wcCustomized (tamanho ou conteudo)', async () => {
        projeto();
        const m = novo();
        m.selected = new Set(['tb.q']);
        m._initialSelection = new Set(['tb.clk']);
        await m.save();
        expect(estadoOnda.wcCustomized).toBe(true);
        estadoOnda = null;
        m.selected = new Set(['tb.q', 'tb.clk']);
        await m.save();
        expect(estadoOnda.wcCustomized).toBe(true);
    });
});
