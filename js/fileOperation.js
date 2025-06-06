/**
 * fileOperations.js
 * Módulo responsável por operações de arquivo na file tree
 * Inclui: criar, renomear e excluir arquivos e pastas
 */

// Envolve todas as operações de arquivo com manipulação de UI
const FileOperations = (function() {
  // Cache de referências DOM
  let contextMenu = null;
  let currentPath = null;
  let isFolder = false;

  // Para armazenar referência à função refreshFileTree
  let refreshFileTreeFn = null;

  // Inicializador do módulo - configurar todos os event listeners
  function initialize(refreshFunction) {
    refreshFileTreeFn = refreshFunction;
    createContextMenu();
    setupGlobalListeners();
    setupRootContextMenu();
  }

  // Função para obter o caminho do projeto atual
   function getProjectPath() {
    return window.currentProjectPath || '';
  }

  // Função para normalizar caminhos
  function normalizePath(path) {
    if (!path) return '';
    
    const projectPath = getProjectPath().trim();
    
    // Já é um caminho absoluto com o caminho do projeto
    if (path.startsWith(projectPath)) {
      return path;
    }
    
    // Caminho já é absoluto
    if (/^[A-Za-z]:\\/.test(path)) {
      return path;
    }
    
    // Combina o caminho do projeto com o caminho relativo
    let normalized = `${projectPath}\\${path.replace(/^[\/\\]+/, '')}`;
    // Normaliza barras para Windows
    normalized = normalized.replace(/\//g, '\\').replace(/\\+/g, '\\');
    
    return normalized;
  }

  // Função para obter caminho relativo
  function getRelativePath(absolutePath) {
    const projectPath = getProjectPath();
    if (absolutePath && absolutePath.startsWith(projectPath)) {
      // Remove o caminho do projeto e qualquer barra inicial remanescente
      return absolutePath.substring(projectPath.length).replace(/^[\/\\]+/, '');
    }
    return absolutePath || '';
  }

  // Cria o menu de contexto
  function createContextMenu() {
    if (contextMenu) return;
    
    // Criar elemento do menu de contexto se ainda não existir
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.id = 'file-context-menu';
    contextMenu.innerHTML = `
      <ul>
        <li id="context-new-file"><i class="fa-regular fa-file"></i> New File</li>
        <li id="context-new-folder"><i class="fa-regular fa-folder"></i> New Folder</li>
        <li class="context-separator"></li>
        <li id="context-rename"><i class="fa-solid fa-i-cursor"></i> Rename</li>
        <li id="context-location"><i class="fa-solid fa-location-crosshairs"></i> Location</li>
        <li id="context-delete" class="context-danger"><i class="fa-regular fa-trash-can"></i> Delete</li>
      </ul>
    `;
    document.body.appendChild(contextMenu);
    
    // Estilizar o menu de contexto
    const style = document.createElement('style');
    style.textContent = `
      .context-menu {
        position: fixed;
        z-index: 1000;
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        box-shadow: var(--shadow-md);
        min-width: 180px;
        animation: fadeIn 0.15s ease;
        display: none;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .context-menu ul {
        list-style: none;
        margin: 0;
        padding: 4px 0;
      }
      
      .context-menu li {
        padding: 8px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        color: var(--text-primary);
        font-size: 14px;
      }
      
      .context-menu li:hover {
        background-color: var(--bg-hover);
      }
      
      .context-menu li i {
        margin-right: 8px;
        width: 16px;
        text-align: center;
        color: var(--icon-secondary);
      }
      
      .context-separator {
        height: 1px;
        background-color: var(--border-primary);
        margin: 4px 0;
        padding: 0 !important;
        pointer-events: none;
      }
      
      .context-danger {
        color: var(--error) !important;
      }
      
      .context-danger i {
        color: var(--error) !important;
      }
      
      .file-input-container {
        display: flex;
        padding: 4px;
        margin: 2px 0;
      }
      
      .file-input {
        background-color: var(--bg-tertiary);
        border: 1px solid var(--accent-primary);
        border-radius: 4px;
        color: var(--text-primary);
        padding: 4px 8px;
        font-size: 13px;
        font-family: var(--font-sans);
        width: 100%;
        outline: none;
      }
      
      .file-input:focus {
        box-shadow: 0 0 0 2px var(--accent-primary);
      }
      
      .file-tree-item.editing {
        background-color: var(--bg-hover);
      }
    `;
    document.head.appendChild(style);
    
    // Configurar handlers de eventos para os itens do menu
    document.getElementById('context-new-file').addEventListener('click', () => handleNewFile());
    document.getElementById('context-new-folder').addEventListener('click', () => handleNewFolder());
    document.getElementById('context-rename').addEventListener('click', () => handleRename());
    document.getElementById('context-location').addEventListener('click', () => handleLocation());
    document.getElementById('context-delete').addEventListener('click', () => handleDelete());
  }
  
  // Configurar listeners globais
  function setupGlobalListeners() {
    // Fechar menu de contexto ao clicar fora dele
    document.addEventListener('click', (e) => {
      if (contextMenu && !contextMenu.contains(e.target) && 
          e.target.id !== 'file-context-menu') {
        hideContextMenu();
      }
    });
    
    // Observador para o elemento file-tree (pode ser adicionado depois)
    const observer = new MutationObserver(() => {
      attachRightClickListeners();
    });
    
    // Iniciar observação quando file-tree estiver disponível
    function startObservingFileTree() {
      const fileTree = document.getElementById('file-tree');
      if (fileTree) {
        observer.observe(fileTree, { childList: true, subtree: true });
        attachRightClickListeners();
      } else {
        setTimeout(startObservingFileTree, 500);
      }
    }
    
    // Iniciar observação
    startObservingFileTree();
    
    // Listener para tecla Escape para fechar menu
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideContextMenu();
      }
    });
  }
  
  // Adicionar listeners de contexto aos itens da file tree
  function attachRightClickListeners() {
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach(item => {
      // Remover listeners antigos para evitar duplicatas
      item.removeEventListener('contextmenu', handleContextMenu);
      // Adicionar novo listener
      item.addEventListener('contextmenu', handleContextMenu);
    });
  }
  
  // Handler para o menu de contexto
  function handleContextMenu(e) {
    e.preventDefault();
    
    // Determinar o tipo (arquivo ou pasta) e o caminho
    const fileItem = e.currentTarget;
    const fileTreeItem = fileItem.closest('.file-tree-item');
    
    // Verificar se é uma pasta olhando para o ícone
    const iconElement = fileItem.querySelector('i.file-item-icon');
    isFolder = iconElement && (
      iconElement.classList.contains('fa-folder') || 
      iconElement.classList.contains('fa-folder-open')
    );
    
    // Obter o caminho
    if (fileTreeItem.hasAttribute('data-path')) {
      currentPath = fileTreeItem.getAttribute('data-path');
    } else {
      // Se não tiver data-path, tente construir a partir dos elementos pai
      let path = fileItem.querySelector('span').textContent;
      let parent = fileTreeItem.parentElement;
      
      while (parent && parent.classList.contains('folder-content')) {
        const parentItem = parent.previousElementSibling;
        if (parentItem && parentItem.classList.contains('file-item')) {
          const parentName = parentItem.querySelector('span').textContent;
          path = `${parentName}\\${path}`;
        }
        parent = parent.parentElement;
      }
      
      currentPath = path;
    }
    
    // Assegurar que o caminho seja absoluto
    currentPath = normalizePath(currentPath);
    console.log(`Menu de contexto para: ${currentPath} (${isFolder ? 'pasta' : 'arquivo'})`);
    
    // Exibir o menu de contexto
    showContextMenu(e.clientX, e.clientY);
  }
  
  // Exibir o menu de contexto na posição especificada
  function showContextMenu(x, y) {
    if (!contextMenu) return;
    
    // Posicionar o menu
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
    
    // Ajustar posição se estiver fora da tela
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = `${window.innerHeight - rect.height - 5}px`;
    }
  }
  
  // Esconder o menu de contexto
  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.style.display = 'none';
    }
  }
  
async function handleNewFile() {
  hideContextMenu();
  hideRootContextMenu();

  let targetPath = currentPath || getProjectPath();
  console.log(`Creating new file - Target path: ${targetPath}`);

  try {
    // Validate and normalize the target path
    targetPath = normalizePath(targetPath);
    
    // Check if target exists and determine if it's a directory
    let isTargetDirectory = false;
    try {
      isTargetDirectory = await window.electronAPI.isDirectory(targetPath);
    } catch (error) {
      console.warn('Could not determine if target is directory:', error);
      // Assume it's a file and get parent directory
      targetPath = await window.electronAPI.getParentDirectory(targetPath);
      isTargetDirectory = true;
    }

    // If target is not a directory, get its parent
    if (!isTargetDirectory) {
      targetPath = await window.electronAPI.getParentDirectory(targetPath);
    }

    console.log(`Final target directory: ${targetPath}`);

    // Handle root-level creation
    const fileTree = document.getElementById('file-tree');
    const projectPath = getProjectPath();
    
    if (targetPath === projectPath) {
      return await createFileAtRoot(fileTree, targetPath);
    }

    // Handle subfolder creation
    return await createFileInFolder(targetPath);

  } catch (error) {
    console.error('Error in handleNewFile:', error);
    showNotification(`Error creating file: ${error.message}`, 'error');
  }
}

// Robust Drag and Drop functionality with proper path construction

const DragDropHandler = (function() {
  let dragCounter = 0;
  let currentDropTarget = null;

  function initialize() {
    setupFileTreeDropZone();
    setupFolderDropZones();
  }

  function setupFileTreeDropZone() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) {
      setTimeout(setupFileTreeDropZone, 500);
      return;
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      fileTree.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      fileTree.addEventListener(eventName, handleDragEnter, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      fileTree.addEventListener(eventName, handleDragLeave, false);
    });

    fileTree.addEventListener('drop', handleDrop, false);
  }

  function setupFolderDropZones() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;

    fileTree.addEventListener('dragenter', handleFolderDragEnter);
    fileTree.addEventListener('dragleave', handleFolderDragLeave);
    fileTree.addEventListener('dragover', handleFolderDragOver);
    fileTree.addEventListener('drop', handleFolderDrop);
  }

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragEnter(e) {
    dragCounter++;
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if (item.kind === 'file') {
        e.currentTarget.classList.add('drag-over');
      }
    }
  }

  function handleDragLeave(e) {
    dragCounter--;
    
    if (dragCounter === 0) {
      e.currentTarget.classList.remove('drag-over');
      clearFolderHighlight();
    }
  }

  function handleFolderDragEnter(e) {
    const folderItem = e.target.closest('.file-tree-item');
    if (folderItem && isFolderElement(folderItem)) {
      clearFolderHighlight();
      currentDropTarget = folderItem;
      folderItem.classList.add('drop-target');
    }
  }

  function handleFolderDragLeave(e) {
    const folderItem = e.target.closest('.file-tree-item');
    if (currentDropTarget && (!folderItem || folderItem !== currentDropTarget)) {
      clearFolderHighlight();
    }
  }

  function handleFolderDragOver(e) {
    const folderItem = e.target.closest('.file-tree-item');
    if (folderItem && isFolderElement(folderItem)) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleFolderDrop(e) {
    const folderItem = e.target.closest('.file-tree-item');
    if (folderItem && isFolderElement(folderItem)) {
      handleDrop(e, folderItem);
    }
  }

  function clearFolderHighlight() {
    if (currentDropTarget) {
      currentDropTarget.classList.remove('drop-target');
      currentDropTarget = null;
    }
  }

  function isFolderElement(element) {
    const iconElement = element.querySelector('i.file-item-icon');
    return iconElement && (
      iconElement.classList.contains('fa-folder') || 
      iconElement.classList.contains('fa-folder-open')
    );
  }

  async function handleDrop(e, targetFolder = null) {
  const fileTree = document.getElementById('file-tree');
  fileTree.classList.remove('drag-over');
  clearFolderHighlight();
  dragCounter = 0;

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  console.log('=== Starting Drop Operation ===');
  console.log('Files to drop:', files.map(f => f.name));
  console.log('Current window.currentProjectPath:', window.currentProjectPath);
  console.log('Current window.currentSpfPath:', window.currentSpfPath);
    let targetPath;
    try {
      targetPath = await determineTargetPath(targetFolder);
      console.log(`Target path determined: ${targetPath}`);

      // Validate the target path
      const pathInfo = await window.electronAPI.validatePath(targetPath);
      if (!pathInfo.exists) {
        // Try to create the directory
        await window.electronAPI.ensureDir(targetPath);
        console.log(`Created directory: ${targetPath}`);
      } else if (!pathInfo.isDirectory) {
        throw new Error(`Target is not a directory: ${targetPath}`);
      }

    } catch (error) {
      console.error('Error determining target path:', error);
      showNotification(`Error: ${error.message}`, 'error');
      return;
    }

    // Show progress notification
    const notification = showNotification(
      `Copying ${files.length} file(s) to ${getDisplayPath(targetPath)}...`, 
      'info', 
      15000
    );

    try {
      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      for (const file of files) {
        try {
          await copyFileToTarget(file, targetPath);
          successCount++;
          console.log(`Successfully copied: ${file.name}`);
        } catch (error) {
          errorCount++;
          errors.push(`${file.name}: ${error.message}`);
          console.error(`Error copying ${file.name}:`, error);
        }
      }

      notification.close();

      // Show result notification
      if (errorCount === 0) {
        showNotification(
          `Successfully copied ${successCount} file(s)`, 
          'success'
        );
      } else if (successCount > 0) {
        showNotification(
          `Copied ${successCount} file(s), ${errorCount} failed. First error: ${errors[0]}`, 
          'warning',
          5000
        );
      } else {
        showNotification(
          `Failed to copy files. Error: ${errors[0]}`, 
          'error',
          5000
        );
      }

      // Refresh file tree
      if (typeof refreshFileTreeFn === 'function') {
        setTimeout(async () => {
          try {
            await refreshFileTreeFn();
          } catch (refreshError) {
            console.error('Error refreshing file tree:', refreshError);
          }
        }, 500);
      }

    } catch (error) {
      notification.close();
      console.error('Error in drop handler:', error);
      showNotification(`Error copying files: ${error.message}`, 'error');
    }
  }

 async function determineTargetPath(targetFolder) {
  console.log('=== Determining Target Path ===');
  
  const projectPath = await getProjectPath();
  console.log('Project path result:', projectPath);
  
  if (!projectPath) {
    throw new Error('No project path is set. Please open a project first.');
  }

  // If no specific folder target, use project root
  if (!targetFolder) {
    console.log('Using project root as target:', projectPath);
    return projectPath;
  }

  // Get the full path for the target folder
  const fullPath = await buildFullPathFromElement(targetFolder, projectPath);
  console.log('Built full path:', fullPath);
  
  return fullPath;
}

  async function buildFullPathFromElement(element, projectPath) {
    // First, try to get data-path attribute if it exists
    if (element.hasAttribute('data-path')) {
      const dataPath = element.getAttribute('data-path');
      console.log(`Found data-path: ${dataPath}`);
      
      // If it's already a full path, use it
      if (isAbsolutePath(dataPath)) {
        return normalizePath(dataPath);
      }
      
      // Otherwise, combine with project path
      return normalizePath(joinPaths(projectPath, dataPath));
    }

    // Build path from DOM structure
    const pathParts = [];
    let current = element;

    // Get the folder name from the current element
    const folderNameSpan = current.querySelector('.file-item span');
    if (folderNameSpan) {
      const folderName = folderNameSpan.textContent.trim();
      console.log(`Current folder name: ${folderName}`);
      
      // Skip "TopLevel" as it's just a display name for the root
      if (folderName !== 'TopLevel') {
        pathParts.unshift(folderName);
      }
    }

    // Walk up the DOM tree to build the full path
    while (current) {
      const parentContainer = current.parentElement;
      
      if (parentContainer && parentContainer.classList.contains('folder-content')) {
        // Find the parent folder item
        const parentFolderItem = parentContainer.previousElementSibling;
        
        if (parentFolderItem && parentFolderItem.classList.contains('file-item')) {
          const parentSpan = parentFolderItem.querySelector('span');
          if (parentSpan) {
            const parentName = parentSpan.textContent.trim();
            console.log(`Parent folder name: ${parentName}`);
            
            // Skip "TopLevel" as it represents the project root
            if (parentName !== 'TopLevel') {
              pathParts.unshift(parentName);
            }
          }
        }
        
        // Move to the parent folder item's container
        current = parentContainer.closest('.file-tree-item');
      } else {
        break;
      }
    }

    console.log(`Path parts: [${pathParts.join(', ')}]`);

    // Build the final path
    let fullPath;
    if (pathParts.length === 0) {
      // This is the project root
      fullPath = projectPath;
    } else {
      // Combine project path with the relative path
      fullPath = pathParts.reduce((path, part) => joinPaths(path, part), projectPath);
    }

    return normalizePath(fullPath);
  }

  function isAbsolutePath(path) {
    // Windows: C:\ or D:\ etc.
    if (/^[A-Za-z]:[\\\/]/.test(path)) return true;
    
    // Unix-like: /
    if (path.startsWith('/')) return true;
    
    return false;
  }

  function joinPaths(...parts) {
    if (parts.length === 0) return '';
    
    let result = parts[0] || '';
    
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      
      // Remove leading slashes/backslashes from the part
      const cleanPart = part.replace(/^[\\\/]+/, '');
      
      // Add separator if needed
      if (result && !result.endsWith('\\') && !result.endsWith('/')) {
        // Use the same separator as the base path, or default to backslash on Windows
        const separator = result.includes('\\') ? '\\' : '/';
        result += separator;
      }
      
      result += cleanPart;
    }
    
    return result;
  }

  function normalizePath(path) {
    if (!path) return '';
    
    // Convert forward slashes to backslashes on Windows-style paths
    if (/^[A-Za-z]:/.test(path)) {
      path = path.replace(/\//g, '\\');
    }
    
    // Remove duplicate separators
    path = path.replace(/[\\\/]+/g, path.includes('\\') ? '\\' : '/');
    
    // Remove trailing separator (except for root)
    if (path.length > 1 && (path.endsWith('\\') || path.endsWith('/'))) {
      path = path.slice(0, -1);
    }
    
    return path;
  }

  async function copyFileToTarget(file, targetDirectory) {
    const destinationPath = joinPaths(targetDirectory, file.name);
    console.log(`Copying ${file.name} to ${destinationPath}`);

    try {
      // Check if file already exists
      const fileExists = await window.electronAPI.fileExists(destinationPath);
      if (fileExists) {
        const overwrite = await window.electronAPI.showConfirmDialog(
          'File Exists',
          `File "${file.name}" already exists in the target directory. Do you want to overwrite it?`
        );
        
        if (!overwrite) {
          throw new Error('User chose not to overwrite existing file');
        }
      }

      // Ensure target directory exists
      await window.electronAPI.ensureDir(targetDirectory);

      // Read file content
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Write file
      await window.electronAPI.writeFile(destinationPath, uint8Array);
      
      console.log(`File copied successfully: ${destinationPath}`);
      
    } catch (error) {
      console.error(`Failed to copy ${file.name}:`, error);
      throw new Error(`Failed to copy ${file.name}: ${error.message}`);
    }
  }

  function getProjectPath() {
    return window.currentProjectPath || '';
  }

  function getDisplayPath(fullPath) {
    const projectPath = getProjectPath();
    if (!projectPath || !fullPath.startsWith(projectPath)) {
      return fullPath;
    }
    
    const relativePath = fullPath.substring(projectPath.length).replace(/^[\\\/]/, '');
    return relativePath || 'Project Root';
  }

  function showNotification(message, type = 'info', duration = 3000) {
    if (typeof window.showNotification === 'function') {
      return window.showNotification(message, type, duration);
    }
    
    // Fallback notification
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Create a simple visual notification if no notification system exists
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#2196f3'};
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
      max-width: 400px;
      word-wrap: break-word;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    const closeNotification = () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    };
    
    if (duration > 0) {
      setTimeout(closeNotification, duration);
    }
    
    return { close: closeNotification };
  }

  // Public API
  return {
    initialize,
    // Expose for debugging
    determineTargetPath,
    buildFullPathFromElement
  };
})();

// CSS styles for drag and drop visual feedback
const dragDropStyles = `
  .file-tree.drag-over {
    background-color: var(--bg-hover, #f0f0f0);
    border: 2px dashed var(--accent-primary, #007acc);
    border-radius: var(--radius-md, 8px);
    transition: all 0.2s ease;
  }
  
  .file-tree-item.drop-target {
    background-color: var(--bg-hover, #f0f0f0);
    border-radius: var(--radius-sm, 4px);
    transition: all 0.2s ease;
  }
  
  .file-tree-item.drop-target > .file-item {
    background-color: var(--accent-primary, #007acc);
    color: var(--text-inverse, white);
    border-radius: var(--radius-sm, 4px);
  }
`;

// Add styles and initialize
function addDragDropStyles() {
  if (document.getElementById('drag-drop-styles')) return;
  
  const styleElement = document.createElement('style');
  styleElement.id = 'drag-drop-styles';
  styleElement.textContent = dragDropStyles;
  document.head.appendChild(styleElement);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    addDragDropStyles();
    DragDropHandler.initialize();
  });
} else {
  addDragDropStyles();
  DragDropHandler.initialize();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DragDropHandler;
}

// Make available globally for debugging
window.DragDropHandler = DragDropHandler;


// Listen for project path updates
if (window.electronAPI && window.electronAPI.onProjectPathUpdated) {
  window.electronAPI.onProjectPathUpdated((data) => {
    window.currentProjectPath = data.projectPath;
    window.currentSpfPath = data.spfPath;
    console.log('Project path updated:', data.projectPath);
  });
}


async function createFileAtRoot(fileTree, targetPath) {
  const inputContainer = createInputContainer('filename.ext');
  fileTree.prepend(inputContainer);
  
  const input = inputContainer.querySelector('.file-input');
  input.focus();

  return new Promise((resolve) => {
    setupFileCreationHandlers(input, targetPath, inputContainer, fileTree, resolve);
  });
}

async function createFileInFolder(targetPath) {
  const targetElement = findElementByPath(targetPath);
  if (!targetElement) {
    throw new Error(`Could not find target folder element for: ${getRelativePath(targetPath)}`);
  }

  // Ensure folder is expanded
  const folderToggle = targetElement.querySelector('.folder-toggle');
  if (folderToggle && !targetElement.classList.contains('expanded')) {
    folderToggle.click();
    // Wait for expansion animation
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  let folderContent = targetElement.querySelector('.folder-content');
  if (!folderContent) {
    // Create folder content if it doesn't exist
    folderContent = document.createElement('div');
    folderContent.className = 'folder-content';
    targetElement.appendChild(folderContent);
  }

  const inputContainer = createInputContainer('filename.ext');
  folderContent.prepend(inputContainer);
  
  const input = inputContainer.querySelector('.file-input');
  input.focus();

  return new Promise((resolve) => {
    setupFileCreationHandlers(input, targetPath, inputContainer, folderContent, resolve);
  });
}

function createInputContainer(placeholder) {
  const inputContainer = document.createElement('div');
  inputContainer.className = 'file-input-container';
  
  const input = document.createElement('input');
  input.className = 'file-input';
  input.type = 'text';
  input.placeholder = placeholder;
  
  inputContainer.appendChild(input);
  return inputContainer;
}

function setupFileCreationHandlers(input, targetPath, inputContainer, parentElement, resolve) {
  let isProcessing = false;

  const handleCreate = async () => {
    if (isProcessing || !input.isConnected) return;
    isProcessing = true;

    const fileName = input.value.trim();
    
    try {
      if (!fileName) {
        return; // Just remove input without showing error
      }

      // Validate filename
      if (!isValidFilename(fileName)) {
        throw new Error('Invalid filename. Please avoid special characters.');
      }

      // Build complete file path
      const separator = targetPath.endsWith('\\') ? '' : '\\';
      const newFilePath = `${targetPath}${separator}${fileName}`;
      
      // Check if file already exists
      const fileExists = await window.electronAPI.fileExists(newFilePath);
      if (fileExists) {
        throw new Error(`File "${fileName}" already exists`);
      }

      console.log(`Creating file: ${newFilePath}`);
      await window.electronAPI.createFile(newFilePath);
      
      showNotification(`File "${fileName}" created successfully`, 'success');
      
      // Refresh file tree
      if (typeof refreshFileTreeFn === 'function') {
        await refreshFileTreeFn();
      }
      
      resolve(true);
    } catch (error) {
      console.error('Error creating file:', error);
      showNotification(`Error creating file: ${error.message}`, 'error');
      resolve(false);
    } finally {
      // Always clean up
      if (parentElement.contains(inputContainer)) {
        parentElement.removeChild(inputContainer);
      }
      isProcessing = false;
    }
  };

  // Event listeners
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleCreate();
    } else if (e.key === 'Escape') {
      if (parentElement.contains(inputContainer)) {
        parentElement.removeChild(inputContainer);
      }
      resolve(false);
    }
  });

  input.addEventListener('blur', async () => {
    // Small delay to allow other events to process
    setTimeout(async () => {
      await handleCreate();
    }, 100);
  });
}

// Filename validation helper
function isValidFilename(filename) {
  // Check for invalid characters
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(filename)) {
    return false;
  }
  
  // Check for reserved names (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reservedNames.test(filename)) {
    return false;
  }
  
  // Check length
  if (filename.length > 255) {
    return false;
  }
  
  return true;
}

// Tratar criação de nova pasta
async function handleNewFolder() {
  hideContextMenu();
  hideRootContextMenu();

  let targetPath = currentPath;
  console.log(`Original path for new item: ${targetPath}`);
  const isFolder = await window.electronAPI.isDirectory(targetPath);
  
  // If we're creating at the root level of the file tree
  const fileTree = document.getElementById('file-tree');
  if (targetPath === getProjectPath()) {
    // Create directly in file tree div
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-input-container';
    
    const input = document.createElement('input');
    input.className = 'file-input';
    input.type = 'text';
    input.placeholder = 'folder name';
    
    inputContainer.appendChild(input);
    
    // Insert at top of file tree
    fileTree.prepend(inputContainer);
    input.focus();
    
    // Handler for creating the folder at root level
    const handleCreate = async () => {
      if (!input.isConnected) return;
      
      const folderName = input.value.trim();
      if (!folderName) {
        if (fileTree.contains(inputContainer)) {
          fileTree.removeChild(inputContainer);
        }
        return;
      }
      
      try {
        // Build the complete folder path
        const fileSeparator = targetPath.endsWith('\\') ? '' : '\\';
        const newFolderPath = `${targetPath}${fileSeparator}${folderName}`;
        console.log(`Trying to create folder: ${newFolderPath}`);
        
        await window.electronAPI.createDirectory(newFolderPath);
        showNotification(`Folder "${folderName}" created successfully`, 'success');
        
        // Update the file tree after creation
        if (typeof refreshFileTreeFn === 'function') {
          await refreshFileTreeFn();
        }
      } catch (error) {
        console.error('Error creating folder:', error);
        showNotification(`Error creating folder: ${error.message}`, 'error');
      } finally {
        if (fileTree.contains(inputContainer)) {
          fileTree.removeChild(inputContainer);
        }
      }
    };
    
    // Setup event listeners for root-level creation
    let isProcessing = false;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!isProcessing) {
          isProcessing = true;
          await handleCreate();
          isProcessing = false;
        }
      } else if (e.key === 'Escape') {
        if (fileTree.contains(inputContainer)) {
          fileTree.removeChild(inputContainer);
        }
      }
    });
    
    input.addEventListener('blur', async () => {
      setTimeout(async () => {
        if (!isProcessing) {
          isProcessing = true;
          await handleCreate();
          isProcessing = false;
        }
      }, 100);
    });
    
    return; // Exit after setting up root-level creation
  }
  
  // Handle subfolder creation - get parent directory if current path is a file
  if (!isFolder) {
    try {
      targetPath = await window.electronAPI.getParentDirectory(targetPath);
      console.log(`New path (parent folder): ${targetPath}`);
    } catch (error) {
      console.error('Error getting parent directory:', error);
      showNotification(`Error: Could not determine parent directory`, 'error');
      return;
    }
  }
  
  // Find the target element for the folder where we're creating
  const targetElement = findElementByPath(targetPath);
  if (!targetElement) {
    console.error(`Element not found for: ${targetPath}`);
    showNotification(`Error: Could not find target element for path: ${getRelativePath(targetPath)}`, 'error');
    return;
  }
  
  const folderContent = targetElement.querySelector('.folder-content');
  if (!folderContent) {
    showNotification(`Error: Could not find folder content for path: ${getRelativePath(targetPath)}`, 'error');
    return;
  }
  
  // Create input element
  const inputContainer = document.createElement('div');
  inputContainer.className = 'file-input-container';
  
  const input = document.createElement('input');
  input.className = 'file-input';
  input.type = 'text';
  input.placeholder = 'folder name';
  
  inputContainer.appendChild(input);
  folderContent.prepend(inputContainer);
  
  // Focus on input
  input.focus();
  
  // Handler for creating the folder
  const handleCreate = async () => {
    if (!input.isConnected) return;
    
    const folderName = input.value.trim();
    if (!folderName) {
      if (folderContent.contains(inputContainer)) {
        folderContent.removeChild(inputContainer);
      }
      return;
    }
    
    try {
      // Build the complete folder path
      const fileSeparator = targetPath.endsWith('\\') ? '' : '\\';
      const newFolderPath = `${targetPath}${fileSeparator}${folderName}`;
      
      console.log(`Trying to create folder: ${newFolderPath}`);
      await window.electronAPI.createDirectory(newFolderPath);
      showNotification(`Folder "${folderName}" created successfully`, 'success');
      
      // Update the file tree
      if (typeof refreshFileTreeFn === 'function') {
        await refreshFileTreeFn();
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      showNotification(`Error creating folder: ${error.message}`, 'error');
    } finally {
      if (folderContent.contains(inputContainer)) {
        folderContent.removeChild(inputContainer);
      }
    }
  };
  
  // Flag to avoid repeated processing
  let isProcessing = false;
  
  // Event listeners for the input
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isProcessing) {
        isProcessing = true;
        await handleCreate();
        isProcessing = false;
      }
    } else if (e.key === 'Escape') {
      if (folderContent.contains(inputContainer)) {
        folderContent.removeChild(inputContainer);
      }
    }
  });
  
  input.addEventListener('blur', async () => {
    setTimeout(async () => {
      if (!isProcessing) {
        isProcessing = true;
        await handleCreate();
        isProcessing = false;
      }
    }, 100);
  });
}

// Add this function to hide the root context menu
function hideRootContextMenu() {
  const rootContextMenu = document.getElementById('root-context-menu');
  if (rootContextMenu) {
    rootContextMenu.style.display = 'none';
  }
}

 async function handleRename() {
  hideContextMenu();
  
  if (!currentPath) {
    showNotification('Error: No item selected for renaming', 'error');
    return;
  }

  try {
    // Normalize and validate the current path
    const normalizedPath = normalizePath(currentPath);
    console.log(`Attempting to rename: ${normalizedPath}`);

    // Verify the item exists
    const itemExists = await window.electronAPI.fileExists(normalizedPath);
    if (!itemExists) {
      showNotification('Item no longer exists', 'error');
      if (typeof refreshFileTreeFn === 'function') {
        await refreshFileTreeFn();
      }
      return;
    }

    // Find the DOM element
    const element = findElementByPath(normalizedPath);
    if (!element) {
      showNotification(`Could not find UI element for: ${getRelativePath(normalizedPath)}`, 'error');
      return;
    }

    const fileItem = element.querySelector('.file-item');
    const nameSpan = fileItem?.querySelector('span');
    
    if (!fileItem || !nameSpan) {
      showNotification('Could not find name element to edit', 'error');
      return;
    }

    // Start rename process
    await startRenameProcess(element, fileItem, nameSpan, normalizedPath);

  } catch (error) {
    console.error('Error in rename handler:', error);
    showNotification(`Rename operation failed: ${error.message}`, 'error');
  }
}

async function startRenameProcess(element, fileItem, nameSpan, currentPath) {
  const originalName = nameSpan.textContent;
  const isDirectory = await window.electronAPI.isDirectory(currentPath);
  
  // Add editing class
  element.classList.add('editing');
  
  // Create input element
  const input = document.createElement('input');
  input.className = 'file-input';
  input.value = originalName;
  input.style.width = '100%';
  
  // Replace span with input
  const spanParent = nameSpan.parentElement;
  spanParent.replaceChild(input, nameSpan);
  
  // Focus and select appropriate part of filename
  input.focus();
  if (!isDirectory && originalName.includes('.')) {
    // For files, select name without extension
    const lastDotIndex = originalName.lastIndexOf('.');
    input.setSelectionRange(0, lastDotIndex);
  } else {
    // For directories or files without extensions, select all
    input.select();
  }
  
  // Setup completion handler
  let isCompleted = false;
  
  const completeRename = async () => {
    if (isCompleted || !input.isConnected) return;
    isCompleted = true;
    
    const newName = input.value.trim();
    
    // Always restore the UI first
    try {
      if (spanParent.contains(input)) {
        spanParent.replaceChild(nameSpan, input);
      }
      element.classList.remove('editing');
    } catch (restoreError) {
      console.error('Error restoring UI:', restoreError);
    }
    
    // Check if name actually changed
    if (!newName || newName === originalName) {
      console.log('Rename cancelled - no change in name');
      return;
    }
    
    // Validate new name
    if (!isValidFilename(newName)) {
      showNotification('Invalid filename. Please avoid special characters.', 'error');
      return;
    }
    
    try {
      await performRename(currentPath, newName, originalName);
    } catch (error) {
      console.error('Rename operation failed:', error);
      showNotification(`Failed to rename: ${error.message}`, 'error');
    }
  };
  
  // Event listeners
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      completeRename();
    } else if (e.key === 'Escape') {
      isCompleted = true;
      try {
        if (spanParent.contains(input)) {
          spanParent.replaceChild(nameSpan, input);
        }
        element.classList.remove('editing');
      } catch (error) {
        console.error('Error cancelling rename:', error);
      }
    }
  });
  
  input.addEventListener('blur', () => {
    setTimeout(() => completeRename(), 50);
  });
}

async function performRename(currentPath, newName, originalName) {
  try {
    // Get parent directory
    const parentDir = await window.electronAPI.getParentDirectory(currentPath);
    const separator = parentDir.endsWith('\\') ? '' : '\\';
    const newPath = `${parentDir}${separator}${newName}`;
    
    console.log(`Renaming from "${currentPath}" to "${newPath}"`);
    
    // Check if destination already exists
    const destinationExists = await window.electronAPI.fileExists(newPath);
    if (destinationExists) {
      throw new Error(`An item named "${newName}" already exists in this location`);
    }
    
    // Perform rename with timeout protection
    const renamePromise = window.electronAPI.renameFileOrDirectory(currentPath, newPath);
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ timeout: true }), 5000);
    });
    
    const result = await Promise.race([renamePromise, timeoutPromise]);
    
    if (result && result.timeout) {
      console.warn('Rename operation timed out, but may have succeeded');
      showNotification(`Renamed to "${newName}" (operation was slow)`, 'warning');
    } else {
      showNotification(`Successfully renamed to "${newName}"`, 'success');
    }
    
  } catch (error) {
    // Check if the rename actually succeeded despite the error
    const parentDir = await window.electronAPI.getParentDirectory(currentPath);
    const separator = parentDir.endsWith('\\') ? '' : '\\';
    const newPath = `${parentDir}${separator}${newName}`;
    
    const newPathExists = await window.electronAPI.fileExists(newPath).catch(() => false);
    const oldPathExists = await window.electronAPI.fileExists(currentPath).catch(() => true);
    
    if (newPathExists && !oldPathExists) {
      // Rename succeeded despite error
      console.warn('Rename succeeded but with communication error:', error);
      showNotification(`Renamed to "${newName}" (with warnings)`, 'warning');
    } else {
      // Rename truly failed
      throw error;
    }
  } finally {
    // Always refresh the file tree
    if (typeof refreshFileTreeFn === 'function') {
      try {
        await refreshFileTreeFn();
      } catch (refreshError) {
        console.error('Error refreshing file tree:', refreshError);
      }
    }
  }
}

 async function handleLocation() {
  hideContextMenu();
  
  if (!currentPath) {
    showNotification('Error: No item selected', 'error');
    return;
  }

  try {
    const normalizedPath = normalizePath(currentPath);
    console.log(`Opening location for: ${normalizedPath}`);
    
    // Verify the path exists
    const pathExists = await window.electronAPI.fileExists(normalizedPath);
    if (!pathExists) {
      showNotification('The selected item no longer exists', 'error');
      // Refresh file tree to update UI
      if (typeof refreshFileTreeFn === 'function') {
        await refreshFileTreeFn();
      }
      return;
    }
    
    // Determine what folder to open
    let folderToOpen;
    
    try {
      const isDirectory = await window.electronAPI.isDirectory(normalizedPath);
      
      if (isDirectory) {
        // It's a folder - open the folder itself
        folderToOpen = normalizedPath;
      } else {
        // It's a file - open its parent directory
        folderToOpen = await window.electronAPI.getParentDirectory(normalizedPath);
      }
    } catch (error) {
      console.warn('Could not determine if path is directory, assuming it is a file:', error);
      // Fallback: try to get parent directory
      folderToOpen = await window.electronAPI.getParentDirectory(normalizedPath);
    }
    
    console.log(`Opening folder: ${folderToOpen}`);
    
    // Verify the folder to open exists
    const folderExists = await window.electronAPI.fileExists(folderToOpen);
    if (!folderExists) {
      throw new Error(`Parent folder does not exist: ${folderToOpen}`);
    }
    
    // Open the folder
    await window.electronAPI.openFolder(folderToOpen);
    
    // Show success notification
    const itemName = normalizedPath.split(/[\/\\]/).pop();
    showNotification(`Opened location for "${itemName}"`, 'success');
    
  } catch (error) {
    console.error('Error opening location:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Could not open location';
    if (error.message.includes('ENOENT')) {
      errorMessage = 'The file or folder no longer exists';
    } else if (error.message.includes('EACCES')) {
      errorMessage = 'Access denied - insufficient permissions';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    showNotification(`Error: ${errorMessage}`, 'error');
  }
}

  async function handleDelete() {
  hideContextMenu();
  
  if (!currentPath) {
    showNotification('Error: No item selected for deletion', 'error');
    return;
  }

  try {
    // Normalize the path
    const normalizedPath = normalizePath(currentPath);
    console.log(`Attempting to delete: ${normalizedPath}`);

    // Validate path exists before attempting deletion
    let pathExists = false;
    let itemIsDirectory = false;

    try {
      pathExists = await window.electronAPI.fileExists(normalizedPath);
      if (pathExists) {
        itemIsDirectory = await window.electronAPI.isDirectory(normalizedPath);
      }
    } catch (error) {
      console.warn('Error checking file existence:', error);
      // Continue with deletion attempt even if check fails
    }

    if (!pathExists) {
      showNotification('Item no longer exists', 'warning');
      // Still refresh the tree to clean up UI
      if (typeof refreshFileTreeFn === 'function') {
        await refreshFileTreeFn();
      }
      return;
    }

    // Get item name for confirmation dialog
    const itemName = normalizedPath.split(/[\/\\]/).pop();
    const itemType = itemIsDirectory ? 'folder' : 'file';
    
    // Show confirmation dialog
    const confirmMessage = itemIsDirectory
      ? `Are you sure you want to delete the folder "${itemName}" and all its contents? This action cannot be undone.`
      : `Are you sure you want to delete the file "${itemName}"? This action cannot be undone.`;

    const confirmed = await window.electronAPI.showConfirmDialog(
      `Delete ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}`,
      confirmMessage
    );

    if (!confirmed) {
      console.log('Delete operation cancelled by user');
      return;
    }

    // Show loading notification for large operations
    let loadingNotification = null;
    if (itemIsDirectory) {
      loadingNotification = showNotification(`Deleting folder "${itemName}"...`, 'info', 10000);
    }

    try {
      // Perform the deletion with retry logic
      await deleteWithRetry(normalizedPath, 3);
      
      // Close loading notification
      if (loadingNotification) {
        loadingNotification.close();
      }

      showNotification(`"${itemName}" deleted successfully`, 'success');
      console.log(`Successfully deleted: ${normalizedPath}`);

    } catch (deleteError) {
      // Close loading notification
      if (loadingNotification) {
        loadingNotification.close();
      }

      console.error('Delete operation failed:', deleteError);
      
      // Check if item still exists after failed deletion
      const stillExists = await window.electronAPI.fileExists(normalizedPath).catch(() => false);
      
      if (!stillExists) {
        // Item was actually deleted despite the error
        showNotification(`"${itemName}" was deleted (with warnings)`, 'warning');
      } else {
        // Deletion truly failed
        showNotification(`Failed to delete "${itemName}": ${deleteError.message}`, 'error');
        return; // Don't refresh tree if deletion failed
      }
    }

    // Always refresh the file tree after deletion attempt
    if (typeof refreshFileTreeFn === 'function') {
      try {
        await refreshFileTreeFn();
      } catch (refreshError) {
        console.error('Error refreshing file tree after deletion:', refreshError);
        showNotification('File tree refresh failed - please refresh manually', 'warning');
      }
    }

  } catch (error) {
    console.error('Error in delete handler:', error);
    showNotification(`Delete operation failed: ${error.message}`, 'error');
  }
}

// Retry deletion with exponential backoff
async function deleteWithRetry(filePath, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Delete attempt ${attempt}/${maxRetries} for: ${filePath}`);
      
      await window.electronAPI.deleteFileOrDirectory(filePath);
      console.log(`Delete successful on attempt ${attempt}`);
      return; // Success
      
    } catch (error) {
      lastError = error;
      console.warn(`Delete attempt ${attempt} failed:`, error.message);
      
      // If it's the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Check if file still exists before retrying
      const stillExists = await window.electronAPI.fileExists(filePath).catch(() => false);
      if (!stillExists) {
        console.log('File no longer exists - considering deletion successful');
        return;
      }
    }
  }
  
  // All retries failed
  throw lastError;
}

function setupRootContextMenu() {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) {
    setTimeout(setupRootContextMenu, 500);
    return;
  }
  
  fileTree.addEventListener('contextmenu', (e) => {
    // Only trigger if clicked directly on the file tree and not on a file/folder
    if (e.target === fileTree || e.target.classList.contains('file-tree')) {
      e.preventDefault();
      
      // Set the currentPath to the project root
      currentPath = getProjectPath();
      isFolder = true;
      
      // Show context menu with only the new file/folder options
      showRootContextMenu(e.clientX, e.clientY);
    }
  });
}

function createRootContextMenu() {
  const rootContextMenu = document.createElement('div');
  rootContextMenu.className = 'context-menu';
  rootContextMenu.id = 'root-context-menu';
  rootContextMenu.innerHTML = `
    <ul>
      <li id="root-new-file"><i class="fa-regular fa-file"></i> New File</li>
      <li id="root-new-folder"><i class="fa-regular fa-folder"></i> New Folder</li>
    </ul>
  `;
  document.body.appendChild(rootContextMenu);
  
  document.getElementById('root-new-file').addEventListener('click', () => handleNewFile());
  document.getElementById('root-new-folder').addEventListener('click', () => handleNewFolder());
  
  return rootContextMenu;
}

function showRootContextMenu(x, y) {
  // Create the root context menu if it doesn't exist
  let rootContextMenu = document.getElementById('root-context-menu');
  if (!rootContextMenu) {
    rootContextMenu = createRootContextMenu();
  }
  
  // Position the menu
  rootContextMenu.style.left = `${x}px`;
  rootContextMenu.style.top = `${y}px`;
  rootContextMenu.style.display = 'block';
  
  // Adjust position if off screen
  const rect = rootContextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    rootContextMenu.style.left = `${window.innerWidth - rect.width - 5}px`;
  }
  if (rect.bottom > window.innerHeight) {
    rootContextMenu.style.top = `${window.innerHeight - rect.height - 5}px`;
  }
  
  // Close on click outside
  const closeHandler = (e) => {
    if (!rootContextMenu.contains(e.target)) {
      hideRootContextMenu();
      document.removeEventListener('click', closeHandler);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}
  
  // Função auxiliar para encontrar um elemento pelo caminho
  function findElementByPath(path) {
    if (!path) return null;
    
    console.log(`Buscando elemento para caminho: ${path}`);
    
    // Tenta encontrar pelo atributo data-path
    let element = null;
    
    // Seletores para data-path podem ser problemáticos devido a caracteres especiais
    // então vamos usar uma abordagem mais direta
    const allItems = document.querySelectorAll('.file-tree-item');
    
    for (const item of allItems) {
      if (item.hasAttribute('data-path')) {
        const itemPath = item.getAttribute('data-path');
        if (path === itemPath) {
          element = item;
          break;
        }
      }
    }
    
    // Se não encontrou por data-path, tenta pelo nome do arquivo/pasta
    if (!element) {
      const fileName = path.split('\\').pop();
      
      for (const item of allItems) {
        const span = item.querySelector('.file-item span');
        if (span && span.textContent === fileName) {
          const reconstructedPath = getFilePathFromElement(item);
          
          // Verifica se o caminho reconstruído corresponde ao caminho fornecido
          if (path === reconstructedPath || isPathMatchingElement(path, item)) {
            element = item;
            break;
          }
        }
      }
    }
    
    console.log(`Elemento encontrado: ${element ? 'Sim' : 'Não'}`);
    return element;
  }

  // Verifica se um elemento corresponde a um caminho
  function isPathMatchingElement(path, element) {
    const parts = [];
    let current = element;
    
    // Obter o nome do próprio elemento
    const span = current.querySelector('.file-item span');
    if (span) {
      parts.unshift(span.textContent);
    }
    
    // Navegar pelos ancestrais para construir o caminho
    while (current) {
      const parent = current.parentElement;
      
      if (parent && parent.classList.contains('folder-content')) {
        const parentItem = parent.previousElementSibling;
        if (parentItem && parentItem.classList.contains('file-item')) {
          const parentSpan = parentItem.querySelector('span');
          if (parentSpan) {
            parts.unshift(parentSpan.textContent);
          }
        }
      }
      
      current = parent;
    }
    
    const reconstructedPath = parts.join('\\');
    
    // Verificar se o final dos caminhos corresponde
    const pathParts = path.split('\\');
    const reconstructedParts = reconstructedPath.split('\\');
    
    // Se há menos partes no caminho reconstruído
    if (reconstructedParts.length <= pathParts.length) {
      // Verificar se as últimas partes correspondem
      const offset = pathParts.length - reconstructedParts.length;
      return reconstructedParts.every((part, i) => part === pathParts[i + offset]);
    }
    
    return false;
  }
  
  // Função auxiliar para obter o caminho completo de um elemento
  function getFilePathFromElement(element) {
    // Se tiver data-path, normalize-o em relação ao projeto atual
    if (element.hasAttribute('data-path')) {
      return normalizePath(element.getAttribute('data-path'));
    }
    
    // Caso contrário, tente reconstruir o caminho
    const parts = [];
    let current = element;
    
    // Obter o nome do próprio elemento
    const span = current.querySelector('.file-item span');
    if (span) {
      parts.unshift(span.textContent);
    }
    
    // Navegar pelos ancestrais para construir o caminho
    while (current) {
      const parent = current.parentElement;
      
      if (parent && parent.classList.contains('folder-content')) {
        const parentItem = parent.previousElementSibling;
        if (parentItem && parentItem.classList.contains('file-item')) {
          const parentSpan = parentItem.querySelector('span');
          if (parentSpan) {
            parts.unshift(parentSpan.textContent);
          }
        }
      }
      
      current = parent;
    }
    
    // Normalizar o caminho em relação ao projeto atual
    return normalizePath(parts.join('\\'));
  }
  
  function showNotification(message, type = 'info', duration = 3000) {
  // Verificar se a função global já existe
  if (typeof window.showNotification === 'function' && window.showNotification !== showNotification) {
    window.showNotification(message, type, duration);
    return;
  }
  
  // Crie um container para a notificação se não existir
  let notificationContainer = document.getElementById('notification-container');
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notification-container';
    notificationContainer.style.position = 'fixed';
    notificationContainer.style.bottom = '20px';
    notificationContainer.style.right = '20px';
    notificationContainer.style.maxWidth = '100%';
    notificationContainer.style.width = '350px';
    notificationContainer.style.zIndex = 'var(--z-max)';
    notificationContainer.style.display = 'flex';
    notificationContainer.style.flexDirection = 'column';
    notificationContainer.style.gap = 'var(--space-3)';
    document.body.appendChild(notificationContainer);
  }
  
  // Verificar se o FontAwesome está carregado, caso contrário, carregar
  if (!document.querySelector('link[href*="fontawesome"]')) {
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);
  }
  
  // Determinar ícone e cor com base no tipo
  let icon, color, bgColor, iconClass;
  
  switch (type) {
    case 'error':
      iconClass = 'fa-circle-exclamation';
      color = 'var(--error)';
      bgColor = 'var(--bg-primary)';
      break;
    case 'success':
      iconClass = 'fa-circle-check';
      color = 'var(--success)';
      bgColor = 'var(--bg-primary)';
      break;
    case 'warning':
      iconClass = 'fa-triangle-exclamation';
      color = 'var(--warning)';
      bgColor = 'var(--bg-primary)';
      break;
    default: // info
      iconClass = 'fa-circle-info';
      color = 'var(--info)';
      bgColor = 'var(--bg-primary)';
      break;
  }
  
  // Criar a notificação
  const notification = document.createElement('div');
  notification.style.backgroundColor = bgColor;
  notification.style.borderLeft = `4px solid ${color}`;
  notification.style.color = 'var(--text-primary)';
  notification.style.padding = 'var(--space-4)';
  notification.style.borderRadius = 'var(--radius-md)';
  notification.style.boxShadow = 'var(--shadow-md)';
  notification.style.display = 'flex';
  notification.style.flexDirection = 'column';
  notification.style.position = 'relative';
  notification.style.overflow = 'hidden';
  notification.style.opacity = '0';
  notification.style.transform = 'translateX(20px)';
  notification.style.transition = 'var(--transition-normal)';
  notification.style.marginTop = '0px';
  
  // Conteúdo da notificação
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2);">
      <i class="fa-solid ${iconClass}" style="color: ${color}; font-size: var(--text-xl);"></i>
      <div style="flex-grow: 1;">
        <div style="font-weight: var(--font-semibold); font-size: var(--text-base);">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
      </div>
      <div class="close-btn" style="cursor: pointer; font-size: var(--text-lg);">
        <i class="fa-solid fa-xmark" style="opacity: 0.7;"></i>
      </div>
    </div>
    <div style="padding-left: calc(var(--text-xl) + var(--space-3)); font-size: var(--text-sm);">
      ${message}
    </div>
    <div class="progress-bar" style="position: absolute; bottom: 0; left: 0; height: 3px; width: 100%; background-color: ${color}; transform-origin: left; transform: scaleX(1);"></div>
  `;
  
  // Anexar ao container
  notificationContainer.prepend(notification);
  
  // Animação de entrada
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0)';
  });
  
  // Configurar barra de progresso
  const progressBar = notification.querySelector('.progress-bar');
  progressBar.style.transition = `transform ${duration}ms linear`;
  
  // Iniciar a contagem regressiva
  setTimeout(() => {
    progressBar.style.transform = 'scaleX(0)';
  }, 10);
  
  // Configurar botão de fechar
  const closeBtn = notification.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => closeNotification(notification));
  
  // Fechar automaticamente após a duração
  const timeoutId = setTimeout(() => closeNotification(notification), duration);
  
  // Pausar o tempo quando passar o mouse por cima
  notification.addEventListener('mouseenter', () => {
    progressBar.style.transitionProperty = 'none';
    clearTimeout(timeoutId);
  });
  
  // Continuar quando tirar o mouse
  notification.addEventListener('mouseleave', () => {
    const remainingTime = duration * (parseFloat(getComputedStyle(progressBar).transform.split(', ')[0].split('(')[1]) || 0);
    if (remainingTime > 0) {
      progressBar.style.transition = `transform ${remainingTime}ms linear`;
      progressBar.style.transform = 'scaleX(0)';
      setTimeout(() => closeNotification(notification), remainingTime);
    } else {
      closeNotification(notification);
    }
  });
  
  // Função para fechar notificação com animação
  function closeNotification(element) {
    element.style.opacity = '0';
    element.style.marginTop = `-${element.offsetHeight}px`;
    element.style.transform = 'translateX(20px)';
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
        
        // Remover o container se não houver mais notificações
        if (notificationContainer.children.length === 0) {
          notificationContainer.remove();
        }
      }
    }, 300);
  }
  
  // Retornar um identificador que permite fechar a notificação programaticamente
  return {
    close: () => closeNotification(notification)
  };
}
  
  // API pública do módulo
  return {
    initialize,
    attachRightClickListeners
  };
})();

// Exportar o módulo
export default FileOperations;

// Enhanced path normalization with better validation
function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    console.warn('Invalid path provided to normalizePath:', inputPath);
    return '';
  }
  
  const projectPath = getProjectPath().trim();
  if (!projectPath) {
    console.error('Project path is not defined');
    return inputPath;
  }
  
  // Clean the input path
  let cleanPath = inputPath.trim().replace(/[\/\\]+/g, '\\');
  
  // If already absolute and starts with project path, return as-is
  if (cleanPath.startsWith(projectPath)) {
    return cleanPath;
  }
  
  // If it's an absolute Windows path but not in project, return as-is
  if (/^[A-Za-z]:\\/.test(cleanPath)) {
    return cleanPath;
  }
  
  // Remove leading separators and combine with project path
  cleanPath = cleanPath.replace(/^[\/\\]+/, '');
  const separator = projectPath.endsWith('\\') ? '' : '\\';
  
  return `${projectPath}${separator}${cleanPath}`;
}

// Enhanced element finding with multiple strategies
function findElementByPath(targetPath) {
  if (!targetPath) {
    console.warn('No path provided to findElementByPath');
    return null;
  }
  
  console.log(`Searching for element with path: ${targetPath}`);
  
  // Strategy 1: Direct data-path match
  const allItems = document.querySelectorAll('.file-tree-item[data-path]');
  for (const item of allItems) {
    const itemPath = item.getAttribute('data-path');
    if (itemPath === targetPath) {
      console.log('Found element by data-path match');
      return item;
    }
  }
  
  // Strategy 2: Normalized path comparison
  const normalizedTarget = normalizePath(targetPath);
  for (const item of allItems) {
    const itemPath = normalizePath(item.getAttribute('data-path'));
    if (itemPath === normalizedTarget) {
      console.log('Found element by normalized path match');
      return item;
    }
  }
  
  // Strategy 3: Filename and hierarchy matching
  const targetParts = targetPath.split(/[\/\\]/).filter(part => part.length > 0);
  const targetFilename = targetParts[targetParts.length - 1];
  
  const candidateItems = document.querySelectorAll('.file-tree-item .file-item span');
  for (const span of candidateItems) {
    if (span.textContent === targetFilename) {
      const element = span.closest('.file-tree-item');
      if (isPathMatchingElement(targetPath, element)) {
        console.log('Found element by filename and hierarchy match');
        return element;
      }
    }
  }
  
  console.warn(`Element not found for path: ${targetPath}`);
  return null;
}

// Enhanced path matching with better hierarchy detection
function isPathMatchingElement(targetPath, element) {
  const reconstructedPath = getFilePathFromElement(element);
  
  // Direct match
  if (reconstructedPath === targetPath) {
    return true;
  }
  
  // Normalized comparison
  const normalizedTarget = normalizePath(targetPath);
  const normalizedReconstructed = normalizePath(reconstructedPath);
  
  if (normalizedTarget === normalizedReconstructed) {
    return true;
  }
  
  // Suffix matching (for relative vs absolute paths)
  const targetParts = normalizedTarget.split('\\').filter(part => part.length > 0);
  const reconParts = normalizedReconstructed.split('\\').filter(part => part.length > 0);
  
  if (reconParts.length <= targetParts.length) {
    const offset = targetParts.length - reconParts.length;
    return reconParts.every((part, i) => part === targetParts[i + offset]);
  }
  
  return false;
}


// Quando o DOM estiver carregado, inicializar o módulo de operações de arquivos
document.addEventListener('DOMContentLoaded', () => {
  // Verificar se window.currentProjectPath existe
  if (!window.currentProjectPath) {
    console.warn('WARNING: window.currentProjectPath is not defined. File operations may not work correctly.');
  }
  
  // Inicializar o módulo passando a referência para refreshFileTree
  FileOperations.initialize(window.refreshFileTree || (() => console.log('refreshFileTree not available')));
  
  // Para garantir que os listeners sejam adicionados após qualquer atualização da árvore
  if (window.refreshFileTree) {
    const originalRefreshFileTree = window.refreshFileTree;
    window.refreshFileTree = async function() {
      try {
        await originalRefreshFileTree.apply(this, arguments);
        FileOperations.attachRightClickListeners();
      } catch (error) {
        console.error('Error in refreshFileTree:', error);
      }
    };
  }
  
  // Exportar a função showNotification globalmente se ela for usada por outros módulos
  if (!window.showNotification) {
    window.showNotification = showNotification;
  }
});