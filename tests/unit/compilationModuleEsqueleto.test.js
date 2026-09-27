// @vitest-environment happy-dom
//
// O que sobrou no CompilationModule depois de os passos sairem para modulos
// proprios: a configuracao (de onde vem o .spf e a forma que os validadores
// devolvem), a pasta Temp do processador, as delegacoes que o compilation_flow
// e o wave_config_manager chamam, e os avisos de topo duplicado.
//
// Os passos de compilacao dos processadores tem teste proprio
// (processor_compiler); aqui interessa o que a instancia entrega a eles.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(), runSpecStreamed: vi.fn(), setAuditHook: vi.fn(), setTerminalHook: vi.fn(), resolveSpec: vi.fn(),
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
vi.mock('../../js/project/project_store.js', () => ({
    ProjectStore: { getSpfPath: vi.fn(() => null), getProjectPath: vi.fn(() => null) },
}));
vi.mock('../../js/project/spf_store.js', () => ({
    SpfStore: { read: vi.fn() },
}));
vi.mock('../../js/compilation/processor_compiler.js', async (original) => ({
    ...(await original()),
    cmmCompilation: vi.fn(async (_deps, _proc, anotar) => { anotar('C:/proj/fir/fir.cmm'); return 'cmm'; }),
    cppCompilation: vi.fn(async (_deps, _proc, anotar) => { anotar('C:/proj/fir/fir.cpp'); return 'cpp'; }),
    asmCompilation: vi.fn(async () => 'asm'),
}));
vi.mock('../../js/compilation/wave_signal_validator.js', async (original) => ({
    ...(await original()),
    validateWaveSelection: vi.fn(async () => ['tb.clk']),
}));

import { ProjectStore } from '../../js/project/project_store.js';
import { SpfStore } from '../../js/project/spf_store.js';
import { cmmCompilation, cppCompilation, asmCompilation } from '../../js/compilation/processor_compiler.js';
import { validateWaveSelection } from '../../js/compilation/wave_signal_validator.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TEMP = PROJ + '/.aurora/Temp';

function makeTerminal() {
    const calls = [];
    return { calls, appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }) };
}

let api;
beforeEach(() => {
    terminal = makeTerminal();
    api = {
        joinPath: vi.fn(async (...p) => p.join('/')),
        mkdir: vi.fn(async () => {}),
        getComponentsPath: vi.fn(async () => COMP),
        getCurrentProject: vi.fn(async () => ({ spfPath: 'C:/outro/outro.spf', projectPath: 'C:/outro' })),
    };
    window.electronAPI = api;
    window.t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
    ProjectStore.getSpfPath.mockReturnValue(null);
    ProjectStore.getProjectPath.mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.t;
    delete window.initializeGlobalTerminalManager;
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

async function novoModulo(projectPath = PROJ) {
    const mod = new CompilationModule(projectPath);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    return mod;
}

describe('de onde vem a configuracao', () => {
    it('o .spf DESTA janela, pelo ProjectStore, sem perguntar ao main', async () => {
        ProjectStore.getSpfPath.mockReturnValue(PROJ + '/proj.spf');
        ProjectStore.getProjectPath.mockReturnValue(PROJ);
        SpfStore.read.mockResolvedValue({ synthesizableFiles: [] });
        const mod = await novoModulo();

        await mod.loadConfig();

        expect(SpfStore.read).toHaveBeenCalledWith(PROJ + '/proj.spf');
        expect(api.getCurrentProject).not.toHaveBeenCalled();
        expect(mod.projectConfig).toEqual({ synthesizableFiles: [] });
    });

    it('store vazio (sessao ainda restaurando): o main de reserva', async () => {
        ProjectStore.getSpfPath.mockReturnValue(null);
        ProjectStore.getProjectPath.mockReturnValue(null);
        SpfStore.read.mockResolvedValue({ x: 1 });
        const mod = await novoModulo();
        await mod.loadConfig();
        expect(SpfStore.read).toHaveBeenCalledWith('C:/outro/outro.spf');
    });

    it('.spf que nao se le vira configuracao nula, sem lancar', async () => {
        ProjectStore.getSpfPath.mockReturnValue(PROJ + '/proj.spf');
        SpfStore.read.mockRejectedValue(new Error('JSON quebrado'));
        const mod = await novoModulo();
        mod.projectConfig = { velho: true };
        await mod.loadConfig();
        expect(mod.projectConfig).toBeNull();
    });

    it('main sem .spf: configuracao nula', async () => {
        api.getCurrentProject.mockResolvedValue({ projectPath: PROJ });
        const mod = await novoModulo();
        await mod.loadConfig();
        expect(SpfStore.read).not.toHaveBeenCalled();
        expect(mod.projectConfig).toBeNull();
    });

    it('sem projeto nenhum: lanca', async () => {
        api.getCurrentProject.mockResolvedValue({});
        const mod = await novoModulo(null);
        await expect(mod.loadConfig()).rejects.toThrow('No current project path available for loading configuration');
    });
});

describe('a forma da configuracao', () => {
    it('dois topos marcados: vale o primeiro, e o aviso nomeia os dois lados', async () => {
        const mod = await novoModulo();
        mod.projectConfig = {
            synthesizableFiles: [
                { path: PROJ + '/a.v', isTopLevel: true },
                { path: PROJ + '/b.v', name: 'b.v', isTopLevel: true },
                null,
            ].filter(Boolean),
            testbenchFiles: [
                { path: PROJ + '/t1.v', name: 't1.v', isTopLevel: true },
                { path: PROJ + '/t2.v', isTopLevel: true },
            ],
        };

        expect(mod.loadConfigUnsafe()).toEqual({
            topLevelFile: PROJ + '/a.v',
            testbenchFile: PROJ + '/t1.v',
            synthesizableFiles: [PROJ + '/a.v', PROJ + '/b.v'],
        });
        expect(terminal.calls).toEqual([
            { term: 'tveri', level: 'warning', msg: 'terminal.veri.multipleTops {"count":2,"category":"synthesizable","picked":"a.v","ignored":"b.v"}' },
            { term: 'tveri', level: 'warning', msg: 'terminal.veri.multipleTops {"count":2,"category":"testbench","picked":"t1.v","ignored":"t2.v"}' },
        ]);
    });

    it('sem nome nem caminho, o aviso usa ?', async () => {
        const mod = await novoModulo();
        mod.projectConfig = { synthesizableFiles: [{ isTopLevel: true }, { isTopLevel: true }] };
        mod.loadConfigUnsafe();
        expect(terminal.calls[0].msg).toContain('"picked":"?","ignored":"?"');
    });

    it.each([
        ['validateForWave', (m) => m.validateForWave()],
        ['loadConfigUnsafe', (m) => m.loadConfigUnsafe()],
    ])('%s sem configuracao: lanca', async (_nome, chamar) => {
        const mod = await novoModulo();
        expect(() => chamar(mod)).toThrow('Project configuration not loaded');
    });

    it('o topo da simulacao cai no topo do design quando nao ha testbench', async () => {
        const mod = await novoModulo();
        expect(mod._waveDeriveSimTopModule({ testbenchFile: PROJ + '/tb.sv' })).toBe('tb');
        expect(mod._waveDeriveSimTopModule({ topLevelFile: PROJ + '/filtro.v' })).toBe('filtro');
        expect(mod._waveDeriveSimTopModule({})).toBeNull();
    });
});

describe('o que a instancia entrega', () => {
    it('ensureDirectories cria a Temp do projeto e a do processador', async () => {
        const mod = await novoModulo();
        expect(await mod.ensureDirectories('fir')).toBe(TEMP + '/fir');
        expect(api.mkdir.mock.calls).toEqual([[TEMP], [TEMP + '/fir']]);
    });

    it('ensureDirectories que falha sobe o erro', async () => {
        api.mkdir.mockRejectedValueOnce(new Error('EPERM'));
        const mod = await novoModulo();
        await expect(mod.ensureDirectories('fir')).rejects.toThrow('EPERM');
    });

    it('a compilacao dos processadores recebe a sacola da instancia, e o fonte compilado fica anotado', async () => {
        const mod = await novoModulo();
        mod.projectConfig = { processors: [] };
        const proc = { name: 'fir' };
        const deps = { projectPath: PROJ, terminalManager: terminal, projectConfig: { processors: [] }, componentsPath: COMP };

        expect(await mod.cmmCompilation(proc)).toBe('cmm');
        expect(cmmCompilation).toHaveBeenCalledWith(deps, proc, expect.any(Function));
        expect(mod.lastCompiledCmmPath).toBe('C:/proj/fir/fir.cmm');

        expect(await mod.cppCompilation(proc)).toBe('cpp');
        expect(cppCompilation).toHaveBeenCalledWith(deps, proc, expect.any(Function));
        expect(mod.lastCompiledCmmPath).toBe('C:/proj/fir/fir.cpp');

        expect(await mod.asmCompilation(proc)).toBe('asm');
        expect(asmCompilation).toHaveBeenCalledWith(deps, proc, null);
        await mod.asmCompilation(proc, 'preambulo');
        expect(asmCompilation).toHaveBeenLastCalledWith(deps, proc, 'preambulo');
    });

    it('_validateWaveSelection (o wave_config_manager chama) delega com a sacola', async () => {
        const mod = await novoModulo();
        expect(await mod._validateWaveSelection(['tb.clk'], ['a.v'], 'tb', 'tb')).toEqual(['tb.clk']);
        expect(validateWaveSelection).toHaveBeenCalledWith(
            expect.objectContaining({ projectPath: PROJ }), ['tb.clk'], ['a.v'], 'tb', 'tb');
        await mod._validateWaveSelection([], [], 'tb');
        expect(validateWaveSelection).toHaveBeenLastCalledWith(expect.anything(), [], [], 'tb', null);
    });

    it('com o terminal global da janela, a instancia usa ele', async () => {
        const global = makeTerminal();
        window.initializeGlobalTerminalManager = () => global;
        const mod = await novoModulo();
        expect(mod.terminalManager).toBe(global);
        expect(window._latestCompilationModule).toBe(mod);
    });
});
