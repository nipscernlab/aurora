/**
 * run_history_labels.ts: o nome legivel de cada ferramenta da toolchain.
 *
 * Saiu do js/compilation/run_history.js, que e a TELA do historico, porque a
 * tabela nao tem nada de tela: e dado puro, e enterrada la nao tinha teste.
 * Importar a tela num teste sobe o gerenciador de abas e o modulo de
 * compilacao inteiros, entao a tabela nunca chegou a ser conferida contra a
 * lista de passos que a toolchain de fato tem.
 *
 * A conferencia que faltava achou o buraco: a tabela conhecia 16 passos e o
 * `STEP_IDS` do command_spec.ts tem 18. Os dois que faltavam eram os do C++,
 * `cpp-pp` e `cpp`, entao compilar um processador C++ enchia a tela de ids
 * crus enquanto todo o resto aparecia traduzido.
 *
 * Compilado por `tsc` (npm run build:ts) num run_history_labels.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/**
 * Passo da toolchain para a chave de traducao do nome dele.
 *
 * A ordem e a do `STEP_IDS` (js/compilation/command_spec.ts), que e a ordem em
 * que os passos rodam. Quem entrar la precisa entrar aqui tambem, e o teste
 * tests/unit/runHistorySteps.test.js recusa a falta.
 */
export const PASSOS: Readonly<Record<string, string>> = Object.freeze({
  'cmm': 'runHistory.step.cmm',
  // O front end do C++ sao dois passos: o cpppp resolve `#include` e `#define`
  // num pp.cpp na Temp, e o cppcomp compila esse pp.cpp.
  'cpp-pp': 'runHistory.step.cppPp',
  'cpp': 'runHistory.step.cpp',
  'asm-pre': 'runHistory.step.asmPre',
  'asm': 'runHistory.step.asm',
  'iverilog-check': 'runHistory.step.iverilogCheck',
  'iverilog-build': 'runHistory.step.iverilogBuild',
  'vvp-run': 'runHistory.step.vvpRun',
  'cocotb-run': 'runHistory.step.cocotbRun',
  'verilator-build': 'runHistory.step.verilatorBuild',
  'verilator-run': 'runHistory.step.verilatorRun',
  'verilator-json': 'runHistory.step.verilatorJson',
  'verilator-tb-build': 'runHistory.step.verilatorTbBuild',
  'verilator-tb-run': 'runHistory.step.verilatorTbRun',
  'fst2vcd': 'runHistory.step.fst2vcd',
  'gtkwave': 'runHistory.step.gtkwave',
  'yosys-hierarchy': 'runHistory.step.yosysHierarchy',
  'prism-yosys': 'runHistory.step.prismYosys',
});

/** A chave de traducao de um passo, ou `null` se a tabela nao o conhece. */
export function chaveDoPasso(step: unknown): string | null {
  return PASSOS[String(step)] || null;
}

/**
 * O nome legivel de um passo.
 *
 * Passo que a tabela nao conhece sai COMO VEIO, e nao atras de um rotulo
 * generico: uma ferramenta nova mal registrada e melhor aparecer pelo id do
 * que sumir dentro de "outro".
 *
 * @param step o id do passo, como o builder o escreveu
 * @param traduzir a funcao de traducao; sem ela, sai a propria chave
 */
export function nomeDoPasso(
  step: unknown,
  traduzir: (chave: string) => string = (chave) => chave,
): string {
  const chave = chaveDoPasso(step);
  return chave ? traduzir(chave) : String(step || '?');
}
