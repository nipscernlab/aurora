/**
 * O driver do yanc no portao de execucao (main/compile/binary_allowlist.ts).
 *
 * Desde o yanc v7.1 a AURORA chama so o `yanc`, que acha o cmmcomp, o cppcomp
 * e o asmcomp ao lado dele e repassa as mensagens. O portao e o unico ponto
 * por onde botao, API, IA e servidor de linguagem passam antes de nascer um
 * processo: o yanc precisa estar la, com a regra de pasta dos outros binarios
 * do componente, e os compiladores que ele chama nao, para que nem um
 * override da IA os chame direto. O cpppp e o appcomp deixaram de existir.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAW_ALLOWLIST, donoDoBinario, listAllowedBinaries } from '../../main/compile/binary_allowlist.ts';
import { componentsPath } from '../../main/paths.js';

describe('allowlist: o driver yanc', () => {
    it('yanc.exe esta na tabela, sob bin/, como parte do componente yanc', () => {
        const linha = RAW_ALLOWLIST.find(([nome]) => nome === 'yanc.exe');
        expect(linha, 'yanc.exe ausente da RAW_ALLOWLIST').toBeDefined();
        expect(linha[1]).toEqual(['bin']);
        expect(linha[2]).toBe('yanc');
        expect(donoDoBinario('yanc.exe')).toBe('yanc');
    });

    it('aparece no retrato que a IA e o diagnostico leem, so em bin/', () => {
        const linha = listAllowedBinaries().find((b) => b.binary === 'yanc.exe');
        expect(linha, 'yanc.exe ausente de listAllowedBinaries').toBeDefined();
        expect(linha.allowedDirs).toEqual([`${componentsPath.replace(/\\/g, '/')}/bin`]);
        expect(path.join(componentsPath, 'bin', 'yanc.exe')).toContain('bin');
    });

    it.each(['cmmcomp.exe', 'cppcomp.exe', 'asmcomp.exe', 'cpppp.exe', 'appcomp.exe'])(
        '%s nao entra: so o yanc e chamado', (exe) => {
            expect(RAW_ALLOWLIST.find(([nome]) => nome === exe)).toBeUndefined();
            expect(donoDoBinario(exe)).toBeNull();
            expect(listAllowedBinaries().find((b) => b.binary === exe)).toBeUndefined();
        });

    it('o comp2gtkw, que o GTKWave roda como filtro, continua', () => {
        expect(donoDoBinario('comp2gtkw.exe')).toBe('yanc');
    });
});
