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
import { TabManager } from '../../js/tabs/tab_manager.js';
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

describe('o fonte tem o nome do processador (yanc v7.1)', () => {
    it('um fonte com outro nome na pasta do processador e recusado, com a mensagem', async () => {
        await expect(getSelectedSourceFile({ name: 'ProcX', cmmFile: 'outro.cmm' }))
            .rejects.toThrow('error.compilation.fonteComOutroNome');
        await expect(getSelectedSourceFile({ name: 'ProcX', sourceFile: 'procx.cpp' }))
            .rejects.toThrow('error.compilation.fonteComOutroNome');
        expect(await getSelectedSourceFile({ name: 'ProcX', sourceFile: 'ProcX.cpp' })).toBe('ProcX.cpp');
    });

    it('a compilacao com fonte de outro nome para antes de chamar o yanc', async () => {
        const d = makeDeps();
        await expect(cmmCompilation(d, { name: 'ProcX', cmmFile: 'outro.cmm' }, vi.fn()))
            .rejects.toThrow('error.compilation.fonteComOutroNome');
        expect(runSpec).not.toHaveBeenCalled();
    });
});

describe('getTestbenchInfo', () => {
    it('usa o testbench custom (path absoluto) direto', async () => {
        const d = makeDeps();
        const r = await getTestbenchInfo(d, { name: 'P', testbenchFile: '/abs/my_tb.v' }, 'base');
        expect(r).toEqual({ tbModule: 'my_tb', tbFile: '/abs/my_tb.v' });
    });
    it('cai no <base>_tb.v da pasta de saida <proc>/<proc>/ quando standard', async () => {
        const d = makeDeps();
        const r = await getTestbenchInfo(d, { name: 'ProcX', testbenchFile: 'standard' }, 'foo');
        expect(r).toEqual({ tbModule: 'foo_tb', tbFile: '/proj/ProcX/ProcX/foo_tb.v' });
    });
});

describe('cmmCompilation (yanc -S; seam lastCompiledCmmPath; o .cmm nunca e tocado)', () => {
    const proc = { name: 'ProcX', cmmFile: 'ProcX.cmm', showArrays: false };

    it('cacheia lastCompiledCmmPath e devolve o asmPath da pasta de saida', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const setLast = vi.fn();
        const asmPath = await cmmCompilation(d, proc, setLast);
        expect(setLast).toHaveBeenCalledTimes(1);
        expect(setLast).toHaveBeenCalledWith('/proj/ProcX/ProcX.cmm');
        expect(asmPath).toBe('/proj/ProcX/ProcX/ProcX.asm');
    });

    it('roda o yanc uma vez, -S -o <saida> --lang <fonte>, e nao toca o .cmm do usuario', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/ProcX.cmm', CMM_WITH_MAIN);
        await cmmCompilation(d, proc, vi.fn());
        expect(runSpec).toHaveBeenCalledTimes(1);
        const spec = runSpec.mock.calls[0][0];
        expect(spec.step).toBe('cmm');
        expect(spec.binary).toBe('/comp/bin/yanc.exe');
        expect(spec.args).toEqual(['-S', '-o', '/proj/ProcX/ProcX', '--lang=pt', '/proj/ProcX/ProcX.cmm']);
        expect(spec.cwd).toBe('/proj/ProcX');
        expect(window.electronAPI._files.get('/proj/ProcX/ProcX.cmm')).toBe(CMM_WITH_MAIN);
    });

    it('showArrays do .spf vira --wave-arrays, e o idioma do toggle vira o --lang', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.getYancLang = () => 'en';
        await cmmCompilation(d, { ...proc, showArrays: true }, vi.fn());
        expect(runSpec.mock.calls[0][0].args).toEqual(
            ['-S', '-o', '/proj/ProcX/ProcX', '--wave-arrays', '--lang=en', '/proj/ProcX/ProcX.cmm']);
    });

    it('lanca cmmFailed quando o yanc retorna code != 0', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 2 });
        await expect(cmmCompilation(d, proc, vi.fn())).rejects.toThrow('error.compilation.cmmFailed');
        expect(logged('error')).toBe(true);
    });

    it('o fonte que nao grava para a compilacao antes do yanc, com o erro no terminal (#248)', async () => {
        const d = makeDeps();
        TabManager.saveAllFiles.mockRejectedValueOnce(new Error('Could not save ProcX.cmm (EBUSY)'));
        await expect(cmmCompilation(d, proc, vi.fn())).rejects.toThrow('Could not save ProcX.cmm (EBUSY)');
        expect(runSpec).not.toHaveBeenCalled();
        expect(logged('error')).toBe(true);
    });
});

describe('cppCompilation (yanc -S, que chama o cppcomp)', () => {
    const proc = { name: 'ProcX', sourceFile: 'ProcX.cpp' };

    it('um passo so, como o C±, e devolve o mesmo asmPath', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const asmPath = await cppCompilation(d, proc, vi.fn());
        expect(runSpec).toHaveBeenCalledTimes(1);
        const spec = runSpec.mock.calls[0][0];
        expect(spec.step).toBe('cpp');
        expect(spec.binary).toBe('/comp/bin/yanc.exe');
        expect(spec.args).toEqual(['-S', '-o', '/proj/ProcX/ProcX', '--lang=pt', '/proj/ProcX/ProcX.cpp']);
        // cwd na pasta do fonte: e a base dos caminhos que o cppcomp poe nos erros
        expect(spec.cwd).toBe('/proj/ProcX');
        expect(asmPath).toBe('/proj/ProcX/ProcX/ProcX.asm');
    });

    it('cacheia o .cpp da pessoa antes de rodar, como o cmm faz', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const setLast = vi.fn();
        await cppCompilation(d, proc, setLast);
        expect(setLast).toHaveBeenCalledTimes(1);
        expect(setLast).toHaveBeenCalledWith('/proj/ProcX/ProcX.cpp');
        // antes do runSpec: um clique apos falha resolve para o fonte
        expect(setLast.mock.invocationCallOrder[0]).toBeLessThan(runSpec.mock.invocationCallOrder[0]);
    });

    it('nao avisa mais da numeracao do pp.cpp: os erros apontam o arquivo escrito', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/ProcX.cpp', '#include "h.hpp"\nvoid main(void) {}\n');
        await cppCompilation(d, proc, vi.fn());
        expect(d.terminalManager.calls.some((c) => /includeWarning|preprocessing/.test(c.msg))).toBe(false);
    });

    it('em portugues diz uma vez que o cppcomp so fala ingles; em ingles, nada', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await cppCompilation(d, proc, vi.fn());
        expect(d.terminalManager.calls.filter((c) => c.msg === 'terminal.cpp.englishOnly')).toHaveLength(1);

        window.getYancLang = () => 'en';
        const d2 = makeDeps();
        await cppCompilation(d2, proc, vi.fn());
        expect(d2.terminalManager.calls.filter((c) => c.msg === 'terminal.cpp.englishOnly')).toHaveLength(0);
        expect(runSpec.mock.calls[1][0].args).toContain('--lang=en');
    });

    it('falha do yanc lanca cppFailed', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValueOnce({ code: 1 });
        await expect(cppCompilation(d, proc, vi.fn())).rejects.toThrow('error.compilation.cppFailed');
        expect(runSpec).toHaveBeenCalledTimes(1);
    });

    it('aceita o campo legado cmmFile apontando para um .cpp', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        const asmPath = await cppCompilation(d, { name: 'bar', cmmFile: 'bar.cpp' }, vi.fn());
        expect(asmPath).toBe('/proj/bar/bar/bar.asm');
    });
});

describe('asmCompilation (yanc no .asm, que chama o asmcomp)', () => {
    const proc = { name: 'ProcX', cmmFile: 'ProcX.cmm', clk: '50', numClocks: '100', testbenchFile: 'standard' };

    it('roda o yanc uma vez sobre o .asm da pasta de saida, sem -o, e nao copia testbench', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, proc, null);
        expect(runSpec).toHaveBeenCalledTimes(1);
        const spec = runSpec.mock.calls[0][0];
        expect(spec.step).toBe('asm');
        expect(spec.binary).toBe('/comp/bin/yanc.exe');
        expect(spec.args).toEqual(['-f', '50', '-c', '100', '--lang=pt', '/proj/ProcX/ProcX/ProcX.asm']);
        expect(spec.cwd).toBe('/proj/ProcX/ProcX');
        // o _tb.v ja fica pronto na pasta de saida: nada a copiar
        expect(window.electronAPI.copyFile).not.toHaveBeenCalled();
    });

    it('clock que nao e numero vira 0, e o yanc e quem recusa', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, { ...proc, clk: 'x', numClocks: undefined }, null);
        expect(runSpec.mock.calls[0][0].args.slice(0, 4)).toEqual(['-f', '0', '-c', '0']);
    });

    it('o preambulo aparece depois do clear', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        await asmCompilation(d, proc, 'recompilei');
        expect(d.terminalManager.calls[0]).toMatchObject({ term: 'tasm', msg: 'recompilei', level: 'tips' });
    });

    it('le o .v gerado da pasta de saida para o resumo', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValue({ code: 0 });
        window.electronAPI._files.set('/proj/ProcX/ProcX/ProcX.v', 'module ProcX(input clk, output out);\nendmodule\n');
        await asmCompilation(d, proc, null);
        expect(d.terminalManager.calls.some((c) => c.msg === 'terminal.asm.verilogStats')).toBe(true);
    });

    it('lanca asmFailed quando o yanc falha', async () => {
        const d = makeDeps();
        runSpec.mockResolvedValueOnce({ code: 1 });
        await expect(asmCompilation(d, proc, null)).rejects.toThrow('error.compilation.asmFailed');
    });
});

describe('stageProcessorMemoryFiles', () => {
    it('no-op silencioso em projeto sem processador', async () => {
        const d = makeDeps({ projectConfig: { processors: [] } });
        await stageProcessorMemoryFiles(d, '/proj', '/proj');
        expect(deps.terminalManager.calls).toEqual([]);
        expect(window.electronAPI.copyFile).not.toHaveBeenCalled();
    });

    it('copia os .mif e o pc_<proc>_mem.txt de cada pasta de saida (sucesso silencioso)', async () => {
        const d = makeDeps({ projectConfig: { processors: [{ name: 'ProcX' }, 'B'] } });
        for (const f of ['ProcX_inst.mif', 'ProcX_data.mif', 'pc_ProcX_mem.txt']) {
            window.electronAPI._files.set(`/proj/ProcX/ProcX/${f}`, 'x');
        }
        window.electronAPI._files.set('/proj/B/B/pc_B_mem.txt', 'x');
        await stageProcessorMemoryFiles(d, '/proj', '/proj');
        expect(window.electronAPI.copyFile.mock.calls).toEqual([
            ['/proj/ProcX/ProcX/ProcX_inst.mif', '/proj/ProcX_inst.mif'],
            ['/proj/ProcX/ProcX/ProcX_data.mif', '/proj/ProcX_data.mif'],
            ['/proj/ProcX/ProcX/pc_ProcX_mem.txt', '/proj/pc_ProcX_mem.txt'],
            ['/proj/B/B/pc_B_mem.txt', '/proj/pc_B_mem.txt'],
        ]);
        expect(logged('warning')).toBe(false);
    });

    it('a simulacao na propria pasta de saida nao copia nada sobre si mesmo', async () => {
        const d = makeDeps({ projectConfig: { processors: [{ name: 'ProcX' }] } });
        window.electronAPI._files.set('/proj/ProcX/ProcX/pc_ProcX_mem.txt', 'x');
        await stageProcessorMemoryFiles(d, '/proj', '/proj/procx/ProcX/');
        expect(window.electronAPI.copyFile).not.toHaveBeenCalled();
        expect(logged('warning')).toBe(false);
    });

    it('avisa quando ha processador mas nenhum arquivo de memoria', async () => {
        const d = makeDeps({ projectConfig: { processors: [{ name: 'ProcX' }] } });
        await stageProcessorMemoryFiles(d, '/proj', '/proj');
        expect(logged('warning')).toBe(true);
    });

    it('copia que falha vira aviso com o nome do arquivo', async () => {
        const d = makeDeps({ projectConfig: { processors: ['ProcX'] } });
        window.electronAPI._files.set('/proj/ProcX/ProcX/pc_ProcX_mem.txt', 'x');
        window.electronAPI.copyFile.mockRejectedValueOnce(new Error('EPERM'));
        await stageProcessorMemoryFiles(d, '/proj', '/sim');
        expect(d.terminalManager.calls.some((c) => c.msg === 'terminal.wave.copyMemFailed')).toBe(true);
    });
});
