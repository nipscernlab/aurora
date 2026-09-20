import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// cmm/asm rodam .exe externos via runSpec e dirigem status/abas, mockados aqui
// pra exercitar o fluxo + o seam (lastCompiledCmmPath) sem tocar a toolchain.
// Os builders (puros) rodam de verdade.
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
    getSelectedSourceFile, getTestbenchInfo,
    cmmCompilation, cppCompilation, asmCompilation, stageProcessorMemoryFiles,
} from '../../js/compilation/processor_compiler.ts';

// fixture .cmm: o que esta no disco tem de continuar la, byte a byte
const CMM_WITH_MAIN = 'void main(){\n  int x;\n  x = 1;\n}\n';

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

describe('getSelectedSourceFile', () => {
    it('devolve o fonte declarado no cmmFile', async () => {
        expect(await getSelectedSourceFile({ cmmFile: 'foo.cmm' })).toBe('foo.cmm');
    });
    it('lanca noCmm quando o processador nao declara fonte nenhum', async () => {
        await expect(getSelectedSourceFile({})).rejects.toThrow('error.config.noCmm');
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

describe('cmmCompilation (seam lastCompiledCmmPath; o .cmm nunca e tocado)', () => {
    const proc = { name: 'ProcX', cmmFile: 'foo.cmm', showArrays: false };

    it('cacheia lastCompiledCmmPath e devolve o asmPath em sucesso', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const setLast = vi.fn();
        const asmPath = await cmmCompilation(d, proc, setLast);
        expect(setLast).toHaveBeenCalledTimes(1);
        expect(setLast).toHaveBeenCalledWith('/proj/ProcX/Software/foo.cmm');
        expect(asmPath).toBe('/proj/ProcX/Software/foo.asm');
    });

    it('roda so o cmmcomp, com as opcoes nomeadas, e nao toca o .cmm do usuario', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cmm', CMM_WITH_MAIN);
        await cmmCompilation(d, proc, vi.fn());
        expect(runSpec).toHaveBeenCalledTimes(1);
        const spec = runSpec.mock.calls[0][0];
        expect(spec.step).toBe('cmm');
        expect(spec.args).toEqual(expect.arrayContaining(['-i', 'foo.cmm', '-n', 'foo']));
        expect(spec.args).not.toContain('-c');
        expect(window.electronAPI._files.get('/proj/ProcX/Software/foo.cmm')).toBe(CMM_WITH_MAIN);
    });

    it('lanca cmmFailed quando o cmmcomp retorna code != 0', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 2 });
        await expect(cmmCompilation(d, proc, vi.fn())).rejects.toThrow('error.compilation.cmmFailed');
    });
});

describe('cppCompilation (cpppp + cppcomp, irmao do cmmCompilation)', () => {
    const proc = { name: 'ProcX', sourceFile: 'foo.cpp' };
    const CPP_SEM_INCLUDE = '#pragma yanc prname foo\nvoid main(void) { int a = 1; }\n';
    const CPP_COM_INCLUDE = '#include <cstdint>\n' + CPP_SEM_INCLUDE;

    it('roda cpppp e depois cppcomp, nessa ordem, e devolve o mesmo asmPath do cmm', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cpp', CPP_SEM_INCLUDE);
        const asmPath = await cppCompilation(d, proc, vi.fn());
        expect(runSpec).toHaveBeenCalledTimes(2);
        const [pp, cpp] = runSpec.mock.calls.map((c) => c[0]);
        expect(pp.step).toBe('cpp-pp');
        expect(cpp.step).toBe('cpp');
        // o cpppp recebe o fonte por caminho absoluto e escreve na Temp do projeto
        expect(pp.args).toEqual(expect.arrayContaining(['-i', '/proj/ProcX/Software/foo.cpp', '-I', '/comp/Header']));
        expect(pp.args[pp.args.indexOf('-o') + 1]).toMatch(/\/proj\/\.aurora\/Temp\/ProcX.pp\.cpp$/);
        // o cppcomp le o que o cpppp escreveu, e o -n segue a base do fonte
        expect(cpp.args[cpp.args.indexOf('-i') + 1]).toBe(pp.args[pp.args.indexOf('-o') + 1]);
        expect(cpp.args).toEqual(expect.arrayContaining(['-n', 'foo', '-p', '/proj/ProcX']));
        expect(asmPath).toBe('/proj/ProcX/Software/foo.asm');
    });

    it('cacheia o .cpp da pessoa (nao o pp.cpp) antes de rodar, como o cmm faz', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const setLast = vi.fn();
        await cppCompilation(d, proc, setLast);
        expect(setLast).toHaveBeenCalledTimes(1);
        expect(setLast).toHaveBeenCalledWith('/proj/ProcX/Software/foo.cpp');
        // antes do primeiro runSpec: um clique apos falha resolve para o fonte
        expect(setLast.mock.invocationCallOrder[0]).toBeLessThan(runSpec.mock.invocationCallOrder[0]);
    });

    it('avisa da numeracao de linha so quando o fonte tem #include', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cpp', CPP_COM_INCLUDE);
        await cppCompilation(d, proc, vi.fn());
        expect(d.terminalManager.calls.some((c) => c.msg === 'terminal.cpp.includeWarning')).toBe(true);

        const d2 = makeDeps();
        window.electronAPI._files.set('/proj/ProcX/Software/foo.cpp', CPP_SEM_INCLUDE);
        await cppCompilation(d2, proc, vi.fn());
        expect(d2.terminalManager.calls.some((c) => c.msg === 'terminal.cpp.includeWarning')).toBe(false);
    });

    it('diz uma vez que o lado C++ so fala ingles', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await cppCompilation(d, proc, vi.fn());
        expect(d.terminalManager.calls.filter((c) => c.msg === 'terminal.cpp.englishOnly')).toHaveLength(1);
    });

    it('falha do cpppp para antes do cppcomp, com cppPpFailed', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValueOnce({ code: 1 });
        await expect(cppCompilation(d, proc, vi.fn())).rejects.toThrow('error.compilation.cppPpFailed');
        expect(runSpec).toHaveBeenCalledTimes(1);
    });

    it('falha do cppcomp lanca cppFailed', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1 });
        await expect(cppCompilation(d, proc, vi.fn())).rejects.toThrow('error.compilation.cppFailed');
        expect(runSpec).toHaveBeenCalledTimes(2);
    });

    it('aceita o campo legado cmmFile apontando para um .cpp', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const asmPath = await cppCompilation(d, { name: 'ProcX', cmmFile: 'bar.cpp' }, vi.fn());
        expect(asmPath).toBe('/proj/ProcX/Software/bar.asm');
    });
});

describe('asmCompilation', () => {
    const proc = { name: 'ProcX', cmmFile: 'foo.cmm', clk: '50', numClocks: '100', testbenchFile: 'standard' };

    it('copia o testbench auto-gerado quando standard (sucesso nos 2 passos)', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, proc, null);
        expect(window.electronAPI.copyFile).toHaveBeenCalledTimes(1);
        // O tb gerado sai da Temp DO PROJETO, <projeto>/.aurora/Temp/<proc>/,
        // nunca de components/Temp (js/project/project_temp.js).
        expect(window.electronAPI.copyFile).toHaveBeenCalledWith(
            '/proj/.aurora/Temp/ProcX/foo_tb.v', '/proj/ProcX/Simulation/foo_tb.v',
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
