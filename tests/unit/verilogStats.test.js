/**
 * Testes do resumo de modulos, portas e instancias (js/compilation/
 * verilog_stats.js), que o terminal escreve depois de gerar o `<proc>.v` e
 * depois de o Yosys elaborar o projeto.
 *
 * O primeiro caso e a forma real do arquivo que o asmcomp gera: cabecalho
 * ANSI com varios nomes por linha, `#( ... )` de parametros com dezenas de
 * linhas antes do nome da instancia, e a mesma instancia repetida sob
 * `ifdef`/`else`. Errar ali e contar tres instancias onde ha duas.
 */

import { describe, it, expect } from 'vitest';

import { analisarVerilog, totaisDoVerilog, resumirHierarquiaYosys } from '../../js/compilation/verilog_stats.js';

const GERADO = `module PMU_padrao (

input  clk, rst,
input  signed [31:0] in ,
output signed [31:0] out,
output [0:0] req_in,
output [3:0] out_en,
input  itr,
output cheguei);

/* verilator tracing_off */
wire proc_req_in, proc_out_en;

\`ifdef __ICARUS__
 \`define YANC_SIM_VIS
\`endif

processor#(.NUBITS(32),
.NBMANT(23),
.DFILE("C:/x/PMU_padrao_data.mif"))

\`ifdef YANC_SIM_VIS
p_PMU_padrao (clk, rst, in, out, addr_in, addr_out, proc_req_in, proc_out_en, itr, cheguei, mem_wr, mem_addr_wr,pc_sim_val);
\`else
p_PMU_padrao (clk, rst, in, out, addr_in, addr_out, proc_req_in, proc_out_en, itr, cheguei);
\`endif

assign req_in = proc_req_in; // comentario com palavra (input) nao conta
addr_dec #(4) dec_out(proc_out_en, addr_out, out_en);

always @ (posedge clk) begin
   if (req_in == 1) in_sim_0 <= in;
end
endmodule
`;

describe('analisarVerilog', () => {
  it('le o <proc>.v gerado: um modulo, oito portas, duas instancias', () => {
    const a = analisarVerilog(GERADO);
    expect(a.modules.map((m) => m.name)).toEqual(['PMU_padrao']);
    const [m] = a.modules;
    expect(m.ports.map((p) => `${p.dir}:${p.name}`)).toEqual([
      'input:clk', 'input:rst', 'input:in', 'output:out', 'output:req_in',
      'output:out_en', 'input:itr', 'output:cheguei',
    ]);
    expect(m.instances).toEqual([
      { name: 'p_PMU_padrao', module: 'processor' },
      { name: 'dec_out', module: 'addr_dec' },
    ]);
  });

  it('modulo escrito a mao, com parametro e sem instancia', () => {
    const a = analisarVerilog(`
      module contador #(parameter LARGURA = 8) (
        input  wire clk,
        input  wire rst,
        input  wire [LARGURA-1:0] valor,
        output reg  [LARGURA-1:0] conta,
        output wire estouro
      );
        always @(posedge clk) conta <= valor;
      endmodule`);
    expect(a.modules[0].ports.map((p) => p.name)).toEqual(['clk', 'rst', 'valor', 'conta', 'estouro']);
    expect(a.modules[0].instances).toEqual([]);
  });

  it('estilo antigo, com as direcoes declaradas no corpo, e mais de um modulo', () => {
    const a = analisarVerilog(`
      module a(x, y); input x; output y; assign y = x; endmodule
      module b(p, q); input p; inout q; a u1(p, q); a u2(.x(p), .y(q)); endmodule`);
    expect(a.modules.map((m) => m.name)).toEqual(['a', 'b']);
    expect(a.modules[1].ports.map((p) => `${p.dir}:${p.name}`)).toEqual(['input:p', 'inout:q']);
    expect(a.modules[1].instances.map((i) => i.name)).toEqual(['u1', 'u2']);
    const t = totaisDoVerilog(a);
    expect(t).toEqual({ modules: 2, ports: 4, inputs: 2, outputs: 1, inouts: 1, instances: 2 });
  });

  it('texto sem modulo nao explode', () => {
    expect(totaisDoVerilog(analisarVerilog(''))).toEqual({ modules: 0, ports: 0, inputs: 0, outputs: 0, inouts: 0, instances: 0 });
    expect(totaisDoVerilog(analisarVerilog(null))).toEqual({ modules: 0, ports: 0, inputs: 0, outputs: 0, inouts: 0, instances: 0 });
  });
});

describe('resumirHierarquiaYosys', () => {
  const json = {
    modules: {
      top: {
        ports: { clk: { direction: 'input', bits: [2] }, out: { direction: 'output', bits: [3, 4] } },
        cells: {
          u_core: { type: '$paramod\\core\\NUBITS=32' },
          '$add$top.v:12$3': { type: '$add' },
          '$procdff$7': { type: '$dff' },
          '$procdff$8': { type: '$adff' },
          '$mux$top.v:20$9': { type: '$mux' },
        },
      },
      '$paramod\\core\\NUBITS=32': {
        ports: { a: { direction: 'input', bits: [5] } },
        cells: {
          u_ula: { type: 'ula' },
          '$eq$core.v:3$1': { type: '$eq' },
          '$memrd$\\mem$core.v:9$2': { type: '$memrd_v2' },
        },
      },
      ula: { ports: {}, cells: { '$sub$ula.v:1$1': { type: '$sub' } } },
      orfao: { ports: {}, cells: {} },
    },
  };

  it('conta so o que o top alcanca, com portas do top e celulas por familia', () => {
    const r = resumirHierarquiaYosys(json, 'top');
    expect(r.encontrouTop).toBe(true);
    expect(r.moduleNames).toEqual(['top', 'core', 'ula']);
    expect(r.modules).toBe(3);
    expect(r.instances).toBe(2);
    expect(r.topPorts).toEqual({ inputs: 1, outputs: 1, inouts: 0, total: 2 });
    // top: add, dff, adff, mux; core: eq, memrd; ula: sub.
    expect(r.cells).toBe(7);
    expect(r.families).toEqual({ arithmetic: 2, registers: 2, muxes: 1, comparators: 1, memories: 1 });
  });

  it('top que nao existe no JSON devolve zeros, sem lancar', () => {
    const r = resumirHierarquiaYosys(json, 'nao_existe');
    expect(r.encontrouTop).toBe(false);
    expect(r.modules).toBe(0);
    expect(r.topPorts.total).toBe(0);
  });
});
