// FileOperations.js - Modern file operations for the file tree
// This extends the existing code with VSCode-like file operations

// Add context menu CSS
const contextMenuStyles = document.createElement('style');
contextMenuStyles.textContent = `
  .context-menu {
    position: absolute;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    box-shadow: var(--shadow-md);
    min-width: 180px;
    z-index: 1000;
    animation: fadeIn 0.1s ease-out;
    padding: 4px 0;
  }

  .context-menu-item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-primary);
    transition: background-color 0.1s;
  }

  .context-menu-item:hover {
    background-color: var(--bg-hover);
  }

  .context-menu-divider {
    height: 1px;
    background-color: var(--border-primary);
    margin: 4px 0;
  }

  .input-overlay {
    position: absolute;
    z-index: 999;
    animation: fadeIn 0.2s ease-out forwards;
    width: calc(100% - 20px);
  }

  .input-overlay input {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--accent-primary);
    color: var(--text-primary);
    border-radius: 4px;
    width: 100%;
    padding: 4px 8px;
    font-size: 13px;
    font-family: var(--font-sans);
    outline: none;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(contextMenuStyles);

// File Operations Manager
const FileOperations = {
  contextMenu: null,
  targetPath: null,
  targetIsDirectory: false,
  targetElement: null,

  // Initialize context menu event handlers
  init() {
    // Close context menu on click outside
    document.addEventListener('click', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    // Close context menu on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });

    // Add context menu on right-click for file tree items
    document.getElementById('file-tree').addEventListener('contextmenu', (e) => {
      // Find the closest file-tree-item
      const fileItem = e.target.closest('.file-tree-item');
      if (!fileItem) return;
      
      e.preventDefault();
      
      // Get file path from data attribute or compute from DOM
      let filePath = fileItem.getAttribute('data-path');
      if (!filePath && fileItem.querySelector('.file-item span')) {
        // If it's a folder (which might not have data-path), compute it
        const fileName = fileItem.querySelector('.file-item span').textContent;
        // Get parent path by traversing DOM upwards
        let parentElements = [];
        let current = fileItem.parentElement;
        while (current && !current.classList.contains('file-tree')) {
          if (current.classList.contains('folder-content')) {
            const parentSpan = current.previousElementSibling?.querySelector('span');
            if (parentSpan) {
              parentElements.unshift(parentSpan.textContent);
            }
          }
          current = current.parentElement;
        }
        
        filePath = [...parentElements, fileName].join('/');
        // If we're in a project folder, prepend the project path
        if (window.currentProjectPath) {
          filePath = `${window.currentProjectPath}/${filePath}`;
        }
      }
      
      if (!filePath) return;

      // Determine if it's a directory based on icon
      const folderIcon = fileItem.querySelector('.fa-folder, .fa-folder-open');
      this.targetIsDirectory = folderIcon !== null;
      this.targetPath = filePath;
      this.targetElement = fileItem;
      
      this.showContextMenu(e.clientX, e.clientY, this.targetIsDirectory);
    });

    // Add top-level folder and file creation buttons
    this.setupTopLevelCreation();
  },

  // Show context menu at specified position
  showContextMenu(x, y, isDirectory) {
    // Remove existing menu if any
    this.hideContextMenu();
    
    // Create new context menu
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'context-menu';
    
    // Add menu items based on target type
    if (isDirectory) {
      this.addMenuItem('New File', 'fa-file-plus', () => this.createNewFile());
      this.addMenuItem('New Folder', 'fa-folder-plus', () => this.createNewFolder());
      this.addMenuDivider();
    }
    
    this.addMenuItem('Rename', 'fa-i-cursor', () => this.renameItem());
    this.addMenuItem('Delete', 'fa-trash-alt', () => this.deleteItem());
    
    // Position menu and add to DOM
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    document.body.appendChild(this.contextMenu);
    
    // Adjust position if menu overflows window
    const rect = this.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }
  },

  // Hide and remove context menu
  hideContextMenu() {
    if (this.contextMenu && this.contextMenu.parentNode) {
      this.contextMenu.parentNode.removeChild(this.contextMenu);
      this.contextMenu = null;
    }
  },

  // Add menu item to context menu
  addMenuItem(label, iconClass, onClick) {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    
    const icon = document.createElement('i');
    icon.className = `fa-solid ${iconClass}`;
    item.appendChild(icon);
    
    const text = document.createTextNode(label);
    item.appendChild(text);
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideContextMenu();
      onClick();
    });
    
    this.contextMenu.appendChild(item);
  },

  // Add divider to context menu
  addMenuDivider() {
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    this.contextMenu.appendChild(divider);
  },

  // Create input overlay for file/folder operations
  createInputOverlay(targetElement, initialValue, placeholder, onSubmit) {
    // Position the input relative to the target element
    const fileNameElement = targetElement.querySelector('.file-item span');
    if (!fileNameElement) return;

    const fileItemElement = targetElement.querySelector('.file-item');
    const rect = fileItemElement.getBoundingClientRect();
    
    const overlay = document.createElement('div');
    overlay.className = 'input-overlay';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.height = `${rect.height}px`;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue || '';
    input.placeholder = placeholder;
    overlay.appendChild(input);
    
    document.body.appendChild(overlay);
    
    input.focus();
    if (initialValue) {
      const dotIndex = initialValue.lastIndexOf('.');
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex);
      } else {
        input.select();
      }
    }
    
    const handleSubmit = () => {
      const value = input.value.trim();
      if (value) {
        onSubmit(value);
      }
      document.body.removeChild(overlay);
    };
    
    const handleCancel = () => {
      document.body.removeChild(overlay);
    };
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    });
    
    input.addEventListener('blur', handleCancel);
  },
  
  // Create a new file
  async createNewFile() {
    const parentPath = this.targetPath;
    
    this.createInputOverlay(
      this.targetElement, 
      'newfile.txt', 
      'File name', 
      async (fileName) => {
        try {
          const filePath = `${parentPath}/${fileName}`;
          const result = await window.electronAPI.createFile(filePath, '');
          if (result.success) {
            showNotification(`File ${fileName} created`, 'success');
            refreshFileTree();
          } else {
            showNotification(`Error creating file: ${result.message}`, 'error');
          }
        } catch (error) {
          console.error('Error creating file:', error);
          showNotification('Error creating file', 'error');
        }
      }
    );
  },
  
  // Create a new folder
  async createNewFolder() {
    const parentPath = this.targetPath;
    
    this.createInputOverlay(
      this.targetElement, 
      'New Folder', 
      'Folder name', 
      async (folderName) => {
        try {
          const folderPath = `${parentPath}/${folderName}`;
          const result = await window.electronAPI.createFolder(folderPath);
          if (result.success) {
            showNotification(`Folder ${folderName} created`, 'success');
            refreshFileTree();
          } else {
            showNotification(`Error creating folder: ${result.message}`, 'error');
          }
        } catch (error) {
          console.error('Error creating folder:', error);
          showNotification('Error creating folder', 'error');
        }
      }
    );
  },
  
  // Rename a file or folder
  async renameItem() {
    const path = this.targetPath;
    const isDirectory = this.targetIsDirectory;
    
    // Get the current name from the path
    const pathParts = path.split('/');
    const currentName = pathParts[pathParts.length - 1];
    
    this.createInputOverlay(
      this.targetElement,
      currentName,
      'New name',
      async (newName) => {
        try {
          // Create the new path by replacing just the name part
          pathParts[pathParts.length - 1] = newName;
          const newPath = pathParts.join('/');
          
          const result = await window.electronAPI.renameItem(path, newPath);
          if (result.success) {
            showNotification(`${isDirectory ? 'Folder' : 'File'} renamed to ${newName}`, 'success');
            
            // If it's an open file in tabs, update the tab
            if (!isDirectory && TabManager.tabs.has(path)) {
              const content = TabManager.tabContents.get(path);
              TabManager.removeTab(path);
              TabManager.addTab(newPath, content);
            }
            
            refreshFileTree();
          } else {
            showNotification(`Error renaming: ${result.message}`, 'error');
          }
        } catch (error) {
          console.error('Error renaming item:', error);
          showNotification('Error renaming item', 'error');
        }
      }
    );
  },
  
  // Delete a file or folder
  async deleteItem() {
    const path = this.targetPath;
    const isDirectory = this.targetIsDirectory;
    const itemName = path.split('/').pop();
    
    // Confirm deletion
    const confirmMessage = `Are you sure you want to delete ${isDirectory ? 'folder' : 'file'} "${itemName}"?${isDirectory ? ' This will delete all contents inside.' : ''}`;
    
    if (confirm(confirmMessage)) {
      try {
        const result = await window.electronAPI.deleteItem(path, isDirectory);
        if (result.success) {
          showNotification(`${isDirectory ? 'Folder' : 'File'} ${itemName} deleted`, 'success');
          
          // If it's an open file in tabs, close the tab
          if (!isDirectory && TabManager.tabs.has(path)) {
            TabManager.removeTab(path);
          }
          
          refreshFileTree();
        } else {
          showNotification(`Error deleting: ${result.message}`, 'error');
        }
      } catch (error) {
        console.error('Error deleting item:', error);
        showNotification('Error deleting item', 'error');
      }
    }
  },
  
  // Setup top-level creation buttons
  setupTopLevelCreation() {
    // Create top-level file
    document.getElementById('create-toplevel-folder').addEventListener('click', async () => {
      if (!currentProjectPath) {
        showNotification('No project is open', 'error');
        return;
      }
      
      // Create a folder creation dialog or prompt
      const folderName = prompt('Enter the name for a new top-level folder:', 'New Folder');
      if (!folderName) return;
      
      try {
        const folderPath = `${currentProjectPath}/${folderName}`;
        const result = await window.electronAPI.createFolder(folderPath);
        
        if (result.success) {
          // Now create a default .v file inside the folder
          const filePath = `${folderPath}/${folderName}.v`;
          const defaultContent = `// ${folderName}.v\nmodule ${folderName}(\n  input clk,\n  input rst_n,\n  output reg [7:0] data_out\n);\n\n  always @(posedge clk or negedge rst_n) begin\n    if (!rst_n)\n      data_out <= 8'h0;\n    else\n      data_out <= data_out + 1;\n  end\n\nendmodule`;
          
          const fileResult = await window.electronAPI.createFile(filePath, defaultContent);
          
          if (fileResult.success) {
            showNotification(`Created folder ${folderName} with default .v file`, 'success');
            refreshFileTree();
          } else {
            showNotification(`Error creating .v file: ${fileResult.message}`, 'error');
          }
        } else {
          showNotification(`Error creating folder: ${result.message}`, 'error');
        }
      } catch (error) {
        console.error('Error creating folder structure:', error);
        showNotification('Error creating folder structure', 'error');
      }
    });
  }
};

// Add New File and New Folder buttons to the file-tree-header
function setupExtraFileTreeButtons() {
  const fileTreeHeader = document.querySelector('.file-tree-header');
  
  if (fileTreeHeader) {
    // Create a div for the new actions
    const newItemActions = document.createElement('div');
    newItemActions.className = 'file-actions';
    newItemActions.style.margin = '8px 0';
    newItemActions.style.display = 'flex';
    newItemActions.style.gap = '8px';
    
    // New File button
    const newFileBtn = document.createElement('button');
    newFileBtn.innerHTML = '<i class="fa-solid fa-file-plus"></i> New File';
    newFileBtn.style.display = 'flex';
    newFileBtn.style.alignItems = 'center';
    newFileBtn.style.gap = '6px';
    newFileBtn.style.padding = '6px 10px';
    newFileBtn.style.fontSize = '12px';
    newFileBtn.style.border = 'none';
    newFileBtn.style.borderRadius = '4px';
    newFileBtn.style.backgroundColor = 'var(--bg-tertiary)';
    newFileBtn.style.color = 'var(--text-primary)';
    newFileBtn.style.cursor = 'pointer';
    
    // New Folder button
    const newFolderBtn = document.createElement('button');
    newFolderBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i> New Folder';
    newFolderBtn.style.display = 'flex';
    newFolderBtn.style.alignItems = 'center';
    newFolderBtn.style.gap = '6px';
    newFolderBtn.style.padding = '6px 10px';
    newFolderBtn.style.fontSize = '12px';
    newFolderBtn.style.border = 'none';
    newFolderBtn.style.borderRadius = '4px';
    newFolderBtn.style.backgroundColor = 'var(--bg-tertiary)';
    newFolderBtn.style.color = 'var(--text-primary)';
    newFolderBtn.style.cursor = 'pointer';
    
    // Hover effect
    const addHoverEffect = (btn) => {
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = 'var(--bg-hover)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = 'var(--bg-tertiary)';
      });
    };
    
    addHoverEffect(newFileBtn);
    addHoverEffect(newFolderBtn);
    
    // Add buttons to container
    newItemActions.appendChild(newFileBtn);
    newItemActions.appendChild(newFolderBtn);
    
    // Add click handlers
    newFileBtn.addEventListener('click', async () => {
      if (!currentProjectPath) {
        showNotification('No project is open', 'error');
        return;
      }
      
      const fileName = prompt('Enter the name for a new file:', 'newfile.txt');
      if (!fileName) return;
      
      try {
        const filePath = `${currentProjectPath}/${fileName}`;
        const result = await window.electronAPI.createFile(filePath, '');
        
        if (result.success) {
          showNotification(`File ${fileName} created`, 'success');
          refreshFileTree();
        } else {
          showNotification(`Error creating file: ${result.message}`, 'error');
        }
      } catch (error) {
        console.error('Error creating file:', error);
        showNotification('Error creating file', 'error');
      }
    });
    
    newFolderBtn.addEventListener('click', async () => {
      if (!currentProjectPath) {
        showNotification('No project is open', 'error');
        return;
      }
      
      const folderName = prompt('Enter the name for a new folder:', 'New Folder');
      if (!folderName) return;
      
      try {
        const folderPath = `${currentProjectPath}/${folderName}`;
        const result = await window.electronAPI.createFolder(folderPath);
        
        if (result.success) {
          showNotification(`Folder ${folderName} created`, 'success');
          refreshFileTree();
        } else {
          showNotification(`Error creating folder: ${result.message}`, 'error');
        }
      } catch (error) {
        console.error('Error creating folder:', error);
        showNotification('Error creating folder', 'error');
      }
    });
    
    // Insert after the existing buttons
    fileTreeHeader.appendChild(newItemActions);
  }
}

// Add key shortcut handlers for common operations
function setupFileShortcuts() {
  document.addEventListener('keydown', async (e) => {
    // Only handle if we have a file tree and a project open
    if (!currentProjectPath) return;
    
    // Focus must be in the file tree area
    const fileTree = document.getElementById('file-tree');
    const isFileTreeFocused = fileTree.contains(document.activeElement) || 
                             fileTree === document.activeElement;
    
    if (!isFileTreeFocused) return;
    
    // Keyboard shortcuts similar to VS Code
    if (e.key === 'Delete' || (e.metaKey && e.key === 'Backspace')) {
      // Delete the selected item
      const selectedItem = document.querySelector('.file-tree-item.active');
      if (selectedItem) {
        e.preventDefault();
        
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;
        
        const isDirectory = selectedItem.querySelector('.fa-folder, .fa-folder-open') !== null;
        const itemName = path.split('/').pop();
        
        if (confirm(`Are you sure you want to delete ${isDirectory ? 'folder' : 'file'} "${itemName}"?`)) {
          try {
            const result = await window.electronAPI.deleteItem(path, isDirectory);
            if (result.success) {
              showNotification(`${isDirectory ? 'Folder' : 'File'} ${itemName} deleted`, 'success');
              
              // If it's an open file in tabs, close the tab
              if (!isDirectory && TabManager.tabs.has(path)) {
                TabManager.removeTab(path);
              }
              
              refreshFileTree();
            } else {
              showNotification(`Error deleting: ${result.message}`, 'error');
            }
          } catch (error) {
            console.error('Error deleting item:', error);
            showNotification('Error deleting item', 'error');
          }
        }
      }
    } else if (e.key === 'F2') {
      // Rename the selected item
      const selectedItem = document.querySelector('.file-tree-item.active');
      if (selectedItem) {
        e.preventDefault();
        
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;
        
        // Handle renaming logic similar to context menu version
        const isDirectory = selectedItem.querySelector('.fa-folder, .fa-folder-open') !== null;
        const pathParts = path.split('/');
        const currentName = pathParts[pathParts.length - 1];
        
        FileOperations.targetElement = selectedItem;
        FileOperations.targetPath = path;
        FileOperations.targetIsDirectory = isDirectory;
        FileOperations.renameItem();
      }
    }
  });
}

// Initialize FileOperations when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  FileOperations.init();
  setupExtraFileTreeButtons();
  setupFileShortcuts();
  
  // Add active class to clicked file-tree-item for visual selection
  document.getElementById('file-tree').addEventListener('click', (e) => {
    const fileItem = e.target.closest('.file-tree-item');
    if (fileItem) {
      // Clear any existing active items
      document.querySelectorAll('.file-tree-item.active').forEach(item => {
        item.classList.remove('active');
      });
      
      // Add active class to the clicked item
      fileItem.classList.add('active');
    }
  });
});

// Preload file operations API implementation for the Electron side
// This needs to be implemented on the Electron side, here's a guide for what's needed:
/**
 * Required IPC handlers for the main process (preload.js):
 * 
 * 1. createFile(path, content) - Create a new file with initial content
 * 2. createFolder(path) - Create a new folder
 * 3. renameItem(oldPath, newPath) - Rename a file or folder
 * 4. deleteItem(path, isDirectory) - Delete a file or folder
 * 
 * Each should return { success: true/false, message?: 'error message' }
 */