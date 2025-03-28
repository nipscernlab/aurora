module mem_data
#(
	parameter NADDRE =  8,
	parameter NBDATA = 32,
	parameter FNAME  = "data.mif"
)
(
	input                                  clk,
	input                                   wr,
	input             [$clog2(NADDRE)-1:0] addr_w, addr_r,
	input      signed [NBDATA        -1:0] data_in,
	output reg signed [NBDATA        -1:0] data_out
);

reg [NBDATA-1:0] mem [0:NADDRE-1];

`ifdef YOSYS
  // Yosys vai ignorar isso
`else
	initial $readmemb(FNAME, mem);
`endif

always @ (posedge clk) begin
	if (wr) mem[addr_w] <= data_in;
end

always @ (posedge clk) begin
	data_out <= mem[addr_r];
end

endmodule