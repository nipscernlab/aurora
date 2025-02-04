// ****************************************************************************
// Circuitos Auxiliares *******************************************************
// ****************************************************************************

// Multiplexador do modulo de normalizacao ------------------------------------

module mymux
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

// Modulo de normalizacao ---------------------------------------------------  

module norm
#(
	parameter EXP = 8,
	parameter MAN = 23
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
wire        [MAN-1:0] out_m =  man << sh;

mymux #(1, EXP)mm1(man[MAN-1], 1'b0, {{EXP-1{1'b0}}, {1'b1}}, {EXP{1'b0}}, w[0]);

genvar i;

generate
	for (i = 1; i < MAN-1; i = i+1) begin : norm
		mymux #(i+1, EXP)mm(man[MAN-1:MAN-1-i], {i+1{1'b0}}, i[EXP-1:0] + {{EXP-1{1'b0}}, {1'b1}}, w[i-1], w[i]);
	end
endgenerate

assign out = {out_s, out_e, out_m};

endmodule

// Desnormaliza igualando o expoente de dois numeros --------------------------

module denorm
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input        [MAN+EXP:0] in1, in2,
	output signed [EXP-1  :0]   e_out,
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

// Multiplexador das operacoes ------------------------------------------------

module outmux
#(
	parameter NBITS = 32
)
(
	input     [      4:0] op,
	input     [NBITS-1:0] in1,in2,
	input     [NBITS-1:0] sum,mul,div,/*mod,*/neg,
	input     [NBITS-1:0] /*nrm,*/abs,pst,sgn,
 //input     [NBITS-1:0] orr,ann,inv,cor,
	input     [NBITS-1:0] les,gre,equ,
	input     [NBITS-1:0] lin,lan,lor,
 //input     [NBITS-1:0] shl,shr,srs,

  output reg [NBITS-1:0] out
);

always @ (*) begin
	case (op)
		5'd0   : out <= in2; // NOP
		5'd1   : out <= in1; // LOAD
  
		5'd2   : out <= sum; // ADD
		5'd3   : out <= mul; // MLT
		5'd4   : out <= div; // DIV
	 //5'd5   : out <= mod; // MOD    soh na ula_fx
		5'd6   : out <= neg; // NEG
  
	 //5'd7   : out <= nrm; // NORM   soh na ula_fx
		5'd8   : out <= abs; // ABS
		5'd9   : out <= pst; // PST
		5'd10  : out <= sgn; // SIGN
  
	 //5'd11  : out <= orr; // OR     ainda nao implementei na ula_fl
	 //5'd12  : out <= ann; // AND    precisa?
	 //5'd13  : out <= inv; // INV
	 //5'd14  : out <= cor; // XOR
  
		5'd15  : out <= les; // LES
		5'd16  : out <= gre; // GRE
		5'd17  : out <= equ; // EQU
  
		5'd18  : out <= lin; // LIN
		5'd19  : out <= lan; // LAN
		5'd20  : out <= lor; // LOR
  
	 //5'd21  : out <= shl; // SHL    soh na ula_fx
	 //5'd22  : out <= shr; // SHR
	 //5'd23  : out <= srs; // SRS

		default: out <= {NBITS{1'bx}};
	endcase
end

endmodule

// ****************************************************************************
// Circuitos Aritmeticos ******************************************************
// ****************************************************************************

// Soma em ponto-flutuante ----------------------------------------------------

module mysoma
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	input  signed [EXP-1  :0] e_in,
	input  signed [MAN    :0] sm1_in, sm2_in,
	output        [MAN+EXP:0] out
);

wire signed [MAN+1:0] soma = sm1_in + sm2_in;
wire signed [MAN+1:0] m    = (soma[MAN+1]) ? -soma : soma;

wire                  s_out = soma[MAN+1];
wire signed [EXP-1:0] e_out = e_in + {{EXP-1{1'b0}}, {1'b1}}; // colocar limite para +inf
wire        [MAN-1:0] m_out = m   [MAN:1];

assign out = {s_out, e_out, m_out};

endmodule

// Multiplicacao em ponto-flutuante -------------------------------------------

module mymult
#(
	parameter EXP = 8,
	parameter MAN = 23
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

// Divisao em ponto-flutuante -------------------------------------------------

module mydiv
#(
	parameter EXP = 8,
	parameter MAN = 23
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
wire [2*MAN-2:0] div    = m1_ext / m2;

wire                  s_out = (s1 != s2);
wire signed [EXP-1:0] e_out = e1 - e2 - MAN + {{EXP-1{1'b0}}, {1'b1}};
wire        [MAN-1:0] m_out = div[MAN-1:0];

assign out = {s_out, e_out, m_out};

endmodule

// PST ------------------------------------------------------------------------

module mypst
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out
);

wire                  s_in = in[MAN+EXP      ]; 
wire signed [EXP-1:0] e_in = in[MAN+EXP-1:MAN];
wire        [MAN-1:0] m_in = in[MAN    -1:0  ];

wire                  s_out = 0;
wire signed [EXP-1:0] e_out = (s_in) ? {       EXP  {1'b0} } : e_in;
wire        [MAN-1:0] m_out = (s_in) ? {1'b0, {MAN-1{1'b0}}} : m_in;

assign out = {s_out, e_out, m_out};

endmodule

// NEG ------------------------------------------------------------------------

module myneg
#(
	parameter EXP = 8,
	parameter MAN = 23
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

// LES ------------------------------------------------------------------------

module myles
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	input  signed [MAN    :0] m1, m2,
	output        [MAN+EXP:0] out
);

wire                  s_out =      1'b0;
wire signed [EXP-1:0] e_out = {EXP{1'b0}};
wire        [MAN-1:0] m_out = (m1 < m2) ? {{MAN-1{1'b0}}, 1'b1} : {1'b0, {MAN-1{1'b0}}};

assign out = {s_out, e_out, m_out};

endmodule

// EQU ------------------------------------------------------------------------

module myequ
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input        [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out
);

wire                    s_out =      1'b0;
wire signed [EXP-1  :0] e_out = {EXP{1'b0}};
wire        [MAN-1  :0] m_out = (in1 == in2) ? {{MAN-1{1'b0}}, 1'b1} : {1'b0, {MAN-1{1'b0}}};

assign out = {s_out, e_out, m_out};

endmodule

// INV ------------------------------------------------------------------------

module myinv
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input        [MAN+EXP:0] in,
	output        [MAN+EXP:0] out
);

wire                    s_out =      1'b0;
wire signed [EXP-1  :0] e_out = {EXP{1'b0}};
wire        [MAN-1  :0] m_out = (in == {1'b0, 1'b1, {MAN+EXP-1{1'b0}}}) ? {{MAN-1{1'b0}}, 1'b1} : {1'b0, {MAN-1{1'b0}}};

assign out = {s_out, e_out, m_out};

endmodule

// AND ------------------------------------------------------------------------

module myand
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input        [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out
);

wire                    s_out =      1'b0;
wire signed [EXP-1  :0] e_out = {EXP{1'b0}};
wire        [MAN-1  :0] m_out = ((in1 == {1'b0, 1'b1, {MAN+EXP-1{1'b0}}}) || (in2 == {1'b0, 1'b1, {MAN+EXP-1{1'b0}}})) ? {1'b0, {MAN-1{1'b0}}} : {{MAN-1{1'b0}}, 1'b1};

assign out = {s_out, e_out, m_out};

endmodule

// GRE ------------------------------------------------------------------------

module mygre
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	input  signed [MAN    :0] m1, m2,
	output        [MAN+EXP:0] out
);

wire                  s_out =      1'b0;
wire signed [EXP-1:0] e_out = {EXP{1'b0}};
wire        [MAN-1:0] m_out = (m1 > m2) ? {{MAN-1{1'b0}}, 1'b1} : {1'b0, {MAN-1{1'b0}}};

assign out = {s_out, e_out, m_out};

endmodule

// LOR ------------------------------------------------------------------------

module myorr
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input        [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out
);

wire                    s_out =      1'b0;
wire signed [EXP-1  :0] e_out = {EXP{1'b0}};
wire        [MAN-1  :0] m_out = ((in1 != {1'b0, 1'b1, {MAN+EXP-1{1'b0}}}) || (in2 != {1'b0, 1'b1, {MAN+EXP-1{1'b0}}})) ? {{MAN-1{1'b0}}, 1'b1} : {1'b0, {MAN-1{1'b0}}};

assign out = {s_out, e_out, m_out};

endmodule

// ABS ------------------------------------------------------------------------

module myabs
#(
	parameter EXP = 8,
	parameter MAN = 23
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

// SIGN -----------------------------------------------------------------------

module mysgn
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	 input              s,
	 input [MAN+EXP:0] in,
	output [MAN+EXP:0] out 
);

wire                  s_out = s;
wire signed [EXP-1:0] e_out = in[EXP+MAN-1:MAN];
wire        [MAN-1:0] m_out = in[MAN    -1:  0];

assign out = {s_out, e_out, m_out};

endmodule

// ****************************************************************************
// Circuito Principal *********************************************************
// ****************************************************************************

module ula_fl
#(
 //Geral
	parameter           EXP =  8,
	parameter [EXP-1:0] MAN = 23,

 //Operacoes aritmeticas
	parameter ADD  = 0,
	parameter MLT  = 0,
	parameter DIV  = 0,
 //parameter MOD  = 0,    soh pra ula_fx
	parameter NEG  = 0,

 //Operacoes criadas
 //parameter NRM  = 0, // divide pela constante NUGAIN
	parameter ABS  = 0, // valor absoluto
	parameter PST  = 0, // zera se form negativo
	parameter SGN  = 0, // pega o sinal de in1 e coloca em in2

 //Operacoes Logicas bitwise
 //parameter OR   = 0,    soh pra ula_fx
 //parameter AND  = 0,
 //parameter INV  = 0,
 //parameter XOR  = 0,

 //Operacoes de comparacao
	parameter LES  = 0,
	parameter GRE  = 0,
	parameter EQU  = 0,

 //Operacoes Logicas que resultam em 1 bit (usado em if else while)
	parameter LIN  = 0,
	parameter LAN  = 0,
	parameter LOR  = 0

 //Operacoes de deslocamento de bits
 //parameter SHR  = 0,    soh pra ula_fx
 //parameter SHL  = 0,
 //parameter SRS  = 0
)
(
	input         [      4:0] op,
	input         [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out,
	output                    is_zero
);

// desnormaliza ---------------------------------------------------------------

wire signed [EXP-1:0] de;
wire signed [MAN  :0] dm1, dm2;

denorm #(EXP, MAN) denorm(in1, in2, de, dm1, dm2);

// soma -----------------------------------------------------------------------

wire [EXP+MAN:0] sum_out;

generate if (ADD == 1) begin

	mysoma #(EXP,MAN) mysoma(de,dm1,dm2,sum_out);

end else begin

	assign sum_out = {EXP+MAN+1{1'bx}};
	
end endgenerate

// multiplica -----------------------------------------------------------------

wire [EXP+MAN:0] mul_out;

generate if (MLT == 1) begin

	mymult #(EXP,MAN) mymult(in1,in2,mul_out);

end else begin

	assign mul_out = {EXP+MAN+1{1'bx}};

end endgenerate

// divide ---------------------------------------------------------------------

wire [EXP+MAN:0] div_out;

generate if (DIV == 1) begin

	mydiv #(EXP,MAN) mydiv (in1,in2,div_out);

end else begin

	assign div_out = {EXP+MAN+1{1'bx}};

end endgenerate

// PST ------------------------------------------------------------------------

wire [EXP+MAN:0] pst_out;

generate if (PST == 1) begin

	mypst #(EXP,MAN) mypst (in2,pst_out);

end else begin

	assign pst_out = {EXP+MAN+1{1'bx}};

end endgenerate

// NEG ------------------------------------------------------------------------

wire [EXP+MAN:0] neg_out;

generate if (NEG == 1) begin

	myneg #(EXP,MAN) myneg (in2,neg_out);

end else begin

	assign neg_out = {EXP+MAN+1{1'bx}};

end endgenerate

// LES ------------------------------------------------------------------------

wire [EXP+MAN:0] les_out;

generate if (LES == 1) begin

	myles #(EXP,MAN) myles (dm1,dm2,les_out);

end else begin

	assign les_out = {EXP+MAN+1{1'bx}};

end endgenerate

// EQU ------------------------------------------------------------------------

wire [EXP+MAN:0] equ_out;

generate if (EQU == 1) begin

	myequ #(EXP,MAN) myequ (in1,in2,equ_out);

end else begin

	assign equ_out = {EXP+MAN+1{1'bx}};

end endgenerate

// INV ------------------------------------------------------------------------

wire [EXP+MAN:0] inv_out;

generate if (LIN == 1) begin

	myinv #(EXP,MAN) myinv (in2,inv_out);

end else begin

	assign inv_out = {EXP+MAN+1{1'bx}};

end endgenerate

// AND ------------------------------------------------------------------------

wire [EXP+MAN:0] and_out;

generate if (LAN == 1) begin

	myand #(EXP,MAN) myand (in1,in2,and_out);

end else begin

	assign and_out = {EXP+MAN+1{1'bx}};

end endgenerate

// GRE ------------------------------------------------------------------------

wire [EXP+MAN:0] gre_out;

generate if (GRE == 1) begin

	mygre #(EXP,MAN) mygre (dm1,dm2,gre_out);

end else begin

	assign gre_out = {EXP+MAN+1{1'bx}};

end endgenerate

// LOR ------------------------------------------------------------------------

wire [EXP+MAN:0] orr_out;

generate if (LOR == 1) begin

	myorr #(EXP,MAN) myorr (in1,in2,orr_out);

end else begin

	assign orr_out = {EXP+MAN+1{1'bx}};

end endgenerate

// ABS ------------------------------------------------------------------------

wire [EXP+MAN:0] abs_out;

generate if (ABS == 1) begin

	myabs #(EXP,MAN) myabs (in2,abs_out);

end else begin

	assign abs_out = {EXP+MAN+1{1'bx}};

end endgenerate

// SIGN -----------------------------------------------------------------------

wire [EXP+MAN:0] sgn_out;

generate if (SGN == 1) begin

	mysgn #(EXP,MAN) mysgn (in1[EXP+MAN],in2,sgn_out);

end else begin

	assign sgn_out = {EXP+MAN+1{1'bx}};

end endgenerate

// multiplexadores da saida ---------------------------------------------------

wire    [EXP+MAN:0] mux_out;

outmux #(EXP+MAN+1) omux_s(op,
                           in1,in2,
                           sum_out,mul_out,div_out,/*mod,*/neg_out,
                         /*nrm,*/abs_out,pst_out,sgn_out,
                         //orr,ann,inv,cor,
                           les_out,gre_out,equ_out,
                           inv_out,and_out,orr_out,
                         //shl,shr,srs,
                           mux_out);

// normaliza ------------------------------------------------------------------

norm #(EXP, MAN) norm(mux_out,out);

assign is_zero = (out == {1'b0, 1'b1, {MAN+EXP-1{1'b0}}});

endmodule