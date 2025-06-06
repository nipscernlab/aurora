module top_level(
					  input signed [15:0] data,
					  input wrreq,
					  input clk, rst_geral, rst_proc,
					  output wire signed [31:0] out0, out1, out2, out3, out4, out0_DTW, out1_DTW, out2_DTW,
					  output empty, full, almost_empty,
					  output signed [15:0] q,
					  output signed [6:0] usedw,
					  output wire [1:0] req_in,
					  output wire [4:0] out_en,
					  output wire [2:0] out_en_DTW
					  );
					  
		wire [2:0] req_in_DTW;
		wire [1:0] out_maq;
		wire signed [31:0] data_proc = data;
		wire signed [31:0] in1_proc_DTW = q;
		wire flag_zc = |out1;
		
		
//registrador do used_w - 1:
reg [6:0] reg_usedw_1;
wire signed [31:0] in2_proc_DTW = reg_usedw_1;
always @ (posedge clk or posedge rst_geral)
begin
	if(rst_geral)
	begin
		reg_usedw_1 <= 7'd0;
	end
	else
	begin
		if(out_maq[1])
			reg_usedw_1 <= usedw - 7'd1;
	end
end

myFIFO	#(.WORD(16), .LENGTH(128), .ALMOST(2))
	FIFO16x32_inst_my (
	.clk ( clk ),
	.data ( data ),
	.rdreq ( req_in_DTW[1] ),
	.sclr ( rst_geral ),
	.wrreq ( wrreq ),
	.almost_empty ( almost_empty ),
	.empty ( empty ),
	.full ( full ),
	.q ( q),
	.usedw ( usedw )
	);

//FIFO16x32	FIFO16x32_inst (
//	.clock ( clk ),
//	.data ( data ),
//	.rdreq ( req_in_DTW[1] ),
//	.sclr ( rst_geral ),
//	.wrreq ( wrreq ),
//	.almost_empty ( almost_empty ),
//	.empty ( empty ),
//	.full ( full ),
//	.q ( q ),
//	.usedw ( usedw )
//	);
		
		
ProcZeroCross ProcZeroCross_inst(
			.clk(clk), 
			.rst_geral(rst_geral), 
			.rst_proc(rst_proc),
			.in0(32'd0),
			.in1(data_proc),
			.out0(out0), 
			.out1(out1), 
			.out2(out2), 
			.out3(out3), 
			.out4(out4),
			.req_in(req_in),
			.out_en(out_en)
		 );
		 
		 
ProcDTWv4 ProcDTWv4_inst(
			.clk(clk),
			.rst_geral(rst_geral), 
			.rst_proc(out_maq[0]),
			.in0(32'd0/*in0_proc_DTW*/),
			.in1(in1_proc_DTW),
			.in2(in2_proc_DTW),
			.out0(out0_DTW),
			.out1(out1_DTW), 
			.out2(out2_DTW),
			.req_in(req_in_DTW),
			.out_en(out_en_DTW)
		 );
		 
		 
maq_estados maq_estados_inst(
									  .clk(clk),
									  .rst_geral(rst_geral),
									  .flag_zc(flag_zc),
									  .almost_empty_FIFO((almost_empty)&(!empty)),
									  .out(out_maq) // out[1] o enable do registrador used_w - 1; out[0] o rst do proc dtw ;
);


		 
endmodule