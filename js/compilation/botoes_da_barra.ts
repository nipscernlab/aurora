/**
 * botoes_da_barra.ts: quais botoes de compilacao estao habilitados, e por que.
 *
 * Saiu do compilation_flow, que alem disto despacha os passos, fala com o
 * terminal e cancela. Aqui so se decide o estado dos botoes a partir de duas
 * fontes: o arquivo em foco no editor (o botao C±) e o que o .spf do projeto
 * aberto declara (todos os outros).
 *
 * Quem chama: o compilation_flow, nos eventos de foco, de .spf e de
 * processador; e o project_manager.js e um teste E2E, pelas duas funcoes em
 * window, que saem de la quando esses leitores importarem daqui.
 *
 * Compilado por `tsc` (npm run build:ts) num botoes_da_barra.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { getActiveProcessorName } from '../project/active_processor.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { isProcessorSourcePath, resolveProcessorLanguage } from './processor_source.js';
import { escolherTestbench } from './compilation_helpers.js';
import { languageLabel, setDrawnGlyphLanguage } from '../ui/language_glyph.js';

const tr = (k: string): string => (window.t ? window.t(k) : k);

/**
 * Habilita o botao C± so quando o arquivo em foco no Monaco e fonte de
 * processador (.cmm ou .cpp; processor_source.ts decide).
 * Chamado nos eventos `aurora:editing-file-changed` e depois de cada
 * execucao, cancelamento e abertura de projeto.
 *
 * Tambem exposto em window para que `enableCompileButtons` em
 * project_manager.js possa re-sincronizar depois de fazer o "habilita tudo"
 * geral, sem deixar o C± erroneamente habilitado quando nao ha .cmm em foco.
 */
export function syncCmmcompEnabled(): void {
  const btn = document.getElementById('cmmcomp') as HTMLButtonElement | null;
  if (!btn) return;
  const path = TabManager.getEditingFilePath?.();
  const isCmm = isProcessorSourcePath(path);
  btn.disabled = !isCmm;
  btn.style.cursor = isCmm ? 'pointer' : 'not-allowed';
  sincronizarGlifoDaLinguagem(path);
}

/**
 * O simbolo desenhado segue o fonte em foco: C± com um .cmm, C++ com um .cpp.
 * O botao compila as duas linguagens e o terminal e o mesmo para as duas,
 * entao o que o desenho tem a dizer e qual delas vai rodar se a pessoa
 * clicar agora. Sem fonte em foco o simbolo fica como estava, para o botao
 * nao piscar entre dois desenhos a cada clique numa aba qualquer.
 */
function sincronizarGlifoDaLinguagem(path: string | undefined): void {
  if (!isProcessorSourcePath(path)) return;
  const lang = resolveProcessorLanguage({ name: '', sourceFile: String(path).split(/[\\/]/).pop() });
  setDrawnGlyphLanguage(document, lang);
  const rotulo = document.querySelector('[data-terminal="tcmm"] .tab-label');
  if (rotulo) rotulo.textContent = languageLabel(lang);
}

/**
 * Botao desabilitado com o MOTIVO no tooltip. Antes ele so trocava o cursor,
 * e um botao cinza sem explicacao e a pior das tres formas de falar de uma
 * coisa que falta: o terminal explica quando se clica, a barra de status
 * explica no title, e o botao, que e onde a pessoa esta olhando, ficava mudo.
 * O tooltip original volta quando ele reabre; o atributo `data-i18n-tooltip`
 * e a fonte dele, e e por isso que o valor de reposicao vem de la e nao de um
 * texto guardado.
 */
function habilitar(id: string, on: boolean, why = ''): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = !on;
  btn.style.cursor = on ? 'pointer' : 'not-allowed';
  if (!on && why) {
    btn.setAttribute('data-tooltip', why);
  } else if (on && btn.dataset.i18nTooltip && window.t) {
    const original = window.t(btn.dataset.i18nTooltip);
    if (original && original !== btn.dataset.i18nTooltip) btn.setAttribute('data-tooltip', original);
  }
}

/**
 * Habilita/desabilita os botoes da toolbar conforme o que o .spf tem:
 *
 *   - top-level definido  → Verilog (synth), PRISM
 *   - processador ativo   → Verilator (processador CMM)
 *   - testbench definido  → Wave, Wave Config, Fast Sim, e a lista .gtkw (via
 *                            seu proprio manager)
 *
 * Le a mesma fonte de verdade que a status bar (SpfStore). Re-sincroniza
 * em aurora:spf-changed, open/close de projeto e criar/deletar processador.
 */
export async function syncToolbarEnabledState(): Promise<void> {
  let hasTop = false;
  let hasTb = false;
  let isPyTb = false;
  const spfPath = ProjectStore.getSpfPath();
  if (spfPath) {
    try {
      const s = await SpfStore.read(spfPath);
      hasTop = !!s.topLevelFile;
      // A MESMA regra do alvo (compilation_helpers.escolherTestbench):
      // olhar so o campo escalar deixava o botao apagado para sempre num
      // projeto que guardasse o testbench apenas na lista, enquanto a
      // compilacao encontrava o arquivo sem dificuldade.
      const tb = escolherTestbench(s);
      hasTb = !!tb;
      // .py = testbench cocotb (Python). O Fast Sim e Verilator-binary e
      // compila o tb como Verilog, entao .py nao se aplica (vai pelo Wave).
      isPyTb = /\.py$/i.test(tb || '');
    } catch (_e) { /* leitura falhou → tudo desabilitado */ }
  }

  // O botao Verilator (processador) age sobre o PROCESSADOR ATIVO mostrado
  // na status bar (o .cmm em foco). Sem processador ativo → desabilitado.
  // Mesma fonte do alvo em _resolveProcessorTarget, entao gate e alvo nunca
  // divergem.
  const hasActiveProc = !!getActiveProcessorName();

  const semTopo = tr('statusBar.noTopLevel') + '. ' + tr('statusBar.howTopLevel');
  const semTb = tr('statusBar.noTestbench') + '. ' + tr('statusBar.howTestbench');
  habilitar('vericomp', hasTop, semTopo);
  habilitar('prismcomp', hasTop, semTopo);
  habilitar('verilatorproc', hasActiveProc);
  habilitar('wavecomp', hasTb, semTb);
  // Fast Sim (headless, sem onda) tem dois caminhos:
  //  - testbench .v  -> Verilator binario, exige o toggle em Verilator
  //    (iverilog nao tem caminho binario headless);
  //  - testbench .py -> cocotb headless, roda em qualquer engine.
  // Re-sincronizado no evento aurora:wave-simulator-changed.
  habilitar('fastsim', hasTb && (isPyTb || getSimulator() === 'verilator'));
  // Cancelar NAO segue a regra do Wave (era `hasTb`, espelhando o botao de
  // Wave por ser o par visual dele na toolbar). Cancelar esta ACIMA de todo o
  // fluxo SAPHO, nao so da simulacao: C±, ASM, Verilog e PRISM compilam sem
  // testbench nenhum, e com o botao desabilitado nao havia como matar um
  // cmmcomp/yosys travado. Fica sempre habilitado, clicar com nada rodando
  // ja responde "nada a cancelar".
  habilitar('cancel-everything', true);
  habilitar('waveConfigBtn', hasTb, semTb);
  // A lista .gtkw gerencia seu proprio disabled (gtkw_picker.refresh le
  // o testbench); so pedimos pra re-sincronizar.
  window.gtkwPickerManager?.refresh?.();
}

if (typeof window !== 'undefined') {
  window.syncCmmcompEnabled = syncCmmcompEnabled;
  window.syncToolbarEnabledState = syncToolbarEnabledState;
}
