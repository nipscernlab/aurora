module mem_instr
#(
	parameter NADDRE =  8,
	parameter NBDATA = 12,
	parameter FNAME  = "instr.mif"
)
(
	input                           clk,
	input      [$clog2(NADDRE)-1:0] addr,
	output reg [NBDATA        -1:0] data = 0 // para o modelsim
);

reg [NBDATA-1:0] mem [0:NADDRE-1];

initial $readmemb(FNAME, mem);

wire wr = 0; // evitar warnings desnecessarios

always @ (posedge clk) begin
	data <= mem[addr];
	if (wr) mem[addr] <= 0;
end

endmodule 