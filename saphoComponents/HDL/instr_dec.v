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

	output reg              dsp_push, dsp_pop,

	output reg [       5:0] ula_op,
	output     [NBDATA-1:0] ula_data,

	output reg              mem_wr,
	output     [MDATAW-1:0] mem_addr,
	input      [NBDATA-1:0] mem_data_in,

	input      [NBDATA-1:0] io_in,
	output reg              req_in, out_en,

	output reg              sti, ldi,
	output                  fft
);

reg fftl, fftr;

assign fft = fftl | fftr;

always @ (posedge clk or posedge rst) begin
	if (rst)     begin
						ula_op  <= 6'd0;
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
	end else case (opcode)
			0   : begin
						ula_op  <= 6'd1;     // LOD -> carrega accumulador com dado da memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			1   : begin
						ula_op  <= 6'd1;     // P_LOD -> PSH e LOD
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			2   : begin
						ula_op  <= 6'd1;     // LDI -> Load com enderecamentto indireto
						 sti    <= 1'b0;     // o offset esta no acumulador
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			3   : begin
						ula_op  <= 6'd1;     // ILI -> Load com enderecamento indireto invertido
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			4   : begin
						ula_op  <= 6'd0;     // SET -> carrega memoria com valor do acumulador
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			5   : begin
						ula_op  <= 6'd1;     // SET_P -> SET e POP
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			6   : begin
						ula_op  <= 6'd0;     // STI -> Set com enderecamento indireto
						 sti    <= 1'b1;     // o indice esta na pilha
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			7   : begin
						ula_op  <= 6'd0;     // ISI -> STI com bits invertidos
						 sti    <= 1'b1;
						fftr    <= 1'b1;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			8   : begin
						ula_op  <= 6'd0;     // PSH
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			9   : begin
						ula_op  <= 6'd1;     // POP
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			10  : begin
						ula_op  <= 6'd1;     // INN -> Input de dados
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b1;
						out_en  <= 1'b0;
					end
			11  : begin
						ula_op  <= 6'd0;     // OUT -> Output de Dados
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b1;
					end
			12  : begin
						ula_op  <= 6'd0;     // JMP (ver prefetch)
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			13  : begin
						ula_op  <= 6'd0;     // JIZ (ver prefetch)
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			14  : begin
						ula_op  <= 6'd0;     // CAL (ver prefetch)
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			15  : begin
						ula_op  <= 6'd0;     // RET
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			16  : begin
						ula_op  <= 6'd2;     // ADD -> adicao com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			17  : begin
						ula_op  <= 6'd2;     // S_ADD -> adicao com a pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			18  : begin
						ula_op  <= 6'd3;     // F_ADD -> adicao em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			19  : begin
						ula_op  <= 6'd3;     // SF_ADD -> adicao em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			20  : begin
						ula_op  <= 6'd4;     // MLT -> multiplica dado da memoria com o acumulador
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			21  : begin
						ula_op  <= 6'd4;     // S_MLT -> multiplicacao com a pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			22  : begin
						ula_op  <= 6'd5;     // F_MLT -> multiplicacao em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			23  : begin
						ula_op  <= 6'd5;     // SF_MLT -> multiplicacao em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			24  : begin
						ula_op  <= 6'd6;     // DIV -> divide com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			25  : begin
						ula_op  <= 6'd6;     // S_DIV -> divide com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			26  : begin
						ula_op  <= 6'd7;     // F_DIV -> divisao em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			27  : begin
						ula_op  <= 6'd7;     // SF_DIV -> divisao em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			28  : begin
						ula_op  <= 6'd8;     // MOD -> modulo da divisao com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			29  : begin
						ula_op  <= 6'd8;     // S_MOD -> modulo da divisao com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			30  : begin
						ula_op  <= 6'd9;     // SGN -> pega o sinal de in1 e coloca en in2
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			31  : begin
						ula_op  <= 6'd9;     // S_SGN -> SGN com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			32  : begin
						ula_op  <= 6'd10;    // F_SGN -> SGN em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			33  : begin
						ula_op  <= 6'd10;    // SF_SGN -> SGN em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			34  : begin
						ula_op  <= 6'd11;    // NEG -> Complemento a 2
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			35  : begin
						ula_op  <= 6'd12;    // NEG_M -> negativo com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			36  : begin
						ula_op  <= 6'd12;    // P_NEG_M -> negativo com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			37  : begin
						ula_op  <= 6'd13;    // F_NEG -> negativo em ponto flutuante com acc
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			38  : begin
						ula_op  <= 6'd14;    // F_NEG_M -> negativo em ponto flutuante com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			39  : begin
						ula_op  <= 6'd14;    // PF_NEG_M -> negativo em ponto flutuante com memoria dando um push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			40  : begin
						ula_op  <= 6'd15;    // ABS -> retorna o valor absoluto do acc (exemplo: x = abs(y)) 
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			41  : begin
						ula_op  <= 6'd16;    // ABS_M -> ABS com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			42  : begin
						ula_op  <= 6'd16;    // P_ABS_M -> ABS com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			43  : begin
						ula_op  <= 6'd17;    // F_ABS -> ABS em ponto flutuante
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			44  : begin
						ula_op  <= 6'd18;    // F_ABS_M -> ABS em ponto flutuante com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			45  : begin
						ula_op  <= 6'd18;    // PF_ABS_M -> ABS em ponto flutuante com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			46   : begin
						ula_op  <= 6'd19;    // PST -> carrega o valor do acumulador ou zero se for negativo
						 sti    <= 1'b0;
						fftr    <= 1'b0;
					   req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			47  : begin
						ula_op  <= 6'd20;    // PST_M -> PST com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			48  : begin
						ula_op  <= 6'd20;    // P_PST_M -> PST com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			49  : begin
						ula_op  <= 6'd21;    // F_PST -> PST em ponto flutuante
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			50  : begin
						ula_op  <= 6'd22;    // F_PST_M -> PST em ponto flutuante com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			51  : begin
						ula_op  <= 6'd22;    // PF_PST_M -> PST em ponto flutuante com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			52  : begin
						ula_op  <= 6'd23;    // NRM -> Divisao do acc por uma constante (exemplo: />300)
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			53  : begin
						ula_op  <= 6'd24;    // NRM_M -> NRM com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			54  : begin
						ula_op  <= 6'd24;    // P_NRM_M -> NRM com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			55  : begin
						ula_op  <= 6'd25;    // I2F -> int2float com acumulador 
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			56  : begin
						ula_op  <= 6'd26;    // I2F_M -> int2float com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			57  : begin
						ula_op  <= 6'd26;    // P_I2F_M -> int2float com memoria, dando um push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			58  : begin
						ula_op  <= 6'd27;    // F2I -> float2int com acumulador 
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			59  : begin
						ula_op  <= 6'd28;    // F2I_M -> float2int com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			60  : begin
						ula_op  <= 6'd28;    // P_F2I_M -> float2int com memoria, dando um push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
		    61  : begin
						ula_op  <= 6'd29;    // AND -> and bit a bit com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			62  : begin
						ula_op  <= 6'd29;    // S_AND -> and bit a bit com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			63  : begin
						ula_op  <= 6'd30;    // ORR -> ou bit a bit com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			64  : begin
						ula_op  <= 6'd30;    // S_ORR -> ou bit a bit com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			65  : begin
						ula_op  <= 6'd31;    // XOR -> ou exclusivo bit a bit com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			66  : begin
						ula_op  <= 6'd31;    // S_XOR -> ou exclusivo bit a bit com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			67  : begin
						ula_op  <= 6'd32;    // INV -> Inverte bit a bit o acumulador
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;     
						out_en  <= 1'b0;
					end
			68  : begin
						ula_op  <= 6'd33;    // INV_M -> INV com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			69  : begin
						ula_op  <= 6'd33;    // P_INV_M -> INV com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			70  : begin
						ula_op  <= 6'd34;    // LAN -> and logico com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			71  : begin
						ula_op  <= 6'd34;    // S_LAN -> and logico com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			72  : begin
						ula_op  <= 6'd35;    // LOR -> ou logico com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			73  : begin
						ula_op  <= 6'd35;    // S_LOR -> ou logico com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			74  : begin
						ula_op  <= 6'd36;    // LIN -> Inverte bit condicional
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			75  : begin
						ula_op  <= 6'd37;    // LIN_M -> LIN com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			76  : begin
						ula_op  <= 6'd37;    // P_LIN_M -> LIN com memoria dando push antes
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			77  : begin
						ula_op  <= 6'd38;    // LES -> Menor do que com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			78  : begin
						ula_op  <= 6'd38;    // S_LES -> Menor do que com a pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			79  : begin
						ula_op  <= 6'd39;    // F_LES -> menor que em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			80  : begin
						ula_op  <= 6'd39;    // SF_LES -> menor que em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			81  : begin
						ula_op  <= 6'd40;    // GRE -> maior do que com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			82  : begin
						ula_op  <= 6'd40;    // S_GRE -> maior do que com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			83  : begin
						ula_op  <= 6'd41;    // F_GRE -> maior que em ponto flutuante com a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			84  : begin
						ula_op  <= 6'd41;    // SF_GRE -> maior que em ponto flutuante com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			85  : begin
						ula_op  <= 6'd42;    // EQU -> Igual com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			86  : begin
						ula_op  <= 6'd42;    // S_EQU -> Igual com a pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			87  : begin
						ula_op  <= 6'd43;    // SHL -> shift pra esquerda com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			88  : begin
						ula_op  <= 6'd43;    // S_SHL -> shift pra esquerda com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			89  : begin
						ula_op  <= 6'd44;    // SHR -> Shift pra direita com memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			90  : begin
						ula_op  <= 6'd44;    // S_SHR -> Shift pra direita com pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			91  : begin
						ula_op  <= 6'd45;    // SRS -> Shift pra direita com sinal usando a memoria
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
			92  : begin
						ula_op  <= 6'd45;    // S_SRS -> Shift pra direita com sinal usando a pilha
						 sti    <= 1'b0;
						fftr    <= 1'b0;
						req_in  <= 1'b0;
						out_en  <= 1'b0;
					end
		default: begin
						ula_op  <= 6'dx;
						 sti    <= 1'bx;
						fftr    <= 1'bx;
						req_in  <= 1'bx;
						out_en  <= 1'bx;
					end
	endcase
end

always @ (*) begin
	case (opcode)
			0 : begin                     // LOD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			1 : begin                     // P_LOD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			2 : begin                     // LDI
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b1;
						fftl     <= 1'b0;
					end
			3 : begin                     // ILI
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b1;
						fftl     <= 1'b1;
					end
			4 : begin                     // SET
						mem_wr   <= 1'b1;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			5 : begin                     // SET_P
						mem_wr   <= 1'b1;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			6 : begin                     // STI
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			7 : begin                     // ISI
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			8: begin                      // PSH
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			9 : begin                     // POP
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			10: begin                     // INN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			11: begin                     // OUT
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			12: begin                      // JMP
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			13: begin                      // JIZ
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			14: begin                     // CAL
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			15: begin                     // RET
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			16: begin                     // ADD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			17: begin                     // S_ADD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			18: begin                     // F_ADD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			19: begin                     // SF_ADD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			20: begin                     // MLT
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			21: begin                     // S_MLT
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			22: begin                     // F_MLT
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			23: begin                     // SF_MLT
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			24: begin                     // DIV
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			25: begin                     // S_DIV
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			26: begin                     // F_DIV
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			27: begin                     // SF_DIV
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			28: begin                     // MOD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			29: begin                     // SMOD
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			30: begin                     // SGN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			31: begin                     // S_SGN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			32: begin                     // F_SGN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			33: begin                     // SF_SGN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			34: begin                     // NEG
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			35: begin                     // NEG_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			36: begin                     // P_NEG_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			37: begin                     // F_NEG
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			38: begin                     // F_NEG_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			39: begin                     // PF_NEG_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			40: begin                     // ABS
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			41: begin                     // ABS_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			42: begin                     // P_ABS_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			43: begin                     // F_ABS
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			44: begin                     // F_ABS_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			45: begin                     // PF_ABS_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			46: begin                     // PST
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			47: begin                     // PST_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			48: begin                     // P_PST_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			49: begin                     // F_PST
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			50: begin                     // F_PST_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			51: begin                     // PF_PST_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			52: begin                     // NRM
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			53: begin                     // NRM_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			54: begin                     // P_NRM_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			55: begin                     // I2F
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			56: begin                     // I2F_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			57: begin                     // P_I2F_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			58: begin                     // F2I
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			59: begin                     // F2I_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			60: begin                     // P_F2I_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			61: begin                     // AND
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			62: begin                     // S_AND
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			63: begin                     // ORR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			64: begin                     // S_ORR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			65: begin                     // XOR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			66: begin                     // S_XOR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			67: begin                     // INV
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			68: begin                     // INV_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			69: begin                     // P_INV_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			70: begin                     // LAN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			71: begin                     // S_LAN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			72: begin                     // LOR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			73: begin                     // S_LOR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			74: begin                     // LIN
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			75: begin                     // LIN_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			76: begin                     // P_LIN_M
						mem_wr   <= 1'b0;
						dsp_push <= 1'b1;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			77: begin                     // LES
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			78: begin                     // S_LES
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			79: begin                     // F_LES
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			80: begin                     // SF_LES
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			81: begin                     // GRE
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			82: begin                     // S_GRE
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			83: begin                     // F_GRE
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			84: begin                     // SF_GRE
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			85: begin                     // EQU
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			86: begin                     // S_EQU
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			87: begin                     // SHL
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			88: begin                     // S_SHL
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			89: begin                     // SHR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			90: begin                     // S_SHR
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			
			91: begin                     // SRS
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b0;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
			92: begin                     // S_SRS
						mem_wr   <= 1'b0;
						dsp_push <= 1'b0;
						dsp_pop  <= 1'b1;
						ldi      <= 1'b0;
						fftl     <= 1'b0;
					end
		default: begin
						mem_wr   <= 1'bx;
						dsp_push <= 1'bx;
						dsp_pop  <= 1'bx;
						ldi      <= 1'bx;
						fftl     <= 1'bx;
					end
	endcase
end

assign ula_data = (req_in) ? io_in : mem_data_in;
assign mem_addr =  operand[MDATAW-1:0];

endmodule