module instr_dec
#(
	// -------------------------------------------------------------------------
	// Parametros de configuracao internos -------------------------------------
	// -------------------------------------------------------------------------

	parameter  NBOPCO  = 7,   // Numero de bits de opcode
	parameter  MDATAW  = 8,   // Numero de bits de endereco da memoria de dados

	// -------------------------------------------------------------------------
	// Parametros configurados dinamicamente -----------------------------------
	// -------------------------------------------------------------------------

	// implementa leitura/escrita na memoria
    parameter    LOD   = 0,
	parameter  P_LOD   = 0,

	parameter    LDI   = 0,
	parameter    ILI   = 0,

	parameter    SET   = 0,
	parameter    SET_P = 0,

	parameter    STI   = 0,
	parameter    ISI   = 0,

	// implementa interface com a pilha de dados
	parameter    PSH   = 0,
	parameter    POP   = 0,

	// implementa portas de I/O
	parameter    INN   = 0,
    parameter  F_INN   = 0,
	parameter  P_INN   = 0,
    parameter PF_INN   = 0,
	parameter    OUT   = 0,

	// operacoes aritmeticas de dois parametros
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

	// operacoes aritmeticas de um parametro
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

	// operacoes logicas de dois parametros
    parameter    AND   = 0,
	parameter  S_AND   = 0,

    parameter    ORR   = 0,
	parameter  S_ORR   = 0,

    parameter    XOR   = 0,
	parameter  S_XOR   = 0,

	// operacoes logicas de um parametro
    parameter    INV   = 0,
    parameter    INV_M = 0,
	parameter  P_INV_M = 0,

	// operacoes condicionais de dois parametros
    parameter    LAN   = 0,
	parameter  S_LAN   = 0,

    parameter    LOR   = 0,
	parameter  S_LOR   = 0,

	// operacoes condicionais de um parametro
    parameter    LIN   = 0,
    parameter    LIN_M = 0,
	parameter  P_LIN_M = 0,

	// operacoes de comparacao
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

	// operacoes de deslocamento de bits
    parameter    SHL   = 0,
	parameter  S_SHL   = 0,

    parameter    SHR   = 0,
	parameter  S_SHR   = 0,

    parameter    SRS   = 0,
	parameter  S_SRS   = 0,

    // operacoes especiais
    parameter  F_ROT   = 0   // potencia de 2 mais proxima da raiz (com ACC)
)(
	input                   clk, rst,
	input      [NBOPCO-1:0] opcode,

	output                  push, pop,

	output reg [       5:0] ula_op,

	output                  mem_wr,
	output                  req_in, out_en,
	output                  ldi, sti, fft
);

// ----------------------------------------------------------------------------
// decodificacao de instrucoes ------------------------------------------------
// ----------------------------------------------------------------------------

// implementa leitura/escrita na memoria --------------------------------------

wire    wLOD  ; generate if (   LOD  ) assign    wLOD   = opcode == 7'd00; else assign    wLOD   = 1'b0; endgenerate
wire  wP_LOD  ; generate if ( P_LOD  ) assign  wP_LOD   = opcode == 7'd01; else assign  wP_LOD   = 1'b0; endgenerate

wire    wLDI  ; generate if (   LDI  ) assign    wLDI   = opcode == 7'd02; else assign    wLDI   = 1'b0; endgenerate
wire    wILI  ; generate if (   ILI  ) assign    wILI   = opcode == 7'd03; else assign    wILI   = 1'b0; endgenerate

wire    wSET  ; generate if (   SET  ) assign    wSET   = opcode == 7'd04; else assign    wSET   = 1'b0; endgenerate
wire    wSET_P; generate if (   SET_P) assign    wSET_P = opcode == 7'd05; else assign    wSET_P = 1'b0; endgenerate

wire    wSTI  ; generate if (   STI  ) assign    wSTI   = opcode == 7'd06; else assign    wSTI   = 1'b0; endgenerate
wire    wISI  ; generate if (   ISI  ) assign    wISI   = opcode == 7'd07; else assign    wISI   = 1'b0; endgenerate

// implementa interface com a pilha de dados ----------------------------------

wire    wPSH  ; generate if (   PSH  ) assign    wPSH   = opcode == 7'd08; else assign    wPSH   = 1'b0; endgenerate
wire    wPOP  ; generate if (   POP  ) assign    wPOP   = opcode == 7'd09; else assign    wPOP   = 1'b0; endgenerate

// implementa portas de I/O ---------------------------------------------------

wire    wINN  ; generate if (   INN  ) assign    wINN   = opcode == 7'd10; else assign    wINN   = 1'b0; endgenerate
wire  wF_INN  ; generate if ( F_INN  ) assign  wF_INN   = opcode == 7'd11; else assign  wF_INN   = 1'b0; endgenerate
wire  wP_INN  ; generate if ( P_INN  ) assign  wP_INN   = opcode == 7'd12; else assign  wP_INN   = 1'b0; endgenerate
wire wPF_INN  ; generate if (PF_INN  ) assign wPF_INN   = opcode == 7'd13; else assign wPF_INN   = 1'b0; endgenerate

wire    wOUT  ; generate if (   OUT  ) assign    wOUT   = opcode == 7'd14; else assign    wOUT   = 1'b0; endgenerate

// operacoes aritmeticas de dois parametros -----------------------------------

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

// operacoes aritmeticas de um parametro --------------------------------------

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

// operacoes logicas de dois parametros ---------------------------------------

wire    wAND  ; generate if (   AND  ) assign    wAND   = opcode == 7'd64; else assign    wAND   = 1'b0; endgenerate
wire  wS_AND  ; generate if ( S_AND  ) assign  wS_AND   = opcode == 7'd65; else assign  wS_AND   = 1'b0; endgenerate

wire    wORR  ; generate if (   ORR  ) assign    wORR   = opcode == 7'd66; else assign    wORR   = 1'b0; endgenerate
wire  wS_ORR  ; generate if ( S_ORR  ) assign  wS_ORR   = opcode == 7'd67; else assign  wS_ORR   = 1'b0; endgenerate

wire    wXOR  ; generate if (   XOR  ) assign    wXOR   = opcode == 7'd68; else assign    wXOR   = 1'b0; endgenerate
wire  wS_XOR  ; generate if ( S_XOR  ) assign  wS_XOR   = opcode == 7'd69; else assign  wS_XOR   = 1'b0; endgenerate

// operacoes logicas de um parametro ------------------------------------------

wire    wINV  ; generate if (   INV  ) assign    wINV   = opcode == 7'd70; else assign    wINV   = 1'b0; endgenerate
wire    wINV_M; generate if (   INV_M) assign    wINV_M = opcode == 7'd71; else assign    wINV_M = 1'b0; endgenerate
wire  wP_INV_M; generate if ( P_INV_M) assign  wP_INV_M = opcode == 7'd72; else assign  wP_INV_M = 1'b0; endgenerate

// operacoes condicionais de dois parametros ----------------------------------

wire    wLAN  ; generate if (   LAN  ) assign    wLAN   = opcode == 7'd73; else assign    wLAN   = 1'b0; endgenerate
wire  wS_LAN  ; generate if ( S_LAN  ) assign  wS_LAN   = opcode == 7'd74; else assign  wS_LAN   = 1'b0; endgenerate

wire    wLOR  ; generate if (   LOR  ) assign    wLOR   = opcode == 7'd75; else assign    wLOR   = 1'b0; endgenerate
wire  wS_LOR  ; generate if ( S_LOR  ) assign  wS_LOR   = opcode == 7'd76; else assign  wS_LOR   = 1'b0; endgenerate

// operacoes condicionais de um parametro -------------------------------------

wire    wLIN  ; generate if (   LIN  ) assign    wLIN   = opcode == 7'd77; else assign    wLIN   = 1'b0; endgenerate
wire    wLIN_M; generate if (   LIN_M) assign    wLIN_M = opcode == 7'd78; else assign    wLIN_M = 1'b0; endgenerate
wire  wP_LIN_M; generate if ( P_LIN_M) assign  wP_LIN_M = opcode == 7'd79; else assign  wP_LIN_M = 1'b0; endgenerate

// operacoes de comparacao ----------------------------------------------------

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

// operacoes de deslocamento de bits ------------------------------------------

wire    wSHL  ; generate if (   SHL  ) assign    wSHL   = opcode == 7'd90; else assign    wSHL   = 1'b0; endgenerate
wire  wS_SHL  ; generate if ( S_SHL  ) assign  wS_SHL   = opcode == 7'd91; else assign  wS_SHL   = 1'b0; endgenerate

wire    wSHR  ; generate if (   SHR  ) assign    wSHR   = opcode == 7'd92; else assign    wSHR   = 1'b0; endgenerate
wire  wS_SHR  ; generate if ( S_SHR  ) assign  wS_SHR   = opcode == 7'd93; else assign  wS_SHR   = 1'b0; endgenerate

wire    wSRS  ; generate if (   SRS  ) assign    wSRS   = opcode == 7'd94; else assign    wSRS   = 1'b0; endgenerate
wire  wS_SRS  ; generate if ( S_SRS  ) assign  wS_SRS   = opcode == 7'd95; else assign  wS_SRS   = 1'b0; endgenerate

// operacoes especiais (pula o NOP) -------------------------------------------

wire  wF_ROT  ; generate if ( F_ROT  ) assign  wF_ROT   = opcode == 7'd97; else assign   wF_ROT  = 1'b0; endgenerate

// ----------------------------------------------------------------------------
// circuitos de controle ------------------------------------------------------
// ----------------------------------------------------------------------------

// circuito de controle de entrada de dados -----------------------------------

generate if (INN | F_INN | P_INN | PF_INN) assign req_in = wINN | wF_INN | wP_INN | wPF_INN; else assign req_in = 1'b0; endgenerate

// circuito de controle de saida de dados -------------------------------------

generate if (OUT) assign out_en = wOUT; else assign out_en = 1'b0; endgenerate

// circuitos de controle de enderecamento indireto ----------------------------

generate if (LDI | ILI) assign ldi = wLDI |  wILI; else assign ldi = 1'b0; endgenerate
generate if (STI | ISI) assign sti = wSTI |  wISI; else assign sti = 1'b0; endgenerate
generate if (ILI | ISI) assign fft = wILI |  wISI; else assign fft = 1'b0; endgenerate

// circuito de controle de escrita na memoria ---------------------------------

generate if (SET | SET_P | STI | ISI) assign mem_wr = wSET | wSET_P | wSTI | wISI; else assign mem_wr = 1'b0; endgenerate

// circuito de controle de escrita na pilha de dados --------------------------

generate
if (                P_LOD   |     PSH   |  P_INN   |  PF_INN   |  P_NEG_M |  PF_NEG_M |  P_ABS_M |  PF_ABS_M |
                    P_PST_M |  PF_PST_M |  P_NRM_M |   P_I2F_M |  P_F2I_M |   P_INV_M |  P_LIN_M )
     assign push = wP_LOD   |    wPSH   | wP_INN   | wPF_INN   | wP_NEG_M | wPF_NEG_M | wP_ABS_M | wPF_ABS_M |
	               wP_PST_M | wPF_PST_M | wP_NRM_M |  wP_I2F_M | wP_F2I_M |  wP_INV_M | wP_LIN_M ;
else assign push = 1'b0;
endgenerate

// circuito de controle de leitura da pilha de dados --------------------------

generate
if (               SET_P |    STI |     ISI |    POP |  S_ADD |  SF_ADD |  S_MLT |
                SF_MLT   |  S_DIV |  SF_DIV |  S_MOD |  S_SGN |  SF_SGN |  S_AND |
				 S_ORR   |  S_XOR |   S_LAN |  S_LOR |  S_LES |  SF_LES |  S_GRE |
				SF_GRE   |  S_EQU |   S_SHL |  S_SHR |  S_SRS )
     assign pop = wSET_P |   wSTI |    wISI |   wPOP | wS_ADD | wSF_ADD | wS_MLT |
	           wSF_MLT   | wS_DIV | wSF_DIV | wS_MOD | wS_SGN | wSF_SGN | wS_AND |
				wS_ORR   | wS_XOR |  wS_LAN | wS_LOR | wS_LES | wSF_LES | wS_GRE |
			   wSF_GRE   | wS_EQU |  wS_SHL | wS_SHR | wS_SRS ;
else assign pop = 1'b0   ;
endgenerate

// circuito de controle de operacoes da ULA -----------------------------------

wire b5,b4,b3,b2,b1,b0;

// logica pra b5
generate
if (              INV |    INV_M |  P_INV_M |     LAN |  S_LAN |    LOR |  S_LOR |     LIN |  LIN_M |  P_LIN_M |
                  LES |  S_LES   |  F_LES   |  SF_LES |    GRE |  S_GRE |  F_GRE |  SF_GRE |  EQU   |  S_EQU   |
                  SHL |  S_SHL   |    SHR   |   S_SHR |    SRS |  S_SRS |  F_ROT)

     assign b5 = wINV |   wINV_M | wP_INV_M |    wLAN | wS_LAN |   wLOR | wS_LOR |    wLIN | wLIN_M | wP_LIN_M |
                 wLES | wS_LES   | wF_LES   | wSF_LES |   wGRE | wS_GRE | wF_GRE | wSF_GRE | wEQU   | wS_EQU   |
                 wSHL | wS_SHL   |   wSHR   |  wS_SHR |   wSRS | wS_SRS | wF_ROT ;
else assign b5 = 1'b0 ;
endgenerate

// logica pra b4
generate
if (            F_INN   |  PF_INN  | 
                  ABS_M |  P_ABS_M |  F_ABS |  F_ABS_M |  PF_ABS_M |
                  PST   |    PST_M |  P_PST_M |  F_PST |  F_PST_M |  PF_PST_M |
                  NRM   |    NRM_M |  P_NRM_M |
                  I2F   |    I2F_M |  P_I2F_M |    F2I |    F2I_M |   P_F2I_M |
                  AND   |  S_AND   |    ORR   |  S_ORR |    XOR   |   S_XOR   )

     assign b4 = wF_INN   | wPF_INN  | 
                   wABS_M | wP_ABS_M | wF_ABS   | wF_ABS_M | wPF_ABS_M |
                   wPST   |   wPST_M | wP_PST_M | wF_PST   |  wF_PST_M | wPF_PST_M |
                   wNRM   |   wNRM_M | wP_NRM_M |
                   wI2F   |   wI2F_M | wP_I2F_M |   wF2I   |    wF2I_M |  wP_F2I_M |
                   wAND   | wS_AND   |   wORR   | wS_ORR   |    wXOR   |  wS_XOR   ;
else assign b4 = 1'b0 ;
endgenerate

// logica pra b3
generate
if               (F_INN | PF_INN    |
                    MOD |  S_MOD    |   SGN    |   S_SGN |  F_SGN   |  SF_SGN   |
                    NEG |    NEG_M  |  P_NEG_M |   F_NEG |  F_NEG_M |  PF_NEG_M |
                    ABS |    NRM_M  |  P_NRM_M |
                    I2F |    I2F_M  |  P_I2F_M |     F2I |    F2I_M |   P_F2I_M |
                    AND |  S_AND    |    ORR   |   S_ORR |    XOR   |   S_XOR   |
                    GRE |  S_GRE    |  F_GRE   |  SF_GRE |    EQU   |   S_EQU   |
                    SHL |  S_SHL    |    SHR   |   S_SHR |    SRS   |   S_SRS   |   F_ROT)

     assign b3 = wF_INN | wPF_INN   | 
                   wMOD |  wS_MOD   |   wSGN   |  wS_SGN | wF_SGN   | wSF_SGN   |
                   wNEG |    wNEG_M | wP_NEG_M |  wF_NEG | wF_NEG_M | wPF_NEG_M |
                   wABS |    wNRM_M | wP_NRM_M |
                   wI2F |    wI2F_M | wP_I2F_M |    wF2I |   wF2I_M |  wP_F2I_M |
                   wAND |  wS_AND   |   wORR   |  wS_ORR |   wXOR   |  wS_XOR   |
                   wGRE |  wS_GRE   | wF_GRE   | wSF_GRE |   wEQU   |  wS_EQU   |
                   wSHL |  wS_SHL   |   wSHR   |  wS_SHR |   wSRS   |  wS_SRS   |  wF_ROT;
else assign b3 = 1'b0 ;
endgenerate

// logica pra b2
generate
if (              MLT   | S_MLT    |  F_MLT   |  SF_MLT   |
                  DIV   | S_DIV    |  F_DIV   |  SF_DIV   |
                  NEG_M | P_NEG_M  |  F_NEG   |   F_NEG_M |  PF_NEG_M |   ABS |
                  PST_M | P_PST_M  |  F_PST   |   F_PST_M |  PF_PST_M |   NRM |
                  F2I_M | P_F2I_M  |
                  AND   | S_AND    |    ORR   |   S_ORR   |     XOR   | S_XOR |
                  LIN   |   LIN_M  |  P_LIN_M |     LES   |   S_LES   | F_LES |   SF_LES |
                  SHR   | S_SHR    |    SRS   |   S_SRS   |   F_ROT   )

     assign b2 = wMLT   | wS_MLT   | wF_MLT   | wSF_MLT   |
                 wDIV   | wS_DIV   | wF_DIV   | wSF_DIV   |
                 wNEG_M | wP_NEG_M | wF_NEG   |  wF_NEG_M | wPF_NEG_M |   wABS |
                 wPST_M | wP_PST_M | wF_PST   |  wF_PST_M | wPF_PST_M |   wNRM |
                 wF2I_M | wP_F2I_M |
                 wAND   | wS_AND   |   wORR   |  wS_ORR   |    wXOR   | wS_XOR |
                 wLIN   |   wLIN_M | wP_LIN_M |    wLES   |  wS_LES   | wF_LES | wSF_LES |
                 wSHR   | wS_SHR   |   wSRS   |  wS_SRS   |  wF_ROT   ;
else assign b2 = 1'b0 ;
endgenerate

// logica pra b1
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
                  EQU |  S_EQU   |     SHL   |   S_SHL   | F_ROT)

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
                 wEQU | wS_EQU   |    wSHL   |  wS_SHL   | wF_ROT;
else assign b1 = 1'b0 ;
endgenerate

// logica pra b0
generate
if (              LOD |  P_LOD |  LDI   |    ILI   |    SET_P |     POP |  F_INN |  PF_INN |  F_ADD |  SF_ADD |  F_MLT |  SF_MLT |  F_DIV |   SF_DIV |    SGN   |  S_SGN |
                  NEG |  F_NEG |  ABS   |  F_ABS   |    PST   |   F_PST |    NRM |     I2F |    F2I |     AND |  S_AND |     XOR |  S_XOR |    INV_M |  P_INV_M |
                  LOR |  S_LOR |  LIN_M |  P_LIN_M |  F_LES   |  SF_LES |  F_GRE |  SF_GRE |    SHL |   S_SHL |    SRS |   S_SRS )

     assign b0 = wLOD | wP_LOD | wLDI   |   wILI   |   wSET_P |    wPOP | wF_INN | wPF_INN | wF_ADD | wSF_ADD | wF_MLT | wSF_MLT | wF_DIV | wSF_DIV  |   wSGN   | wS_SGN |
                 wNEG | wF_NEG | wABS   | wF_ABS   |   wPST   |  wF_PST |   wNRM |    wI2F |   wF2I |    wAND | wS_AND |    wXOR | wS_XOR |   wINV_M | wP_INV_M |
                 wLOR | wS_LOR | wLIN_M | wP_LIN_M | wF_LES   | wSF_LES | wF_GRE | wSF_GRE |   wSHL |  wS_SHL |   wSRS |  wS_SRS ;
else assign b0 = 1'b0 ;
endgenerate

// junta as logicas para ula_op
always @ (posedge clk) ula_op <= {b5,b4,b3,b2,b1,b0};

endmodule

//  Tabela que gera o valor da ULA a partir do opcode
/* ---------------------------------------------------------------------------
    0 : ula_op  <= 6'd1;     //    LOD   -> carrega accumulador com dado da memoria
    1 : ula_op  <= 6'd1;     //  P_LOD   -> PSH e LOD
    2 : ula_op  <= 6'd1;     //    LDI   -> Load com enderecamentto indireto
    3 : ula_op  <= 6'd1;     //    ILI   -> Load com enderecamento indireto invertido
    4 : ula_op  <= 6'd0;     //    SET   -> carrega memoria com valor do acumulador
    6 : ula_op  <= 6'd0;     //    STI   -> Set com enderecamento indireto
    7 : ula_op  <= 6'd0;     //    ISI   -> STI com bits invertidos
    8 : ula_op  <= 6'd0;     //    PSH
    9 : ula_op  <= 6'd1;     //    POP
    10: ula_op  <= 6'd0;     //    INN   -> Input de dados
    11: ula_op  <= 6'd25;    //  F_INN   -> Input de dados em ponto flutuante (fazendo I2F)
    12: ula_op  <= 6'd0;     //  P_INN   -> PUSH + INN
    13: ula_op  <= 6'd25;    // PF_INN   -> PUSH + F_INN
    14: ula_op  <= 6'd0;     //    OUT   -> Output de Dados
    15: ula_op  <= 6'd0;     //    JMP (ver prefetch)
    16: ula_op  <= 6'd0;     //    JIZ (ver prefetch)
    17: ula_op  <= 6'd0;     //    CAL (ver prefetch)
    18: ula_op  <= 6'd0;     //    RET
    19: ula_op  <= 6'd2;     //    ADD   -> adicao com a memoria
    20: ula_op  <= 6'd2;     //  S_ADD   -> adicao com a pilha
    21: ula_op  <= 6'd3;     //  F_ADD   -> adicao em ponto flutuante com a memoria
    22: ula_op  <= 6'd3;     // SF_ADD   -> adicao em ponto flutuante com pilha
    23: ula_op  <= 6'd4;     //    MLT   -> multiplica dado da memoria com o acumulador
    24: ula_op  <= 6'd4;     //  S_MLT   -> multiplicacao com a pilha
    25: ula_op  <= 6'd5;     //  F_MLT   -> multiplicacao em ponto flutuante com a memoria
    26: ula_op  <= 6'd5;     // SF_MLT   -> multiplicacao em ponto flutuante com pilha
    27: ula_op  <= 6'd6;     //    DIV   -> divide com memoria
    28: ula_op  <= 6'd6;     //  S_DIV   -> divide com pilha
    29: ula_op  <= 6'd7;     //  F_DIV   -> divisao em ponto flutuante com a memoria
    30: ula_op  <= 6'd7;     // SF_DIV   -> divisao em ponto flutuante com pilha
    31: ula_op  <= 6'd8;     //    MOD   -> modulo da divisao com memoria
    32: ula_op  <= 6'd8;     //  S_MOD   -> modulo da divisao com pilha
    33: ula_op  <= 6'd9;     //    SGN   -> pega o sinal de in1 e coloca en in2
    34: ula_op  <= 6'd9;     //  S_SGN   -> SGN com pilha
    35: ula_op  <= 6'd10;    //  F_SGN   -> SGN em ponto flutuante com a memoria
    36: ula_op  <= 6'd10;    // SF_SGN   -> SGN em ponto flutuante com pilha
    37: ula_op  <= 6'd11;    //    NEG   -> Complemento a 2
    38: ula_op  <= 6'd12;    //    NEG_M -> negativo com memoria
    39: ula_op  <= 6'd12;    //  P_NEG_M -> negativo com memoria dando push antes
    40: ula_op  <= 6'd13;    //  F_NEG   -> negativo em ponto flutuante com acc
    41: ula_op  <= 6'd14;    //  F_NEG_M -> negativo em ponto flutuante com memoria
    42: ula_op  <= 6'd14;    // PF_NEG_M -> negativo em ponto flutuante com memoria dando um push antes
    43: ula_op  <= 6'd15;    //    ABS   -> retorna o valor absoluto do acc (exemplo: x = abs(y))
    44: ula_op  <= 6'd16;    //    ABS_M -> ABS com memoria
    45: ula_op  <= 6'd16;    //  P_ABS_M -> ABS com memoria dando push antes
    46: ula_op  <= 6'd17;    //  F_ABS   -> ABS em ponto flutuante
    47: ula_op  <= 6'd18;    //  F_ABS_M -> ABS em ponto flutuante com memoria
    48: ula_op  <= 6'd18;    // PF_ABS_M -> ABS em ponto flutuante com memoria dando push antes
    49: ula_op  <= 6'd19;    //    PST   -> carrega o valor do acumulador ou zero se for negativo
    50: ula_op  <= 6'd20;    //    PST_M -> PST com memoria
    51: ula_op  <= 6'd20;    //  P_PST_M -> PST com memoria dando push antes
    52: ula_op  <= 6'd21;    //  F_PST   -> PST em ponto flutuante
    53: ula_op  <= 6'd22;    //  F_PST_M -> PST em ponto flutuante com memoria
    54: ula_op  <= 6'd22;    // PF_PST_M -> PST em ponto flutuante com memoria dando push antes
    55: ula_op  <= 6'd23;    //    NRM   -> Divisao do acc por uma constante (exemplo: />300)
    56: ula_op  <= 6'd24;    //    NRM_M -> NRM com memoria
    57: ula_op  <= 6'd24;    //  P_NRM_M -> NRM com memoria dando push antes
    58: ula_op  <= 6'd25;    //    I2F   -> int2float com acumulador
    59: ula_op  <= 6'd26;    //    I2F_M -> int2float com memoria
    60: ula_op  <= 6'd26;    //  P_I2F_M -> int2float com memoria, dando um push antes
    61: ula_op  <= 6'd27;    //    F2I   -> float2int com acumulador
    62: ula_op  <= 6'd28;    //    F2I_M -> float2int com memoria
    63: ula_op  <= 6'd28;    //  P_F2I_M -> float2int com memoria, dando um push antes
    64: ula_op  <= 6'd29;    //    AND   -> and bit a bit com memoria
    65: ula_op  <= 6'd29;    //  S_AND   -> and bit a bit com pilha
    66: ula_op  <= 6'd30;    //    ORR   -> ou bit a bit com memoria
    67: ula_op  <= 6'd30;    //  S_ORR   -> ou bit a bit com pilha
    68: ula_op  <= 6'd31;    //    XOR   -> ou exclusivo bit a bit com memoria
    69: ula_op  <= 6'd31;    //  S_XOR   -> ou exclusivo bit a bit com pilha
    70: ula_op  <= 6'd32;    //    INV   -> Inverte bit a bit o acumulador
    71: ula_op  <= 6'd33;    //    INV_M -> INV com memoria
    72: ula_op  <= 6'd33;    //  P_INV_M -> INV com memoria dando push antes
    73: ula_op  <= 6'd34;    //    LAN   -> and logico com memoria
    74: ula_op  <= 6'd34;    //  S_LAN   -> and logico com pilha
    75: ula_op  <= 6'd35;    //    LOR   -> ou logico com memoria
    76: ula_op  <= 6'd35;    //  S_LOR   -> ou logico com pilha
    77: ula_op  <= 6'd36;    //    LIN   -> Inverte bit condicional
    78: ula_op  <= 6'd37;    //    LIN_M -> LIN com memoria
    79: ula_op  <= 6'd37;    //  P_LIN_M -> LIN com memoria dando push antes
    80: ula_op  <= 6'd38;    //    LES   -> Menor do que com memoria
    81: ula_op  <= 6'd38;    //  S_LES   -> Menor do que com a pilha
    82: ula_op  <= 6'd39;    //  F_LES   -> menor que em ponto flutuante com a memoria
    83: ula_op  <= 6'd39;    // SF_LES   -> menor que em ponto flutuante com pilha
    84: ula_op  <= 6'd40;    //    GRE   -> maior do que com memoria
    85: ula_op  <= 6'd40;    //  S_GRE   -> maior do que com pilha
    86: ula_op  <= 6'd41;    //  F_GRE   -> maior que em ponto flutuante com a memoria
    87: ula_op  <= 6'd41;    // SF_GRE   -> maior que em ponto flutuante com pilha
    88: ula_op  <= 6'd42;    //    EQU   -> Igual com memoria
    89: ula_op  <= 6'd42;    //  S_EQU   -> Igual com a pilha
    90: ula_op  <= 6'd43;    //    SHL   -> shift pra esquerda com memoria
    91: ula_op  <= 6'd43;    //  S_SHL   -> shift pra esquerda com pilha
    92: ula_op  <= 6'd44;    //    SHR   -> Shift pra direita com memoria
    93: ula_op  <= 6'd44;    //  S_SHR   -> Shift pra direita com pilha
    94: ula_op  <= 6'd45;    //    SRS   -> Shift pra direita com sinal usando a memoria
    95: ula_op  <= 6'd45;    //  S_SRS   -> Shift pra direita com sinal usando a pilha
    96: ula_op  <= 6'dx;     //    NOP   -> No Operation
    97: ula_op  <= 6'd46;    //  F_ROT   -> Raiz quadrada em ponto flutuante
    ------------------------------------------------*/