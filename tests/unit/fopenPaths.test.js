/**
 * Os `$fopen` de leitura que dá para conferir antes de simular.
 *
 * O erro que isto evita não aparece como erro: um `define apontando para a
 * pasta antiga do projeto fez o `$fopen` devolver 0, o `$fscanf` reclamar a
 * cada ciclo, e a simulação rodar 90 segundos lendo entrada vazia, com
 * resultado constante de cara certa no fim.
 *
 * O risco do detector é o oposto: um aviso ERRADO ensina o usuário a ignorar
 * o certo. Por isso os casos de "fica de fora" importam tanto quanto os de
 * "pega".
 */

import { describe, it, expect } from 'vitest';

import { extractFopenReads } from '../../js/wave/fopen_paths.js';

// O trecho real do testbench que motivou isto, encurtado.
const TB = `
// Aponte PROJ para a pasta do processador NO SEU PC (barras "/").
\`define PROJ "C:/Users/chrys/Desktop/sapho_procs/sapho_cnn/cnn_sapho"

module tb;
  integer fin_fp, fout_int_fp, fout_flt_fp;
  initial begin
    fin_fp      = $fopen({\`PROJ, "/test_input_sapho.txt"},  "r");
    fout_int_fp = $fopen({\`PROJ, "/test_output_sapho.txt"}, "w");
    fout_flt_fp = $fopen({\`PROJ, "/test_output_float.txt"}, "w");
  end
endmodule
`;

describe('extractFopenReads', () => {
    it('resolve a concatenação com `define e devolve só o de leitura', () => {
        expect(extractFopenReads(TB)).toEqual([{
            path: 'C:/Users/chrys/Desktop/sapho_procs/sapho_cnn/cnn_sapho/test_input_sapho.txt',
            mode: 'r',
        }]);
    });

    it('literal direto e `define sozinho também resolvem', () => {
        const src = '`define F "c:/x/in.txt"\n'
            + 'initial begin a = $fopen("c:/y/dados.txt", "r"); b = $fopen(`F, "rb"); end';
        expect(extractFopenReads(src).map((f) => f.path)).toEqual(['c:/y/dados.txt', 'c:/x/in.txt']);
    });

    it('caminho com pedaço de runtime fica de fora, para o aviso nunca mentir', () => {
        const src = 'initial f = $fopen({dir, "/in.txt"}, "r");';
        expect(extractFopenReads(src)).toEqual([]);
        expect(extractFopenReads('initial f = $fopen(nome_variavel, "r");')).toEqual([]);
    });

    it('escrita e append ficam de fora: escrever cria o arquivo', () => {
        const src = 'initial begin a = $fopen("x.txt", "w"); b = $fopen("y.txt", "a"); end';
        expect(extractFopenReads(src)).toEqual([]);
    });

    it('$fopen de um argumento só é escrita (canal MCD) e fica de fora', () => {
        expect(extractFopenReads('initial f = $fopen("velho.txt");')).toEqual([]);
    });

    it('$fopen comentado não gera aviso fantasma', () => {
        const src = '// f = $fopen("morto.txt", "r");\n/* $fopen("tambem.txt", "r") */\n';
        expect(extractFopenReads(src)).toEqual([]);
    });

    it('`define que não existe invalida o caminho em vez de virar texto errado', () => {
        expect(extractFopenReads('initial f = $fopen({`NAO_EXISTE, "/x"}, "r");')).toEqual([]);
    });

    it('fonte vazio ou sem fopen devolve lista vazia', () => {
        expect(extractFopenReads('')).toEqual([]);
        expect(extractFopenReads('module t; endmodule')).toEqual([]);
    });
});
