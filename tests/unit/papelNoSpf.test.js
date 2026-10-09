// js/project/papel_no_spf.ts: trocar o papel de um arquivo no .spf.
//
// TODO 13b, passo 3 (09/10/2026): a pessoa escolhe o papel no botao direito.
// O arquivo sai das outras listas (inclusive a dos sem papel), entra no fim da
// lista nova sem reordenar ninguem, e perde a marca de topo, porque topo de
// sintese e topo de simulacao sao coisas diferentes.

import { describe, it, expect } from 'vitest';
import { marcarPapel } from '../../js/project/papel_no_spf.ts';

const chave = (p) => p.replace(/\\/g, '/').toLowerCase();
const cfg = () => ({
    synthesizableFiles: [{ name: 'simulacao.v', path: 'C:/p/simulacao.v' }, { name: 'top.v', path: 'C:/p/top.v', isTopLevel: true }],
    testbenchFiles: [{ name: 'tb.v', path: 'C:/p/tb.v', isTopLevel: true }],
    unclassifiedFiles: [{ name: 'X.v', path: 'C:/p/X.v' }],
    topLevelFile: 'C:/p/top.v',
    testbenchFile: 'C:/p/tb.v',
});

describe('marcarPapel', () => {
    it('sem papel vira sintese: sai da lista dos sem papel e entra no fim, com o nome que tinha', () => {
        const c = cfg();
        expect(marcarPapel(c, 'C:\\p\\X.v', 'synthesizable', chave)).toBe(true);
        expect(c.unclassifiedFiles).toEqual([]);
        expect(c.synthesizableFiles.map((f) => f.name)).toEqual(['simulacao.v', 'top.v', 'X.v']);
        expect(c.synthesizableFiles[2]).toEqual({ name: 'X.v', path: 'C:\\p\\X.v', isTopLevel: false });
    });

    it('topo de sintese que vira testbench perde a marca e apaga o ponteiro', () => {
        const c = cfg();
        expect(marcarPapel(c, 'C:/p/top.v', 'testbench', chave)).toBe(true);
        expect(c.topLevelFile).toBe('');
        expect(c.testbenchFile).toBe('C:/p/tb.v');
        expect(c.synthesizableFiles.map((f) => f.name)).toEqual(['simulacao.v']);
        expect(c.testbenchFiles.map((f) => [f.name, f.isTopLevel])).toEqual([['tb.v', true], ['top.v', false]]);
    });

    it('testbench atual que vira sintese apaga o ponteiro dele', () => {
        const c = cfg();
        marcarPapel(c, 'C:/p/tb.v', 'synthesizable', chave);
        expect(c.testbenchFile).toBe('');
        expect(c.topLevelFile).toBe('C:/p/top.v');
        expect(c.testbenchFiles).toEqual([]);
    });

    it('ja no papel pedido: nada muda', () => {
        const c = cfg();
        expect(marcarPapel(c, 'C:/p/tb.v', 'testbench', chave)).toBe(false);
        expect(c).toEqual(cfg());
    });

    it('arquivo que nenhuma lista tinha entra com o nome do caminho; lista ausente e criada', () => {
        const c = { testbenchFile: '' };
        expect(marcarPapel(c, 'C:/p/cpu/Hardware/cpu.v', 'synthesizable', chave)).toBe(true);
        expect(c.synthesizableFiles).toEqual([{ name: 'cpu.v', path: 'C:/p/cpu/Hardware/cpu.v', isTopLevel: false }]);
    });

    it('entradas estranhas nas listas sao ignoradas, e repetidas saem todas', () => {
        const c = { synthesizableFiles: [null, { name: 'sem caminho' }], unclassifiedFiles: [{ path: 'C:/p/a.v' }, { path: 'C:/p/A.v' }] };
        marcarPapel(c, 'C:/p/a.v', 'testbench', chave);
        expect(c.unclassifiedFiles).toEqual([]);
        expect(c.synthesizableFiles).toEqual([null, { name: 'sem caminho' }]);
        expect(c.testbenchFiles).toEqual([{ name: 'a.v', path: 'C:/p/a.v', isTopLevel: false }]);
    });
});
