import { describe, it, expect } from 'vitest';
import {
    tokenize,
    parseVerilogLiteral,
    parseRegDecls,
    detectClockGen,
    analyzeTestbenchEligibility,
    generateDeterministicHarness,
    DeterministicError,
} from '../../js/compilation/deterministic_harness.js';

// Testbench ELEGIVEL sintetico: clock always #5 (periodo 10), reset por fork,
// estimulo periodico por repeat(3) de #delays + $fscanf, parada por #1000 $finish.
const ELIGIBLE_TB = `
\`timescale 1ns/1ps
module dut_tb();
  reg clk, rst;
  reg [7:0] data = 8'd0;
  reg en = 1'b0;
  wire [7:0] q;
  integer fd, sc;

  always #5 clk = ~clk;

  initial fork
    clk = 1'b0;
    rst = 1'b1;
    #20 rst = 1'b0;
  join

  initial begin
    fd = $fopen("in.txt", "r");
    #30;
    repeat (3) begin
      en = 1'b1;
      sc = $fscanf(fd, "%d", data);
      #10 en = 1'b0;
      #40;
    end
  end

  initial begin
    #1000 $finish;
  end

  dut u (.clk(clk), .rst(rst), .data(data), .en(en), .q(q));
endmodule
`;

const DUT_PORTS = [
    { name: 'clk', direction: 'input', width: 1, signed: false },
    { name: 'rst', direction: 'input', width: 1, signed: false },
    { name: 'data', direction: 'input', width: 8, signed: false },
    { name: 'en', direction: 'input', width: 1, signed: false },
    { name: 'q', direction: 'output', width: 8, signed: false },
];

describe('tokenize', () => {
    it('splits numbers, sized literals, ids, ops, strings, # and ;', () => {
        const t = tokenize('#20 rst = 1\'b0; x=$fscanf(fd,"%d",data);');
        expect(t[0]).toEqual({ type: 'hash', value: '#' });
        expect(t[1]).toEqual({ type: 'num', value: '20' });
        expect(t[2]).toEqual({ type: 'id', value: 'rst' });
        expect(t.find((x) => x.type === 'num' && x.value === "1'b0")).toBeTruthy();
        expect(t.find((x) => x.type === 'str' && x.value === '%d')).toBeTruthy();
        expect(t.find((x) => x.type === 'id' && x.value === '$fscanf')).toBeTruthy();
    });

    it('treats <= as a single non-blocking token', () => {
        const t = tokenize('a <= b;');
        expect(t[1]).toEqual({ type: 'le', value: '<=' });
    });
});

describe('parseVerilogLiteral', () => {
    it('parses decimal, sized and based literals', () => {
        expect(parseVerilogLiteral('123')).toBe(123);
        expect(parseVerilogLiteral('16\'d0')).toBe(0);
        expect(parseVerilogLiteral('8\'hFF')).toBe(255);
        expect(parseVerilogLiteral('4\'o17')).toBe(15);
        expect(parseVerilogLiteral('3\'b101')).toBe(5);
        expect(parseVerilogLiteral("16'sd255")).toBe(255);
        expect(parseVerilogLiteral('8\'h1_0')).toBe(16);
    });
    it('returns NaN for x/z (unknown)', () => {
        expect(Number.isNaN(parseVerilogLiteral("4'bxx01"))).toBe(true);
    });
});

describe('parseRegDecls', () => {
    it('captures width, signed and init', () => {
        const m = parseRegDecls(ELIGIBLE_TB);
        expect(m.get('clk')).toMatchObject({ width: 1 });
        expect(m.get('data')).toMatchObject({ width: 8, init: 0 });
        expect(m.get('en')).toMatchObject({ width: 1, init: 0 });
        // integer -> 32 bits signed
        expect(m.get('fd')).toMatchObject({ width: 32, signed: true });
    });
    it('parses signed wide reg with non-zero init', () => {
        const m = parseRegDecls('reg signed [15:0] x = 16\'sd5; reg [3:0] y, z;');
        expect(m.get('x')).toMatchObject({ width: 16, signed: true, init: 5 });
        expect(m.get('y')).toMatchObject({ width: 4 });
        expect(m.get('z')).toMatchObject({ width: 4 });
    });
});

describe('detectClockGen', () => {
    it('detects always #N clk = ~clk', () => {
        const c = detectClockGen(tokenize(ELIGIBLE_TB));
        expect(c).toMatchObject({ name: 'clk', halfPeriod: 5, period: 10 });
    });
    it('detects the <= form too', () => {
        const c = detectClockGen(tokenize('always #2 clock <= ~clock;'));
        expect(c).toMatchObject({ name: 'clock', halfPeriod: 2, period: 4 });
    });
    it('returns null when there is no generated clock', () => {
        expect(detectClockGen(tokenize('initial begin #5 $finish; end'))).toBeNull();
    });
});

describe('analyzeTestbenchEligibility', () => {
    it('accepts a well-behaved testbench and extracts info', () => {
        const a = analyzeTestbenchEligibility({ src: ELIGIBLE_TB, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(true);
        expect(a.reasons).toEqual([]);
        expect(a.info.clock).toMatchObject({ name: 'clk', period: 10 });
        expect(a.info.instName).toBe('u');
        // finish em t=1000, clock periodo 10 -> ceil((1000-5)/10) = 100
        expect(a.info.finishCycle).toBe(100);
    });

    it('rejects a posedge always with state logic (the classic blocker)', () => {
        const tb = ELIGIBLE_TB.replace(
            'dut u (',
            'reg [3:0] cnt;\n  always @(posedge clk) cnt <= cnt + 1;\n  dut u (');
        const a = analyzeTestbenchEligibility({ src: tb, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(false);
        expect(a.reasons.some((r) => /always/.test(r))).toBe(true);
    });

    it('rejects when there is no $finish (cannot bound cycles)', () => {
        const tb = ELIGIBLE_TB.replace('#1000 $finish;', '#1000 ;');
        const a = analyzeTestbenchEligibility({ src: tb, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(false);
        expect(a.reasons.some((r) => /finish|stop/i.test(r))).toBe(true);
    });

    it('rejects when there is no generated clock', () => {
        const tb = ELIGIBLE_TB.replace('always #5 clk = ~clk;', '');
        const a = analyzeTestbenchEligibility({ src: tb, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(false);
        expect(a.reasons.some((r) => /clock/i.test(r))).toBe(true);
    });

    it('rejects an input wired to an expression instead of a simple reg', () => {
        const tb = ELIGIBLE_TB.replace('.en(en)', '.en(en & rst)');
        const a = analyzeTestbenchEligibility({ src: tb, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(false);
        expect(a.reasons.some((r) => /en/.test(r) && /express/.test(r))).toBe(true);
    });

    it('rejects join_any/join_none', () => {
        const tb = ELIGIBLE_TB.replace('  join', '  join_any');
        const a = analyzeTestbenchEligibility({ src: tb, topModule: 'dut', ports: DUT_PORTS });
        expect(a.eligible).toBe(false);
        expect(a.reasons.some((r) => /join_any|join_none/.test(r))).toBe(true);
    });
});

describe('generateDeterministicHarness', () => {
    it('emits a compilable-looking C++ harness with the right shape', () => {
        const { cpp, info } = generateDeterministicHarness({
            topModule: 'dut', ports: DUT_PORTS, testbenchSource: ELIGIBLE_TB,
        });
        expect(info.totalCycles).toBe(100);
        // boilerplate + classe Verilator correta
        expect(cpp).toContain('#include "Vdut.h"');
        expect(cpp).toContain('Vdut* top = new Vdut;');
        // arquivo aberto com o nome literal do $fopen
        expect(cpp).toContain('FILE* f_fd = fopen("in.txt", "r");');
        // TOTAL_CYCLES correto
        expect(cpp).toContain('long long TOTAL_CYCLES = 100LL;');
        // clock dirigido pelo loop, half-period 5
        expect(cpp).toContain('top->clk = 1; top->eval(); main_time += 5;');
        // entradas drivadas a partir dos regs (mascaradas na largura)
        expect(cpp).toContain('top->data = ((uint32_t)(r_data) & ((1u << 8) - 1u));');
        expect(cpp).toContain('top->en = ((uint32_t)(r_en) & ((1u << 1) - 1u));');
        // $fscanf vira leitura C
        expect(cpp).toContain('fscanf(f_fd, "%lld", &__v)');
        // dump da saida
        expect(cpp).toContain('fprintf(fh, "q=%lld\\n"');
        // clk NUNCA e' drivado a partir de um reg (e' o loop)
        expect(cpp).not.toContain('top->clk = ((uint32_t)(r_clk)');
    });

    it('orders events by cycle: rst high at cycle 0, low at cycle 2', () => {
        const { cpp } = generateDeterministicHarness({
            topModule: 'dut', ports: DUT_PORTS, testbenchSource: ELIGIBLE_TB,
        });
        // primeiros eventos: rst=1 (cycle 0), rst=0 (cycle 2). A tabela comeca em 0.
        const m = cpp.match(/EV_CYCLE\[\] = \{ ([^}]*) \}/);
        expect(m).toBeTruthy();
        const cycles = m[1].split(',').map((s) => parseInt(s, 10));
        expect(cycles[0]).toBe(0);
        expect(cycles).toContain(2); // rst desce no ciclo 2
        // monotonicamente nao-decrescente
        for (let i = 1; i < cycles.length; i++) expect(cycles[i]).toBeGreaterThanOrEqual(cycles[i - 1]);
    });

    it('throws DeterministicError for an ineligible testbench', () => {
        const tb = ELIGIBLE_TB.replace('#1000 $finish;', '#1000 ;'); // sem $finish
        expect(() => generateDeterministicHarness({
            topModule: 'dut', ports: DUT_PORTS, testbenchSource: tb,
        })).toThrow(DeterministicError);
    });
});
