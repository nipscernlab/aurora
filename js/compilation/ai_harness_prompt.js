/**
 * ai_harness_prompt.js — monta o prompt que pede a IA converter um testbench
 * Verilog num harness C++ Verilator SEM --timing, e extrai o C++ da resposta.
 * Puro (sem I/O): a chamada ao LLM e o loop compila-corrige vivem em
 * CompilationModule.aiHarnessRun. Ver project_fast_sim_roadmap (Fase 1, Passo 3).
 */

export const HARNESS_SYSTEM_PROMPT =
  'You are an expert in Verilator and C++. You convert a Verilog testbench into ' +
  'a C++ harness that drives the DUT under Verilator WITHOUT --timing: the clock ' +
  'is a plain for-loop and every #delay becomes an integer number of clock cycles. ' +
  'You translate the testbench\'s own sequential logic (counters, reset pulses, ' +
  'file reads) into C++. You output ONLY valid C++ source — no markdown, no prose.';

/** Heuristica de clock: porta input 1-bit com nome tipo clk/clock. */
function detectClock(ports) {
  const re = /(^|_)cl(oc)?k($|_)|^clk$|^clock$/i;
  const p = ports.find((x) => x.direction === 'input' && x.width === 1 && re.test(x.name));
  return p ? p.name : 'clk';
}

/** `(int32_t)`/`(int64_t)` conforme a largura (saidas sao lidas com sinal). */
function signedCast(width) {
  return width > 32 ? '(int64_t)' : '(int32_t)';
}

/**
 * Monta { system, user } pro one-shot. `feedback` (opcional) injeta o erro do
 * build da tentativa anterior, pro loop compila-corrige.
 *
 * @param {object} opts
 * @param {string} opts.topModule
 * @param {Array<{name,direction,width}>} opts.ports
 * @param {string} opts.testbenchSource
 * @param {{ previousCpp:string, buildError:string }} [opts.feedback]
 */
export function buildHarnessPrompt({ topModule, ports, testbenchSource, feedback }) {
  const outs = ports.filter((p) => p.direction === 'output');
  const clk = detectClock(ports);
  const portLines = ports.map(
    (p) => `  - ${p.name}: ${p.direction} [${p.width} bit${p.width > 1 ? 's' : ''}]`);
  const dumpLines = outs.map(
    (p) => `     fprintf(fh, "${p.name}=%lld\\n", (long long)${signedCast(p.width)}top->${p.name});`);

  const rules = [
    `1. #include "V${topModule}.h" and "verilated.h". Add: static uint64_t main_time=0; double sc_time_stamp(){return (double)main_time;}.`,
    `2. main(): Verilated::commandArgs(argc,argv); V${topModule}* top = new V${topModule};. Drive the clock in a for-loop over cycles — each cycle: top->${clk}=1; top->eval(); (read/handle outputs) top->${clk}=0; top->eval();.`,
    `3. The testbench clock toggles with "always #N" (or "#N clk=~clk"), so ONE full period = 2*N time units. Convert every "#M" delay in the testbench to round(M / (2*N)) cycles. Run for (total simulated time until $finish) / period cycles.`,
    `4. Reimplement the testbench's OWN sequential logic (counters, reset pulses, generated strobes, conditional file reads) in C++, mirroring non-blocking (<=) semantics: compute next-state from the values BEFORE the posedge, apply after eval().`,
    `5. If the testbench reads data files ($fscanf/$readmemh/$fopen), read the SAME file names with C stdio (fopen/fscanf). Drive each input you set masked to its port width.`,
    `6. MANDATORY for validation — at the very end (after the loop), write a file named exactly "harness_final.txt" with one "PORT=VALUE" line per OUTPUT port, like:`,
    `     FILE* fh = fopen("harness_final.txt", "w");`,
    ...dumpLines,
    `     fclose(fh);`,
    `   Use EXACTLY these output names: ${outs.map((p) => p.name).join(', ')}.`,
    `7. No timing constructs in the C++ (no #delay, no @(posedge), no wait, no fork/join) — translate everything into the cycle loop. End with top->final(); delete top; return 0;.`,
    `Output ONLY the C++ source (no \`\`\` fences, no commentary).`,
  ];

  let user = [
    `Top-level module (DUT): ${topModule}. Verilator generates V${topModule}.h and class V${topModule}. Detected clock port: ${clk}.`,
    '',
    'DUT ports:',
    ...portLines,
    '',
    'Original Verilog testbench to translate:',
    testbenchSource,
    '',
    'Write the C++ harness. Rules:',
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
      'Fix the C++ so it compiles. Output ONLY the corrected C++ source.',
    ].join('\n');
  }

  return { system: HARNESS_SYSTEM_PROMPT, user };
}

/**
 * Extrai o C++ da resposta do LLM: pega o conteudo do primeiro bloco
 * ```cpp ... ``` se houver; senao usa o texto cru. Garante \n final.
 */
export function extractCppFromResponse(text) {
  const t = String(text || '');
  const fence = t.match(/```(?:cpp|c\+\+|c)?\s*\n([\s\S]*?)```/i);
  const body = (fence ? fence[1] : t).trim();
  return body ? `${body}\n` : '';
}
