module instr_dec
#(
	// -------------------------------------------------------------------------
	// Internal configuration parameters ---------------------------------------
	// -------------------------------------------------------------------------

	parameter  NBOPCO  = 7,   // Number of opcode bits
	parameter  MDATAW  = 8,   // Number of address bits for data memory

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
    parameter  F_ROT   = 0,   // nearest power of 2 to the square root with ACC
    parameter  F_SU1   = 0,   // floating-point subtraction at input 1
	parameter  F_SU2   = 0,   // floating-point subtraction at input 2
    parameter SF_SU1   = 0,   // floating-point subtraction at input 1 with stack
    parameter SF_SU2   = 0,   // floating-point subtraction at input 2 with stack

    // base-less indirect addressing (runtime pointers / array params)
    parameter    LDA   = 0,   // acc = mem[acc]
    parameter    STA   = 0    // mem[stack_top] = acc, pop
)(
	input                   clk, rst,
	input      [NBOPCO-1:0] opcode,

	output                  push, pop,

	output reg [       5:0] ula_op,

	output                  mem_wr,
	output                  req_in, out_en,
	output                  ldi, sti, fft,
	output                  lda, sta
);

// ----------------------------------------------------------------------------
// instruction decoding -------------------------------------------------------
// ----------------------------------------------------------------------------

// implements memory read/write ----------------------------------------------

wire    wLOD  ; generate if (   LOD  ) assign    wLOD   = opcode == 7'd00; else assign    wLOD   = 1'b0; endgenerate
wire  wP_LOD  ; generate if ( P_LOD  ) assign  wP_LOD   = opcode == 7'd01; else assign  wP_LOD   = 1'b0; endgenerate

wire    wLDI  ; generate if (   LDI  ) assign    wLDI   = opcode == 7'd02; else assign    wLDI   = 1'b0; endgenerate
wire    wILI  ; generate if (   ILI  ) assign    wILI   = opcode == 7'd03; else assign    wILI   = 1'b0; endgenerate

wire    wSET  ; generate if (   SET  ) assign    wSET   = opcode == 7'd04; else assign    wSET   = 1'b0; endgenerate
wire    wSET_P; generate if (   SET_P) assign    wSET_P = opcode == 7'd05; else assign    wSET_P = 1'b0; endgenerate

wire    wSTI  ; generate if (   STI  ) assign    wSTI   = opcode == 7'd06; else assign    wSTI   = 1'b0; endgenerate
wire    wISI  ; generate if (   ISI  ) assign    wISI   = opcode == 7'd07; else assign    wISI   = 1'b0; endgenerate

// implements the data-stack interface ----------------------------------------

wire    wPSH  ; generate if (   PSH  ) assign    wPSH   = opcode == 7'd08; else assign    wPSH   = 1'b0; endgenerate
wire    wPOP  ; generate if (   POP  ) assign    wPOP   = opcode == 7'd09; else assign    wPOP   = 1'b0; endgenerate

// implements I/O ports -------------------------------------------------------

wire    wINN  ; generate if (   INN  ) assign    wINN   = opcode == 7'd10; else assign    wINN   = 1'b0; endgenerate
wire  wF_INN  ; generate if ( F_INN  ) assign  wF_INN   = opcode == 7'd11; else assign  wF_INN   = 1'b0; endgenerate
wire  wP_INN  ; generate if ( P_INN  ) assign  wP_INN   = opcode == 7'd12; else assign  wP_INN   = 1'b0; endgenerate
wire wPF_INN  ; generate if (PF_INN  ) assign wPF_INN   = opcode == 7'd13; else assign wPF_INN   = 1'b0; endgenerate

wire    wOUT  ; generate if (   OUT  ) assign    wOUT   = opcode == 7'd14; else assign    wOUT   = 1'b0; endgenerate

// two-parameter arithmetic operations ----------------------------------------

wire    wADD  ; generate if (   ADD  ) assign    wADD   = opcode == 7'd19; else assign    wADD   = 1'b0; endgenerate
wire  wS_ADD  ; generate if ( S_ADD  ) assign  wS_ADD   = opcode == 7'd20; else assign  wS_ADD   = 1'b0; endgenerate
wire  wF_ADD  ; generate if ( F_ADD  ) assign  wF_ADD   = opcode == 7'd21; else assign  wF_ADD   = 1'b0; endgenerate
wire wSF_ADD  ; generate if (SF_ADD  ) assign wSF_ADD   = opcode == 7'd22; else assign wSF_ADD   = 1'b0; endgenerate

wire    wMLT  ; generate if (   MLT  ) assign    wMLT   = opcode == 7'd23; else assign    wMLT   = 1'b0; endgenerate
wire  wS_MLT  ; generate if ( S_MLT  ) assign  wS_MLT   = opcode == 7'd24; else assign  wS_MLT   = 1'b0; endgenerate
wire  wF_MLT  ; generate if ( F_MLT  ) assign  wF_MLT   = opcode == 7'd25; else assign  wF_MLT   = 1'b0; endgenerate
wire wSF_MLT  ; generate if (SF_MLT  ) assign wSF_MLT   = opcode == 7'd26; else assign wSF_MLT   = 1'b0; endgenerate

wire    wDIV  ; generate if (   DIV  ) assign    wDIV   = opcode == 7'd27; else assign    wDIV   = 1'b0; endgenerate
wire  wS_DIV  ; generate if ( S_DIV  ) assign  wS_DIV   = opcode == 7'd28; else assign  wS_DIV   = 1'b0; endgenerate
wire  wF_DIV  ; generate if ( F_DIV  ) assign  wF_DIV   = opcode == 7'd29; else assign  wF_DIV   = 1'b0; endgenerate
wire wSF_DIV  ; generate if (SF_DIV  ) assign wSF_DIV   = opcode == 7'd30; else assign wSF_DIV   = 1'b0; endgenerate

wire    wMOD  ; generate if (   MOD  ) assign    wMOD   = opcode == 7'd31; else assign    wMOD   = 1'b0; endgenerate
wire  wS_MOD  ; generate if ( S_MOD  ) assign  wS_MOD   = opcode == 7'd32; else assign  wS_MOD   = 1'b0; endgenerate

wire    wSGN  ; generate if (   SGN  ) assign    wSGN   = opcode == 7'd33; else assign    wSGN   = 1'b0; endgenerate
wire  wS_SGN  ; generate if ( S_SGN  ) assign  wS_SGN   = opcode == 7'd34; else assign  wS_SGN   = 1'b0; endgenerate
wire  wF_SGN  ; generate if ( F_SGN  ) assign  wF_SGN   = opcode == 7'd35; else assign  wF_SGN   = 1'b0; endgenerate
wire wSF_SGN  ; generate if (SF_SGN  ) assign wSF_SGN   = opcode == 7'd36; else assign wSF_SGN   = 1'b0; endgenerate

// one-parameter arithmetic operations ----------------------------------------

wire    wNEG  ; generate if (   NEG  ) assign    wNEG   = opcode == 7'd37; else assign    wNEG   = 1'b0; endgenerate
wire    wNEG_M; generate if (   NEG_M) assign    wNEG_M = opcode == 7'd38; else assign    wNEG_M = 1'b0; endgenerate
wire  wP_NEG_M; generate if ( P_NEG_M) assign  wP_NEG_M = opcode == 7'd39; else assign  wP_NEG_M = 1'b0; endgenerate
wire  wF_NEG  ; generate if ( F_NEG  ) assign  wF_NEG   = opcode == 7'd40; else assign  wF_NEG   = 1'b0; endgenerate
wire  wF_NEG_M; generate if ( F_NEG_M) assign  wF_NEG_M = opcode == 7'd41; else assign  wF_NEG_M = 1'b0; endgenerate
wire wPF_NEG_M; generate if (PF_NEG_M) assign wPF_NEG_M = opcode == 7'd42; else assign wPF_NEG_M = 1'b0; endgenerate

wire    wABS  ; generate if (   ABS  ) assign    wABS   = opcode == 7'd43; else assign    wABS   = 1'b0; endgenerate
wire    wABS_M; generate if (   ABS_M) assign    wABS_M = opcode == 7'd44; else assign    wABS_M = 1'b0; endgenerate
wire  wP_ABS_M; generate if ( P_ABS_M) assign  wP_ABS_M = opcode == 7'd45; else assign  wP_ABS_M = 1'b0; endgenerate
wire  wF_ABS  ; generate if ( F_ABS  ) assign  wF_ABS   = opcode == 7'd46; else assign  wF_ABS   = 1'b0; endgenerate
wire  wF_ABS_M; generate if ( F_ABS_M) assign  wF_ABS_M = opcode == 7'd47; else assign  wF_ABS_M = 1'b0; endgenerate
wire wPF_ABS_M; generate if (PF_ABS_M) assign wPF_ABS_M = opcode == 7'd48; else assign wPF_ABS_M = 1'b0; endgenerate

wire    wPST  ; generate if (   PST  ) assign    wPST   = opcode == 7'd49; else assign    wPST   = 1'b0; endgenerate
wire    wPST_M; generate if (   PST_M) assign    wPST_M = opcode == 7'd50; else assign    wPST_M = 1'b0; endgenerate
wire  wP_PST_M; generate if ( P_PST_M) assign  wP_PST_M = opcode == 7'd51; else assign  wP_PST_M = 1'b0; endgenerate
wire  wF_PST  ; generate if ( F_PST  ) assign  wF_PST   = opcode == 7'd52; else assign  wF_PST   = 1'b0; endgenerate
wire  wF_PST_M; generate if ( F_PST_M) assign  wF_PST_M = opcode == 7'd53; else assign  wF_PST_M = 1'b0; endgenerate
wire wPF_PST_M; generate if (PF_PST_M) assign wPF_PST_M = opcode == 7'd54; else assign wPF_PST_M = 1'b0; endgenerate

wire    wNRM  ; generate if (   NRM  ) assign    wNRM   = opcode == 7'd55; else assign    wNRM   = 1'b0; endgenerate
wire    wNRM_M; generate if (   NRM_M) assign    wNRM_M = opcode == 7'd56; else assign    wNRM_M = 1'b0; endgenerate
wire  wP_NRM_M; generate if ( P_NRM_M) assign  wP_NRM_M = opcode == 7'd57; else assign  wP_NRM_M = 1'b0; endgenerate

wire    wI2F  ; generate if (   I2F  ) assign    wI2F   = opcode == 7'd58; else assign    wI2F   = 1'b0; endgenerate
wire    wI2F_M; generate if (   I2F_M) assign    wI2F_M = opcode == 7'd59; else assign    wI2F_M = 1'b0; endgenerate
wire  wP_I2F_M; generate if ( P_I2F_M) assign  wP_I2F_M = opcode == 7'd60; else assign  wP_I2F_M = 1'b0; endgenerate

wire    wF2I  ; generate if (   F2I  ) assign    wF2I   = opcode == 7'd61; else assign    wF2I   = 1'b0; endgenerate
wire    wF2I_M; generate if (   F2I_M) assign    wF2I_M = opcode == 7'd62; else assign    wF2I_M = 1'b0; endgenerate
wire  wP_F2I_M; generate if ( P_F2I_M) assign  wP_F2I_M = opcode == 7'd63; else assign  wP_F2I_M = 1'b0; endgenerate

// two-parameter logical operations -------------------------------------------

wire    wAND  ; generate if (   AND  ) assign    wAND   = opcode == 7'd64; else assign    wAND   = 1'b0; endgenerate
wire  wS_AND  ; generate if ( S_AND  ) assign  wS_AND   = opcode == 7'd65; else assign  wS_AND   = 1'b0; endgenerate

wire    wORR  ; generate if (   ORR  ) assign    wORR   = opcode == 7'd66; else assign    wORR   = 1'b0; endgenerate
wire  wS_ORR  ; generate if ( S_ORR  ) assign  wS_ORR   = opcode == 7'd67; else assign  wS_ORR   = 1'b0; endgenerate

wire    wXOR  ; generate if (   XOR  ) assign    wXOR   = opcode == 7'd68; else assign    wXOR   = 1'b0; endgenerate
wire  wS_XOR  ; generate if ( S_XOR  ) assign  wS_XOR   = opcode == 7'd69; else assign  wS_XOR   = 1'b0; endgenerate

// one-parameter logical operations -------------------------------------------

wire    wINV  ; generate if (   INV  ) assign    wINV   = opcode == 7'd70; else assign    wINV   = 1'b0; endgenerate
wire    wINV_M; generate if (   INV_M) assign    wINV_M = opcode == 7'd71; else assign    wINV_M = 1'b0; endgenerate
wire  wP_INV_M; generate if ( P_INV_M) assign  wP_INV_M = opcode == 7'd72; else assign  wP_INV_M = 1'b0; endgenerate

// two-parameter conditional operations ---------------------------------------

wire    wLAN  ; generate if (   LAN  ) assign    wLAN   = opcode == 7'd73; else assign    wLAN   = 1'b0; endgenerate
wire  wS_LAN  ; generate if ( S_LAN  ) assign  wS_LAN   = opcode == 7'd74; else assign  wS_LAN   = 1'b0; endgenerate

wire    wLOR  ; generate if (   LOR  ) assign    wLOR   = opcode == 7'd75; else assign    wLOR   = 1'b0; endgenerate
wire  wS_LOR  ; generate if ( S_LOR  ) assign  wS_LOR   = opcode == 7'd76; else assign  wS_LOR   = 1'b0; endgenerate

// one-parameter conditional operations ---------------------------------------

wire    wLIN  ; generate if (   LIN  ) assign    wLIN   = opcode == 7'd77; else assign    wLIN   = 1'b0; endgenerate
wire    wLIN_M; generate if (   LIN_M) assign    wLIN_M = opcode == 7'd78; else assign    wLIN_M = 1'b0; endgenerate
wire  wP_LIN_M; generate if ( P_LIN_M) assign  wP_LIN_M = opcode == 7'd79; else assign  wP_LIN_M = 1'b0; endgenerate

// comparison operations ------------------------------------------------------

wire    wLES  ; generate if (   LES  ) assign    wLES   = opcode == 7'd80; else assign    wLES   = 1'b0; endgenerate
wire  wS_LES  ; generate if ( S_LES  ) assign  wS_LES   = opcode == 7'd81; else assign  wS_LES   = 1'b0; endgenerate
wire  wF_LES  ; generate if ( F_LES  ) assign  wF_LES   = opcode == 7'd82; else assign  wF_LES   = 1'b0; endgenerate
wire wSF_LES  ; generate if (SF_LES  ) assign wSF_LES   = opcode == 7'd83; else assign wSF_LES   = 1'b0; endgenerate

wire    wGRE  ; generate if (   GRE  ) assign    wGRE   = opcode == 7'd84; else assign    wGRE   = 1'b0; endgenerate
wire  wS_GRE  ; generate if ( S_GRE  ) assign  wS_GRE   = opcode == 7'd85; else assign  wS_GRE   = 1'b0; endgenerate
wire  wF_GRE  ; generate if ( F_GRE  ) assign  wF_GRE   = opcode == 7'd86; else assign  wF_GRE   = 1'b0; endgenerate
wire wSF_GRE  ; generate if (SF_GRE  ) assign wSF_GRE   = opcode == 7'd87; else assign wSF_GRE   = 1'b0; endgenerate

wire    wEQU  ; generate if (   EQU  ) assign    wEQU   = opcode == 7'd88; else assign    wEQU   = 1'b0; endgenerate
wire  wS_EQU  ; generate if ( S_EQU  ) assign  wS_EQU   = opcode == 7'd89; else assign  wS_EQU   = 1'b0; endgenerate

// bit-shift operations -------------------------------------------------------

wire    wSHL  ; generate if (   SHL  ) assign    wSHL   = opcode == 7'd90; else assign    wSHL   = 1'b0; endgenerate
wire  wS_SHL  ; generate if ( S_SHL  ) assign  wS_SHL   = opcode == 7'd91; else assign  wS_SHL   = 1'b0; endgenerate

wire    wSHR  ; generate if (   SHR  ) assign    wSHR   = opcode == 7'd92; else assign    wSHR   = 1'b0; endgenerate
wire  wS_SHR  ; generate if ( S_SHR  ) assign  wS_SHR   = opcode == 7'd93; else assign  wS_SHR   = 1'b0; endgenerate

wire    wSRS  ; generate if (   SRS  ) assign    wSRS   = opcode == 7'd94; else assign    wSRS   = 1'b0; endgenerate
wire  wS_SRS  ; generate if ( S_SRS  ) assign  wS_SRS   = opcode == 7'd95; else assign  wS_SRS   = 1'b0; endgenerate

// special operations (skips NOP) ---------------------------------------------

wire  wF_ROT  ; generate if ( F_ROT  ) assign  wF_ROT   = opcode == 7'd97;  else assign   wF_ROT  = 1'b0; endgenerate
wire  wF_SU1  ; generate if ( F_SU1  ) assign  wF_SU1   = opcode == 7'd98;  else assign   wF_SU1  = 1'b0; endgenerate
wire  wF_SU2  ; generate if ( F_SU2  ) assign  wF_SU2   = opcode == 7'd99;  else assign   wF_SU2  = 1'b0; endgenerate
wire wSF_SU1  ; generate if (SF_SU1  ) assign wSF_SU1   = opcode == 7'd100; else assign  wSF_SU1  = 1'b0; endgenerate
wire wSF_SU2  ; generate if (SF_SU2  ) assign wSF_SU2   = opcode == 7'd101; else assign  wSF_SU2  = 1'b0; endgenerate

// base-less indirect addressing ----------------------------------------------

wire    wLDA  ; generate if (   LDA  ) assign    wLDA   = opcode == 7'd102; else assign    wLDA   = 1'b0; endgenerate
wire    wSTA  ; generate if (   STA  ) assign    wSTA   = opcode == 7'd103; else assign    wSTA   = 1'b0; endgenerate

// ----------------------------------------------------------------------------
// control circuits -----------------------------------------------------------
// ----------------------------------------------------------------------------

// data input control circuit -------------------------------------------------

generate if (INN | F_INN | P_INN | PF_INN) assign req_in = wINN | wF_INN | wP_INN | wPF_INN; else assign req_in = 1'b0; endgenerate

// data output control circuit ------------------------------------------------

generate if (OUT) assign out_en = wOUT; else assign out_en = 1'b0; endgenerate

// indirect addressing control circuits ---------------------------------------

generate if (LDI | ILI) assign ldi = wLDI |  wILI; else assign ldi = 1'b0; endgenerate
generate if (STI | ISI) assign sti = wSTI |  wISI; else assign sti = 1'b0; endgenerate
generate if (ILI | ISI) assign fft = wILI |  wISI; else assign fft = 1'b0; endgenerate

// base-less indirect addressing control --------------------------------------

generate if (LDA) assign lda = wLDA; else assign lda = 1'b0; endgenerate
generate if (STA) assign sta = wSTA; else assign sta = 1'b0; endgenerate

// memory write control circuit -----------------------------------------------

generate if (SET | SET_P | STI | ISI | STA) assign mem_wr = wSET | wSET_P | wSTI | wISI | wSTA; else assign mem_wr = 1'b0; endgenerate

// data-stack write control circuit -------------------------------------------

generate
if (                P_LOD   |     PSH   |  P_INN   |  PF_INN   |  P_NEG_M |  PF_NEG_M |  P_ABS_M |  PF_ABS_M |
                    P_PST_M |  PF_PST_M |  P_NRM_M |   P_I2F_M |  P_F2I_M |   P_INV_M |  P_LIN_M )
     assign push = wP_LOD   |    wPSH   | wP_INN   | wPF_INN   | wP_NEG_M | wPF_NEG_M | wP_ABS_M | wPF_ABS_M |
	               wP_PST_M | wPF_PST_M | wP_NRM_M |  wP_I2F_M | wP_F2I_M |  wP_INV_M | wP_LIN_M ;
else assign push = 1'b0;
endgenerate

// data-stack read control circuit --------------------------------------------

generate
if (               SET_P |    STI |     ISI |    POP |  S_ADD |  SF_ADD |   S_MLT |
                SF_MLT   |  S_DIV |  SF_DIV |  S_MOD |  S_SGN |  SF_SGN |   S_AND |
				 S_ORR   |  S_XOR |   S_LAN |  S_LOR |  S_LES |  SF_LES |   S_GRE |
				SF_GRE   |  S_EQU |   S_SHL |  S_SHR |  S_SRS |  SF_SU1 |  SF_SU2 |
                  STA    )
     assign pop = wSET_P |   wSTI |    wISI |   wPOP | wS_ADD | wSF_ADD |  wS_MLT |
	           wSF_MLT   | wS_DIV | wSF_DIV | wS_MOD | wS_SGN | wSF_SGN |  wS_AND |
				wS_ORR   | wS_XOR |  wS_LAN | wS_LOR | wS_LES | wSF_LES |  wS_GRE |
			   wSF_GRE   | wS_EQU |  wS_SHL | wS_SHR | wS_SRS | wSF_SU1 | wSF_SU2 |
			      wSTA   ;
else assign pop = 1'b0   ;
endgenerate

// ALU operations control circuit ---------------------------------------------

wire b5,b4,b3,b2,b1,b0;

// logic for b5
generate
if (              INV |    INV_M |  P_INV_M |     LAN |   S_LAN |    LOR |  S_LOR |     LIN |    LIN_M |  P_LIN_M |
                  LES |  S_LES   |  F_LES   |  SF_LES |     GRE |  S_GRE |  F_GRE |  SF_GRE |    EQU   |  S_EQU   |
                  SHL |  S_SHL   |    SHR   |   S_SHR |     SRS |  S_SRS |
                F_ROT |  F_SU1   |  F_SU2   |  SF_SU1 |  SF_SU2 )

     assign b5 = wINV |   wINV_M | wP_INV_M |    wLAN |  wS_LAN |   wLOR | wS_LOR |    wLIN |   wLIN_M | wP_LIN_M |
                 wLES | wS_LES   | wF_LES   | wSF_LES |    wGRE | wS_GRE | wF_GRE | wSF_GRE |   wEQU   | wS_EQU   |
                 wSHL | wS_SHL   |   wSHR   |  wS_SHR |    wSRS | wS_SRS |
               wF_ROT | wF_SU1   | wF_SU2   | wSF_SU1 | wSF_SU2 ;
else assign b5 = 1'b0 ;
endgenerate

// logic for b4
generate
if (              F_INN   |  PF_INN   |
                    ABS_M |  P_ABS_M  |  F_ABS   |  F_ABS_M |  PF_ABS_M |
                    PST   |    PST_M  |  P_PST_M |  F_PST   |  F_PST_M  |  PF_PST_M |
                    NRM   |    NRM_M  |  P_NRM_M |
                    I2F   |    I2F_M  |  P_I2F_M |    F2I   |    F2I_M  |   P_F2I_M |
                    AND   |  S_AND    |    ORR   |  S_ORR   |    XOR    |   S_XOR   |
                  F_SU2   | SF_SU2    )

     assign b4 = wF_INN   | wPF_INN   |
                   wABS_M |  wP_ABS_M | wF_ABS   | wF_ABS_M | wPF_ABS_M |
                   wPST   |    wPST_M | wP_PST_M | wF_PST   |  wF_PST_M | wPF_PST_M |
                   wNRM   |    wNRM_M | wP_NRM_M |
                   wI2F   |    wI2F_M | wP_I2F_M |   wF2I   |    wF2I_M |  wP_F2I_M |
                   wAND   |  wS_AND   |   wORR   | wS_ORR   |    wXOR   |  wS_XOR   |
                 wF_SU2   | wSF_SU2   ;
else assign b4 = 1'b0 ;
endgenerate

// logic for b3
generate
if               (F_INN | PF_INN    |
                    MOD |  S_MOD    |    SGN    |   S_SGN |  F_SGN   |  SF_SGN   |
                    NEG |    NEG_M  |   P_NEG_M |   F_NEG |  F_NEG_M |  PF_NEG_M |
                    ABS |    NRM_M  |   P_NRM_M |
                    I2F |    I2F_M  |   P_I2F_M |     F2I |    F2I_M |   P_F2I_M |
                    AND |  S_AND    |     ORR   |   S_ORR |    XOR   |   S_XOR   |
                    GRE |  S_GRE    |   F_GRE   |  SF_GRE |    EQU   |   S_EQU   |
                    SHL |  S_SHL    |     SHR   |   S_SHR |    SRS   |   S_SRS   |
                  F_ROT |  F_SU1    |  SF_SU1   )

     assign b3 = wF_INN | wPF_INN   |
                   wMOD |  wS_MOD   |    wSGN   |  wS_SGN | wF_SGN   | wSF_SGN   |
                   wNEG |    wNEG_M |  wP_NEG_M |  wF_NEG | wF_NEG_M | wPF_NEG_M |
                   wABS |    wNRM_M |  wP_NRM_M |
                   wI2F |    wI2F_M |  wP_I2F_M |    wF2I |   wF2I_M |  wP_F2I_M |
                   wAND |  wS_AND   |    wORR   |  wS_ORR |   wXOR   |  wS_XOR   |
                   wGRE |  wS_GRE   |  wF_GRE   | wSF_GRE |   wEQU   |  wS_EQU   |
                   wSHL |  wS_SHL   |    wSHR   |  wS_SHR |   wSRS   |  wS_SRS   |
                 wF_ROT |  wF_SU1   | wSF_SU1   ;
else assign b3 = 1'b0 ;
endgenerate

// logic for b2
generate
if (              MLT   | S_MLT    |   F_MLT   |  SF_MLT   |
                  DIV   | S_DIV    |   F_DIV   |  SF_DIV   |
                  NEG_M | P_NEG_M  |   F_NEG   |   F_NEG_M |  PF_NEG_M |   ABS |
                  PST_M | P_PST_M  |   F_PST   |   F_PST_M |  PF_PST_M |   NRM |
                  F2I_M | P_F2I_M  |
                  AND   | S_AND    |     ORR   |   S_ORR   |     XOR   | S_XOR |
                  LIN   |   LIN_M  |   P_LIN_M |     LES   |   S_LES   | F_LES |   SF_LES |
                  SHR   | S_SHR    |     SRS   |   S_SRS   |
                F_ROT   | F_SU1    |  SF_SU1   )

     assign b2 = wMLT   | wS_MLT   |  wF_MLT   | wSF_MLT   |
                 wDIV   | wS_DIV   |  wF_DIV   | wSF_DIV   |
                 wNEG_M | wP_NEG_M |  wF_NEG   |  wF_NEG_M | wPF_NEG_M |   wABS |
                 wPST_M | wP_PST_M |  wF_PST   |  wF_PST_M | wPF_PST_M |   wNRM |
                 wF2I_M | wP_F2I_M |
                 wAND   | wS_AND   |    wORR   |  wS_ORR   |    wXOR   | wS_XOR |
                 wLIN   |   wLIN_M |  wP_LIN_M |    wLES   |  wS_LES   | wF_LES | wSF_LES |
                 wSHR   | wS_SHR   |    wSRS   |  wS_SRS   |
               wF_ROT   | wF_SU1   | wSF_SU1   ;
else assign b2 = 1'b0 ;
endgenerate

// logic for b1
generate
if (              ADD |  S_ADD   |   F_ADD   |  SF_ADD   |
                  DIV |  S_DIV   |   F_DIV   |  SF_DIV   |
                                     F_SGN   |  SF_SGN   |
                  NEG            |   F_NEG_M |  PF_NEG_M |
                  ABS            |   F_ABS_M |  PF_ABS_M |
                  PST            |   F_PST_M |  PF_PST_M |
                  NRM |
                                       I2F_M |   P_I2F_M |
                  F2I |
                  ORR |  S_ORR   |     XOR   |   S_XOR   |
                  LAN |  S_LAN   |     LOR   |   S_LOR   |
                  LES |  S_LES   |   F_LES   |  SF_LES   |
                  EQU |  S_EQU   |     SHL   |   S_SHL   |
                F_ROT |  F_SU1   |  SF_SU1   )

     assign b1 = wADD | wS_ADD   |  wF_ADD   | wSF_ADD   |
                 wDIV | wS_DIV   |  wF_DIV   | wSF_DIV   |
                                    wF_SGN   | wSF_SGN   |
                 wNEG            |  wF_NEG_M | wPF_NEG_M |
                 wABS | wF_ABS_M | wPF_ABS_M |
                 wPST | wF_PST_M | wPF_PST_M |
                 wNRM |
                                      wI2F_M |  wP_I2F_M |
                 wF2I |
                 wORR | wS_ORR   |    wXOR   |  wS_XOR   |
                 wLAN | wS_LAN   |    wLOR   |  wS_LOR   |
                 wLES | wS_LES   |  wF_LES   | wSF_LES   |
                 wEQU | wS_EQU   |    wSHL   |  wS_SHL   |
               wF_ROT | wF_SU1   | wSF_SU1   ;
else assign b1 = 1'b0 ;
endgenerate

// logic for b0
generate
if (              LOD |  P_LOD |  LDI   |    ILI   |    SET_P |     POP |  F_INN |  PF_INN |  F_ADD |  SF_ADD |  F_MLT |  SF_MLT |  F_DIV |  SF_DIV   |    SGN   |  S_SGN |
                  NEG |  F_NEG |  ABS   |  F_ABS   |    PST   |   F_PST |    NRM |     I2F |    F2I |     AND |  S_AND |     XOR |  S_XOR |     INV_M |  P_INV_M |
                  LOR |  S_LOR |  LIN_M |  P_LIN_M |  F_LES   |  SF_LES |  F_GRE |  SF_GRE |    SHL |   S_SHL |    SRS |   S_SRS |  F_SU1 |  SF_SU1   |
                  LDA )

     assign b0 = wLOD | wP_LOD | wLDI   |   wILI   |   wSET_P |    wPOP | wF_INN | wPF_INN | wF_ADD | wSF_ADD | wF_MLT | wSF_MLT | wF_DIV | wSF_DIV   |   wSGN   | wS_SGN |
                 wNEG | wF_NEG | wABS   | wF_ABS   |   wPST   |  wF_PST |   wNRM |    wI2F |   wF2I |    wAND | wS_AND |    wXOR | wS_XOR |    wINV_M | wP_INV_M |
                 wLOR | wS_LOR | wLIN_M | wP_LIN_M | wF_LES   | wSF_LES | wF_GRE | wSF_GRE |   wSHL |  wS_SHL |   wSRS |  wS_SRS | wF_SU1 | wSF_SU1   |
                 wLDA ;
else assign b0 = 1'b0 ;
endgenerate

// combine logic into ula_op
always @ (posedge clk) ula_op <= {b5,b4,b3,b2,b1,b0};

endmodule

//  Table mapping opcode to ALU operation
/* ---------------------------------------------------------------------------
    0 : ula_op  <= 6'd1;     //    LOD   -> loads accumulator with data from memory
    1 : ula_op  <= 6'd1;     //  P_LOD   -> PSH then LOD
    2 : ula_op  <= 6'd1;     //    LDI   -> Load with indirect addressing
    3 : ula_op  <= 6'd1;     //    ILI   -> Load with bit-reversed indirect addressing
    4 : ula_op  <= 6'd0;     //    SET   -> stores accumulator value into memory
    6 : ula_op  <= 6'd0;     //    STI   -> Set with indirect addressing
    7 : ula_op  <= 6'd0;     //    ISI   -> STI with bit-reversed addressing
    8 : ula_op  <= 6'd0;     //    PSH
    9 : ula_op  <= 6'd1;     //    POP
    10: ula_op  <= 6'd0;     //    INN   -> Data input
    11: ula_op  <= 6'd25;    //  F_INN   -> Floating-point data input (performing I2F)
    12: ula_op  <= 6'd0;     //  P_INN   -> PUSH + INN
    13: ula_op  <= 6'd25;    // PF_INN   -> PUSH + F_INN
    14: ula_op  <= 6'd0;     //    OUT   -> Data output
    15: ula_op  <= 6'd0;     //    JMP (see prefetch)
    16: ula_op  <= 6'd0;     //    JIZ (see prefetch)
    17: ula_op  <= 6'd0;     //    CAL (see prefetch)
    18: ula_op  <= 6'd0;     //    RET
    19: ula_op  <= 6'd2;     //    ADD   -> addition with memory
    20: ula_op  <= 6'd2;     //  S_ADD   -> addition with stack
    21: ula_op  <= 6'd3;     //  F_ADD   -> floating-point addition with memory
    22: ula_op  <= 6'd3;     // SF_ADD   -> floating-point addition with stack
    23: ula_op  <= 6'd4;     //    MLT   -> multiplies memory data with accumulator
    24: ula_op  <= 6'd4;     //  S_MLT   -> multiplication with stack
    25: ula_op  <= 6'd5;     //  F_MLT   -> floating-point multiplication with memory
    26: ula_op  <= 6'd5;     // SF_MLT   -> floating-point multiplication with stack
    27: ula_op  <= 6'd6;     //    DIV   -> division with memory
    28: ula_op  <= 6'd6;     //  S_DIV   -> division with stack
    29: ula_op  <= 6'd7;     //  F_DIV   -> floating-point division with memory
    30: ula_op  <= 6'd7;     // SF_DIV   -> floating-point division with stack
    31: ula_op  <= 6'd8;     //    MOD   -> division remainder with memory
    32: ula_op  <= 6'd8;     //  S_MOD   -> division remainder with stack
    33: ula_op  <= 6'd9;     //    SGN   -> takes the sign of in1 and applies it to in2
    34: ula_op  <= 6'd9;     //  S_SGN   -> SGN with stack
    35: ula_op  <= 6'd10;    //  F_SGN   -> floating-point SGN with memory
    36: ula_op  <= 6'd10;    // SF_SGN   -> floating-point SGN with stack
    37: ula_op  <= 6'd11;    //    NEG   -> Two's complement
    38: ula_op  <= 6'd12;    //    NEG_M -> negation with memory
    39: ula_op  <= 6'd12;    //  P_NEG_M -> negation with memory, push before
    40: ula_op  <= 6'd13;    //  F_NEG   -> floating-point negation with acc
    41: ula_op  <= 6'd14;    //  F_NEG_M -> floating-point negation with memory
    42: ula_op  <= 6'd14;    // PF_NEG_M -> floating-point negation with memory, push before
    43: ula_op  <= 6'd15;    //    ABS   -> returns absolute value of acc (example: x = abs(y))
    44: ula_op  <= 6'd16;    //    ABS_M -> ABS with memory
    45: ula_op  <= 6'd16;    //  P_ABS_M -> ABS with memory, push before
    46: ula_op  <= 6'd17;    //  F_ABS   -> floating-point ABS
    47: ula_op  <= 6'd18;    //  F_ABS_M -> floating-point ABS with memory
    48: ula_op  <= 6'd18;    // PF_ABS_M -> floating-point ABS with memory, push before
    49: ula_op  <= 6'd19;    //    PST   -> loads accumulator value, or zero if negative
    50: ula_op  <= 6'd20;    //    PST_M -> PST with memory
    51: ula_op  <= 6'd20;    //  P_PST_M -> PST with memory, push before
    52: ula_op  <= 6'd21;    //  F_PST   -> floating-point PST
    53: ula_op  <= 6'd22;    //  F_PST_M -> floating-point PST with memory
    54: ula_op  <= 6'd22;    // PF_PST_M -> floating-point PST with memory, push before
    55: ula_op  <= 6'd23;    //    NRM   -> Division of acc by a constant (example: />300)
    56: ula_op  <= 6'd24;    //    NRM_M -> NRM with memory
    57: ula_op  <= 6'd24;    //  P_NRM_M -> NRM with memory, push before
    58: ula_op  <= 6'd25;    //    I2F   -> int2float with accumulator
    59: ula_op  <= 6'd26;    //    I2F_M -> int2float with memory
    60: ula_op  <= 6'd26;    //  P_I2F_M -> int2float with memory, push before
    61: ula_op  <= 6'd27;    //    F2I   -> float2int with accumulator
    62: ula_op  <= 6'd28;    //    F2I_M -> float2int with memory
    63: ula_op  <= 6'd28;    //  P_F2I_M -> float2int with memory, push before
    64: ula_op  <= 6'd29;    //    AND   -> bitwise AND with memory
    65: ula_op  <= 6'd29;    //  S_AND   -> bitwise AND with stack
    66: ula_op  <= 6'd30;    //    ORR   -> bitwise OR with memory
    67: ula_op  <= 6'd30;    //  S_ORR   -> bitwise OR with stack
    68: ula_op  <= 6'd31;    //    XOR   -> bitwise XOR with memory
    69: ula_op  <= 6'd31;    //  S_XOR   -> bitwise XOR with stack
    70: ula_op  <= 6'd32;    //    INV   -> Bitwise inversion of accumulator
    71: ula_op  <= 6'd33;    //    INV_M -> INV with memory
    72: ula_op  <= 6'd33;    //  P_INV_M -> INV with memory, push before
    73: ula_op  <= 6'd34;    //    LAN   -> logical AND with memory
    74: ula_op  <= 6'd34;    //  S_LAN   -> logical AND with stack
    75: ula_op  <= 6'd35;    //    LOR   -> logical OR with memory
    76: ula_op  <= 6'd35;    //  S_LOR   -> logical OR with stack
    77: ula_op  <= 6'd36;    //    LIN   -> Conditional bit inversion
    78: ula_op  <= 6'd37;    //    LIN_M -> LIN with memory
    79: ula_op  <= 6'd37;    //  P_LIN_M -> LIN with memory, push before
    80: ula_op  <= 6'd38;    //    LES   -> Less-than with memory
    81: ula_op  <= 6'd38;    //  S_LES   -> Less-than with stack
    82: ula_op  <= 6'd39;    //  F_LES   -> floating-point less-than with memory
    83: ula_op  <= 6'd39;    // SF_LES   -> floating-point less-than with stack
    84: ula_op  <= 6'd40;    //    GRE   -> greater-than with memory
    85: ula_op  <= 6'd40;    //  S_GRE   -> greater-than with stack
    86: ula_op  <= 6'd41;    //  F_GRE   -> floating-point greater-than with memory
    87: ula_op  <= 6'd41;    // SF_GRE   -> floating-point greater-than with stack
    88: ula_op  <= 6'd42;    //    EQU   -> Equal with memory
    89: ula_op  <= 6'd42;    //  S_EQU   -> Equal with stack
    90: ula_op  <= 6'd43;    //    SHL   -> left shift with memory
    91: ula_op  <= 6'd43;    //  S_SHL   -> left shift with stack
    92: ula_op  <= 6'd44;    //    SHR   -> right shift with memory
    93: ula_op  <= 6'd44;    //  S_SHR   -> right shift with stack
    94: ula_op  <= 6'd45;    //    SRS   -> signed right shift using memory
    95: ula_op  <= 6'd45;    //  S_SRS   -> signed right shift using stack
    96: ula_op  <= 6'dx;     //    NOP   -> No Operation
    97: ula_op  <= 6'd46;    //  F_ROT   -> floating-point square root
    98: ula_op  <= 6'd47;    //  F_SU1   -> floating-point subtraction with memory at input 1
    99: ula_op  <= 6'd48;    //  F_SU2   -> floating-point subtraction with memory at input 2
   100: ula_op  <= 6'd47;    // SF_SU1   -> floating-point subtraction with stack at input 1
   101: ula_op  <= 6'd48;    // SF_SU2   -> floating-point subtraction with stack at input 2
    ------------------------------------------------*/
