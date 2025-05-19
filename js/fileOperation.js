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
  
  // Tratar criação de novo arquivo
  async function handleNewFile() {
    hideContextMenu();
    
    let targetPath = currentPath;
    console.log(`Caminho original para novo arquivo: ${targetPath}`);
    
    // Se o caminho atual for um arquivo, use o diretório pai
    if (!isFolder) {
      try {
        targetPath = await window.electronAPI.getParentDirectory(targetPath);
        console.log(`Novo caminho (pasta pai): ${targetPath}`);
      } catch (error) {
        console.error('Error getting parent directory:', error);
        showNotification(`Error: Could not determine parent directory`, 'error');
        return;
      }
    }
    
    // Criar input para nome do arquivo
    const targetElement = findElementByPath(targetPath);
    if (!targetElement) {
      console.error(`Elemento não encontrado para: ${targetPath}`);
      showNotification(`Error: Could not find target element for path: ${targetPath}`, 'error');
      return;
    }
    
    const folderContent = isFolder ? 
      targetElement.querySelector('.folder-content') : 
      targetElement.parentElement;
    
    if (!folderContent) {
      showNotification(`Error: Could not find folder content for path: ${targetPath}`, 'error');
      return;
    }
    
    // Criar elemento para input
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-input-container';
    
    const input = document.createElement('input');
    input.className = 'file-input';
    input.type = 'text';
    input.placeholder = 'filename.ext';
    
    inputContainer.appendChild(input);
    folderContent.prepend(inputContainer);
    
    // Focar no input
    input.focus();
    
    // Handler para criação do arquivo
    const handleCreate = async () => {
      if (!input.isConnected) return;
      
      const fileName = input.value.trim();
      if (!fileName) {
        if (folderContent.contains(inputContainer)) {
          folderContent.removeChild(inputContainer);
        }
        return;
      }
      
      try {
        // Construir o caminho completo do arquivo
        const fileSeparator = targetPath.endsWith('\\') ? '' : '\\';
        const newFilePath = `${targetPath}${fileSeparator}${fileName}`;
        console.log(`Tentando criar arquivo: ${newFilePath}`);
        
        await window.electronAPI.createFile(newFilePath);
        showNotification(`File "${fileName}" created successfully`, 'success');
        
        // Atualizar a árvore de arquivos após a criação
        if (typeof refreshFileTreeFn === 'function') {
          await refreshFileTreeFn();
        }
      } catch (error) {
        console.error('Error creating file:', error);
        showNotification(`Error creating file: ${error.message}`, 'error');
      } finally {
        if (folderContent.contains(inputContainer)) {
          folderContent.removeChild(inputContainer);
        }
      }
    };
    
    // Setup event listeners
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
  
  // Tratar criação de nova pasta
  async function handleNewFolder() {
    hideContextMenu();
    
    let targetPath = currentPath;
    console.log(`Caminho original para nova pasta: ${targetPath}`);
    
    // Se o caminho atual for um arquivo, use o diretório pai
    if (!isFolder) {
      try {
        targetPath = await window.electronAPI.getParentDirectory(targetPath);
        console.log(`Novo caminho (pasta pai): ${targetPath}`);
      } catch (error) {
        console.error('Error getting parent directory:', error);
        showNotification(`Error: Could not determine parent directory`, 'error');
        return;
      }
    }
    
    // Criar input para nome da pasta
    const targetElement = findElementByPath(targetPath);
    if (!targetElement) {
      console.error(`Elemento não encontrado para: ${targetPath}`);
      showNotification(`Error: Could not find target element for path: ${getRelativePath(targetPath)}`, 'error');
      return;
    }
    
    const folderContent = isFolder ? 
      targetElement.querySelector('.folder-content') : 
      targetElement.parentElement;
    
    if (!folderContent) {
      showNotification(`Error: Could not find folder content for path: ${getRelativePath(targetPath)}`, 'error');
      return;
    }
    
    // Criar elemento para input
    const inputContainer = document.createElement('div');
    inputContainer.className = 'file-input-container';
    
    const input = document.createElement('input');
    input.className = 'file-input';
    input.type = 'text';
    input.placeholder = 'folder name';
    
    inputContainer.appendChild(input);
    folderContent.prepend(inputContainer);
    
    // Focar no input
    input.focus();
    
    // Handler para criação da pasta
    const handleCreate = async () => {
      // Verificar se o input ainda existe
      if (!input.isConnected) {
        return;
      }
      
      const folderName = input.value.trim();
      if (!folderName) {
        if (folderContent.contains(inputContainer)) {
          folderContent.removeChild(inputContainer);
        }
        return;
      }
      
      try {
        // Construir o caminho completo da pasta
        const fileSeparator = targetPath.endsWith('\\') ? '' : '\\';
        const newFolderPath = `${targetPath}${fileSeparator}${folderName}`;
        
        console.log(`Tentando criar pasta: ${newFolderPath}`);
        await window.electronAPI.createDirectory(newFolderPath);
        showNotification(`Folder "${folderName}" created successfully`, 'success');
        
        // Atualizar a árvore de arquivos
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
    
    // Flag para evitar processamentos repetidos
    let isProcessing = false;
    
    // Event listeners para o input
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
  
  // Tratar renomeação de arquivo/pasta
  async function handleRename() {
    hideContextMenu();
    
    if (!currentPath) return;
    
    // Garantir que o caminho seja absoluto
    currentPath = normalizePath(currentPath);
    console.log(`Tentando renomear: ${currentPath}`);

    // Encontrar o elemento correspondente ao caminho
    const element = findElementByPath(currentPath);
    if (!element) {
      showNotification(`Error: Could not find element for path: ${getRelativePath(currentPath)}`, 'error');
      return;
    }
    
    const fileItem = element.querySelector('.file-item');
    if (!fileItem) {
      showNotification(`Error: Could not find file item`, 'error');
      return;
    }
    
    // Guardar referência ao nome original
    const nameSpan = fileItem.querySelector('span');
    if (!nameSpan) {
      showNotification(`Error: Could not find name element`, 'error');
      return;
    }
    
    const originalName = nameSpan.textContent;
    
    // Adicionar classe de edição
    element.classList.add('editing');
    
    // Criar input no lugar do texto
    const input = document.createElement('input');
    input.className = 'file-input';
    input.value = originalName;
    input.style.width = '100%';
    
    // Substituir o span pelo input
    const spanParent = nameSpan.parentElement;
    spanParent.replaceChild(input, nameSpan);
    
    // Focar no input
    input.focus();
    input.setSelectionRange(0, originalName.lastIndexOf('.') > 0 && !isFolder ? 
      originalName.lastIndexOf('.') : originalName.length);
    
    // Flag para evitar processamentos repetidos
    let isCompleted = false;
    
    // Handler para completar a renomeação
    const completeRename = async () => {
      // Verificar se já foi completado ou se o input não está mais conectado
      if (isCompleted || !input.isConnected) {
        return;
      }
      
      // Marcar como completado
      isCompleted = true;
      
      const newName = input.value.trim();
      
      // Verificar se o elemento ainda existe
      if (!input.isConnected) {
        return;
      }
      
      try {
        // Restaurar o span
        if (spanParent.contains(input)) {
          spanParent.replaceChild(nameSpan, input);
        }
        element.classList.remove('editing');
        
        // Se o nome não mudou ou está vazio, não faz nada
        if (!newName || newName === originalName) {
          return;
        }
        
        // Obter o diretório pai e construir o novo caminho
        try {
          const parentDir = await window.electronAPI.getParentDirectory(currentPath);
          const fileSeparator = parentDir.endsWith('\\') ? '' : '\\';
          const newPath = `${parentDir}${fileSeparator}${newName}`;
          
          console.log(`Renomeando de "${currentPath}" para "${newPath}"`);

          // Chamar a API para renomear
          await window.electronAPI.renameFileOrDirectory(currentPath, newPath);

          showNotification(`Renamed successfully to "${newName}"`, 'success');

          // Atualizar a árvore de arquivos
          if (typeof refreshFileTreeFn === 'function') {
            await refreshFileTreeFn();
          }
        } catch (error) {
          console.error('Error renaming:', error);
          showNotification(`Error renaming: ${error.message}`, 'error');
        }
      } catch (error) {
        console.error('Error in completeRename:', error);
        showNotification(`Error: ${error.message}`, 'error');
        // Tentar restaurar o elemento
        try {
          if (spanParent && input.parentNode === spanParent) {
            spanParent.replaceChild(nameSpan, input);
          }
          element.classList.remove('editing');
        } catch (e) {
          console.error('Error restoring element:', e);
        }
      }
    };
    
    // Event listeners para o input
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
          console.error('Error restoring after Escape:', error);
        }
      }
    });
    
    // Usar um setTimeout para evitar corridas com o evento click
    input.addEventListener('blur', () => {
      setTimeout(() => {
        completeRename();
      }, 100);
    });
  }

  async function handleLocation() {
    hideContextMenu();
    if (currentProjectPath) {
        try {
            await window.electronAPI.openFolder(currentProjectPath);
        } catch (error) {
            console.error('Error opening folder:', error);
        }
    }
  }
  // Tratar exclusão de arquivo/pasta
  // Update the handleDelete function in fileOperations.js
async function handleDelete() {
  hideContextMenu();
  
  if (!currentPath) {
    showNotification(`Error: No path selected`, 'error');
    return;
  }
  
  try {
    console.log(`Attempting to delete: ${currentPath}`);
    
    // Ask for confirmation first
    const itemName = currentPath.split(/[\/\\]/).pop();
    const confirmed = await window.electronAPI.showConfirmDialog(
      `Delete ${isFolder ? 'Folder' : 'File'}`,
      `Are you sure you want to delete "${itemName}"${isFolder ? ' and all its contents' : ''}?`
    );
    
    if (!confirmed) return;
    
    // Try the deletion directly without checking existence first
    console.log(`Sending delete command for: ${currentPath}`);
    await window.electronAPI.deleteFileOrDirectory(currentPath);
    
    showNotification(`"${itemName}" deleted successfully`, 'success');
    
    // Make sure to await the refresh
    if (typeof refreshFileTreeFn === 'function') {
      await refreshFileTreeFn();
    }
  } catch (error) {
    console.error('Error deleting:', error);
    showNotification(`Error deleting: ${error.message}`, 'error');
    
    // Still update the tree
    if (typeof refreshFileTreeFn === 'function') {
      await refreshFileTreeFn();
    }
  }
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