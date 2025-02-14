module myFIFO
#(
	parameter WORD   = 16,
	parameter LENGTH = 128,
	parameter ALMOST = 2
)
(
	input                           clock,
	input      [WORD          -1:0] data,
	input                           rdreq,
	input                           sclr,
	input                           wrreq,
	output                          almost_empty,
	output                          empty,
	output                          full,
	output reg [WORD          -1:0] q,
	output     [$clog2(LENGTH)-1:0] usedw
);

reg [WORD-1:0]  mem  [LENGTH-1:0];
reg [$clog2(LENGTH)-1:0] addr_w=0;
reg [$clog2(LENGTH)-1:0] addr_r=0;

reg wr=0;
always @ (posedge clock) wr<= wrreq;

always @ (posedge clock) begin
	if (sclr)
		addr_w <= 0;
	else if (wr & !full) begin
		mem[addr_w] <= data;
		addr_w <= addr_w+1'b1;
	end
end

always @ (posedge clock) begin
	if (sclr) begin
		addr_r <= 0;
	end else if (rdreq & !empty) begin
		addr_r <= addr_r+1'b1;
	end
end

always @ (*) q = mem[addr_r];

assign full         =  (addr_w+1'b1 == addr_r) &  wrreq;
assign empty        =  (addr_w      == addr_r) & ~wr;
assign usedw        =  (addr_w      >= addr_r) ?  addr_w-addr_r+wr : addr_w-addr_r;
assign almost_empty = ~(usedw       >= ALMOST);

endmodule