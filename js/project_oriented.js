// projectOriented.js - Implementação do gerenciamento de configuração orientada a projetos
document.addEventListener('DOMContentLoaded', () => {
  // Elementos do modal
  const projectModal = document.getElementById('modalProjectConfig');
  const topLevelSelect = document.getElementById('topLevelSelect');
  const testbenchSelect = document.getElementById('testbenchSelect');
  const gtkwaveSelect = document.getElementById('gtkwaveSelect');
  const processorsList = document.getElementById('processorsList');
  const addProcessorBtn = document.getElementById('addProcessor');
  const iverilogFlags = document.getElementById('iverilogFlags');
  const saveProjectConfigBtn = document.getElementById('saveProjectConfig');
  const cancelProjectConfigBtn = document.getElementById('cancelProjectConfig');
  const closeProjectModalBtn = document.getElementById('closeProjectModal');
  
  // Elementos para o toggle UI
  const toggleUiButton = document.getElementById('toggle-ui');
  const settingsButton = document.getElementById('settings');
  
  // Duração da animação para troca de ícones
  const ICON_TRANSITION_DURATION = 300;
  
  // Nome do arquivo de configuração
  const CONFIG_FILENAME = 'projectOriented.json';
  
  // Configuração atual do projeto
  let currentConfig = {
    topLevelFile: '',
    testbenchFile: '',
    gtkwaveFile: '',
    processors: [],
    iverilogFlags: ''
  };

  // Lista de processadores disponíveis
  let availableProcessors = [];

  // Cache para os arquivos encontrados
  let foundVerilogFiles = [];
  let foundGtkwaveFiles = [];

  // File management variables
let synthesizableFiles = [];
let testbenchFiles = [];
let gtkwFiles = [];

// File input elements
const synthesizableFileInput = document.getElementById('synthesizableFileInput');
const testbenchFileInput = document.getElementById('testbenchFileInput');

// Import buttons
const importSynthesizableBtn = document.getElementById('importSynthesizableBtn');
const importTestbenchBtn = document.getElementById('importTestbenchBtn');

// Drop areas
const synthesizableDropArea = document.getElementById('synthesizableDropArea');
const testbenchDropArea = document.getElementById('testbenchDropArea');

// File lists
const synthesizableFileList = document.getElementById('synthesizableFileList');
const testbenchFileList = document.getElementById('testbenchFileList');

// Empty state elements
const synthesizableEmptyState = document.getElementById('synthesizableEmptyState');
const testbenchEmptyState = document.getElementById('testbenchEmptyState');

// Initialize file management system
function initFileManagement() {
  setupImportButtons();
  setupDragAndDrop();
}


function openModal(modalElement) {
  if (!modalElement) {
    console.error("Tentativa de abrir um modal nulo ou indefinido.");
    return;
  }
  modalElement.setAttribute('aria-hidden', 'false');
  modalElement.classList.add('show');
  document.body.style.overflow = 'hidden'; // Impede o scroll do fundo

  // Foca no primeiro elemento interativo dentro do modal para acessibilidade.
  const focusable = modalElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) {
    focusable.focus();
  } else {
    modalElement.focus(); // Fallback
  }
}

function closeModal(modalElement) {
  if (!modalElement) {
    console.error("Tentativa de fechar um modal nulo ou indefinido.");
    return;
  }
  modalElement.setAttribute('aria-hidden', 'true');
  modalElement.classList.remove('show');
  document.body.style.overflow = ''; // Restaura o scroll do fundo
}

// --- Funções Específicas (para usar no resto do seu código) ---
function openProjectModal() {
    const projectModal = document.getElementById('modalProjectConfig');
    if (projectModal) {
        projectModal.setAttribute('aria-hidden', 'false');
        projectModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeProjectModal() {
    const projectModal = document.getElementById('modalProjectConfig');
    if (projectModal) {
        projectModal.setAttribute('aria-hidden', 'true');
        projectModal.classList.remove('show');
        if (!document.querySelector('.modal-overlay[aria-hidden="false"]')) {
            document.body.style.overflow = '';
        }
    }
}

// Setup import buttons
function setupImportButtons() {
  if (importSynthesizableBtn) {
    importSynthesizableBtn.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.selectFilesWithPath({
          title: 'Select Synthesizable Files',
          filters: [
            { name: 'Verilog Files', extensions: ['v', 'sv', 'vh'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.canceled && result.files.length > 0) {
          handleFileImportWithPath(result.files, 'synthesizable');
        }
      } catch (error) {
        console.error('Error selecting files:', error);
        showNotification('Error selecting files', 'error', 3000);
      }
    });
  }
  
  if (importTestbenchBtn) {
    importTestbenchBtn.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.selectFilesWithPath({
          title: 'Select Testbench Files',
          filters: [
            { name: 'Verilog Files', extensions: ['v', 'sv'] },
            { name: 'GTKWave Files', extensions: ['gtkw'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.canceled && result.files.length > 0) {
          handleFileImportWithPath(result.files, 'testbench');
        }
      } catch (error) {
        console.error('Error selecting files:', error);
        showNotification('Error selecting files', 'error', 3000);
      }
    });
  }
}

// ATUALIZAR a função handleFileImportWithPath com validações extras
function handleFileImportWithPath(files, type) {
  const validFiles = [];
  const errors = [];
  
  for (let file of files) {
    // Validação 1: Path obrigatório
    if (!file.path || file.path === '') {
      console.error('File without path:', file);
      errors.push(`"${file.name}" has no path information`);
      continue;
    }

    // Validação 2: Verificar extensão permitida
    const ext = file.name.toLowerCase().split('.').pop();
    const allowedExtensions = type === 'synthesizable' 
      ? ['v', 'sv', 'vh', 'txt'] 
      : ['v', 'sv', 'gtkw'];
    
    if (!allowedExtensions.includes(ext)) {
      errors.push(`"${file.name}" has unsupported extension .${ext}`);
      continue;
    }

    // Validação 3: Verificar duplicatas por path (mais seguro que por nome)
    const existingFiles = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
    if (existingFiles.some(f => f.path === file.path)) {
      errors.push(`"${file.name}" already exists in the project`);
      continue;
    }

    // Validação 4: Verificar se é diretório (não deveria ser)
    if (file.size === 0 && !file.type) {
      console.warn('Possibly a directory, skipping:', file.name);
      errors.push(`"${file.name}" appears to be a directory`);
      continue;
    }

    // Arquivo válido - adicionar à lista
    validFiles.push({
      name: file.name,
      path: file.path,  // ← PATH GARANTIDO
      size: file.size || 0,
      type: file.type || getMimeTypeFromExtension(file.name),
      starred: false,
      lastModified: file.lastModified || Date.now()
    });
  }
  
  // Mostrar erros se houver
  if (errors.length > 0) {
    console.warn('Import errors:', errors);
    errors.forEach(error => {
      showNotification(error, 'warning', 2500);
    });
  }
  
  if (validFiles.length === 0) {
    if (errors.length === 0) {
      showNotification('No valid files to import', 'warning', 3000);
    }
    return;
  }

  // Adicionar arquivos à lista apropriada
  if (type === 'synthesizable') {
    synthesizableFiles.push(...validFiles);
    updateFileList('synthesizable');
    
    // Parse para processar instâncias
    parseAllSynthesizableFiles().then(() => {
      refreshAllInstanceSelects();
    });
  } else if (type === 'testbench') {
    validFiles.forEach(file => {
      if (file.name.toLowerCase().endsWith('.gtkw')) {
        gtkwFiles.push(file);
      } else {
        testbenchFiles.push(file);
      }
    });
    updateFileList('testbench');
  }

  console.log(`Successfully imported ${validFiles.length} file(s) with paths:`, validFiles);
  showNotification(
    `Successfully added ${validFiles.length} file(s) to ${type} list.`, 
    'success', 
    3000
  );
}


// Setup drag and drop functionality
function setupDragAndDrop() {
  // Synthesizable files drop area
  if (synthesizableDropArea) {
    setupDropArea(synthesizableDropArea, 'synthesizable');
  }
  
  // Testbench files drop area
  if (testbenchDropArea) {
    setupDropArea(testbenchDropArea, 'testbench');
  }
}

// Setup individual drop area
function setupDropArea(dropArea, type) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
  });
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => highlight(dropArea), false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => unhighlight(dropArea), false);
  });
  
  dropArea.addEventListener('drop', (e) => handleDrop(e, type), false);
}

// Prevent default drag behaviors
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Highlight drop area
function highlight(dropArea) {
  dropArea.classList.add('dragover');
  
  // Adicionar feedback visual extra
  const dropZone = dropArea.querySelector('.drop-zone-content');
  if (dropZone) {
    const icon = dropZone.querySelector('.drop-icon');
    if (icon) {
      icon.style.transform = 'scale(1.2)';
      icon.style.color = 'var(--accent-primary)';
    }
  }
}

// Remove highlight from drop area
function unhighlight(dropArea) {
  dropArea.classList.remove('dragover');
  
  // Remover feedback visual extra
  const dropZone = dropArea.querySelector('.drop-zone-content');
  if (dropZone) {
    const icon = dropZone.querySelector('.drop-icon');
    if (icon) {
      icon.style.transform = 'scale(1)';
      icon.style.color = '';
    }
  }
}
// SUBSTITUIR completamente a função handleDrop
async function handleDrop(e, type) {
  const droppedFiles = e.dataTransfer.files;
  
  console.log('Files dropped:', droppedFiles.length);
  
  // Verificar se está rodando no Electron
  const isElectron = typeof window.electronAPI !== 'undefined';
  
  if (!isElectron) {
    showNotification('Drag & drop only works in the desktop application', 'error', 3000);
    return;
  }
  
  const filesWithPath = [];
  
  for (let i = 0; i < droppedFiles.length; i++) {
    const file = droppedFiles[i];
    
    if (file.path && file.path !== '') {
      filesWithPath.push({
        name: file.name,
        path: file.path,
        size: file.size,
        type: file.type || getMimeTypeFromExtension(file.name),
        lastModified: file.lastModified,
        starred: false
      });
    } else {
      console.warn('File dropped without path:', file.name);
      showNotification(`Cannot import "${file.name}": no path information`, 'error', 3000);
    }
  }
  
  if (filesWithPath.length > 0) {
    handleFileImportWithPath(filesWithPath, type);
  }
}
// Função auxiliar para determinar MIME type pela extensão
function getMimeTypeFromExtension(fileName) {
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes = {
    'v': 'text/x-verilog',
    'sv': 'text/x-systemverilog',
    'vh': 'text/x-verilog-header',
    'gtkw': 'application/x-gtkwave',
    'txt': 'text/plain'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Handle file import - FIXED to avoid duplicates and show proper errors
function handleFileImport(files, type) {
  const validFiles = [];
  
  for (let file of files) {
    if (validateFile(file, type)) {
      const existingFiles = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
      if (!existingFiles.some(f => f.name === file.name)) {
        validFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          starred: false,
          lastModified: file.lastModified,
          path: file.path || ''  // ← Garante que o path seja capturado
        });
      } else {
        showNotification(`File "${file.name}" already exists in the project`, 'warning', 3000);
      }
    }
  }
  
  if (type === 'synthesizable') {
    synthesizableFiles.push(...validFiles);
    updateFileList('synthesizable');
    
    // Trigger re-parsing and UI update after adding a synthesizable file
    if (validFiles.length > 0) {
      parseAllSynthesizableFiles().then(() => {
        refreshAllInstanceSelects();
      });
    }
  } else if (type === 'testbench') {
    validFiles.forEach(file => {
      if (file.name.endsWith('.gtkw')) {
        gtkwFiles.push(file);
      } else {
        testbenchFiles.push(file);
      }
    });
    updateFileList('testbench');
  }

  if (validFiles.length > 0) {
    showNotification(`Successfully added ${validFiles.length} file(s) to ${type} list.`, 'success', 3000);
  }
}

// Add files to the appropriate list
function addFilesToList(files, listType) {
  files.forEach(file => {
    // Check if file already exists
    const existingFile = getFileFromList(file.name, listType);
    if (existingFile) {
      console.log(`File ${file.name} already exists in ${listType} list`);
      return;
    }
    
    // Add file to appropriate array
    const fileObj = {
      name: file.name,
      path: file.path,
      isStarred: false
    };
    
    if (listType === 'synthesizable') {
      synthesizableFiles.push(fileObj);
    } else if (listType === 'testbench') {
      testbenchFiles.push(fileObj);
    } else if (listType === 'gtkw') {
      gtkwFiles.push(fileObj);
    }
  });
  
  // Update the UI
  updateFileListUI();
}

// Get file from list by name
function getFileFromList(fileName, listType) {
  if (listType === 'synthesizable') {
    return synthesizableFiles.find(file => file.name === fileName);
  } else if (listType === 'testbench') {
    return testbenchFiles.find(file => file.name === fileName);
  } else if (listType === 'gtkw') {
    return gtkwFiles.find(file => file.name === fileName);
  }
  return null;
}

// Update file list UI
function updateFileListUI() {
  updateSynthesizableFileList();
  updateTestbenchFileList();
}

// Update file list display - IMPROVED
function updateFileList(type) {
  const fileList = type === 'synthesizable' ? synthesizableFileList : testbenchFileList;
  const emptyState = type === 'synthesizable' ? synthesizableEmptyState : testbenchEmptyState;
  
  if (!fileList) {
    console.error('File list element not found:', type);
    return;
  }
  
  fileList.innerHTML = '';
  
  if (type === 'synthesizable') {
    if (synthesizableFiles.length === 0) {
      if (emptyState) {
        emptyState.style.display = 'flex';
        fileList.appendChild(emptyState.cloneNode(true));
      }
    } else {
      if (emptyState) {
        emptyState.style.display = 'none';
      }
      
      const sortedFiles = [...synthesizableFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedFiles.forEach((file) => {
        const actualIndex = synthesizableFiles.findIndex(f => f.name === file.name);
        const fileItem = createFileItem(file, actualIndex, 'synthesizable');
        fileList.appendChild(fileItem);
      });
    }
  } else if (type === 'testbench') {
    const totalFiles = testbenchFiles.length + gtkwFiles.length;
    
    if (totalFiles === 0) {
      if (emptyState) {
        emptyState.style.display = 'flex';
        fileList.appendChild(emptyState.cloneNode(true));
      }
    } else {
      if (emptyState) {
        emptyState.style.display = 'none';
      }
      
      const sortedTestbench = [...testbenchFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedTestbench.forEach((file) => {
        const actualIndex = testbenchFiles.findIndex(f => f.name === file.name);
        const fileItem = createFileItem(file, actualIndex, 'testbench');
        fileList.appendChild(fileItem);
      });
      
      const sortedGtkw = [...gtkwFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedGtkw.forEach((file) => {
        const actualIndex = gtkwFiles.findIndex(f => f.name === file.name);
        const fileItem = createFileItem(file, actualIndex, 'gtkw');
        fileList.appendChild(fileItem);
      });
    }
  }
}

// Utility function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Show file success message
function showFileSuccess(message) {
  // Create or update success message element
  let successElement = document.getElementById('file-success-message');
  if (!successElement) {
    successElement = document.createElement('div');
    successElement.id = 'file-success-message';
    successElement.className = 'project-success-message';
    
    const modalBody = document.querySelector('.modalConfig-body');
    if (modalBody) {
      modalBody.insertBefore(successElement, modalBody.firstChild);
    }
  }
  
  successElement.innerHTML = `
    <div class="project-alert project-alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>${message}</span>
      <button class="project-alert-close" onclick="hideFileSuccess()">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>
  `;
  
  // Auto-hide after 3 seconds
  setTimeout(hideFileSuccess, 3000);
}

// Hide file success message
function hideFileSuccess() {
  const successElement = document.getElementById('file-success-message');
  if (successElement) {
    successElement.classList.add('fade-out');
    setTimeout(() => {
      successElement.remove();
    }, 300);
  }
}


// Update synthesizable file list UI
function updateSynthesizableFileList() {
  if (!synthesizableFileList) return;
  
  // Clear current list
  synthesizableFileList.innerHTML = '';
  
  if (synthesizableFiles.length === 0) {
    synthesizableFileList.appendChild(synthesizableEmptyState);
    return;
  }
  
  // Create file items
  synthesizableFiles.forEach((file, index) => {
    const fileItem = createFileItem(file, index, 'synthesizable');
    synthesizableFileList.appendChild(fileItem);
  });
}

// Update testbench file list UI
function updateTestbenchFileList() {
  if (!testbenchFileList) return;
  
  // Clear current list
  testbenchFileList.innerHTML = '';
  
  if (testbenchFiles.length === 0 && gtkwFiles.length === 0) {
    testbenchFileList.appendChild(testbenchEmptyState);
    return;
  }
  
  // Create testbench file items
  testbenchFiles.forEach((file, index) => {
    const fileItem = createFileItem(file, index, 'testbench');
    testbenchFileList.appendChild(fileItem);
  });
  
  // Create GTKW file items
  gtkwFiles.forEach((file, index) => {
    const fileItem = createFileItem(file, index, 'gtkw');
    testbenchFileList.appendChild(fileItem);
  });
}

// Create file item element - UPDATED with starred styling
function createFileItem(file, index, type) {
  const fileItem = document.createElement('div');
  fileItem.className = `project-file-item ${file.starred ? 'starred' : ''}`;
  fileItem.dataset.fileIndex = index;
  fileItem.dataset.fileType = type;
  
  setTimeout(() => fileItem.classList.add('file-animate-in'), 10);
  
  const isStarred = file.starred || false;
  
  fileItem.innerHTML = `
    <div class="project-file-info">
      <div class="project-file-details">
        <div class="project-file-name">${file.name}</div>
      </div>
    </div>
    <div class="project-file-actions">
      <button class="project-icon-btn star-btn ${isStarred ? 'starred' : ''}" 
              data-index="${index}" 
              data-type="${type}"
              title="${isStarred ? 'Remove star' : 'Add star'}">
        <i class="fa-solid fa-star-of-life"></i>
      </button>
      <button class="project-icon-btn delete-btn" 
              data-index="${index}" 
              data-type="${type}"
              title="Remove file">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;
  
  const starBtn = fileItem.querySelector('.star-btn');
  const deleteBtn = fileItem.querySelector('.delete-btn');
  
  starBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFileStar(index, type);
  });
  
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeFile(index, type);
  });
  
  return fileItem;
}

// Get file icon based on extension
function getFileIcon(fileName) {
  const ext = getFileExtension(fileName);
  switch(ext) {
    case '.v':
      return 'fa-solid fa-file-code';
    case '.gtkw':
      return 'fa-solid fa-chart-line';
    default:
      return 'fa-solid fa-file';
  }
}

// Get file extension
function getFileExtension(fileName) {
  return fileName.substring(fileName.lastIndexOf('.'));
}

// Setup file item event listeners
function setupFileItemEvents(fileItem) {
  // Copy path button
  const copyBtn = fileItem.querySelector('.copy-path-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const path = copyBtn.getAttribute('data-path');
      navigator.clipboard.writeText(path).then(() => {
        showNotification('Path copied to clipboard', 'success');
      });
    });
  }
  
  // Open location button
  const openBtn = fileItem.querySelector('.open-location-btn');
  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      const path = openBtn.getAttribute('data-path');
      try {
        await window.electronAPI.openFileLocation(path);
      } catch (error) {
        console.error('Error opening file location:', error);
        showNotification('Error opening file location', 'error');
      }
    });
  }
  
  // Star button
  const starBtn = fileItem.querySelector('.star-btn');
  if (starBtn) {
    starBtn.addEventListener('click', () => {
      const listType = starBtn.getAttribute('data-list-type');
      const index = parseInt(starBtn.getAttribute('data-index'));
      toggleFileStar(listType, index);
    });
  }
  
  // Remove button
  const removeBtn = fileItem.querySelector('.remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const listType = removeBtn.getAttribute('data-list-type');
      const index = parseInt(removeBtn.getAttribute('data-index'));
      removeFile(listType, index);
    });
  }
}

// Toggle file star status - UPDATED with single star constraint
function toggleFileStar(index, type) {
  let files, targetFile;
  
  // Get the correct file array and target file
  if (type === 'synthesizable') {
    files = synthesizableFiles;
    targetFile = files[index];
  } else if (type === 'testbench') {
    files = testbenchFiles;
    targetFile = files[index];
  } else if (type === 'gtkw') {
    files = gtkwFiles;
    targetFile = files[index];
  }
  
  if (!targetFile) {
    console.error('File not found for star toggle:', index, type);
    return;
  }
  
  // If trying to star a file, first check constraints
  if (!targetFile.starred) {
    // For synthesizable files: only one .v file can be starred
    if (type === 'synthesizable') {
      // Remove star from all other synthesizable files
      synthesizableFiles.forEach(file => {
        if (file !== targetFile) {
          file.starred = false;
        }
      });
    }
    // For testbench files: only one .v file can be starred
    else if (type === 'testbench') {
      // Remove star from all other testbench files
      testbenchFiles.forEach(file => {
        if (file !== targetFile) {
          file.starred = false;
        }
      });
    }
    // For gtkw files: only one .gtkw file can be starred
    else if (type === 'gtkw') {
      // Remove star from all other gtkw files
      gtkwFiles.forEach(file => {
        if (file !== targetFile) {
          file.starred = false;
        }
      });
    }
  }
  
  // Toggle starred status
  targetFile.starred = !targetFile.starred;
  
  // Update the file item immediately with animation
  const fileItem = document.querySelector(`[data-file-index="${index}"][data-file-type="${type}"]`);
  if (fileItem) {
    const starBtn = fileItem.querySelector('.star-btn');
    
    if (targetFile.starred) {
      fileItem.classList.add('starred');
      starBtn.classList.add('starred');
      starBtn.title = 'Remove star';
    } else {
      fileItem.classList.remove('starred');
      starBtn.classList.remove('aved');
      starBtn.title = 'Add to favorites';
    }
  }
  
  // Update the UI with new sorting - refresh all lists to update star states
  setTimeout(() => {
    updateFileList('synthesizable');
    updateFileList('testbench');
  }, 100);
  
  // REMOVER: saveProjectConfiguration(); - Não salvar automaticamente
  
  // Show feedback
  const action = targetFile.starred ? 'selected as main file' : 'deselected';
  showFileSuccess(`File "${targetFile.name}" ${action}.`);
}

// Remove file from list - UPDATED without confirmation
function removeFile(index, type) {
  let files, isSynthesizable = false;

  if (type === 'synthesizable') {
    files = synthesizableFiles;
    isSynthesizable = true;
  } else if (type === 'testbench') {
    files = testbenchFiles;
  } else if (type === 'gtkw') {
    files = gtkwFiles;
  }
  
  if (!files || !files[index]) {
    console.error('File not found for removal:', index, type);
    return;
  }

  const fileItem = document.querySelector(`[data-file-index="${index}"][data-file-type="${type}"]`);
  
  if (fileItem) {
    fileItem.classList.add('file-animate-out');
    
    setTimeout(() => {
      files.splice(index, 1);
      updateFileList(type === 'gtkw' ? 'testbench' : type);

      // Trigger re-parsing and UI update if a synthesizable file was removed
      if (isSynthesizable) {
        parseAllSynthesizableFiles().then(() => {
          refreshAllInstanceSelects();
        });
      }
    }, 300);
  } else {
    // Direct removal if UI element not found
    files.splice(index, 1);
    updateFileList(type === 'gtkw' ? 'testbench' : type);
    if (isSynthesizable) {
        parseAllSynthesizableFiles().then(() => {
          refreshAllInstanceSelects();
        });
      }
  }
}


// Get starred files with proper filtering
function getStarredFiles(type) {
  const files = type === 'synthesizable' ? synthesizableFiles : 
                type === 'testbench' ? testbenchFiles : 
                type === 'gtkw' ? gtkwFiles : [];
  return files.filter(file => file.starred === true);
}

// Enhanced clear all files function
function clearAllFiles() {
  if (confirm('Are you sure you want to remove all files from the project? This action cannot be undone.')) {
    synthesizableFiles = [];
    testbenchFiles = [];
    gtkwFiles = [];
    
    updateFileList('synthesizable');
    updateFileList('testbench');
    
    // REMOVER: saveProjectConfiguration(); - Não salvar automaticamente
    showFileSuccess('All files removed successfully.');
  }
}
// Get file by name and type
function getFileByName(fileName, type) {
  const files = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
  return files.find(file => file.name === fileName);
}

// Check if file exists in list
function fileExists(fileName, type) {
  const files = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
  return files.some(file => file.name === fileName);
}

// Get all files of a specific extension
function getFilesByExtension(extension, type) {
  const files = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
  return files.filter(file => file.name.toLowerCase().endsWith(extension.toLowerCase()));
}

// Updated validateFile function to accept any file type for import
// while maintaining selection restrictions for top level, testbench, and gtkwave
function validateFile(file, type) {
  // Allow any file type to be imported into both synthesizable and testbench lists
  // The restrictions only apply when selecting files for top level, testbench, and gtkwave
  
  // Basic file validation
  if (!file || !file.name) {
    showNotification('Invalid file selected', 'error', 3000);
    return false;
  }
  
  // Check file size (optional - adjust limit as needed)
  const maxFileSize = 50 * 1024 * 1024; // 50MB limit
  if (file.size > maxFileSize) {
    showNotification(`File "${file.name}" is too large (max 50MB)`, 'error', 3000);
    return false;
  }
  
  // All files are valid for import - restrictions only apply during selection
  return true;
}

// Update the populateSelect functions to filter by file extension
function populateTopLevelSelect() {
  if (!topLevelSelect) return;
  
  topLevelSelect.innerHTML = '<option value="">Select top level file (.v only)</option>';
  
  // Only show .v files for top level selection
  const verilogFiles = synthesizableFiles.filter(file => 
    file.name.toLowerCase().endsWith('.v')
  );
  
  verilogFiles.forEach(file => {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.name;
    topLevelSelect.appendChild(option);
  });
  
  // Restore selected value if it exists and is still valid
  if (currentConfig.topLevelFile && verilogFiles.some(f => f.name === currentConfig.topLevelFile)) {
    topLevelSelect.value = currentConfig.topLevelFile;
  }
}

function populateTestbenchSelect() {
  if (!testbenchSelect) return;
  
  testbenchSelect.innerHTML = '<option value="">Select testbench file (.v only)</option>';
  
  // Only show .v files for testbench selection
  const verilogFiles = testbenchFiles.filter(file => 
    file.name.toLowerCase().endsWith('.v')
  );
  
  verilogFiles.forEach(file => {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.name;
    testbenchSelect.appendChild(option);
  });
  
  // Restore selected value if it exists and is still valid
  if (currentConfig.testbenchFile && verilogFiles.some(f => f.name === currentConfig.testbenchFile)) {
    testbenchSelect.value = currentConfig.testbenchFile;
  }
}

function populateGtkwaveSelect() {
  if (!gtkwaveSelect) return;
  
  gtkwaveSelect.innerHTML = '<option value="">Select GTKWave file (.gtkw only)</option>';
  
  // Only show .gtkw files for gtkwave selection
  const gtkwFiles = [...testbenchFiles, ...gtkwFiles].filter(file => 
    file.name.toLowerCase().endsWith('.gtkw')
  );
  
  gtkwFiles.forEach(file => {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.name;
    gtkwaveSelect.appendChild(option);
  });
  
  // Restore selected value if it exists and is still valid
  if (currentConfig.gtkwaveFile && gtkwFiles.some(f => f.name === currentConfig.gtkwaveFile)) {
    gtkwaveSelect.value = currentConfig.gtkwaveFile;
  }
}

// Show file error message
function showFileError(message) {
  // Create or update error message element
  let errorElement = document.getElementById('file-error-message');
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.id = 'file-error-message';
    errorElement.className = 'project-error-message';
    
    const modalBody = document.querySelector('.modalConfig-body');
    if (modalBody) {
      modalBody.insertBefore(errorElement, modalBody.firstChild);
    }
  }
  
  errorElement.innerHTML = `
    <div class="project-alert project-alert-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>${message}</span>
      <button class="project-alert-close" onclick="hideFileError()">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>
  `;
  
  // Auto-hide after 5 seconds
  setTimeout(hideFileError, 5000);
}

// Hide file error message
function hideFileError() {
  const errorElement = document.getElementById('file-error-message');
  if (errorElement) {
    errorElement.classList.add('fade-out');
    setTimeout(() => {
      errorElement.remove();
    }, 300);
  }
}

// Export files data for saving
function exportFilesData() {
  return {
    synthesizable: synthesizableFiles.map(file => ({
      name: file.name,
      starred: file.starred || false,
      size: file.size,
      type: file.type
    })),
    testbench: testbenchFiles.map(file => ({
      name: file.name,
      starred: file.starred || false,
      size: file.size,
      type: file.type
    }))
  };
}

// Import files data from saved configuration
function importFilesData(data) {
  if (data.synthesizable) {
    synthesizableFiles = data.synthesizable.map(fileData => ({
      name: fileData.name,
      starred: fileData.starred || false,
      size: fileData.size || 0,
      type: fileData.type || 'text/plain'
    }));
    updateFileList('synthesizable');
  }
  
  if (data.testbench) {
    testbenchFiles = data.testbench.map(fileData => ({
      name: fileData.name,
      starred: fileData.starred || false,
      size: fileData.size || 0,
      type: fileData.type || 'text/plain'
    }));
    updateFileList('testbench');
  }
}

// Clear all files
function clearAllFiles() {
  synthesizableFiles = [];
  testbenchFiles = [];
  gtkwFiles = [];
  updateFileListUI();
}
  
  // Modified init function to include file management
function init() {
  // Existing initialization code...
  if (!projectModal) {
    console.error('Project configuration modal not found');
    return;
  }
  
  setupModalButtons();
  setupProcessorsSection();
  setupToggleUI();
  
  // Add file management initialization
  initFileManagement();
  
  loadAvailableProcessors();
  
  console.log('Project oriented configuration system initialized');
}

  // Carregar processadores disponíveis
  async function loadAvailableProcessors() {
    try {
      // Obter informações do projeto atual usando a API Electron
      const projectInfo = await window.electronAPI.getCurrentProject();
      
      if (projectInfo && projectInfo.projectOpen) {
        console.log("Projeto atual encontrado:", projectInfo);
        window.currentProjectPath = projectInfo.projectPath;
        
        // Usar processadores do projeto atual
        availableProcessors = projectInfo.processors || [];
      } else {
        // Se não houver projeto atual, tente usar o caminho do projeto armazenado
        const currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
        
        if (!currentProjectPath) {
          console.warn("Nenhum caminho de projeto disponível para carregar processadores");
          availableProcessors = [];
          return;
        }
        
        console.log("Carregando processadores para o projeto:", currentProjectPath);
        
        // Chamar o método IPC para obter processadores com o caminho do projeto atual
        const processors = await window.electronAPI.getAvailableProcessors(currentProjectPath);
        console.log("Processadores carregados:", processors);
        
        availableProcessors = processors || [];
      }
    } catch (error) {
      console.error("Falha ao carregar processadores disponíveis:", error);
      availableProcessors = [];
    }
  }
  
  function setupModalButtons() {
    const closeProjectModalBtn = document.getElementById('closeProjectModal');
    const cancelProjectConfigBtn = document.getElementById('cancelProjectConfig');
    const saveProjectConfigBtn = document.getElementById('saveProjectConfig');
    const projectModal = document.getElementById('modalProjectConfig');

    closeProjectModalBtn?.addEventListener('click', () => {
        closeProjectModal();
    });

    cancelProjectConfigBtn?.addEventListener('click', () => {
        closeProjectModal();
    });

    saveProjectConfigBtn?.addEventListener('click', () => {
        saveProjectConfiguration();
        closeProjectModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && projectModal?.getAttribute('aria-hidden') === 'false') {
            closeProjectModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupModalButtons();
});
  
function setupProcessorsSection() {
  if (addProcessorBtn) {
    addProcessorBtn.addEventListener('click', () => {
      addProcessorRow();
    });
  }
  
  // Event delegation for delete buttons
  processorsList.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.delete-processor');
    if (deleteBtn) {
      const row = deleteBtn.closest('.modalConfig-processor-row');
      if (row) {
        const processorSelect = row.querySelector('.processor-select');
        
        // Remove processor from selected set
        if (processorSelect && processorSelect.value) {
          selectedProcessors.delete(processorSelect.value);
        }
        
        // Animate removal
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';
        
        setTimeout(() => {
          row.remove();
          // Refresh all remaining selects
          refreshAllProcessorSelects();
        }, 300);
      }
    }
  });
}
  
function setupToggleUI() {
  const toggleButton = document.getElementById('toggle-ui');
  const settingsButton = document.getElementById('settings');
  const processorModal = document.getElementById('modalProcessorConfig');
  const projectModal = document.getElementById('modalProjectConfig');

  if (!toggleButton || !settingsButton || !processorModal || !projectModal) {
    console.error('Falha ao configurar o Toggle UI: Elementos essenciais não encontrados (toggle-ui, settings, ou modais).');
    return;
  }

  // 1. Listener principal no botão Settings
settingsButton.addEventListener('click', async (event) => {
  event.preventDefault();
  event.stopPropagation();

  const isProjectMode = toggleButton.classList.contains('active');

  if (isProjectMode) {
    // Prepare modal data before opening
    await prepareModalBeforeOpen();
    openModal(projectModal);
  } else {
    openModal(processorModal);
  }
});

  // 2. Listener no botão Toggle para atualizar feedback visual
  toggleButton.addEventListener('click', () => {
    // A classe 'active' pode levar alguns milissegundos para ser aplicada pelo script principal do toggle.
    // Usamos um pequeno timeout para ler o estado *após* a mudança.
    setTimeout(updateVisualFeedback, 50);
  });

  // 3. Atualizar feedback visual no carregamento inicial da página
  updateVisualFeedback();
}

/**
 * Atualiza os textos de status da interface com base no estado do toggle-ui.
 */
function updateVisualFeedback() {
  const toggleButton = document.getElementById('toggle-ui');
  const statusText = document.getElementById("processorProjectOriented");
  const statusTexttwo = document.getElementById("processorNameID");
  
  if (!toggleButton) return; // Segurança

  const isToggleActive = toggleButton.classList.contains('active');

  if (statusText) {
    statusText.style.transition = 'opacity 0.3s ease';
    statusText.style.opacity = "0"; // Fade out

    setTimeout(() => {
      if (isToggleActive) {
        // Modo Projeto
        statusText.innerHTML = `<i class="fa-solid fa-lock"></i> Project Oriented`;
        if (statusTexttwo) statusTexttwo.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
      } else {
        // Modo Processador
        statusText.innerHTML = `<i class="fa-solid fa-lock-open"></i> Processor Oriented`;
      }
      statusText.style.opacity = "1"; // Fade in
    }, 300);
  }
}
  
  // Atualizar o ícone do botão settings
  function updateSettingsButtonIcon(isToggleActive) {
    // Verificar se o botão settings existe
    if (!settingsButton) return;
    
    // Obter o ícone atual
    const iconElement = settingsButton.querySelector('i');
    if (!iconElement) return;
    
    // Iniciar a transição de opacidade
    settingsButton.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    settingsButton.style.opacity = '0';
    
    // Após o fade out, trocar o ícone
    setTimeout(() => {
      // Alterar a classe do ícone com base no estado do toggle
      if (isToggleActive) {
        iconElement.className = 'fa-solid fa-gear'; // Ícone único para projeto
        settingsButton.setAttribute('titles', 'Project Configuration');
      } else {
        iconElement.className = 'fa-solid fa-gears'; // Ícone múltiplo para processador
        settingsButton.setAttribute('titles', 'Processor Configuration');
      }
      
      // Iniciar fade in
      settingsButton.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }
  
// Cache for processor instances mapping
let processorInstancesMap = {};

// projectOriented.js

// New central function to parse all synthesizable files for processor instances
async function parseAllSynthesizableFiles() {
  // Reset the map to ensure a clean state
  processorInstancesMap = {};
  
  // Initialize map for all available processor types
  availableProcessors.forEach(proc => {
    processorInstancesMap[proc] = [];
  });
  
  // Filter for Verilog files only
  const verilogFiles = synthesizableFiles.filter(file => 
    file.path && file.path.toLowerCase().endsWith('.v')
  );

  if (verilogFiles.length === 0) {
    console.log('No synthesizable Verilog files to parse for instances.');
    return; // No files to parse
  }
  
  console.log(`Parsing ${verilogFiles.length} synthesizable file(s) for instances...`);

  // Use Promise.all to read all files in parallel for better performance
  const fileReadPromises = verilogFiles.map(async (fileInfo) => {
    try {
      const fileContent = await window.electronAPI.readFile(fileInfo.path);
      return { content: fileContent, name: fileInfo.name };
    } catch (error) {
      console.error(`Error reading file ${fileInfo.path}:`, error);
      return null; // Return null on error
    }
  });

  const fileContents = await Promise.all(fileReadPromises);

  // Process the content of each successfully read file
  for (const file of fileContents) {
    if (file && file.content) {
      extractInstancesFromContent(file.content, file.name);
    }
  }

  console.log('Finished parsing. Processor instances map:', processorInstancesMap);
}

// Helper function to extract instances from a single file's content
// (This is a slightly modified version of your existing logic)
function extractInstancesFromContent(content, fileName) {
  if (!content) return;

  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip comments and empty lines
    if (line.startsWith('//') || line.startsWith('/*') || line.length === 0) continue;

    for (const processorName of availableProcessors) {
      // Use a regex to ensure it's a whole word match
      const processorRegex = new RegExp(`\\b${processorName}\\b`);
      if (processorRegex.test(line)) {
        
        // Combine lines if declaration spans multiple lines
        let instanceLine = line;
        let lineIndex = i;
        while (lineIndex < lines.length - 1 && !instanceLine.includes('(') && !instanceLine.includes(';')) {
          lineIndex++;
          const nextLine = lines[lineIndex].trim();
          if (nextLine && !nextLine.startsWith('//')) {
            instanceLine += ' ' + nextLine;
          }
        }
        
        // Regex to find instance name after processor type, accounting for parameters
        const instanceRegex = new RegExp(
          `\\b${processorName}\\s*(?:#\\s*\\([^)]*\\))?\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`
        );
        
        const match = instanceLine.match(instanceRegex);
        
        if (match && match[1]) {
          const instanceName = match[1];
          const verilogKeywords = ['module', 'endmodule', 'input', 'output', 'wire', 'reg'];
          
          if (!verilogKeywords.includes(instanceName.toLowerCase())) {
            // Add instance to the map if it's not already there
            if (!processorInstancesMap[processorName].includes(instanceName)) {
              processorInstancesMap[processorName].push(instanceName);
            }
          }
        }
      }
    }
  }
}

// Parse Verilog files to extract processor instances from synthesizable files
async function parseProcessorInstances() {
  try {
    processorInstancesMap = {};
    
    // Initialize map for all available processors
    for (const processor of availableProcessors) {
      processorInstancesMap[processor] = [];
    }
    
    // Load current project configuration to get synthesizable files
    const configData = await loadProjectConfiguration();
    
    if (!configData || !configData.synthesizableFiles || configData.synthesizableFiles.length === 0) {
      console.warn('No synthesizable files found in project configuration');
      return;
    }
    
    console.log('Processing synthesizable files:', configData.synthesizableFiles);
    
    // Process each synthesizable file to find processor instances
    for (const fileInfo of configData.synthesizableFiles) {
      try {
        // Use the full path from the configuration
        const filePath = fileInfo.path;
        
        // Check if file exists
        const fileExists = await window.electronAPI.fileExists(filePath);
        if (!fileExists) {
          console.warn(`File does not exist: ${filePath}`);
          continue;
        }
        
        console.log(`Reading file: ${filePath}`);
        const fileContent = await window.electronAPI.readFile(filePath);
        extractAllInstancesFromContent(fileContent, fileInfo.name);
        
      } catch (error) {
        console.error(`Error processing file ${fileInfo.name}:`, error);
        continue;
      }
    }
    
    console.log('Processor instances map:', processorInstancesMap);
    
  } catch (error) {
    console.error('Error parsing processor instances:', error);
  }
}

// Extract all processor instances from a single Verilog file content
function extractAllInstancesFromContent(content, fileName) {
  if (!content) {
    console.warn(`Empty content for file: ${fileName}`);
    return;
  }
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip comments and empty lines
    if (line.startsWith('//') || line.startsWith('/*') || line.length === 0) continue;
    
    // Check each available processor
    for (const processorName of availableProcessors) {
      if (line.includes(processorName)) {
        // Check if this line contains processor instantiation
        let instanceLine = line;
        let lineIndex = i;
        
        // Sometimes the instance name is on the next line, so we concatenate lines
        // until we find the opening parenthesis or semicolon
        while (lineIndex < lines.length - 1 && !instanceLine.includes('(') && !instanceLine.includes(';')) {
          lineIndex++;
          const nextLine = lines[lineIndex].trim();
          if (nextLine && !nextLine.startsWith('//')) {
            instanceLine += ' ' + nextLine;
          }
        }
        
        // Extract instance name using multiple regex patterns
        const patterns = [
          // Standard pattern: processor_name instance_name (
          new RegExp(`\\b${processorName}\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`),
          // Pattern with parameters: processor_name #(...) instance_name (
          new RegExp(`\\b${processorName}\\s*#\\s*\\([^)]*\\)\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`),
          // Simple pattern: processor_name instance_name;
          new RegExp(`\\b${processorName}\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*;`)
        ];
        
        for (const regex of patterns) {
          const match = instanceLine.match(regex);
          
          if (match && match[1]) {
            const instanceName = match[1];
            
            // Validate instance name (shouldn't be a Verilog keyword)
            const verilogKeywords = ['module', 'endmodule', 'input', 'output', 'wire', 'reg', 'always', 'assign'];
            if (!verilogKeywords.includes(instanceName.toLowerCase())) {
              
              // Add instance to the processor if not already present
              if (!processorInstancesMap[processorName].includes(instanceName)) {
                processorInstancesMap[processorName].push(instanceName);
                console.log(`Found instance "${instanceName}" of processor "${processorName}" in file "${fileName}"`);
              }
            }
            break; // Found a match, no need to try other patterns
          }
        }
      }
    }
  }
}


  // Carregar arquivos .v e .gtkw para as listas suspensas
  async function loadFileOptions() {
    try {
      // Obtém o caminho do projeto atual através do API
      let projectPath = window.currentProjectPath;
      
      // Se não estiver definido, tenta obtê-lo via API
      if (!projectPath) {
        try {
          const projectData = await window.electronAPI.getCurrentProject();
          // Verificar se projectData é um objeto e extrair o caminho correto
          if (projectData && typeof projectData === 'object' && projectData.projectPath) {
            projectPath = projectData.projectPath;
            // Atualiza a variável global
            window.currentProjectPath = projectPath;
          } else if (typeof projectData === 'string') {
            // Caso a API retorne diretamente o caminho como string
            projectPath = projectData;
            window.currentProjectPath = projectPath;
          } else {
            console.error('Formato de dados do projeto inválido:', projectData);
          }
        } catch (err) {
          console.warn('Falha ao obter caminho do projeto via API:', err);
        }
      }
      
      // Verifica novamente se o caminho do projeto está disponível
      if (!projectPath) {
        console.error('Caminho do projeto atual não encontrado');
        // Exibe mensagem visual para o usuário
        showNoProjectError();
        return;
      }
      
      console.log('Usando caminho do projeto:', projectPath);
      
      // Tentar primeiro na pasta TopLevel (se existir)
      const topLevelPath = await window.electronAPI.joinPath(projectPath, 'TopLevel');
      let topLevelExists = false;
      
      try {
        topLevelExists = await window.electronAPI.directoryExists(topLevelPath);
      } catch (err) {
        console.warn('Erro ao verificar existência da pasta TopLevel:', err);
      }
      
      // Definir o caminho onde procurar os arquivos
      const searchPath = topLevelExists ? topLevelPath : projectPath;
      console.log('Procurando arquivos em:', searchPath);
      
      // Obter arquivos usando o caminho correto
      try {
        foundVerilogFiles = await window.electronAPI.getFilesWithExtension(searchPath, '.v');
        foundGtkwaveFiles = await window.electronAPI.getFilesWithExtension(searchPath, '.gtkw');
      } catch (err) {
        console.error('Erro ao obter arquivos:', err);
        foundVerilogFiles = [];
        foundGtkwaveFiles = [];
      }
      
      // Limpar e popular as listas suspensas
      populateSelectOptions(topLevelSelect, foundVerilogFiles);
      populateSelectOptions(testbenchSelect, foundVerilogFiles);
      populateSelectOptions(gtkwaveSelect, foundGtkwaveFiles);
      
      // Exibir log de arquivos encontrados
      console.log('Arquivos Verilog (.v) encontrados:', foundVerilogFiles);
      console.log('Arquivos GTKWave (.gtkw) encontrados:', foundGtkwaveFiles);
    } catch (error) {
      console.error('Erro ao carregar arquivos para as listas suspensas:', error);
    }
  }
  
  // Função para exibir erro visual quando não há projeto
  function showNoProjectError() {
    // Adicionar mensagem visual ao modal
    const errorDiv = document.createElement('div');
    errorDiv.className = 'project-error-message';
    errorDiv.innerHTML = `
      <div class="alert alert-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Nenhum projeto aberto. Por favor, abra ou crie um projeto primeiro.
      </div>
    `;
    
    // Adicionar no início do modal
    const modalContent = document.querySelector('.modalConfig-content');
    if (modalContent && !modalContent.querySelector('.project-error-message')) {
      modalContent.insertBefore(errorDiv, modalContent.firstChild);
    }
    
    // Adicionar estilo para a mensagem
    const style = document.createElement('style');
    style.textContent = `
      .project-error-message {
        margin-bottom: 15px;
      }
      .alert {
        padding: 10px 15px;
        border-radius: 4px;
        font-weight: bold;
      }
      .alert-warning {
        background-color: #fff3cd;
        color: #856404;
        border: 1px solid #ffeeba;
      }
      .alert i {
        margin-right: 8px;
      }
    `;
    document.head.appendChild(style);
  }
  
  // Popular uma lista suspensa com opções
  function populateSelectOptions(selectElement, files) {
  if (!selectElement) return;
  
  // Save current selected value (if any)
  const currentSelectedValue = selectElement.value;
  
  // Clear all existing options
  selectElement.innerHTML = '';

  // Cria a opção "Standard" e define como selecionada por padrão
  const standardOption = document.createElement('option');
  standardOption.value = 'Standard';
  standardOption.textContent = 'Standard File';
  standardOption.selected = true; // <- define como default
  selectElement.appendChild(standardOption);

    
  // Add new options from files
  files.forEach(file => {
    const option = document.createElement('option');
    
    // Extract only the filename from the full path
    const fileName = file.split('/').pop().split('\\').pop();
    
    option.value = fileName;
    option.textContent = fileName;
    selectElement.appendChild(option);
  });
  
  // Try to restore previous selection
  if (currentSelectedValue && Array.from(selectElement.options).some(opt => opt.value === currentSelectedValue)) {
    selectElement.value = currentSelectedValue;
  } else {
    selectElement.selectedIndex = 0;
  }
}

async function prepareModalBeforeOpen() {
  try {
    await loadAvailableProcessors();
    await loadProjectConfiguration();
    
    // Parse all synthesizable files for instances
    await parseAllSynthesizableFiles();
    
    // Update the form with loaded configuration
    updateFormWithConfig();
    
    console.log('Modal prepared with processor instances:', processorInstancesMap);
  } catch (error) {
    console.error('Error preparing modal:', error);
    showNotification('Error loading project configuration', 'error', 3000);
  }
}


// Modern Drag and Drop Styles Function
function addDragDropStyles() {
  const styleElement = document.createElement('style');
  styleElement.textContent = `

  `;
  document.head.appendChild(styleElement);
}

// Call addDragDropStyles when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  addDragDropStyles();
});
  
  // Mostrar um prompt visual para selecionar arquivos se for necessário
  function showFileSelectionPrompt() {
    // Verificar se temos alguma configuração salva
    const isFirstTime = !currentConfig.topLevelFile && !currentConfig.testbenchFile && !currentConfig.gtkwaveFile;
    
    if (isFirstTime) {
      // Adicionar classe visual para indicar que precisa selecionar
      if (topLevelSelect) {
        topLevelSelect.classList.add('needs-selection');
        const label = topLevelSelect.closest('.modalConfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      if (testbenchSelect) {
        testbenchSelect.classList.add('needs-selection');
        const label = testbenchSelect.closest('.modalConfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      if (gtkwaveSelect) {
        gtkwaveSelect.classList.add('needs-selection');
        const label = gtkwaveSelect.closest('.modalConfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      // Adicionar estilo CSS para indicação visual
      const styleElement = document.createElement('style');
      styleElement.textContent = `
        .needs-selection {
          border: 1px solid #2563eb;
        }
        .selection-required {
          color: #2563eb;
          font-weight: bold;
        }
      `;
      document.head.appendChild(styleElement);
      
      // Exibir mensagem no console
      console.log('Primeira configuração! Por favor, selecione um arquivo de cada tipo.');
    }
  }
  
 async function loadProjectConfiguration() {
  try {
    // Reset current configuration
    currentConfig = {
      topLevelFile: '',
      testbenchFile: '',
      gtkwaveFile: '',
      processors: [],
      iverilogFlags: ''
    };
    
    // Clear file arrays
    synthesizableFiles = [];
    testbenchFiles = [];
    gtkwFiles = [];
    
    // Get project path
    let projectPath = window.currentProjectPath;
    
    if (!projectPath) {
      try {
        const projectData = await window.electronAPI.getCurrentProject();
        if (projectData && typeof projectData === 'object' && projectData.projectPath) {
          projectPath = projectData.projectPath;
          window.currentProjectPath = projectPath;
        } else if (typeof projectData === 'string') {
          projectPath = projectData;
          window.currentProjectPath = projectPath;
        }
      } catch (err) {
        console.warn('Failed to get project path via API:', err);
      }
    }
    
    if (!projectPath) {
      console.error('Project path not available. Cannot load configuration.');
      return;
    }
    
    // Use joinPath API function
    const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
    
    // Check if configuration file exists
    const configExists = await window.electronAPI.fileExists(configPath);
    
    if (configExists) {
      const configContent = await window.electronAPI.readFile(configPath);
      const configData = JSON.parse(configContent);
      currentConfig = configData;
      
      console.log('Configuration loaded:', currentConfig);
      
      // Load synthesizable files e VERIFICAR paths
      if (currentConfig.synthesizableFiles) {
        const validFiles = [];
        
        for (const fileData of currentConfig.synthesizableFiles) {
          // Verificar se o arquivo ainda existe
          if (fileData.path && fileData.path !== '') {
            const exists = await window.electronAPI.fileExists(fileData.path);
            
            if (exists) {
              validFiles.push({
                name: fileData.name,
                path: fileData.path,
                starred: fileData.starred || false,
                size: fileData.size || 0,
                type: fileData.type || 'text/plain'
              });
            } else {
              console.warn(`File no longer exists: ${fileData.path}`);
              showNotification(`File not found: ${fileData.name}`, 'warning', 2000);
            }
          } else {
            console.warn(`File loaded without path: ${fileData.name}`);
          }
        }
        
        synthesizableFiles = validFiles;
      }
      
      // Mesmo processo para testbench files
      if (currentConfig.testbenchFiles) {
        const validFiles = [];
        
        for (const fileData of currentConfig.testbenchFiles) {
          if (fileData.path && fileData.path !== '') {
            const exists = await window.electronAPI.fileExists(fileData.path);
            
            if (exists) {
              validFiles.push({
                name: fileData.name,
                path: fileData.path,
                starred: fileData.starred || false,
                size: fileData.size || 0,
                type: fileData.type || 'text/plain'
              });
            } else {
              console.warn(`File no longer exists: ${fileData.path}`);
            }
          }
        }
        
        testbenchFiles = validFiles;
      }
      
      // Mesmo processo para gtkw files
      if (currentConfig.gtkwFiles) {
        const validFiles = [];
        
        for (const fileData of currentConfig.gtkwFiles) {
          if (fileData.path && fileData.path !== '') {
            const exists = await window.electronAPI.fileExists(fileData.path);
            
            if (exists) {
              validFiles.push({
                name: fileData.name,
                path: fileData.path,
                starred: fileData.starred || false,
                size: fileData.size || 0,
                type: fileData.type || 'text/plain'
              });
            }
          }
        }
        
        gtkwFiles = validFiles;
      }
      
      // Update file lists
      updateFileList('synthesizable');
      updateFileList('testbench');
      
      return configData;
    }
  } catch (error) {
    console.error('Error loading project configuration:', error);
  }
}
  
function updateFormWithConfig() {
  // Clear existing processor rows and tracking
  if (processorsList) {
    processorsList.innerHTML = '';
  }
  selectedProcessors.clear();
  
  // Set iverilog flags
  if (iverilogFlags && currentConfig.iverilogFlags) {
    iverilogFlags.value = currentConfig.iverilogFlags;
  }

  // Set "Show Arrays" checkbox state
  const showArraysCheckbox = document.getElementById('showArraysInGtkwave-project');
  if (showArraysCheckbox && currentConfig.showArraysInGtkwave !== undefined) {
    showArraysCheckbox.checked = currentConfig.showArraysInGtkwave === 1;
  }
  
  // Load processor configuration from JSON
  if (currentConfig.processors && currentConfig.processors.length > 0) {
    currentConfig.processors.forEach(processor => {
      addProcessorRow();
      const lastRow = processorsList.querySelector('.modalConfig-processor-row:last-child');
      if (lastRow) {
        const processorSelect = lastRow.querySelector('.processor-select');
        const instanceSelect = lastRow.querySelector('.processor-instance');
        
        if (processorSelect && processor.type) {
          // Mark as selected and store previous value
          selectedProcessors.add(processor.type);
          processorSelect.dataset.previousValue = processor.type;
          
          // Populate with available processors including the selected one
          populateAvailableProcessors(processorSelect, processor.type);
          processorSelect.value = processor.type;
          
          // Update instance select
          updateInstanceSelect(processor.type, instanceSelect);
          
          // Set instance value after options are populated
          setTimeout(() => {
            if (instanceSelect && processor.instance) {
              instanceSelect.value = processor.instance;
            }
          }, 100);
        }
      }
    });
  } else {
    // If no processors configured, add one empty row
    addProcessorRow();
  }
}

// Add visual indicator for remaining processors
function updateProcessorAvailabilityIndicator() {
  const remainingCount = availableProcessors.length - selectedProcessors.size;
  
  // Create or update indicator
  let indicator = document.getElementById('processor-availability-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'processor-availability-indicator';
    indicator.style.cssText = `
      padding: var(--space-2) var(--space-4);
      background-color: var(--accent-subtle-bg);
      border: 1px solid var(--accent-primary);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      color: var(--accent-secondary);
      margin-bottom: var(--space-4);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    `;
    
    const processorsSection = document.querySelector('.processors-list').parentElement;
    processorsSection.insertBefore(indicator, processorsList);
  }
  
  if (remainingCount === 0) {
    indicator.innerHTML = `
      <i class="fa-solid fa-circle-check" style="color: var(--success);"></i>
      <span>All processors assigned</span>
    `;
    indicator.style.borderColor = 'var(--success)';
    indicator.style.backgroundColor = '#ecfdf5';
  } else {
    indicator.innerHTML = `
      <i class="fa-solid fa-info-circle" style="color: var(--accent-primary);"></i>
      <span>${remainingCount} processor${remainingCount !== 1 ? 's' : ''} available to assign</span>
    `;
    indicator.style.borderColor = 'var(--accent-primary)';
    indicator.style.backgroundColor = 'var(--accent-subtle-bg)';
  }
}

// Update processor row to use select for instances
let selectedProcessors = new Set();

// Modified addProcessorRow function with dynamic filtering
function addProcessorRow() {
  const newRow = document.createElement('div');
  newRow.className = 'modalConfig-processor-row';
  
  newRow.innerHTML = `
    <div class="modalConfig-select-container">
      <label>Processor Type</label>
      <select class="processor-select modalConfig-select">
        <option value="">Select Processor</option>
      </select>
    </div>
    <div class="modalConfig-select-container">
      <label>Instance Name</label>
      <select class="processor-instance modalConfig-select" disabled>
        <option value="">Select Instance</option>
      </select>
    </div>
    <button class="delete-processor modalConfig-icon-btn" aria-label="Delete Processor">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  
  const processorSelect = newRow.querySelector('.processor-select');
  const instanceSelect = newRow.querySelector('.processor-instance');
  
  // Populate only available processors
  populateAvailableProcessors(processorSelect);
  
  // Event listener for processor selection
  processorSelect.addEventListener('change', function() {
    const previousValue = this.dataset.previousValue || '';
    const newValue = this.value;
    
    // Return previous processor to available pool
    if (previousValue && previousValue !== '') {
      selectedProcessors.delete(previousValue);
    }
    
    // Mark new processor as selected
    if (newValue && newValue !== '') {
      selectedProcessors.add(newValue);
      this.dataset.previousValue = newValue;
    }
    
    // Update instance select
    updateInstanceSelect(newValue, instanceSelect);
    
    // Refresh all processor selects to update availability
    refreshAllProcessorSelects();
  });
  
  // Event listener for instance changes
  instanceSelect.addEventListener('change', function() {
    // Optional: Add any instance-specific logic here
  });
  
  processorsList.appendChild(newRow);
  
  // Store reference to row for cleanup
  newRow.dataset.rowId = Date.now();
}

// Refresh all processor selects to show/hide based on current selections
function refreshAllProcessorSelects() {
  const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');
  
  processorRows.forEach(row => {
    const processorSelect = row.querySelector('.processor-select');
    if (processorSelect) {
      const currentValue = processorSelect.value;
      populateAvailableProcessors(processorSelect, currentValue);
    }
  });
  
  // Update availability indicator
  updateProcessorAvailabilityIndicator();
}

// Populate processor select with only available (unselected) processors
function populateAvailableProcessors(selectElement, selectedValue = '') {
  if (!selectElement) return;
  
  // Clear existing options
  selectElement.innerHTML = '<option value="">Select Processor</option>';
  
  // Add available processors (not selected in other rows)
  availableProcessors.forEach(processor => {
    // Show processor if: it's not selected OR it's the current selection for this row
    const previousValue = selectElement.dataset.previousValue || '';
    if (!selectedProcessors.has(processor) || processor === previousValue || processor === selectedValue) {
      const option = document.createElement('option');
      option.value = processor;
      option.textContent = processor;
      
      if (processor === selectedValue) {
        option.selected = true;
      }
      
      selectElement.appendChild(option);
    }
  });
}

  // Atualizar um select de processador com os processadores disponíveis
  function updateInstanceSelect(processorType, instanceSelectElement) {
  if (!instanceSelectElement) return;
  
  // Clear existing options
  instanceSelectElement.innerHTML = '<option value="">Select Instance</option>';
  
  if (!processorType || processorType === '') {
    instanceSelectElement.disabled = true;
    return;
  }
  
  // Enable the select
  instanceSelectElement.disabled = false;
  
  // Get instances for this processor type from the map
  const instances = processorInstancesMap[processorType] || [];
  
  if (instances.length === 0) {
    const noInstanceOption = document.createElement('option');
    noInstanceOption.value = '';
    noInstanceOption.textContent = 'No instances found';
    noInstanceOption.disabled = true;
    instanceSelectElement.appendChild(noInstanceOption);
    return;
  }
  
  // Populate with available instances
  instances.forEach(instance => {
    const option = document.createElement('option');
    option.value = instance;
    option.textContent = instance;
    instanceSelectElement.appendChild(option);
  });
}

function refreshAllInstanceSelects() {
  const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');
  
  // Collect all currently selected instances
  const selectedInstances = new Set();
  processorRows.forEach(row => {
    const instanceSelect = row.querySelector('.processor-instance');
    if (instanceSelect && instanceSelect.value) {
      selectedInstances.add(instanceSelect.value);
    }
  });
  
  // Update each row
  processorRows.forEach(row => {
    const processorSelect = row.querySelector('.processor-select');
    const instanceSelect = row.querySelector('.processor-instance');
    
    if (processorSelect && instanceSelect) {
      const currentProcessor = processorSelect.value;
      const currentInstance = instanceSelect.value;
      
      if (currentProcessor) {
        // Update the options for this instance select
        updateInstanceSelect(currentProcessor, instanceSelect);
        
        // Restore the previously selected value if it still exists
        if (currentInstance) {
          const optionExists = Array.from(instanceSelect.options).some(
            opt => opt.value === currentInstance
          );
          if (optionExists) {
            instanceSelect.value = currentInstance;
          }
        }
      }
    }
  });
}

// Modified collectFormData function to work with file lists
function collectFormData() {
  const starredSynthesizable = synthesizableFiles.find(file => file.starred);
  const starredTestbench = testbenchFiles.find(file => file.starred);
  const starredGtkw = gtkwFiles.find(file => file.starred);
  
  const config = {
    topLevelFile: starredSynthesizable ? starredSynthesizable.path : '',
    testbenchFile: starredTestbench ? starredTestbench.path : '',
    gtkwaveFile: starredGtkw ? starredGtkw.path : '',
    synthesizableFiles: synthesizableFiles.map(file => ({
      name: file.name,
      path: file.path,  // ← Adiciona o path completo
      starred: file.starred || false  // ← Adiciona o estado starred
    })),
    testbenchFiles: testbenchFiles.map(file => ({
      name: file.name,
      path: file.path,  // ← Adiciona o path completo
      starred: file.starred || false  // ← Adiciona o estado starred
    })),
    gtkwFiles: gtkwFiles.map(file => ({
      name: file.name,
      path: file.path,  // ← Adiciona o path completo
      starred: file.starred || false  // ← Adiciona o estado starred
    })),
    processors: [],
    iverilogFlags: iverilogFlags ? iverilogFlags.value : ''
  };
  
  // Collect processor data
  const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');
  processorRows.forEach(row => {
    const processorSelect = row.querySelector('.processor-select');
    const instanceSelect = row.querySelector('.processor-instance');
    
    if (processorSelect && instanceSelect && processorSelect.value && instanceSelect.value) {
      config.processors.push({
        type: processorSelect.value,
        instance: instanceSelect.value
      });
    }
  });
  
  return config;
}
  
  // Função para atualizar a exibição dos tipos de processadores
async function updateProcessorStatus() {
  const el = document.getElementById('processorNameID');
  if (!el) {
    console.warn('Processor status element not found in DOM');
    return;
  }

  // Função auxiliar que retorna uma Promise resolvida após X milissegundos
  const delay = ms => new Promise(res => setTimeout(res, ms));

  // dispara fade-out
  el.style.opacity = '0';

  // espera o tempo da transição (300ms aqui, caso você use 0.3s no CSS)
  await delay(300);

  // agora troca o conteúdo
  if (currentConfig?.processors?.length > 0) {
    const types = currentConfig.processors.map(p => p.type);
    const unique = [...new Set(types)];
    // CORREÇÃO: Verificar se testbenchSelect existe antes de acessar .value
    const processorTb = testbenchSelect ? testbenchSelect.value : '';

    el.innerHTML = `${unique.join(' | ')}&nbsp;<i class="fa-solid fa-gear"></i> ${processorTb || 'None'}`;
    el.classList.add('has-processors');
  } else {
    el.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
    el.classList.remove('has-processors');
  }

  // dispara fade-in
  el.style.opacity = '1';
}

async function saveProjectConfiguration() {
  try {
    // Get current project path
    let projectPath = window.currentProjectPath;
    
    if (!projectPath) {
      try {
        const projectData = await window.electronAPI.getCurrentProject();
        if (projectData && typeof projectData === 'object' && projectData.projectPath) {
          projectPath = projectData.projectPath;
          window.currentProjectPath = projectPath;
        } else if (typeof projectData === 'string') {
          projectPath = projectData;
          window.currentProjectPath = projectPath;
        }
      } catch (err) {
        console.warn('Failed to get project path via API:', err);
      }
    }
    
    if (!projectPath) {
      showNotification('Project path not available. Cannot save configuration.', 'error', 4000);
      return;
    }
    
    // Get starred files
    const starredSynthesizable = synthesizableFiles.find(file => file.starred);
    const starredTestbench = testbenchFiles.find(file => file.starred);
    const starredGtkw = gtkwFiles.find(file => file.starred);
    
    // Get processors configuration
    const processors = [];
    const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');

    processorRows.forEach(row => {
      const processorSelect = row.querySelector('.processor-select');
      const instanceSelect = row.querySelector('.processor-instance');
      
      if (processorSelect && instanceSelect) {
        const processorType = processorSelect.value;
        const instanceName = instanceSelect.value;
        
        if (processorType && processorType !== '' && instanceName && instanceName !== '') {
          processors.push({
            type: processorType,
            instance: instanceName
          });
        }
      }
    });
    
    // Get iverilog flags
    const iverilogFlagsValue = iverilogFlags ? iverilogFlags.value : '';
    
    // Get simulation delay
    const projectSimuDelayInput = document.getElementById('projectSimuDelay');
    const simuDelayValue = projectSimuDelayInput ? projectSimuDelayInput.value : '200000';

    // Handle the "Show Arrays" checkbox
    const showArraysCheckbox = document.getElementById('showArraysInGtkwave-project');
    const showArraysValue = showArraysCheckbox && showArraysCheckbox.checked ? 1 : 0;
    
    // Create configuration object
    const config = {
      topLevelFile: starredSynthesizable ? starredSynthesizable.path : '',
      testbenchFile: starredTestbench ? starredTestbench.path : '',
      gtkwaveFile: starredGtkw ? starredGtkw.path : '',
      synthesizableFiles: synthesizableFiles.map(file => ({
        name: file.name,
        path: file.path,  // ← Path completo
        starred: file.starred || false  // ← Estado starred
      })),
      testbenchFiles: testbenchFiles.map(file => ({
        name: file.name,
        path: file.path,  // ← Path completo
        starred: file.starred || false  // ← Estado starred
      })),
      gtkwFiles: gtkwFiles.map(file => ({
        name: file.name,
        path: file.path,  // ← Path completo
        starred: file.starred || false  // ← Estado starred
      })),
      processors: processors,
      iverilogFlags: iverilogFlagsValue,
      simuDelay: simuDelayValue,
      showArraysInGtkwave: showArraysValue
    };
    
    // Save configuration to file
    const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
    await window.electronAPI.writeFile(configPath, JSON.stringify(config, null, 2));
    
    console.log('Project configuration saved:', config);
    showNotification('Project configuration saved successfully!', 'success', 3000);
    
    // Update current config
    currentConfig = config;
    
    // Update processor status display
    await updateProcessorStatus();
    
  } catch (error) {
    console.error('Error saving project configuration:', error);
    showNotification('Failed to save project configuration. Please try again.', 'error', 4000);
  }
}


  // Função para fechar o modal do projeto
  function closeProjectModal() {
    if (projectModal) {
      projectModal.classList.remove('active');
      
      // Pequeno delay antes de esconder completamente para permitir a animação
      setTimeout(() => {
        projectModal.hidden = true;
      }, 300);
    }
  }
  
  // Função para abrir o modal e preparar os dados
  async function openProjectModal() {
    if (projectModal) {
      // Mostrar o modal primeiro para evitar impressão de que nada aconteceu
      projectModal.hidden = false;
      projectModal.classList.add("active");
      
      // Em seguida, carregar os dados
      await prepareModalBeforeOpen();
    }
  }

  // Função 1: Notificação Moderna com Barra de Progresso
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

// Função 2: Notificação com Toast Animado
function showToastNotification(message, type = 'info', duration = 3000) {
  // Crie um container para a notificação se não existir
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.position = 'fixed';
    toastContainer.style.top = '20px';
    toastContainer.style.right = '20px';
    toastContainer.style.maxWidth = '100%';
    toastContainer.style.width = '350px';
    toastContainer.style.zIndex = 'var(--z-max)';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = 'var(--space-3)';
    
    // Torna responsivo em telas pequenas
    const mediaQuery = `
      @media (max-width: 480px) {
        #toast-container {
          width: calc(100% - 40px) !important;
          top: 10px !important;
          right: 20px !important;
        }
      }
    `;
    const style = document.createElement('style');
    style.textContent = mediaQuery;
    document.head.appendChild(style);
    
    document.body.appendChild(toastContainer);
  }
  
  // Verificar se o FontAwesome está carregado, caso contrário, carregar
  if (!document.querySelector('link[href*="fontawesome"]')) {
    const fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
    document.head.appendChild(fontAwesomeLink);
  }
  
  // Definir aparência com base no tipo
  let iconClass, bgColor, textColor;
  
  switch (type) {
    case 'error':
      iconClass = 'fa-circle-xmark';
      bgColor = 'var(--error)';
      textColor = '#fff';
      break;
    case 'success':
      iconClass = 'fa-circle-check';
      bgColor = 'var(--success)';
      textColor = '#fff';
      break;
    case 'warning':
      iconClass = 'fa-triangle-exclamation';
      bgColor = 'var(--warning)';
      textColor = '#fff';
      break;
    default: // info
      iconClass = 'fa-circle-info';
      bgColor = 'var(--info)';
      textColor = '#fff';
      break;
  }
  
  // Criar o toast
  const toast = document.createElement('div');
  toast.style.backgroundColor = bgColor;
  toast.style.color = textColor;
  toast.style.padding = 'var(--space-4)';
  toast.style.borderRadius = 'var(--radius-md)';
  toast.style.boxShadow = 'var(--shadow-md)';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.justifyContent = 'space-between';
  toast.style.gap = 'var(--space-3)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-20px)';
  toast.style.transition = 'var(--transition-normal)';
  
  // Conteúdo do toast
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: var(--space-3); flex-grow: 1;">
      <i class="fa-solid ${iconClass}" style="font-size: var(--text-xl);"></i>
      <div style="font-weight: var(--font-medium); font-size: var(--text-sm); word-break: break-word;">
        ${message}
      </div>
    </div>
    <div class="close-btn" style="cursor: pointer; font-size: var(--text-lg);">
      <i class="fa-solid fa-xmark"></i>
    </div>
  `;
  
  // Anexar ao container
  toastContainer.appendChild(toast);
  
  // Animação de entrada
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  // Configurar botão de fechar
  const closeBtn = toast.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => closeToast(toast));
  
  // Fechar automaticamente após a duração
  const timeoutId = setTimeout(() => closeToast(toast), duration);
  
  // Pausar o tempo quando passar o mouse por cima
  toast.addEventListener('mouseenter', () => {
    clearTimeout(timeoutId);
  });
  
  // Continuar quando tirar o mouse
  toast.addEventListener('mouseleave', () => {
    setTimeout(() => closeToast(toast), duration / 2);
  });
  
  // Função para fechar o toast com animação
  function closeToast(element) {
    element.style.opacity = '0';
    element.style.transform = 'translateY(-20px)';
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
        
        // Remover o container se não houver mais toasts
        if (toastContainer.children.length === 0) {
          toastContainer.remove();
        }
      }
    }, 300);
  }
  
  // Retornar um identificador que permite fechar o toast programaticamente
  return {
    close: () => closeToast(toast)
  };
}
  
  // Exportar funções que precisam ser acessadas externamente
  window.projectOrientedConfig = {
    openModal: openProjectModal,
    saveConfig: saveProjectConfiguration,
    loadConfig: loadProjectConfiguration
  };
  
  // Inicializar após um pequeno atraso
  setTimeout(init, 800);
});

// Adicione isso se o fechamento do modal do processador também quebrou.


function openProjectModal() {
    const projectModal = document.getElementById('modalProjectConfig');
    if (projectModal) {
        projectModal.setAttribute('aria-hidden', 'false');
        projectModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeProjectModal() {
    const projectModal = document.getElementById('modalProjectConfig');
    if (projectModal) {
        projectModal.setAttribute('aria-hidden', 'true');
        projectModal.classList.remove('show');
        // Apenas restaura o scroll se nenhum outro modal estiver aberto
        if (!document.querySelector('.modal-overlay[aria-hidden="false"]')) {
            document.body.style.overflow = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const closeProjectModalBtn = document.getElementById('closeProjectModal');
    const cancelProjectConfigBtn = document.getElementById('cancelProjectConfig');
    const saveProjectConfigBtn = document.getElementById('saveProjectConfig');
    const projectModal = document.getElementById('modalProjectConfig');

    // Event listeners para fechar o modal
    closeProjectModalBtn?.addEventListener('click', closeProjectModal);
    cancelProjectConfigBtn?.addEventListener('click', closeProjectModal);
    
    // O botão de salvar também deve fechar o modal após a ação
    saveProjectConfigBtn?.addEventListener('click', () => {
        // A função saveProjectConfiguration() que você já tem será executada
        // e depois o modal será fechado.
        closeProjectModal();
    });

    // Fecha o modal se clicar fora da área do container
});