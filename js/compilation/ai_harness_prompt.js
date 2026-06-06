/**
 * ai_harness_prompt.js — gera um SCAFFOLD C++ determinístico (includes, main,
 * instanciação do DUT, loop de clock, dump das saídas) e pede a IA preencher
 * SÓ os buracos de lógica de estímulo (@AURORA_FILL). Depois reinjectDump()
 * sobrescreve o bloco de dump com a versão canônica — assim o boilerplate e o
 * dump (onde mora o risco de sign-extension etc.) nunca dependem do modelo.
 * Puro (sem I/O). Ver project_fast_sim_roadmap (Fase 2 — scaffold + fill).
 */

export const HARNESS_SYSTEM_PROMPT =
  'You are an expert in Verilator and C++. You are given a C++ harness scaffold ' +
  'with a few /* @AURORA_FILL ... */ holes and the Verilog testbench it must ' +
  'reproduce. You fill ONLY the holes with C++ that drives the DUT under ' +
  'Verilator WITHOUT --timing (the clock is the for-loop, every #delay becomes ' +
  'an integer number of cycles), translating the testbench\'s own sequential ' +
  'logic. You keep everything outside the holes byte-for-byte. You output ONLY ' +
  'valid C++ — no markdown, no prose.';

const DUMP_BEGIN = '// AURORA_DUMP_BEGIN -- deterministic, keep verbatim';
const DUMP_END = '// AURORA_DUMP_END';

/** Heuristica de clock: porta input 1-bit com nome tipo clk/clock. */
function detectClock(ports) {
  const re = /(^|_)cl(oc)?k($|_)|^clk$|^clock$/i;
  const p = ports.find((x) => x.direction === 'input' && x.width === 1 && re.test(x.name));
  return p ? p.name : 'clk';
}

/**
 * Expressao C++ que le uma porta de saida como `long long`, respeitando
 * signedness e largura. SIGNED mais estreita que 64 bits precisa de
 * sign-extension explicita — o cast de uint16/uint32 do Verilator NAO estende
 * o sinal (ex: q signed [15:0] = -12790 sairia 52746 sem isto).
 */
function dumpExpr(p) {
  const name = `top->${p.name}`;
  if (!p.signed) return `(long long)(unsigned long long)${name}`;
  if (p.width >= 64) return `(long long)(int64_t)${name}`;
  const shift = 64 - p.width;
  return `(long long)((int64_t)((uint64_t)${name} << ${shift}) >> ${shift})`;
}

/**
 * Bloco de dump determinístico (entre os marcadores AURORA_DUMP_*). Escreve
 * uma linha "porta=valor" por saida em harness_final.txt. Reusado pelo scaffold,
 * pela re-injecao E pelo conversor determinístico (deterministic_harness.js) —
 * a unica fonte da verdade do dump (sign-extension de saidas signed estreitas).
 */
export function dumpSection(ports) {
  const outs = ports.filter((p) => p.direction === 'output');
  const lines = outs.map((p) => `        fprintf(fh, "${p.name}=%lld\\n", ${dumpExpr(p)});`);
  return [
    `    ${DUMP_BEGIN}`,
    '    {',
    '        FILE* fh = fopen("harness_final.txt", "w");',
    '        if (fh) {',
    ...lines,
    '            fclose(fh);',
    '        }',
    '    }',
    `    ${DUMP_END}`,
  ].join('\n');
}

/**
 * Scaffold C++ determinístico: tudo fixo menos as 4 regiões @AURORA_FILL
 * (setup, total_cycles, drive, advance). O clock e o dump já vêm prontos.
 *
 * @param {object} opts
 * @param {string} opts.topModule
 * @param {Array<{name,direction,width,signed}>} opts.ports
 */
export function buildHarnessScaffold({ topModule, ports }) {
  const clk = detectClock(ports);
  return [
    `#include "V${topModule}.h"`,
    '#include "verilated.h"',
    '#include <cstdint>',
    '#include <cstdio>',
    '#include <cstring>',
    '#include <cstdlib>',
    '',
    'static uint64_t main_time = 0;',
    'double sc_time_stamp() { return (double)main_time; }',
    '',
    'int main(int argc, char** argv) {',
    '    Verilated::commandArgs(argc, argv);',
    `    V${topModule}* top = new V${topModule};`,
    '',
    "    /* @AURORA_FILL setup: declare the testbench's own registers (counters,",
    '       reset/strobe regs, last-driven data) as C++ locals initialised like the',
    '       testbench, and fopen() each input data file the testbench reads. */',
    '',
    "    /* @AURORA_FILL total_cycles: from the testbench's #delays and $finish.",
    '       Clock "always #N" => full period = 2*N; a "#M" delay = M/(2*N) cycles. */',
    '    long long TOTAL_CYCLES = /* @AURORA_FILL: cycle count */ 0;',
    '',
    '    for (long long cyc = 0; cyc < TOTAL_CYCLES; cyc++) {',
    '        /* @AURORA_FILL drive: set top->* inputs for THIS posedge — reset levels,',
    '           strobes, and any file read the testbench does on this edge. Mask to width. */',
    '',
    `        top->${clk} = 1; top->eval(); main_time += 2;   // posedge: outputs valid here`,
    `        top->${clk} = 0; top->eval(); main_time += 2;   // negedge`,
    '',
    "        /* @AURORA_FILL advance: update the testbench's own registers for the NEXT",
    '           cycle, computed from their values BEFORE this posedge (non-blocking <=). */',
    '    }',
    '',
    dumpSection(ports),
    '',
    '    top->final();',
    '    delete top;',
    '    return 0;',
    '}',
  ].join('\n');
}

/**
 * Monta { system, user } pro one-shot: o scaffold + o testbench + as regras de
 * preenchimento. `feedback` (opcional) injeta o erro de build da tentativa
 * anterior (loop compila-corrige).
 */
export function buildHarnessPrompt({ topModule, ports, testbenchSource, feedback }) {
  const scaffold = buildHarnessScaffold({ topModule, ports });
  const clk = detectClock(ports);
  const portLines = ports.map(
    (p) => `  - ${p.name}: ${p.direction} [${p.width} bit${p.width > 1 ? 's' : ''}]${p.signed ? ' signed' : ''}`);

  const rules = [
    `- CYCLE COUNTING (most common mistake): clock "always #N clk=~clk" FLIPS every N time units, so ONE FULL CYCLE = 2*N. Divide "#M" delays by the FULL period 2*N, not N. Worked example: "always #2" => period 4 => a "#450000" delay = 450000/4 = 112500 cycles; a loop running "#450000" ten times = 1125000 cycles. Set TOTAL_CYCLES that way.`,
    `- NON-BLOCKING: for each of the testbench's own registers (counters, reset pulses, strobes) keep a next_* in the "drive" region computed from pre-posedge values, and commit it in the "advance" region.`,
    `- A reset "#A sig=1; #B sig=0;" => drive that input = 1 while cyc is in [A/period, (A+B)/period), else 0.`,
    `- Read files with the SAME names the testbench uses ($fscanf("%d",&x) -> fscanf). Mask each driven input to its width.`,
    `- The clock "${clk}" is already toggled in the loop — do NOT toggle it in the fills.`,
    'Output ONLY the complete C++ file (no ``` fences, no commentary).',
  ];

  let user = [
    `Top-level DUT: ${topModule} (Verilator class V${topModule}; detected clock port: ${clk}).`,
    '',
    'DUT ports:',
    ...portLines,
    '',
    'SCAFFOLD — return this COMPLETE file with every /* @AURORA_FILL ... */ region replaced',
    'by C++. Keep everything else byte-for-byte; the block between the AURORA_DUMP markers is',
    'generated and must stay exactly as-is.',
    '',
    scaffold,
    '',
    'Verilog testbench to translate into the @AURORA_FILL regions:',
    testbenchSource,
    '',
    'Rules:',
    ...rules,
  ].join('\n');

  if (feedback && feedback.buildError) {
    user += [
      '',
      '--- PREVIOUS ATTEMPT FAILED TO COMPILE ---',
      'Your previous C++ was:',
      feedback.previousCpp,
      '',
      'Verilator/g++ reported:',
      feedback.buildError,
      '',
      'Fix the C++ so it compiles. Output ONLY the corrected complete C++ source.',
    ].join('\n');
  }

  return { system: HARNESS_SYSTEM_PROMPT, user };
}

/**
 * Extrai o C++ da resposta do LLM: conteudo do primeiro bloco ```...``` se
 * houver; senao o texto cru. Garante \n final.
 */
export function extractCppFromResponse(text) {
  const t = String(text || '');
  const fence = t.match(/```(?:cpp|c\+\+|c)?\s*\n([\s\S]*?)```/i);
  const body = (fence ? fence[1] : t).trim();
  return body ? `${body}\n` : '';
}

/**
 * Sobrescreve o bloco de dump do C++ gerado com a versao canônica (a IA pode
 * te-lo alterado apesar da instrucao). Se os marcadores sumiram, devolve o cpp
 * intocado (o build/validacao pega o resto). Determinístico.
 */
export function reinjectDump({ cpp, ports }) {
  const s = String(cpp || '');
  const begin = s.indexOf(DUMP_BEGIN);
  const endIdx = s.indexOf(DUMP_END);
  if (begin === -1 || endIdx === -1 || endIdx < begin) return s;
  // recua ate o inicio da linha do marcador begin (preserva indentacao)
  const lineStart = s.lastIndexOf('\n', begin) + 1;
  const end = endIdx + DUMP_END.length;
  return s.slice(0, lineStart) + dumpSection(ports) + s.slice(end);
}
