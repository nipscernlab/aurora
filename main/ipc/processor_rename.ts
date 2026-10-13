/**
 * processor_rename.ts: o que muda de nome quando um processador e renomeado.
 *
 * Extraido do main/ipc/project.js (god file) quando o rename precisou conhecer
 * a segunda linguagem.
 *
 * Desde o yanc v7.1 o nome do processador e o nome do arquivo fonte, e a
 * estrutura e a do yanc (js/compilation/pastas_do_processador.ts):
 *
 *   <proj>/<proc>/<proc>.cmm|.cpp     o fonte, com os dados ao lado
 *   <proj>/<proc>/<proc>/             a pasta de saida, com o que o yanc gera
 *
 * Renomear e mover a pasta do processador, renomear o fonte e renomear a
 * pasta de saida com os arquivos que levam o nome dele. Nao ha mais diretiva
 * a reescrever dentro do fonte: o `#PRNAME` e o `#pragma yanc prname`
 * deixaram de existir.
 *
 * E logica pura, sem disco: recebe nomes, devolve nomes.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_rename.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { arquivosDaSaida } from '../../js/compilation/pastas_do_processador.js';
import { sourceExtensions } from '../../js/compilation/processor_source.js';

/**
 * Um arquivo a renomear: em que pasta ele esta (a do fonte, ou a de saida ja
 * com o nome novo), o nome velho e o novo.
 */
export interface ArtefatoRenomeado {
  pasta: 'fonte' | 'saida';
  de: string;
  para: string;
}

/**
 * Os nomes da pasta de saida que seguem o processador. O `.sv` do testbench
 * entra porque o `.spf` pode guardar um `<proc>_tb.sv` que a pessoa escreveu
 * la, e o caminho dele e reescrito no `.spf` (processadores_do_spf.ts): sem o
 * par aqui, o `.spf` apontaria para um arquivo que nao existe.
 */
function nomesDaSaida(nome: string): string[] {
  const a = arquivosDaSaida(nome);
  return [a.asm, a.verilog, `${nome}.sv`, a.testbench, `${nome}_tb.sv`, a.instMif, a.dataMif, a.pcMem];
}

/**
 * Tudo que o SAPHO nomeia a partir do processador, na ordem em que o rename
 * aplica, depois de a pasta do processador e a de saida ja terem mudado.
 *
 * Os fontes das DUAS linguagens entram na lista, e nao so o da linguagem
 * declarada, de proposito: quem renomeia nao sabe (e nao deveria precisar
 * saber) o que existe no disco. Quem chama pula o que nao existir.
 */
export function artefatosDoProcessador(nomeVelho: string, nomeNovo: string): ArtefatoRenomeado[] {
  const fontes = sourceExtensions().map((ext) => ({
    pasta: 'fonte' as const, de: `${nomeVelho}${ext}`, para: `${nomeNovo}${ext}`,
  }));
  const velhos = nomesDaSaida(nomeVelho);
  const novos = nomesDaSaida(nomeNovo);
  const saida = velhos.map((de, i) => ({ pasta: 'saida' as const, de, para: novos[i] }));
  return [...fontes, ...saida];
}

/** O nome do fonte de cada linguagem, para quem precisa procurar no disco. */
export function fontesPossiveis(nome: string): string[] {
  return sourceExtensions().map((ext) => `${nome}${ext}`);
}
