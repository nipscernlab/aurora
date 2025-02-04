// ****************************************************************************
// Circuitos Auxiliares *******************************************************
// ****************************************************************************

// Mux de saida ---------------------------------------------------------------

module ula_fx_mux
#(
	parameter NUBITS = 32
)
(
	 input     [       4:0] op,
	 input     [NUBITS-1:0] in1, in2,
	 input     [NUBITS-1:0] add, mlt, div, mod, neg,
	 input     [NUBITS-1:0] nrm, abs, pst, sgn,
	 input     [NUBITS-1:0] orr, ann, inv, cor,
	 input     [NUBITS-1:0] les, gre, equ,
	 input     [NUBITS-1:0] lin, lan, lor,
	 input     [NUBITS-1:0] shl, shr, srs,

	output reg [NUBITS-1:0] out
);

always @ (*) begin
	case (op)
		5'd0  : out <= in2; // NOP
		5'd1  : out <= in1; // LOAD

		5'd2  : out <= add; // ADD
		5'd3  : out <= mlt; // MLT
		5'd4  : out <= div; // DIV
		5'd5  : out <= mod; // MOD
		5'd6  : out <= neg; // NEG

		5'd7  : out <= nrm; // NORM
		5'd8  : out <= abs; // ABS
		5'd9  : out <= pst; // PST
		5'd10 : out <= sgn; // SIGN

		5'd11 : out <= orr; // OR
		5'd12 : out <= ann; // AND
		5'd13 : out <= inv; // INV
		5'd14 : out <= cor; // XOR

		5'd15 : out <= les; // LES
		5'd16 : out <= gre; // GRE
		5'd17 : out <= equ; // EQU
		
		5'd18 : out <= lin; // LIN
		5'd19 : out <= lan; // LAN
		5'd20 : out <= lor; // LOR

		5'd21 : out <= shl; // SHL
		5'd22 : out <= shr; // SHR
		5'd23 : out <= srs; // SRS

		default: out <= {NUBITS{1'bx}};
	endcase
end

endmodule

// AND ------------------------------------------------------------------------

module my_and
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 & in2;

endmodule

// OR -------------------------------------------------------------------------

module my_or
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = in1 | in2;

endmodule

// EQU ------------------------------------------------------------------------

module my_equ
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 == in2);

endmodule

// XOR ------------------------------------------------------------------------

module my_xor
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = (in1 ^ in2);

endmodule

// NORM -----------------------------------------------------------------------

module my_nrm
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

// ABS ------------------------------------------------------------------------

module my_abs
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

assign out = (in[NUBITS-1]) ? -in : in;

endmodule

// PSET -----------------------------------------------------------------------

module my_pst
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

assign out = (in[NUBITS-1]) ? {NUBITS{1'b0}} : in;

endmodule

// SIGN -----------------------------------------------------------------------

module my_sgn
#(
	parameter NUBITS = 32
)
(
	 input signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out 
);

assign out = (in1[NUBITS-1] == in2[NUBITS-1]) ? in2 : -in2;

endmodule

// LIN ------------------------------------------------------------------------

module my_lin
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in,
	output [NUBITS-1:0] out 
);

// nao eh isso q fazem C
// tem q verificar se toda a palavra eh = 0
// se nao, retorna 0 em todos os bits e 1 no MSB
// se sim, retorna zero em tudo
// mudar aqui e no pf
assign out = {{NUBITS-1{1'b0}}, !in[0]};

endmodule

// LAN ------------------------------------------------------------------------

module my_lan
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = {{NUBITS-1{1'b0}}, in1 && in2};

endmodule

// LOR ------------------------------------------------------------------------

module my_lor
#(
	parameter NUBITS = 32
)
(
	 input [NUBITS-1:0] in1, in2,
	output [NUBITS-1:0] out 
);

assign out = {{NUBITS-1{1'b0}}, in1 || in2};

endmodule

// NEG ------------------------------------------------------------------------

module my_neg
#(
	parameter NUBITS = 32
)
(
	 input signed [NUBITS-1:0] in,
	output signed [NUBITS-1:0] out 
);

assign out = -in;

endmodule

// ****************************************************************************
// Circuito Principal *********************************************************
// ****************************************************************************

module ula_fx
#(
	// Geral
	parameter                     NUBITS = 32,
	parameter signed [NUBITS-1:0] NUGAIN = 64,

	// Operacoes aritmeticas
	parameter ADD  = 0,
	parameter MLT  = 0,
	parameter DIV  = 0,
	parameter MOD  = 0,
	parameter NEG  = 0,

	// Operacoes criadas
	parameter NRM  = 0, // divide pela constante NUGAIN
	parameter ABS  = 0, // valor absoluto
	parameter PST  = 0, // zera se form negativo
	parameter SGN  = 0, // pega o sinal de in1 e coloca em in2

	// Operacoes Logicas bitwise
	parameter OR   = 0,
	parameter AND  = 0,
	parameter INV  = 0,
	parameter XOR  = 0,

	// Operacoes de comparacao
	parameter LES  = 0,
	parameter GRE  = 0,
	parameter EQU  = 0,

	// Operacoes Logicas que resultam em 1 bit (usado em if else while)
	parameter LIN  = 0,
	parameter LAN  = 0,
	parameter LOR  = 0,

	// Operacoes de deslocamento de bits
	parameter SHR  = 0,
	parameter SHL  = 0,
	parameter SRS  = 0
)
(
	input         [       4:0] op,
	input  signed [NUBITS-1:0] in1, in2,
	output signed [NUBITS-1:0] out,
	output                     is_zero
);

wire signed [NUBITS-1:0] add;
wire signed [NUBITS-1:0] mlt;
wire signed [NUBITS-1:0] div;
wire signed [NUBITS-1:0] mod;
wire signed [NUBITS-1:0] neg;
wire signed [NUBITS-1:0] abs;
wire signed [NUBITS-1:0] nrm;
wire signed [NUBITS-1:0] pst;
wire signed [NUBITS-1:0] orr;
wire signed [NUBITS-1:0] ann;
wire signed [NUBITS-1:0] inv;
wire signed [NUBITS-1:0] cor;
wire signed [NUBITS-1:0] lin;
wire signed [NUBITS-1:0] lan;
wire signed [NUBITS-1:0] lor;
wire signed [NUBITS-1:0] shr;
wire signed [NUBITS-1:0] shl;
wire signed [NUBITS-1:0] srs;
wire signed [NUBITS-1:0] gre;
wire signed [NUBITS-1:0] les;
wire signed [NUBITS-1:0] equ;
wire signed [NUBITS-1:0] sgn;

generate if (NRM) my_nrm #(NUBITS, NUGAIN) my_nrm(in2,      nrm); else assign nrm = {NUBITS{1'bx}}; endgenerate
generate if (ABS) my_abs #(NUBITS        ) my_abs(in2,      abs); else assign abs = {NUBITS{1'bx}}; endgenerate
generate if (PST) my_pst #(NUBITS        ) my_pst(in2,      pst); else assign pst = {NUBITS{1'bx}}; endgenerate
generate if (OR ) my_or  #(NUBITS        ) my_or (in1, in2, orr); else assign orr = {NUBITS{1'bx}}; endgenerate
generate if (AND) my_and #(NUBITS        ) my_and(in1, in2, ann); else assign ann = {NUBITS{1'bx}}; endgenerate
generate if (XOR) my_xor #(NUBITS        ) my_xor(in1, in2, cor); else assign cor = {NUBITS{1'bx}}; endgenerate
generate if (EQU) my_equ #(NUBITS        ) my_equ(in1, in2, equ); else assign equ = {NUBITS{1'bx}}; endgenerate
generate if (SGN) my_sgn #(NUBITS        ) my_sgn(in1, in2, sgn); else assign sgn = {NUBITS{1'bx}}; endgenerate
generate if (NEG) my_neg #(NUBITS        ) my_neg(in2,      neg); else assign neg = {NUBITS{1'bx}}; endgenerate

generate if (ADD) assign add = in1 + in2 ; else assign add = {NUBITS{1'bx}}; endgenerate
generate if (MLT) assign mlt = in1 * in2 ; else assign mlt = {NUBITS{1'bx}}; endgenerate
generate if (DIV) assign div = in1 / in2 ; else assign div = {NUBITS{1'bx}}; endgenerate
generate if (MOD) assign mod = in1 % in2 ; else assign mod = {NUBITS{1'bx}}; endgenerate
generate if (INV) assign inv =     ~ in2 ; else assign inv = {NUBITS{1'bx}}; endgenerate

generate if (SHL) assign shl = in1 <<  $unsigned(in2); else assign shl = {NUBITS{1'bx}}; endgenerate
generate if (SHR) assign shr = in1 >>  $unsigned(in2); else assign shr = {NUBITS{1'bx}}; endgenerate
generate if (SRS) assign srs = in1 >>> $unsigned(in2); else assign srs = {NUBITS{1'bx}}; endgenerate
 
generate if (GRE) assign gre = in1 > in2 ; else assign gre = {NUBITS{1'bx}}; endgenerate
generate if (LES) assign les = in1 < in2 ; else assign les = {NUBITS{1'bx}}; endgenerate

generate if (LIN) my_lin #(NUBITS) my_lin(     in2, lin); else assign lin = {NUBITS{1'bx}}; endgenerate
generate if (LAN) my_lan #(NUBITS) my_lan(in1, in2, lan); else assign lan = {NUBITS{1'bx}}; endgenerate
generate if (LIN) my_lor #(NUBITS) my_lor(in1, in2, lor); else assign lor = {NUBITS{1'bx}}; endgenerate

ula_fx_mux #(NUBITS)um(op,
                       in1, in2,
                       add, mlt, div, mod, neg,
                       nrm, abs, pst, sgn,
                       orr, ann, inv, cor,
                       les, gre, equ,
                       lin, lan, lor,
                       shl, shr, srs,
                       out);

assign is_zero = (out == {NUBITS{1'b0}});

endmodule