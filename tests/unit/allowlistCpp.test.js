/**
 * O front end C++ do yanc no portao de execucao
 * (main/compile/binary_allowlist.ts).
 *
 * O cpppp e o cppcomp sao a segunda linguagem de processador do SAPHO: o
 * cpppp resolve #include/#define e escreve um pp.cpp na Temp, o cppcomp
 * compila esse pp.cpp no mesmo .asm que o cmmcomp produziria, e do appcomp em
 * diante o pipeline e identico. O portao e o unico ponto por onde botao, API,
 * IA e servidor de linguagem passam antes de nascer um processo, entao os
 * dois precisam estar la, com a mesma regra de pasta dos outros binarios do
 * yanc, e nao em qualquer lugar do disco.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAW_ALLOWLIST, donoDoBinario, listAllowedBinaries } from '../../main/compile/binary_allowlist.ts';
import { componentsPath } from '../../main/paths.js';

const emComponents = (...p) => path.join(componentsPath, ...p);

describe('allowlist: cpppp e cppcomp', () => {
    it.each(['cpppp.exe', 'cppcomp.exe'])('%s esta na tabela, sob bin/, como parte do yanc', (exe) => {
        const linha = RAW_ALLOWLIST.find(([nome]) => nome === exe);
        expect(linha, `${exe} ausente da RAW_ALLOWLIST`).toBeDefined();
        expect(linha[1]).toEqual(['bin']);
        expect(linha[2]).toBe('yanc');
        expect(donoDoBinario(exe)).toBe('yanc');
    });

    it.each(['cpppp.exe', 'cppcomp.exe'])('%s aparece no retrato que a IA e o diagnostico leem', (exe) => {
        const linha = listAllowedBinaries().find((b) => b.binary === exe);
        expect(linha, `${exe} ausente de listAllowedBinaries`).toBeDefined();
        expect(linha.allowedDirs).toEqual([`${componentsPath.replace(/\\/g, '/')}/bin`]);
    });

    it('os dois moram no mesmo bin/ do cmmcomp, e nao noutro canto', () => {
        // A regra e por pasta, nao so por nome: um cppcomp.exe em qualquer
        // outro lugar do disco continua barrado mesmo com o nome certo.
        const cmm = RAW_ALLOWLIST.find(([n]) => n === 'cmmcomp.exe');
        for (const exe of ['cpppp.exe', 'cppcomp.exe']) {
            const linha = RAW_ALLOWLIST.find(([n]) => n === exe);
            expect(linha[1]).toEqual(cmm[1]);
            expect(linha[2]).toBe(cmm[2]);
        }
        expect(emComponents('bin', 'cppcomp.exe')).toContain('bin');
    });
});
