// project_manager.js

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { fileTreeManager } from '../tree/file_tree_manager.js';
import { showDialog } from '../ui/dialog_manager.js';
import { ProjectStore } from './project_store.js';
import { setAvailableProcessors } from './processor_list.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

function updateProjectNameUI(projectData, spfPath) {
    const spfNameElement = document.getElementById('current-spf-name');
    if (!spfNameElement) return;

    const setProjectName = (name) => {
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
    spfNameElement.textContent = window.t ? window.t('fileTree.noProject') : 'No project open';
}

/**
 * Cria (sobrescrevendo) um arquivo `.aurora-missing-files.log` na raiz do
 * projeto com cabecalho explicativo + lista paginada dos arquivos que o
 * .spf referencia mas nao existem no disco. Depois abre no Monaco como
 * preview tab (TabManager.addTab) pra que o usuario veja imediatamente
 * o que sumiu.
 *
 * No-op silencioso se `missing` for vazio/invalido, o caller ja gate-ia
 * a chamada, mas e idempotente por seguranca. Se a escrita ou a abertura
 * falham, propaga pra que o caller registre no console; nao quebra o
 * resto do loadProject.
 */
async function openMissingFilesLogInEditor(missing, spfPath, basePath) {
    if (!Array.isArray(missing) || missing.length === 0) return;
    if (!basePath) return;

    const ts = new Date().toLocaleString();
    const projectName = (spfPath || '').split(/[\\/]/).pop() || '(unknown)';

    const lines = [
        '# Aurora — relatorio de arquivos faltantes',
        '',
        `Gerado em: ${ts}`,
        `Projeto:   ${projectName}`,
        `Base path: ${basePath}`,
        '',
        '--------------------------------------------------------------------------------',
        'Estes paths estao listados no .spf do projeto, mas NAO existem no disco',
        '(foram movidos, renomeados fora do Aurora, ou deletados manualmente).',
        '',
        'O que fazer:',
        '  1. Restaure / recoloque o arquivo no caminho original abaixo, OU',
        '  2. Remova-o do projeto clicando direito na file tree -> Remove from tree.',
        '',
        'Este arquivo e regenerado a cada abertura do projeto — se nao houver',
        'arquivos faltantes na proxima vez, ele nao sera criado nem aberto.',
        '--------------------------------------------------------------------------------',
        '',
    ];

    const grouped = new Map();
    for (const f of missing) {
        const cat = f.category || 'unknown';
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat).push(f);
    }
    for (const [cat, list] of grouped.entries()) {
        lines.push(`[${cat}] (${list.length})`);
        for (const f of list) {
            lines.push(`  - ${f.name}`);
            lines.push(`      ${f.path}`);
        }
        lines.push('');
    }

    const logFileName = '.aurora-missing-files.log';
    const logPath = await electronAPI.joinPath(basePath, logFileName);
    const content = lines.join('\n');
    await electronAPI.writeFile(logPath, content);

    // Open as a preview tab (italic). Without preview:false the file
    // gets pinned; we want it dismissable with one click on another file.
    TabManager.addTab(logPath, content, { preview: true });
}

/**
 * Remove o .aurora-missing-files.log da raiz do projeto se existir.
 * Chamado em loadProject quando nao ha mais arquivos faltantes pra
 * que o log de uma corrida anterior nao fique stale no projeto.
 * Silencioso em ausencia (fileExists check) e em erros de IO
 * (caller registra).
 */
async function removeMissingFilesLog(basePath) {
    if (!basePath) return;
    const logFileName = '.aurora-missing-files.log';
    const logPath = await electronAPI.joinPath(basePath, logFileName);
    const exists = await electronAPI.fileExists?.(logPath);
    if (!exists) return;
    // Fecha a tab no Monaco se o usuario tinha o log aberto, antes
    // de apagar do disco, assim o save no exit nao recria o arquivo.
    if (window.TabManager?.tabs?.has?.(logPath)) {
        try { await window.TabManager.closeTab?.(logPath); } catch (_) { /* best effort */ }
    }
    if (typeof electronAPI.deleteFile === 'function') {
        await electronAPI.deleteFile(logPath);
    }
}

function showProjectInfoDialog(projectData) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'aurora-modal-backdrop';
    const modalContainer = document.createElement('div');
    modalContainer.className = 'aurora-modal-container';
    const metadata = projectData.metadata;

    const formatDate = (ts) => new Date(ts).toLocaleString();
    
    modalContainer.innerHTML = `
    <div class="aurora-modal">
      <div class="aurora-modal-header">
        <h2 class="aurora-modal-title">Project Information</h2>
        <button class="aurora-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="aurora-modal-body">
        <p><strong>Project Name:</strong> ${metadata.projectName}</p>
        <p><strong>Created:</strong> ${formatDate(metadata.createdAt)}</p>
        <p><strong>Last Modified:</strong> ${formatDate(metadata.lastModified)}</p>
        <p><strong>Computer:</strong> ${metadata.computerName}</p>
        <p><strong>App Version:</strong> ${metadata.appVersion}</p>
      </div>
    </div>`;

    document.body.appendChild(modalBackdrop);
    document.body.appendChild(modalContainer);

    const closeModal = () => {
        document.body.removeChild(modalBackdrop);
        document.body.removeChild(modalContainer);
    };
    modalBackdrop.addEventListener('click', closeModal);
    modalContainer.querySelector('.aurora-modal-close').addEventListener('click', closeModal);
}

// CORREÇÃO AQUI: Atualização direta da UI sem depender de animações CSS
function enableCompileButtons() {
    // cmmcomp NAO entra aqui: tem regra propria (so habilitado com .cmm
    // em foco no Monaco), gerenciada por syncCmmcompEnabled em
    // compilation_flow.js. Forcar disabled=false aqui o deixaria
    // erroneamente clicavel ate o proximo aurora:editing-file-changed.
    // Botoes nao-gated: sempre habilitados com projeto aberto. Os
    // gated (vericomp/wavecomp/prismcomp/verilatorproc, a Wave Config e o
    // cancelar-simulacao) seguem o estado do design via
    // syncToolbarEnabledState, por isso cancel-everything NAO entra aqui:
    // ele acompanha o botao Wave (so habilita com testbench definido).
    const buttons = ['allcomp', 'fractalcomp', 'backupFolderBtn', 'projectInfo'];

    buttons.forEach(id => {

        const button = document.getElementById(id);
        if (button) {
            button.disabled = false;
            button.style.cursor = 'pointer';
        }
    });

    window.syncCmmcompEnabled?.();
    window.syncToolbarEnabledState?.();

    const statusElement = document.getElementById('ready');
    const statusText = document.getElementById('status-text');
    const icon = statusElement ? statusElement.querySelector('i') : null;

    if (statusElement) {
        // 1. Configura o cursor
        statusElement.style.cursor = 'default';

        // 2. Adiciona a classe visual de pronto. Class name has to be
        // `is-ready` (with the `is-` prefix), that's what the CSS rule
        // `#ready.is-ready` expects to flip the LABEL from red to green.
        // (Havia um ponto colorido ali; ele saiu, e o rotulo assumiu o
        // estado.) A previous version added plain `ready` here, which
        // silently failed the selector match.
        statusElement.classList.add('is-ready');
        statusElement.classList.remove('fading'); // Remove caso tenha sobrado de alguma tentativa anterior

        // 3. Troca o ícone imediatamente
        if (icon) {
            // Reseta as classes para garantir e aplica o novo ícone
            icon.className = 'ph ph-plugs-connected';
        }

        // 4. Troca o texto imediatamente. Reapontamos data-i18n também
        // pra que o scanner do i18n re-traduza no proximo locale flip.
        if (statusText) {
            statusText.setAttribute('data-i18n', 'statusBar.ready');
            statusText.textContent = window.t ? window.t('statusBar.ready') : 'Ready';
        }
    }
}

/**
 * Load project with full orchestration
 */
async function loadProject(spfPath) {
    try {
        const result = await electronAPI.openProject(spfPath);

        if (!result || result.success === false) {
            const msg = (result && result.message) || 'Could not open project.';
            throw new Error(msg);
        }

        // Tolerância: result.projectData pode vir com forma variável dependendo
        // da versão do main.js. Tenta múltiplos caminhos antes de falhar.
        const projectData = result.projectData || result.data || {};
        const basePath =
            projectData.structure?.basePath ||
            projectData.basePath ||
            projectData.metadata?.projectPath ||
            (typeof spfPath === 'string' ? spfPath.replace(/[\\/][^\\/]+\.spf$/i, '') : null);

        if (!basePath) {
            throw new Error(window.t ? window.t('error.config.noProjectBase') : 'Project base path could not be determined.');
        }

        // Single source of truth, also mirrors window.currentProjectPath /
        // window.currentSpfPath for the dozens of existing read sites.
        ProjectStore.setProject(spfPath, basePath);

        // Clean slate BEFORE the new tree loads. A direct project→project
        // switch (e.g. clicking another project in the recents list / welcome
        // screen) doesn't pass through close_project, so the previous project's
        // in-memory file list and its rendered rows would otherwise still be
        // present while the new .spf loads, surfacing the old project's
        // imported files in the new one. reset() wipes both.
        window.projectTreeManager?.reset?.();

        // Seed the global processor list from the IPC payload BEFORE the file
        // tree renders. Without this, processor folders render as plain
        // directories and only pick up their per-processor color/trash icon
        // after a manual refresh (e.g. opening Settings). Tolerant to either
        // shape: array of { name } objects or array of strings.
        // Seed da lista de processadores a partir do .spf. setAvailableProcessors
        // ja faz dedup case-insensitive e normaliza entries string-only
        // ({name} vs "name"), ver processor_list.js.
        setAvailableProcessors(projectData?.structure?.processors);

        updateProjectNameUI(projectData, spfPath);
        await TabManager.closeAllTabs();

        // Tree e sempre populada do .spf via
        // projectTreeManager. A coalescencia interna em
        // activateTree garante que isso + a chamada de
        // fileTreeManager.initializeTreeBasedOnMode nao gerem duplo
        // loadConfiguration (ver ARCHITECTURE.md §6).
        if (window.projectTreeManager) {
            await window.projectTreeManager.activateTree();
        }
        fileTreeManager.watcher?.startWatching?.(window.currentProjectPath);

        if (window.recentProjectsManager) {
            window.recentProjectsManager.addProject(spfPath);
        }

        // Enable buttons and update status
        if (typeof enableCompileButtons === 'function') {
            enableCompileButtons();
        }

        // Save as last opened project
        if (window.appInitializer) {
            window.appInitializer.saveCurrentProject(spfPath);
        }

        // Tell the split/welcome layout that a project is now active so the
        // welcome overlay disappears even when no file has been auto-opened.
        window.SplitEditorManager?.refreshLayout?.();

        // Repopulate the toolbar's .gtkw picker against the just-loaded
        // project's gtkwFiles[]. No-op if the picker hasn't initialized
        // yet (e.g. PRISM window without that toolbar element).
        window.gtkwPickerManager?.refresh?.();

        // Force-refresh internal state subscribers (status bar, processor
        // config panel, etc) ate o final do load. ProjectStore.subscribe ja
        // dispara em setProject, mas componentes que so escutam
        // aurora:spf-changed (mudanca de structure, nao de spfPath) ficam
        // stale ate alguma escrita acontecer. Sintetizar o evento aqui
        // garante que variaveis derivadas do .spf (testbenchFile,
        // topLevelFile, processors, etc) sejam reaplicadas a cada abertura
        //, fix pro caso "abri o projeto e a status bar / picker / panel
        // mostraram o estado do projeto anterior".
        window.dispatchEvent(new CustomEvent('aurora:spf-changed', {
            detail: { spfPath, source: 'project-loaded' },
        }));

        // Re-aplica o highlight do arquivo focado AGORA: closeAllTabs acima
        // limpou todas as tabs, entao TabManager.getEditingFilePath retorna
        // null e a row destacada do projeto anterior precisa limpar.
        window.projectTreeManager?.refreshEditorFocusHighlight?.();

        // Surface arquivos faltantes via notification + log file no Monaco.
        // O card no topo da tree e o canal principal, a notification
        // confirma pro usuario que algo aconteceu, e o log file aberto no
        // Monaco da pro usuario a lista completa pronta pra copiar/buscar.
        const missing = window.projectTreeManager?.missingFiles;
        if (Array.isArray(missing) && missing.length > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(
                    tr('fileTree.missingFiles.notification', { count: missing.length }),
                    'warning',
                    5000,
                );
            }
            try {
                await openMissingFilesLogInEditor(missing, spfPath, basePath);
            } catch (logErr) {
                console.warn('Failed to open missing-files log:', logErr);
            }
        } else {
            // Cleanup: remove o .aurora-missing-files.log de runs
            // anteriores se nao tem mais nada faltando. Sem isso, o
            // usuario corrige tudo e o log fica grudado no projeto.
            try {
                await removeMissingFilesLog(basePath);
            } catch (cleanupErr) {
                console.warn('Failed to remove stale missing-files log:', cleanupErr);
            }
        }

    } catch (error) {
        console.error('Error loading project:', error);
        try {
            await showDialog({
                title: tr('dialog.project.loadErrorTitle'),
                message: tr('dialog.project.loadErrorMessage', { error: error.message }),
                buttons: [{ label: tr('dialog.common.ok'), action: 'close', type: 'cancel' }]
            });
        } catch (dialogErr) {
            console.error('showDialog failed:', dialogErr);
        }
    }
}

class ProjectManager {
    initialize() {
        // Listener para o botão "Open Project" da UI principal
        document.getElementById('openProjectBtn')?.addEventListener('click', async () => {
            const result = await electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        // Listener para o botão da tela de boas-vindas
        document.getElementById('openProjectBtnWelcome')?.addEventListener('click', async () => {
            const result = await electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        document.getElementById('projectInfo')?.addEventListener('click', async () => {
            if (!window.currentSpfPath) return;
            try {
                const projectData = await electronAPI.getProjectInfo(window.currentSpfPath);
                showProjectInfoDialog(projectData);
            } catch (error) {
                console.error('Error getting project info:', error);
            }
        });

        document.getElementById('open-folder-button')?.addEventListener('click', () => {
            if (window.currentProjectPath) electronAPI.openFolder(window.currentProjectPath);
        });

        // Listener para quando o projeto é aberto via "File > Open" ou atalhos
        electronAPI.onSimulateOpenProject(async (result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        // Duplo clique num .cmm ou .v associado no Windows. Abre o arquivo
        // solto no editor, sem projeto: um fonte avulso nao tem .spf para
        // carregar junto, e obrigar um projeto so para ler um arquivo seria
        // pior que abrir vazio.
        electronAPI.onOpenLooseFile?.(async ({ filePath }) => {
            if (!filePath) return;
            try {
                const content = await electronAPI.readFile(filePath);
                window.TabManager?.addTab?.(filePath, content ?? '');
            } catch (e) {
                console.warn('open-loose-file falhou:', e?.message || e);
            }
        });

        // Right-click numa cell do Prism abre o .v aqui no editor principal
        // na linha exata. Reusa o pipeline existente (readFile + TabManager
        // ou SplitEditorManager) pra parity com clique no file tree, depois
        // posiciona o cursor monaco via EditorManager.
        electronAPI.onOpenFileAt(async ({ filePath, line, column }) => {
            try {
                const ln  = Number.isInteger(line)   && line   > 0 ? line   : 1;
                const col = Number.isInteger(column) && column > 0 ? column : 1;
                const reveal = (editor) => {
                    if (editor && typeof editor.revealLineInCenter === 'function') {
                        // Defer to the next frame and lay the editor out first:
                        // when the pane/tab just became visible, revealLineInCenter
                        // computes scroll against a stale (zero-height) layout and
                        // the viewport never moves. layout() + rAF fixes the scroll.
                        requestAnimationFrame(() => {
                            editor.layout();
                            editor.setPosition({ lineNumber: ln, column: col });
                            editor.revealLineInCenter(ln);
                            editor.focus();
                        });
                    }
                };

                // Already open in the main pane → the editor exists, so jump now.
                if (window.TabManager?.tabs?.has(filePath)) {
                    window.TabManager.activateTab(filePath);
                    reveal(window.EditorManager?.getEditorForFile?.(filePath));
                    return;
                }

                const content = await electronAPI.readFile(filePath);
                const sem = window.SplitEditorManager;
                if (sem && sem.focusedPane > 0) {
                    await sem.openInFocusedPane(filePath, content);
                    // Split panes create their Monaco editor synchronously in
                    // openFile, so it's available right after the await.
                    const pane = sem.panes.find(p => p.paneIndex === sem.focusedPane);
                    reveal(pane?.tabs?.get(filePath)?.editor);
                } else {
                    // Main pane: the editor is created on a deferred (Monaco-
                    // ready-gated) path, so getEditorForFile() would be null
                    // right here. Hand the target line to addTab, which
                    // positions the editor the moment it's created, no race.
                    window.TabManager.addTab(filePath, content, {
                        preview: false,
                        revealPosition: { line: ln, column: col },
                    });
                }
            } catch (e) {
                console.error('Failed to open file at line from Prism:', e);
            }
        });

        // A simulacao do PRISM gravou um .vcd com os sinais do monitor e pede
        // para abri-lo no visualizador de ondas da casa: GTKWave ou Surfer,
        // aba ou janela, conforme a preferencia, o mesmo caminho do botao Wave.
        electronAPI.onOpenWave?.(async ({ vcdPath, modulo }) => {
            try {
                await window.compilationModule?.abrirOndaExterna(vcdPath, modulo);
            } catch (e) {
                console.error('Failed to open the PRISM simulation wave:', e);
            }
        });
    }

    // Método público para ser chamado pelo renderer.js (New Project)
    loadProject(spfPath) {
        return loadProject(spfPath);
    }
}

function setupStatusIndicator() {
  const statusIndicator = document.getElementById('ready');
  const openProjectButton = document.getElementById('openProjectBtn');

  if (!statusIndicator || !openProjectButton) {
    return;
  }

  // Define o estado inicial como 'pointer'
  statusIndicator.style.cursor = 'pointer';

  statusIndicator.addEventListener('click', () => {
    // Só abre o diálogo se NÃO estiver ready (ou seja, se estiver Not Ready)
    const isReady = statusIndicator.classList.contains('is-ready');
    
    if (!isReady) {
      // Isso simula o clique no botão de abrir, que por sua vez chama o showOpenDialog (dialogo nativo do Windows)
      // É o comportamento esperado para "Carregar um projeto" se nenhum estiver carregado.
      openProjectButton.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', setupStatusIndicator);

const projectManager = new ProjectManager();
export { projectManager };
