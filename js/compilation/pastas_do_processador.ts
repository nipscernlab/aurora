/**
 * pastas_do_processador.ts: onde mora cada arquivo de um processador SAPHO, e
 * que nome o processador pode ter.
 *
 * Desde o yanc v7.1 a estrutura e a do proprio yanc, igual a de quem o usa no
 * terminal:
 *
 *   <proj>/<proc>/            o que a pessoa escreve: <proc>.cmm ou .cpp, os
 *                             arquivos que inicializam vetores, input_N.txt,
 *                             cade_k.txt e os headers do C++;
 *   <proj>/<proc>/<proc>/     a pasta de saida, plana, com tudo o que o yanc
 *                             gera: .asm, prog_log.txt, src_lines.txt,
 *                             pc_<proc>_mem.txt, app_log.txt, trad_opcode.txt,
 *                             <proc>.v, os .mif e <proc>_tb.v. A simulacao do
 *                             processador roda com ela como diretorio de
 *                             trabalho e grava ali output_N.txt e o .vcd.
 *
 * Antes havia Software/, Hardware/ e Simulation/ dentro de <proj>/<proc>/, e
 * os intermediarios iam para .aurora/Temp/<proc>. Cada lugar que precisava de
 * um desses caminhos o montava sozinho; este modulo e o unico que responde
 * agora, e os outros perguntam aqui.
 *
 * O nome do processador e o nome do arquivo fonte: `filtro.cmm` gera o
 * processador `filtro`, o `filtro.v` e o modulo `filtro`. Por isso o nome
 * precisa servir de modulo Verilog, e a regra e a do yanc
 * (Compilers/common/proc_name.c), copiada aqui para a AURORA recusar o nome
 * na hora de criar ou renomear, e nao so quando a compilacao falhar.
 *
 * E LOGICA PURA: so nomes e segmentos de caminho, nenhum acesso a disco,
 * nenhum electronAPI. O main/ (CommonJS) importa daqui tambem.
 *
 * Compilado por `tsc` (npm run build:ts) num pastas_do_processador.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Os segmentos, a partir da pasta do projeto, da pasta do fonte. */
export function segmentosDoFonte(nome: string): string[] {
  return [nome];
}

/** Os segmentos, a partir da pasta do projeto, da pasta de saida do yanc. */
export function segmentosDaSaida(nome: string): string[] {
  return [nome, nome];
}

/** Os arquivos que o yanc escreve na pasta de saida, pelo nome do processador. */
export interface ArquivosDaSaida {
  asm: string;
  progLog: string;
  srcLines: string;
  pcMem: string;
  appLog: string;
  tradOpcode: string;
  verilog: string;
  instMif: string;
  dataMif: string;
  testbench: string;
}

export function arquivosDaSaida(nome: string): ArquivosDaSaida {
  return {
    asm: `${nome}.asm`,
    progLog: 'prog_log.txt',
    srcLines: 'src_lines.txt',
    pcMem: `pc_${nome}_mem.txt`,
    appLog: 'app_log.txt',
    tradOpcode: 'trad_opcode.txt',
    verilog: `${nome}.v`,
    instMif: `${nome}_inst.mif`,
    dataMif: `${nome}_data.mif`,
    testbench: `${nome}_tb.v`,
  };
}

/**
 * Os arquivos que o Verilog gerado le pelo nome puro, relativo ao diretorio
 * da simulacao: os .mif (DFILE/IFILE) e o pc_<nome>_mem.txt ($readmemb). Uma
 * simulacao que nao roda na pasta de saida (a do projeto, com varios
 * processadores) precisa deles copiados para o seu diretorio.
 */
export function arquivosLidosPeloVerilog(nome: string): string[] {
  const a = arquivosDaSaida(nome);
  return [a.instMif, a.dataMif, a.pcMem];
}

/** Em que lugar do processador um arquivo esta. */
export type LugarNoProcessador = 'fonte' | 'saida';

function segmentos(caminho: string): string[] {
  return caminho.replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * De que processador e um arquivo, e se ele esta na pasta do fonte ou na de
 * saida. `null` fora do projeto, fora de um processador conhecido, ou numa
 * subpasta que nao e nenhuma das duas.
 *
 * A comparacao ignora caixa (o Windows ignora) e o nome devolvido e o da
 * lista, com a caixa de la.
 */
export function processadorDoCaminho(
  caminho: string | null | undefined,
  projeto: string | null | undefined,
  nomes: readonly string[],
): { nome: string; lugar: LugarNoProcessador } | null {
  if (!caminho || !projeto) return null;
  const arq = segmentos(caminho).map((s) => s.toLowerCase());
  const proj = segmentos(projeto).map((s) => s.toLowerCase());
  if (arq.length <= proj.length) return null;
  for (let i = 0; i < proj.length; i++) if (arq[i] !== proj[i]) return null;
  const rel = arq.slice(proj.length);
  const nome = nomes.find((n) => n.toLowerCase() === rel[0]);
  if (!nome) return null;
  if (rel.length === 2) return { nome, lugar: 'fonte' };
  if (rel.length === 3 && rel[1] === rel[0]) return { nome, lugar: 'saida' };
  return null;
}

/**
 * Os nomes dos processadores de uma lista do `.spf`, que guarda cada um como
 * texto (formato antigo) ou como objeto com `name`. Entradas sem nome saem.
 */
export function nomesDosProcessadores(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((p) => (typeof p === 'string' ? p : (p as { name?: unknown } | null)?.name))
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
}

/**
 * Onde uma simulacao com este testbench precisa rodar, em segmentos a partir
 * da pasta do projeto, ou `null` para a propria pasta do projeto.
 *
 * O <proc>_tb.v que o yanc gera nomeia tudo relativo a pasta de saida: os
 * .mif, o pc_<proc>_mem.txt, output_N.txt e o .vcd pelo nome puro, e os
 * input_N.txt como `../input_N.txt`. Ele so roda certo com a pasta de saida
 * como diretorio de trabalho. Qualquer outro testbench (o do projeto, com o
 * top-level e varios processadores) roda na pasta do projeto, com as memorias
 * dos processadores copiadas para la.
 */
export function segmentosDaSimulacao(
  testbench: string | null | undefined,
  projeto: string | null | undefined,
  nomes: readonly string[],
): string[] | null {
  const lugar = processadorDoCaminho(testbench, projeto, nomes);
  return lugar && lugar.lugar === 'saida' ? segmentosDaSaida(lugar.nome) : null;
}

/**
 * Palavras reservadas do Verilog (IEEE 1364-2005) e do SystemVerilog (IEEE
 * 1800-2017). Copia da lista do yanc, Compilers/common/proc_name.c: um modulo
 * pode ser lido pelo Icarus, Verilator, Quartus ou Vivado em qualquer modo.
 */
const RESERVADAS: ReadonlySet<string> = new Set([
  'accept_on', 'alias', 'always', 'always_comb', 'always_ff', 'always_latch',
  'and', 'assert', 'assign', 'assume', 'automatic', 'before', 'begin', 'bind',
  'bins', 'binsof', 'bit', 'break', 'buf', 'bufif0', 'bufif1', 'byte', 'case',
  'casex', 'casez', 'cell', 'chandle', 'checker', 'class', 'clocking', 'cmos',
  'config', 'const', 'constraint', 'context', 'continue', 'cover',
  'covergroup', 'coverpoint', 'cross', 'deassign', 'default', 'defparam',
  'design', 'disable', 'dist', 'do', 'edge', 'else', 'end', 'endcase',
  'endchecker', 'endclass', 'endclocking', 'endconfig', 'endfunction',
  'endgenerate', 'endgroup', 'endinterface', 'endmodule', 'endpackage',
  'endprimitive', 'endprogram', 'endproperty', 'endsequence',
  'endspecify', 'endtable', 'endtask', 'enum', 'event', 'eventually',
  'expect', 'export', 'extends', 'extern', 'final', 'first_match', 'for',
  'force', 'foreach', 'forever', 'fork', 'forkjoin', 'function', 'generate',
  'genvar', 'global', 'highz0', 'highz1', 'if', 'iff', 'ifnone',
  'ignore_bins', 'illegal_bins', 'implements', 'implies', 'import',
  'incdir', 'include', 'initial', 'inout', 'input', 'inside', 'instance',
  'int', 'integer', 'interconnect', 'interface', 'intersect', 'join',
  'join_any', 'join_none', 'large', 'let', 'liblist', 'library', 'local',
  'localparam', 'logic', 'longint', 'macromodule', 'matches', 'medium',
  'modport', 'module', 'nand', 'negedge', 'nettype', 'new', 'nexttime',
  'nmos', 'nor', 'noshowcancelled', 'not', 'notif0', 'notif1', 'null', 'or',
  'output', 'package', 'packed', 'parameter', 'pmos', 'posedge', 'primitive',
  'priority', 'program', 'property', 'protected', 'pull0', 'pull1',
  'pulldown', 'pullup', 'pulsestyle_ondetect', 'pulsestyle_onevent', 'pure',
  'rand', 'randc', 'randcase', 'randsequence', 'rcmos', 'real', 'realtime',
  'ref', 'reg', 'reject_on', 'release', 'repeat', 'restrict', 'return',
  'rnmos', 'rpmos', 'rtran', 'rtranif0', 'rtranif1', 's_always',
  's_eventually', 's_nexttime', 's_until', 's_until_with', 'scalared',
  'sequence', 'shortint', 'shortreal', 'showcancelled', 'signed', 'small',
  'soft', 'solve', 'specify', 'specparam', 'static', 'string', 'strong',
  'strong0', 'strong1', 'struct', 'super', 'supply0', 'supply1',
  'sync_accept_on', 'sync_reject_on', 'table', 'tagged', 'task', 'this',
  'throughout', 'time', 'timeprecision', 'timeunit', 'tran', 'tranif0',
  'tranif1', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg', 'type',
  'typedef', 'union', 'unique', 'unique0', 'unsigned', 'until',
  'until_with', 'untyped', 'use', 'uwire', 'var', 'vectored', 'virtual',
  'void', 'wait', 'wait_order', 'wand', 'weak', 'weak0', 'weak1', 'while',
  'wildcard', 'wire', 'with', 'within', 'wor', 'xnor', 'xor',
]);

/** Por que um nome nao serve de processador, na ordem em que o yanc confere. */
export type ProblemaNoNome = 'vazio' | 'caracteres' | 'digito' | 'sublinhado' | 'reservada';

/**
 * O que impede `nome` de ser nome de processador, ou `null` quando serve. A
 * mesma regra e a mesma ordem do proc_name_problem() do yanc: so letras ASCII,
 * digitos e `_`; sem digito no inicio; sem `__` no inicio; nenhuma palavra
 * reservada (com a caixa exata, como o Verilog compara).
 */
export function problemaNoNomeDoProcessador(nome: unknown): ProblemaNoNome | null {
  const n = typeof nome === 'string' ? nome : '';
  if (!n) return 'vazio';
  if (!/^[A-Za-z0-9_]+$/.test(n)) return 'caracteres';
  if (/^[0-9]/.test(n)) return 'digito';
  if (n.startsWith('__')) return 'sublinhado';
  if (RESERVADAS.has(n)) return 'reservada';
  return null;
}
