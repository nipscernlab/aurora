// project_manager.js

import { TabManager } from '../tabs/tab_manager.js';
import { fileTreeManager } from '../tree/file_tree_manager.js';
import { showDialog } from '../ui/dialog_manager.js';
import { ProjectStore } from './project_store.js';

function updateProjectNameUI(projectData, spfPath) {
    const spfNameElement = document.getElementById('current-spf-name');
    if (!spfNameElement) return;

    const metaName = projectData?.metadata?.projectName;
    if (metaName) {
        spfNameElement.textContent = `${metaName}.spf`;
        return;
    }

    // Fallback: derive the name from the .spf path so the label never gets
    // stuck on "No project open" after a successful load with sparse metadata.
    if (typeof spfPath === 'string' && spfPath.trim()) {
        const base = spfPath.split(/[\\/]/).pop() || spfPath;
        spfNameElement.textContent = base.endsWith('.spf') ? base : `${base}.spf`;
        return;
    }

    spfNameElement.textContent = 'No project open';
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
    const buttons = ['cmmcomp', 'asmcomp', 'vericomp', 'wavecomp', 'prismcomp', 'allcomp', 'cancel-everything', 'fractalcomp', 'settings', 'importBtn', 'backupFolderBtn', 'projectInfo', 'settings-project'];
    
    buttons.forEach(id => {
        
        const button = document.getElementById(id);
        if (button) {
            button.disabled = false;
            button.style.cursor = 'pointer';
        } 
    });

    const statusElement = document.getElementById('ready');
    const statusText = document.getElementById('status-text');
    const icon = statusElement ? statusElement.querySelector('i') : null;

    if (statusElement) {
        // 1. Configura o cursor
        statusElement.style.cursor = 'default';

        // 2. Adiciona a classe visual de pronto. Class name has to be
        // `is-ready` (with the `is-` prefix) — that's what the CSS rule
        // `#ready.is-ready .status-dot` expects to flip the dot from
        // red to green. A previous version added plain `ready` here,
        // which silently failed the selector match.
        statusElement.classList.add('is-ready');
        statusElement.classList.remove('fading'); // Remove caso tenha sobrado de alguma tentativa anterior

        // 3. Troca o ícone imediatamente
        if (icon) {
            // Reseta as classes para garantir e aplica o novo ícone
            icon.className = 'fa-solid fa-plug-circle-check';
        }

        // 4. Troca o texto imediatamente
        if (statusText) {
            statusText.textContent = 'Ready';
        }
    }
}

/**
 * Load project with full orchestration
 */
async function loadProject(spfPath) {
    try {
        const result = await window.electronAPI.openProject(spfPath);

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
            throw new Error('Project base path could not be determined.');
        }

        // Single source of truth — also mirrors window.currentProjectPath /
        // window.currentSpfPath for the dozens of existing read sites.
        ProjectStore.setProject(spfPath, basePath);

        // Seed the global processor list from the IPC payload BEFORE the file
        // tree renders. Without this, processor folders render as plain
        // directories and only pick up their per-processor color/trash icon
        // after a manual refresh (e.g. opening Settings). Tolerant to either
        // shape: array of { name } objects or array of strings.
        const procFromSpf = projectData?.structure?.processors;
        if (Array.isArray(procFromSpf)) {
            window.availableProcessors = procFromSpf
                .map(p => (typeof p === 'string' ? p : p?.name))
                .filter(Boolean);
        } else {
            window.availableProcessors = [];
        }

        updateProjectNameUI(projectData, spfPath);
        await TabManager.closeAllTabs();

        // FASE 2.5: modo unico (Project Mode). A tree e sempre sourced
        // de projectOriented.json via verilogTreeManager — o branch de
        // Processor Mode (que populava direto do listing) foi removido.
        if (window.verilogTreeManager) {
            await window.verilogTreeManager.activateVerilogMode();
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

    } catch (error) {
        console.error('Error loading project:', error);
        try {
            await showDialog({
                title: 'Error Loading Project',
                message: `Failed to load project: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
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
            const result = await window.electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        // Listener para o botão da tela de boas-vindas
        document.getElementById('openProjectBtnWelcome')?.addEventListener('click', async () => {
            const result = await window.electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        document.getElementById('projectInfo')?.addEventListener('click', async () => {
            if (!window.currentSpfPath) return;
            try {
                const projectData = await window.electronAPI.getProjectInfo(window.currentSpfPath);
                showProjectInfoDialog(projectData);
            } catch (error) {
                console.error('Error getting project info:', error);
            }
        });

        document.getElementById('open-folder-button')?.addEventListener('click', () => {
            if (window.currentProjectPath) window.electronAPI.openFolder(window.currentProjectPath);
        });

        document.getElementById('open-hdl-button')?.addEventListener('click', async () => {
            const hdlDir = await window.electronAPI.joinPath('components', 'HDL');
            window.electronAPI.openFolder(hdlDir);
        });

        // Listener para quando o projeto é aberto via "File > Open" ou atalhos
        window.electronAPI.onSimulateOpenProject(async (result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
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