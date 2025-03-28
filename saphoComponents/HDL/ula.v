// ****************************************************************************
// Multiplexador principal ****************************************************
// ****************************************************************************

// seleciona qual operacao passa para a saida ---------------------------------

module ula_mux
#(
	 parameter NUBITS = 32
 )
(
	 // indexador da operacao
	 input     [       5:0] op  ,
	 // sai uma das entradas (in1 -> pega da memoria, in2 -> pega do acumulador)
	 input     [NUBITS-1:0] in1 , in2,
	 // operacoes aritmeticas de dois parametros
	 input     [NUBITS-1:0] add , fadd,
	 input     [NUBITS-1:0] mlt , fmlt,
	 input     [NUBITS-1:0] div , fdiv,
	 input     [NUBITS-1:0] mod ,                    // soh pra int
	 input     [NUBITS-1:0] sgn , fsgn,
	 // operacoes aritmeticas de um parametro
	 input     [NUBITS-1:0] neg , negm, fneg, fnegm,
	 input     [NUBITS-1:0] abs , absm, fabs, fabsm,
	 input     [NUBITS-1:0] pst , pstm, fpst, fpstm,
	 input     [NUBITS-1:0] nrm , nrmm,              // soh pra int
	 input     [NUBITS-1:0] i2f , i2fm,
	 input     [NUBITS-1:0] f2i , f2im,
	 // operacoes logicas de dois parametros
	 input     [NUBITS-1:0] ann , orr , cor ,        // and, or, xor
	 // operacoes logicas de um parametro
	 input     [NUBITS-1:0] inv , invm,              // not
	 // operacoes condicionais de dois parametros
	 input     [NUBITS-1:0] lan , lor ,              // soh pra int
	 // operacoes condicionais de um parametro
	 input     [NUBITS-1:0] lin , linm,              // soh pra int
	 // operacoes de comparacao
	 input     [NUBITS-1:0] les , fles,
	 input     [NUBITS-1:0] gre , fgre,
	 input     [NUBITS-1:0] equ ,                    // serve pra int e float
	 // operacoes de deslocamento de bits
	 input     [NUBITS-1:0] shl , shr , srs ,        // <<, >> e >>>
	 // saida
	output reg [NUBITS-1:0] out
);

always @ (*) case (op)
	6'd0   : out <=   in2 ;   //   NOP
	6'd1   : out <=   in1 ;   //   LOD

	6'd2   : out <=   add ;   //   ADD
	6'd3   : out <=  fadd ;   // F_ADD

	6'd4   : out <=   mlt ;   //   MLT
	6'd5   : out <=  fmlt ;   // F_MLT

	6'd6   : out <=   div ;   //   DIV
	6'd7   : out <=  fdiv ;   // F_DIV

	6'd8   : out <=   mod ;   //   MOD

	6'd9   : out <=   sgn ;   //   SGN
	6'd10  : out <=  fsgn ;   // F_SGN

	6'd11  : out <=   neg ;   //   NEG
	6'd12  : out <=   negm;   //   NEG_M
	6'd13  : out <=  fneg ;   // F_NEG
	6'd14  : out <=  fnegm;   // F_NEG_M

	6'd15  : out <=   abs ;   //   ABS
	6'd16  : out <=   absm;   //   ABS_M
	6'd17  : out <=  fabs ;   // F_ABS
	6'd18  : out <=  fabsm;   // F_ABS_M

	6'd19  : out <=   pst ;   //   PST
	6'd20  : out <=   pstm;   //   PST_M
	6'd21  : out <=  fpst ;   // F_PST
	6'd22  : out <=  fpstm;   // F_PST_M

	6'd23  : out <=   nrm ;   //   NRM
	6'd24  : out <=   nrmm;   //   NRM_M

	6'd25  : out <=   i2f ;   //   I2F
	6'd26  : out <=   i2fm;   //   I2F_M

	6'd27  : out <=   f2i ;   //   F2I
	6'd28  : out <=   f2im;   //   F2I_M

	6'd29  : out <=   ann ;   //   AND
	6'd30  : out <=   orr ;   //   ORR
	6'd31  : out <=   cor ;   //   XOR

	6'd32  : out <=   inv ;   //   INV
	6'd33  : out <=   invm;   //   INV_M

	6'd34  : out <=   lan ;   //   LAN
	6'd35  : out <=   lor ;   //   LOR

	6'd36  : out <=   lin ;   //   LIN
	6'd37  : out <=   linm;   //   LIN_M

	6'd38  : out <=   les ;   //   LES
	6'd39  : out <=  fles ;   // F_LES

	6'd40  : out <=   gre ;   //   GRE
	6'd41  : out <=  fgre ;   // F_GRE

	6'd42  : out <=   equ ;   //   EQU

	6'd43  : out <=   shl ;   //   SHL
	6'd44  : out <=   shr ;   //   SHR
	6'd45  : out <=   srs ;   //   SRS

	default: out <= {NUBITS{1'bx}};
endcase

endmodule

// ****************************************************************************
// Circuitos auxiliares para operacoes em ponto flutuante *********************
// ****************************************************************************

// iguala o expoente de dois numeros -----------------------------------------
// pra algumas operacoes que pedem mant. na mesma ordem de grandeza. ex: F_ADD

module ula_denorm
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input        [MAN+EXP:0] in1, in2,
	output signed [EXP-1  :0] e_out,
	output signed [MAN    :0] sm1_out, sm2_out
);

wire                  s1_in = in1[MAN+EXP      ]; 
wire                  s2_in = in2[MAN+EXP      ]; 
wire signed [EXP-1:0] e1_in = in1[MAN+EXP-1:MAN];
wire signed [EXP-1:0] e2_in = in2[MAN+EXP-1:MAN];
wire        [MAN-1:0] m1_in = in1[MAN    -1:0  ];
wire        [MAN-1:0] m2_in = in2[MAN    -1:0  ];

wire signed [EXP:0] eme    =  e1_in-e2_in;
wire                ege    =  eme[EXP];
wire        [EXP:0] shift2 = (ege) ?  {EXP+1{1'b0}} : eme;
wire        [EXP:0] shift1 = (ege) ? -eme : {EXP+1{1'b0}};

assign e_out = (ege) ? e2_in : e1_in;

wire [MAN-1:0] m1_out = m1_in >> shift1;
wire [MAN-1:0] m2_out = m2_in >> shift2;

assign sm1_out = (s1_in) ? -m1_out : m1_out;
assign sm2_out = (s2_in) ? -m2_out : m2_out;

endmodule

// multiplexador do modulo de normalizacao ------------------------------------
// auxilia no circuito de normalizaca de um num. em ponto flutuante -----------

module ula_nmux
#(
	parameter NCOMP = 2,
	parameter NBITS = 8
)
(
	input  [NCOMP-1:0]   A,   B,
	input  [NBITS-1:0] in1, in2,
	output [NBITS-1:0] out
);

assign out = (A==B) ? in1 : in2;

endmodule

// normalizacao de um numero em ponto flutuante -------------------------------
// shift pra esquerda ate o bit mais significativo da mantissa ser 1 ----------

module ula_norm
#(
	parameter MAN = 23,
    parameter EXP = 8
)
(
     input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                    sig = in[MAN+EXP      ];
wire signed [EXP-1  :0] exp = in[MAN+EXP-1:MAN];
wire        [MAN-1  :0] man = in[MAN    -1:  0];

wire [EXP-1:0] w [MAN-1:0];

wire        [EXP-1:0] sh    =  w[MAN-2];
wire                  out_s =  sig;
wire signed [EXP-1:0] out_e = (man == {MAN{1'b0}}) ? {1'b1, {EXP-1{1'b0}}} : exp - sh;
wire        [MAN-1:0] out_m =  man << sh; // verificar se <<< eh melhor e quando

ula_nmux #(1, EXP) mm1 (man[MAN-1], 1'b0, {{EXP-1{1'b0}}, {1'b1}}, {EXP{1'b0}}, w[0]);

genvar i;

generate
	for (i = 1; i < MAN-1; i = i+1) begin : norm
		ula_nmux #(i+1, EXP) mm (man[MAN-1:MAN-1-i], {i+1{1'b0}}, i[EXP-1:0] + {{EXP-1{1'b0}}, {1'b1}}, w[i-1], w[i]);
	end
endgenerate

assign out = {out_s, out_e, out_m};

endmodule

// circuito de saida ----------------------------------------------------------
// seleciona se sai valor padrao ou se tem que fazer a normalizacao float -----

module ula_out
#(
	parameter NUBITS = 32,
	parameter NBMANT = 23,
	parameter NBEXPO =  8
)
(
	 input [       5:0] op,
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out
);

wire [NUBITS-1:0] fn_out;

ula_norm #(NBMANT,NBEXPO) ula_norm(in, fn_out);

//             I2F              I2F_M            F_ADD           F_MLT           F_DIV
assign out = ((op == 6'd25) || (op == 6'd26) || (op == 6'd3) || (op == 6'd5) || (op == 6'd7)) ? fn_out : in;

endmodule

// ****************************************************************************
// Operacoes aritmeticas de dois parametros ***********************************
// ****************************************************************************

// ADD - soma em ponto-fixo ---------------------------------------------------

module ula_add
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 + in2;

endmodule

// F_ADD - soma em ponto-flutuante --------------------------------------------

module ula_fadd
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	input  signed [EXP-1  :0] e_in,
	input  signed [MAN    :0] sm1_in, sm2_in,
	output        [MAN+EXP:0] out
);

wire signed [MAN+1:0] soma = sm1_in + sm2_in;
wire signed [MAN+1:0] m    = (soma[MAN+1]) ? -soma : soma;

wire                  s_out = soma[MAN+1];
wire signed [EXP-1:0] e_out = e_in + {{EXP-1{1'b0}}, {1'b1}}; // colocar limite para +inf?
wire        [MAN-1:0] m_out = m   [MAN:1];

assign out = {s_out, e_out, m_out};

endmodule

// MLT - multiplicacao em ponto-fixo ------------------------------------------

module ula_mlt
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 * in2;

endmodule

// F_MLT - multiplicacao em ponto-flutuante -----------------------------------

module ula_fmlt
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in1, in2,
	output [MAN+EXP:0] out
);

wire                  s1 = in1[MAN+EXP      ]; 
wire                  s2 = in2[MAN+EXP      ]; 
wire signed [EXP-1:0] e1 = in1[MAN+EXP-1:MAN];
wire signed [EXP-1:0] e2 = in2[MAN+EXP-1:MAN];
wire        [MAN-1:0] m1 = in1[MAN    -1:0  ];
wire        [MAN-1:0] m2 = in2[MAN    -1:0  ];

wire        [2*MAN-1:0] mult = m1 * m2;
wire signed [  EXP  :0] e    = e1 + e2 + MAN; // colocar limite para +inf

wire                  s_out = (s1 != s2);
wire                  unf   = (e[EXP:EXP-1] == 2'b10);       // underflow
wire signed [EXP-1:0] e_out =  e[EXP-1:  0];
wire        [MAN-1:0] m_out = (unf) ? {{MAN{1'b0}}} : mult[2*MAN-1:MAN];

assign out = {s_out, e_out, m_out};

endmodule

// DIV - divisao em ponto-fixo ------------------------------------------------

module ula_div
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 / in2;

endmodule

// F_DIV - divisao em ponto-flutuante -----------------------------------------

module ula_fdiv
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in1, in2,
	output [MAN+EXP:0] out
);

wire                  s1 = in1[MAN+EXP      ]; 
wire                  s2 = in2[MAN+EXP      ]; 
wire signed [EXP-1:0] e1 = in1[MAN+EXP-1:MAN];
wire signed [EXP-1:0] e2 = in2[MAN+EXP-1:MAN];
wire        [MAN-1:0] m1 = in1[MAN    -1:0  ];
wire        [MAN-1:0] m2 = in2[MAN    -1:0  ];

wire [2*MAN-2:0] m1_ext = {m1, {MAN-1{1'b0}}};
wire [2*MAN-2:0] div    =  m1_ext / m2;

wire                  s_out = (s1 != s2);
wire signed [EXP-1:0] e_out = e1 - e2 - MAN + {{EXP-1{1'b0}}, {1'b1}};
wire        [MAN-1:0] m_out = div[MAN-1:0];

assign out = {s_out, e_out, m_out};

endmodule

// MOD - resto da divisao -----------------------------------------------------

module ula_mod
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 % in2;

endmodule

// SGN - pega sinal do primeiro argumento -------------------------------------

module ula_sgn
#(
	parameter NUBITS = 32
)
(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out 
);

assign out =  (in1[NUBITS-1] == in2[NUBITS-1]) ? in2 : -in2;

endmodule

// F_SGN - pega sinal do primeiro argumento em float --------------------------

module ula_fsgn
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in1, in2,
	output [MAN+EXP:0] out 
);

wire                  s_out = in1[EXP+MAN];
wire signed [EXP-1:0] e_out = in2[EXP+MAN-1:MAN];
wire        [MAN-1:0] m_out = in2[MAN    -1:  0];

assign out = {s_out, e_out, m_out};

endmodule

// ****************************************************************************
// Operacoes aritmeticas de um parametro **************************************
// ****************************************************************************

// NEG - negacao de um numero inteiro -----------------------------------------

module ula_neg
#(
	parameter NUBITS = 32
)
(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out 
);

assign out = -in;

endmodule

// F_NEG - negacao de um numero em ponto flutuante ----------------------------

module ula_fneg
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                  s_in = in[MAN+EXP      ]; 
wire signed [EXP-1:0] e_in = in[MAN+EXP-1:MAN];
wire        [MAN-1:0] m_in = in[MAN    -1:0  ];

wire                  s_out = ~s_in;
wire signed [EXP-1:0] e_out =  e_in;
wire        [MAN-1:0] m_out =  m_in;

assign out = {s_out, e_out, m_out};

endmodule

// ABS - modulo de um numero inteiro ------------------------------------------

module ula_abs
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

assign out = (in[NUBITS-1]) ? -in : in;

endmodule

// F_ABS - modulo de um numero em ponto flutuante -----------------------------

module ula_fabs
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                  s_out = 0;
wire signed [EXP-1:0] e_out = in[EXP+MAN-1:MAN];
wire        [MAN-1:0] m_out = in[MAN    -1:  0];

assign out = {s_out, e_out, m_out};

endmodule

// PST - zera se for negativo -------------------------------------------------

module ula_pst
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

assign out = (in[NUBITS-1]) ? {NUBITS{1'b0}} : in;

endmodule

// F_PST - zera se for negativo com float -------------------------------------

module ula_fpst
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

assign out = (in[MAN+EXP]) ? {1'b0, 1'b1, {MAN+EXP-1{1'b0}}} : in;

endmodule

// NRM - divisao por uma constante --------------------------------------------
// evita circuito de divisao generico -----------------------------------------

module ula_nrm
#(
	parameter        NUBITS = 32,
	parameter signed NUGAIN = 1
)
(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out 
);

assign out = in/NUGAIN;

endmodule

// I2F - converte int para float ----------------------------------------------

module ula_i2f
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	input         [MAN+EXP:0] in,
	output signed [MAN+EXP:0] out
);

wire                  i2f_s = in[MAN-1];
wire signed [EXP-1:0] i2f_e = 0;
wire        [MAN-1:0] i2f_m = (i2f_s) ? -in : in;

assign out = {i2f_s, i2f_e, i2f_m};

endmodule

// F2I - converte float para int ----------------------------------------------

module ula_f2i
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	input         [MAN+EXP:0] in,
	output signed [MAN+EXP:0] out
);

wire           s = in[MAN+EXP      ];
wire [EXP-1:0] e = in[MAN+EXP-1:MAN];
wire [MAN-1:0] m = in[MAN    -1:  0];

wire signed [MAN  :0] sm    = (s       ) ? -m : m;
wire        [EXP-1:0] shift = (e[EXP-1]) ? -e : e;
assign                out   = (e[EXP-1]) ? sm >>> shift : sm << shift; // ver se eh melhor usar <<<

endmodule

// ****************************************************************************
// Operacoes logicas de dois parametros ***************************************
// ****************************************************************************

// AND - and bit a bit (&) ----------------------------------------------------

module ula_and
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 & in2;

endmodule

// ORR - ou bit a bit (|) -----------------------------------------------------

module ula_or
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 | in2;

endmodule

// XOR - ou exclusivo bit a bit (^) -------------------------------------------

module ula_xor
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 ^ in2);

endmodule

// ****************************************************************************
// Operacoes logicas de um parametro ******************************************
// ****************************************************************************

// INV - inversao bit a bit (~) -----------------------------------------------

module ula_inv
#(
	parameter NUBITS = 32
)
(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out 
);

assign out = ~in;

endmodule

// ****************************************************************************
// Operacoes condicionais de dois parametros **********************************
// ****************************************************************************

// LAN - se uma das condicoes for zero -> sai zero (&&) -----------------------

module ula_lan
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = ((in1 == {NUBITS{1'b0}}) || (in2 == {NUBITS{1'b0}})) ? {NUBITS{1'b0}} : {{NUBITS-1{1'b0}}, 1'b1};

endmodule

// LOR - se uma das condicoes for um -> sai um (||) ---------------------------

module ula_lor
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = ((in1 == {NUBITS{1'b0}}) && (in2 == {NUBITS{1'b0}})) ? {NUBITS{1'b0}} : {{NUBITS-1{1'b0}}, 1'b1};

endmodule

// ****************************************************************************
// Operacoes condicionais de um parametro *************************************
// ****************************************************************************

// LIN - inverte a condicao ---------------------------------------------------

module ula_lin
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

assign out = (in == {NUBITS{1'b0}}) ? {{NUBITS-1{1'b0}}, 1'b1} : {NUBITS{1'b0}};

endmodule

// ****************************************************************************
// Operacoes de comparacao ****************************************************
// ****************************************************************************

// LES - menor que ------------------------------------------------------------

module ula_les
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 < in2);

endmodule

// GRE - maior que ------------------------------------------------------------

module ula_gre
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 > in2);

endmodule

// EQU - igual a --------------------------------------------------------------

module ula_equ
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 == in2);

endmodule

// ****************************************************************************
// Operacoes de deslocamento de bits ******************************************
// ****************************************************************************

// SHL - deslocamento pra esquerda --------------------------------------------

module ula_shl
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 << in2);

endmodule

// SHR - deslocamento pra direta ----------------------------------------------

module ula_shr
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 >> in2);

endmodule

// SRS - deslocamento aritmetico pra direta -----------------------------------

module ula_srs
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 >>> in2);

endmodule

// ****************************************************************************
// Circuito Principal *********************************************************
// ****************************************************************************

module ula
#(
	// Geral
	parameter                     NUBITS = 32,
	parameter                     NBMANT = 23,
	parameter                     NBEXPO =  8,
	parameter signed [NUBITS-1:0] NUGAIN = 64,

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
	input         [       5:0] op,
	input  signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

// circito de desnormalização de ponto flutuante ------------------------------

wire signed [NBEXPO-1:0] e_out;             // expoente  normalizado
wire signed [NBMANT  :0] sm1_out, sm2_out;  // mantissas normalizadas

generate if (F_ADD || F_GRE || F_LES) ula_denorm #(NBMANT,NBEXPO) denorm(in1, in2, e_out, sm1_out, sm2_out); endgenerate

// ADD ------------------------------------------------------------------------

wire signed [NUBITS-1:0] add;

generate if (ADD) ula_add #(NUBITS) my_add(in1, in2, add); else assign add = {NUBITS{1'bx}}; endgenerate

// F_ADD ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fadd;

generate if (F_ADD) ula_fadd #(NBMANT,NBEXPO) my_fadd(e_out, sm1_out, sm2_out, fadd); else assign fadd = {NUBITS{1'bx}}; endgenerate

// MLT ------------------------------------------------------------------------

wire signed [NUBITS-1:0] mlt;

generate if (MLT) ula_mlt #(NUBITS) my_mlt(in1, in2, mlt); else assign mlt = {NUBITS{1'bx}}; endgenerate

// F_MLT ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fmlt;

generate if (F_MLT) ula_fmlt #(NBMANT,NBEXPO) my_fmlt(in1 ,in2 , fmlt); else assign fmlt = {NUBITS{1'bx}}; endgenerate

// DIV ------------------------------------------------------------------------

wire signed [NUBITS-1:0] div;

generate if (DIV) ula_div #(NUBITS) my_div(in1, in2, div); else assign div = {NUBITS{1'bx}}; endgenerate

// F_DIV ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fdiv;

generate if (F_DIV) ula_fdiv #(NBMANT,NBEXPO) my_fdiv(in1, in2, fdiv); else assign fdiv = {NUBITS{1'bx}}; endgenerate

// MOD ------------------------------------------------------------------------

wire signed [NUBITS-1:0] mod;

generate if (MOD) ula_mod #(NUBITS) my_mod(in1, in2, mod); else assign mod = {NUBITS{1'bx}}; endgenerate

// SGN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] sgn;

generate if (SGN) ula_sgn #(NUBITS) my_sgn(in1, in2, sgn); else assign sgn = {NUBITS{1'bx}}; endgenerate

// F_SGN ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fsgn;

generate if (F_SGN) ula_fsgn #(NBMANT,NBEXPO) my_fsgn(in1, in2, fsgn); else assign fsgn = {NUBITS{1'bx}}; endgenerate

// NEG ------------------------------------------------------------------------

wire signed [NUBITS-1:0] neg;

generate if (NEG) ula_neg #(NUBITS) my_neg(in2, neg); else assign neg = {NUBITS{1'bx}}; endgenerate

// NEG_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] negm;

generate if (NEG_M) ula_neg #(NUBITS) my_negm(in1, negm ); else assign negm = {NUBITS{1'bx}}; endgenerate

// F_NEG ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fneg;

generate if (F_NEG) ula_fneg #(NBMANT,NBEXPO) my_fneg(in2, fneg); else assign fneg = {NUBITS{1'bx}}; endgenerate

// F_NEG_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fnegm;

generate if (F_NEG_M) ula_fneg #(NBMANT,NBEXPO) my_fnegm(in1, fnegm); else assign fnegm = {NUBITS{1'bx}}; endgenerate

// ABS ------------------------------------------------------------------------

wire signed [NUBITS-1:0] abs;

generate if (ABS) ula_abs #(NUBITS) my_abs(in2, abs); else assign abs = {NUBITS{1'bx}}; endgenerate

// ABS_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] absm;

generate if (ABS_M) ula_abs #(NUBITS) my_absm(in1, absm); else assign absm = {NUBITS{1'bx}}; endgenerate

// F_ABS ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fabs;

generate if (F_ABS) ula_fabs #(NBMANT,NBEXPO) my_fabs(in2, fabs); else assign fabs = {NUBITS{1'bx}}; endgenerate

// F_ABS_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fabsm;

generate if (F_ABS_M) ula_fabs #(NBMANT,NBEXPO) my_fabsm(in1, fabsm); else assign fabsm = {NUBITS{1'bx}}; endgenerate

// PST ------------------------------------------------------------------------

wire signed [NUBITS-1:0] pst;

generate if (PST) ula_pst #(NUBITS) my_pst(in2, pst); else assign pst = {NUBITS{1'bx}}; endgenerate

// PST_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] pstm;

generate if (PST_M) ula_pst #(NUBITS) my_pstm(in1, pstm); else assign pstm = {NUBITS{1'bx}}; endgenerate

// F_PST ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fpst;

generate if (F_PST) ula_fpst #(NBMANT,NBEXPO) my_fpst(in2, fpst); else assign fpst = {NUBITS{1'bx}}; endgenerate

// F_PST_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fpstm;

generate if (F_PST_M) ula_fpst #(NBMANT,NBEXPO) my_fpstm(in1, fpstm); else assign fpstm = {NUBITS{1'bx}}; endgenerate

// NRM ------------------------------------------------------------------------

wire signed [NUBITS-1:0] nrm;

generate if (NRM) ula_nrm #(NUBITS,NUGAIN) my_nrm(in2, nrm); else assign nrm = {NUBITS{1'bx}}; endgenerate

// NRM_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] nrmm;

generate if (NRM_M) ula_nrm #(NUBITS,NUGAIN) my_nrmm(in1, nrmm); else assign nrmm = {NUBITS{1'bx}}; endgenerate

// I2F ------------------------------------------------------------------------

wire signed [NUBITS-1:0] i2f;

generate if (I2F) ula_i2f #(NBMANT,NBEXPO) my_i2f (in2, i2f); else assign i2f = {NUBITS{1'bx}}; endgenerate

// I2F_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] i2fm;

generate if (I2F_M) ula_i2f #(NBMANT,NBEXPO) my_i2fm(in1, i2fm); else assign i2fm = {NUBITS{1'bx}}; endgenerate

// F2I ------------------------------------------------------------------------

wire signed [NUBITS-1:0] f2i;

generate if (F2I) ula_f2i #(NBMANT,NBEXPO) my_f2i (in2, f2i); else assign f2i = {NUBITS{1'bx}}; endgenerate

// F2I_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] f2im;

generate if (F2I_M) ula_f2i #(NBMANT,NBEXPO) my_f2im(in1, f2im); else assign f2im = {NUBITS{1'bx}}; endgenerate

// AND ------------------------------------------------------------------------

wire signed [NUBITS-1:0] ann;

generate if (AND) ula_and #(NUBITS) my_and(in1, in2, ann); else assign ann = {NUBITS{1'bx}}; endgenerate

// ORR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] orr;

generate if (ORR) ula_or #(NUBITS) my_orr(in1, in2, orr); else assign orr = {NUBITS{1'bx}}; endgenerate

// XOR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] cor;

generate if (XOR) ula_xor #(NUBITS) my_xor(in1, in2, cor); else assign cor = {NUBITS{1'bx}}; endgenerate

// INV ------------------------------------------------------------------------

wire signed [NUBITS-1:0] inv;

generate if (INV) ula_inv #(NUBITS) my_inv (in2, inv); else assign inv = {NUBITS{1'bx}}; endgenerate

// INV_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] invm;

generate if (INV_M) ula_inv #(NUBITS) my_invm(in1, invm); else assign invm = {NUBITS{1'bx}}; endgenerate

// LAN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lan;

generate if (LAN) ula_lan #(NUBITS) my_lan(in1, in2, lan); else assign lan = {NUBITS{1'bx}}; endgenerate

// LOR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lor;

generate if (LOR) ula_lor #(NUBITS) my_lor(in1, in2, lor); else assign lor = {NUBITS{1'bx}}; endgenerate

// LIN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lin;

generate if (LIN) ula_lin #(NUBITS) my_lin(in2, lin); else assign lin = {NUBITS{1'bx}}; endgenerate

// LIN_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] linm;

generate if (LIN_M) ula_lin #(NUBITS) my_linm(in1, linm); else assign linm = {NUBITS{1'bx}}; endgenerate

// LES ------------------------------------------------------------------------

wire signed [NUBITS-1:0]  les ;

generate if (LES) ula_les #(NUBITS) my_les(in1, in2, les); else assign les = {NUBITS{1'bx}}; endgenerate

// F_LES ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fles;

generate if (F_LES) assign fles = sm1_out < sm2_out ; else assign fles = {NUBITS{1'bx}}; endgenerate

// GRE ------------------------------------------------------------------------

wire signed [NUBITS-1:0] gre;

generate if (GRE) ula_gre #(NUBITS) my_gre(in1, in2, gre); else assign gre = {NUBITS{1'bx}}; endgenerate

// F_GRE ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fgre;

generate if (F_GRE) assign fgre = sm1_out > sm2_out ; else assign fgre = {NUBITS{1'bx}}; endgenerate

// EQU ------------------------------------------------------------------------

wire signed [NUBITS-1:0] equ;

generate if (EQU) ula_equ #(NUBITS) my_equ(in1, in2, equ); else assign equ = {NUBITS{1'bx}}; endgenerate

// SHR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] shr;

generate if (SHR) ula_shr #(NUBITS) my_shr(in1, in2, shr); else assign shr = {NUBITS{1'bx}}; endgenerate

// SHL ------------------------------------------------------------------------

wire signed [NUBITS-1:0] shl;

generate if (SHL) ula_shl #(NUBITS) my_shl(in1, in2, shl); else assign shl = {NUBITS{1'bx}}; endgenerate

// SRS ------------------------------------------------------------------------

wire signed [NUBITS-1:0] srs;

generate if (SRS) ula_srs #(NUBITS) my_srs(in1, in2, srs); else assign srs = {NUBITS{1'bx}}; endgenerate

// mux principal --------------------------------------------------------------

wire [NUBITS-1:0] mux_out; // saida da ula

ula_mux #(NUBITS) ula_mux (.op (op ),
                           .in1(in1),.in2 (in2 ),
                           .add(add),.fadd(fadd),
						   .mlt(mlt),.fmlt(fmlt),
						   .div(div),.fdiv(fdiv),
						   .mod(mod),
						   .sgn(sgn),.fsgn(fsgn),
						   .neg(neg),.negm(negm),.fneg(fneg),.fnegm(fnegm),
						   .abs(abs),.absm(absm),.fabs(fabs),.fabsm(fabsm),
						   .pst(pst),.pstm(pstm),.fpst(fpst),.fpstm(fpstm),
                           .nrm(nrm),.nrmm(nrmm),
						   .i2f(i2f),.i2fm(i2fm), 
					       .f2i(f2i),.f2im(f2im),
						   .ann(ann),
						   .orr(orr),
						   .cor(cor),
						   .inv(inv),.invm(invm),
						   .lan(lan),
						   .lor(lor),
						   .lin(lin),.linm(linm),
                           .les(les),.fles(fles),
						   .gre(gre),.fgre(fgre),
						   .equ(equ),
                           .shl(shl),
						   .shr(shr),
						   .srs(srs),
                           .out(mux_out));

// mux de saida (se necessario) -----------------------------------------------

generate if (I2F || I2F_M || F_ADD || F_MLT || F_DIV) ula_out #(NUBITS,NBMANT,NBEXPO) ula_out(op, mux_out, out); else assign out = mux_out; endgenerate

endmodule