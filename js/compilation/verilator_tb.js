/**
 * verilator_tb.js — Verilator harness generator pro modo processador CMM.
 *
 * Tudo aqui e PURO (sem I/O, sem window): parseVerilatorPorts le o AST
 * JSON do `--json-only`, parseProcessorIO extrai a fiacao de I/O direto
 * do <proc>.v (bloco YANC_SIM_VIS), e generateVerilatorProcTb monta o
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
// req_in/out_en sao buses ONE-HOT (addr_dec decodifica o strobe + endereco
// internos -> 1<<addr). E o PROPRIO <proc>.v, no bloco YANC_SIM_VIS, ja
// declara a fiacao dispositivo<->valor:
//   req_in_sim_<K> = req_in == <V>;   // input_<K>.txt  alimenta `in` quando req_in==V
//   out_en_sim_<K> = out_en == <V>;   // output_<K>.txt recebe `out` quando out_en==V
// parseProcessorIO le ESSAS linhas direto do <proc>.v (fonte canonica) —
// NADA de testbench. O harness C++ replica a fiacao reusando os MESMOS
// input_<K>.txt / output_<K>.txt (compat com o sim iverilog).
//
// Bloco de debug do .v (pc_sim_val, mem_addr_wr, $readmemb relativo) fica
// sob `ifdef __ICARUS__` — Verilator nao ve, entao so os .mif (caminhos
// absolutos de IFILE/DFILE) carregam. Sem staging.

/**
 * Extrai a fiacao dispositivo<->arquivo<->valor one-hot direto do
 * <proc>.v (bloco YANC_SIM_VIS gerado pelo asmcomp). Le como TEXTO, entao
 * os `ifdef nao importam — as linhas estao sempre presentes na fonte. O
 * indice K do sinal e tambem o numero do arquivo (input_<K>.txt /
 * output_<K>.txt), e <V> e o valor one-hot que o harness compara.
 *
 *   req_in_sim_<K> = req_in == <V>   ->  le input_<K>.txt quando req_in==V
 *   out_en_sim_<K> = out_en == <V>   ->  escreve output_<K>.txt quando out_en==V
 *
 * @param {string} src  conteudo do <proc>.v
 * @returns {{ inputs: Array<{port:string, reqValue:number, file:string}>,
 *            outputs: Array<{port:string, enValue:number, file:string}> }}
 */
export function parseProcessorIO(src) {
  const s = String(src || '');

  const inputs = [];
  for (const m of s.matchAll(/req_in_sim_(\d+)\s*=\s*req_in\s*==\s*(\d+)/g)) {
    inputs.push({ port: m[1], reqValue: parseInt(m[2], 10), file: `input_${m[1]}.txt` });
  }
  inputs.sort((a, b) => a.reqValue - b.reqValue);

  const outputs = [];
  for (const m of s.matchAll(/out_en_sim_(\d+)\s*=\s*out_en\s*==\s*(\d+)/g)) {
    outputs.push({ port: m[1], enValue: parseInt(m[2], 10), file: `output_${m[1]}.txt` });
  }
  outputs.sort((a, b) => a.enValue - b.enValue);

  return { inputs, outputs };
}

/** Acha uma porta por nome (case-insensitive) no array de parseVerilatorPorts. */
function findPort(ports, name) {
  return ports.find((p) => p.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Gera o harness C++ do processador SAPHO, replicando a fiacao lida do
 * <proc>.v (entrada lida na borda de descida, saida escrita na borda de
 * subida; req_in/out_en one-hot).
 *
 * - rst: pulso de 1 ciclo (alto so no 1o posedge).
 * - itr: dirigido a 0 SO se a porta existir (alguns procs nao tem).
 * - I/O: decimal COM SINAL (mesmo formato dos input_/output_ do iverilog).
 * - Roda numClocks fixos.
 *
 * @param {object} opts
 * @param {string} opts.topModule
 * @param {Array}  opts.ports        parseVerilatorPorts(V<top>.tree.json)
 * @param {Array}  opts.inputs       parseProcessorIO().inputs
 * @param {Array}  opts.outputs      parseProcessorIO().outputs
 * @param {number} opts.numClocks    nº de clocks (config de sim do processador)
 * @returns {{ source:string, hasItr:boolean, inputs:Array, outputs:Array }}
 */
export function generateVerilatorProcTb({ topModule, ports, inputs, outputs, numClocks = 2000 }) {
  const clk = findPort(ports, 'clk') || ports.find((p) => p.direction === 'input' && p.width === 1 && isClockName(p.name));
  const rst = findPort(ports, 'rst') || findPort(ports, 'reset');
  const itr = findPort(ports, 'itr');
  const inBus = findPort(ports, 'in');
  const outBus = findPort(ports, 'out');
  const reqBus = findPort(ports, 'req_in');
  const enBus = findPort(ports, 'out_en');

  // Pinos obrigatorios: clk sempre.
  // in/req_in: so se o tb declarar inputs (processador com entrada).
  // out/out_en: so se o tb declarar outputs (processador com saida).
  // Processadores tipo proc_fft que so computam e dumpam saidas nao
  // tem in/req_in no .v — esses ficam opcionais aqui. (E simetrico:
  // procs que so leem e nao escrevem ficariam sem out/out_en).
  const missing = [];
  if (!clk) missing.push('clk');
  // in/req_in so sao exigidos se o tb tem entradas. Processadores sem
  // inputs (#NUIOIN 0, ex: proc_fft) geram .v sem essas portas — o loop
  // de leitura (~linha 526) nao e emitido, entao o C++ nao referencia
  // inBus/reqBus. Mesma logica pra out/out_en quando nao ha outputs.
  // Anexa o motivo no nome do pino faltante pra que a mensagem de erro
  // sozinha ja diga ao usuario por que e exigido.
  if (inputs.length > 0) {
    if (!inBus) missing.push('in (wiring declara inputs)');
    if (!reqBus) missing.push('req_in (wiring declara inputs)');
  }
  if (outputs.length > 0) {
    if (!outBus) missing.push('out (wiring declara outputs)');
    if (!enBus) missing.push('out_en (wiring declara outputs)');
  }
  if (missing.length) {
    throw new Error(`pinos esperados nao encontrados: ${missing.join(', ')}`);
  }

  // outW so e usado dentro do for de outputs — se outputs.length === 0,
  // outBus pode ser null e este valor nao e lido.
  const outW = outBus ? outBus.width : 0;
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
  L.push('');
  L.push(`static uint64_t main_time = 0;`);
  L.push(`double sc_time_stamp() { return (double)main_time; }`);
  L.push('');
  L.push(`#ifndef NUM_CLOCKS`);
  L.push(`#define NUM_CLOCKS ${numClocks}u`);
  L.push(`#endif`);
  L.push('');
  L.push(`// Proximo inteiro decimal (com sinal) do arquivo. false no EOF.`);
  L.push(`// C stdio (fscanf) em vez de iostream: o operator>> carrega sentry`);
  L.push(`// + facetas de locale a cada extracao; em sim I/O-bound longa isso`);
  L.push(`// pesa. fscanf("%lld") faz o mesmo parse decimal-com-sinal mais rapido.`);
  L.push(`static bool next_dec(FILE* f, long long& v){ return f && fscanf(f, "%lld", &v) == 1; }`);
  L.push('');
  L.push(`int main(int argc, char** argv){`);
  L.push(`  Verilated::commandArgs(argc, argv);`);
  L.push(`  unsigned nclk = NUM_CLOCKS;`);
  L.push(`  for(int i=1;i<argc;i++){ if(strncmp(argv[i],"+cycles=",8)==0) nclk=(unsigned)strtoul(argv[i]+8,nullptr,10); }`);
  L.push(`  V${topModule}* top = new V${topModule};`);
  L.push('');
  for (const p of inputs) L.push(`  FILE* f_in_${p.port} = fopen("${p.file}", "r");`);
  for (const p of outputs) L.push(`  FILE* o_out_${p.port} = fopen("${p.file}", "w");`);
  L.push('');
  L.push(`  unsigned long long reads = 0;`);
  // Marcador de progresso pro terminal THTEST do Aurora: imprime
  // "@@AURORA_PROG <cyc> <nclk> <reads>" no stdout a cada ~1% dos clocks.
  // Aurora consome essas linhas (nao as ecoa) pra mover a barra ASCII.
  // step = no minimo 1 pra nclk pequeno. fflush a cada marcador porque o
  // stdout do exe e bloco-bufferizado quando vai pra um pipe — sem flush a
  // barra so apareceria no fim. ~100 flushes na sim toda: custo desprezivel.
  L.push(`  unsigned step = nclk/100; if(step==0) step=1;`);
  // itr (linha de interrupcao) fica baixa a simulacao toda — escrever 0
  // uma vez antes do loop em vez de a cada ciclo. Nao muda nada no modelo
  // e tira um store do caminho quente.
  if (itr) L.push(`  top->${itr.name} = 0;`);
  L.push('');
  L.push(`  for(unsigned cyc=0; cyc<nclk; cyc++){`);
  L.push(`    top->${rst ? rst.name : 'rst'} = (cyc==0) ? 1 : 0;`);
  L.push(`    // --- borda de subida: processador computa; req_in/out_en/out validos ---`);
  L.push(`    top->${clk.name} = 1; top->eval(); main_time++;`);
  // escreve saidas (out_en one-hot), decimal com sinal-extensao da largura
  for (const p of outputs) {
    L.push(`    if(top->${enBus.name} == ${p.enValue}u) {`);
    L.push(`      long long v = (long long)(uint64_t)top->${outBus.name};`);
    if (outW < 64) {
      L.push(`      { long long m = 1LL << ${outW - 1}; v = (v ^ m) - m; } // sinal-extensao ${outW} bits`);
    }
    L.push(`      fprintf(o_out_${p.port}, "%lld\\n", v);`);
    L.push(`    }`);
  }
  L.push(`    // --- borda de descida: le a entrada que o processador pediu ---`);
  L.push(`    top->${clk.name} = 0; top->eval(); main_time++;`);
  for (const p of inputs) {
    L.push(`    if(top->${reqBus.name} == ${p.reqValue}u) { long long v; if(next_dec(f_in_${p.port}, v)){ top->${inBus.name} = (uint64_t)v; reads++; } }`);
  }
  L.push(`    if((cyc % step) == 0){ printf("@@AURORA_PROG %u %u %llu\\n", cyc+1, nclk, reads); fflush(stdout); }`);
  L.push(`  }`);
  L.push(`  printf("@@AURORA_PROG %u %u %llu\\n", nclk, nclk, reads); fflush(stdout);`);
  // FILE* nao tem destrutor — fechar explicitamente pra dar flush das saidas
  // bufferizadas antes do processo terminar.
  for (const p of inputs) L.push(`  if(f_in_${p.port}) fclose(f_in_${p.port});`);
  for (const p of outputs) L.push(`  if(o_out_${p.port}) fclose(o_out_${p.port});`);
  L.push(`  printf("Aurora: %u clocks simulados, %llu leitura(s) de entrada.\\n", nclk, reads);`);
  L.push(`  top->final();`);
  L.push(`  delete top;`);
  L.push(`  return 0;`);
  L.push(`}`);
  L.push('');

  return { source: L.join('\n'), hasItr: !!itr, inputs, outputs };
}
