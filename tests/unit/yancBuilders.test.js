/**
 * Os tres CommandSpec do processador, pelo driver yanc
 * (js/compilation/builders/cmm.ts, cpp.ts e asm.ts).
 *
 * A referencia e o `yanc -h` e a secao "CLI flags" do docs/running.md do yanc
 * v7.1:
 *
 *   yanc [-o <dir>] [-S] [-I <dir>]... [-f <MHz>] [-c <clocks>]
 *        [--wave-arrays] [-v] [--lang=en|pt] <file.cmm|.cpp|.asm>
 *
 * O que estes testes travam: a compilacao para no .asm (-S) e escreve na
 * pasta de saida (-o); a montagem recebe so o .asm, sem -o (o yanc recusa); o
 * --lang vai em toda chamada, inclusive no C++; o fonte e o .asm sao o
 * argumento sem opcao, sempre o ultimo; e nenhuma das opcoes que sairam
 * (-i, -n, -p, -t, -m, -d, -A, -pt, -en) volta.
 */

import { describe, expect, it } from 'vitest';

import { buildAsmSpec } from '../../js/compilation/builders/asm.ts';
import { buildCmmSpec } from '../../js/compilation/builders/cmm.ts';
import { buildCppSpec } from '../../js/compilation/builders/cpp.ts';
import { STEP_IDS, validateShape } from '../../js/compilation/command_spec.ts';

const YANC = 'C:\\comp\\bin\\yanc.exe';
const FONTE = 'C:\\proj\\ProcX';
const SAIDA = 'C:\\proj\\ProcX\\ProcX';

const SAIRAM = ['-i', '-n', '-p', '-t', '-m', '-d', '-A', '--array', '-pt', '-en'];

describe('buildCmmSpec', () => {
    const ctx = {
        yancPath: YANC, sourcePath: `${FONTE}\\ProcX.cmm`, outputDir: SAIDA, sourceDir: FONTE,
        processorName: 'ProcX', lang: 'pt', showArrays: false,
    };

    it('yanc -S -o <saida> --lang=<idioma> <fonte>, com cwd na pasta do fonte', () => {
        const spec = buildCmmSpec(ctx);
        expect(spec).toEqual({
            step: 'cmm',
            binary: YANC,
            args: ['-S', '-o', SAIDA, '--lang=pt', `${FONTE}\\ProcX.cmm`],
            cwd: FONTE,
            processorName: 'ProcX',
            label: 'cmm: ProcX',
        });
        expect(validateShape(spec)).toEqual({ ok: true });
    });

    it('showArrays vira --wave-arrays, antes do idioma e do fonte', () => {
        expect(buildCmmSpec({ ...ctx, showArrays: true, lang: 'en' }).args)
            .toEqual(['-S', '-o', SAIDA, '--wave-arrays', '--lang=en', `${FONTE}\\ProcX.cmm`]);
    });

    it('nenhuma opcao antiga', () => {
        const args = buildCmmSpec({ ...ctx, showArrays: true }).args;
        for (const velha of SAIRAM) expect(args).not.toContain(velha);
    });
});

describe('buildCppSpec', () => {
    const ctx = {
        yancPath: YANC, sourcePath: `${FONTE}\\ProcX.cpp`, outputDir: SAIDA, sourceDir: FONTE,
        processorName: 'ProcX', lang: 'pt',
    };

    it('um passo so, como o C±, e o --lang vai tambem', () => {
        const spec = buildCppSpec(ctx);
        expect(spec).toEqual({
            step: 'cpp',
            binary: YANC,
            args: ['-S', '-o', SAIDA, '--lang=pt', `${FONTE}\\ProcX.cpp`],
            cwd: FONTE,
            processorName: 'ProcX',
            label: 'cpp: ProcX',
        });
        expect(validateShape(spec)).toEqual({ ok: true });
    });

    it('pastas de include viram -I, na ordem, antes do fonte', () => {
        expect(buildCppSpec({ ...ctx, includeDirs: ['C:\\a', 'C:\\b'] }).args)
            .toEqual(['-S', '-o', SAIDA, '-I', 'C:\\a', '-I', 'C:\\b', '--lang=pt', `${FONTE}\\ProcX.cpp`]);
    });

    it('nao ha mais pp.cpp nem cpppp', () => {
        const spec = buildCppSpec(ctx);
        expect(spec.args.join(' ')).not.toMatch(/pp\.cpp|cpppp/);
        for (const velha of SAIRAM) expect(spec.args).not.toContain(velha);
    });
});

describe('buildAsmSpec', () => {
    const ctx = {
        yancPath: YANC, asmFile: `${SAIDA}\\ProcX.asm`, outputDir: SAIDA,
        freq: 100, clocks: 2000, processorName: 'ProcX', lang: 'en',
    };

    it('yanc -f -c --lang <asm>, sem -o, com cwd na pasta do .asm', () => {
        const spec = buildAsmSpec(ctx);
        expect(spec).toEqual({
            step: 'asm',
            binary: YANC,
            args: ['-f', '100', '-c', '2000', '--lang=en', `${SAIDA}\\ProcX.asm`],
            cwd: SAIDA,
            processorName: 'ProcX',
            label: 'asm: ProcX',
        });
        expect(spec.args).not.toContain('-o');
        expect(spec.args).not.toContain('-S');
        expect(validateShape(spec)).toEqual({ ok: true });
    });
});

describe('os passos do processador no STEP_IDS', () => {
    it('cmm, cpp e asm, e nao mais cpp-pp nem asm-pre', () => {
        expect(STEP_IDS).toEqual(expect.arrayContaining(['cmm', 'cpp', 'asm']));
        expect(STEP_IDS).not.toContain('cpp-pp');
        expect(STEP_IDS).not.toContain('asm-pre');
    });
});
