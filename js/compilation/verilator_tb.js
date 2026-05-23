/**
 * verilator_tb.js — top-level Verilator harness generator.
 *
 * Botao "Verilator (top-level)" da toolbar: em vez do `--binary --main`
 * do fluxo Wave (que gera o main e roda ate $finish dumpando FST), aqui
 * geramos um testbench C++ MANUAL que:
 *
 *   1. instancia a classe verilada V<top>
 *   2. roda um for-loop dando clock (posedge por ciclo)
 *   3. le os pinos de ENTRADA de arquivos  <pino>.in  (um valor hex por
 *      linha = um ciclo; mantem o ultimo valor quando o arquivo acaba)
 *   4. escreve os pinos de SAIDA em arquivos <pino>.out (um hex por linha)
 *
 * As portas do top-level vem do AST que o Verilator emite com
 * `--json-only` (V<top>.tree.json) — robusto a parametros, larguras e
 * includes, ao contrario de regex sobre o .v. Ver parseVerilatorPorts.
 *
 * Tudo aqui e PURO (sem I/O, sem window): recebe o JSON parseado +
 * config, devolve string. A orquestracao (rodar verilator, escrever os
 * arquivos, rodar o .exe) vive em CompilationModule.verilatorTopLevelRun.
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

/**
 * Le a diretiva de handshake do cabecalho de um arquivo <pino>.in.
 *
 * Procura, antes da primeira linha de dado, uma linha no formato
 *   # @gate=<nome_do_pino_de_request>
 * Devolve o nome do pino (request, ativo em 1) ou null se nao houver.
 *
 * @param {string} content  conteudo bruto do .in
 * @returns {string|null}
 */
export function parseGateDirective(content) {
  if (typeof content !== 'string') return null;
  for (const raw of content.split(/\r?\n/)) {
    const m = raw.match(/^\s*#\s*@gate\s*=\s*([A-Za-z_]\w*)/);
    if (m) return m[1];
    const t = raw.trim();
    // Primeira linha de dado (nao-comentario, nao-vazia): para de varrer.
    if (t && !t.startsWith('#')) break;
  }
  return null;
}

/**
 * Gera o codigo C++ do harness.
 *
 * A simulacao termina assim que o PRIMEIRO arquivo de entrada se esgota
 * (EOF) — o estimulo define a duracao. maxCycles e so um limite de
 * seguranca (evita loop infinito quando nao ha entrada lida: ex. design
 * so com clock, ou entradas gated cujo request nunca sobe).
 *
 * @param {object} opts
 * @param {string} opts.topModule
 * @param {Array}  opts.ports        saida de parseVerilatorPorts
 * @param {number} [opts.maxCycles]  limite de seguranca (overridable em runtime via +cycles=N)
 * @param {Object.<string,string>} [opts.gates]
 *        mapa input->pino de request (output). Quando presente, o
 *        proximo valor do <input>.in so e lido nos ciclos em que o
 *        request esta em 1 (handshake same-cycle: request amostrado com
 *        clock baixo, dado consumido na borda de subida do MESMO ciclo).
 *        Vem de diretivas `# @gate=<pino>` no topo dos .in (lidas e
 *        validadas por CompilationModule.verilatorTopLevelRun).
 * @param {Object.<string,string>} [opts.outGates]
 *        mapa output->pino de enable. Quando presente, a saida so e
 *        escrita em <output>.out nos ciclos em que o enable esta em 1
 *        (amostrado depois da borda, junto com o proprio dado). A
 *        diretiva `# @gate=<pino>` e re-emitida como 1a linha do .out
 *        pra sobreviver ao overwrite. Sem diretiva: escreve todo ciclo.
 * @returns {{ source:string, clocks:string[], inputs:object[],
 *            outputs:object[], gated:object[], outGated:object[] }}
 */
export function generateVerilatorTb({ topModule, ports, maxCycles = 1000000, gates = {}, outGates = {} }) {
  const clocks = [];
  const inputs = [];
  const outputs = [];

  for (const p of ports) {
    if (p.direction === 'output') { outputs.push(p); continue; }
    // input / inout
    if (p.direction === 'input' && p.width === 1 && isClockName(p.name)) {
      clocks.push(p);
    } else {
      inputs.push(p);
    }
    if (p.direction === 'inout') outputs.push(p); // amostra inout tambem
  }

  // Entradas com handshake: input -> pino de request. Ungated = lidas
  // todo ciclo; gated = lidas so quando o request esta em 1 (same-cycle).
  const gated = inputs.filter((p) => gates[p.name]);
  const ungated = inputs.filter((p) => !gates[p.name]);

  // Saidas com enable: output -> pino de enable. Escritas so quando o
  // enable esta em 1; sem enable, escritas todo ciclo.
  const outGated = outputs.filter((p) => outGates[p.name]);

  const L = [];
  const wide = (p) => p.width > 64;

  // Emite a expressao C++ que escreve UMA amostra de <p> no stream o_<p>.
  const writeStmt = (p) => {
    if (wide(p)) {
      return `for(int k=${p.words}-1;k>=0;k--){ char b[16]; snprintf(b,sizeof(b),"%08x",(unsigned)top->${p.name}[k]); o_${p.name}<<b; } o_${p.name}<<"\\n";`;
    }
    return `char b[24]; snprintf(b,sizeof(b),"%llx",(unsigned long long)(uint64_t)top->${p.name}); o_${p.name}<<b<<"\\n";`;
  };

  // Emite a linha C++ que le UMA amostra de <p>.in e aplica no pino.
  // No EOF marca `done` — a simulacao para quando a 1a entrada se esgota.
  const applyLine = (p, indent) => {
    if (wide(p)) {
      return `${indent}{ std::string s; if(next_line(f_${p.name}, s)){ uint32_t w[${p.words}]; parse_hex_wide(s, w, ${p.words}); for(int k=0;k<${p.words};k++) top->${p.name}[k]=w[k]; } else done = true; }`;
    }
    return `${indent}{ std::string s; if(next_line(f_${p.name}, s)) top->${p.name} = parse_hex64(s); else done = true; }`;
  };

  L.push(`// Auto-gerado por Aurora — harness top-level do Verilator para "${topModule}".`);
  L.push(`// Loop de clock + I/O por arquivo (um arquivo por pino).`);
  L.push(`//   entradas:  <pino>.in   (um valor hex por linha = um ciclo)`);
  L.push(`//   saidas:    <pino>.out  (um valor hex por linha)`);
  if (gated.length) {
    L.push(`// Handshake de entrada (request ativo em 1, same-cycle):`);
    for (const p of gated) {
      L.push(`//   ${p.name}.in lido so quando top->${gates[p.name]} == 1`);
    }
  }
  if (outGated.length) {
    L.push(`// Saidas com enable (escritas so quando o enable esta em 1):`);
    for (const p of outGated) {
      L.push(`//   ${p.name}.out escrito so quando top->${outGates[p.name]} == 1`);
    }
  }
  L.push(`// Termina quando a 1a entrada se esgota (EOF). MAX_CYCLES e so`);
  L.push(`// limite de seguranca (sobrescreva em runtime com +cycles=N).`);
  L.push(`#include "V${topModule}.h"`);
  L.push(`#include "verilated.h"`);
  L.push(`#include <cstdint>`);
  L.push(`#include <cstdio>`);
  L.push(`#include <cstring>`);
  L.push(`#include <cstdlib>`);
  L.push(`#include <cctype>`);
  L.push(`#include <string>`);
  L.push(`#include <fstream>`);
  L.push('');
  L.push(`// Verilator com --timing referencia sc_time_stamp(); definimos`);
  L.push(`// aqui pra o harness manual linkar. main_time avanca por eval().`);
  L.push(`static uint64_t main_time = 0;`);
  L.push(`double sc_time_stamp() { return (double)main_time; }`);
  L.push('');
  L.push(`#ifndef MAX_CYCLES`);
  L.push(`#define MAX_CYCLES ${maxCycles}u`);
  L.push(`#endif`);
  L.push('');
  L.push(`static int hexval(char c){`);
  L.push(`  if(c>='0'&&c<='9') return c-'0';`);
  L.push(`  if(c>='a'&&c<='f') return c-'a'+10;`);
  L.push(`  if(c>='A'&&c<='F') return c-'A'+10;`);
  L.push(`  return 0;`);
  L.push(`}`);
  L.push(`static void strip(std::string& t){`);
  L.push(`  std::string o; for(char c: t){ if(!isspace((unsigned char)c)) o+=c; }`);
  L.push(`  if(o.size()>=2 && o[0]=='0' && (o[1]=='x'||o[1]=='X')) o=o.substr(2);`);
  L.push(`  t=o;`);
  L.push(`}`);
  L.push(`static uint64_t parse_hex64(std::string s){`);
  L.push(`  strip(s); uint64_t v=0;`);
  L.push(`  for(char c: s){ v=(v<<4)|(uint64_t)hexval(c); }`);
  L.push(`  return v;`);
  L.push(`}`);
  L.push(`// Hex (MSB-first) -> nwords palavras de 32 bits, LSB-first.`);
  L.push(`static void parse_hex_wide(std::string s, uint32_t* words, int nwords){`);
  L.push(`  for(int i=0;i<nwords;i++) words[i]=0;`);
  L.push(`  strip(s);`);
  L.push(`  int wi=0, shift=0;`);
  L.push(`  for(int i=(int)s.size()-1; i>=0 && wi<nwords; i--){`);
  L.push(`    words[wi] |= (uint32_t)hexval(s[i]) << shift;`);
  L.push(`    shift += 4;`);
  L.push(`    if(shift==32){ shift=0; wi++; }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`// Proxima linha util (ignora vazias e comentarios '#'). false no EOF.`);
  L.push(`static bool next_line(std::ifstream& f, std::string& out){`);
  L.push(`  std::string line;`);
  L.push(`  while(std::getline(f, line)){`);
  L.push(`    size_t a = line.find_first_not_of(" \\t\\r\\n");`);
  L.push(`    if(a==std::string::npos) continue;`);
  L.push(`    if(line[a]=='#') continue;`);
  L.push(`    out = line; return true;`);
  L.push(`  }`);
  L.push(`  return false;`);
  L.push(`}`);
  L.push('');
  L.push(`int main(int argc, char** argv){`);
  L.push(`  Verilated::commandArgs(argc, argv);`);
  L.push(`  unsigned maxc = MAX_CYCLES;`);
  L.push(`  for(int i=1;i<argc;i++){`);
  L.push(`    if(strncmp(argv[i], "+cycles=", 8)==0) maxc = (unsigned)strtoul(argv[i]+8, nullptr, 10);`);
  L.push(`  }`);
  L.push(`  V${topModule}* top = new V${topModule};`);
  L.push('');

  // streams de entrada (um por pino nao-clock)
  for (const p of inputs) {
    L.push(`  std::ifstream f_${p.name}("${p.name}.in");`);
  }
  // streams de saida. Saidas com enable re-emitem a diretiva `# @gate=`
  // como 1a linha pra ela sobreviver ao overwrite do .out.
  for (const p of outputs) {
    L.push(`  std::ofstream o_${p.name}("${p.name}.out");`);
    if (outGates[p.name]) {
      L.push(`  o_${p.name} << "# @gate=${outGates[p.name]}\\n";`);
    }
  }
  L.push('');
  L.push(`  bool done = false;   // vira true no EOF da 1a entrada consumida`);
  L.push(`  unsigned ran = 0;    // ciclos efetivamente simulados`);
  L.push(`  for(unsigned cyc=0; cyc<maxc && !done; cyc++){`);

  // 1. Entradas SEM handshake (controle: rst, en, ...): aplicadas antes
  //    de estabilizar a combinacional, pra o request refletir o ciclo atual.
  //    EOF aqui = primeiro arquivo consumido → encerra antes de clockar.
  for (const p of ungated) L.push(applyLine(p, '    '));
  if (ungated.length) L.push(`    if(done) break;`);

  // 2. Clock baixo + eval → outputs (inclusive os request) ficam validos.
  if (clocks.length) {
    for (const c of clocks) L.push(`    top->${c.name} = 0;`);
    L.push(`    top->eval(); main_time++;`);
  } else {
    L.push(`    top->eval(); main_time++; // sem clock detectado: avalia uma vez por ciclo`);
  }

  // 3. Entradas COM handshake: le o proximo valor SO no ciclo em que o
  //    request esta em 1 (apresentado no MESMO ciclo). Sem request, o
  //    pino mantem o ultimo valor. EOF aqui tambem encerra.
  for (const p of gated) {
    L.push(`    if(top->${gates[p.name]}) {`);
    L.push(applyLine(p, '      '));
    L.push(`    }`);
  }
  if (gated.length) L.push(`    if(done) break;`);

  // 4. Borda de subida → o circuito consome o dado apresentado neste ciclo.
  if (clocks.length) {
    for (const c of clocks) L.push(`    top->${c.name} = 1;`);
    L.push(`    top->eval(); main_time++;`);
  } else {
    L.push(`    top->eval(); main_time++;`);
  }

  // 5. amostra saidas (enable amostrado aqui, junto com o dado). Saida
  //    com enable so escreve quando top->enable == 1; sem enable, sempre.
  for (const p of outputs) {
    if (outGates[p.name]) {
      L.push(`    if(top->${outGates[p.name]}) { ${writeStmt(p)} }`);
    } else {
      L.push(`    { ${writeStmt(p)} }`);
    }
  }
  L.push(`    ran++;`);

  L.push(`  }`);
  L.push(`  printf("Aurora: %u ciclo(s) simulado(s) (parou: %s).\\n",`);
  L.push(`         ran, done ? "entrada consumida" : "limite de ciclos");`);
  L.push(`  top->final();`);
  L.push(`  delete top;`);
  L.push(`  return 0;`);
  L.push(`}`);
  L.push('');

  return {
    source: L.join('\n'),
    clocks: clocks.map((c) => c.name),
    inputs,
    outputs,
    gated: gated.map((p) => ({ name: p.name, gate: gates[p.name] })),
    outGated: outGated.map((p) => ({ name: p.name, gate: outGates[p.name] })),
  };
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

  // saidas: data_out_K = $fopen("...output_K.txt","w") + (proc_out_en == V) -> out_sig_K
  const outFile = {};
  for (const m of s.matchAll(/data_out_(\d+)\s*=\s*\$fopen\("([^"]+)"\s*,\s*"w"/g)) {
    outFile[m[1]] = basename(m[2]);
  }
  const outEn = {};
  for (const m of s.matchAll(/proc_out_en\s*==\s*(\d+)\s*\)\s*out_sig_(\d+)/g)) {
    outEn[m[2]] = parseInt(m[1], 10);
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

  // Pinos obrigatorios: clk sempre.
  // in/req_in: so se o tb declarar inputs (processador com entrada).
  // out/out_en: so se o tb declarar outputs (processador com saida).
  // Processadores tipo proc_fft que so computam e dumpam saidas nao
  // tem in/req_in no .v — esses ficam opcionais aqui. (E simetrico:
  // procs que so leem e nao escrevem ficariam sem out/out_en).
  const missing = [];
  if (!clk) missing.push('clk');
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
