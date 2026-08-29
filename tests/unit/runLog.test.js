import { describe, it, expect } from 'vitest';
import {
    abrirExecucao, anotarPasso, fecharExecucao, idDe, podar, retrato, FORMATO,
} from '../../js/compilation/run_log.js';

// O registro existe porque nao da para saber de antemao o que o usuario vai
// compilar: so o C±, so o Verilog, a onda, ou tudo. Por isso a unidade gravada
// e a EXECUCAO, que aceita um passo ou seis sem precisar prever qual.

const CONFIG = {
    topLevelFile: '/proj/Hardware/top.v',
    testbenchFile: '/proj/Sim/tb.v',
    synthesizableFiles: ['/proj/Hardware/ula.v', '/proj/Hardware/top.v'],
    simulador: 'iverilog',
    visualizador: 'gtkwave',
    processadores: ['media'],
};

describe('a execucao, do clique ao desfecho', () => {
    it('abre com o pedido, o retrato e nenhum passo', () => {
        const e = abrirExecucao({ pedido: 'wave', projeto: '/proj', config: CONFIG, agora: 1 });
        expect(e.formato).toBe(FORMATO);
        expect(e.pedido).toBe('wave');
        expect(e.passos).toEqual([]);
        expect(e.ok).toBe(null);
        expect(e.estado.topoSintese).toBe('/proj/Hardware/top.v');
    });

    it('um clique que aciona uma ferramenta so cabe igual a um que aciona quatro', () => {
        const um = abrirExecucao({ pedido: 'cmm', config: CONFIG });
        anotarPasso(um, { step: 'cmm', binary: 'C:/comp/bin/cmmcomp.exe', args: ['-i', 'a.cmm'], code: 0, ms: 120 });
        expect(um.passos).toHaveLength(1);

        const varios = abrirExecucao({ pedido: 'all', config: CONFIG });
        for (const s of ['cmm', 'asm', 'verilog', 'wave']) {
            anotarPasso(varios, { step: s, binary: `C:/x/${s}.exe`, args: [], code: 0, ms: 10 });
        }
        expect(varios.passos.map((p) => p.step)).toEqual(['cmm', 'asm', 'verilog', 'wave']);
    });

    it('guarda o nome da ferramenta, e nao o caminho inteiro', () => {
        // O caminho completo aparece nos args quando importa; no resumo ele so
        // faz a leitura ficar impossivel.
        const e = abrirExecucao({ pedido: 'verilog', config: CONFIG });
        anotarPasso(e, { step: 'verilog', binary: 'C:/comp/Packages/msys/mingw64/bin/iverilog.exe', args: ['-s', 'top'], code: 0, ms: 5 });
        expect(e.passos[0].ferramenta).toBe('iverilog.exe');
    });

    it('fecha com sucesso, com erro ou cancelada, e mede a duracao', () => {
        const ok = fecharExecucao(abrirExecucao({ pedido: 'cmm', agora: 1000 }), { ok: true, agora: 1500 });
        expect([ok.ok, ok.ms, ok.erro]).toEqual([true, 500, null]);

        const ruim = fecharExecucao(abrirExecucao({ pedido: 'cmm', agora: 0 }), { ok: false, erro: new Error('estourou') });
        expect(ruim.ok).toBe(false);
        expect(ruim.erro).toContain('estourou');

        const cancelada = fecharExecucao(abrirExecucao({ pedido: 'wave', agora: 0 }), { ok: false, cancelada: true });
        expect(cancelada.cancelada).toBe(true);
    });
});

describe('o retrato do projeto', () => {
    it('guarda so o que muda o resultado', () => {
        // Um retrato que guarda tudo nao se compara com outro, que e justamente
        // o uso dele: entender por que ontem deu diferente.
        const r = retrato(CONFIG);
        expect(Object.keys(r).sort()).toEqual(
            ['fontes', 'processadores', 'simulador', 'topoSimulacao', 'topoSintese', 'visualizador'],
        );
    });

    it('ordena as listas, senao dois retratos iguais parecem diferentes', () => {
        const a = retrato(CONFIG);
        const b = retrato({ ...CONFIG, synthesizableFiles: ['/proj/Hardware/top.v', '/proj/Hardware/ula.v'] });
        expect(a.fontes).toEqual(b.fontes);
    });

    it('sem config, nao inventa retrato', () => {
        expect(retrato(null)).toBe(null);
    });
});

describe('o nome do arquivo e a poda', () => {
    it('o id ordena por nome e diz o que foi pedido', () => {
        const id = idDe(Date.parse('2026-08-29T14:22:31.500Z'), 'wave');
        expect(id).toBe('2026-08-29T14-22-31-wave');
        // Ordenacao alfabetica = ordenacao cronologica, que e o que faz a poda
        // e a listagem funcionarem sem ler o conteudo dos arquivos.
        const antes = idDe(Date.parse('2026-08-29T09:00:00Z'), 'cmm');
        expect([id, antes].sort()[0]).toBe(antes);
    });

    it('mantem os mais novos e devolve os que devem sair', () => {
        const nomes = Array.from({ length: 53 }, (_, i) =>
            idDe(Date.parse('2026-08-01T00:00:00Z') + i * 3600e3, 'cmm') + '.json');
        const fora = podar(nomes, 50);
        expect(fora).toHaveLength(3);
        expect(fora[0]).toBe(nomes[0]);
        expect(fora).not.toContain(nomes[52]);
    });

    it('abaixo do limite nao poda nada, e ignora arquivo que nao e do registro', () => {
        expect(podar(['a.json', 'b.json'], 50)).toEqual([]);
        expect(podar(['leiame.txt', 'a.json'], 0)).toEqual(['a.json']);
    });
});

describe('duas execucoes ao mesmo tempo', () => {
    // Isto NAO e hipotese: na primeira compilacao de verdade o usuario clicou no
    // PRISM enquanto a onda rodava, e a versao anterior, com um observador so,
    // deu 0,32 s de ferramentas gravadas numa execucao de 41,2 s. O que se perde
    // quando duas correm juntas nao pode ser o registro inteiro.
    it('cada uma continua anotando o que chega, e o passo ambiguo sai marcado', () => {
        const onda = abrirExecucao({ pedido: 'wave', agora: 0 });
        anotarPasso(onda, { step: 'cmm', binary: 'cmmcomp.exe', code: 0, ms: 90 });

        const prism = abrirExecucao({ pedido: 'prism', agora: 5000 });
        // Daqui para a frente ha duas no ar: as duas recebem, e as duas marcam.
        for (const e of [onda, prism]) {
            anotarPasso(e, { step: 'yosys-hierarchy', binary: 'yosys.exe', code: 0, ms: 400 }, { concorrente: true });
        }
        fecharExecucao(prism, { ok: true, agora: 8000 });

        // A onda continua viva e volta a anotar sozinha, sem marca.
        anotarPasso(onda, { step: 'wave', binary: 'verilator_bin.exe', code: 0, ms: 30000 });
        fecharExecucao(onda, { ok: true, agora: 41000 });

        expect(onda.passos.map((p) => p.ferramenta))
            .toEqual(['cmmcomp.exe', 'yosys.exe', 'verilator_bin.exe']);
        expect(onda.passos.map((p) => !!p.concorrente)).toEqual([false, true, false]);
        expect(prism.passos[0].concorrente).toBe(true);
    });

    it('sem concorrencia, o passo nao carrega marca nenhuma', () => {
        const e = abrirExecucao({ pedido: 'cmm' });
        anotarPasso(e, { step: 'cmm', binary: 'cmmcomp.exe', code: 0, ms: 1 });
        expect('concorrente' in e.passos[0]).toBe(false);
    });
});
