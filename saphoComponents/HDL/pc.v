module pc
#(
	parameter NBITS = 8
)
(
	 input              clk, rst,
	 input             load,
	 input [NBITS-1:0] data,
	output [NBITS-1:0] addr
);

reg  [NBITS-1:0] cnt=0;
wire [NBITS-1:0] val;

assign val = (load) ? data : cnt;

always @ (posedge clk or posedge rst) begin
	if (rst)
		cnt <= 0;
	else
		cnt <= val + {{NBITS-1{1'b0}}, {1'b1}};
end

assign addr = cnt;

endmodule