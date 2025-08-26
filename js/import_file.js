// modalImport.js - Advanced File Import Modal System
class ImportModal {
  constructor() {
    this.importedFiles = [];
    this.filteredFiles = [];
    this.isOpen = false;
    this.projectPath = null;
    this.sortOrder = 'name'; // name, date, type, path
    this.sortDirection = 'asc'; // asc, desc
    
    this.init();
  }
  
  init() {
    this.bindEvents();
    this.loadImportedFiles();
    console.log('Import Modal system initialized');
  }
  
  async getProjectPath() {
    if (!this.projectPath && window.electronAPI) {
      try {
        this.projectPath = currentProjectPath;
      } catch (error) {
        console.warn('Could not get project path:', error);
        this.projectPath = './'; // Fallback
      }
    }
    return this.projectPath || './';
  }
  
  bindEvents() {
    // Import button click
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.openModal());
    }
    
    // Modal close events
    document.getElementById('closeImportModal')?.addEventListener('click', () => this.closeModal());
    document.getElementById('importModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'importModal') this.closeModal();
    });
    
    // Control buttons
    document.getElementById('browseFiles')?.addEventListener('click', () => this.browseFiles());
    document.getElementById('clearAll')?.addEventListener('click', () => this.clearAllFiles());
    document.getElementById('saveImports')?.addEventListener('click', () => this.saveConfiguration());
    document.getElementById('exportList')?.addEventListener('click', () => this.exportFileList());
    
    // List controls
    document.getElementById('expandAll')?.addEventListener('click', () => this.expandAll());
    document.getElementById('collapseAll')?.addEventListener('click', () => this.collapseAll());
    document.getElementById('sortFiles')?.addEventListener('click', () => this.toggleSort());
    
    // Search functionality
    const searchInput = document.getElementById('fileSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.filterFiles(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.target.value = '';
          this.filterFiles('');
        }
      });
    }
    
    // Drop zone events
    const dropZone = document.getElementById('dropZone');
    const modal = document.getElementById('importModal');
    
    if (dropZone && modal) {
      // Drop zone specific events
      dropZone.addEventListener('click', () => this.browseFiles());
      dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
      dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
      dropZone.addEventListener('drop', (e) => this.handleDrop(e));
      
      // Global drag events for modal highlight
      modal.addEventListener('dragenter', (e) => this.handleModalDragEnter(e));
      modal.addEventListener('dragleave', (e) => this.handleModalDragLeave(e));
      modal.addEventListener('dragover', (e) => e.preventDefault());
      modal.addEventListener('drop', (e) => this.handleDrop(e));
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (this.isOpen) {
        if (e.key === 'Escape') {
          this.closeModal();
        } else if (e.ctrlKey || e.metaKey) {
          switch (e.key) {
            case 'o':
              e.preventDefault();
              this.browseFiles();
              break;
            case 's':
              e.preventDefault();
              this.saveConfiguration();
              break;
            case 'f':
              e.preventDefault();
              document.getElementById('fileSearch')?.focus();
              break;
          }
        }
      }
    });
  }
  
  openModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
      modal.classList.add('active');
      this.isOpen = true;
      document.body.style.overflow = 'hidden';
      
      // Focus search input
      setTimeout(() => {
        document.getElementById('fileSearch')?.focus();
      }, 300);
    }
  }
  
  closeModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
      modal.classList.remove('active', 'drag-over');
      this.isOpen = false;
      document.body.style.overflow = '';
    }
  }
  
  async browseFiles() {
    if (!window.electronAPI) {
      console.warn('Electron API not available for file browsing');
      return;
    }
    
    try {
      const result = await window.electronAPI.showOpenDialogImport({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result && !result.canceled && result.filePaths) {
        this.addFiles(result.filePaths);
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
      this.showNotification('Error opening file dialog', 'error');
    }
  }
  
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dropZone = document.getElementById('dropZone');
    const modal = document.getElementById('importModal');
    
    if (dropZone) dropZone.classList.add('drag-over');
    if (modal) modal.classList.add('drag-over');
  }
  
  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Only remove drag-over if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget)) {
      const dropZone = document.getElementById('dropZone');
      if (dropZone) dropZone.classList.remove('drag-over');
    }
  }
  
  handleModalDragEnter(e) {
    e.preventDefault();
    const modal = document.getElementById('importModal');
    if (modal) modal.classList.add('drag-over');
  }
  
  handleModalDragLeave(e) {
    e.preventDefault();
    // Only remove if leaving the modal entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      const modal = document.getElementById('importModal');
      if (modal) modal.classList.remove('drag-over');
    }
  }
  
  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dropZone = document.getElementById('dropZone');
    const modal = document.getElementById('importModal');
    
    if (dropZone) dropZone.classList.remove('drag-over');
    if (modal) modal.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const filePaths = files.map(file => file.path || file.name);
      this.addFiles(filePaths);
    }
  }
  
  addFiles(filePaths) {
    const newFiles = filePaths.filter(path => 
      !this.importedFiles.some(file => file.path === path)
    );
    
    const fileObjects = newFiles.map(path => ({
      id: this.generateId(),
      path: path,
      name: this.getFileName(path),
      extension: this.getFileExtension(path),
      directory: this.getDirectory(path),
      dateAdded: new Date().toISOString(),
      size: null // We'll get this from electron if available
    }));
    
    this.importedFiles.push(...fileObjects);
    this.filterFiles(document.getElementById('fileSearch')?.value || '');
    this.updateStatistics();
    this.saveConfiguration();
    
    this.showNotification(`Added ${newFiles.length} file(s)`, 'success');
  }
  
  removeFile(fileId) {
    this.importedFiles = this.importedFiles.filter(file => file.id !== fileId);
    this.filterFiles(document.getElementById('fileSearch')?.value || '');
    this.updateStatistics();
    this.saveConfiguration();
    
    this.showNotification('File removed', 'info');
  }
  
  clearAllFiles() {
    if (this.importedFiles.length === 0) return;
    
    if (confirm('Are you sure you want to remove all imported files?')) {
      this.importedFiles = [];
      this.filterFiles('');
      this.updateStatistics();
      this.saveConfiguration();
      
      this.showNotification('All files cleared', 'info');
    }
  }
  
  filterFiles(searchTerm) {
    if (!searchTerm.trim()) {
      this.filteredFiles = [...this.importedFiles];
    } else {
      const term = searchTerm.toLowerCase();
      this.filteredFiles = this.importedFiles.filter(file => 
        file.name.toLowerCase().includes(term) ||
        file.path.toLowerCase().includes(term) ||
        file.extension.toLowerCase().includes(term)
      );
    }
    
    this.sortFiles();
    this.renderFileList();
  }
  
  sortFiles() {
    this.filteredFiles.sort((a, b) => {
      let aVal, bVal;
      
      switch (this.sortOrder) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'date':
          aVal = new Date(a.dateAdded);
          bVal = new Date(b.dateAdded);
          break;
        case 'type':
          aVal = a.extension.toLowerCase();
          bVal = b.extension.toLowerCase();
          break;
        case 'path':
          aVal = a.directory.toLowerCase();
          bVal = b.directory.toLowerCase();
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  toggleSort() {
    const sortOrders = ['name', 'date', 'type', 'path'];
    const currentIndex = sortOrders.indexOf(this.sortOrder);
    
    if (currentIndex === sortOrders.length - 1) {
      this.sortOrder = sortOrders[0];
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortOrder = sortOrders[currentIndex + 1];
    }
    
    this.filterFiles(document.getElementById('fileSearch')?.value || '');
    
    // Update sort button icon
    const sortBtn = document.getElementById('sortFiles');
    if (sortBtn) {
      const icon = sortBtn.querySelector('i');
      if (icon) {
        icon.className = `fa-solid fa-sort-${this.sortOrder === 'name' ? 'alpha' : 
          this.sortOrder === 'date' ? 'numeric' : 'amount'}-${this.sortDirection === 'asc' ? 'up' : 'down'}`;
      }
    }
    
    this.showNotification(`Sorted by ${this.sortOrder} (${this.sortDirection})`, 'info');
  }
  
  expandAll() {
    // Implementation for expanding all file details if needed
    this.showNotification('All items expanded', 'info');
  }
  
  collapseAll() {
    // Implementation for collapsing all file details if needed
    this.showNotification('All items collapsed', 'info');
  }
  
  renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    
    if (this.filteredFiles.length === 0) {
      fileList.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-inbox"></i>
          <p>No files ${this.importedFiles.length > 0 ? 'match your search' : 'imported yet'}</p>
          <p class="empty-subtitle">${this.importedFiles.length > 0 ? 'Try a different search term' : 'Start by dropping files or clicking "Browse Files"'}</p>
        </div>
      `;
      return;
    }
    
    const fileItems = this.filteredFiles.map(file => this.createFileItem(file)).join('');
    fileList.innerHTML = fileItems;
    
    // Update file count
    const fileCount = document.getElementById('fileCount');
    if (fileCount) {
      fileCount.textContent = `(${this.filteredFiles.length})`;
    }
  }
  
  createFileItem(file) {
    const icon = this.getFileIcon(file.extension);
    const relativeTime = this.getRelativeTime(file.dateAdded);
    
    return `
      <div class="file-item" data-file-id="${file.id}">
        <i class="file-icon ${icon}"></i>
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-path" title="${file.path}">${file.path}</div>
        </div>
        <div class="file-actions">
          <button class="file-action-btn" onclick="importModal.copyPath('${file.path}')" title="Copy Path">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button class="file-action-btn" onclick="importModal.showInExplorer('${file.path}')" title="Show in Explorer">
            <i class="fa-solid fa-folder-open"></i>
          </button>
          <button class="file-action-btn danger" onclick="importModal.removeFile('${file.id}')" title="Remove">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }
  
  getFileIcon(extension) {
    const ext = extension.toLowerCase();
    const iconMap = {
      // Code files
      'js': 'fa-brands fa-js',
      'ts': 'fa-solid fa-code',
      'jsx': 'fa-brands fa-react',
      'tsx': 'fa-brands fa-react',
      'html': 'fa-brands fa-html5',
      'css': 'fa-brands fa-css3-alt',
      'scss': 'fa-brands fa-sass',
      'less': 'fa-brands fa-less',
      'php': 'fa-brands fa-php',
      'py': 'fa-brands fa-python',
      'java': 'fa-brands fa-java',
      'cpp': 'fa-solid fa-code',
      'c': 'fa-solid fa-code',
      'cs': 'fa-solid fa-code',
      'go': 'fa-solid fa-code',
      'rs': 'fa-solid fa-code',
      'rb': 'fa-solid fa-gem',
      
      // Documents
      'pdf': 'fa-solid fa-file-pdf',
      'doc': 'fa-solid fa-file-word',
      'docx': 'fa-solid fa-file-word',
      'xls': 'fa-solid fa-file-excel',
      'xlsx': 'fa-solid fa-file-excel',
      'ppt': 'fa-solid fa-file-powerpoint',
      'pptx': 'fa-solid fa-file-powerpoint',
      'txt': 'fa-solid fa-file-text',
      'md': 'fa-brands fa-markdown',
      'json': 'fa-solid fa-file-code',
      'xml': 'fa-solid fa-file-code',
      'yaml': 'fa-solid fa-file-code',
      'yml': 'fa-solid fa-file-code',
      
      // Images
      'jpg': 'fa-solid fa-file-image',
      'jpeg': 'fa-solid fa-file-image',
      'png': 'fa-solid fa-file-image',
      'gif': 'fa-solid fa-file-image',
      'svg': 'fa-solid fa-file-image',
      'webp': 'fa-solid fa-file-image',
      'bmp': 'fa-solid fa-file-image',
      'ico': 'fa-solid fa-file-image',
      
      // Audio
      'mp3': 'fa-solid fa-file-audio',
      'wav': 'fa-solid fa-file-audio',
      'flac': 'fa-solid fa-file-audio',
      'aac': 'fa-solid fa-file-audio',
      'ogg': 'fa-solid fa-file-audio',
      
      // Video
      'mp4': 'fa-solid fa-file-video',
      'avi': 'fa-solid fa-file-video',
      'mkv': 'fa-solid fa-file-video',
      'mov': 'fa-solid fa-file-video',
      'wmv': 'fa-solid fa-file-video',
      'webm': 'fa-solid fa-file-video',
      
      // Archives
      'zip': 'fa-solid fa-file-zipper',
      'rar': 'fa-solid fa-file-zipper',
      '7z': 'fa-solid fa-file-zipper',
      'tar': 'fa-solid fa-file-zipper',
      'gz': 'fa-solid fa-file-zipper',
      
      // Executables
      'exe': 'fa-solid fa-gear',
      'msi': 'fa-solid fa-gear',
      'deb': 'fa-solid fa-gear',
      'rpm': 'fa-solid fa-gear',
      'dmg': 'fa-solid fa-gear'
    };
    
    return iconMap[ext] || 'fa-solid fa-file';
  }
  
  async copyPath(filePath) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(filePath);
        this.showNotification('Path copied to clipboard', 'success');
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = filePath;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.showNotification('Path copied to clipboard', 'success');
      }
    } catch (error) {
      console.error('Failed to copy path:', error);
      this.showNotification('Failed to copy path', 'error');
    }
  }
  
  async showInExplorer(filePath) {
    if (!window.electronAPI) {
      this.showNotification('Feature not available in browser', 'warning');
      return;
    }
    
    try {
      await window.electronAPI.showItemInFolder(filePath);
    } catch (error) {
      console.error('Failed to show in explorer:', error);
      this.showNotification('Failed to show in explorer', 'error');
    }
  }
  
  updateStatistics() {
    const totalFiles = document.getElementById('totalFiles');
    const uniqueDirs = document.getElementById('uniqueDirs');
    const fileTypes = document.getElementById('fileTypes');
    
    if (totalFiles) totalFiles.textContent = this.importedFiles.length;
    
    if (uniqueDirs) {
      const dirs = new Set(this.importedFiles.map(file => file.directory));
      uniqueDirs.textContent = dirs.size;
    }
    
    if (fileTypes) {
      const types = new Set(this.importedFiles.map(file => file.extension));
      fileTypes.textContent = types.size;
    }
  }
  
  async saveConfiguration() {
    try {
      const projectPath = await this.getProjectPath();
      const importFilePath = window.electronAPI ? 
        await window.electronAPI.joinPath(projectPath, 'importConfig.json') :
        './importConfig.json';
      
      const config = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        totalFiles: this.importedFiles.length,
        files: this.importedFiles.map(file => ({
          id: file.id,
          path: file.path,
          name: file.name,
          extension: file.extension,
          directory: file.directory,
          dateAdded: file.dateAdded,
          size: file.size
        })),
        settings: {
          sortOrder: this.sortOrder,
          sortDirection: this.sortDirection
        }
      };
      
      if (window.electronAPI) {
        await window.electronAPI.writeFile(importFilePath, JSON.stringify(config, null, 2));
        this.showNotification('Configuration saved', 'success');
      } else {
        // Browser fallback - save to localStorage
        localStorage.setItem('importConfig', JSON.stringify(config));
        this.showNotification('Configuration saved to browser storage', 'success');
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      this.showNotification('Failed to save configuration', 'error');
    }
  }
  
  async loadImportedFiles() {
    try {
      let config = null;
      
      if (window.electronAPI) {
        const projectPath = await this.getProjectPath();
        const importFilePath = await window.electronAPI.joinPath(projectPath, 'importConfig.json');
        
        try {
          const configData = await window.electronAPI.readFile(importFilePath, 'utf8');
          config = JSON.parse(configData);
        } catch (error) {
          // File doesn't exist yet, which is fine
          console.log('No existing import config found');
        }
      } else {
        // Browser fallback
        const configData = localStorage.getItem('importConfig');
        if (configData) {
          config = JSON.parse(configData);
        }
      }
      
      if (config && config.files) {
        this.importedFiles = config.files;
        if (config.settings) {
          this.sortOrder = config.settings.sortOrder || 'name';
          this.sortDirection = config.settings.sortDirection || 'asc';
        }
        this.filterFiles('');
        this.updateStatistics();
      }
    } catch (error) {
      console.error('Failed to load import configuration:', error);
    }
  }
  
  async exportFileList() {
    try {
      const exportData = {
        exportDate: new Date().toISOString(),
        totalFiles: this.importedFiles.length,
        files: this.importedFiles.map(file => ({
          name: file.name,
          path: file.path,
          extension: file.extension,
          directory: file.directory,
          dateAdded: file.dateAdded
        }))
      };
      
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-list-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showNotification('File list exported', 'success');
    } catch (error) {
      console.error('Failed to export file list:', error);
      this.showNotification('Failed to export file list', 'error');
    }
  }
  
  // Utility functions
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  
  getFileName(path) {
    return path.split(/[\\/]/).pop() || '';
  }
  
  getFileExtension(path) {
    const fileName = this.getFileName(path);
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(lastDot + 1) : '';
  }
  
  getDirectory(path) {
    const parts = path.split(/[\\/]/);
    parts.pop(); // Remove filename
    return parts.join('/') || '/';
  }
  
  getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }
  
  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <i class="fa-solid fa-${type === 'success' ? 'check-circle' : 
          type === 'error' ? 'exclamation-circle' : 
          type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        <span>${message}</span>
      </div>
    `;
    
    // Add styles if not already present
    if (!document.querySelector('#notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        .notification {
          position: fixed;
          top: 20px;
          right: 20px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-4);
          box-shadow: var(--shadow-lg);
          z-index: 10000;
          transform: translateX(100%);
          transition: transform var(--transition-normal);
          max-width: 300px;
        }
        
        .notification.show {
          transform: translateX(0);
        }
        
        .notification-content {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-primary);
        }
        
        .notification-success { border-left: 4px solid var(--success); }
        .notification-error { border-left: 4px solid var(--error); }
        .notification-warning { border-left: 4px solid var(--warning); }
        .notification-info { border-left: 4px solid var(--info); }
        
        .notification-success i { color: var(--success); }
        .notification-error i { color: var(--error); }
        .notification-warning i { color: var(--warning); }
        .notification-info i { color: var(--info); }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => notification.classList.add('show'), 100);
    
    // Auto remove
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// Initialize the import modal system
let importModal;
document.addEventListener('DOMContentLoaded', () => {
  importModal = new ImportModal();
});

// Export for global access
window.importModal = importModal;