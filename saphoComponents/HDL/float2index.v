module float2index
#(
	parameter EXP = 8,
	parameter MAN = 23
)
(
	input  [MAN+EXP-1:0] in,
	output [MAN    -1:0] out
);

wire signed [EXP-1:0] e     = in[MAN+EXP-1:MAN];
wire        [MAN-1:0] m     = in[MAN    -1:  0];
wire        [EXP-1:0] shift = (e[EXP-1]) ? -e : e;

assign out = (e[EXP-1]) ? m >> shift : m << shift;

endmodule