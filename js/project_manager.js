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
        
        // 2. Adiciona a classe visual de pronto
        statusElement.classList.add('ready');
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

async function loadProject(spfPath) {
    try {
        const result = await window.electronAPI.openProject(spfPath);
        window.currentProjectPath = result.projectData.structure.basePath;
        window.currentSpfPath = spfPath;
        
        updateProjectNameUI(result.projectData);
        await TabManager.closeAllTabs();
        
        // Atualiza a árvore de arquivos
        fileTreeManager.updateFileTree(result.files);
        fileTreeManager.watcher.startWatching(window.currentProjectPath);

        if (window.recentProjectsManager) {
            window.recentProjectsManager.addProject(spfPath);
        }

        // Habilita os botões E atualiza o status para Ready
        enableCompileButtons();

    } catch (error) {
        console.error('Error loading project:', error);
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
    const isReady = statusIndicator.classList.contains('ready');
    
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