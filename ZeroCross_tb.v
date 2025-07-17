`timescale 1ns/1ps

module ZeroCross_tb();

reg clk, rst;
integer i,prog;

initial begin

    $dumpfile("ZeroCross_tb.vcd");
    $dumpvars(0,ZeroCross_tb);

    clk = 0;
    rst = 1;
    #1.000000;
    rst = 0;

    prog = $fopen("progress.txt", "w");
    for (i = 10; i <= 100; i = i + 10) begin
        #4000.000000;
        $display("Progress: %0d%% complete", i);
        $fdisplay(prog,"%0d",i);
        $fflush(prog);
    end
    $fclose(prog);
    $finish;

end

always #0.500000 clk = ~clk;

// instancia do processador ---------------------------------------------------

reg  signed [31:0] proc_io_in = 0;
wire signed [31:0] proc_io_out;
wire [1:0] proc_req_in;
wire [4:0] proc_out_en;

ZeroCross proc(clk,rst,proc_io_in,proc_io_out,proc_req_in,proc_out_en,1'b0);

// portas de entrada ----------------------------------------------------------

// variaveis da porta 1
integer data_in_1; // para ver no simulador
reg signed [31:0] in_1 = 0;
reg req_in_1 = 0;

// abre um arquivo para leitura em cada porta
initial begin
    data_in_1 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/input_1.txt", "r"); // coloque os seus dados de entrada neste arquivo
end

// decodifica portas de entrada
always @ (*) begin
    // decodificacao da porta 1
    if (proc_req_in == 2) proc_io_in = in_1; // dado aparece no simulador
    req_in_1 = proc_req_in == 2;
end

// implementa a leitura dos dados de entrada
integer scan_result;
always @ (negedge clk) begin  
    // lendo a porta 1
    if (data_in_1 != 0 && proc_req_in == 2) scan_result = $fscanf(data_in_1, "%d", in_1);
end

// portas de saida ------------------------------------------------------------

// variaveis da porta 0
integer data_out_0;
reg signed [31:0] out_sig_0 = 0; // para ver no simulador
reg out_en_0 = 0;

// variaveis da porta 1
integer data_out_1;
reg signed [31:0] out_sig_1 = 0; // para ver no simulador
reg out_en_1 = 0;

// variaveis da porta 2
integer data_out_2;
reg signed [31:0] out_sig_2 = 0; // para ver no simulador
reg out_en_2 = 0;

// variaveis da porta 3
integer data_out_3;
reg signed [31:0] out_sig_3 = 0; // para ver no simulador
reg out_en_3 = 0;

// variaveis da porta 4
integer data_out_4;
reg signed [31:0] out_sig_4 = 0; // para ver no simulador
reg out_en_4 = 0;

// abre um arquivo para escrita de cada porta
initial begin
    data_out_0 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/output_0.txt", "w"); // veja os dados de saida neste arquivo
    data_out_1 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/output_1.txt", "w"); // veja os dados de saida neste arquivo
    data_out_2 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/output_2.txt", "w"); // veja os dados de saida neste arquivo
    data_out_3 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/output_3.txt", "w"); // veja os dados de saida neste arquivo
    data_out_4 = $fopen("C:/Users/LCOM/Desktop/Projects/DTW/ZeroCross/Simulation/output_4.txt", "w"); // veja os dados de saida neste arquivo
end

// decodifica portas de saida
always @ (*) begin
    // decodificacao da porta 0
    if (proc_out_en == 1) out_sig_0 <= proc_io_out; // dado aparece no simulador
    out_en_0 = proc_out_en == 1;
    // decodificacao da porta 1
    if (proc_out_en == 2) out_sig_1 <= proc_io_out; // dado aparece no simulador
    out_en_1 = proc_out_en == 2;
    // decodificacao da porta 2
    if (proc_out_en == 4) out_sig_2 <= proc_io_out; // dado aparece no simulador
    out_en_2 = proc_out_en == 4;
    // decodificacao da porta 3
    if (proc_out_en == 8) out_sig_3 <= proc_io_out; // dado aparece no simulador
    out_en_3 = proc_out_en == 8;
    // decodificacao da porta 4
    if (proc_out_en == 16) out_sig_4 <= proc_io_out; // dado aparece no simulador
    out_en_4 = proc_out_en == 16;
end

// implementa escrita no arquivo
always @ (posedge clk) begin
    // escreve na porta 0
    if (out_en_0 == 1'b1) $fdisplay(data_out_0, "%0d", out_sig_0);
    // escreve na porta 1
    if (out_en_1 == 1'b1) $fdisplay(data_out_1, "%0d", out_sig_1);
    // escreve na porta 2
    if (out_en_2 == 1'b1) $fdisplay(data_out_2, "%0d", out_sig_2);
    // escreve na porta 3
    if (out_en_3 == 1'b1) $fdisplay(data_out_3, "%0d", out_sig_3);
    // escreve na porta 4
    if (out_en_4 == 1'b1) $fdisplay(data_out_4, "%0d", out_sig_4);
end

integer progress, chrys;
initial begin
    $dumpfile("ZeroCross_tb.vcd");
    $dumpvars(0, ZeroCross_tb);
    progress = $fopen("C:\\Users\\LCOM\\Desktop\\saphoComponents\\Temp\\ZeroCross\\progress.txt", "w");
    for (chrys = 10; chrys <= 100; chrys = chrys + 10) begin
        #40000;
        $fdisplay(progress,"%0d",chrys);
        $fflush(progress);
    end
    $fclose(progress);
    $finish;
end


endmodule
