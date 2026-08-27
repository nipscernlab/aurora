`timescale 1ns/1ps

// Testbench do detector de cruzamento por zero.
//
// PORTAS MULTIPLAS
// ----------------
// Este processador tem duas entradas e cinco saidas, e e por ele que se
// entende como o SAPHO enderecca porta quando ha mais de uma: `req_in` e
// `out_en` deixam de ser um bit e viram vetores em codigo um-de-N. Quando o
// processador pede a entrada 1, `req_in` vale 2 (binario 10); quando escreve
// na saida 2, `out_en` vale 4 (binario 100). Quem esta de fora decodifica.
//
// O programa filtra o sinal de entrada com tres filtros IIR e conta as vezes
// em que o resultado cruza o zero, que e como se mede frequencia sem FFT.
module tb_zerocross;

    localparam integer LARGURA = 32;   // #NUBITS do .cmm

    reg clk = 0;
    reg rst = 1;
    reg itr = 1'b0;                    // interrupcao, nao usada neste exemplo
    reg signed [LARGURA-1:0] amostra = 0;

    wire signed [LARGURA-1:0] resultado;
    wire [1:0] req_in;                 // duas entradas
    wire [4:0] out_en;                 // cinco saidas

    zerocross dut (
        .clk    (clk),
        .rst    (rst),
        .in     (amostra),
        .out    (resultado),
        .req_in (req_in),
        .out_en (out_en),
        .itr    (itr)
    );

    always #5 clk = ~clk;   // 100 MHz

    // Entrada 0: uma onda quadrada lenta, que cruza o zero de tempos em
    // tempos. Entrada 1: uma constante, so para a porta existir.
    // O `in` e um barramento so; quem escolhe o que colocar nele e o `req_in`.
    reg signed [LARGURA-1:0] onda = 32'sd1000;
    integer ciclos = 0;
    always @(negedge clk) begin
        ciclos = ciclos + 1;
        if (ciclos % 400 == 0) onda <= -onda;    // inverte o sinal
        case (req_in)
            2'b01: amostra <= onda;
            2'b10: amostra <= 32'sd0;
            default: amostra <= amostra;
        endcase
    end

    // Cada saida ganha uma linha propria, com o numero da porta, para dar para
    // acompanhar as cinco sem confundir uma com a outra.
    integer porta;
    always @(posedge clk) begin
        if (out_en != 0) begin
            porta = 0;
            case (out_en)
                5'b00001: porta = 0;
                5'b00010: porta = 1;
                5'b00100: porta = 2;
                5'b01000: porta = 3;
                5'b10000: porta = 4;
                default:  porta = -1;
            endcase
            $display("[%0t] saida %0d = %0d", $time, porta, resultado);
        end
    end

    initial begin
        $dumpfile("tb_zerocross.vcd");
        $dumpvars(0, tb_zerocross);
        #20 rst = 0;
        #400000 $finish;
    end

endmodule
