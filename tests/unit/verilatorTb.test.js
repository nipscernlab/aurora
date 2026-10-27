// A fiacao de I/O que o Fast Sim (Verilator) le do <proc>.v gerado pelo yanc.
// O bloco YANC_SIM_VIS e a fonte: cada req_in_sim_<K> vira um input_<K>.txt e
// cada out_en_sim_<K> um output_<K>.txt, com o valor one-hot que o harness
// compara no barramento.
import { describe, it, expect } from 'vitest';
import { parseProcessorIO } from '../../js/compilation/verilator_tb.js';

// O bloco do deconv.v que o yanc 7.1 gerou (#NUIOIN 2, #NUIOOU 3), com as
// declaracoes que tambem casam com `req_in_sim_<K> =`.
const YANC_71 = `
reg signed [31:0] in_sim_0 = 0;
reg req_in_sim_0 = 0;
reg req_in_sim_1 = 0;
reg out_en_sim_0 = 0;
reg out_en_sim_1 = 0;
reg out_en_sim_2 = 0;
always @ (*) begin
   req_in_sim_0 = req_in[0];
   req_in_sim_1 = req_in[1];
end
always @ (*) begin
   out_en_sim_0 = out_en[0];
   out_en_sim_1 = out_en[1];
   out_en_sim_2 = out_en[2];
end
`;

describe('parseProcessorIO', () => {
    // Issue #237: com o yanc 7.1 a fiacao saia vazia e o harness nao abria
    // arquivo nenhum.
    it('le a forma bit a bit do yanc 7.1, com o bit B valendo 1 << B', () => {
        expect(parseProcessorIO(YANC_71)).toEqual({
            inputs: [
                { port: '0', reqValue: 1, file: 'input_0.txt' },
                { port: '1', reqValue: 2, file: 'input_1.txt' },
            ],
            outputs: [
                { port: '0', enValue: 1, file: 'output_0.txt' },
                { port: '1', enValue: 2, file: 'output_1.txt' },
                { port: '2', enValue: 4, file: 'output_2.txt' },
            ],
            naoLidas: [],
        });
    });

    it('continua lendo a forma de comparacao, em ordem de valor', () => {
        const src = 'out_en_sim_1 = out_en == 4;\nout_en_sim_0 = out_en == 2;\nreq_in_sim_0 = req_in == 1;';
        expect(parseProcessorIO(src)).toEqual({
            inputs: [{ port: '0', reqValue: 1, file: 'input_0.txt' }],
            outputs: [
                { port: '0', enValue: 2, file: 'output_0.txt' },
                { port: '1', enValue: 4, file: 'output_1.txt' },
            ],
            naoLidas: [],
        });
    });

    it('atribuicao do barramento em forma desconhecida vai para naoLidas', () => {
        const src = 'req_in_sim_0 = req_in[1:0] == 2\'b01;\nout_en_sim_0 = out_en & mask;\nout_en_sim_1 = out_en[1];';
        const r = parseProcessorIO(src);
        expect(r.naoLidas).toEqual(["req_in_sim_0 = req_in[1:0] == 2'b01;", 'out_en_sim_0 = out_en & mask;']);
        expect(r.outputs).toEqual([{ port: '1', enValue: 2, file: 'output_1.txt' }]);
    });

    it('fonte sem I/O ou ausente nao tem fiacao nem linha nao lida', () => {
        expect(parseProcessorIO('module p(); endmodule')).toEqual({ inputs: [], outputs: [], naoLidas: [] });
        expect(parseProcessorIO(undefined)).toEqual({ inputs: [], outputs: [], naoLidas: [] });
    });
});
