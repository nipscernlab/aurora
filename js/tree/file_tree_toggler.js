/**
 * @file Controller for File Tree interactions (Collapse, Refresh, Backup).
 */

import { showCardNotification } from '../ui/notification.js';
import { fileTreeManager, FileTreeState } from './file_tree_manager.js';

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

    icon.classList.add('spinning');
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
        icon.classList.remove('spinning');
        this.refreshButton.disabled = false;
      }, 1000);
    }
  }

  /**
   * Collapses all currently expanded folders in the file tree.
   *
   * The previous version mutated DOM classes directly — it kept dead
   * references to a `.folder-toggle.rotated` legacy class that the current
   * renderer no longer produces, and it didn't always converge on the right
   * chevron rotation when expanded folders had been re-rendered. The clean
   * fix: drop FileTreeState first, then ask the manager to re-render. The
   * renderer is the single source of truth for chevron orientation
   * (`.collapsed` ⇒ rotated -90°), so all chevrons end up consistent with
   * the post-collapse model state.
   */
  collapseAll() {
    // Clear the standard-tree model first. FileTreeState was previously not
    // exported, so `typeof FileTreeState !== 'undefined'` resolved to false
    // and the expanded-folder set survived the re-render — the tree just
    // bounced back to its previous shape, which the user perceived as
    // "Collapse All is just Refresh". Importing FileTreeState fixes that.
    FileTreeState?.expandedFolders?.clear?.();

    // Re-render so every chevron + folder icon picks up its collapsed
    // state from a fresh pass through renderFileTree.
    if (fileTreeManager && typeof fileTreeManager.refresh === 'function') {
      fileTreeManager.refresh();
    }

    // Defensive DOM sweep. Runs on top of the model reset above so even if
    // the renderer is mid-flight (200ms fade) the user sees instant feedback.
    this.fileTreeContainer.querySelectorAll('.folder-content')
      .forEach(content => content.classList.add('hidden'));
    this.fileTreeContainer.querySelectorAll('.folder-toggle-icon')
      .forEach(toggle => toggle.classList.add('collapsed'));
    this.fileTreeContainer.querySelectorAll('.file-item-icon.ph-folder-open')
      .forEach(icon => icon.classList.replace('ph-folder-open', 'ph-folder'));
    this.fileTreeContainer.querySelectorAll('.file-item-icon.fa-folder-open')
      .forEach(icon => icon.classList.replace('fa-folder-open', 'fa-folder'));

    // Hierarchy view (post-synthesis module tree) lives inside the same
    // #file-tree element but is its own DOM subtree (see tree_view.js).
    // Mirror the same intent: every `.hierarchy-children` collapses and
    // every `.hierarchy-toggle` drops its `expanded` flag so the curved
    // tree-node markers in h_tree.css redraw as hollow rings. This makes
    // Collapse All work regardless of which view the user has active —
    // standard, verilog picker, or hierarchy.
    this.fileTreeContainer.querySelectorAll('.hierarchy-children')
      .forEach(children => {
        children.classList.remove('expanded');
        children.classList.add('collapsed');
      });
    this.fileTreeContainer.querySelectorAll('.hierarchy-toggle')
      .forEach(toggle => toggle.classList.remove('expanded'));

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
      icon.className = 'ph ph-rows';
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