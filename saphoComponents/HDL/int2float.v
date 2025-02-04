module int2float
#(
	parameter MAN = 23,
	parameter EXP = 8
)
(
	input  signed [MAN-1  :0] in,
	output        [MAN+EXP:0] out
);

wire                  i2f_s = in[MAN-1];
wire signed [EXP-1:0] i2f_e = 0;
wire        [MAN-1:0] i2f_m = (i2f_s) ? -in : in;

assign out = {i2f_s, i2f_e, i2f_m};

endmodule 