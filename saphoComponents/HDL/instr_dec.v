module instr_dec
#(
	parameter NBDATA = 32, // Numero de bits dos dados
	parameter NBOPCO = 7,  // Numero de bits de  opcode
	parameter NBOPER = 9,  // Numero de bits de  operando
	parameter MDATAW = 8   // Numero de bits de  endereco da memoria de dados
)
(
	input                   clk, rst,
	input      [NBOPCO-1:0] opcode,
	input      [NBOPER-1:0] operand,

	output reg              push, pop,

	output reg [       5:0] ula_op,

	output reg              mem_wr,
	output reg              req_in, out_en,
	output reg              sti, ldi,
	output reg              fft
);

reg [5:0] wula_op; always @ (posedge clk) ula_op <= wula_op;

always @ (*) begin
	case (opcode)
			0 : begin
						wula_op  <= 6'd1;     // LOD -> carrega accumulador com dado da memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			1 : begin
						wula_op  <= 6'd1;     // P_LOD -> PSH e LOD
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			2 : begin
						wula_op  <= 6'd1;     // LDI -> Load com enderecamentto indireto
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b1;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			3 : begin
						wula_op  <= 6'd1;     // ILI -> Load com enderecamento indireto invertido
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b1;
						sti      <= 1'b0;
						fft      <= 1'b1;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			4 : begin
						wula_op  <= 6'd0;     // SET -> carrega memoria com valor do acumulador
						mem_wr   <= 1'b1;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			5 : begin
						wula_op  <= 6'd1;     // SET_P -> SET e POP
						mem_wr   <= 1'b1;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			6 : begin
						wula_op  <= 6'd0;     // STI -> Set com enderecamento indireto
						mem_wr   <= 1'b1;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b1;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			7 : begin
						wula_op  <= 6'd0;     // ISI -> STI com bits invertidos
						mem_wr   <= 1'b1;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b1;
						fft      <= 1'b1;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			8: begin
						wula_op  <= 6'd0;     // PSH
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			9 : begin
						wula_op  <= 6'd1;     // POP
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			10: begin
						wula_op  <= 6'd1;     // INN -> Input de dados
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b1;
						out_en   <= 1'b0;
					end
			11: begin
						wula_op  <= 6'd1;     // P_INN -> PUSH + INN
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b1;
						out_en   <= 1'b0;
					end
			12: begin
						wula_op  <= 6'd0;     // OUT -> Output de Dados
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b1;
					end
			13: begin
						wula_op  <= 6'd0;     // JMP (ver prefetch)
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			14: begin
						wula_op  <= 6'd0;     // JIZ (ver prefetch)
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			15: begin
						wula_op  <= 6'd0;     // CAL (ver prefetch)
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			16: begin
						wula_op  <= 6'd0;     // RET
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			17: begin
						wula_op  <= 6'd2;     // ADD -> adicao com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			18: begin
						wula_op  <= 6'd2;     // S_ADD -> adicao com a pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			19: begin
						wula_op  <= 6'd3;     // F_ADD -> adicao em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			20: begin
						wula_op  <= 6'd3;     // SF_ADD -> adicao em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			21: begin
						wula_op  <= 6'd4;     // MLT -> multiplica dado da memoria com o acumulador
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			22: begin
						wula_op  <= 6'd4;     // S_MLT -> multiplicacao com a pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			23: begin
						wula_op  <= 6'd5;     // F_MLT -> multiplicacao em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			24: begin
						wula_op  <= 6'd5;     // SF_MLT -> multiplicacao em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			25: begin
						wula_op  <= 6'd6;     // DIV -> divide com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			26: begin
						wula_op  <= 6'd6;     // S_DIV -> divide com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			27: begin
						wula_op  <= 6'd7;     // F_DIV -> divisao em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			28: begin
						wula_op  <= 6'd7;     // SF_DIV -> divisao em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			29: begin
						wula_op  <= 6'd8;     // MOD -> modulo da divisao com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			30: begin
						wula_op  <= 6'd8;     // S_MOD -> modulo da divisao com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			31: begin
						wula_op  <= 6'd9;     // SGN -> pega o sinal de in1 e coloca en in2
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			32: begin
						wula_op  <= 6'd9;     // S_SGN -> SGN com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			33: begin
						wula_op  <= 6'd10;    // F_SGN -> SGN em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			34: begin
						wula_op  <= 6'd10;    // SF_SGN -> SGN em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			35: begin
						wula_op  <= 6'd11;    // NEG -> Complemento a 2
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			36: begin
						wula_op  <= 6'd12;    // NEG_M -> negativo com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			37: begin
						wula_op  <= 6'd12;    // P_NEG_M -> negativo com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			38: begin
						wula_op  <= 6'd13;    // F_NEG -> negativo em ponto flutuante com acc
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			39: begin
						wula_op  <= 6'd14;    // F_NEG_M -> negativo em ponto flutuante com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			40: begin
						wula_op  <= 6'd14;    // PF_NEG_M -> negativo em ponto flutuante com memoria dando um push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			41: begin
						wula_op  <= 6'd15;    // ABS -> retorna o valor absoluto do acc (exemplo: x = abs(y))
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			42: begin
						wula_op  <= 6'd16;    // ABS_M -> ABS com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			43: begin
						wula_op  <= 6'd16;    // P_ABS_M -> ABS com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			44: begin
						wula_op  <= 6'd17;    // F_ABS -> ABS em ponto flutuante
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			45: begin
						wula_op  <= 6'd18;    // F_ABS_M -> ABS em ponto flutuante com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			46: begin
						wula_op  <= 6'd18;    // PF_ABS_M -> ABS em ponto flutuante com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			47: begin
						wula_op  <= 6'd19;    // PST -> carrega o valor do acumulador ou zero se for negativo
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			48: begin
						wula_op  <= 6'd20;    // PST_M -> PST com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			49: begin
						wula_op  <= 6'd20;    // P_PST_M -> PST com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			50: begin
						wula_op  <= 6'd21;    // F_PST -> PST em ponto flutuante
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			51: begin
						wula_op  <= 6'd22;    // F_PST_M -> PST em ponto flutuante com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			52: begin
						wula_op  <= 6'd22;    // PF_PST_M -> PST em ponto flutuante com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			53: begin
						wula_op  <= 6'd23;    // NRM -> Divisao do acc por uma constante (exemplo: />300)
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			54: begin
						wula_op  <= 6'd24;    // NRM_M -> NRM com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			55: begin
						wula_op  <= 6'd24;    // P_NRM_M -> NRM com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			56: begin
						wula_op  <= 6'd25;    // I2F -> int2float com acumulador
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			57: begin
						wula_op  <= 6'd26;    // I2F_M -> int2float com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			58: begin
						wula_op  <= 6'd26;    // P_I2F_M -> int2float com memoria, dando um push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			59: begin
						wula_op  <= 6'd27;    // F2I -> float2int com acumulador
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			60: begin
						wula_op  <= 6'd28;    // F2I_M -> float2int com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			61: begin
						wula_op  <= 6'd28;    // P_F2I_M -> float2int com memoria, dando um push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			62: begin
						wula_op  <= 6'd29;    // AND -> and bit a bit com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			63: begin
						wula_op  <= 6'd29;    // S_AND -> and bit a bit com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			64: begin
						wula_op  <= 6'd30;    // ORR -> ou bit a bit com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			65: begin
						wula_op  <= 6'd30;    // S_ORR -> ou bit a bit com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			66: begin
						wula_op  <= 6'd31;    // XOR -> ou exclusivo bit a bit com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			67: begin
						wula_op  <= 6'd31;    // S_XOR -> ou exclusivo bit a bit com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			68: begin
						wula_op  <= 6'd32;    // INV -> Inverte bit a bit o acumulador
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			69: begin
						wula_op  <= 6'd33;    // INV_M -> INV com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			70: begin
						wula_op  <= 6'd33;    // P_INV_M -> INV com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			71: begin
						wula_op  <= 6'd34;    // LAN -> and logico com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			72: begin
						wula_op  <= 6'd34;    // S_LAN -> and logico com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			73: begin
						wula_op  <= 6'd35;    // LOR -> ou logico com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			74: begin
						wula_op  <= 6'd35;    // S_LOR -> ou logico com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			75: begin
						wula_op  <= 6'd36;    // LIN -> Inverte bit condicional
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			76: begin
						wula_op  <= 6'd37;    // LIN_M -> LIN com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			77: begin
						wula_op  <= 6'd37;    // P_LIN_M -> LIN com memoria dando push antes
						mem_wr   <= 1'b0;
						push     <= 1'b1;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			78: begin
						wula_op  <= 6'd38;    // LES -> Menor do que com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			79: begin
						wula_op  <= 6'd38;    // S_LES -> Menor do que com a pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			80: begin
						wula_op  <= 6'd39;    // F_LES -> menor que em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			81: begin
						wula_op  <= 6'd39;    // SF_LES -> menor que em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			82: begin
						wula_op  <= 6'd40;    // GRE -> maior do que com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			83: begin
						wula_op  <= 6'd40;    // S_GRE -> maior do que com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			84: begin
						wula_op  <= 6'd41;    // F_GRE -> maior que em ponto flutuante com a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			85: begin
						wula_op  <= 6'd41;    // SF_GRE -> maior que em ponto flutuante com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			86: begin
						wula_op  <= 6'd42;    // EQU -> Igual com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			87: begin
						wula_op  <= 6'd42;    // S_EQU -> Igual com a pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			88: begin
						wula_op  <= 6'd43;    // SHL -> shift pra esquerda com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			89: begin
						wula_op  <= 6'd43;    // S_SHL -> shift pra esquerda com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			90: begin
						wula_op  <= 6'd44;    // SHR -> Shift pra direita com memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			91: begin
						wula_op  <= 6'd44;    // S_SHR -> Shift pra direita com pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			
			92: begin
						wula_op  <= 6'd45;    // SRS -> Shift pra direita com sinal usando a memoria
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b0;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
			93: begin
						wula_op  <= 6'd45;    // S_SRS -> Shift pra direita com sinal usando a pilha
						mem_wr   <= 1'b0;
						push     <= 1'b0;
						pop      <= 1'b1;
						ldi      <= 1'b0;
						sti      <= 1'b0;
						fft      <= 1'b0;
						req_in   <= 1'b0;
						out_en   <= 1'b0;
					end
		default: begin
						wula_op  <= 6'dx;
						mem_wr   <= 1'bx;
						push     <= 1'bx;
						pop      <= 1'bx;
						ldi      <= 1'bx;
						sti      <= 1'bx;
						fft      <= 1'bx;
						req_in   <= 1'bx;
						out_en   <= 1'bx;
					end
	endcase
end

endmodule