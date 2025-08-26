// File Tree Collapse Only Functionality
class FileTreeCollapser {
  constructor() {
    this.init();
  }

  init() {
    // Get the toggle button and file tree container
    this.toggleButton = document.getElementById('toggle-file-tree');
    this.fileTreeContainer = document.getElementById('file-tree');
    
    if (!this.toggleButton || !this.fileTreeContainer) {
      console.warn('File tree toggle elements not found');
      return;
    }

    // Add click event listener for collapse only
    this.toggleButton.addEventListener('click', () => this.collapseAll());
    
    // Ensure button shows correct icon and tooltip
    this.updateButtonState();
  }

  collapseAll() {
    // Find all expanded folders and collapse them
    const expandedFolders = this.fileTreeContainer.querySelectorAll('.folder-content:not(.hidden)');
    const folderToggles = this.fileTreeContainer.querySelectorAll('.folder-toggle.rotated');
    const folderIcons = this.fileTreeContainer.querySelectorAll('.fa-folder-open');
    
    // Collapse all folders
    expandedFolders.forEach(folder => {
      folder.classList.add('hidden');
    });
    
    // Reset toggle arrows to right-pointing position
    folderToggles.forEach(toggle => {
      toggle.classList.remove('rotated');
    });
    
    // Change folder icons to closed state
    folderIcons.forEach(icon => {
      if (icon.classList.contains('file-item-icon')) {
        icon.classList.remove('fa-folder-open');
        icon.classList.add('fa-folder');
      }
    });
    
    // Clear expanded state from FileTreeState if it exists
    if (typeof FileTreeState !== 'undefined') {
      FileTreeState.expandedFolders.clear();
    }

    // Show visual feedback
    this.showCollapseEffect();
  }

  showCollapseEffect() {
    // Add a brief visual effect to indicate collapse action
    const icon = this.toggleButton.querySelector('i');
    if (icon) {
      icon.style.transform = 'scale(0.9)';
      icon.style.opacity = '0.7';
      
      setTimeout(() => {
        icon.style.transform = 'scale(1)';
        icon.style.opacity = '1';
      }, 150);
    }
  }

  updateButtonState() {
    const icon = this.toggleButton.querySelector('i');
    const button = this.toggleButton;
    
    if (icon && button) {
      // Always show collapse icon since we only collapse
      icon.className = 'fa-solid fa-compress-arrows-alt';
      button.title = 'Collapse All';
      button.setAttribute('data-i18n-title', 'ui.fileTree.collapse');
    }
  }

  addMinimalStyles() {
    // Add only essential styles that don't interfere with normal scrolling
    const style = document.createElement('style');
    style.textContent = `
      #toggle-file-tree {
        transition: opacity 0.15s ease;
      }
      
      #toggle-file-tree:hover {
        opacity: 0.8;
      }
      
      #toggle-file-tree i {
        transition: transform 0.15s ease, opacity 0.15s ease;
      }
    `;
    
    // Only add styles if they don't exist
    if (!document.getElementById('file-tree-collapse-styles')) {
      style.id = 'file-tree-collapse-styles';
      document.head.appendChild(style);
    }
  }

  // Public method to manually collapse all folders
  collapse() {
    this.collapseAll();
  }
}

// Initialize the file tree collapser when DOM is ready
function initFileTreeCollapser() {
  if (document.getElementById('toggle-file-tree')) {
    window.fileTreeCollapser = new FileTreeCollapser();
  }
}

// Initialize based on document state
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFileTreeCollapser);
} else {
  initFileTreeCollapser();
}