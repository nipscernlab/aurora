module addr_dec
#(
	parameter NPORT = 4
)
(
	input                          valid_in,
	input      [$clog2(NPORT)-1:0] index,
	output reg [       NPORT -1:0] valid_out
);

integer i;

always @* begin
	for (i = 0; i < NPORT; i = i+1) begin
		valid_out[i] <= valid_in & (index == i);
	end
end

endmodule