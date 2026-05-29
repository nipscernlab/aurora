/**
 * verilator_tb.js — Verilator harness generator pro modo processador CMM.
 *
 * Tudo aqui e PURO (sem I/O, sem window): parseVerilatorPorts le o AST
 * JSON do `--json-only`, parseSaphoTestbench extrai a fiacao do
 * <proc>_tb.v gerado pelo asmcomp, e generateVerilatorProcTb monta o
 * C++ do harness. A orquestracao vive em
 * CompilationModule.verilatorProcessorRun.
 */

const CLOCK_NAMES = new Set([
  'clk', 'clock', 'clk_i', 'i_clk', 'clk_in', 'clkin', 'sysclk', 'clk_sys',
]);

/** Heuristica de deteccao de clock — driven no loop, nao lido de arquivo. */
function isClockName(name) {
  const lower = String(name || '').toLowerCase();
  if (CLOCK_NAMES.has(lower)) return true;
  // Fallback: nomes 1-bit contendo clk/clock (ex: "clock_50"). Larguras
  // sao filtradas pelo chamador (so 1-bit vira clock).
  return /(^|_)cl(oc)?k($|_)/.test(lower) || lower === 'clk' || lower === 'clock';
}

/**
 * Extrai as portas primarias do top-level do AST JSON do Verilator
 * (`--json-only` → V<top>.tree.json).
 *
 * Estrutura relevante (Verilator 5.x):
 *   - portas: nos `{ type:"VAR", isPrimaryIO:true, direction:"INPUT"|
 *     "OUTPUT"|"INOUT", name, dtypep:"(K)" }`. A ordem do DFS preserva a
 *     ordem de declaracao.
 *   - largura: segue `dtypep` ate um BASICDTYPE cujo `range` e "msb:lsb"
 *     (ausente = 1 bit).
 *
 * @param {object} tree  JSON.parse de V<top>.tree.json
 * @returns {Array<{name:string, direction:'input'|'output'|'inout',
 *                  width:number, words:number}>}
 */
export function parseVerilatorPorts(tree) {
  const byAddr = Object.create(null);
  (function index(node) {
    if (Array.isArray(node)) { node.forEach(index); return; }
    if (node && typeof node === 'object') {
      if (typeof node.addr === 'string' && !(node.addr in byAddr)) byAddr[node.addr] = node;
      for (const v of Object.values(node)) index(v);
    }
  })(tree);

  function widthOf(dtypeAddr) {
    let addr = dtypeAddr;
    for (let hops = 0; addr && hops < 8; hops++) {
      const n = byAddr[addr];
      if (!n) break;
      if (typeof n.range === 'string' && n.range.includes(':')) {
        const [a, b] = n.range.split(':').map((x) => parseInt(x, 10));
        if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) + 1;
      }
      const next = n.dtypep;
      if (!next || next === addr) break;
      addr = next;
    }
    return 1;
  }

  const ports = [];
  const seen = new Set();
  (function collect(node) {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node && typeof node === 'object') {
      if (node.type === 'VAR' && node.isPrimaryIO === true &&
          ['INPUT', 'OUTPUT', 'INOUT'].includes(node.direction) &&
          node.name && !seen.has(node.name)) {
        seen.add(node.name);
        const width = widthOf(node.dtypep);
        ports.push({
          name: node.name,
          direction: node.direction.toLowerCase(),
          width,
          words: Math.max(1, Math.ceil(width / 32)),
        });
      }
      for (const v of Object.values(node)) collect(v);
    }
  })(tree);

  return ports;
}

// =====================================================================
// Botao "Verilator (processador CMM)" — top-level gerado pelo compilador
// =====================================================================
//
// O .v gerado pelo asmcomp tem interface previsivel (modulo processor):
//   clk, rst, in[NUBITS], out[NUBITS], req_in[NBIOIN], out_en[NBIOOU], itr
// e o asmcomp ja gera um <proc>_tb.v com a "fiacao" — qual input_<N>.txt
// alimenta `in` em qual valor one-hot de req_in, e qual output_<N>.txt
// recebe `out` em qual valor one-hot de out_en. Em vez de adivinhar,
// PARSEAMOS esse tb e replicamos a fiacao no harness C++ do Verilator,
// reusando os MESMOS arquivos input_/output_ (compat com o sim iverilog).
//
// Bloco de debug do .v (pc_sim_val, mem_addr_wr, $readmemb relativo) fica
// sob `ifdef __ICARUS__` — Verilator nao ve, entao so os .mif (caminhos
// absolutos de IFILE/DFILE) carregam. Sem staging.

const basename = (p) => String(p || '').split(/[\\/]/).pop();

/**
 * Extrai a fiacao porta<->arquivo<->valor one-hot do <proc>_tb.v gerado
 * pelo asmcomp.
 *
 * @param {string} src  conteudo do <proc>_tb.v
 * @returns {{ inputs: Array<{port:string, reqValue:number, file:string}>,
 *            outputs: Array<{port:string, enValue:number, file:string}> }}
 */
export function parseSaphoTestbench(src) {
  const s = String(src || '');

  // entradas: data_in_K = $fopen("...input_K.txt") + (proc_req_in == V) -> in_K
  const inFile = {};
  for (const m of s.matchAll(/data_in_(\d+)\s*=\s*\$fopen\("([^"]+)"/g)) {
    inFile[m[1]] = basename(m[2]);
  }
  const inReq = {};
  for (const m of s.matchAll(/proc_req_in\s*==\s*(\d+)\s*\)\s*proc_io_in\s*=\s*in_(\d+)/g)) {
    inReq[m[2]] = parseInt(m[1], 10);
  }
  const inputs = Object.keys(inFile)
    .filter((k) => k in inReq)
    .map((k) => ({ port: k, reqValue: inReq[k], file: inFile[k] }))
    .sort((a, b) => a.reqValue - b.reqValue);

  // saidas: data_out_K = $fopen("...output_K.txt","w") + out_en_K = proc_out_en == V
  // (asmcomp v4.2+ emite "out_en_K = proc_out_en == N" fora do ifdef ICARUS;
  // o formato antigo "if (proc_out_en == N) out_sig_K <= ..." fica so dentro
  // do ICARUS ifdef e nao e visivel ao Verilator. Esse parser tem que casar
  // com o pattern fora-do-ifdef pra reconhecer outputs.)
  const outFile = {};
  for (const m of s.matchAll(/data_out_(\d+)\s*=\s*\$fopen\("([^"]+)"\s*,\s*"w"/g)) {
    outFile[m[1]] = basename(m[2]);
  }
  const outEn = {};
  for (const m of s.matchAll(/out_en_(\d+)\s*=\s*proc_out_en\s*==\s*(\d+)/g)) {
    outEn[m[1]] = parseInt(m[2], 10);
  }
  const outputs = Object.keys(outFile)
    .filter((k) => k in outEn)
    .map((k) => ({ port: k, enValue: outEn[k], file: outFile[k] }))
    .sort((a, b) => a.enValue - b.enValue);

  return { inputs, outputs };
}

/** Acha uma porta por nome (case-insensitive) no array de parseVerilatorPorts. */
function findPort(ports, name) {
  return ports.find((p) => p.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Gera o harness C++ do processador SAPHO, replicando a fiacao do
 * <proc>_tb.v com o timing do testbench (entrada lida na borda de
 * descida, saida escrita na borda de subida; req_in/out_en one-hot).
 *
 * - rst: pulso de 1 ciclo (alto so no 1o posedge).
 * - itr: dirigido a 0 SO se a porta existir (alguns procs nao tem).
 * - I/O: decimal COM SINAL (mesmo formato %d/%0d do tb iverilog).
 * - Roda numClocks fixos; escreve progresso "<pct> <leituras>" em
 *   progressPath (a barra existente faz polling desse arquivo).
 *
 * @param {object} opts
 * @param {string} opts.topModule
 * @param {Array}  opts.ports        parseVerilatorPorts(V<top>.tree.json)
 * @param {Array}  opts.inputs       parseSaphoTestbench().inputs
 * @param {Array}  opts.outputs      parseSaphoTestbench().outputs
 * @param {number} opts.numClocks    nº de clocks (config de sim do processador)
 * @param {string} opts.progressPath caminho absoluto (forward-slash) do progress.txt
 * @returns {{ source:string, hasItr:boolean, inputs:Array, outputs:Array }}
 */
export function generateVerilatorProcTb({ topModule, ports, inputs, outputs, numClocks = 2000, progressPath }) {
  const clk = findPort(ports, 'clk') || ports.find((p) => p.direction === 'input' && p.width === 1 && isClockName(p.name));
  const rst = findPort(ports, 'rst') || findPort(ports, 'reset');
  const itr = findPort(ports, 'itr');
  const inBus = findPort(ports, 'in');
  const outBus = findPort(ports, 'out');
  const reqBus = findPort(ports, 'req_in');
  const enBus = findPort(ports, 'out_en');

  const missing = [];
  if (!clk) missing.push('clk');
  // in/req_in so sao exigidos se o tb tem entradas. Processadores sem
  // inputs (#NUIOIN 0, ex: proc_fft) geram .v sem essas portas — o loop
  // de leitura (~linha 526) nao e emitido, entao o C++ nao referencia
  // inBus/reqBus. Mesma logica pra out/out_en quando nao ha outputs.
  if (inputs.length > 0) {
    if (!inBus) missing.push('in');
    if (!reqBus) missing.push('req_in');
  }
  if (outputs.length > 0) {
    if (!outBus) missing.push('out');
    if (!enBus) missing.push('out_en');
  }
  if (missing.length) {
    throw new Error(`não parece um top-level de processador SAPHO: faltam os pinos ${missing.join(', ')}`);
  }

  const outW = outBus.width;
  const L = [];

  L.push(`// Auto-gerado por Aurora — harness Verilator do processador "${topModule}".`);
  L.push(`// Fiacao extraida do ${topModule}_tb.v; I/O decimal com sinal,`);
  L.push(`// reusando os mesmos input_<N>.txt / output_<N>.txt do sim iverilog.`);
  L.push(`// Roda ${numClocks} clocks (config de simulacao do processador).`);
  L.push(`#include "V${topModule}.h"`);
  L.push(`#include "verilated.h"`);
  L.push(`#include <cstdint>`);
  L.push(`#include <cstdio>`);
  L.push(`#include <cstring>`);
  L.push(`#include <cstdlib>`);
  L.push(`#include <string>`);
  L.push(`#include <fstream>`);
  L.push('');
  L.push(`static uint64_t main_time = 0;`);
  L.push(`double sc_time_stamp() { return (double)main_time; }`);
  L.push('');
  L.push(`#ifndef NUM_CLOCKS`);
  L.push(`#define NUM_CLOCKS ${numClocks}u`);
  L.push(`#endif`);
  L.push('');
  L.push(`// Proximo inteiro decimal (com sinal) do arquivo. false no EOF.`);
  L.push(`static bool next_dec(std::ifstream& f, long long& v){ return (bool)(f >> v); }`);
  L.push('');
  L.push(`static void write_progress(const char* path, int pct, unsigned long long reads){`);
  L.push(`  std::ofstream p(path, std::ios::trunc);`);
  L.push(`  if(p) p << pct << " " << reads << "\\n";`);
  L.push(`}`);
  L.push('');
  L.push(`int main(int argc, char** argv){`);
  L.push(`  Verilated::commandArgs(argc, argv);`);
  L.push(`  unsigned nclk = NUM_CLOCKS;`);
  L.push(`  for(int i=1;i<argc;i++){ if(strncmp(argv[i],"+cycles=",8)==0) nclk=(unsigned)strtoul(argv[i]+8,nullptr,10); }`);
  L.push(`  V${topModule}* top = new V${topModule};`);
  L.push('');
  for (const p of inputs) L.push(`  std::ifstream f_in_${p.port}("${p.file}");`);
  for (const p of outputs) L.push(`  std::ofstream o_out_${p.port}("${p.file}");`);
  L.push('');
  L.push(`  unsigned long long reads = 0;`);
  L.push(`  unsigned step = nclk/100; if(step==0) step=1;`);
  L.push(`  const char* PROG = "${progressPath}";`);
  L.push('');
  L.push(`  for(unsigned cyc=0; cyc<nclk; cyc++){`);
  L.push(`    top->${rst ? rst.name : 'rst'} = (cyc==0) ? 1 : 0;`);
  if (itr) L.push(`    top->${itr.name} = 0;`);
  L.push(`    // --- borda de subida: processador computa; req_in/out_en/out validos ---`);
  L.push(`    top->${clk.name} = 1; top->eval(); main_time++;`);
  // escreve saidas (out_en one-hot), decimal com sinal-extensao da largura
  for (const p of outputs) {
    L.push(`    if(top->${enBus.name} == ${p.enValue}u) {`);
    L.push(`      long long v = (long long)(uint64_t)top->${outBus.name};`);
    if (outW < 64) {
      L.push(`      { long long m = 1LL << ${outW - 1}; v = (v ^ m) - m; } // sinal-extensao ${outW} bits`);
    }
    L.push(`      o_out_${p.port} << v << "\\n";`);
    L.push(`    }`);
  }
  L.push(`    // --- borda de descida: le a entrada que o processador pediu ---`);
  L.push(`    top->${clk.name} = 0; top->eval(); main_time++;`);
  for (const p of inputs) {
    L.push(`    if(top->${reqBus.name} == ${p.reqValue}u) { long long v; if(next_dec(f_in_${p.port}, v)){ top->${inBus.name} = (uint64_t)v; reads++; } }`);
  }
  L.push(`    if((cyc % step)==0) write_progress(PROG, (int)(((unsigned long long)(cyc+1)*100)/nclk), reads);`);
  L.push(`  }`);
  L.push(`  write_progress(PROG, 100, reads);`);
  L.push(`  printf("Aurora: %u clocks simulados, %llu leitura(s) de entrada.\\n", nclk, reads);`);
  L.push(`  top->final();`);
  L.push(`  delete top;`);
  L.push(`  return 0;`);
  L.push(`}`);
  L.push('');

  return { source: L.join('\n'), hasItr: !!itr, inputs, outputs };
}
