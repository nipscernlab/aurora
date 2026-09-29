// @vitest-environment happy-dom
//
// A geracao da hierarquia do projeto pelo Yosys, a que o botao de Verilog roda
// depois da checagem de sintaxe e que alimenta a vista hierarquica da arvore.
//
// O caminho entra pelo CompilationModule, e nao pela funcao que ele chama,
// para que o mesmo arquivo prove o comportamento antes e depois de a geracao
// sair do compilation_module.js. O contrato travado: o script `.ys` que vai ao
// Yosys (a biblioteca HDL do SAPHO antes dos arquivos do projeto, o topo, o
// JSON na Temp do projeto), quem recebe a arvore, o que chega ao terminal e as
// tres desistencias, que viram aviso e `false` em vez de erro.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(),
    runSpecStreamed: vi.fn(),
    setAuditHook: vi.fn(),
    setTerminalHook: vi.fn(),
    resolveSpec: vi.fn(),
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({
    TabManager: { saveAllFiles: vi.fn(async () => {}), tabs: new Map() },
}));

let terminal;
vi.mock('../../js/terminal/terminal_module.js', () => ({
    TerminalManager: class {
        constructor() { return terminal; }
    },
}));

// O resumo do design e cortesia: se ele quebrar, a hierarquia ja foi entregue e
// o metodo continua devolvendo true. `quebrarResumo` liga essa falha.
let quebrarResumo = false;
vi.mock('../../js/compilation/verilog_stats.js', async (original) => {
    const real = await original();
    return {
        ...real,
        resumirHierarquiaYosys: (...args) => {
            if (quebrarResumo) throw new Error('resumo quebrado');
            return real.resumirHierarquiaYosys(...args);
        },
    };
});

// O desenho da arvore e outro modulo; aqui interessa so quem o chama.
vi.mock('../../js/compilation/hierarchy_view.js', () => ({
    renderHierarchy: vi.fn(),
    refreshHierarchyFocusHighlight: vi.fn(),
}));

import { runSpec } from '../../js/compilation/spec_runner.js';
import { renderHierarchy, refreshHierarchyFocusHighlight } from '../../js/compilation/hierarchy_view.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';
const TOP = PROJ + '/Hardware/filtro.v';
const SUB = PROJ + '/Hardware/soma.v';
const HDL = COMP + '/SAPHO';
const JSON_SAIDA = TEMP + '/project_hierarchy.json';
const SCRIPT = TEMP + '/project_hierarchy_gen.ys';

// O que o Yosys escreveria: topo com duas instancias do mesmo submodulo, uma
// porta de cada direcao e celulas primitivas de duas familias.
const JSON_DO_YOSYS = {
    modules: {
        filtro: {
            attributes: { src: TOP + ':1.1-20.10' },
            ports: { clk: { direction: 'input' }, y: { direction: 'output' } },
            cells: {
                s0: { type: 'soma' },
                s1: { type: 'soma' },
                g: { type: '$and' },
                r0: { type: '$dff' },
                r1: { type: '$dff' },
            },
        },
        soma: { attributes: { src: SUB + ':1.1-5.10' }, cells: {} },
    },
};

function makeTerminal() {
    const calls = [];
    return {
        calls,
        appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }),
    };
}

let api;
let arquivos;
function makeFakeApi() {
    arquivos = new Map();
    return {
        joinPath: vi.fn(async (...partes) => {
            if (!partes.every((p) => typeof p === 'string')) {
                throw new TypeError('All arguments to join-path must be strings');
            }
            return partes.join('/').replace(/\/+/g, '/');
        }),
        listFilesInDirectory: vi.fn(async () => ['processor.v', 'core_tb.v', 'leia.txt', 42, 'ula.v']),
        writeFile: vi.fn(async (p, c) => { arquivos.set(p, c); return { success: true }; }),
        readFile: vi.fn(async (p) => {
            if (!arquivos.has(p)) throw new Error('ENOENT ' + p);
            return arquivos.get(p);
        }),
        getComponentsPath: vi.fn(async () => COMP),
    };
}

/** O Yosys falso: escreve o JSON onde o script mandou, e devolve o codigo. */
function ligarYosys({ code = 0, json = JSON_DO_YOSYS } = {}) {
    runSpec.mockImplementation(async () => {
        if (code === 0) arquivos.set(JSON_SAIDA, JSON.stringify(json));
        return { code };
    });
}

async function novoModulo(config) {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

const CONFIG = {
    topLevelFile: TOP,
    synthesizableFiles: [{ path: TOP }, { path: SUB }],
};

const doTerminal = () => terminal.calls.map((c) => [c.term, c.msg, c.level]);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    window.fileTreeViewController = { setHierarchyData: vi.fn() };
    quebrarResumo = false;
});

afterEach(() => {
    delete window.electronAPI;
    delete window.fileTreeViewController;
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('generateProjectHierarchy', () => {
    it('monta o script do Yosys, entrega a arvore e resume o design', async () => {
        const traduzidas = [];
        window.t = (k, p) => { traduzidas.push([k, p]); return k; };
        const mod = await novoModulo(CONFIG);
        ligarYosys();

        expect(await mod.generateProjectHierarchy()).toBe(true);

        // A biblioteca do SAPHO entra so com os .v que nao sao testbench, e
        // antes dos arquivos do projeto; o topo vem do nome do arquivo.
        expect(api.listFilesInDirectory).toHaveBeenCalledWith(HDL);
        const linhas = arquivos.get(SCRIPT).split('\n').map((l) => l.trim()).filter(Boolean);
        expect(linhas).toEqual([
            `read_verilog -sv "${HDL}/processor.v"`,
            `read_verilog -sv "${HDL}/ula.v"`,
            `read_verilog -sv "${TOP}"`,
            `read_verilog -sv "${SUB}"`,
            'hierarchy -top filtro',
            'proc',
            `write_json "${TEMP}\\project_hierarchy.json"`,
        ]);

        expect(runSpec).toHaveBeenCalledTimes(1);
        const [spec, opcoes] = runSpec.mock.calls[0];
        expect(spec).toMatchObject({
            step: 'yosys-hierarchy',
            binary: COMP + '/Packages/msys/mingw64/bin/yosys.exe',
            args: ['-s', SCRIPT],
            cwd: TEMP,
        });
        expect(opcoes).toEqual({ consumeEphemeral: true });

        // A arvore fica na instancia (o renderHierarchicalTree le dela) e vai
        // para o controlador da arvore de arquivos.
        expect(mod.hierarchyData.name).toBe('filtro');
        expect(mod.hierarchyData.children.map((c) => c.instanceName)).toEqual(['s0', 's1']);
        expect(window.fileTreeViewController.setHierarchyData).toHaveBeenCalledWith(mod.hierarchyData);

        expect(doTerminal()).toEqual([
            ['tveri', 'terminal.veri.hierarchyGen', undefined],
            ['tveri', 'terminal.veri.hierarchySuccess', 'success'],
            ['tveri', 'terminal.veri.designStats', 'tips'],
        ]);

        // O resumo sai do mesmo JSON, com as familias da mais para a menos numerosa.
        const [, resumo] = traduzidas.find(([k]) => k === 'terminal.veri.designStats');
        expect(resumo).toMatchObject({
            top: 'filtro', modules: 2, instances: 2, ports: 2, inputs: 1, outputs: 1, cells: 3,
        });
        expect(resumo.families).toMatch(/^2 terminal\.veri\.families\.registers, 1 terminal\.veri\.families\.\w+$/);
        delete window.t;
    });

    it('sem conseguir listar a HDL, avisa e segue so com os arquivos do projeto', async () => {
        api.listFilesInDirectory.mockRejectedValueOnce(new Error('EACCES'));
        const mod = await novoModulo(CONFIG);
        ligarYosys();

        expect(await mod.generateProjectHierarchy()).toBe(true);

        expect(terminal.calls[0]).toEqual({ term: 'tveri', msg: 'terminal.veri.hdlListWarn', level: 'warning' });
        expect(arquivos.get(SCRIPT)).not.toContain(HDL);
        expect(arquivos.get(SCRIPT)).toContain(`read_verilog -sv "${TOP}"`);
    });

    it('listagem da HDL que nao e lista e ignorada sem aviso', async () => {
        api.listFilesInDirectory.mockResolvedValueOnce(null);
        const mod = await novoModulo({ topLevelFile: TOP });
        ligarYosys();

        expect(await mod.generateProjectHierarchy()).toBe(true);

        expect(doTerminal().map((c) => c[1])).not.toContain('terminal.veri.hdlListWarn');
        // Sem synthesizableFiles no .spf o script so tem o topo e a escrita.
        expect(arquivos.get(SCRIPT)).not.toContain('read_verilog');
    });

    it('topo que o Yosys nao elaborou: entrega a arvore vazia e nao resume', async () => {
        const mod = await novoModulo(CONFIG);
        ligarYosys({ json: { modules: {} } });

        expect(await mod.generateProjectHierarchy()).toBe(true);

        expect(mod.hierarchyData).toEqual({ name: 'filtro', filePath: null, lineNumber: null, children: [] });
        expect(doTerminal().map((c) => c[1])).toEqual([
            'terminal.veri.hierarchyGen', 'terminal.veri.hierarchySuccess',
        ]);
    });

    it('resumo que quebra nao derruba a hierarquia ja entregue', async () => {
        quebrarResumo = true;
        const mod = await novoModulo(CONFIG);
        ligarYosys();

        expect(await mod.generateProjectHierarchy()).toBe(true);
        expect(window.fileTreeViewController.setHierarchyData).toHaveBeenCalled();
        expect(doTerminal().at(-1)).toEqual(['tveri', 'terminal.veri.hierarchySuccess', 'success']);
    });

    it('sem controlador de arvore na janela, a arvore fica so na instancia', async () => {
        delete window.fileTreeViewController;
        const mod = await novoModulo(CONFIG);
        ligarYosys();

        expect(await mod.generateProjectHierarchy()).toBe(true);
        expect(mod.hierarchyData.name).toBe('filtro');
    });

    it.each([
        ['sem configuracao carregada', null, 'Project configuration not loaded'],
        ['sem topLevelFile no .spf', { synthesizableFiles: [] }, "'topLevelFile' not found in .spf"],
    ])('%s: avisa e devolve false sem chamar o Yosys', async (_nome, config, motivo) => {
        // Um i18n que mostra os parametros, para ver o motivo dentro do aviso.
        window.t = (k, p) => (p ? `${k} ${p.message}` : k);
        try {
            const mod = await novoModulo(config);

            expect(await mod.generateProjectHierarchy()).toBe(false);

            expect(runSpec).not.toHaveBeenCalled();
            expect(doTerminal()).toEqual([
                ['tveri', `terminal.veri.hierarchyError ${motivo}`, 'warning'],
            ]);
        } finally {
            delete window.t;
        }
    });

    it('com o Yosys falhando, avisa e nao mexe na arvore', async () => {
        const mod = await novoModulo(CONFIG);
        ligarYosys({ code: 1 });

        expect(await mod.generateProjectHierarchy()).toBe(false);

        expect(mod.hierarchyData).toBeNull();
        expect(window.fileTreeViewController.setHierarchyData).not.toHaveBeenCalled();
        expect(doTerminal().at(-1)).toEqual(['tveri', 'terminal.veri.hierarchyError', 'warning']);
    });
});

describe('a vista hierarquica', () => {
    it('renderHierarchicalTree desenha a arvore desta instancia', async () => {
        const mod = await novoModulo(CONFIG);
        ligarYosys();
        await mod.generateProjectHierarchy();

        mod.renderHierarchicalTree();

        expect(renderHierarchy).toHaveBeenCalledWith(mod.hierarchyData);
    });

    // O CompilationModule e recriado a cada clique; o destaque do arquivo
    // aberto na arvore hierarquica tem de ser ligado uma vez so, senao cada
    // compilacao empilharia mais um ouvinte.
    it('trocar o arquivo em edicao refaz o destaque uma vez, com varias instancias', async () => {
        await novoModulo(CONFIG);
        await novoModulo(CONFIG);

        document.dispatchEvent(new Event('aurora:editing-file-changed'));

        expect(refreshHierarchyFocusHighlight).toHaveBeenCalledTimes(1);
    });
});
