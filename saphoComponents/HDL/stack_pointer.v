module stack_pointer
#(
	parameter              NDATAW = 8,  // Numero de bits de endereco  da memoria
	parameter [NDATAW-1:0] NDATAS = 8   // Numero de         enderecos da memoria
)
(
	 input              clk   , rst,
	 input              push  , pop,
	output [NDATAW-1:0] addr_w, addr_r
);

reg         [NDATAW-1:0] cnt =    NDATAS-{{NDATAW-1{1'b0}}, {1'b1}};
wire signed [NDATAW-1:0] pm  = (push) ? -{{NDATAW-1{1'b0}}, {1'b1}} : {{NDATAW-1{1'b0}}, {1'b1}};

always @ (posedge clk or posedge rst) begin
	if (rst)
		cnt <= NDATAS-{{NDATAW-1{1'b0}}, {1'b1}};
	else if (push | pop)
		cnt <= cnt + pm;
end

assign addr_w = cnt;
assign addr_r = cnt + pm;

endmodule 