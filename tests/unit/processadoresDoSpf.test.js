// @vitest-environment happy-dom
//
// js/project/processadores_do_spf.ts: a lista de processadores do .spf
// gravada so pelo renderer, pela fila do SpfStore.
//
// Os casos de ponte usam o SpfStore de verdade sobre um disco falso (um Map de
// caminho para texto), porque e no caminho inteiro que os defeitos moravam: o
// main gravava o .spf numa leitura propria e a ultima escrita apagava a outra,
// e o remapeamento do rename olhava o caminho cru do disco, que o SpfStore
// grava relativo.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    acrescentarNaLista, tirarDaLista, caminhoRenomeado, renomearNaLista,
    criarProcessador, apagarProcessador, renomearProcessador,
} from '../../js/project/processadores_do_spf.js';
import { SpfStore } from '../../js/project/spf_store.js';

const SPF = 'C:\\p\\p.spf';
const disco = new Map();
const api = {};

beforeEach(() => {
    disco.clear();
    for (const k of Object.keys(api)) delete api[k];
    Object.assign(api, {
        fileExists: async (p) => disco.has(p),
        readFile: async (p) => disco.get(p),
        writeSpf: vi.fn(async (p, doc) => { disco.set(p, JSON.stringify(doc)); return { success: true }; }),
    });
    window.electronAPI = api;
});

const lerDisco = () => JSON.parse(disco.get(SPF));
const gravarDisco = (structure) => disco.set(SPF, JSON.stringify({ metadata: {}, structure: { basePath: 'C:\\p', ...structure } }));

describe('acrescentarNaLista', () => {
    it('acrescenta sem duplicar, comparando sem caixa', () => {
        const e = { processors: ['CPU'] };
        acrescentarNaLista(e, { name: 'cpu' });
        acrescentarNaLista(e, { name: 'dsp', language: 'cpp' });
        expect(e.processors).toEqual(['CPU', { name: 'dsp', language: 'cpp' }]);
    });

    it('lista ausente vira lista, sem mexer no array que veio', () => {
        const compartilhado = Object.freeze([]);
        const e = { processors: compartilhado };
        acrescentarNaLista(e, { name: 'cpu' });
        expect(e.processors).toEqual([{ name: 'cpu' }]);
        expect(compartilhado).toEqual([]);
        const sem = {};
        acrescentarNaLista(sem, { name: 'cpu' });
        expect(sem.processors).toEqual([{ name: 'cpu' }]);
    });
});

describe('tirarDaLista', () => {
    it('tira pelo nome exato, em objeto ou texto', () => {
        const e = { processors: [{ name: 'cpu' }, 'cpu', { name: 'CPU' }, null] };
        tirarDaLista(e, 'cpu');
        expect(e.processors).toEqual([{ name: 'CPU' }, null]);
        const sem = { processors: 'x' };
        tirarDaLista(sem, 'cpu');
        expect(sem.processors).toEqual([]);
    });
});

describe('caminhoRenomeado', () => {
    const P = 'C:\\proj';

    it('artefatos do processador trocam pasta e nome; o resto so a pasta', () => {
        for (const ext of ['.cmm', '.cpp', '.asm', '.v', '.sv']) {
            expect(caminhoRenomeado(`C:\\proj\\cpu\\Software\\cpu${ext}`, P, 'cpu', 'alu'))
                .toBe(`C:\\proj\\alu\\Software\\alu${ext}`);
        }
        expect(caminhoRenomeado('C:\\proj\\cpu\\Simulation\\CPU_tb.v', P, 'cpu', 'alu'))
            .toBe('C:\\proj\\alu\\Simulation\\alu_tb.v');
        expect(caminhoRenomeado('C:\\proj\\cpu\\Hardware\\somador.v', P, 'cpu', 'alu'))
            .toBe('C:\\proj\\alu\\Hardware\\somador.v');
    });

    it('a pasta em si, barra normal, caixa diferente e projeto com barra no fim', () => {
        expect(caminhoRenomeado('C:\\proj\\cpu', P, 'cpu', 'alu')).toBe('C:\\proj\\alu');
        expect(caminhoRenomeado('C:/proj/cpu/cpu.v', 'C:/proj/', 'cpu', 'alu')).toBe('C:/proj/alu/alu.v');
        expect(caminhoRenomeado('c:\\PROJ\\CPU\\x.v', P, 'cpu', 'alu')).toBe('C:\\proj\\alu\\x.v');
    });

    it('fora da pasta, prefixo parecido e valor vazio ficam como estao', () => {
        expect(caminhoRenomeado('C:\\proj\\cpu2\\cpu2.v', P, 'cpu', 'alu')).toBe('C:\\proj\\cpu2\\cpu2.v');
        expect(caminhoRenomeado('C:\\proj\\top.v', P, 'cpu', 'alu')).toBe('C:\\proj\\top.v');
        expect(caminhoRenomeado('', P, 'cpu', 'alu')).toBe('');
        expect(caminhoRenomeado(undefined, P, 'cpu', 'alu')).toBeUndefined();
        expect(caminhoRenomeado('C:\\proj\\c.u\\c.u.v', P, 'c.u', 'alu')).toBe('C:\\proj\\alu\\alu.v');
        // Sem o escape no RegExp, `c.u` casaria `cxu`.
        expect(caminhoRenomeado('C:\\proj\\c.u\\cxu.v', P, 'c.u', 'alu')).toBe('C:\\proj\\alu\\cxu.v');
    });
});

describe('renomearNaLista', () => {
    it('renomeia a entrada com a config e move os caminhos de dentro da pasta', () => {
        const e = {
            processors: [{ name: 'cpu', clk: 50 }, 'dsp'],
            topLevelFile: 'C:\\p\\cpu\\Hardware\\cpu.v',
            testbenchFile: 'C:\\p\\top_tb.v',
            synthesizableFiles: [null, { name: 'x' }, { name: 'cpu.v', path: 'C:\\p\\cpu\\Hardware\\cpu.v' }, { name: 'top.v', path: 'C:\\p\\top.v' }],
            testbenchFiles: 'quebrado',
        };
        renomearNaLista(e, 'C:\\p', 'CPU', 'alu');
        expect(e).toEqual({
            processors: [{ name: 'alu', clk: 50 }, 'dsp'],
            topLevelFile: 'C:\\p\\alu\\Hardware\\alu.v',
            testbenchFile: 'C:\\p\\top_tb.v',
            synthesizableFiles: [null, { name: 'x' }, { name: 'alu.v', path: 'C:\\p\\alu\\Hardware\\alu.v' }, { name: 'top.v', path: 'C:\\p\\top.v' }],
            testbenchFiles: 'quebrado',
        });
    });

    it('entrada em texto vira objeto; nome ausente nao muda a lista', () => {
        const e = { processors: ['cpu'] };
        renomearNaLista(e, 'C:\\p', 'cpu', 'alu');
        expect(e.processors).toEqual([{ name: 'alu' }]);
        renomearNaLista(e, 'C:\\p', 'nada', 'x');
        expect(e.processors).toEqual([{ name: 'alu' }]);
    });
});

describe('pela ponte, com o SpfStore', () => {
    it('criar: o main faz as pastas, a entrada entra no .spf pela fila', async () => {
        gravarDisco({ processors: [{ name: 'velho' }] });
        api.createProcessorProject = vi.fn(async () => ({
            success: true, path: 'C:\\p\\cpu', spfPath: SPF, entrada: { name: 'cpu', language: 'cpp' },
        }));
        const r = await criarProcessador({ projectLocation: 'C:\\p', processorName: 'cpu' });
        expect(r.success).toBe(true);
        expect(lerDisco().structure.processors).toEqual([{ name: 'velho' }, { name: 'cpu', language: 'cpp' }]);
    });

    it('criar e uma tarefa da arvore ao mesmo tempo: nenhuma escrita apaga a outra', async () => {
        gravarDisco({ processors: [], synthesizableFiles: [] });
        api.createProcessorProject = async () => ({ success: true, spfPath: SPF, entrada: { name: 'cpu' } });
        await Promise.all([
            SpfStore.update(SPF, (e) => { e.synthesizableFiles.push({ name: 'a.v', path: 'C:\\p\\a.v' }); }),
            criarProcessador({}),
            SpfStore.update(SPF, (e) => { e.topLevelFile = 'C:\\p\\a.v'; }),
        ]);
        const s = lerDisco().structure;
        expect(s.processors).toEqual([{ name: 'cpu' }]);
        expect(s.synthesizableFiles).toEqual([{ name: 'a.v', path: 'a.v' }]);
        expect(s.topLevelFile).toBe('a.v');
    });

    it('criar que falha, ou resposta sem o que gravar: o .spf nao muda', async () => {
        gravarDisco({ processors: [] });
        for (const resposta of [{ success: false, message: 'ja existe' }, { success: true }, null]) {
            api.createProcessorProject = async () => resposta;
            expect(await criarProcessador({})).toBe(resposta);
        }
        expect(api.writeSpf).not.toHaveBeenCalled();
    });

    it('apagar: a entrada sai do .spf; falha nao grava', async () => {
        gravarDisco({ processors: [{ name: 'cpu' }, { name: 'dsp' }] });
        api.deleteProcessor = vi.fn(async (n) => ({ success: true, spfPath: SPF, name: n }));
        await apagarProcessador('cpu');
        expect(api.deleteProcessor).toHaveBeenCalledWith('cpu');
        expect(lerDisco().structure.processors).toEqual([{ name: 'dsp' }]);

        api.writeSpf.mockClear();
        api.deleteProcessor = async () => ({ success: false });
        await apagarProcessador('dsp');
        api.deleteProcessor = async () => null;
        await apagarProcessador('dsp');
        expect(api.writeSpf).not.toHaveBeenCalled();
    });

    it('renomear: caminho gravado RELATIVO acompanha a pasta nova', async () => {
        // O SpfStore grava relativo o que esta dentro do projeto. O main
        // remapeava o .spf cru, e `cpu\Hardware\cpu.v` nunca estava "dentro"
        // de `C:\p\cpu`: o topo ficava apontando para a pasta velha.
        disco.set(SPF, JSON.stringify({
            metadata: {},
            structure: {
                basePath: 'C:\\p',
                processors: [{ name: 'cpu' }],
                topLevelFile: 'cpu\\Hardware\\cpu.v',
                synthesizableFiles: [{ name: 'cpu.v', path: 'cpu\\Hardware\\cpu.v' }],
            },
        }));
        api.renameProcessor = vi.fn(async () => ({
            success: true, spfPath: SPF, projectDir: 'C:\\p', oldName: 'cpu', newName: 'alu',
        }));

        const r = await renomearProcessador('cpu', 'alu');

        expect(r.success).toBe(true);
        const s = lerDisco().structure;
        expect(s.processors).toEqual([{ name: 'alu' }]);
        expect(s.topLevelFile).toBe('alu\\Hardware\\alu.v');
        expect(s.synthesizableFiles).toEqual([{ name: 'alu.v', path: 'alu\\Hardware\\alu.v' }]);
    });

    it('renomear que falha ou volta incompleto: nao grava', async () => {
        gravarDisco({ processors: [{ name: 'cpu' }] });
        for (const resposta of [{ success: false }, { success: true, spfPath: SPF }, null]) {
            api.renameProcessor = async () => resposta;
            await renomearProcessador('cpu', 'alu');
        }
        expect(api.writeSpf).not.toHaveBeenCalled();
    });
});
