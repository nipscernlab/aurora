import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Static import: wave_toolchain so toca o filesystem via window.electronAPI
// (joinPath / listFilesInDirectory / fileExists) — o beforeEach stuba um fake
// fresh per-test. Os helpers nao guardam estado interno, entao nao ha risco de
// cross-test interference.
import {
    resolveWaveToolchain, findWaveCandidateInDir, resolveVerilatorTools,
} from '../../js/compilation/wave_toolchain.js';

/**
 * In-memory fake do window.electronAPI usado pelos helpers de wave_toolchain.
 *  - joinPath: junta com '/' (suficiente pras asserts de path).
 *  - listFilesInDirectory: devolve `entries`; se `throwOnList`, lanca (simula
 *    diretorio inexistente/ilegivel — os helpers tratam como "sem wave").
 *  - fileExists: true quando o path esta em `existing` (Set).
 */
function makeFakeElectronApi({ entries = [], throwOnList = false, existing = [] } = {}) {
    const existingSet = new Set(existing);
    return {
        joinPath: async (...parts) => parts.filter(Boolean).join('/'),
        listFilesInDirectory: async () => {
            if (throwOnList) throw new Error('ENOENT: dir');
            return entries;
        },
        fileExists: async (p) => existingSet.has(p),
    };
}

function setApi(opts) {
    globalThis.window = { electronAPI: makeFakeElectronApi(opts) };
}

afterEach(() => {
    delete globalThis.window;
});

describe('resolveWaveToolchain', () => {
    beforeEach(() => setApi());

    it('resolve os 8 paths absolutos sob componentsPath', async () => {
        const t = await resolveWaveToolchain('/comp');
        expect(t).toEqual({
            tempBaseDir: '/comp/Temp',
            gtkwaveBin: '/comp/Packages/gtkwave-nipscern/gtkwave.exe',
            vvpBin: '/comp/Packages/msys/mingw64/bin/vvp.exe',
            iverilogBin: '/comp/Packages/msys/mingw64/bin/iverilog.exe',
            iverilogBinDir: '/comp/Packages/msys/mingw64/bin',
            gtkwaveBinDir: '/comp/Packages/gtkwave-nipscern',
            fst2vcdBin: '/comp/Packages/gtkwave-nipscern/fst2vcd.exe',
            surferBin: '/comp/Packages/surfer/surfer-aurora.exe',
        });
    });

    it('nunca lanca (joinPath e total — nao toca fileExists)', async () => {
        await expect(resolveWaveToolchain('/x')).resolves.toBeTruthy();
    });
});

describe('findWaveCandidateInDir', () => {
    it('prefere <top>.fst sobre <top>.vcd e dump.*', async () => {
        setApi({ entries: ['top.vcd', 'dump.fst', 'top.fst'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/top.fst');
    });

    it('cai pra <top>.vcd quando nao ha <top>.fst', async () => {
        setApi({ entries: ['top.vcd', 'dump.fst', 'dump.vcd'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/top.vcd');
    });

    it('cai pra dump.fst antes de dump.vcd quando nao ha <top>.*', async () => {
        setApi({ entries: ['dump.vcd', 'dump.fst'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/dump.fst');
    });

    it('exclui fix.vcd (scratch do auto-gtkw)', async () => {
        setApi({ entries: ['fix.vcd'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBeNull();
    });

    it('ignora fix.vcd mas pega o candidato real ao lado', async () => {
        setApi({ entries: ['fix.vcd', 'top.fst'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/top.fst');
    });

    it('fallback de arquivo unico quando nenhum nome preferido casa', async () => {
        setApi({ entries: ['weird_name.vcd'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/weird_name.vcd');
    });

    it('null quando ha multiplos waves e nenhum preferido (ambiguo)', async () => {
        setApi({ entries: ['a.vcd', 'b.fst'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBeNull();
    });

    it('null em diretorio vazio', async () => {
        setApi({ entries: [] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBeNull();
    });

    it('null quando o diretorio nao existe / nao e legivel', async () => {
        setApi({ throwOnList: true });
        expect(await findWaveCandidateInDir('/missing', 'top')).toBeNull();
    });

    it('casa nome preferido case-insensitive, preservando a capitalizacao real', async () => {
        setApi({ entries: ['TOP.FST'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/TOP.FST');
    });

    it('filtra entradas nao-wave e nao-string', async () => {
        setApi({ entries: ['readme.txt', 'notes.md', 42, 'top.fst'] });
        expect(await findWaveCandidateInDir('/d', 'top')).toBe('/d/top.fst');
    });
});

describe('resolveVerilatorTools', () => {
    const cp = '/comp';
    const verilatorScript = '/comp/Packages/msys/mingw64/bin/verilator';
    const perlExe = '/comp/Packages/msys/mingw64/bin/perl.exe';

    it('devolve o objeto de tools quando verilator + perl existem', async () => {
        setApi({ existing: [verilatorScript, perlExe] });
        const t = await resolveVerilatorTools(cp);
        expect(t).toEqual({
            mingwBin: '/comp/Packages/msys/mingw64/bin',
            usrBin: '/comp/Packages/msys/usr/bin',
            verilatorScript,
            perlExe,
            cxxBin: '/comp/Packages/msys/mingw64/bin/g++.exe',
            fst2vcdBin: '/comp/Packages/gtkwave-nipscern/fst2vcd.exe',
        });
    });

    it('lanca verilatorNotFound quando o verilator esta ausente', async () => {
        setApi({ existing: [] });
        await expect(resolveVerilatorTools(cp)).rejects.toThrow('error.toolchain.verilatorNotFound');
    });

    it('lanca verilatorNotFound quando o perl esta ausente', async () => {
        setApi({ existing: [verilatorScript] });
        await expect(resolveVerilatorTools(cp)).rejects.toThrow('error.toolchain.verilatorNotFound');
    });
});
