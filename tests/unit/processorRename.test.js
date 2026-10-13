/**
 * O que muda de nome quando um processador e renomeado
 * (main/ipc/processor_rename.ts).
 *
 * Desde o yanc v7.1 o nome do processador e o nome do arquivo fonte, e as
 * pastas sao a do yanc: o fonte em <proc>/ e o que o yanc gera em
 * <proc>/<proc>/. Renomear e trocar o nome do fonte e dos arquivos gerados
 * que levam o nome; nao ha mais `#PRNAME` nem `#pragma yanc prname` a
 * reescrever dentro do fonte.
 */

import { describe, expect, it } from 'vitest';

import { artefatosDoProcessador, fontesPossiveis } from '../../main/ipc/processor_rename.ts';

describe('artefatosDoProcessador', () => {
    it('os fontes das DUAS linguagens, e o que o yanc gera com o nome', () => {
        expect(artefatosDoProcessador('P', 'Q')).toEqual([
            { pasta: 'fonte', de: 'P.cmm', para: 'Q.cmm' },
            { pasta: 'fonte', de: 'P.cpp', para: 'Q.cpp' },
            { pasta: 'saida', de: 'P.asm', para: 'Q.asm' },
            { pasta: 'saida', de: 'P.v', para: 'Q.v' },
            { pasta: 'saida', de: 'P.sv', para: 'Q.sv' },
            { pasta: 'saida', de: 'P_tb.v', para: 'Q_tb.v' },
            { pasta: 'saida', de: 'P_tb.sv', para: 'Q_tb.sv' },
            { pasta: 'saida', de: 'P_inst.mif', para: 'Q_inst.mif' },
            { pasta: 'saida', de: 'P_data.mif', para: 'Q_data.mif' },
            { pasta: 'saida', de: 'pc_P_mem.txt', para: 'pc_Q_mem.txt' },
        ]);
    });

    it('lista os dois fontes mesmo sabendo que so um existe', () => {
        // Quem renomeia nao pergunta a linguagem a ninguem: pede os dois e
        // pula o que nao estiver no disco.
        const fontes = artefatosDoProcessador('P', 'Q').filter((a) => a.pasta === 'fonte');
        expect(fontes.map((f) => f.de)).toEqual(['P.cmm', 'P.cpp']);
    });

    it('as cinco extensoes que o .spf reescreve tem par na lista de disco', () => {
        // caminhoRenomeado (js/project/processadores_do_spf.ts) troca o nome
        // em `<nome>(_tb)?(.v|.sv|.asm|.cmm|.cpp)`. Sem o par aqui, o .spf
        // apontaria para um arquivo que nao existe mais.
        const naLista = new Set(artefatosDoProcessador('P', 'Q')
            .map((a) => a.de.slice(a.de.lastIndexOf('.'))));
        for (const ext of ['.asm', '.cmm', '.cpp', '.sv', '.v']) expect(naLista).toContain(ext);
    });

    it('so mexe na pasta do fonte e na de saida', () => {
        const pastas = new Set(artefatosDoProcessador('P', 'Q').map((a) => a.pasta));
        expect([...pastas].sort()).toEqual(['fonte', 'saida']);
    });

    it('troca so de caixa tambem gera a lista', () => {
        expect(artefatosDoProcessador('proc', 'Proc')[0]).toEqual({ pasta: 'fonte', de: 'proc.cmm', para: 'Proc.cmm' });
    });
});

describe('fontesPossiveis', () => {
    it('da o nome do fonte de cada linguagem', () => {
        expect(fontesPossiveis('filtro')).toEqual(['filtro.cmm', 'filtro.cpp']);
    });
});
