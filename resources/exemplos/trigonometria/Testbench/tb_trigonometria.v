`timescale 1ns/1ps

// Testbench da trigonometria.
//
// Repare que o processador NAO tem porta de entrada aqui. O programa em C+-
// nunca chama `in()`, entao o compilador simplesmente nao gera o pino: a
// interface do modulo e consequencia do programa, e nao um formulario fixo.
// Compare com o testbench da media movel, que tem `in` e `req_in`.
//
// O programa escreve oito valores em sequencia, em laco. Como `fout` trunca
// para inteiro, os valores saem multiplicados por mil: 999 e o seno de pi/2,
// e -506 e o seno de 100 radianos.
module tb_trigonometria;

    localparam integer LARGURA = 32;   // #NUBITS do .cmm

    reg clk = 0;
    reg rst = 1;

    wire signed [LARGURA-1:0] resultado;
    wire out_en;

    trigonometria dut (
        .clk    (clk),
        .rst    (rst),
        .out    (resultado),
        .out_en (out_en)
    );

    always #5 clk = ~clk;   // 100 MHz

    // Os oito valores da primeira volta do laco, na ordem em que o programa os
    // escreve. Serve para conferir a saida sem calculadora e sem abrir a onda.
    integer n = 0;
    always @(posedge clk) begin
        if (out_en) begin
            $display("[%0t] valor %0d = %0d", $time, n, resultado);
            n = n + 1;
        end
    end

    initial begin
        $dumpfile("tb_trigonometria.vcd");
        $dumpvars(0, tb_trigonometria);
        #20 rst = 0;
        // Ponto flutuante por polinomio custa mais clocks que uma soma
        // inteira, entao esta simulacao e mais longa que a da media movel.
        #400000 $finish;
    end

endmodule
