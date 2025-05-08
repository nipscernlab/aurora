// ****************************************************************************
// Circuitos auxiliares *******************************************************
// ****************************************************************************

// program counter ------------------------------------------------------------

module pc
#(
	parameter NBITS = 8
)(
	 input                 clk , rst,
	 input                 load,
	 input     [NBITS-1:0] data,
	output reg [NBITS-1:0] addr = 0

`ifdef __ICARUS__ // ----------------------------------------------------------
 , output     [NBITS-1:0] sim
`endif // ---------------------------------------------------------------------
);

wire [NBITS-1:0] val = (load) ? data : addr;

always @ (posedge clk or posedge rst) begin
	if (rst) addr <= 0;
	else     addr <= val + {{NBITS-1{1'b0}}, {1'b1}};
end

`ifdef __ICARUS__ // ----------------------------------------------------------
assign sim  = val;
`endif // ---------------------------------------------------------------------

endmodule

// prefetch de instrucoes -----------------------------------------------------

module prefetch
#
(
	parameter               MINSTW = 8,
	parameter               NBOPCO = 7,
	parameter               NBOPER = 9,
	parameter  [MINSTW-1:0] ITRADD = 0)
(
	 input                         clk, rst  ,
	 input     [MINSTW       -1:0] pc_instr  ,
	output     [NBOPCO       -1:0] opcode    ,
	output     [NBOPER       -1:0] operand   ,
	 input     [NBOPCO+NBOPER-1:0] mem_instr ,
	output     [MINSTW       -1:0] instr_addr,
	output                         pc_l      ,
	 input                         is_zero   ,
	output reg                     isp_push  ,
	output reg                     isp_pop   ,
	input                          itr
);

reg pc_load;

assign opcode     =  mem_instr[NBOPCO+NBOPER-1:NBOPER];
assign operand    =  mem_instr[NBOPER       -1:     0];
assign pc_l       =  itr  | pc_load;
assign instr_addr = (itr) ? ITRADD : (pc_load & ~rst) ? operand[MINSTW-1:0] : pc_instr;

always @ (*) begin
	case (opcode)
		12      : begin
						 pc_load <=     1'b1;  // JMP
						isp_push <=     1'b0;
						isp_pop  <=     1'b0;
					 end
		13      : begin
						 pc_load <= ~is_zero;  // JIZ
						isp_push <=     1'b0;
						isp_pop  <=     1'b0;
					 end
		14      : begin
						 pc_load <=     1'b1;  // CAL
						isp_push <=     1'b1;
						isp_pop  <=     1'b0;
					 end
		15      : begin
						 pc_load <=     1'b1;  // RET
						isp_push <=     1'b0;
						isp_pop  <=     1'b1;
					 end
		default : begin
						 pc_load <=     1'b0;
						isp_push <=     1'b0;
						isp_pop  <=     1'b0;
					 end
	endcase
end

endmodule

// pilha de dados -------------------------------------------------------------

module stack_data
#(
	parameter              NDATAW = 8,  // Numero de bits de endereco  da memoria
	parameter [NDATAW-1:0] NDATAS = 8,  // Tamanho da memoria
	parameter              NBDATA = 32  // Num de bits de dados
)(
	 input              clk    , rst,
	 input              push   , pop,
	 input [NBDATA-1:0] data_in, 
	output reg [NBDATA-1:0] data_out
);

reg         [NDATAW-1:0] cnt = NDATAS   -{{NDATAW-1{1'b0}}, {1'b1}};
wire signed [NDATAW-1:0] pm  = (push) ? -{{NDATAW-1{1'b0}}, {1'b1}} : {{NDATAW-1{1'b0}}, {1'b1}};

always @ (posedge clk or posedge rst) begin
	if (rst)
		cnt <= NDATAS-{{NDATAW-1{1'b0}}, {1'b1}};
	else if (push | pop)
		cnt <= cnt + pm;
end

wire [NDATAW-1:0] addr_w = cnt;
wire [NDATAW-1:0] addr_r = cnt + pm;

reg [NBDATA-1:0] mem [0:NDATAS-1];

always @ (posedge clk) begin
	if (push)   mem[addr_w] <= data_in;
	data_out <= mem[addr_r];
end

endmodule

// pilha de instrucao ---------------------------------------------------------

module stack
#(
	parameter              NADDR = 7,
	parameter  [NADDR-1:0] DEPTH = 3,
	parameter              NBITS = 8
)(
	input                   clk, rst,
	input                  push, pop,
	input      [NBITS-1:0] in,
	output reg [NBITS-1:0] out
);

reg [NBITS-1:0] mem [DEPTH-1:0];

// Stack Pointer

reg         [NADDR-1:0] cnt = DEPTH    -{{NADDR-1{1'b0}}, {1'b1}};
wire signed [NADDR-1:0] pm  = (push) ? -{{NADDR-1{1'b0}}, {1'b1}} : {{NADDR-1{1'b0}}, {1'b1}};

always @ (posedge clk or posedge rst) begin
	if (rst)
		cnt <= DEPTH-{{NADDR-1{1'b0}}, {1'b1}};
	else if (push | pop)
		cnt <= cnt + pm;
end

// Stack

always @ (posedge clk) if (push) mem[cnt] <= in; 
always @ (posedge clk)    out <= mem[cnt + {{$clog2(DEPTH)-1{1'b0}}, {1'b1}} + pop]; 

endmodule

// enderecamento indireto -----------------------------------------------------

module rel_addr
#(
	parameter MDATAW = 8,
	parameter FFTSIZ = 3,
	parameter USEFFT = 1
)
(
	input               sti, ldi, fft,
	input  [MDATAW-1:0] offset,
	input  [MDATAW-1:0] addr,
	output [MDATAW-1:0] out
);

generate 
	if (USEFFT) begin
		reg [FFTSIZ-1:0] aux;

		integer i;
		always @ (*) for (i = 0; i < FFTSIZ; i = i+1) aux[i] <= offset[FFTSIZ-1-i];

		wire [MDATAW-1:0] add = (fft) ? {offset[MDATAW-1:FFTSIZ], aux} : offset;

		assign out = (sti | ldi) ?     add + addr: addr;
	end else
		assign out = (sti | ldi) ? offset  + addr: addr;
endgenerate

endmodule

// ****************************************************************************
// Circuito principal *********************************************************
// ****************************************************************************

module core
#(
	// -------------------------------------------------------------------------
	// Parametros de configuracao internos -------------------------------------
	// -------------------------------------------------------------------------

	// fluxo de dados
	parameter NBOPCO = 7,               // Numero de bits de opcode (nao mudar sem ver o instr_decoder)
	parameter NBOPER = 9,               // Numero de bits de operando
	parameter ITRADD = 0,               // Endereco da interrupcao

	// memorias
	parameter MDATAW = 9,               // Numero de bits de endereco da memoria de dados
	parameter MINSTW = 9,               // Numero de bits de endereco da memoria de instrucao
	parameter NBINST = NBOPCO + NBOPER, // Numero de bits da memoria de instrucao

	// -------------------------------------------------------------------------
	// Parametros configurados pelo usuario ------------------------------------
	// -------------------------------------------------------------------------

	// fluxo de dados
	parameter NUBITS = 32,              // Numero de bits de dados
	parameter NBMANT = 23,              // Numero de bits da mantissa
	parameter NBEXPO =  8,              // Numero de bits do expoente

	// memorias
	parameter SDEPTH = 10,              // Tamanho da pilha de instrucao
	parameter DDEPTH = 10,              // Tamanho da pilha de dados

	// entradas e Saidas
	parameter NUIOIN =  8,              // Numero de enderecos de IO - entrada
	parameter NUIOOU =  8,              // Numero de enderecos de IO - saida

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
	input                           clk, rst,

	input      [NBINST        -1:0] instr,
	output     [MINSTW        -1:0] instr_addr,

	output                          mem_wr,
	output     [MDATAW        -1:0] mem_addr,
	input      [NUBITS        -1:0] mem_data_inn,
	output     [NUBITS        -1:0] data_out,

	input      [NUBITS        -1:0] io_in,
	output reg [$clog2(NUIOIN)-1:0] addr_in,
	output     [$clog2(NUIOOU)-1:0] addr_out,
	output                          req_in, out_en,

	input                           itr

`ifdef __ICARUS__ // ----------------------------------------------------------
 , output     [MINSTW        -1:0] pc_sim_val
`endif // ---------------------------------------------------------------------
);

// Program Counter ------------------------------------------------------------

wire              pc_load;
wire [MINSTW-1:0] pc_lval;
wire [MINSTW-1:0] pc_addr;
wire [MINSTW-1:0] pcl;

generate
	if (ITRADD>0) assign pcl = (itr) ? instr_addr : pc_lval;
	else          assign pcl = pc_lval;
endgenerate

`ifdef __ICARUS__ // ----------------------------------------------------------
pc #(MINSTW) pc (clk, rst, pc_load, pcl, pc_addr, pc_sim_val);
`else
pc #(MINSTW) pc (clk, rst, pc_load, pcl, pc_addr);
`endif // ---------------------------------------------------------------------

// Prefetch de instrucao ------------------------------------------------------

wire       [NBINST-1:0]     pf_instr = instr;
wire       [NBOPCO-1:0]     pf_opcode;
wire       [NBOPER-1:0]     pf_operand;
wire                        pf_acc;
wire                        pf_isp_push;
wire                        pf_isp_pop;
wire       [MINSTW-1:0]     pf_addr;

prefetch #(.MINSTW(MINSTW),
           .NBOPCO(NBOPCO),
           .NBOPER(NBOPER),
           .ITRADD(ITRADD)) pf(clk, rst, pc_addr, pf_opcode, pf_operand,
                            pf_instr, pf_addr,
                            pc_load , pf_acc,
                            pf_isp_push, pf_isp_pop,
                            itr);

// Decodificador de instrucao -------------------------------------------------

wire [NBOPCO-1:0] id_opcode  = pf_opcode;
wire [NBOPER-1:0] id_operand = pf_operand;

wire              id_dsp_push;
wire              id_dsp_pop;

wire [       5:0] id_ula_op;
wire [NUBITS-1:0] id_ula_data;
wire [NUBITS-1:0] mem_data_in;

wire [MDATAW-1:0] id_mem_addr;
wire              id_sti, id_ldi, id_fft;

instr_dec #(NUBITS, NBOPCO, NBOPER, MDATAW) id(clk, rst,
                                            id_opcode, id_operand,
                                            id_dsp_push, id_dsp_pop,
                                            id_ula_op, id_ula_data,
                                            mem_wr, id_mem_addr, mem_data_in,
                                            io_in, req_in, out_en,
                                            id_sti, id_ldi, id_fft);

// Pilha de dados -------------------------------------------------------------

wire              sp_push = id_dsp_push;
wire              sp_pop  = id_dsp_pop;
wire [NUBITS-1:0] sp_data_out;

reg sp_popr; always @ (posedge clk) sp_popr <= sp_pop;
assign mem_data_in = (sp_popr) ? sp_data_out : mem_data_inn;

stack_data #(.NDATAW($clog2(DDEPTH)),
             .NDATAS(DDEPTH),
			 .NBDATA(NUBITS)) sp(clk, rst, sp_push, sp_pop, data_out, sp_data_out);

// Unidade Logico-Aritmetica --------------------------------------------------

wire signed [NUBITS-1:0] ula_out;
wire signed [NUBITS-1:0] ula_acc;

ula #(.NUBITS (NUBITS ),
      .NBMANT (NBMANT ),
      .NBEXPO (NBEXPO ),
      .NUGAIN (NUGAIN ),
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
        .SRS  (  SRS  )) ula (id_ula_op, id_ula_data, ula_acc, ula_out);

// Acumulador -----------------------------------------------------------------

reg signed [NUBITS-1:0] racc;

always @ (posedge clk or posedge rst) if (rst) racc <= 0; else racc <= ula_out;

assign ula_acc = racc;
assign  pf_acc = ula_out[0];

// Pilha de instrucao ---------------------------------------------------------

wire [MINSTW-1:0] stack_out;

generate
	if (CAL) begin
		stack #($clog2(SDEPTH), SDEPTH, MINSTW) isp(clk, rst, pf_isp_push, pf_isp_pop, pc_addr, stack_out);
		assign pc_lval = (pf_isp_pop) ? stack_out : instr[MINSTW-1:0];
	end else
		assign pc_lval = instr[MINSTW-1:0];
endgenerate

// Enderecamento Indireto -----------------------------------------------------

wire [MDATAW-1:0] rf;

generate

	if (STI | LDI) begin
		wire [MDATAW-1:0] rf_in = (id_ldi) ? ula_out[MDATAW-1:0] : mem_data_in[MDATAW-1:0];
		rel_addr #(MDATAW, FFTSIZ, ILI) ra(id_sti, id_ldi, id_fft, rf_in, id_mem_addr, rf);
	end else
		assign rf = id_mem_addr;
		
endgenerate

// Interface externa ----------------------------------------------------------

assign data_out = ula_out;
assign mem_addr = rf;

generate

	if (CAL == 1)
		assign instr_addr = (pf_isp_pop) ? stack_out : pf_addr;
	else
		assign instr_addr =  pf_addr;

endgenerate

generate

	if (NUIOIN > 1)
		always @ (posedge clk) addr_in <= mem_data_in[$clog2(NUIOIN)-1:0];
	else
		always @ (posedge clk) addr_in <= 1'bx;

endgenerate

generate

	if (NUIOOU > 1)
		assign addr_out = mem_data_in[$clog2(NUIOOU)-1:0];
	else
		assign addr_out = 1'bx;

endgenerate

endmodule