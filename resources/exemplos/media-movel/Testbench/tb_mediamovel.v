`timescale 1ns/1ps

// Testbench da media movel.
//
// COMO SE CONVERSA COM UM PROCESSADOR SAPHO
// -----------------------------------------
// A interface e mais simples do que parece. Quando o processador quer uma
// amostra ele levanta `req_in`, e quem esta do lado de fora coloca o valor em
// `in`. Quando ele tem um resultado ele levanta `out_en`, e o valor esta em
// `out`. Nao ha protocolo de aperto de mao alem disso.
//
// O compilador gera um testbench proprio, em components/Temp, que le os
// numeros de Simulation/input_0.txt. Este aqui e o oposto: gera os numeros em
// Verilog mesmo, para o exemplo funcionar sem nenhum arquivo de dados e para
// voce poder mexer na entrada sem sair do editor.
module tb_mediamovel;

    localparam integer LARGURA = 16;   // #NUBITS do .cmm

    reg clk = 0;
    reg rst = 1;
    reg signed [LARGURA-1:0] amostra = 0;

    wire signed [LARGURA-1:0] resultado;
    wire req_in;
    wire out_en;

    mediamovel dut (
        .clk    (clk),
        .rst    (rst),
        .in     (amostra),
        .out    (resultado),
        .req_in (req_in),
        .out_en (out_en)
    );

    always #5 clk = ~clk;   // 100 MHz, o mesmo do painel de configuracao

    // A entrada e uma rampa: 0, 100, 200, ... Uma amostra por pedido.
    // Com a media de quatro, a saida persegue a rampa com atraso, e e esse
    // atraso que se ve na onda.
    integer proxima = 0;
    always @(negedge clk) begin
        if (req_in) begin
            amostra  <= proxima;
            proxima  <= proxima + 100;
        end
    end

    always @(posedge clk) begin
        if (out_en) $display("[%0t] media = %0d", $time, resultado);
    end

    initial begin
        $dumpfile("tb_mediamovel.vcd");
        $dumpvars(0, tb_mediamovel);
        #20 rst = 0;
        // Tempo suficiente para uma duzia de resultados. Aumente se quiser ver
        // a media estabilizar no regime permanente.
        #20000 $finish;
    end

endmodule
