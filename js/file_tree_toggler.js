// File Tree Controller (Collapse, Refresh, and Backup Functionality)
class FileTreeController {
  constructor() {
    this.init();
  }

  init() {
    // Get the UI elements
    this.collapseButton = document.getElementById('toggle-file-tree');
    this.refreshButton = document.getElementById('refresh-file-tree');
    this.backupButton = document.getElementById('backup-project'); // NOVO: Botão de backup
    this.fileTreeContainer = document.getElementById('file-tree');

    if (!this.fileTreeContainer) {
      console.warn('File tree container not found');
      return;
    }

    // Add click event listener for the collapse button
    if (this.collapseButton) {
      this.collapseButton.addEventListener('click', () => this.collapseAll());
      this.updateCollapseButtonState();
    }
    
    // Add click event listener for the refresh button
    if (this.refreshButton) {
      this.refreshButton.addEventListener('click', () => this.handleRefresh());
    }

    // NOVO: Add click event listener for the backup button
    if (this.backupButton) {
      this.backupButton.addEventListener('click', () => this.handleBackup());
    }

    // Add minimal styling for animations
    this.addMinimalStyles();
  }

  /**
   * NOVO: Handles the project backup process.
   */
  async handleBackup() {
    const icon = this.backupButton.querySelector('i');
    if (!icon) return;

    // 1. Obter o caminho do projeto atual
    const projectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');

    // 2. Validar se um projeto está aberto
    if (!projectPath) {
        if (typeof showNotification === 'function') {
            showNotification('No project is open. Cannot create a backup.', 'error', 4000);
        }
        return;
    }

    // 3. Inicia o feedback visual (animação de pulso) e desabilita o botão
    icon.classList.add('backup-active'); // USA A NOVA ANIMAÇÃO
    this.backupButton.style.pointerEvents = 'none';
    if (typeof showNotification === 'function') {
        showNotification('Creating project backup... Please wait.', 'info', 5000);
    }

    try {
        // 4. Chamar a função do main.js
        const result = await window.electronAPI.createBackup(projectPath);

        // 5. Mostrar o resultado para o usuário
        if (result.success) {
            showNotification(result.message, 'success', 6000);
        } else {
            showNotification(result.message || 'Failed to create backup.', 'error', 6000);
        }
    } catch (error) {
        console.error('Error invoking create-backup IPC handler:', error);
        showNotification('A critical error occurred during the backup process.', 'error', 5000);
    } finally {
        // 6. Remove o feedback visual e reabilita o botão
        // Usamos um timeout para garantir que a animação não seja cortada abruptamente
        setTimeout(() => {
            icon.classList.remove('backup-active'); // REMOVE A NOVA ANIMAÇÃO
            this.backupButton.style.pointerEvents = 'auto';
        }, 500);
    }
}

  /**
   * Handles the file tree refresh request.
   */
  handleRefresh() {
    const icon = this.refreshButton.querySelector('i');
    if (!icon) return;

    icon.classList.add('fa-spin');
    this.refreshButton.disabled = true;

    try {
      if (window.electronAPI && typeof window.electronAPI.refreshFileTree === 'function') {
        window.electronAPI.refreshFileTree();
      } else {
        console.error('refreshFileTree API is not available.');
        if (typeof showNotification === 'function') {
          showNotification('Refresh function is not available.', 'error', 3000);
        }
      }
    } catch (error) {
      console.error('Error triggering file tree refresh:', error);
    } finally {
      setTimeout(() => {
        icon.classList.remove('fa-spin');
        this.refreshButton.disabled = false;
      }, 1000);
    }
  }

  /**
   * Collapses all currently expanded folders in the file tree.
   */
  collapseAll() {
    const expandedFolders = this.fileTreeContainer.querySelectorAll('.folder-content:not(.hidden)');
    const folderToggles = this.fileTreeContainer.querySelectorAll('.folder-toggle.rotated');
    const folderIcons = this.fileTreeContainer.querySelectorAll('.fa-folder-open');
    
    expandedFolders.forEach(folder => folder.classList.add('hidden'));
    folderToggles.forEach(toggle => toggle.classList.remove('rotated'));
    folderIcons.forEach(icon => {
      icon.classList.remove('fa-folder-open');
      icon.classList.add('fa-folder');
    });
    
    if (typeof FileTreeState !== 'undefined') {
      FileTreeState.expandedFolders.clear();
    }

    this.showCollapseEffect();
  }

  /**
   * Shows a brief visual effect on the collapse button.
   */
  showCollapseEffect() {
    if (!this.collapseButton) return;
    const icon = this.collapseButton.querySelector('i');
    if (icon) {
      icon.style.transform = 'scale(0.9)';
      icon.style.opacity = '0.7';
      setTimeout(() => {
        icon.style.transform = 'scale(1)';
        icon.style.opacity = '1';
      }, 150);
    }
  }

  /**
   * Ensures the collapse button has the correct icon and tooltip.
   */
  updateCollapseButtonState() {
    if (!this.collapseButton) return;
    const icon = this.collapseButton.querySelector('i');
    if (icon) {
      icon.className = 'fa-solid fa-square-minus';
      this.collapseButton.title = 'Collapse All';
      this.collapseButton.setAttribute('data-i18n-title', 'ui.fileTree.collapse');
    }
  }

  /**
   * Adds essential CSS styles for button feedback and animations.
   */
  addMinimalStyles() {
      if (document.getElementById('file-tree-controller-styles')) return;

      const style = document.createElement('style');
      style.id = 'file-tree-controller-styles';
      style.textContent = `
        /* Keyframes para a animação de pulso */
        @keyframes pulse-backup-icon {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.7;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        /* Classe que aplica a animação de pulso ao ícone */
        #backup-project i.backup-active {
          animation: pulse-backup-icon 1.5s ease-in-out infinite;
        }

        .file-tree-header-actions .toolbar-button, #backup-project {
          transition: opacity 0.15s ease, color 0.15s ease;
        }
        .file-tree-header-actions .toolbar-button:hover, #backup-project:hover {
          opacity: 0.8;
        }
        .file-tree-header-actions .toolbar-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .file-tree-header-actions .toolbar-button i, #backup-project i {
          transition: transform 0.15s ease, opacity 0.15s ease;
        }
      `;
      document.head.appendChild(style);
  }
}

// Initialize the controller when the DOM is ready
function initFileTreeController() {
  if (document.getElementById('file-tree')) {
    window.fileTreeController = new FileTreeController();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFileTreeController);
} else {
  initFileTreeController();
}