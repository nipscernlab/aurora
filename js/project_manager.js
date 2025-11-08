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
            const hdlDir = await window.electronAPI.joinPath('saphoComponents', 'HDL');
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

const projectManager = new ProjectManager();
export { projectManager };