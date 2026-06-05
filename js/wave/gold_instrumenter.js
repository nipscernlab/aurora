/**
 * gold_instrumenter.js — instrumenta o testbench Verilog "gabarito" pra dumpar
 * o ESTADO FINAL das saidas top-level, e compara com o que o harness IA
 * produziu. Usado pela validacao do botao "harness IA" (Fase 1, Passo 2):
 * roda-se o testbench original sob Verilator (--timing) com este dump, roda-se
 * o harness gerado, e comparam-se as saidas. So "certifica" o harness se baterem.
 *
 * Puro (sem I/O): a orquestracao (build/run/compare) vive em CompilationModule.
 *
 * Estrategia:
 *  - Acha a instancia do DUT no testbench e mapeia porta->expr conectado, pra
 *    referenciar os WIRES do testbench (nao hierarchical refs, que o Verilator
 *    nem sempre expoe).
 *  - Injeta um `final` block (roda no $finish) com $fwrite de cada saida no
 *    formato "porta=valor" (uma por linha) — comparado por NOME, entao a ordem
 *    das portas e portas ausentes nao quebram o alinhamento.
 */
import { stripVerilogComments, lastEndmoduleIndex } from './testbench_instrumenter.js';

/**
 * Acha a instancia do DUT (`<topModule> <inst> ( ... );`) no testbench e mapeia
 * cada `.porta(expr)` -> expr. Ignora codigo comentado (instancias comentadas
 * nao contam). Retorna null se nao achar.
 *
 * @param {string} src
 * @param {string} topModule
 * @returns {{ instName:string, conns:Map<string,string> } | null}
 */
export function findDutInstance(src, topModule) {
  const stripped = stripVerilogComments(src);
  // <topModule> <inst> ( <body> ) ;  — body lazy ate o ')' que precede ';'.
  const re = new RegExp(`\\b${topModule}\\s+(\\w+)\\s*\\(([\\s\\S]*?)\\)\\s*;`);
  const m = re.exec(stripped);
  if (!m) return null;
  const conns = new Map();
  // .porta ( expr ) — expr sem parenteses aninhados (cobre wire/sinal simples,
  // o caso comum de conexao top-level). Conexoes posicionais nao sao suportadas.
  for (const c of m[2].matchAll(/\.(\w+)\s*\(\s*([^()]*?)\s*\)/g)) {
    conns.set(c[1], c[2].trim());
  }
  return { instName: m[1], conns };
}

/**
 * Injeta o `final` block de dump do estado final das saidas top-level.
 *
 * @param {object} opts
 * @param {string}   opts.src        source do testbench .v
 * @param {string}   opts.topModule  nome do modulo top-level (DUT)
 * @param {string[]} opts.outPorts   nomes das portas de saida (parseVerilatorPorts)
 * @param {string}   opts.goldFile   arquivo de saida do dump (ex: "aurora_gold.txt")
 * @returns {{ content:string, dumped:string[] }}  source instrumentado + portas dumpadas
 * @throws se nao achar a instancia / nenhuma saida conectada / sem endmodule
 */
export function instrumentGoldTestbench({ src, topModule, outPorts, goldFile }) {
  const inst = findDutInstance(src, topModule);
  if (!inst) throw new Error(`DUT instance of "${topModule}" not found in the testbench`);

  const dumped = [];
  const writes = [];
  for (const p of outPorts) {
    const expr = inst.conns.get(p);
    if (!expr) continue; // porta nao conectada nesse tb — pula (compara so as comuns)
    dumped.push(p);
    writes.push(`    $fwrite(__aurora_gold_fd, "${p}=%0d\\n", ${expr});`);
  }
  if (writes.length === 0) {
    throw new Error('no connected output ports found on the DUT instance');
  }

  const block = [
    '',
    '// --- AURORA GOLD DUMP (final state of top-level outputs) ---',
    'integer __aurora_gold_fd;',
    'final begin',
    `    __aurora_gold_fd = $fopen("${goldFile}", "w");`,
    ...writes,
    '    $fclose(__aurora_gold_fd);',
    'end',
    '// ----------------------------------------------------------',
    '',
  ].join('\n');

  const idx = lastEndmoduleIndex(src);
  if (idx === -1) throw new Error('endmodule not found in the testbench');
  return { content: src.slice(0, idx) + block + src.slice(idx), dumped };
}

/** Parseia um dump "nome=valor" (uma entrada por linha) num Map. */
export function parseKvDump(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (eq > 0) out.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Compara o dump do gabarito com o do harness pelas chaves COMUNS.
 * @returns {{ ok:boolean, common:number, diffs:Array<{name,ref,got}> }}
 *          ok = true so se ha ao menos uma chave comum e todas batem.
 */
export function compareKvDumps(refText, harnessText) {
  const ref = parseKvDump(refText);
  const got = parseKvDump(harnessText);
  const common = [...ref.keys()].filter((k) => got.has(k));
  const diffs = [];
  for (const k of common) {
    if (ref.get(k) !== got.get(k)) diffs.push({ name: k, ref: ref.get(k), got: got.get(k) });
  }
  return { ok: diffs.length === 0 && common.length > 0, common: common.length, diffs };
}
