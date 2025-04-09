module proc_fft (
input clk, rst,
input signed [31:0] io_in,
output signed [31:0] io_out,
output [0:0] req_in,
output [1:0] out_en,
input itr);

wire signed [31:0] in_float;
wire signed [31:0] out_float;

assign in_float = io_in;

wire proc_req_in, proc_out_en;
wire [-1:0] addr_in;
wire [0:0] addr_out;

processor
#(.NUBITS(32),
.NBMANT(23),
.NBEXPO(8),
.NUGAIN(128),
.MDATAS(75),
.MINSTS(378),
.SDEPTH(10),
.NUIOIN(1),
.NUIOOU(2),
.FFTSIZ(3),
.CAL(1),
.LES(1),
.MLT(1),
.ADD(1),
.ILI(1),
.F_MLT(1),
.F_NEG(1),
.F_ADD(1),
.F_NEG_M(1),
.LDI(1),
.SRF(1),
.F2I(1),
.DFILE("proc_fft_data.mif"),
.IFILE("proc_fft_inst.mif")
) p_proc_fft (clk, rst, in_float, out_float, addr_in, addr_out, proc_req_in, proc_out_en, itr);

assign io_out = out_float;

assign req_in = proc_req_in;
addr_dec #(2) dec_out(proc_out_en, addr_out, out_en);

endmodule