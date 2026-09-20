/**
 * Qual front end compila cada processador (js/compilation/processor_dispatch.ts).
 *
 * Duas coisas importam aqui. A busca no disco quando o .spf nao declara
 * nada, que e o caso de TODO projeto existente: o .cmm tem que continuar
 * sendo achado exatamente como antes, e um .cpp sozinho passa a ser achado
 * em vez de pulado em silencio. E o despacho: a entrada com fonte .cpp vai
 * para o cppCompilation, o resto para o cmmCompilation, e nada mais muda.
 */

import { describe, expect, it, vi } from 'vitest';

import {
    compileProcessorSource,
    languagesInSearchOrder,
    locateProcessorSource,
} from '../../js/compilation/processor_dispatch.ts';

/** Um disco de mentira: so os caminhos listados existem. */
function disco(...existentes) {
    const norm = (p) => p.replace(/\\/g, '/');
    const set = new Set(existentes.map(norm));
    return {
        joinPath: vi.fn(async (...parts) => parts.join('/')),
        fileExists: vi.fn(async (p) => set.has(norm(p))),
    };
}

describe('locateProcessorSource: o .spf nao declara nada (todo projeto de hoje)', () => {
    it('acha o <nome>.cmm em Software/, como sempre achou', async () => {
        const d = disco('/proj/ProcX/Software/ProcX.cmm');
        expect(await locateProcessorSource('/proj', { name: 'ProcX' }, d)).toEqual({
            language: 'cmm', sourceFile: 'ProcX.cmm', sourcePath: '/proj/ProcX/Software/ProcX.cmm',
        });
    });

    it('acha o <nome>.cpp quando so ele existe, em vez de pular o processador', async () => {
        const d = disco('/proj/ProcX/Software/ProcX.cpp');
        expect(await locateProcessorSource('/proj', { name: 'ProcX' }, d)).toEqual({
            language: 'cpp', sourceFile: 'ProcX.cpp', sourcePath: '/proj/ProcX/Software/ProcX.cpp',
        });
    });

    it('com os dois no disco, o .cmm vence: a ordem das linguagens e C+- primeiro', async () => {
        const d = disco('/proj/ProcX/Software/ProcX.cmm', '/proj/ProcX/Software/ProcX.cpp');
        expect((await locateProcessorSource('/proj', { name: 'ProcX' }, d)).language).toBe('cmm');
        expect(languagesInSearchOrder()).toEqual(['cmm', 'cpp']);
    });

    it('nenhum dos dois: null, que e o "pular" do pre-flight', async () => {
        const d = disco('/proj/ProcX/Hardware/ProcX.v', '/proj/ProcX/Software/ProcX.asm');
        expect(await locateProcessorSource('/proj', { name: 'ProcX' }, d)).toBeNull();
        // e a busca olhou as duas extensoes antes de desistir
        expect(d.fileExists).toHaveBeenCalledTimes(2);
    });

    it('so olha dentro de Software/ do proprio processador', async () => {
        const d = disco('/proj/Outro/Software/ProcX.cmm', '/proj/ProcX.cmm');
        expect(await locateProcessorSource('/proj', { name: 'ProcX' }, d)).toBeNull();
    });
});

describe('locateProcessorSource: o .spf declara', () => {
    it('sourceFile declarado vale, exista ou nao no disco', async () => {
        const d = disco();
        expect(await locateProcessorSource('/proj', { name: 'P', sourceFile: 'meu.cpp' }, d)).toEqual({
            language: 'cpp', sourceFile: 'meu.cpp', sourcePath: '/proj/P/Software/meu.cpp',
        });
        expect(d.fileExists).not.toHaveBeenCalled();
    });

    it('cmmFile legado tambem e declaracao', async () => {
        const d = disco();
        const r = await locateProcessorSource('/proj', { name: 'P', cmmFile: 'velho.cmm' }, d);
        expect(r).toEqual({ language: 'cmm', sourceFile: 'velho.cmm', sourcePath: '/proj/P/Software/velho.cmm' });
    });

    it('language sozinha monta o nome com a extensao da linguagem', async () => {
        const d = disco();
        const r = await locateProcessorSource('/proj', { name: 'P', language: 'cpp' }, d);
        expect(r).toEqual({ language: 'cpp', sourceFile: 'P.cpp', sourcePath: '/proj/P/Software/P.cpp' });
    });
});

describe('compileProcessorSource: o despacho', () => {
    function compilador() {
        return {
            cmmCompilation: vi.fn(async () => '/asm/cmm'),
            cppCompilation: vi.fn(async () => '/asm/cpp'),
        };
    }

    it('fonte .cmm vai para o cmmCompilation, e so para ele', async () => {
        const c = compilador();
        const proc = { name: 'P', cmmFile: 'P.cmm' };
        expect(await compileProcessorSource(c, proc)).toBe('/asm/cmm');
        expect(c.cmmCompilation).toHaveBeenCalledWith(proc);
        expect(c.cppCompilation).not.toHaveBeenCalled();
    });

    it('fonte .cpp vai para o cppCompilation, e so para ele', async () => {
        const c = compilador();
        const proc = { name: 'P', cmmFile: 'P.cpp' };
        expect(await compileProcessorSource(c, proc)).toBe('/asm/cpp');
        expect(c.cppCompilation).toHaveBeenCalledWith(proc);
        expect(c.cmmCompilation).not.toHaveBeenCalled();
    });

    it('sem fonte declarado o padrao continua sendo C+-', async () => {
        const c = compilador();
        await compileProcessorSource(c, { name: 'P' });
        expect(c.cmmCompilation).toHaveBeenCalledTimes(1);
    });

    it('language declarada vence a extensao', async () => {
        const c = compilador();
        await compileProcessorSource(c, { name: 'P', language: 'cpp', cmmFile: 'P.cmm' });
        expect(c.cppCompilation).toHaveBeenCalledTimes(1);
    });
});
