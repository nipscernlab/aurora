import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// cmm/asm rodam .exe externos via runSpec e dirigem status/abas, mockados aqui
// pra exercitar o fluxo + o seam (lastCompiledCmmPath) sem tocar a toolchain.
// Os builders (puros) e o insertChegueiToaqui rodam de verdade.
vi.mock('../../js/compilation/spec_runner.js', () => ({ runSpec: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { saveAllFiles: vi.fn() } }));
vi.mock('../../js/ui/status_updater.js', () => ({
    statusUpdater: {
        startCompilation: vi.fn(),
        compilationSuccess: vi.fn(),
        compilationError: vi.fn(),
    },
}));

import { runSpec } from '../../js/compilation/spec_runner.js';
import {
    getSelectedCmmFile, getTestbenchInfo, ensureChegueiToaqui,
    cmmCompilation, asmCompilation, stageProcessorMemoryFiles,
} from '../../js/compilation/processor_compiler.js';

// fixtures .cmm (insertChegueiToaqui real)
const CMM_WITH_MAIN = 'void main(){\n  int x;\n  x = 1;\n}\n';
const CMM_NO_MAIN = 'int helper(){ return 0; }\n';
const CMM_HAS_TOAQUI = 'void main(){\n  #TOAQUI\n}\n';

function makeTerm() {
    const calls = [];
    return {
        calls,
        clearTerminal: async () => {},
        appendToTerminal: (term, msg, level, opts) => calls.push({ term, msg, level, opts }),
        processExecutableOutput: () => {},
    };
}

function makeFakeApi() {
    const files = new Map();
    const norm = (p) => p.replace(/\\/g, '/');
    return {
        _files: files,
        _folders: {},   // dir -> [{ isDirectory, path }]
        _dirFiles: {},  // dir -> [fileName]
        joinPath: async (...parts) => parts.filter(Boolean).join('/'),
        createDirectory: async () => {},
        mkdir: async () => {},
        fileExists: async (p) => files.has(norm(p)),
        readFile: async (p) => {
            const c = files.get(norm(p));
            if (c === undefined) throw new Error('ENOENT ' + p);
            return c;
        },
        writeFile: async (p, content) => { files.set(norm(p), content); },
        copyFile: vi.fn(async () => {}),
        getFolderFiles: vi.fn(async function (dir) { return this._folders[norm(dir)] ?? []; }),
        listFilesInDirectory: vi.fn(async function (dir) { return this._dirFiles[norm(dir)] ?? []; }),
    };
}

let deps;
function makeDeps({ projectConfig = {} } = {}) {
    deps = {
        projectPath: '/proj',
        componentsPath: '/comp',
        projectConfig,
        terminalManager: makeTerm(),
    };
    return deps;
}
const logged = (level) => deps.terminalManager.calls.some((c) => c.level === level);

beforeEach(() => {
    globalThis.window = { electronAPI: makeFakeApi(), getYancLang: () => 'pt' };
    runSpec.mockReset();
});
afterEach(() => {
    delete globalThis.window;
    vi.clearAllMocks();
});

describe('getSelectedCmmFile', () => {
    it('devolve o cmmFile do processador', async () => {
        expect(await getSelectedCmmFile({ cmmFile: 'foo.cmm' })).toBe('foo.cmm');
    });
    it('lanca noCmm quando o processador nao tem cmmFile', async () => {
        await expect(getSelectedCmmFile({})).rejects.toThrow('error.config.noCmm');
    });
});

describe('getTestbenchInfo', () => {
    it('usa o testbench custom (path absoluto) direto', async () => {
        const d = makeDeps();
        const r = await getTestbenchInfo(d, { name: 'P', testbenchFile: '/abs/my_tb.v' }, 'base');
        expect(r).toEqual({ tbModule: 'my_tb', tbFile: '/abs/my_tb.v' });
    });
    it('cai na convencao <base>_tb.v em Simulation/ quando standard', async () => {
        const d = makeDeps();
        const r = await getTestbenchInfo(d, { name: 'ProcX', testbenchFile: 'standard' }, 'foo');
        expect(r).toEqual({ tbModule: 'foo_tb', tbFile: '/proj/ProcX/Simulation/foo_tb.v' });
    });
});

describe('ensureChegueiToaqui', () => {
    const SW = '/proj/ProcX/Software';
    it('adiciona #TOAQUI quando ha main() sem a diretiva (escreve + info)', async () => {
        const d = makeDeps();
        window.electronAPI._files.set(`${SW}/foo.cmm`, CMM_WITH_MAIN);
        await ensureChegueiToaqui(d, SW, 'foo.cmm');
        expect(window.electronAPI._files.get(`${SW}/foo.cmm`)).toContain('#TOAQUI');
        expect(logged('info')).toBe(true);
    });
    it('idempotente: nao reescreve quando #TOAQUI ja existe (log plain)', async () => {
        const d = makeDeps();
        window.electronAPI._files.set(`${SW}/foo.cmm`, CMM_HAS_TOAQUI);
        await ensureChegueiToaqui(d, SW, 'foo.cmm');
        expect(window.electronAPI._files.get(`${SW}/foo.cmm`)).toBe(CMM_HAS_TOAQUI);
        expect(deps.terminalManager.calls.some((c) => c.level === 'plain')).toBe(true);
    });
    it('warning quando nao acha main() pra instrumentar', async () => {
        const d = makeDeps();
        window.electronAPI._files.set(`${SW}/foo.cmm`, CMM_NO_MAIN);
        await ensureChegueiToaqui(d, SW, 'foo.cmm');
        expect(window.electronAPI._files.get(`${SW}/foo.cmm`)).toBe(CMM_NO_MAIN);
        expect(logged('warning')).toBe(true);
    });
    it('silencioso (sem throw) quando o .cmm nao existe', async () => {
        const d = makeDeps();
        await expect(ensureChegueiToaqui(d, SW, 'missing.cmm')).resolves.toBeUndefined();
        expect(deps.terminalManager.calls).toEqual([]);
    });
});

describe('cmmCompilation (seam lastCompiledCmmPath + gating #TOAQUI)', () => {
    const proc = { name: 'ProcX', cmmFile: 'foo.cmm', showArrays: false };

    it('cacheia lastCompiledCmmPath e devolve o asmPath em sucesso', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const setLast = vi.fn();
        const asmPath = await cmmCompilation(d, proc, null, setLast);
        expect(setLast).toHaveBeenCalledTimes(1);
        expect(setLast).toHaveBeenCalledWith('/proj/ProcX/Software/foo.cmm');
        expect(asmPath).toBe('/proj/ProcX/Software/foo.asm');
    });

    it('instrumenta #TOAQUI quando chegueiInstrumentProc === name', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cmm', CMM_WITH_MAIN);
        await cmmCompilation(d, proc, 'ProcX', vi.fn());
        expect(window.electronAPI._files.get('/proj/ProcX/Software/foo.cmm')).toContain('#TOAQUI');
    });

    it('NAO instrumenta quando chegueiInstrumentProc !== name', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cmm', CMM_WITH_MAIN);
        await cmmCompilation(d, proc, null, vi.fn());
        expect(window.electronAPI._files.get('/proj/ProcX/Software/foo.cmm')).toBe(CMM_WITH_MAIN);
    });

    it('lanca cmmFailed quando o cmmcomp retorna code != 0', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 2 });
        await expect(cmmCompilation(d, proc, null, vi.fn())).rejects.toThrow('error.compilation.cmmFailed');
    });
});

describe('asmCompilation', () => {
    const proc = { name: 'ProcX', cmmFile: 'foo.cmm', clk: '50', numClocks: '100', testbenchFile: 'standard' };

    it('copia o testbench auto-gerado quando standard (sucesso nos 2 passos)', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, proc, null);
        expect(window.electronAPI.copyFile).toHaveBeenCalledTimes(1);
        expect(window.electronAPI.copyFile).toHaveBeenCalledWith(
            '/comp/Temp/ProcX/foo_tb.v', '/proj/ProcX/Simulation/foo_tb.v',
        );
    });

    it('NAO copia testbench quando o processador usa um tb custom', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, { ...proc, testbenchFile: '/abs/custom_tb.v' }, null);
        expect(window.electronAPI.copyFile).not.toHaveBeenCalled();
    });

    it('lanca asmPrepFailed quando o appcomp falha', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValueOnce({ code: 1 }); // appcomp falha no 1o passo
        await expect(asmCompilation(d, proc, null)).rejects.toThrow('error.compilation.asmPrepFailed');
    });
});

describe('stageProcessorMemoryFiles', () => {
    it('no-op silencioso em projeto sem processador', async () => {
        const d = makeDeps({ projectConfig: { processors: [] } });
        await stageProcessorMemoryFiles(d, '/comp/Temp');
        expect(deps.terminalManager.calls).toEqual([]);
        expect(window.electronAPI.getFolderFiles).not.toHaveBeenCalled();
    });

    it('copia os pc_*_mem.txt dos subdirs (sucesso silencioso)', async () => {
        const d = makeDeps({ projectConfig: { processors: [{ name: 'ProcX' }] } });
        window.electronAPI._folders['/comp/Temp'] = [{ isDirectory: true, path: '/comp/Temp/ProcX' }];
        window.electronAPI._dirFiles['/comp/Temp/ProcX'] = ['pc_ProcX_mem.txt', 'other.txt'];
        await stageProcessorMemoryFiles(d, '/comp/Temp');
        expect(window.electronAPI.copyFile).toHaveBeenCalledWith(
            '/comp/Temp/ProcX/pc_ProcX_mem.txt', '/comp/Temp/pc_ProcX_mem.txt',
        );
        expect(logged('warning')).toBe(false); // staged > 0 → sem warning
    });

    it('avisa quando ha processador mas nenhum pc_*_mem.txt', async () => {
        const d = makeDeps({ projectConfig: { processors: [{ name: 'ProcX' }] } });
        window.electronAPI._folders['/comp/Temp'] = [{ isDirectory: true, path: '/comp/Temp/ProcX' }];
        window.electronAPI._dirFiles['/comp/Temp/ProcX'] = ['readme.txt'];
        await stageProcessorMemoryFiles(d, '/comp/Temp');
        expect(logged('warning')).toBe(true);
    });
});
