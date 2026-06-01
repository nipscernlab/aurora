/**
 * @file Controller for File Tree interactions (Collapse, Refresh, Backup).
 */

import { showCardNotification } from '../ui/notification.js';

class FileTreeController {
  constructor() {
    this.init();
  }

  init() {
    // Get the UI elements
    this.collapseButton = document.getElementById('toggle-file-tree');
    this.backupButton = document.getElementById('backup-project');
    this.fileTreeContainer = document.getElementById('file-tree');

    if (!this.fileTreeContainer) {
      console.warn('File tree container not found');
      return;
    }

    // Add click event listener for the collapse/expand toggle button
    if (this.collapseButton) {
      this.collapseButton.addEventListener('click', () => this.toggleTree());
      this.updateCollapseButtonState();
      // Tooltip text comes from window.t — re-apply on locale change.
      window.addEventListener('aurora:locale-changed', () => this.updateCollapseButtonState());
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
   * Smart collapse/expand-all toggle for the two views that have a
   * collapsible tree: the toplevel module hierarchy and the standard
   * folder tree (the verilog picker is flat — no-op there). If anything
   * is currently expanded we collapse everything; otherwise we expand
   * everything. The action is decided from live state each click, so it
   * always does the right thing regardless of manual node toggles.
   */
  async toggleTree() {
    const view = window.fileTreeViewController?.getActiveView?.() ?? 'verilog';

    if (view === 'hierarchy') {
      this._setHierarchyExpanded(!this._anythingExpanded());
    } else if (view === 'standard') {
      const r = window.standardTreeRenderer;
      if (!r) return;
      if (r.hasExpanded()) r.collapseAll();
      else await r.expandAll();
    } else {
      return; // flat verilog picker — nothing to collapse/expand
    }

    this.showCollapseEffect();
  }

  /** True if the active view currently has any expanded node. */
  _anythingExpanded() {
    const view = window.fileTreeViewController?.getActiveView?.() ?? 'verilog';
    if (view === 'hierarchy') {
      return !!this.fileTreeContainer.querySelector('.hierarchy-children.expanded');
    }
    if (view === 'standard') {
      return !!window.standardTreeRenderer?.hasExpanded?.();
    }
    return false;
  }

  /**
   * Expand or collapse every node in the toplevel hierarchy view. Drives
   * both `.hierarchy-children` (.expanded/.collapsed) and the
   * `.hierarchy-toggle` flag the curved markers in h_tree.css key off.
   */
  _setHierarchyExpanded(expand) {
    this.fileTreeContainer.querySelectorAll('.hierarchy-children')
      .forEach(children => {
        children.classList.toggle('expanded', expand);
        children.classList.toggle('collapsed', !expand);
      });
    this.fileTreeContainer.querySelectorAll('.hierarchy-toggle')
      .forEach(toggle => toggle.classList.toggle('expanded', expand));
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
    if (icon) icon.className = 'ph ph-rows';
    // Single smart toggle now (collapses or expands depending on state),
    // so the tooltip names both actions. data-tooltip drives Aurora's
    // custom tooltip (see js/ui/tooltip.js); window.t falls back to the
    // English string when i18n isn't ready.
    const tr = (k, fb) => {
      const v = window.t ? window.t(k) : null;
      return (v && v !== k) ? v : fb;
    };
    this.collapseButton.dataset.tooltip = tr('fileTree.toggleAll', 'Collapse / expand all');
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