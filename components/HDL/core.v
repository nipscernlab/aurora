// ****************************************************************************
// Helper circuits ************************************************************
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

wire [NBITS-1:0] um  = {{NBITS-1{1'b0}}, {1'b1}};
wire [NBITS-1:0] val = (load) ? data : addr;

always @ (posedge clk or posedge rst) begin
	if (rst) addr <= 0;
	else     addr <= val + um;
end

`ifdef __ICARUS__ // ----------------------------------------------------------
assign sim = val;
`endif // ---------------------------------------------------------------------

endmodule

// instruction prefetch -------------------------------------------------------

module prefetch
#(
	parameter              MINSTW = 8,
	parameter              NBOPCO = 7,
	parameter              NBOPER = 9,
	parameter [MINSTW-1:0] ITRADD = 0,
	parameter              CAL    = 0,
	parameter              JIZ    = 0
)(
	 input                        rst       ,
	 input    [MINSTW       -1:0] pc_instr  ,
	output    [NBOPCO       -1:0] opcode    ,
	output    [NBOPER       -1:0] operand   ,
	 input    [NBOPCO+NBOPER-1:0] mem_instr ,
	output    [MINSTW       -1:0] instr_addr,
	output                        pc_l      ,
	 input                        is_um     ,
	output                        isp_push  ,
	output                        isp_pop   ,
	 input                        itr
);

wire wJMP;

generate if (JIZ)
//             JMP                                        JIZ
assign wJMP = (opcode == {{NBOPCO-5{1'b0}}, {5'd15}}) | ((opcode == {{NBOPCO-5{1'b0}}, {5'd16}}) & ~is_um);

else
//             JMP
assign wJMP = (opcode == {{NBOPCO-5{1'b0}}, {5'd15}});

endgenerate

wire pc_load;

generate if (CAL) begin

wire wCAL = (opcode == {{NBOPCO-5{1'b0}}, {5'd17}});
wire wRET = (opcode == {{NBOPCO-5{1'b0}}, {5'd18}});

assign pc_load    =  wJMP | wCAL | wRET;
assign isp_push   =  wCAL;
assign isp_pop    =  wRET;

end else begin

assign pc_load    =  wJMP;
assign isp_push   =  1'bx;
assign isp_pop    =  1'bx;

end endgenerate

assign opcode     =  mem_instr[NBOPCO+NBOPER-1:NBOPER];
assign operand    =  mem_instr[NBOPER       -1:     0];

generate if (ITRADD>0) begin

assign pc_l       =  itr  | pc_load;
assign instr_addr = (itr) ? ITRADD : (pc_load & ~rst) ? operand[MINSTW-1:0] : pc_instr;

end else begin

assign pc_l       =         pc_load;
assign instr_addr =                  (pc_load & ~rst) ? operand[MINSTW-1:0] : pc_instr;

end endgenerate

endmodule

// instruction stack ----------------------------------------------------------

module stack
#(
	parameter NADDR = 7,
	parameter DEPTH = 3,
	parameter NBITS = 8
)(
	 input             clk , rst,
	 input             push, pop,
	 input [NBITS-1:0] in,
	output [NBITS-1:0] out
);

// Constants

wire [NADDR-1:0] zero = {{NADDR-1{1'b0}}, {1'b0}};
wire [NADDR-1:0] um   = {{NADDR-1{1'b0}}, {1'b1}};

// Memory

reg [NBITS-1:0] mem [DEPTH-1:0];

// Stack Pointer

reg  [NADDR-1:0] pointer = 0; // ideal for monitoring
wire [NADDR-1:0] pmaisum = pointer + um;
wire [NADDR-1:0] pmenoum = pointer - um;

always @ (posedge clk or posedge rst) begin
	if      (rst ) pointer <= zero;
	else if (push) pointer <= pmaisum;
	else if (pop ) pointer <= pmenoum;
end

// Stack interface

always @ (posedge clk) if (push) mem[pointer] <= in;
assign                     out = mem[pmenoum];

// Flags
`ifdef __ICARUS__ // ----------------------------------------------------------

reg             fl_full = 0;
reg [NADDR-1:0] fl_max  = 0; // pointer overflowed
integer         pointeri;

always @ (*)      pointeri = pointer;
always @ (*) if ((pointer >= DEPTH) || (pmaisum-pointer != 1)) fl_full = 1'b1;
always @ (*) if ( pointer >  fl_max                          ) fl_max  = pointer;

`endif // ---------------------------------------------------------------------

endmodule

// Instruction fetch ----------------------------------------------------------

module instr_fetch
#(
	parameter NBINST = 8,
	parameter MINSTW = 8,
	parameter ITRADD = 0,
	parameter NBOPCO = 7,
	parameter NBOPER = 9,
	parameter SDEPTH = 8,

	parameter CAL    = 0,
	parameter JIZ    = 0
)(
	input               clk, rst,
	input               itr,

	input  [NBINST-1:0] instr,
	output [MINSTW-1:0] addr,

	input               acc,
	output [NBOPCO-1:0] opcode,
	output [NBOPER-1:0] operand

`ifdef __ICARUS__ // ----------------------------------------------------------
 , output [MINSTW-1:0] pc_sim_val
`endif // ---------------------------------------------------------------------
);

// Program Counter

wire              pc_load;
wire [MINSTW-1:0] pc_lval;
wire [MINSTW-1:0] pc_addr;
wire [MINSTW-1:0] pcl;

generate
	if (ITRADD>0) assign pcl = (itr) ? addr : pc_lval;
	else          assign pcl = pc_lval;
endgenerate

`ifdef __ICARUS__ // ----------------------------------------------------------
pc #(MINSTW) pc (clk, rst, pc_load, pcl, pc_addr, pc_sim_val);
`else
pc #(MINSTW) pc (clk, rst, pc_load, pcl, pc_addr);
`endif // ---------------------------------------------------------------------

// Instruction prefetch

wire [NBINST-1:0] pf_instr = instr;
wire              pf_isp_push;
wire              pf_isp_pop;
wire [MINSTW-1:0] pf_addr;

prefetch #(.MINSTW(MINSTW),
           .NBOPCO(NBOPCO),
           .NBOPER(NBOPER),
           .ITRADD(ITRADD),
		   .CAL   (CAL   ),
		   .JIZ   (JIZ   )) pf(rst, pc_addr, opcode, operand,
                               pf_instr, pf_addr,
                               pc_load , acc,
                               pf_isp_push, pf_isp_pop,
                               itr);

// Instruction stack

wire [MINSTW-1:0] stack_out;

generate
	if (CAL) begin
		stack #($clog2(SDEPTH), SDEPTH, MINSTW) isp(clk, rst, pf_isp_push, pf_isp_pop, pc_addr, stack_out);
		assign pc_lval = (pf_isp_pop) ? stack_out : instr[MINSTW-1:0];
	end else
		assign pc_lval = instr[MINSTW-1:0];
endgenerate

// External interface

generate
	if (CAL)
		assign addr = (pf_isp_pop) ? stack_out : pf_addr;
	else
		assign addr =  pf_addr;
endgenerate

endmodule

// Control of ALU input in1 ---------------------------------------------------

module ula_in1_ctrl
#(
	parameter NUBITS = 8,
	parameter NBOPCO = 7
)(
	input               clk, pop,
	input  [NUBITS-1:0] mem, stack,
	output [NUBITS-1:0] out
);

reg popr;              always @ (posedge clk) popr <= pop;
reg [NUBITS-1:0] stkr; always @ (posedge clk) stkr <= stack;

assign out = (popr) ? stkr : mem;

endmodule

// Control of ALU input in2 ---------------------------------------------------

module ula_in2_ctrl
#(
	parameter NUBITS = 8,
	parameter NBOPCO = 7
)(
	input               clk,
	input               req_in,
	input  [NUBITS-1:0] acc, io_in,
	output [NUBITS-1:0] out
);

reg               req_inr; always @ (posedge clk) req_inr <= req_in;
reg  [NUBITS-1:0] ior    ; always @ (posedge clk) ior     <=  io_in;

assign out = (req_inr) ? ior : acc;

endmodule

// Indirect addressing --------------------------------------------------------

module rel_addr
#(
	parameter MDATAW = 8,
	parameter FFTSIZ = 3,
	parameter USEFFT = 1
)(
	input               use_oft, fft,
	input  [MDATAW-1:0] offset,
	input  [MDATAW-1:0] addr,
	output [MDATAW-1:0] out
);

generate 
	if (USEFFT) begin
		reg [FFTSIZ-1:0] aux;

		integer i;
		always @ (*) for (i = 0; i < FFTSIZ; i = i+1) aux[i] = offset[FFTSIZ-1-i];

		wire [MDATAW-1:0] add = (fft) ? {offset[MDATAW-1:FFTSIZ], aux} : offset;

		assign out = (use_oft) ?    add + addr: addr;
	end else
		assign out = (use_oft) ? offset + addr: addr;
endgenerate

endmodule

// Memory-addressing control --------------------------------------------------

module mem_ctrl
#(
	parameter NUBITS = 8,
	parameter MDATAW = 8,
	parameter FFTSIZ = 3,

	parameter ISI    = 0,
	parameter ILI    = 0
)(
	input               sti, ldi, fft, wr,
	input  [NUBITS-1:0] ula,
	input  [MDATAW-1:0] base_addr, stk_ofst,

	output              mem_wr,
	output [MDATAW-1:0] mem_addr_rd, mem_addr_wr,
	output [NUBITS-1:0] mem_data_wr
);

assign mem_data_wr = ula;
assign mem_wr      = wr;

rel_addr #(.MDATAW(MDATAW), .FFTSIZ(FFTSIZ), .USEFFT(ISI)) ra_rd(ldi, fft, ula[MDATAW-1:0], base_addr, mem_addr_rd);
rel_addr #(.MDATAW(MDATAW), .FFTSIZ(FFTSIZ), .USEFFT(ILI)) ra_wr(sti, fft, stk_ofst       , base_addr, mem_addr_wr);

endmodule

// I/O controller -------------------------------------------------------------

module io_ctrl
#(
	parameter MDATAW = 8,
	parameter NBIOIN = 8,
	parameter NBIOOU = 8,
	parameter    INN = 0,
	parameter  F_INN = 0,
	parameter  P_INN = 0,
	parameter PF_INN = 0
)(
	input                   clk,
	input                   req_in, out_en,
	input      [MDATAW-1:0] addr,

	output                  en_in,
	output     [NBIOIN-1:0] addr_in,

	output reg              en_out,
	output reg [NBIOOU-1:0] addr_out
);

generate if (INN | F_INN | P_INN | PF_INN) assign en_in   = req_in;           else assign en_in   =         1'b0  ; endgenerate
generate if (INN | F_INN | P_INN | PF_INN) assign addr_in = addr[NBIOIN-1:0]; else assign addr_in = {NBIOIN{1'b0}}; endgenerate

always @ (posedge clk) en_out   <= out_en;
always @ (posedge clk) addr_out <= addr[NBIOOU-1:0];

endmodule

// ****************************************************************************
// Main circuit ***************************************************************
// ****************************************************************************

module core
#(
	// -------------------------------------------------------------------------
	// Internal configuration parameters ---------------------------------------
	// -------------------------------------------------------------------------

	// data flow
	parameter  NBOPCO = 7,               // Number of opcode bits (do not change without updating the instr_decoder)
	parameter  NBOPER = 9,               // Operand width (bits)
	parameter  ITRADD = 0,               // Interrupt address

	// memories
	parameter  MDATAW = 9,               // Number of address bits for data memory
	parameter  MINSTW = 9,               // Number of address bits for instruction memory
	parameter  NBINST = NBOPCO + NBOPER, // Instruction-memory width (bits)

	// -------------------------------------------------------------------------
	// User-configured parameters ----------------------------------------------
	// -------------------------------------------------------------------------

	// data flow
	parameter  NUBITS = 32,              // Data width (bits)
	parameter  NBMANT = 23,              // Mantissa width (bits)
	parameter  NBEXPO =  8,              // Exponent width (bits)

	// memories
	parameter  SDEPTH = 10,              // Instruction stack depth
	parameter  DDEPTH = 10,              // Data stack depth

	// inputs and Outputs
	parameter  NBIOIN =  2,              // Number of IO address bits - input
	parameter  NBIOOU =  2,              // Number of IO address bits - output

	// arithmetic constants
	parameter  NUGAIN = 64,              // Value used to divide by a fixed number (NRM and NORMS)
	parameter  FFTSIZ =  3,              // ILI size for bit reversal

	// -------------------------------------------------------------------------
	// Dynamically configured parameters ---------------------------------------
	// -------------------------------------------------------------------------

	// implements memory read/write
	parameter    LOD   = 0,
	parameter  P_LOD   = 0,
	
	parameter    LDI   = 0,
	parameter    ILI   = 0,
	
	parameter    SET   = 0,
	parameter    SET_P = 0,
	
	parameter    STI   = 0,
	parameter    ISI   = 0,

	// implements the data-stack interface
	parameter    PSH   = 0,
	parameter    POP   = 0,

	// implements I/O ports
	parameter    INN   = 0,
	parameter  F_INN   = 0,
	parameter  P_INN   = 0,
	parameter PF_INN   = 0,
	parameter    OUT   = 0,
	
	// implements jumps
	parameter    JIZ   = 0,
	parameter    CAL   = 0,

	// two-parameter arithmetic operations
	parameter    ADD   = 0,
	parameter  S_ADD   = 0,
	parameter  F_ADD   = 0,
	parameter SF_ADD   = 0,

	parameter    MLT   = 0,
	parameter  S_MLT   = 0,
	parameter  F_MLT   = 0,
	parameter SF_MLT   = 0,

	parameter    DIV   = 0,
	parameter  S_DIV   = 0,
	parameter  F_DIV   = 0,
	parameter SF_DIV   = 0,

	parameter    MOD   = 0,
	parameter  S_MOD   = 0,

	parameter    SGN   = 0,
	parameter  S_SGN   = 0,
	parameter  F_SGN   = 0,
	parameter SF_SGN   = 0,

	// one-parameter arithmetic operations
	parameter    NEG   = 0,
	parameter    NEG_M = 0,
	parameter  P_NEG_M = 0,
	parameter  F_NEG   = 0,
	parameter  F_NEG_M = 0,
	parameter PF_NEG_M = 0,

	parameter    ABS   = 0,
	parameter    ABS_M = 0,
	parameter  P_ABS_M = 0,
	parameter  F_ABS   = 0,
	parameter  F_ABS_M = 0,
	parameter PF_ABS_M = 0,

	parameter    PST   = 0,
	parameter    PST_M = 0,
	parameter  P_PST_M = 0,
	parameter  F_PST   = 0,
	parameter  F_PST_M = 0,
	parameter PF_PST_M = 0,

	parameter    NRM   = 0,
	parameter    NRM_M = 0,
	parameter  P_NRM_M = 0,

	parameter    I2F   = 0,
	parameter    I2F_M = 0,
	parameter  P_I2F_M = 0,

	parameter    F2I   = 0,
	parameter    F2I_M = 0,
	parameter  P_F2I_M = 0,

	// two-parameter logical operations
	parameter    AND   = 0,
	parameter  S_AND   = 0,
	parameter    ORR   = 0,
	parameter  S_ORR   = 0,
	parameter    XOR   = 0,
	parameter  S_XOR   = 0,

	// one-parameter logical operations
	parameter    INV   = 0,
	parameter    INV_M = 0,
	parameter  P_INV_M = 0,

	// two-parameter conditional operations
	parameter    LAN   = 0,
	parameter  S_LAN   = 0,
	parameter    LOR   = 0,
	parameter  S_LOR   = 0,
	
	// one-parameter conditional operations
	parameter    LIN   = 0,
	parameter    LIN_M = 0,
	parameter  P_LIN_M = 0,

	// comparison operations
	parameter    LES   = 0,
	parameter  S_LES   = 0,
	parameter  F_LES   = 0,
	parameter SF_LES   = 0,

	parameter    GRE   = 0,
	parameter  S_GRE   = 0,
	parameter  F_GRE   = 0,
	parameter SF_GRE   = 0,

	parameter    EQU   = 0,
	parameter  S_EQU   = 0,

	// bit-shift operations
	parameter    SHL   = 0,
	parameter  S_SHL   = 0,

	parameter    SHR   = 0,
	parameter  S_SHR   = 0,

	parameter    SRS   = 0,
	parameter  S_SRS   = 0,

	// special operations
	parameter  F_ROT   = 0,   // nearest power-of-two square-root approximation (with ACC)
	parameter  F_SU1   = 0,   // floating-point subtraction at input 1
	parameter  F_SU2   = 0,   // floating-point subtraction at input 2
	parameter SF_SU1   = 0,	  // floating-point subtraction at input 1 with stack
	parameter SF_SU2   = 0	  // floating-point subtraction at input 2 with stack
)(
	input               clk, rst,

	input  [NBINST-1:0] instr,
	output [MINSTW-1:0] instr_addr,

	output              mem_wr,
	output [MDATAW-1:0] mem_addr_rd, mem_addr_wr,
	input  [NUBITS-1:0] mem_data_rd,
	output [NUBITS-1:0] mem_data_wr,

	input  [NUBITS-1:0] io_in,
	output [NBIOIN-1:0] addr_in,
	output [NBIOOU-1:0] addr_out,
	output              req_in,
	output              out_en,

	input               itr

`ifdef __ICARUS__ // ----------------------------------------------------------
 , output [MINSTW-1:0] pc_sim_val
`endif // ---------------------------------------------------------------------
);

// Instruction fetch ----------------------------------------------------------

wire              if_acc;
wire [NBOPCO-1:0] if_opcode;
wire [NBOPER-1:0] if_operand;

instr_fetch #(
	.NBINST (NBINST ),
	.MINSTW (MINSTW ),
	.ITRADD (ITRADD ),
	.NBOPCO (NBOPCO ),
	.NBOPER (NBOPER ),
	.SDEPTH (SDEPTH ),
	.CAL    (CAL    ),
	.JIZ    (JIZ    )) instr_fetch (.clk    (clk       ),
	                                .rst    (rst       ),
	                                .itr    (itr       ),
	                                .instr  (instr     ),
	                                .addr   (instr_addr),
	                                .acc    (if_acc    ),
	                                .opcode (if_opcode ),
	                                .operand(if_operand)
	
`ifdef __ICARUS__ // ----------------------------------------------------------
                               , .pc_sim_val(pc_sim_val)
`endif // ---------------------------------------------------------------------
);

// Instruction decoder --------------------------------------------------------

wire [NBOPCO-1:0] id_opcode  = if_opcode;

wire [       5:0] id_ula_op;
wire              id_dsp_push, id_dsp_pop;
wire              id_sti, id_ldi, id_fft, id_wr;
wire              id_req_in, id_out_en;

instr_dec #(.NBOPCO  ( NBOPCO ),
            .MDATAW  ( MDATAW ),
			   .LOD  (   LOD  ),
			 .P_LOD  ( P_LOD  ),
			   .LDI  (   LDI  ),
			   .ILI  (   ILI  ),
			   .SET  (   SET  ),
			   .SET_P(   SET_P),
			   .STI  (   STI  ),
			   .ISI  (   ISI  ),
			   .PSH  (   PSH  ),
			   .POP  (   POP  ),
			   .INN  (   INN  ),
			 .F_INN  ( F_INN  ),
			 .P_INN  ( P_INN  ),
			.PF_INN  (PF_INN  ),
			   .OUT  (   OUT  ),
			   .ADD  (   ADD  ),
			 .S_ADD  ( S_ADD  ),
			 .F_ADD  ( F_ADD  ),
			.SF_ADD  (SF_ADD  ),
			   .MLT  (   MLT  ),
			 .S_MLT  ( S_MLT  ),
			 .F_MLT  ( F_MLT  ),
			.SF_MLT  (SF_MLT  ),
			   .DIV  (   DIV  ),
			 .S_DIV  ( S_DIV  ),
			 .F_DIV  ( F_DIV  ),
			.SF_DIV  (SF_DIV  ),
			   .MOD  (   MOD  ),
			 .S_MOD  ( S_MOD  ),
			   .SGN  (   SGN  ),
			 .S_SGN  ( S_SGN  ),
			 .F_SGN  ( F_SGN  ),
			.SF_SGN  (SF_SGN  ),
			   .NEG  (   NEG  ),
			   .NEG_M(   NEG_M),
			 .P_NEG_M( P_NEG_M),
			 .F_NEG  ( F_NEG  ),
			 .F_NEG_M( F_NEG_M),
			.PF_NEG_M(PF_NEG_M),
			   .ABS  (   ABS  ),
			   .ABS_M(   ABS_M),
			 .P_ABS_M( P_ABS_M),
			 .F_ABS  ( F_ABS  ),
			 .F_ABS_M(F_ABS_M ),
			.PF_ABS_M(PF_ABS_M),
			   .PST  (   PST  ),
			   .PST_M(   PST_M),
			 .P_PST_M( P_PST_M),
			 .F_PST  ( F_PST  ),
			 .F_PST_M(F_PST_M ),
			.PF_PST_M(PF_PST_M),
			   .NRM  (   NRM  ),
			   .NRM_M(   NRM_M),
			 .P_NRM_M( P_NRM_M),
			   .I2F  (   I2F  ),
			   .I2F_M(   I2F_M),
			 .P_I2F_M( P_I2F_M),
			   .F2I  (   F2I  ),
			   .F2I_M(   F2I_M),
			 .P_F2I_M( P_F2I_M),
			   .AND  (   AND  ),
			 .S_AND  ( S_AND  ),
			   .ORR  (   ORR  ),
			 .S_ORR  ( S_ORR  ),
			   .XOR  (   XOR  ),
			 .S_XOR  ( S_XOR  ),
			   .INV  (   INV  ),
			   .INV_M(   INV_M),
			 .P_INV_M( P_INV_M),
			   .LAN  (   LAN  ),
			 .S_LAN  ( S_LAN  ),
			   .LOR  (   LOR  ),
			 .S_LOR  ( S_LOR  ),
			   .LIN  (   LIN  ),
			   .LIN_M(   LIN_M),
			 .P_LIN_M( P_LIN_M),
			   .LES  (   LES  ),
			 .S_LES  ( S_LES  ),
			 .F_LES  ( F_LES  ),
			.SF_LES  (SF_LES  ),
			   .GRE  (   GRE  ),
			 .S_GRE  ( S_GRE  ),
			 .F_GRE  ( F_GRE  ),
			.SF_GRE  (SF_GRE  ),
			   .EQU  (   EQU  ),
			 .S_EQU  ( S_EQU  ),
			   .SHL  (   SHL  ),
			 .S_SHL  ( S_SHL  ),
			   .SHR  (   SHR  ),
			 .S_SHR  ( S_SHR  ),
			   .SRS  (   SRS  ),
			 .S_SRS  ( S_SRS  ),
			 .F_ROT  ( F_ROT  ),
			 .F_SU1  ( F_SU1  ),
			 .F_SU2  ( F_SU2  ),
			.SF_SU1  (SF_SU1  ),
			.SF_SU2  (SF_SU2  )) id(clk, rst,
                                    id_opcode,
                                    id_dsp_push, id_dsp_pop,
                                    id_ula_op,
                                    id_wr,
                                    id_req_in, id_out_en,
                                    id_ldi, id_sti, id_fft);

// Data stack -----------------------------------------------------------------

wire              sp_push = id_dsp_push;
wire              sp_pop  = id_dsp_pop;
wire [NUBITS-1:0] sp_in, sp_data;

stack #(.NADDR($clog2(DDEPTH)),
        .DEPTH(DDEPTH),
        .NBITS(NUBITS)) sp(clk, rst, sp_push, sp_pop, sp_in, sp_data);

// ALU input controls ---------------------------------------------------------

wire [NUBITS-1:0] ula_data_in1;
wire [NUBITS-1:0] ula_data_in2;
wire [NUBITS-1:0] uic_acc;

// input in1
ula_in1_ctrl #(.NUBITS(NUBITS),.NBOPCO(NBOPCO)) uic1 (clk, id_dsp_pop, mem_data_rd, sp_data, ula_data_in1);

// input in2
generate if (INN | P_INN | F_INN | PF_INN)
ula_in2_ctrl #(.NUBITS(NUBITS),.NBOPCO(NBOPCO)) uic2 (clk, id_req_in , uic_acc, io_in, ula_data_in2);
else assign ula_data_in2 = racc;
endgenerate

// Arithmetic Logic Unit ------------------------------------------------------

wire signed [NUBITS-1:0] ula_out;

ula #(.NUBITS (NUBITS ),
      .NBMANT (NBMANT ),
      .NBEXPO (NBEXPO ),
      .NUGAIN (NUGAIN ),
	  .NBOPCO (NBOPCO),
        .ADD  (  ADD   |  S_ADD  ),
	  .F_ADD  (F_ADD   | SF_ADD  ),
        .MLT  (  MLT   |  S_MLT  ),
      .F_MLT  (F_MLT   | SF_MLT  ),
        .DIV  (  DIV   |  S_DIV  ),
      .F_DIV  (F_DIV   | SF_DIV  ),
        .MOD  (  MOD   |  S_MOD  ),
        .SGN  (  SGN   |  S_SGN  ),
      .F_SGN  (F_SGN   | SF_SGN  ),
        .NEG  (  NEG             ),
        .NEG_M(  NEG_M |  P_NEG_M),
      .F_NEG  (F_NEG             ),
      .F_NEG_M(F_NEG_M | PF_NEG_M),
        .ABS  (  ABS             ),
        .ABS_M(  ABS_M |  P_ABS_M),
      .F_ABS  (F_ABS             ),
      .F_ABS_M(F_ABS_M | PF_ABS_M),
        .PST  (  PST             ),
        .PST_M(  PST_M |  P_PST_M),
      .F_PST  (F_PST             ),
      .F_PST_M(F_PST_M | PF_PST_M),
        .NRM  (  NRM             ),
        .NRM_M(  NRM_M |  P_NRM_M),
        .I2F  (  I2F   |  F_INN  | PF_INN),
        .I2F_M(  I2F_M |  P_I2F_M),
        .F2I  (  F2I             ),
        .F2I_M(  F2I_M |  P_F2I_M),
        .AND  (  AND   |  S_AND  ),
        .ORR  (  ORR   |  S_ORR  ),
        .XOR  (  XOR   |  S_XOR  ),
        .INV  (  INV             ),
        .INV_M(  INV_M |  P_INV_M),
        .LAN  (  LAN   |  S_LAN  ),
        .LOR  (  LOR   |  S_LOR  ),
        .LIN  (  LIN             ),
        .LIN_M(  LIN_M |  P_LIN_M),
        .LES  (  LES   |  S_LES  ),
      .F_LES  (F_LES   | SF_LES  ),
        .GRE  (  GRE   |  S_GRE  ),
      .F_GRE  (F_GRE   | SF_GRE  ),
        .EQU  (  EQU   |  S_EQU  ),
        .SHL  (  SHL   |  S_SHL  ),
        .SHR  (  SHR   |  S_SHR  ),
		.SRS  (  SRS   |  S_SRS  ),	
	  .F_ROT  (F_ROT             ),
	  .F_SU1  (F_SU1   | SF_SU1  ),
	  .F_SU2  (F_SU2   | SF_SU2  )) ula (id_ula_op, ula_data_in1, ula_data_in2, ula_out);

assign sp_in = ula_out;

// Accumulator ----------------------------------------------------------------

reg signed [NUBITS-1:0] racc;

always @ (posedge clk or posedge rst) if (rst) racc <= 0; else racc <= ula_out;

assign uic_acc = racc;
assign  if_acc = ula_out[0];

// Indirect Addressing --------------------------------------------------------

wire [MDATAW-1:0] rf;

generate
	if (STI | LDI | ILI | ISI) begin
		mem_ctrl #(.NUBITS(NUBITS),
		           .MDATAW(MDATAW),
		           .FFTSIZ(FFTSIZ),
		           .ILI(ILI),.ISI(ISI)) ac(id_sti, id_ldi, id_fft, id_wr,
		                                   ula_out,
		                                   if_operand[MDATAW-1:0], sp_data[MDATAW-1:0],
		                                   mem_wr, mem_addr_rd, mem_addr_wr, mem_data_wr);
	end else begin
		assign mem_wr      = id_wr;
		assign mem_addr_rd = if_operand[MDATAW-1:0];
		assign mem_addr_wr = if_operand[MDATAW-1:0];
		assign mem_data_wr = ula_out;
	end
endgenerate

// I/O Control ----------------------------------------------------------------

generate if (INN | F_INN | P_INN | PF_INN | OUT)
io_ctrl #(.MDATAW(MDATAW),
          .NBIOIN(NBIOIN),
          .NBIOOU(NBIOOU),
		     .INN(   INN),
		   .F_INN( F_INN),
		   .P_INN( P_INN),
		  .PF_INN(PF_INN)) io(clk, id_req_in, id_out_en,
                              if_operand[MDATAW-1:0],
                              req_in, addr_in, out_en, addr_out);
else begin
assign req_in   = 1'b0;
assign out_en   = 1'b0;
assign addr_in  = {NBIOIN{1'b0}};
assign addr_out = {NBIOOU{1'b0}};
end endgenerate

endmodule