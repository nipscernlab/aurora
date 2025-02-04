// pilha de subrotina - implementa a proria memoria

module stack
#(
	parameter             NADDR = 7,
	parameter [NADDR-1:0] DEPTH = 3,
	parameter             NBITS = 8
)
(
	input                   clk, rst,
	input                  push, pop,

	input      [NBITS-1:0] in,
	output reg [NBITS-1:0] out
);

reg [NBITS-1:0] mem [DEPTH-1:0];

// Stack Pointer --------------------------------------------------------------

reg         [NADDR-1:0] cnt = DEPTH    -{{NADDR-1{1'b0}}, {1'b1}};
wire signed [NADDR-1:0] pm  = (push) ? -{{NADDR-1{1'b0}}, {1'b1}} : {{NADDR-1{1'b0}}, {1'b1}};

always @ (posedge clk or posedge rst) begin
	if (rst)
		cnt <= DEPTH-{{NADDR-1{1'b0}}, {1'b1}};
	else if (push | pop)
		cnt <= cnt + pm;
end

// Stack ----------------------------------------------------------------------

always @ (posedge clk) begin
	if (push) mem[cnt] <= in;
end 

always @ (posedge clk) begin
	out <= mem[cnt + {{$clog2(DEPTH)-1{1'b0}}, {1'b1}} + pop];
end 

endmodule 