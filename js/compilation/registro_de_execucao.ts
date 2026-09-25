/**
 * registro_de_execucao.ts: cada clique de compilar deixa rastro.
 *
 * Saiu do compilation_flow, onde dividia o arquivo com os botoes, o terminal e
 * o cancelamento. O problema que isto resolve esta no cabecalho de
 * run_log.ts: nao da para saber de antemao o que o usuario vai compilar, entao
 * o que se grava e o CLIQUE e o que ele acionou, e nao um formato por tipo de
 * compilacao. O compilation_flow e o unico lugar que sabe as duas pontas,
 * porque e dele que sai cada botao; ele envolve cada execucao em
 * `comRegistro`, e o resto mora aqui.
 *
 * O observador do spec_runner e quem enche a lista de passos: ele dispara em
 * TODA ferramenta que roda, sem que cada handler precise se lembrar de anotar.
 * Ele e desligado no fim, senao a execucao seguinte anotaria na anterior.
 *
 * Nada aqui pode derrubar uma compilacao: gravar o registro e melhor esforco.
 *
 * Compilado por `tsc` (npm run build:ts) num registro_de_execucao.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { problemStore } from '../terminal/problem_store.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { getAvailableProcessors } from '../project/processor_list.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { getViewer } from '../wave/viewer_preference.js';
import { addRunObserver } from './spec_runner.js';
import { foiCancelada } from './cancelamento.js';
import {
  abrirExecucao, anotarPasso, fecharExecucao, resumo, desfechoDaExecucao, problemasParaRegistro,
  type ConfigDoRetrato, type Execucao, type ResumoDeExecucao,
} from './run_log.js';

/** O que o funil de erro fatal conta sobre uma falha. */
export interface FalhaReportada {
  cancelada: boolean;
  mensagem: string | null;
}

let execucoesAtivas = 0;

/**
 * As execucoes que ainda nao terminaram.
 *
 * A tela do historico lia so o disco, e o disco so recebe a execucao no fim:
 * quem abrisse a tela durante uma compilacao via a lista de ontem, parada,
 * enquanto a compilacao de agora rodava atras dela. Guardar as abertas aqui e
 * o que permite a tela mostrar a linha viva; ela sai daqui e vira linha
 * gravada quando o arquivo e escrito, sem a tela precisar saber da troca.
 */
const execAbertas = new Set<Execucao>();

/**
 * A falha fatal que cada execucao aberta reportou, se reportou.
 *
 * Um WeakMap e nao um campo no registro: o registro vai para o disco como
 * esta, e esta marca e so o recado entre o funil de erro e o fechamento. Quem
 * escreve e o logFatalError do compilation_flow, por onde TODOS os handlers
 * passam quando desistem, inclusive o Full Build e o cancelamento; quem le e
 * comRegistro, na hora de decidir o que gravar.
 */
const falhaReportadaDe = new WeakMap<Execucao, FalhaReportada>();

/**
 * Marca a(s) execucao(oes) aberta(s) a que uma falha fatal pertence.
 *
 * Com uma so aberta, e ela. Com mais de uma, a do pedido que esta ativo; se
 * nao der para saber, todas, porque marcar a mais custa um "falhou" onde a
 * pessoa ja viu um erro na tela, e marcar a menos e exatamente o bug que isto
 * conserta.
 */
export function reportarFalhaNaExecucao(falha: FalhaReportada, pedidoAtivo: string | null): void {
  const abertas = [...execAbertas];
  if (!abertas.length) return;
  const doPasso = abertas.filter((e) => e.pedido === pedidoAtivo);
  for (const e of (doPasso.length ? doPasso : abertas)) falhaReportadaDe.set(e, falha);
}

/**
 * Avisa quem mostra o registro que ele mudou.
 *
 * Evento no window, e nao uma chamada direta a tela: quem compila nao deve
 * saber que existe uma tela de historico, e no dia em que houver duas coisas
 * interessadas, nada muda aqui.
 */
function avisarRegistro(): void {
  try {
    window.dispatchEvent(new CustomEvent('aurora:run-log-changed'));
  } catch (_) { /* sem window, num teste: o registro segue valendo */ }
}

/** O que esta rodando agora, no formato que a listagem do disco devolve. */
export function execucoesAbertas(agora = Date.now()): ResumoDeExecucao[] {
  return [...execAbertas]
    .flatMap((e) => { const r = resumo(e, agora); return r ? [r] : []; })
    .sort((a, b) => b.inicio - a.inicio);
}

/**
 * O retrato do projeto no momento do clique.
 *
 * Le do .spf, que e a fonte da verdade sobre topo de sintese e de simulacao, e
 * junta as duas preferencias que trocam a ferramenta usada. Falha em silencio:
 * uma execucao sem retrato ainda vale mais do que execucao nenhuma. O .spf que
 * nao se le deixa o retrato sem os arquivos, mas com o simulador e o
 * visualizador, que nao dependem dele.
 */
async function retratoDoProjeto(): Promise<ConfigDoRetrato> {
  const spfPath = ProjectStore.getSpfPath();
  let s = null;
  try { s = spfPath ? await SpfStore.read(spfPath) : null; } catch (_) { s = null; }
  // As preferencias e a lista de processadores nunca lancam: o que pode
  // falhar aqui e so a leitura do .spf, e ela tem o seu catch.
  return {
    topLevelFile: s?.topLevelFile || null,
    testbenchFile: s?.testbenchFile || null,
    synthesizableFiles: (s?.synthesizableFiles || [])
      .map((f) => (typeof f === 'string' ? f : (f as { path?: string })?.path))
      .filter((f): f is string => Boolean(f)),
    simulador: getSimulator(),
    visualizador: getViewer(),
    processadores: getAvailableProcessors()
      .map((x) => (typeof x === 'string' ? x : (x as { name?: string })?.name))
      .filter((x): x is string => Boolean(x)),
  };
}

/** Envolve uma execucao de compilacao para que ela deixe rastro. */
export async function comRegistro<T>(pedido: string, corpo: () => Promise<T>): Promise<T> {
  const projeto = ProjectStore.getProjectPath();
  const exec = abrirExecucao({ pedido, projeto, config: await retratoDoProjeto() });
  execucoesAtivas += 1;
  execAbertas.add(exec);
  avisarRegistro();
  // Cada execucao tem a SUA inscricao, e cancela so a dela. A primeira versao
  // guardava um observador unico e a primeira compilacao de verdade mostrou o
  // custo: o PRISM foi clicado no meio de uma onda, substituiu o observador ao
  // comecar e o zerou ao terminar, e a onda perdeu 36 dos seus 41 segundos.
  //
  // Com duas execucoes no ar, as DUAS recebem tudo, e nao ha como saber daqui
  // qual delas causou cada ferramenta. Em vez de escolher uma e mentir, o
  // passo sai marcado como concorrente, e quem ler sabe que aquele trecho do
  // registro e ambiguo.
  // Avisa a cada ferramenta que roda, e nao so no fim: numa compilacao
  // inteira sao minutos, e uma tela que so acorda no fim nao esta ao vivo.
  const cancelar = addRunObserver((obs: Parameters<typeof anotarPasso>[1]) => {
    anotarPasso(exec, obs, { concorrente: execucoesAtivas > 1 });
    avisarRegistro();
  });
  try {
    const r = await corpo();
    // "Resolveu" nao quer dizer "deu certo": o executor nunca rejeita e o
    // handler engole o erro depois de mostra-lo. O que vale e se alguem
    // passou pelo funil de erro fatal durante esta execucao.
    const falha = falhaReportadaDe.get(exec) || null;
    fecharExecucao(exec, {
      ...desfechoDaExecucao({
        resolveu: true,
        falha: falha && !falha.cancelada ? falha : null,
        cancelada: foiCancelada() || !!(falha && falha.cancelada),
      }),
      // O que o COMPILADOR disse, lido da saida pelo mesmo reconhecedor
      // que pinta os marcadores. O deposito e zerado no inicio de cada
      // rodada, entao aqui ele tem exatamente os desta.
      problemas: problemasParaRegistro(problemStore.listar()),
    });
    return r;
  } catch (erro) {
    fecharExecucao(exec, {
      ...desfechoDaExecucao({ resolveu: false, erro, cancelada: foiCancelada() }),
      problemas: problemasParaRegistro(problemStore.listar()),
    });
    throw erro;
  } finally {
    cancelar();
    execucoesAtivas -= 1;
    try {
      if (projeto) await electronAPI?.runLogGravar?.(projeto, exec);
    } catch (e) {
      console.warn('[run-log] nao consegui gravar a execucao:', e);
    } finally {
      // So sai das abertas DEPOIS de gravar: tirar antes abriria uma
      // janela em que a execucao nao esta nem aqui nem no disco, e a
      // linha sumiria da tela por um instante antes de voltar gravada.
      execAbertas.delete(exec);
      avisarRegistro();
    }
  }
}
