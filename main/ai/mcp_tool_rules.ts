/**
 * mcp_tool_rules.ts: o bloco de instrucoes que diz a um agente de IA quais
 * ferramentas da AURORA usar, e que ele nao deve chamar binario nenhum por
 * conta propria.
 *
 * Existia QUATRO VEZES, como `MCP_TOOL_RULES`, nos quatro motores de IA:
 * claude_agent.js, claude_code.js, codex_agent.js e codex_cli.js. Os dois
 * primeiros eram byte a byte iguais entre si, e os dois ultimos tambem; entre
 * os pares, so a prosa das pontas mudava. O catalogo de ferramentas no meio
 * era identico nos quatro.
 *
 * Quatro copias do mesmo texto erram juntas, e erravam em tres coisas, todas
 * conferidas contra o codigo:
 *
 *   1. diziam que `compile_all` roda "CMM, ASM, Verilog, wave, PRISM". O
 *      `runProjectPipeline` (js/compilation/compilation_flow.js) pre-compila
 *      os processadores e chama `runGtkWave`. NAO HA PASSO PRISM;
 *   2. ofereciam cinco passos no `compile_step`, e a API aceita oito: faltavam
 *      `asm`, `verilator-proc` e `verilator-fast`, justamente os tres que o
 *      main/ai/tools.js documenta em detalhe logo abaixo;
 *   3. ofereciam cinco terminais, e a AURORA tem sete. Faltava o `thtest`,
 *      que o proprio tools.js manda o modelo ler depois de um teste de
 *      hardware.
 *
 * Agora o catalogo e um so e as duas listas vem de js/compilation/api_steps.ts,
 * que e de onde o `compileStep` e os esquemas das ferramentas tambem as leem.
 * Nao da mais para o texto e o codigo discordarem.
 *
 * O que muda entre os motores continua mudando, porque e verdade diferente: no
 * Claude a ferramenta Bash esta desligada e a AskUserQuestion embutida tambem;
 * no Codex o shell existe para leitura ocasional e nao ha como perguntar a um
 * humano. Isso entra por parametro.
 *
 * Compilado por `tsc` (npm run build:ts) num mcp_tool_rules.js ao lado, e esse
 * .js que o runtime carrega.
 */

import { PASSOS_DA_API, TERMINAIS } from '../../js/compilation/api_steps.js';

/** A prosa que muda de um motor para outro. */
export interface ProsaDoMotor {
  /** Como o agente e proibido de sair para o shell. */
  semShell: string[];
  /** Por que ele nao consegue perguntar direto, e o que usar no lugar. */
  perguntar: string[];
  /** O fecho, que repete a regra com as palavras do motor. */
  fecho: string[];
}

const aspas = (lista: readonly string[]) => lista.map((x) => `"${x}"`).join('|');

/** Monta o bloco. Devolve as linhas; quem chama junta com `\n`. */
export function regrasDasFerramentas(prosa: ProsaDoMotor): string[] {
  return [
    'You are running inside the Aurora IDE. Aurora exposes its own IDE and',
    'compiler tools through an MCP server registered as "aurora"; they appear',
    ...prosa.semShell,
    '',
    'Compilation & simulation — NEVER call any YANC binary (cmmcomp, cppcomp,',
    'cpppp, appcomp, asmcomp), nor yanc, iverilog, vvp, verilator or gtkwave',
    'from a shell. Use:',
    // O que o compile_all faz de verdade, e nao o que se dizia dele: o
    // pipeline completo para nos processadores e na forma de onda. O PRISM e
    // um passo proprio, que so roda quando pedido.
    '  - mcp__aurora__compile_all — full pipeline: every processor, then the',
    '    Verilog simulation and GTKWave. It does NOT open PRISM; ask for the',
    '    "prism" step when you want the RTL viewer.',
    `  - mcp__aurora__compile_step({step:${aspas(PASSOS_DA_API)}})`,
    '    — one step; "cmm" and "cpp" are the same step (the front end follows',
    '    the source in focus), "wave" opens GTKWave, "prism" opens the PRISM',
    '    RTL viewer, and the two "verilator-*" run the simulation headless.',
    '  - mcp__aurora__cancel_compilation',
    '',
    'Reading compiler results — Aurora streams every compiler into its own',
    'terminal panels; read those instead of capturing shell output:',
    `  - mcp__aurora__get_terminal_output({terminalId:${aspas(Object.keys(TERMINAIS))}})`,
    ...Object.entries(TERMINAIS).map(([id, oQue]) => `      ${id} — ${oQue}`),
    '  - mcp__aurora__read_all_terminals',
    '',
    'Project, files & processors:',
    '  - mcp__aurora__get_project_tree, read_file, create_file, refresh_file_tree',
    '  - mcp__aurora__set_top_level, set_testbench_top',
    '  - mcp__aurora__list_processors, get_processor_config, set_processor_config',
    '',
    'Waveforms:',
    '  - mcp__aurora__list_wave_signals, select_wave_signals, open_wave_config',
    '  - mcp__aurora__list_gtkw_files, add_gtkw_file, set_active_gtkw_file',
    '',
    ...prosa.perguntar,
    '',
    ...prosa.fecho,
  ];
}

/** Claude: a Bash e a AskUserQuestion embutidas estao desligadas de proposito. */
export const PROSA_CLAUDE: ProsaDoMotor = Object.freeze({
  semShell: [
    'to you as `mcp__aurora__<name>`. You MUST use these tools for every',
    'Aurora-specific action instead of shelling out. The Bash tool is disabled',
    'on purpose.',
  ],
  perguntar: [
    'Asking the user — your built-in AskUserQuestion tool is DISABLED here.',
    'Whenever you need a decision, clarification or a choice between options,',
    'call mcp__aurora__ask_user_question — it renders an interactive card in',
    'the IDE and returns the selected answer. Never guess when you could ask.',
  ],
  fecho: [
    'If a task seems to need a shell command, you are missing an Aurora tool —',
    'inspect the available mcp__aurora__* tools or ask the user. Do not',
    'improvise with PowerShell or raw filesystem calls for SAPHO work.',
  ],
});

/** Codex: o shell existe para leitura ocasional, e nao ha humano para perguntar. */
export const PROSA_CODEX: ProsaDoMotor = Object.freeze({
  semShell: [
    'to you as `mcp__aurora__<name>`. For every Aurora-specific action you',
    'MUST use these tools — do NOT run shell commands for them.',
  ],
  perguntar: [
    'Asking the user — you have NO way to prompt a human directly in this',
    'non-interactive mode. Whenever you need a decision, clarification or a',
    'choice between options, call mcp__aurora__ask_user_question — it renders',
    'an interactive card in the IDE and returns the selected answer. Never',
    'guess when you could ask.',
  ],
  fecho: [
    'The shell tool exists only for incidental, read-only inspection. Any time',
    'a task touches SAPHO compilation, the project tree, processors or',
    'waveforms, the matching mcp__aurora__* tool is mandatory — never the',
    'shell, never raw filesystem writes.',
  ],
});

/** Prontos para uso, que e como os quatro motores os consomem. */
export const REGRAS_CLAUDE = regrasDasFerramentas(PROSA_CLAUDE).join('\n');
export const REGRAS_CODEX = regrasDasFerramentas(PROSA_CODEX).join('\n');
