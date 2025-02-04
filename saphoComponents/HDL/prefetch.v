module prefetch
#
(
	parameter  MINSTW = 8,
	parameter  NBOPCO = 6,
	parameter  NBOPER = 9,

	parameter [MINSTW-1:0] ITRADD = 0
)
(
	 input                         clk, rst   ,
	 input     [MINSTW       -1:0] addr       ,
	output     [NBOPCO       -1:0] opcode     ,
	output     [NBOPER       -1:0] operand    ,
 
	 input     [NBOPCO+NBOPER-1:0] instr      ,
	output     [MINSTW       -1:0] instr_addr ,
 
	output                         pc_l       ,
	 input                         acc_is_zero,

	output reg                     isp_push   ,
	output reg                     isp_pop    ,

	input                          itr
);

reg pc_load;

assign opcode  =  instr[NBOPCO+NBOPER-1:NBOPER];
assign operand =  instr[NBOPER       -1:     0];

assign pc_l = itr | pc_load;

assign instr_addr = (itr) ? ITRADD: (pc_load & ~rst) ? operand[MINSTW-1:0] : addr;

always @ (*) begin
	case (opcode)
		5       : begin
						 pc_load <=  acc_is_zero;  // JZ
						isp_push <=         1'b0;
						isp_pop  <=         1'b0;
					 end
		6       : begin
						 pc_load <=         1'b1;  // JMP
						isp_push <=         1'b0;
						isp_pop  <=         1'b0;
					 end
		7       : begin
						 pc_load <=         1'b1;  // CALL
						isp_push <=         1'b1;
						isp_pop  <=         1'b0;
					 end
		8       : begin
						 pc_load <=         1'b1;  // RETURN
						isp_push <=         1'b0;
						isp_pop  <=         1'b1;
					 end
		default : begin
						 pc_load <=         1'b0;
						isp_push <=         1'b0;
						isp_pop  <=         1'b0;
					 end
	endcase
end

endmodule 