/**
 * api_steps.ts: os passos que `compile.compileStep` aceita e os terminais que
 * a IA pode ler.
 *
 * Duas listas curtas que estavam escritas a mao em varios lugares:
 *
 *   - os oito passos apareciam tres vezes (uma vez no `compileStep` da
 *     js/api/aurora_api.js e duas no main/ai/tools.js, nos esquemas do
 *     `compile_step` e do `run_in_background`) e, o que e pior, apareciam mais
 *     seis vezes ENCURTADOS PARA CINCO na prosa que os agentes de IA leem,
 *     faltando `asm`, `verilator-proc` e `verilator-fast`;
 *   - os terminais apareciam completos no js/terminal/terminal_module.js e
 *     cortados para cinco em tudo que a IA le, apesar de o proprio
 *     main/ai/tools.js mandar o modelo ler o `thtest`.
 *
 * Nao confundir com o `STEP_IDS` do command_spec.ts, que e outra coisa: la
 * sao os passos da TOOLCHAIN, uma entrada por ferramenta que roda (`cpp-pp`,
 * `iverilog-build`, `fst2vcd`...). Aqui sao os passos da API, que e o que um
 * botao da barra ou uma chamada da IA pede. Um passo daqui vira varios de la.
 *
 * Compilado por `tsc` (npm run build:ts) num api_steps.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

/**
 * Os passos que `compileStep` aceita, na ordem do pipeline.
 *
 * `cpp` e `cmm` sao O MESMO passo: o despacho por linguagem
 * (processor_dispatch.ts) escolhe o front end pelo fonte em foco, cmmcomp
 * para um `.cmm` e cpppp mais cppcomp para um `.cpp`.
 */
export const PASSOS_DA_API = Object.freeze([
  'cmm', 'cpp', 'asm', 'verilog', 'wave', 'prism',
  'verilator-proc', 'verilator-fast',
] as const);

export type PassoDaApi = typeof PASSOS_DA_API[number];

/** O passo existe? Aceita qualquer coisa, para validar entrada de fora. */
export function ehPassoDaApi(passo: unknown): passo is PassoDaApi {
  return (PASSOS_DA_API as readonly string[]).includes(String(passo));
}

/**
 * Os terminais da AURORA, com uma linha do que cai em cada um. A LINHA E EM
 * INGLES de proposito: ela vai inteira para o bloco de regras que o agente de
 * IA le e para a descricao do esquema da ferramenta, que sao textos em ingles.
 *
 * A IA le qualquer um deles por `get_terminal_output`; nao ha lista fechada do
 * lado de quem executa, que simplesmente procura o painel pelo id.
 */
export const TERMINAIS: Readonly<Record<string, string>> = Object.freeze({
  tcmm: 'language front end (cmmcomp, or cpppp + cppcomp)',
  tasm: 'assembler (appcomp and asmcomp)',
  tveri: 'project Verilog elaboration',
  twave: 'simulation and waveform (iverilog, vvp, GTKWave)',
  thtest: 'Verilator hardware test (the processor Verilator button)',
  tprism: 'schematic synthesis for PRISM (Yosys)',
  tcmd: "Aurora's own command terminal",
});

/** So os ids, para um enum de esquema. */
export const IDS_DE_TERMINAL = Object.freeze(Object.keys(TERMINAIS));
