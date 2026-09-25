/**
 * interface_do_projeto.ts: o que a janela mostra sobre o projeto aberto, o
 * nome na arvore, o indicador da barra de status, os botoes que so fazem
 * sentido com projeto, e o dialogo de informacoes.
 *
 * Saiu do js/project/project_manager.js (item 13.3 do TODO). Os botoes de
 * compilacao que dependem do .spf sao re-sincronizados pelo botoes_da_barra.ts
 * importado, e nao mais por window.
 *
 * Compilado por `tsc` (npm run build:ts) num interface_do_projeto.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { ProjectStore } from './project_store.js';
import { syncCmmcompEnabled, syncToolbarEnabledState } from '../compilation/botoes_da_barra.js';

const tr = (k: string, padrao: string): string => (window.t ? window.t(k) : padrao);

/** O que o .spf diz de si, como o main devolve em getProjectInfo/openProject. */
export interface DadosDoProjeto {
  metadata?: {
    projectName?: string;
    createdAt?: string | number;
    lastModified?: string | number;
    computerName?: string;
    appVersion?: string;
  };
  [k: string]: unknown;
}

/**
 * O nome do projeto no topo da arvore: o que o .spf declara, senao o nome do
 * arquivo, e sem projeto a etiqueta traduzida de volta.
 */
export function mostrarNomeDoProjeto(projectData: DadosDoProjeto | null | undefined, spfPath: string | null | undefined): void {
  const spfNameElement = document.getElementById('current-spf-name');
  if (!spfNameElement) return;

  const setProjectName = (name: string) => {
    // Nome real de projeto nao tem traducao, remove qualquer
    // data-i18n pra que applyDOM no proximo locale change nao
    // reescreva por cima.
    spfNameElement.removeAttribute('data-i18n');
    spfNameElement.textContent = name;
  };

  const metaName = projectData?.metadata?.projectName;
  if (metaName) {
    setProjectName(`${metaName}.spf`);
    return;
  }

  // Fallback: derive the name from the .spf path so the label never gets
  // stuck on "No project open" after a successful load with sparse metadata.
  if (typeof spfPath === 'string' && spfPath.trim()) {
    const base = spfPath.split(/[\\/]/).pop() || spfPath;
    setProjectName(base.endsWith('.spf') ? base : `${base}.spf`);
    return;
  }

  // Sem projeto: volta pra label traduzida e re-instala data-i18n.
  spfNameElement.setAttribute('data-i18n', 'fileTree.noProject');
  spfNameElement.textContent = tr('fileTree.noProject', 'No project open');
}

/**
 * Com projeto aberto: liga os botoes que nao dependem do .spf, re-sincroniza
 * os que dependem, e o indicador da barra de status passa a mostrar o nome do
 * projeto, em verde.
 */
export function habilitarBotoesDoProjeto(): void {
  // cmmcomp NAO entra aqui: tem regra propria (so habilitado com fonte em
  // foco no Monaco), gerenciada por syncCmmcompEnabled. Os que dependem do
  // .spf (vericomp/wavecomp/prismcomp/verilatorproc, a Wave Config e o
  // cancelar) seguem o estado do design via syncToolbarEnabledState.
  const buttons = ['allcomp', 'fractalcomp', 'backupFolderBtn', 'projectInfo'];
  for (const id of buttons) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) {
      button.disabled = false;
      button.style.cursor = 'pointer';
    }
  }

  syncCmmcompEnabled();
  void syncToolbarEnabledState();

  const statusElement = document.getElementById('ready');
  const statusText = document.getElementById('status-text');
  const icon = statusElement ? statusElement.querySelector('i') : null;
  if (!statusElement) return;

  statusElement.style.cursor = 'default';
  // A classe tem de ser `is-ready`: e ela que o CSS `#ready.is-ready` usa
  // para passar o rotulo de vermelho a verde.
  statusElement.classList.add('is-ready');
  statusElement.classList.remove('fading');
  if (icon) icon.className = 'ph ph-plugs-connected';

  // O rotulo passa a ser o NOME DO PROJETO, nao "Ready". "Ready" queria
  // dizer "ha projeto aberto", mas ao lado do progresso da compilacao
  // lia-se "Pronto" e "Compilando" na mesma barra. O nome diz o que o item
  // sempre quis dizer, e diz qual projeto. O data-i18n sai porque nome de
  // projeto nao se traduz; close_project o devolve ao fechar.
  if (statusText) {
    const spf = ProjectStore.getSpfPath() || '';
    const nome = String(spf).split(/[\\/]/).pop()!.replace(/\.spf$/i, '');
    statusText.removeAttribute('data-i18n');
    statusText.textContent = nome || tr('statusBar.notReady', 'No project');
    // O caminho inteiro fica no balao, para quem tem dois projetos de mesmo
    // nome em pastas diferentes.
    if (spf) statusElement.setAttribute('data-tooltip', spf);
    else statusElement.removeAttribute('data-tooltip');
  }
}

/**
 * Sem projeto, clicar no indicador da barra de status abre o seletor de
 * projeto, pelo mesmo botao da interface.
 */
export function ligarIndicadorDeProjeto(): void {
  const statusIndicator = document.getElementById('ready');
  const openProjectButton = document.getElementById('openProjectBtn');
  if (!statusIndicator || !openProjectButton) return;

  statusIndicator.style.cursor = 'pointer';
  statusIndicator.addEventListener('click', () => {
    if (!statusIndicator.classList.contains('is-ready')) openProjectButton.click();
  });
}

const escapar = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * O dialogo com o que o .spf diz de si. Os valores vem do arquivo e sao
 * escapados: um nome de projeto com `<` era HTML cru dentro do dialogo.
 */
export function mostrarInformacaoDoProjeto(projectData: DadosDoProjeto): void {
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'aurora-modal-backdrop';
  const modalContainer = document.createElement('div');
  modalContainer.className = 'aurora-modal-container';
  const metadata = projectData.metadata || {};

  const formatDate = (ts: string | number | undefined) => new Date(ts ?? '').toLocaleString();

  modalContainer.innerHTML = `
    <div class="aurora-modal">
      <div class="aurora-modal-header">
        <h2 class="aurora-modal-title">Project Information</h2>
        <button class="aurora-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="aurora-modal-body">
        <p><strong>Project Name:</strong> ${escapar(metadata.projectName)}</p>
        <p><strong>Created:</strong> ${escapar(formatDate(metadata.createdAt))}</p>
        <p><strong>Last Modified:</strong> ${escapar(formatDate(metadata.lastModified))}</p>
        <p><strong>Computer:</strong> ${escapar(metadata.computerName)}</p>
        <p><strong>App Version:</strong> ${escapar(metadata.appVersion)}</p>
      </div>
    </div>`;

  document.body.appendChild(modalBackdrop);
  document.body.appendChild(modalContainer);

  const closeModal = () => {
    document.body.removeChild(modalBackdrop);
    document.body.removeChild(modalContainer);
  };
  modalBackdrop.addEventListener('click', closeModal);
  modalContainer.querySelector('.aurora-modal-close')!.addEventListener('click', closeModal);
}
