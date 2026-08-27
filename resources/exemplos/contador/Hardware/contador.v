`timescale 1ns/1ps

// Contador de 8 bits com carga e habilitacao.
//
// Este projeto nao tem processador nem C+-: e Verilog puro, e existe para
// mostrar o caminho mais curto da AURORA. Abra, clique em Verilog para
// elaborar, e depois em Wave para simular e ver a contagem subindo.
//
// Tudo aqui e sincrono ao clock, com reset assincrono, que e a forma que
// sintetiza bem em FPGA.
module contador #(
    parameter integer LARGURA = 8
) (
    input  wire                clk,
    input  wire                rst,      // assincrono, ativo em nivel alto
    input  wire                enable,   // conta so quando alto
    input  wire                load,     // carrega `valor` no proximo clock
    input  wire [LARGURA-1:0]  valor,
    output reg  [LARGURA-1:0]  conta,
    output wire                estouro   // alto no ciclo em que a conta satura
);

    assign estouro = enable && !load && (conta == {LARGURA{1'b1}});

    always @(posedge clk or posedge rst) begin
        if (rst)          conta <= {LARGURA{1'b0}};
        else if (load)    conta <= valor;
        else if (enable)  conta <= conta + 1'b1;
    end

endmodule
