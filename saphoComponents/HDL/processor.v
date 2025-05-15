// ****************************************************************************
// Circuitos auxiliares *******************************************************
// ****************************************************************************

// memoria de instrucao -------------------------------------------------------

module mem_instr
#(
	parameter NADDRE =  8,
	parameter NBDATA = 12,
	parameter FNAME  = "instr.mif"
)
(
	input                           clk,
	input      [$clog2(NADDRE)-1:0] addr,
	output reg [NBDATA        -1:0] data = 0
);

reg [NBDATA-1:0] mem [0:NADDRE-1];

`ifdef YOSYS
	// Yosys vai ignorar isso
`else
	initial $readmemb(FNAME, mem);
`endif

wire wr = 0; // evitar warnings desnecessarios

always @ (posedge clk) begin
	data <= mem[addr];
	if (wr) mem[addr] <= 0;
end

endmodule

// memoria de dados -----------------------------------------------------------

module mem_data
#(
	parameter NADDRE =  8,
	parameter NBDATA = 32,
	parameter FNAME  = "data.mif"
)(
	input                                  clk,
	input                                  wr,
	input             [$clog2(NADDRE)-1:0] addr_rd, addr_wr,
	input      signed [NBDATA        -1:0] data_in,
	output reg signed [NBDATA        -1:0] data_out
);

reg [NBDATA-1:0] mem [0:NADDRE-1];

`ifdef YOSYS
	// Yosys vai ignorar isso
`else
	initial $readmemb(FNAME, mem);
`endif

always @ (posedge clk) begin
	if (wr)     mem[addr_wr] <= data_in;
	data_out <= mem[addr_rd];
end

endmodule

// ****************************************************************************
// Circuito principal *********************************************************
// ****************************************************************************

module processor
#(
	// -------------------------------------------------------------------------
	// Parametros de configuracao internos -------------------------------------
	// -------------------------------------------------------------------------

	// fluxo de dados
	parameter NBOPCO = 7,               // Numero de bits de opcode (mudar o comp. assembler de acordo, em eval.c)
	parameter ITRADD = 0,               // Endereco da interrupcao

	// memorias
	parameter IFILE  = "inst.mif",      // Arquivo contendo o programa a ser executado
	parameter DFILE  = "data.mif",      // Arquivo com conteudo da memoria de dados
	parameter MDATAS = 64,              // Tamanho da memoria de dados
	parameter MINSTS = 64,              // Tamanho da memoria de intrucoes
	parameter MDATAW = $clog2(MDATAS),  // Numero de bits de endereco da memoria de dados
	parameter MINSTW = $clog2(MINSTS),  // Numero de bits de endereco da memoria de instrucao

	// -------------------------------------------------------------------------
	// Parametros configurados pelo usuario ------------------------------------
	// -------------------------------------------------------------------------

	// fluxo de dados
	parameter NUBITS = 16,              // Tamanho da palavra do processador
	parameter NBMANT = 23,              // Numero de bits da mantissa
	parameter NBEXPO =  8,              // Numero de bits do expoente
	parameter NBOPER =  7,              // Numero de bits de operando

	// memorias
	parameter SDEPTH = 10,              // Tamanho da pilha de instrucao
	parameter DDEPTH = 10,              // Tamanho da pilha de dados

	// entrada e Saida
	parameter NUIOIN =  2,              // Numero de portas de entrada
	parameter NUIOOU =  2,              // Numero de portas de saida

	// constantes aritmeticas
	parameter NUGAIN = 64,              // Valor usado na divisao por um numero fixo (NRM e NORMS)
	parameter FFTSIZ =  3,              // Tamanho da ILI na inversao de bits

	// -------------------------------------------------------------------------
	// Parametros configurados dinamicamente -----------------------------------
	// -------------------------------------------------------------------------

	// implementa enderecamento indireto
	parameter   LDI   = 0,
	parameter   ILI   = 0,
	parameter   STI   = 0,
	parameter   ISI   = 0,
	
	// implementa pilha de subrotinas
	parameter   CAL   = 0,

	// operacoes aritmeticas de dois parametros
	parameter   ADD   = 0,
	parameter F_ADD   = 0,

	parameter   MLT   = 0,
	parameter F_MLT   = 0,

	parameter   DIV   = 0,
	parameter F_DIV   = 0,

	parameter   MOD   = 0,

	parameter   SGN   = 0,
	parameter F_SGN   = 0,

	// operacoes aritmeticas de um parametro
	parameter   NEG   = 0,
	parameter   NEG_M = 0,
	parameter F_NEG   = 0,
	parameter F_NEG_M = 0,

	parameter   ABS   = 0,
	parameter   ABS_M = 0,
	parameter F_ABS   = 0,
	parameter F_ABS_M = 0,

	parameter   PST   = 0,
	parameter   PST_M = 0,
	parameter F_PST   = 0,
	parameter F_PST_M = 0,

	parameter   NRM   = 0,
	parameter   NRM_M = 0,

	parameter   I2F   = 0,
	parameter   I2F_M = 0,

	parameter   F2I   = 0,
	parameter   F2I_M = 0,

	// operacoes logicas de dois parametros
	parameter   AND   = 0,
	parameter   ORR   = 0,
	parameter   XOR   = 0,

	// operacoes logicas de um parametro
	parameter   INV   = 0,
	parameter   INV_M = 0,

	// operacoes condicionais de dois parametros
	parameter   LAN   = 0,
	parameter   LOR   = 0,
	
	// operacoes condicionais de um parametro
	parameter   LIN   = 0,
	parameter   LIN_M = 0,

	// operacoes de comparacao
	parameter   LES   = 0,
	parameter F_LES   = 0,

	parameter   GRE   = 0,
	parameter F_GRE   = 0,

	parameter   EQU   = 0,

	// operacoes de deslocamento de bits
	parameter   SHL   = 0,
	parameter   SHR   = 0,
	parameter   SRS   = 0)
(
	input                       clk     , rst,
	input  [NUBITS        -1:0] io_in   ,
	output [NUBITS        -1:0] io_out  ,
	output [$clog2(NUIOIN)-1:0] addr_in ,
	output [$clog2(NUIOOU)-1:0] addr_out,
	output                      req_in  , out_en,
	input                       itr

`ifdef __ICARUS__ // ----------------------------------------------------------

	, output                    mem_wr,
	  output       [MDATAW-1:0] mem_addr_wr,
	  output       [MINSTW-1:0] pc_sim_val);

`else

);

wire                     mem_wr;
wire        [MDATAW-1:0] mem_addr_wr;

`endif // ---------------------------------------------------------------------

wire        [MDATAW-1:0] mem_addr_rd;

// core -----------------------------------------------------------------------

wire        [MINSTW-1:0] instr_addr;
wire signed [NUBITS-1:0] mem_data_in;
wire signed [NUBITS-1:0] mem_data_out;
wire sw, mem_wrb;

assign io_out = mem_data_out;

wire [NBOPCO+NBOPER-1:0] instr;

core #(.NBOPCO (NBOPCO ),
       .NBOPER (NBOPER ),
       .ITRADD (ITRADD ),
       .MDATAW (MDATAW ),
       .MINSTW (MINSTW ),
       .NUBITS (NUBITS ),
       .NBMANT (NBMANT ),
       .NBEXPO (NBEXPO ),
       .SDEPTH (SDEPTH ),
	   .DDEPTH (DDEPTH ),
       .NUIOIN (NUIOIN ),
       .NUIOOU (NUIOOU ),
       .NUGAIN (NUGAIN ),
       .FFTSIZ (FFTSIZ ),
         .LDI  (  LDI  ),
         .ILI  (  ILI  ),
         .STI  (  STI  ),
		 .ISI  (  ISI  ),
         .CAL  (  CAL  ),
         .ADD  (  ADD  ),
       .F_ADD  (F_ADD  ),
         .MLT  (  MLT  ),
       .F_MLT  (F_MLT  ),
         .DIV  (  DIV  ),
       .F_DIV  (F_DIV  ),
         .MOD  (  MOD  ),
         .SGN  (  SGN  ),
       .F_SGN  (F_SGN  ),
         .NEG  (  NEG  ),
         .NEG_M(  NEG_M),
       .F_NEG  (F_NEG  ),
       .F_NEG_M(F_NEG_M),
         .ABS  (  ABS  ),
         .ABS_M(  ABS_M),
       .F_ABS  (F_ABS  ),
       .F_ABS_M(F_ABS_M),
         .PST  (  PST  ),
         .PST_M(  PST_M),
       .F_PST  (F_PST  ),
       .F_PST_M(F_PST_M),
         .NRM  (  NRM  ),
         .NRM_M(  NRM_M),
         .I2F  (  I2F  ),
         .I2F_M(  I2F_M),
         .F2I  (  F2I  ),
         .F2I_M(  F2I_M),
         .AND  (  AND  ),
         .ORR  (  ORR  ),
         .XOR  (  XOR  ),
         .INV  (  INV  ),
         .INV_M(  INV_M),
         .LAN  (  LAN  ),
         .LOR  (  LOR  ),
         .LIN  (  LIN  ),
         .LIN_M(  LIN_M),
         .LES  (  LES  ),
       .F_LES  (F_LES  ),
         .GRE  (  GRE  ),
       .F_GRE  (F_GRE  ),
         .EQU  (  EQU  ),
         .SHL  (  SHL  ),
         .SHR  (  SHR  ),
         .SRS  (  SRS  )) core(clk, rst,
                               instr, instr_addr,
                               mem_wr, mem_addr_rd, mem_addr_wr, mem_data_in, mem_data_out,
                               io_in, addr_in, addr_out, req_in, out_en, itr

`ifdef __ICARUS__ // ----------------------------------------------------------

                             , pc_sim_val

`endif // ---------------------------------------------------------------------
);

// memoria de instrucao -------------------------------------------------------

mem_instr # (.NADDRE(MINSTS       ),
             .NBDATA(NBOPCO+NBOPER),
             .FNAME (IFILE        )) minstr(clk, instr_addr, instr);

// memoria de dados -----------------------------------------------------------

mem_data # (.NADDRE(MDATAS),
            .NBDATA(NUBITS),
            .FNAME (DFILE )) mdata(clk, mem_wr, mem_addr_rd, mem_addr_wr, mem_data_out, mem_data_in);

endmodule