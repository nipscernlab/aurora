// ****************************************************************************
// Main multiplexer ***********************************************************
// ****************************************************************************

// selects which operation goes to the output ---------------------------------

module ula_mux
#(
	 parameter NUBITS = 32
 )(
	 // operation index
	 input     [       5:0] op  ,
	 // outputs one of the inputs (in1 -> from memory, in2 -> from accumulator)
	 input     [NUBITS-1:0] in1 , in2,
	 // two-parameter arithmetic operations
	 input     [NUBITS-1:0] add ,
	 input     [NUBITS-1:0] mlt ,
	 input     [NUBITS-1:0] div ,
	 input     [NUBITS-1:0] mod ,                    // int-only
	 input     [NUBITS-1:0] sgn , fsgn,
	 // one-parameter arithmetic operations
	 input     [NUBITS-1:0] neg , negm, fneg, fnegm,
	 input     [NUBITS-1:0] abs , absm, fabs, fabsm,
	 input     [NUBITS-1:0] pst , pstm, fpst, fpstm,
	 input     [NUBITS-1:0] nrm , nrmm,              // int-only
	 input     [NUBITS-1:0] f2i , f2im,
	 // two-parameter logical operations
	 input     [NUBITS-1:0] ann , orr , cor ,        // and, or, xor
	 // one-parameter logical operations
	 input     [NUBITS-1:0] inv , invm,              // not
	 // two-parameter conditional operations
	 input     [NUBITS-1:0] lan , lor ,              // int-only
	 // one-parameter conditional operations
	 input     [NUBITS-1:0] lin , linm,              // int-only
	 // comparison operations
	 input     [NUBITS-1:0] les , fles,
	 input     [NUBITS-1:0] gre , fgre,
	 input     [NUBITS-1:0] equ ,                    // works for int and float
	 // bit-shift operations
	 input     [NUBITS-1:0] shl , shr , srs ,        // <<, >> and >>>
	 // operations from the normalization circuit
	 input     [NUBITS-1:0] smx ,                    // float-only with denorm.
	 // output
	output reg [NUBITS-1:0] out
);

always @ (*) case (op)
	6'd0   : out =   in2 ;   //   NOP
	6'd1   : out =   in1 ;   //   LOD

	6'd2   : out =   add ;   //   ADD
	6'd3   : out =   smx ;   // F_ADD

	6'd4   : out =   mlt ;   //   MLT
	6'd5   : out =   smx ;   // F_MLT

	6'd6   : out =   div ;   //   DIV
	6'd7   : out =   smx ;   // F_DIV

	6'd8   : out =   mod ;   //   MOD

	6'd9   : out =   sgn ;   //   SGN
	6'd10  : out =  fsgn ;   // F_SGN

	6'd11  : out =   neg ;   //   NEG
	6'd12  : out =   negm;   //   NEG_M
	6'd13  : out =  fneg ;   // F_NEG
	6'd14  : out =  fnegm;   // F_NEG_M

	6'd15  : out =   abs ;   //   ABS
	6'd16  : out =   absm;   //   ABS_M
	6'd17  : out =  fabs ;   // F_ABS
	6'd18  : out =  fabsm;   // F_ABS_M

	6'd19  : out =   pst ;   //   PST
	6'd20  : out =   pstm;   //   PST_M
	6'd21  : out =  fpst ;   // F_PST
	6'd22  : out =  fpstm;   // F_PST_M

	6'd23  : out =   nrm ;   //   NRM
	6'd24  : out =   nrmm;   //   NRM_M

	6'd25  : out =   smx ;   //   I2F
	6'd26  : out =   smx ;   //   I2F_M

	6'd27  : out =   f2i ;   //   F2I
	6'd28  : out =   f2im;   //   F2I_M

	6'd29  : out =   ann ;   //   AND
	6'd30  : out =   orr ;   //   ORR
	6'd31  : out =   cor ;   //   XOR

	6'd32  : out =   inv ;   //   INV
	6'd33  : out =   invm;   //   INV_M

	6'd34  : out =   lan ;   //   LAN
	6'd35  : out =   lor ;   //   LOR

	6'd36  : out =   lin ;   //   LIN
	6'd37  : out =   linm;   //   LIN_M

	6'd38  : out =   les ;   //   LES
	6'd39  : out =  fles ;   // F_LES

	6'd40  : out =   gre ;   //   GRE
	6'd41  : out =  fgre ;   // F_GRE

	6'd42  : out =   equ ;   //   EQU

	6'd43  : out =   shl ;   //   SHL
	6'd44  : out =   shr ;   //   SHR
	6'd45  : out =   srs ;   //   SRS

	6'd46  : out =   smx ;   // F_ROT
	6'd47  : out =   smx ;   // F_SU1
	6'd48  : out =   smx ;   // F_SU2

	default: out = {NUBITS{1'bx}};
endcase

endmodule

// ****************************************************************************
// Auxiliary circuits for floating-point operations ***************************
// ****************************************************************************

// equalizes the exponent of two numbers --------------------------------------
// for operations that require mantissas at the same order of magnitude. e.g., F_ADD

module ula_denorm
#(
	parameter MAN = 23,
	parameter EXP =  8
)(
	 input                            neg1, neg2,       // invert the sign
	 input            [MAN+EXP :0]     in1,  in2,
	output reg signed [EXP-1   :0]   e_out,
	output reg signed [MAN     :0] sm1_out, sm2_out
);

// unpack the registered inputs -----------------------------------------------

wire                  s1_in = (neg1) ? ~in1[MAN+EXP] : in1[MAN+EXP];
wire                  s2_in = (neg2) ? ~in2[MAN+EXP] : in2[MAN+EXP];
wire signed [EXP-1:0] e1_in = in1[MAN+EXP-1:MAN];
wire signed [EXP-1:0] e2_in = in2[MAN+EXP-1:MAN];
wire        [MAN-1:0] m1_in = in1[MAN    -1:0  ];
wire        [MAN-1:0] m2_in = in2[MAN    -1:0  ];

// compute the shift ----------------------------------------------------------
// the smaller exponent shifts to match the larger ----------------------------

wire signed [EXP:0] eme    =  e1_in-e2_in;                           // subtraction e1-e2
wire                ege    =  eme     [EXP];                         // save the sign of the subtraction
wire        [EXP:0] shift2 = (ege) ?  {EXP+1{1'b0}} : eme;           // shift of input 2
wire        [EXP:0] shift1 = (ege) ? -eme           : {EXP+1{1'b0}}; // shift of input 1

// take the final exponent ----------------------------------------------------

always @ (*) e_out = (ege) ? e2_in : e1_in; // the final exponent is the larger

// right-shift the mantissa with smaller exp ----------------------------------

wire [MAN-1:0] m1_out = m1_in >> shift1;
wire [MAN-1:0] m2_out = m2_in >> shift2;

// compute the signed mantissas -----------------------------------------------

// zero-pad m{1,2}_out (MAN bits) to match sm{1,2}_out's MAN+1-bit signed width
always @ (*) sm1_out = (s1_in) ? -m1_out : {1'b0, m1_out};
always @ (*) sm2_out = (s2_in) ? -m2_out : {1'b0, m2_out};

endmodule

// multiplexer of the normalization module ------------------------------------
// assists the normalization circuit of a floating-point number ---------------

module ula_nmux
#(
	parameter NCOMP = 2,
	parameter NBITS = 8
)(
	input  [NCOMP-1:0]   A,   B,
	input  [NBITS-1:0] in1, in2,
	output [NBITS-1:0] out
);

assign out = (A==B) ? in1 : in2;

endmodule

// normalization of a floating-point number -----------------------------------
// left-shift until the most significant bit of the mantissa is 1 -------------

module ula_norm
#(
	parameter MAN    = 23,
	parameter EXP    =  8
)(
	 input [MAN+EXP :0] in,
	output [MAN+EXP :0] out
);

wire                    sig = in[MAN+EXP      ];
wire signed [EXP-1  :0] exp = in[MAN+EXP-1:MAN];
wire        [MAN-1  :0] man = in[MAN    -1:  0];

wire [EXP-1:0] w [MAN-1:0];

wire        [EXP-1:0] sh    =  w[MAN-2];
wire                  out_s =  sig;
wire signed [EXP-1:0] out_e = (man == {MAN{1'b0}}) ? {1'b1, {EXP-1{1'b0}}} : exp - sh;
wire        [MAN-1:0] out_m =  man << sh;

ula_nmux #(1, EXP) mm1 (man[MAN-1], 1'b0, {{EXP-1{1'b0}}, {1'b1}}, {EXP{1'b0}}, w[0]);

genvar i;

generate
	for (i = 1; i < MAN-1; i = i+1) begin : norm
		ula_nmux #(i+1, EXP) mm (man[MAN-1:MAN-1-i], {i+1{1'b0}}, i[EXP-1:0] + {{EXP-1{1'b0}}, {1'b1}}, w[i-1], w[i]);
	end
endgenerate

assign out = {out_s, out_e, out_m};

endmodule

// multiplexer of operations that require normalization -----------------------

module norm_mux
#(
	parameter NUBITS = 32,
	parameter NBMANT = 23,
	parameter NBEXPO =  8
)(
	 input [       5:0] op  ,
	 input [NUBITS-1:0] fadd,
	 input [NUBITS-1:0] fmlt,
	 input [NUBITS-1:0] fdiv,
	 input [NUBITS-1:0] i2f , i2fm,
	 input [NUBITS-1:0] frot,
	output [NUBITS-1:0] out
);

// input multiplexer
reg [NUBITS-1:0] imux_out;

always @ (*) case (op)
	6'd3   : imux_out =  fadd ;   // F_ADD
	6'd5   : imux_out =  fmlt ;   // F_MLT
	6'd7   : imux_out =  fdiv ;   // F_DIV
	6'd25  : imux_out =   i2f ;   //   I2F
	6'd26  : imux_out =   i2fm;   //   I2F_M
	6'd46  : imux_out =  frot ;   // F_ROT
	6'd47  : imux_out =  fadd ;   // F_SU1 (uses the same addition circuit)
	6'd48  : imux_out =  fadd ;   // F_SU2 (uses the same addition circuit)
	default: imux_out = {NUBITS{1'bx}};
endcase

// perform the normalization
ula_norm #(NBMANT,NBEXPO) ula_norm (imux_out, out);

endmodule

// ****************************************************************************
// Two-parameter arithmetic operations ****************************************
// ****************************************************************************

// ADD - fixed-point addition -------------------------------------------------

module ula_add
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

assign out = in1 + in2;

endmodule

// F_ADD - floating-point addition --------------------------------------------

module ula_fadd
#(
	parameter MAN = 23,
	parameter EXP =  8
)(
	input  signed [EXP-1   :0] e_in,
	input  signed [MAN     :0] sm1_in, sm2_in,                // already comes in with one extra sign bit
	output        [MAN+EXP :0] out
);

wire signed [MAN+1:0] soma =  sm1_in + sm2_in;                // add one more bit to avoid overflow
wire signed [MAN+1:0] m    = (soma[MAN+1]) ? -soma : soma;    // compute abs() of the mantissa

wire                  s_out = soma    [MAN+1];
wire signed [EXP-1:0] e_out = e_in + {{EXP-1{1'b0}}, {1'b1}}; // add one to the exponent to compensate for the mantissa shift
wire        [MAN-1:0] m_out = m       [MAN:1];                // this shift is because the sum may produce a number larger than the mantissa

assign out = {s_out, e_out, m_out};

endmodule

// MLT - fixed-point multiplication -------------------------------------------

module ula_mlt
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

assign out = in1 * in2;

endmodule

// F_MLT - floating-point multiplication --------------------------------------

module ula_fmlt
#(
	parameter MAN = 23,
	parameter EXP =  8
)(
	 input     [MAN+EXP :0] in1, in2,
	output reg [MAN+EXP :0] out
);

// separate the parts of the input signals ------------------------------------

wire                  s1 = in1[MAN+EXP      ];
wire                  s2 = in2[MAN+EXP      ];
wire signed [EXP-1:0] e1 = in1[MAN+EXP-1:MAN];
wire signed [EXP-1:0] e2 = in2[MAN+EXP-1:MAN];
wire        [MAN-1:0] m1 = in1[MAN    -1:0  ];
wire        [MAN-1:0] m2 = in2[MAN    -1:0  ];

// compute the sign -----------------------------------------------------------

wire s_out = (s1 != s2);

// compute the exponent value -------------------------------------------------

wire signed [EXP-1:0] e_out = e1 + e2 + MAN[EXP-1:0];

// compute the mantissa value -------------------------------------------------

wire [2*MAN-1:0] mult  = m1 * m2;
wire [MAN  -1:0] m_out = mult[2*MAN-1:MAN];

// finalize -------------------------------------------------------------------

always @ (*) if (m_out != {{MAN{1'b0}}}) out = {s_out, e_out, m_out}; else out = {1'b0, 1'b1, {{EXP-1{1'b0}}}, {{MAN{1'b0}}}};

endmodule

// DIV - fixed-point division -------------------------------------------------

module ula_div
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

assign out = in1 / in2;

endmodule

// F_DIV - floating-point division --------------------------------------------

module ula_fdiv
#(
	parameter MAN    = 23,
	parameter EXP    =  8
)(
	 input [MAN+EXP :0] in1, in2,
	output [MAN+EXP :0] out
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
wire        [MAN-1:0] m_out = div      [MAN-1:0];

assign out = {s_out, e_out, m_out};

endmodule

// MOD - division remainder ---------------------------------------------------

module ula_mod
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

assign out = in1 % in2;

endmodule

// SGN - takes the sign of the first argument ---------------------------------

module ula_sgn
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

assign out =  (in1[NUBITS-1] == in2[NUBITS-1]) ? in2 : -in2;

endmodule

// F_SGN - takes the sign of the first argument in float ----------------------

module ula_fsgn
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
	 input [MAN+EXP:0] in1, in2,
	output [MAN+EXP:0] out
);

wire                  s_out = in1[EXP+MAN];
wire signed [EXP-1:0] e_out = in2[EXP+MAN-1:MAN];
wire        [MAN-1:0] m_out = in2[MAN    -1:  0];

assign out = {s_out, e_out, m_out};

endmodule

// ****************************************************************************
// One-parameter arithmetic operations ****************************************
// ****************************************************************************

// NEG - negation of an integer -----------------------------------------------

module ula_neg
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out
);

assign out = -in;

endmodule

// F_NEG - negation of a floating-point number --------------------------------

module ula_fneg
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
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

// ABS - absolute value of an integer -----------------------------------------

module ula_abs
#(
	parameter NUBITS = 32
)(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out
);

assign out = (in[NUBITS-1]) ? -in : in;

endmodule

// F_ABS - absolute value of a floating-point number --------------------------

module ula_fabs
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                  s_out = 0;
wire signed [EXP-1:0] e_out = in[EXP+MAN-1:MAN];
wire        [MAN-1:0] m_out = in[MAN    -1:  0];

assign out = {s_out, e_out, m_out};

endmodule

// PST - zero if negative -----------------------------------------------------

module ula_pst
#(
	parameter NUBITS = 32
)(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out
);

assign out = (in[NUBITS-1]) ? {NUBITS{1'b0}} : in;

endmodule

// F_PST - zero if negative for float -----------------------------------------

module ula_fpst
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

assign out = (in[MAN+EXP]) ? {1'b0, 1'b1, {MAN+EXP-1{1'b0}}} : in;

endmodule

// NRM - division by a constant -----------------------------------------------

module ula_nrm
#(
	parameter         NUBITS = 32,
	parameter signed  NUGAIN =  1
)(
	 input    signed [NUBITS-1:0] in,
	output    signed [NUBITS-1:0] out
);

assign out = in/NUGAIN;

endmodule

// I2F - converts int to float ------------------------------------------------

module ula_i2f
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
	input  signed [MAN-1  :0] in,
	output        [MAN+EXP:0] out
);

wire                  i2f_s = in[MAN-1];
wire signed [EXP-1:0] i2f_e = 0;
wire        [MAN-1:0] i2f_m = (i2f_s) ? -in : in;

assign out = {i2f_s, i2f_e, i2f_m};

endmodule

// F2I - converts float to int ------------------------------------------------

module ula_f2i
#(
	parameter MAN = 23,
	parameter EXP =  8
)(
	input             [MAN+EXP :0] in,
	output reg signed [MAN+EXP :0] out
);

wire           s = in[MAN+EXP      ];
wire [EXP-1:0] e = in[MAN+EXP-1:MAN];
wire [MAN-1:0] m = in[MAN    -1:  0];

wire        [EXP-1:0] shift = (e[EXP-1]) ? -e : e;
// shift the magnitude (logical), then apply the sign — truncates toward zero,
// as C/IEEE float->int conversion requires (a signed >>> would floor instead).
// m_ext widens m (MAN bits) to the final mag width (MAN+EXP+1) so the shift
// operates at the destination width — Verilator otherwise warns WIDTHEXPAND.
wire        [MAN+EXP:0] m_ext = {{(EXP+1){1'b0}}, m};
wire        [MAN+EXP:0] mag   = (e[EXP-1]) ? (m_ext >> shift) : (m_ext << shift);

always @ (*) out  = (s) ? -mag : mag;

endmodule

// ****************************************************************************
// Two-parameter logical operations *******************************************
// ****************************************************************************

// AND - bitwise AND (&) ------------------------------------------------------

module ula_and
#(
	parameter NUBITS = 32
)(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out
);

assign out = in1 & in2;

endmodule

// ORR - bitwise OR (|) -------------------------------------------------------

module ula_or
#(
	parameter NUBITS = 32
)(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out
);

assign out = in1 | in2;

endmodule

// XOR - bitwise XOR (^) ------------------------------------------------------

module ula_xor
#(
	parameter NUBITS = 32
)(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out
);

assign out = (in1 ^ in2);

endmodule

// ****************************************************************************
// One-parameter logical operations *******************************************
// ****************************************************************************

// INV - bitwise inversion (~) ------------------------------------------------

module ula_inv
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out
);

assign out = ~in;

endmodule

// ****************************************************************************
// Two-parameter conditional operations ***************************************
// ****************************************************************************

// LAN - if one of the conditions is zero -> outputs zero (&&) ----------------

module ula_lan
#(
	parameter  NUBITS = 32
)(
	 input    [NUBITS-1:0] in1, in2,
	output    [NUBITS-1:0] out
);

assign out = ((in1 == {NUBITS{1'b0}}) || (in2 == {NUBITS{1'b0}})) ? {NUBITS{1'b0}} : {{NUBITS-1{1'b0}}, 1'b1};

endmodule

// LOR - if one of the conditions is one -> outputs one (||) ------------------

module ula_lor
#(
	parameter  NUBITS = 32
)(
	 input    [NUBITS-1:0] in1, in2,
	output    [NUBITS-1:0] out
);

assign out = ((in1 == {NUBITS{1'b0}}) && (in2 == {NUBITS{1'b0}})) ? {NUBITS{1'b0}} : {{NUBITS-1{1'b0}}, 1'b1};

endmodule

// ****************************************************************************
// One-parameter conditional operations ***************************************
// ****************************************************************************

// LIN - inverts the condition ------------------------------------------------

module ula_lin
#(
	parameter NUBITS = 32
)(
	 input   [NUBITS-1:0] in,
	output   [NUBITS-1:0] out
);

assign out = (in  == {NUBITS{1'b0}}) ? {{NUBITS-1{1'b0}}, 1'b1} : {NUBITS{1'b0}};

endmodule

// ****************************************************************************
// Comparison operations ******************************************************
// ****************************************************************************

// LES - less than ------------------------------------------------------------

module ula_les
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output        [NUBITS-1:0] out
);

// zero-extend the 1-bit comparison result to NUBITS so Verilator does not
// warn WIDTHEXPAND on the ASSIGNW. Semantics are unchanged: false -> all
// zeros, true -> ...0001.
assign out = {{(NUBITS-1){1'b0}}, (in1 < in2)};

endmodule

// FLES - floating-point less than --------------------------------------------

module ula_fles
#(
	parameter NUBITS = 32,
	parameter NBMANT = 23
)(
	 input signed [NBMANT  :0] in1, in2,
	output        [NUBITS-1:0] out
);

assign out = {{(NUBITS-1){1'b0}}, (in1 < in2)};

endmodule

// GRE - greater than ---------------------------------------------------------

module ula_gre
#(
	parameter NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1, in2,
	output        [NUBITS-1:0] out
);

assign out = {{(NUBITS-1){1'b0}}, (in1 > in2)};

endmodule

// FGRE - floating-point greater than -----------------------------------------

module ula_fgre
#(
	parameter NUBITS = 32,
	parameter NBMANT = 23
)(
	 input signed [NBMANT  :0] in1, in2,
	output        [NUBITS-1:0] out
);

assign out = {{(NUBITS-1){1'b0}}, (in1 > in2)};

endmodule

// EQU - equal to -------------------------------------------------------------

module ula_equ
#(
	parameter NUBITS = 32
)(
	 input   [NUBITS-1:0] in1, in2,
	output   [NUBITS-1:0] out
);

assign out = {{(NUBITS-1){1'b0}}, (in1 == in2)};

endmodule

// ****************************************************************************
// Bit-shift operations *******************************************************
// ****************************************************************************

// SHL - left shift -----------------------------------------------------------

module ula_shl
#(
	parameter   NUBITS = 32
)(
	 input     [NUBITS-1:0] in1, in2,
	output     [NUBITS-1:0] out
);

assign out = in1 << in2;

endmodule

// SHR - right shift ----------------------------------------------------------

module ula_shr
#(
	parameter   NUBITS = 32
)(
	 input     [NUBITS-1:0] in1, in2,
	output     [NUBITS-1:0] out
);

assign out = in1 >> in2;

endmodule

// SRS - arithmetic right shift -----------------------------------------------

module ula_srs
#(
	parameter      NUBITS = 32
)(
	 input signed [NUBITS-1:0] in1,
	 input        [NUBITS-1:0] in2,
	output signed [NUBITS-1:0] out
);

assign out = in1 >>> in2;

endmodule

// ****************************************************************************
// Special operations *********************************************************
// ****************************************************************************

// F_ROT - nearest power of 2 to the square root ------------------------------

module ula_frot
#(
	parameter MAN = 23,
	parameter EXP = 8
)(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                  s_in  = in[MAN+EXP      ];
wire signed [EXP-1:0] e_in  = in[MAN+EXP-1:MAN];
wire        [MAN-1:0] m_in  = in[MAN    -1:0  ];

wire                  s_out = s_in;
wire signed [EXP-1:0] e_out = (e_in+(MAN-1))/2;
wire        [MAN-1:0] m_out = 1;

assign out = {s_out, e_out, m_out};

endmodule

// ****************************************************************************
// Main Circuit ***************************************************************
// ****************************************************************************

module ula
#(
	// General
	parameter                     NUBITS = 32,
	parameter                     NBMANT = 23,
	parameter                     NBEXPO =  8,
	parameter signed [NUBITS-1:0] NUGAIN = 64,
	parameter                     NBOPCO =  7,

	// two-parameter arithmetic operations
	parameter   ADD   = 0,
	parameter F_ADD   = 0,
	parameter   MLT   = 0,
	parameter F_MLT   = 0,
	parameter   DIV   = 0,
	parameter F_DIV   = 0,
	parameter   MOD   = 0,
	parameter   SGN   = 0,
	parameter F_SGN   = 0,

	// one-parameter arithmetic operations
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

	// two-parameter logical operations
	parameter   AND   = 0,
	parameter   ORR   = 0,
	parameter   XOR   = 0,

	// one-parameter logical operations
	parameter   INV   = 0,
	parameter   INV_M = 0,

	// two-parameter conditional operations
	parameter   LAN   = 0,
	parameter   LOR   = 0,

	// one-parameter conditional operations
	parameter   LIN   = 0,
	parameter   LIN_M = 0,

	// comparison operations
	parameter   LES   = 0,
	parameter F_LES   = 0,
	parameter   GRE   = 0,
	parameter F_GRE   = 0,
	parameter   EQU   = 0,

	// bit-shift operations
	parameter   SHL   = 0,
	parameter   SHR   = 0,
	parameter   SRS   = 0,

	// special operations
	parameter F_ROT   = 0,
	parameter F_SU1   = 0,
	parameter F_SU2   = 0)
(
	input         [       5:0] op,
	input  signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out
);

// floating-point denormalization circuit -------------------------------------

wire signed [NBEXPO-1:0] e_out;                       // normalized exponent
wire signed [NBMANT  :0] sm1_out, sm2_out;            // normalized mantissas
// F_SU1/F_SU2 are 32-bit parameters; cast to 1 bit with `!= 0` so the AND
// with the 1-bit op-equality stays 1 bit and matches the 1-bit su{1,2} LHS.
wire					 su1 = (F_SU1 != 0) & (op == 6'd47); // invert sign of in1 for F_SU1
wire                     su2 = (F_SU2 != 0) & (op == 6'd48); // invert sign of in2 for F_SU2

generate if ((F_ADD | F_SU1 | F_SU2 | F_GRE | F_LES) != 0) ula_denorm #(NBMANT,NBEXPO) denorm(su1, su2, in1, in2, e_out, sm1_out, sm2_out); endgenerate

// ADD ------------------------------------------------------------------------

wire signed [NUBITS-1:0] add;

generate if ((ADD) != 0) ula_add #(NUBITS) my_add(in1, in2, add); else assign add = {NUBITS{1'bx}}; endgenerate

// F_ADD ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fadd;

generate if ((F_ADD | F_SU1 | F_SU2) != 0) ula_fadd #(NBMANT,NBEXPO) my_fadd(e_out, sm1_out, sm2_out, fadd); else assign fadd = {NUBITS{1'bx}}; endgenerate

// MLT ------------------------------------------------------------------------

wire signed [NUBITS-1:0] mlt;

generate if ((MLT) != 0) ula_mlt #(NUBITS) my_mlt(in1, in2, mlt); else assign mlt = {NUBITS{1'bx}}; endgenerate

// F_MLT ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fmlt;

generate if ((F_MLT) != 0) ula_fmlt #(NBMANT,NBEXPO) my_fmlt(in1 ,in2 , fmlt); else assign fmlt = {NUBITS{1'bx}}; endgenerate

// DIV ------------------------------------------------------------------------

wire signed [NUBITS-1:0] div;

generate if ((DIV) != 0) ula_div #(NUBITS) my_div(in1, in2, div); else assign div = {NUBITS{1'bx}}; endgenerate

// F_DIV ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fdiv;

generate if ((F_DIV) != 0) ula_fdiv #(NBMANT,NBEXPO) my_fdiv(in1, in2, fdiv); else assign fdiv = {NUBITS{1'bx}}; endgenerate

// MOD ------------------------------------------------------------------------

wire signed [NUBITS-1:0] mod;

generate if ((MOD) != 0) ula_mod #(NUBITS) my_mod(in1, in2, mod); else assign mod = {NUBITS{1'bx}}; endgenerate

// SGN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] sgn;

generate if ((SGN) != 0) ula_sgn #(NUBITS) my_sgn(in1, in2, sgn); else assign sgn = {NUBITS{1'bx}}; endgenerate

// F_SGN ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fsgn;

generate if ((F_SGN) != 0) ula_fsgn #(NBMANT,NBEXPO) my_fsgn(in1, in2, fsgn); else assign fsgn = {NUBITS{1'bx}}; endgenerate

// NEG ------------------------------------------------------------------------

wire signed [NUBITS-1:0] neg;

generate if ((NEG) != 0) ula_neg #(NUBITS) my_neg(in2, neg); else assign neg = {NUBITS{1'bx}}; endgenerate

// NEG_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] negm;

generate if ((NEG_M) != 0) ula_neg #(NUBITS) my_negm(in1, negm ); else assign negm = {NUBITS{1'bx}}; endgenerate

// F_NEG ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fneg;

generate if ((F_NEG) != 0) ula_fneg #(NBMANT,NBEXPO) my_fneg(in2, fneg); else assign fneg = {NUBITS{1'bx}}; endgenerate

// F_NEG_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fnegm;

generate if ((F_NEG_M) != 0) ula_fneg #(NBMANT,NBEXPO) my_fnegm(in1, fnegm); else assign fnegm = {NUBITS{1'bx}}; endgenerate

// ABS ------------------------------------------------------------------------

wire signed [NUBITS-1:0] abs;

generate if ((ABS) != 0) ula_abs #(NUBITS) my_abs(in2, abs); else assign abs = {NUBITS{1'bx}}; endgenerate

// ABS_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] absm;

generate if ((ABS_M) != 0) ula_abs #(NUBITS) my_absm(in1, absm); else assign absm = {NUBITS{1'bx}}; endgenerate

// F_ABS ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fabs;

generate if ((F_ABS) != 0) ula_fabs #(NBMANT,NBEXPO) my_fabs(in2, fabs); else assign fabs = {NUBITS{1'bx}}; endgenerate

// F_ABS_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fabsm;

generate if ((F_ABS_M) != 0) ula_fabs #(NBMANT,NBEXPO) my_fabsm(in1, fabsm); else assign fabsm = {NUBITS{1'bx}}; endgenerate

// PST ------------------------------------------------------------------------

wire signed [NUBITS-1:0] pst;

generate if ((PST) != 0) ula_pst #(NUBITS) my_pst(in2, pst); else assign pst = {NUBITS{1'bx}}; endgenerate

// PST_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] pstm;

generate if ((PST_M) != 0) ula_pst #(NUBITS) my_pstm(in1, pstm); else assign pstm = {NUBITS{1'bx}}; endgenerate

// F_PST ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fpst;

generate if ((F_PST) != 0) ula_fpst #(NBMANT,NBEXPO) my_fpst(in2, fpst); else assign fpst = {NUBITS{1'bx}}; endgenerate

// F_PST_M --------------------------------------------------------------------

wire signed [NUBITS-1:0] fpstm;

generate if ((F_PST_M) != 0) ula_fpst #(NBMANT,NBEXPO) my_fpstm(in1, fpstm); else assign fpstm = {NUBITS{1'bx}}; endgenerate

// NRM ------------------------------------------------------------------------

wire signed [NUBITS-1:0] nrm;

generate if ((NRM) != 0) ula_nrm #(NUBITS,NUGAIN) my_nrm(in2, nrm); else assign nrm = {NUBITS{1'bx}}; endgenerate

// NRM_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] nrmm;

generate if ((NRM_M) != 0) ula_nrm #(NUBITS,NUGAIN) my_nrmm(in1, nrmm); else assign nrmm = {NUBITS{1'bx}}; endgenerate

// I2F ------------------------------------------------------------------------

wire signed [NUBITS-1:0] i2f;

generate if ((I2F) != 0) ula_i2f #(NBMANT,NBEXPO) my_i2f (in2[NBMANT-1:0], i2f); else assign i2f = {NUBITS{1'bx}}; endgenerate

// I2F_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] i2fm;

generate if ((I2F_M) != 0) ula_i2f #(NBMANT,NBEXPO) my_i2fm(in1[NBMANT-1:0], i2fm); else assign i2fm = {NUBITS{1'bx}}; endgenerate

// F2I ------------------------------------------------------------------------

wire signed [NUBITS-1:0] f2i;

generate if ((F2I) != 0) ula_f2i #(NBMANT,NBEXPO) my_f2i (in2, f2i); else assign f2i = {NUBITS{1'bx}}; endgenerate

// F2I_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] f2im;

generate if ((F2I_M) != 0) ula_f2i #(NBMANT,NBEXPO) my_f2im (in1, f2im); else assign f2im = {NUBITS{1'bx}}; endgenerate

// AND ------------------------------------------------------------------------

wire signed [NUBITS-1:0] ann;

generate if ((AND) != 0) ula_and #(NUBITS) my_and(in1, in2, ann); else assign ann = {NUBITS{1'bx}}; endgenerate

// ORR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] orr;

generate if ((ORR) != 0) ula_or #(NUBITS) my_orr(in1, in2, orr); else assign orr = {NUBITS{1'bx}}; endgenerate

// XOR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] cor;

generate if ((XOR) != 0) ula_xor #(NUBITS) my_xor(in1, in2, cor); else assign cor = {NUBITS{1'bx}}; endgenerate

// INV ------------------------------------------------------------------------

wire signed [NUBITS-1:0] inv;

generate if ((INV) != 0) ula_inv #(NUBITS) my_inv (in2, inv); else assign inv = {NUBITS{1'bx}}; endgenerate

// INV_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] invm;

generate if ((INV_M) != 0) ula_inv #(NUBITS) my_invm(in1, invm); else assign invm = {NUBITS{1'bx}}; endgenerate

// LAN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lan;

generate if ((LAN) != 0) ula_lan #(NUBITS) my_lan(in1, in2, lan); else assign lan = {NUBITS{1'bx}}; endgenerate

// LOR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lor;

generate if ((LOR) != 0) ula_lor #(NUBITS) my_lor(in1, in2, lor); else assign lor = {NUBITS{1'bx}}; endgenerate

// LIN ------------------------------------------------------------------------

wire signed [NUBITS-1:0] lin;

generate if ((LIN) != 0) ula_lin #(NUBITS) my_lin(in2, lin); else assign lin = {NUBITS{1'bx}}; endgenerate

// LIN_M ----------------------------------------------------------------------

wire signed [NUBITS-1:0] linm;

generate if ((LIN_M) != 0) ula_lin #(NUBITS) my_linm(in1, linm); else assign linm = {NUBITS{1'bx}}; endgenerate

// LES ------------------------------------------------------------------------

wire signed [NUBITS-1:0] les;

generate if ((LES) != 0) ula_les #(NUBITS) my_les(in1, in2, les); else assign les = {NUBITS{1'bx}}; endgenerate

// F_LES ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fles;

generate if ((F_LES) != 0) ula_fles #(NUBITS,NBMANT) my_fles(sm1_out, sm2_out, fles); else assign fles = {NUBITS{1'bx}}; endgenerate

// GRE ------------------------------------------------------------------------

wire signed [NUBITS-1:0] gre;

generate if ((GRE) != 0) ula_gre #(NUBITS) my_gre(in1, in2, gre); else assign gre = {NUBITS{1'bx}}; endgenerate

// F_GRE ----------------------------------------------------------------------

wire signed [NUBITS-1:0] fgre;

generate if ((F_GRE) != 0) ula_fgre #(NUBITS,NBMANT) my_fgre(sm1_out, sm2_out, fgre); else assign fgre = {NUBITS{1'bx}}; endgenerate

// EQU ------------------------------------------------------------------------

wire signed [NUBITS-1:0] equ;

generate if ((EQU) != 0) ula_equ #(NUBITS) my_equ(in1, in2, equ); else assign equ = {NUBITS{1'bx}}; endgenerate

// SHR ------------------------------------------------------------------------

wire signed [NUBITS-1:0] shr;

generate if ((SHR) != 0) ula_shr #(NUBITS) my_shr(in1, in2, shr); else assign shr = {NUBITS{1'bx}}; endgenerate

// SHL ------------------------------------------------------------------------

wire signed [NUBITS-1:0] shl;

generate if ((SHL) != 0) ula_shl #(NUBITS) my_shl(in1, in2, shl); else assign shl = {NUBITS{1'bx}}; endgenerate

// SRS ------------------------------------------------------------------------

wire signed [NUBITS-1:0] srs;

generate if ((SRS) != 0) ula_srs #(NUBITS) my_srs(in1, in2, srs); else assign srs = {NUBITS{1'bx}}; endgenerate

// F_ROT ----------------------------------------------------------------------

wire signed [NUBITS-1:0] frot;

generate if ((F_ROT) != 0) ula_frot #(NBMANT,NBEXPO) my_frot(in2, frot); else assign frot = {NUBITS{1'bx}}; endgenerate

// denormalization mux --------------------------------------------------------

wire signed [NUBITS-1:0] smx;

generate if ((I2F | I2F_M | F_ADD | F_SU1 | F_SU2 | F_MLT | F_DIV | F_ROT) != 0) norm_mux #(NUBITS,NBMANT,NBEXPO) norm_mux(op, fadd, fmlt, fdiv, i2f, i2fm, frot, smx); else assign smx = {NUBITS{1'bx}}; endgenerate

// main mux -------------------------------------------------------------------

ula_mux #(NUBITS) ula_mux (.op (op ),
                           .in1(in1),.in2 (in2 ),
                           .add(add),
                           .mlt(mlt),
                           .div(div),
                           .mod(mod),
                           .sgn(sgn),.fsgn(fsgn),
                           .neg(neg),.negm(negm),.fneg(fneg),.fnegm(fnegm),
                           .abs(abs),.absm(absm),.fabs(fabs),.fabsm(fabsm),
                           .pst(pst),.pstm(pstm),.fpst(fpst),.fpstm(fpstm),
                           .nrm(nrm),.nrmm(nrmm),
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
                           .smx(smx),
                           .out(out));

// ----------------------------------------------------------------------------
// flags (simulation) ---------------------------------------------------------
// ----------------------------------------------------------------------------

`ifdef __ICARUS__ // ----------------------------------------------------------

// get the signed mantissa for inputs and output ------------------------------

integer sm_in1; always @ (*) sm_in1 = (in1[NBMANT+NBEXPO]) ? -in1[NBMANT-1:0] : in1[NBMANT-1:0]; // signed mantissa of in1
integer sm_in2; always @ (*) sm_in2 = (in2[NBMANT+NBEXPO]) ? -in2[NBMANT-1:0] : in2[NBMANT-1:0]; // signed mantissa of in2
integer sm_out; always @ (*) sm_out = (out[NBMANT+NBEXPO]) ? -out[NBMANT-1:0] : out[NBMANT-1:0]; // signed mantissa of out

// get the exponent of inputs and output --------------------------------------

integer e_in1; always @ (*) e_in1 = $signed(in1[NBMANT+NBEXPO-1:NBMANT]); // exponent of in1
integer e_in2; always @ (*) e_in2 = $signed(in2[NBMANT+NBEXPO-1:NBMANT]); // exponent of in2
integer e_ouu; always @ (*) e_ouu = $signed(out[NBMANT+NBEXPO-1:NBMANT]); // exponent of out

// get the real values of inputs and output -----------------------------------

real r_in1; always @ (*) r_in1 = sm_in1*$pow(2.0,e_in1); // real value of in1
real r_in2; always @ (*) r_in2 = sm_in2*$pow(2.0,e_in2); // real value of in2
real r_out; always @ (*) r_out = sm_out*$pow(2.0,e_ouu); // real value of out

// compute rounding error for float -------------------------------------------

real delta_float;

always @ (*) begin
	case (op)
		3      : delta_float = (r_in1 + r_in2) - r_out; // addition
		5      : delta_float = (r_in1 * r_in2) - r_out; // multiplication
		7      : delta_float = (r_in1 / r_in2) - r_out; // division
		47	   : delta_float = (r_in2 - r_in1) - r_out; // subtraction
		48	   : delta_float = (r_in1 - r_in2) - r_out; // subtraction
		default: delta_float = 0;
	endcase
end

// compute rounding error for int ---------------------------------------------

real in1r; always @ (*) in1r = in1;
real in2r; always @ (*) in2r = in2;

real val_add; always @ (*) val_add = in1r + in2r;
real val_mlt; always @ (*) val_mlt = in1r * in2r;
real val_div; always @ (*) val_div = in1r / in2r;
real val_mod; always @ (*) val_mod = in1r % in2r;

real delta_int;

always @ (*) begin
	case (op)
		2      : delta_int = val_add - out; // addition
		4      : delta_int = val_mlt - out; // multiplication
		6      : delta_int = val_div - out; // division
		8      : delta_int = val_mod - out; // remainder
		25     : delta_int = in2   - r_out; // int to float with acc
		26	   : delta_int = in1   - r_out; // int to float with mem
		27     : delta_int = r_in2   - out; // float to int with acc
		28     : delta_int = r_in1   - out; // float to int with mem
		default: delta_int = 0;
	endcase
end

`endif // ---------------------------------------------------------------------

endmodule
