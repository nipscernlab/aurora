/**
 * @file Controller for File Tree interactions (Collapse, Refresh, Backup).
 */

/* eslint-disable no-undef */

import { showCardNotification } from './notification.js';
import { TreeViewState, fileTreeManager } from './file_tree_manager.js'

class FileTreeController {
  constructor() {
    this.init();
  }

  init() {
    // Get the UI elements
    this.collapseButton = document.getElementById('toggle-file-tree');
    this.refreshButton = document.getElementById('refresh-file-tree');
    this.backupButton = document.getElementById('backup-project');
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

    // Add click event listener for the backup button
    if (this.backupButton) {
      this.backupButton.addEventListener('click', () => this.handleBackup());
    }

    // Add minimal styling for animations
    this.addMinimalStyles();
  }

  /**
   * Handles the project backup process.
   */
  async handleBackup() {
    const icon = this.backupButton.querySelector('i');
    if (!icon) return;

    // 1. Get current project path
    const projectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');

    // 2. Validate if a project is open
    if (!projectPath) {
        showCardNotification('No project is open. Cannot create a backup.', 'error', 4000);
        return;
    }

    // 3. UI Feedback: Start pulse animation and disable button
    icon.classList.add('backup-active');
    this.backupButton.style.pointerEvents = 'none';
    
    showCardNotification('Creating project backup... Please wait.', 'info', 5000);

    try {
        // 4. Invoke main process handler
        const result = await window.electronAPI.createBackup(projectPath);

        // 5. Show result
        if (result.success) {
            showCardNotification(result.message, 'success', 6000);
        } else {
            showCardNotification(result.message || 'Failed to create backup.', 'error', 6000);
        }
    } catch (error) {
        console.error('Error invoking create-backup IPC handler:', error);
        showCardNotification('A critical error occurred during the backup process.', 'error', 5000);
    } finally {
        // 6. Restore UI
        setTimeout(() => {
            icon.classList.remove('backup-active');
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
        showCardNotification('Refresh function is not available.', 'error', 3000);
      }
    } catch (error) {
      console.error('Error triggering file tree refresh:', error);
      showCardNotification('Error triggering file tree refresh.', 'error', 3000);
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
        /* Pulse Animation */
        @keyframes pulse-backup-icon {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }

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

// Initialize the controller
function initFileTreeController() {
  if (document.getElementById('file-tree')) {
    window.fileTreeController = new FileTreeController();
  }
}

// Ensure DOM is ready (Module scripts are deferred by default, but this is safe)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFileTreeController);
} else {
  initFileTreeController();
}

// Definindo os estados possíveis
const VIEW_STATES = {
    FILE_TREE: 'file_tree',
    VERILOG_MODE: 'verilog_mode',
    HIERARCHICAL: 'hierarchical'
};

class TreeViewCycler {
    constructor() {
        this.toggleButton = document.getElementById('alternate-tree-toggle');
        this.toggleText = this.toggleButton ? this.toggleButton.querySelector('.toggle-text') : null;
        this.currentState = VIEW_STATES.FILE_TREE; // Estado inicial padrão
        this.cycleOrder = [VIEW_STATES.FILE_TREE, VIEW_STATES.VERILOG_MODE, VIEW_STATES.HIERARCHICAL];

        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.cycleView());
            this.updateButtonUI();
        }
    }

    /**
     * Alterna para o próximo estado de visualização na ordem.
     */
    cycleView() {
        const currentIndex = this.cycleOrder.indexOf(this.currentState);
        let nextIndex = (currentIndex + 1) % this.cycleOrder.length;
        let nextState = this.cycleOrder[nextIndex];

        // Se o próximo estado for HIERARQUICO e os dados não estiverem disponíveis,
        // pule para o próximo estado (FILE_TREE).
        if (nextState === VIEW_STATES.HIERARCHICAL && !TreeViewState.hierarchyData) {
            nextIndex = (nextIndex + 1) % this.cycleOrder.length; // Pula para o próximo
            nextState = this.cycleOrder[nextIndex];
        }

        this.currentState = nextState;
        this.applyState(nextState);
        this.updateButtonUI();
    }

    /**
     * Aplica o estado de visualização atual (chama as funções de renderização apropriadas).
     * @param {string} state - O estado de visualização a ser aplicado.
     */
    applyState(state) {
        // Desativa todas as visualizações primeiro para garantir limpeza
        this.disableAllViews();

        switch (state) {
            case VIEW_STATES.FILE_TREE:
                // Reverte para a visualização padrão (File Tree Manager)
                if (fileTreeManager && typeof fileTreeManager.updateFileTree === 'function') {
                    // É necessário passar os dados de arquivo, assumindo que são gerenciados globalmente ou no manager.
                    // Para o exemplo, chamaremos o renderizador padrão.
                    fileTreeManager.renderStandardTree(); // Assumindo novo método que renderiza a visualização não-hierárquica
                }
                break;

            case VIEW_STATES.VERILOG_MODE:
                // Ativa a visualização do Verilog Mode (somente arquivos .v)
                if (window.verilogModeManager && typeof window.verilogModeManager.renderVerilogFileTree === 'function') {
                    window.verilogModeManager.renderVerilogFileTree(); // Assumindo que este método renderiza apenas arquivos .v
                }
                break;

            case VIEW_STATES.HIERARCHICAL:
                // Ativa a visualização Hierárquica
                if (TreeViewState.hierarchyData) {
                    TreeViewState.setHierarchical(true); // Alterna o estado global
                    if (TreeViewState.compilationModule) {
                        TreeViewState.compilationModule.renderHierarchicalTree(); // Re-renderiza
                    }
                } else {
                    // Isso não deve acontecer devido à verificação em cycleView, mas é uma proteção.
                    this.showNotification("Hierarchical view is not available. Please compile the project first.", 'warning');
                    this.currentState = VIEW_STATES.FILE_TREE; // Volta para o padrão
                    this.applyState(VIEW_STATES.FILE_TREE);
                }
                break;
        }
        
        this.showNotification(`Switched to: ${this.getDisplayName(state)}`);
    }

    /**
     * Assegura que todas as visualizações de modo especial (Verilog, Hierárquica) estejam desativadas.
     */
    disableAllViews() {
        // Desativa visualização Hierárquica
        TreeViewState.setHierarchical(false);
        // Desativa Verilog Mode (se aplicável, talvez gerenciado internamente pelo VerilogModeManager)
        if (window.verilogModeManager && typeof window.verilogModeManager.disableVerilogMode === 'function') {
             window.verilogModeManager.disableVerilogMode(); // Assumindo um método para desativar o modo Verilog
        }
    }

    /**
     * Atualiza o texto do botão de alternância.
     */
    updateButtonUI() {
        if (this.toggleText) {
            this.toggleText.textContent = this.getDisplayName(this.currentState);
        }
        // Opcionalmente, pode-se atualizar o ícone aqui se necessário.
    }
    
    /**
     * Retorna o nome amigável do estado.
     */
    getDisplayName(state) {
        switch (state) {
            case VIEW_STATES.FILE_TREE: return 'Standard Tree';
            case VIEW_STATES.VERILOG_MODE: return 'Verilog Files';
            case VIEW_STATES.HIERARCHICAL: return 'Hierarchy View';
            default: return 'Alternate Tree';
        }
    }
    
    /**
     * Usa a função de notificação existente no projeto.
     */
    showNotification(message, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, 3000);
        } else {
            console.log(`[Notification] ${message}`);
        }
    }
}

// Inicializa o ciclista de visualização
function initTreeViewCycler() {
    new TreeViewCycler();
}

// Adicione a chamada de inicialização no final de file_tree_toggler.js
document.addEventListener('DOMContentLoaded', initTreeViewCycler);