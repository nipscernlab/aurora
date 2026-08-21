`timescale 1ns/1ps

// Testbench da notacao de Dirac.
//
// O programa faz quatro operacoes de algebra linear por volta do laco e
// escreve um valor no fim de cada volta, so para marcar a passagem. O que
// interessa aqui nao esta na porta de saida: esta na memoria de dados, onde
// vivem a matriz A e os vetores a e b.
//
// Por isso este e o exemplo que mais recompensa abrir a onda. Rode, e na
// janela de configuracao de sinais escolha o que ha dentro do processador: da
// para ver a memoria sendo percorrida enquanto uma unica linha de C+-
// multiplica a matriz pelo vetor.
module tb_dirac;

    localparam integer LARGURA = 23;   // #NUBITS do .cmm

    reg clk = 0;
    reg rst = 1;
    reg signed [LARGURA-1:0] amostra = 0;

    wire signed [LARGURA-1:0] resultado;
    wire req_in;
    wire out_en;

    dirac dut (
        .clk    (clk),
        .rst    (rst),
        .in     (amostra),
        .out    (resultado),
        .req_in (req_in),
        .out_en (out_en)
    );

    always #5 clk = ~clk;   // 100 MHz

    // A entrada alimenta `a # 0.001|in(0)>`. Um valor fixo basta: o objetivo e
    // ver as operacoes acontecerem, nao processar um sinal.
    always @(negedge clk) begin
        if (req_in) amostra <= 1000;
    end

    integer voltas = 0;
    always @(posedge clk) begin
        if (out_en) begin
            voltas = voltas + 1;
            $display("[%0t] volta %0d concluida (out = %0d)", $time, voltas, resultado);
        end
    end

    initial begin
        $dumpfile("tb_dirac.vcd");
        $dumpvars(0, tb_dirac);
        #20 rst = 0;
        // Quatro operacoes sobre matriz 4x4 por volta: cada volta custa
        // centenas de clocks, entao a simulacao precisa de folga.
        #400000 $finish;
    end

endmodule
