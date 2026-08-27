/**
 * O que acontece com o `.spf` quando a árvore mexe num arquivo.
 *
 * O erro que isto evita não aparece como erro: renomear um `.v` pela visão
 * Pastas mexia só no disco, e o `.spf` seguia apontando para o caminho antigo.
 * O usuário só descobria dois passos depois, quando o arquivo sumia da visão
 * Verilog ou a compilação reclamava de um arquivo que ele acabara de ver.
 */

import { describe, it, expect } from 'vitest';

import { renomearNoSpf, removerDoSpf, reporNoSpf, processadorEm } from '../../js/project/spf_paths.js';

const estrutura = () => ({
    basePath: 'C:/proj',
    topLevelFile: 'C:/proj/top.v',
    testbenchFile: 'C:/proj/tb/top_tb.v',
    synthesizableFiles: [
        { path: 'C:/proj/top.v', name: 'top.v' },
        { path: 'C:/proj/hdl/ula.v', name: 'ula.v' },
    ],
    testbenchFiles: [{ path: 'C:/proj/tb/top_tb.v', name: 'top_tb.v' }],
    processors: [{ name: 'MeuProc' }],
});

describe('renomearNoSpf', () => {
    it('renomear um arquivo arruma a lista e o topo, inclusive o nome exibido', () => {
        const s = estrutura();
        expect(renomearNoSpf(s, 'C:/proj/top.v', 'C:/proj/novo.v')).toBe(2);
        expect(s.topLevelFile).toBe('C:/proj/novo.v');
        expect(s.synthesizableFiles[0]).toEqual({ path: 'C:/proj/novo.v', name: 'novo.v' });
    });

    it('renomear uma pasta arrasta tudo que estava embaixo dela', () => {
        const s = estrutura();
        expect(renomearNoSpf(s, 'C:/proj/hdl', 'C:/proj/rtl')).toBe(1);
        expect(s.synthesizableFiles[1].path).toBe('C:/proj/rtl/ula.v');
        expect(s.topLevelFile).toBe('C:/proj/top.v');
    });

    it('casa caminho com barra e maiúscula diferentes, e preserva o separador do destino', () => {
        const s = estrutura();
        expect(renomearNoSpf(s, 'c:\\proj\\tb', 'C:\\proj\\bancada')).toBe(2);
        expect(s.testbenchFile).toBe('C:\\proj\\bancada\\top_tb.v');
        expect(s.testbenchFiles[0]).toEqual({ path: 'C:\\proj\\bancada\\top_tb.v', name: 'top_tb.v' });
    });

    it('um arquivo que o .spf não conhece não mexe em nada', () => {
        const s = estrutura();
        expect(renomearNoSpf(s, 'C:/proj/leiame.txt', 'C:/proj/README.md')).toBe(0);
        expect(s).toEqual(estrutura());
    });

    it('não confunde prefixo de nome com pasta pai', () => {
        const s = estrutura();
        expect(renomearNoSpf(s, 'C:/proj/hd', 'C:/proj/x')).toBe(0);
        expect(s.synthesizableFiles[1].path).toBe('C:/proj/hdl/ula.v');
    });
});

describe('removerDoSpf', () => {
    it('apagar tira da lista e esvazia o topo, que é como o .spf diz "nenhum"', () => {
        const s = estrutura();
        expect(removerDoSpf(s, ['C:/proj/top.v']).total).toBe(2);
        expect(s.topLevelFile).toBe('');
        expect(s.synthesizableFiles.map((f) => f.path)).toEqual(['C:/proj/hdl/ula.v']);
    });

    it('apagar uma pasta leva o que estava dentro', () => {
        const s = estrutura();
        expect(removerDoSpf(s, ['C:/proj/tb']).total).toBe(2);
        expect(s.testbenchFile).toBe('');
        expect(s.testbenchFiles).toEqual([]);
    });

    it('vários caminhos de uma vez, como na seleção múltipla', () => {
        const s = estrutura();
        expect(removerDoSpf(s, ['C:/proj/top.v', 'C:/proj/hdl/ula.v']).total).toBe(3);
        expect(s.synthesizableFiles).toEqual([]);
        expect(s.topLevelFile).toBe('');
        expect(s.testbenchFile).toBe('C:/proj/tb/top_tb.v');
    });

    it('apagar o que o .spf não conhece não mexe em nada', () => {
        const s = estrutura();
        expect(removerDoSpf(s, ['C:/proj/notas.md']).total).toBe(0);
        expect(s).toEqual(estrutura());
    });
});

describe('processadorEm', () => {
    it('reconhece a pasta de um processador, para a árvore recusar renomeá-la', () => {
        const s = estrutura();
        expect(processadorEm(s, 'C:/proj', 'C:/proj/MeuProc')).toBe('MeuProc');
        expect(processadorEm(s, 'C:/proj', 'c:\\proj\\meuproc')).toBe('MeuProc');
    });

    it('uma pasta comum, ou uma subpasta do processador, não é a pasta dele', () => {
        const s = estrutura();
        expect(processadorEm(s, 'C:/proj', 'C:/proj/hdl')).toBe(null);
        expect(processadorEm(s, 'C:/proj', 'C:/proj/MeuProc/Software')).toBe(null);
    });
});

describe('reporNoSpf: o outro lado do Ctrl+Z', () => {
    it('apagar e desfazer devolve o arquivo com a marca de topo que ele tinha', () => {
        const s = estrutura();
        const retirado = removerDoSpf(s, ['C:/proj/top.v']);
        expect(s.topLevelFile).toBe('');

        expect(reporNoSpf(s, retirado)).toBe(2);
        expect(s.topLevelFile).toBe('C:/proj/top.v');
        expect(s.synthesizableFiles.map((f) => f.path)).toContain('C:/proj/top.v');
    });

    it('um topo escolhido entre o apagar e o desfazer nao e atropelado', () => {
        const s = estrutura();
        const retirado = removerDoSpf(s, ['C:/proj/top.v']);
        s.topLevelFile = 'C:/proj/hdl/ula.v'; // o usuario escolheu outro
        reporNoSpf(s, retirado);
        expect(s.topLevelFile).toBe('C:/proj/hdl/ula.v');
    });

    it('nao duplica quando o projeto ja reclassificou o arquivo sozinho', () => {
        const s = estrutura();
        const retirado = removerDoSpf(s, ['C:/proj/top.v']);
        s.synthesizableFiles.push({ path: 'C:/proj/top.v', name: 'top.v' });
        reporNoSpf(s, retirado);
        expect(s.synthesizableFiles.filter((f) => f.path === 'C:/proj/top.v')).toHaveLength(1);
    });

    it('repor o que nada tirou nao mexe em nada', () => {
        const s = estrutura();
        const retirado = removerDoSpf(s, ['C:/proj/notas.md']);
        expect(reporNoSpf(s, retirado)).toBe(0);
        expect(s).toEqual(estrutura());
    });
});
