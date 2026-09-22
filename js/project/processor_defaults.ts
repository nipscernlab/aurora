/**
 * processor_defaults.ts: quanto vale um processador novo, e o fonte que nasce
 * com ele.
 *
 * Extraido do main/ipc/project.js (god file) quando o C++ virou a segunda
 * linguagem, e movido do main/ipc para ca depois, quando ficou claro que os
 * mesmos numeros estavam em QUATRO lugares:
 *
 *   - `CMM_DEFAULTS` e `createCmmTemplate`, no js/tabs/tab_utils.ts, que e o
 *     texto de uma aba `.cmm` nova;
 *   - os `value=` do formulario do Processor Hub, no index.html;
 *   - os padroes do cppcomp aqui;
 *   - um espelho deles, a mao, no js/processors/processor_hub.ts.
 *
 * O espelho do hub dizia em comentario que nao havia como compartilhar modulo
 * porque um lado roda no processo principal e o outro no renderer. Nao e mais
 * verdade: o processo principal carrega modulo ESM daqui com `require`, que e
 * o que o main/ipc/run_log.js ja fazia e o que tres modulos passaram a fazer
 * em 2026-09-21. Por isso este arquivo mora em js/ e nao em main/.
 *
 * As duas linguagens dizem a mesma coisa de jeitos diferentes:
 *
 *   C+- : diretivas `#NUBITS 23` no cabecalho do arquivo.
 *   C++ : `#pragma yanc nubits 23`, lidas pelo lexer do cppcomp
 *         (Compilers/CPPComp/Sources/CPPComp.l).
 *
 * E logica pura, sem disco: recebe os campos do formulario e devolve texto.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_defaults.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Os nove campos do Processor Hub. O C++ so usa tres deles; ver abaixo. */
export interface ParametrosDoProcessador {
  processorName: string;
  nBits?: number | string;
  nbMantissa?: number | string;
  nbExponent?: number | string;
  dataStackSize?: number | string;
  instructionStackSize?: number | string;
  inputPorts?: number | string;
  outputPorts?: number | string;
  gain?: number | string;
}

/**
 * O que um processador C+- vale quando ninguem escolhe nada.
 *
 * Sao os numeros que o Processor Hub mostra no formulario (os `value=` do
 * index.html) e os que uma aba `.cmm` nova carrega no cabecalho. As chaves
 * sao as do formulario, que e a mesma coisa que o id de cada campo no HTML.
 *
 * 23 = 16 + 6 + 1: e o float estreito do SAPHO, e nao o do IEEE-754.
 */
export const PADROES_DO_CMM = Object.freeze({
  nBits: 23,
  nbMantissa: 16,
  nbExponent: 6,
  gain: 128,
  dataStackSize: 5,
  instructionStackSize: 5,
  inputPorts: 1,
  outputPorts: 1,
});

/**
 * O que o cppcomp assume quando o fonte NAO traz o pragma
 * (Compilers/CPPComp/Headers/config.h). Esta tabela existe para a interface
 * poder MOSTRAR o que vai acontecer nos campos que ela desabilita, em vez de
 * deixar na tela os numeros do C+-, que seriam mentira.
 *
 * Repare que 32 = 23 + 8 + 1: o default do C++ e o float de precisao simples
 * do IEEE-754, enquanto o do C+- e o formato estreito do SAPHO.
 */
export const PADROES_DO_CPPCOMP = Object.freeze({
  nBits: 32,
  nbMantissa: 23,
  nbExponent: 8,
  gain: 128,
  dataStackSize: 128,
  instructionStackSize: 128,
});

/** O fonte C+-: as nove diretivas do cabecalho e um main vazio. */
export function cmmTemplate(p: ParametrosDoProcessador): string {
  return `#PRNAME ${p.processorName}
#NUBITS ${p.nBits}
#NDSTAC ${p.dataStackSize}
#SDEPTH ${p.instructionStackSize}
#NUIOIN ${p.inputPorts}
#NUIOOU ${p.outputPorts}
#NBMANT ${p.nbMantissa}
#NBEXPO ${p.nbExponent}
#NUGAIN ${p.gain}

void main()
{
    // Øk. Você criou um processador em C±, mas e agora?
}`;
}

/**
 * O fonte C++: tres pragmas e um main vazio.
 *
 * So tres, e nao nove, porque o Processor Hub so pergunta nome e portas
 * quando a linguagem e C++. Largura, mantissa, expoente, ganho e as duas
 * pilhas ficam com o que o cppcomp assume sozinho, que e o float de precisao
 * simples; escrever esses pragmas aqui seria cravar no fonte de todo mundo um
 * valor que a pessoa nao escolheu. Quem precisar mexer acrescenta o pragma a
 * mao, e o cppcomp obedece.
 *
 * `void main(void)` e a forma que os exemplos do yanc usam
 * (Compilers/CPPComp/Tests/proc_cpp).
 */
export function cppTemplate(p: ParametrosDoProcessador): string {
  return `#pragma yanc prname ${p.processorName}
#pragma yanc nuioin ${p.inputPorts}
#pragma yanc nuioou ${p.outputPorts}

void main(void)
{
    // Øk. Você criou um processador em C++, mas e agora?
}`;
}

/**
 * O cabecalho C+- com os padroes, que e o que uma aba `.cmm` nova mostra.
 *
 * A quebra de linha no fim e a unica diferenca em relacao ao `cmmTemplate`, e
 * ela existe porque este texto vai para um editor e aquele vai para o disco.
 * Manter a diferenca explicita aqui e mais honesto do que as duas funcoes
 * terem um `\n` de sorte cada uma.
 */
export function cmmTemplatePadrao(processorName = 'processor'): string {
  return `${cmmTemplate({ processorName, ...PADROES_DO_CMM })}\n`;
}

/** Nome do arquivo e conteudo, pela linguagem pedida. C+- quando omitida. */
export function processorSourceFile(
  p: ParametrosDoProcessador,
  language?: string | null,
): { fileName: string, content: string } {
  return String(language || '').toLowerCase() === 'cpp'
    ? { fileName: `${p.processorName}.cpp`, content: cppTemplate(p) }
    : { fileName: `${p.processorName}.cmm`, content: cmmTemplate(p) };
}
