// project_manager.js

import { TabManager } from './tab_manager.js';
import { fileTreeManager } from './file_tree_manager.js';

function updateProjectNameUI(projectData) {
    const spfNameElement = document.getElementById('current-spf-name');
    if (projectData && projectData.metadata && projectData.metadata.projectName) {
        spfNameElement.textContent = `${projectData.metadata.projectName}.spf`;
    } else {
        spfNameElement.textContent = 'No project open';
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
    if (statusElement) {
        statusElement.style.cursor = 'default';
        // Adiciona a classe 'fading' para iniciar a transição de desaparecimento
        statusElement.classList.add('fading');

        // Função que será executada ao final da transição
        const onFadeOut = () => {
            // Remove o listener para não ser acionado novamente na transição de volta
            statusElement.removeEventListener('transitionend', onFadeOut);

            const icon = statusElement.querySelector('i');
            const statusText = document.getElementById('status-text');

            // Altera o ícone
            if (icon) {
                icon.classList.remove('fa-plug-circle-xmark');
                icon.classList.add('fa-plug-circle-check');
            }

            // Altera o texto
            if (statusText) {
                statusText.textContent = 'Ready';
            }
            
            // Adiciona a classe 'ready' para alterar a cor e remove a 'fading' para reaparecer
            statusElement.classList.add('ready');
            statusElement.classList.remove('fading');
        };

        // Adiciona um listener para o evento de fim da transição
        statusElement.addEventListener('transitionend', onFadeOut);
    }
}

async function loadProject(spfPath) {
    try {
        const result = await window.electronAPI.openProject(spfPath);
        window.currentProjectPath = result.projectData.structure.basePath;
        window.currentSpfPath = spfPath;
        
        updateProjectNameUI(result.projectData);
        await TabManager.closeAllTabs();
        enableCompileButtons();
        fileTreeManager.updateFileTree(result.files);
        fileTreeManager.watcher.startWatching(window.currentProjectPath);

        if (window.recentProjectsManager) {
            window.recentProjectsManager.addProject(spfPath);
        }
    } catch (error) {
        console.error('Error loading project:', error);
    }
}

class ProjectManager {
    initialize() {
        document.getElementById('openProjectBtn')?.addEventListener('click', async () => {
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

        window.electronAPI.onSimulateOpenProject(async (result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });
    }

    loadProject(spfPath) {
        return loadProject(spfPath);
    }
}

function setupStatusIndicator() {
  const statusIndicator = document.getElementById('ready');
  const openProjectButton = document.getElementById('openProjectBtn');

  // Garante que ambos os elementos existam antes de adicionar o evento
  if (!statusIndicator || !openProjectButton) {
    console.warn('Status indicator or open project button not found. Click functionality will not be enabled.');
    return;
  }

  // Define o estado inicial do cursor como 'pointer', pois a aplicação começa not ready
  statusIndicator.style.cursor = 'pointer';

  statusIndicator.addEventListener('click', () => {
    // A ação de clique só funciona se o status NÃO for 'ready'
    const isReady = statusIndicator.classList.contains('ready');
    
    if (!isReady) {
      openProjectButton.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', setupStatusIndicator);

const projectManager = new ProjectManager();
export { projectManager };