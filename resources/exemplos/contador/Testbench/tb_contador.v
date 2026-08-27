`timescale 1ns/1ps

// Testbench do contador.
//
// Exercita as quatro coisas que o contador sabe fazer, nesta ordem: reset,
// contagem, carga de um valor, e o estouro ao saturar. Cada trecho imprime no
// terminal o que esperava ver, entao da para conferir o resultado sem abrir a
// onda, e da para conferir na onda sem ler o codigo.
module tb_contador;

    localparam integer LARGURA = 8;

    reg clk = 0;
    reg rst = 1;
    reg enable = 0;
    reg load = 0;
    reg [LARGURA-1:0] valor = 0;

    wire [LARGURA-1:0] conta;
    wire estouro;

    contador #(.LARGURA(LARGURA)) dut (
        .clk(clk), .rst(rst), .enable(enable), .load(load),
        .valor(valor), .conta(conta), .estouro(estouro)
    );

    always #5 clk = ~clk;   // 100 MHz

    initial begin
        $dumpfile("tb_contador.vcd");
        $dumpvars(0, tb_contador);

        // 1. Reset: a conta tem que zerar mesmo com o enable alto.
        enable = 1;
        #12 rst = 0;
        @(posedge clk);
        $display("[%0t] apos o reset, conta = %0d (esperado 0 ou 1)", $time, conta);

        // 2. Contagem: dez clocks, dez incrementos.
        repeat (10) @(posedge clk);
        $display("[%0t] depois de contar, conta = %0d", $time, conta);

        // 3. Carga: o valor entra no proximo clock e a contagem segue dali.
        valor = 8'd250;
        load  = 1;
        @(posedge clk);
        load  = 0;
        @(posedge clk);
        $display("[%0t] apos carregar 250, conta = %0d", $time, conta);

        // 4. Estouro: a carga ja consumiu um clock e a conta esta em 251, entao
        // faltam quatro para chegar a 255, onde o aviso de estouro sobe.
        repeat (4) @(posedge clk);
        $display("[%0t] conta = %0d, estouro = %0b (esperado 255 e 1)", $time, conta, estouro);

        // 5. E da volta: o contador nao trava no fim, ele reinicia do zero.
        @(posedge clk);
        $display("[%0t] o clock seguinte da a volta, conta = %0d", $time, conta);

        #50 $finish;
    end

endmodule
