// ****************************************************************************
// Circuitos Auxiliares *******************************************************
// ****************************************************************************

// Mux de saida ---------------------------------------------------------------

module opr_mux
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	input      [      4:0] op,

	input      [MAN+EXP:0] out_ufl,
	input      [MAN+EXP:0] out_ufx,

	input                   iz_ufl,
	input                   iz_ufx,

	output reg [MAN+EXP:0] out,
	output reg             is_zero
);

// saida principal

always @ (*) begin
	case (op)
		5'd0   : out <= out_ufl; // NOP
		5'd1   : out <= out_ufl; // LOAD
  
		5'd2   : out <= out_ufl; // ADD
		5'd3   : out <= out_ufl; // MLT
		5'd4   : out <= out_ufl; // DIV
		5'd5   : out <= out_ufx; // MOD
		5'd6   : out <= out_ufl; // NEG
  
		5'd7   : out <= out_ufx; // NORM
		5'd8   : out <= out_ufl; // ABS
		5'd9   : out <= out_ufl; // PST
		5'd10  : out <= out_ufl; // SIGN
  
		5'd11  : out <= out_ufx; // OR
		5'd12  : out <= out_ufx; // AND
		5'd13  : out <= out_ufx; // INV
		5'd14  : out <= out_ufx; // XOR
  
		5'd15  : out <= out_ufl; // LES
		5'd16  : out <= out_ufl; // GRE
		5'd17  : out <= out_ufl; // EQU

		5'd18  : out <= out_ufl; // LIN
		5'd19  : out <= out_ufl; // LAN
		5'd20  : out <= out_ufl; // LOR
  
		5'd21  : out <= out_ufx; // SHL
		5'd22  : out <= out_ufx; // SHR
		5'd23  : out <= out_ufx; // SRS

		default: out <= {MAN+EXP+1{1'bx}};
	endcase
end

// flag de se eh zero

always @ (*) begin
	case (op)
		5'd0   : is_zero <= iz_ufl; // NOP
		5'd1   : is_zero <= iz_ufl; // LOAD

		5'd2   : is_zero <= iz_ufl; // ADD
		5'd3   : is_zero <= iz_ufl; // MLT
		5'd4   : is_zero <= iz_ufl; // DIV
		5'd5   : is_zero <= iz_ufx; // MOD
		5'd6   : is_zero <= iz_ufl; // NEG

		5'd7   : is_zero <= iz_ufx; // NORM
		5'd8   : is_zero <= iz_ufl; // ABS
		5'd9   : is_zero <= iz_ufl; // PST
		5'd10  : is_zero <= iz_ufl; // SIGN

		5'd11  : is_zero <= iz_ufx; // OR
		5'd12  : is_zero <= iz_ufx; // AND
		5'd13  : is_zero <= iz_ufx; // INV
		5'd14  : is_zero <= iz_ufx; // XOR

		5'd15  : is_zero <= iz_ufl; // LES
		5'd16  : is_zero <= iz_ufl; // GRE
		5'd17  : is_zero <= iz_ufl; // EQU

		5'd18  : is_zero <= iz_ufl; // LIN
		5'd19  : is_zero <= iz_ufl; // LAN
		5'd20  : is_zero <= iz_ufl; // LOR

		5'd21  : is_zero <= iz_ufx; // SHL
		5'd22  : is_zero <= iz_ufx; // SHR
		5'd23  : is_zero <= iz_ufx; // SRS

		default: is_zero <= 1'bx;
	endcase
end

endmodule

// ULA interna em ponto fixo --------------------------------------------------

module ula_ifx
#(
 //Geral
	parameter           EXP =  8,
	parameter [EXP-1:0] MAN = 23,

 //Operacoes aritmeticas
 //parameter ADD  = 0,
 //parameter MLT  = 0,
 //parameter DIV  = 0,
	parameter MOD  = 0,
 //parameter NEG  = 0,

 //Operacoes criadas
	parameter NRM  = 0, // divide pela constante NUGAIN
 //parameter ABS  = 0, // valor absoluto
 //parameter PST  = 0, // zera se form negativo
 //parameter SGN  = 0, // pega o sinal de in1 e coloca em in2

 //Operacoes Logicas bitwise
	parameter OR   = 0,
	parameter AND  = 0,
	parameter INV  = 0,
	parameter XOR  = 0,

 //Operacoes de comparacao
 //parameter LES  = 0,
 //parameter GRE  = 0,
 //parameter EQU  = 0,

 //Operacoes Logicas que resultam em 1 bit (usado em if else while)
 //parameter LIN  = 0,
 //parameter LAN  = 0,
 //parameter LOR  = 0,

 //Operacoes de deslocamento de bits
	parameter SHR  = 0,
	parameter SHL  = 0,
	parameter SRS  = 0
)
(
	input         [      4:0] op,
	input         [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out,
	output                    is_zero
);

wire signed [MAN+EXP:0] fi1_out;
wire signed [MAN+EXP:0] fi2_out;

float2int #(EXP,MAN) fi1(in1,fi1_out);
float2int #(EXP,MAN) fi2(in2,fi2_out);

wire signed [MAN-1  :0] i2f_in;
wire        [MAN+EXP:0] i2f_out;

ula_fx #(.NUBITS(MAN),

       //.ADD(ADD),
       //.MLT(MLT),
       //.DIV(DIV),
         .MOD(MOD),
       //.NEG(NEG),

         .NRM(NRM),
       //.ABS(ABS),
       //.PST(PST),
       //.SGN(SGN),

         .OR (OR ),
         .AND(AND),
         .INV(INV),
         .XOR(XOR),

       //.LES(LES),
       //.GRE(GRE),
       //.EQU(EQU),

       //.LIN(LIN),
       //.LAN(LAN),
       //.LOR(LOR),

         .SHR(SHR),
         .SHL(SHL),
         .SRS(SRS)
        ) ufx(op,fi1_out[MAN-1:0],fi2_out[MAN-1:0],i2f_in,is_zero);

int2float #(MAN,EXP) i2f(i2f_in,out);

endmodule

// ****************************************************************************
// Circuito Principal *********************************************************
// ****************************************************************************

module ula
#(
 //Geral
	parameter           EXP =  8,
	parameter [EXP-1:0] MAN = 23,

 //Operacoes aritmeticas
	parameter ADD  = 0,
	parameter MLT  = 0,
	parameter DIV  = 0,
	parameter MOD  = 0,
	parameter NEG  = 0,

 //Operacoes criadas
	parameter NRM  = 0, // divide pela constante NUGAIN
	parameter ABS  = 0, // valor absoluto
	parameter PST  = 0, // zera se form negativo
	parameter SGN  = 0, // pega o sinal de in1 e coloca em in2

 //Operacoes Logicas bitwise
	parameter OR   = 0,
	parameter AND  = 0,
	parameter INV  = 0,
	parameter XOR  = 0,

 //Operacoes de comparacao
	parameter LES  = 0,
	parameter GRE  = 0,
	parameter EQU  = 0,

 //Operacoes Logicas que resultam em 1 bit (usado em if else while)
	parameter LIN  = 0,
	parameter LAN  = 0,
	parameter LOR  = 0,

 //Operacoes de deslocamento de bits
	parameter SHR  = 0,
	parameter SHL  = 0,
	parameter SRS  = 0
)
(
	input         [      4:0] op,
	input         [MAN+EXP:0] in1, in2,
	output        [MAN+EXP:0] out,
	output                    is_zero
);

wire [MAN+EXP:0] out_ufl;

wire iz_ufl;

ula_fl #(.EXP(EXP),
         .MAN(MAN),

         .ADD(ADD),
         .MLT(MLT),
         .DIV(DIV),
       //.MOD(MOD),
         .NEG(NEG),

       //.NRM(NRM),
         .ABS(ABS),
         .PST(PST),
         .SGN(SGN),

       //.OR (OR ),
       //.AND(AND),
       //.INV(INV),
       //.XOR(XOR),

         .LES(LES),
         .GRE(GRE),
         .EQU(EQU),

         .LIN(LIN),
         .LAN(LAN),
         .LOR(LOR)

       //.SHR(SHR),
       //.SHL(SHL),
       //.SRS(SRS)
        ) ufl (op,in1,in2,out_ufl,iz_ufl);

generate

if (MOD || NRM || OR || AND || INV || XOR || SHR || SHL ||| SRS) begin

wire [MAN+EXP:0] out_ufx;

wire iz_ufx;

ula_ifx #(.EXP(EXP),
         .MAN(MAN),

       //.ADD(ADD),
       //.MLT(MLT),
       //.DIV(DIV),
         .MOD(MOD),
       //.NEG(NEG),

         .NRM(NRM),
       //.ABS(ABS),
       //.PST(PST),
       //.SGN(SGN),

         .OR (OR ),
         .AND(AND),
         .INV(INV),
         .XOR(XOR),

       //.LES(LES),
       //.GRE(GRE),
       //.EQU(EQU),

       //.LIN(LIN),
       //.LAN(LAN),
       //.LOR(LOR),

         .SHR(SHR),
         .SHL(SHL),
         .SRS(SRS)
        ) ifx(op,in1,in2,out_ufx,iz_ufx);


opr_mux #(EXP,MAN) om(op,out_ufl,out_ufx,iz_ufl,iz_ufx,out,is_zero);

end else begin

assign out = out_ufl;
assign is_zero = iz_ufl;

end

endgenerate

endmodule