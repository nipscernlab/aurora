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
  const clearAllBtn = document.getElementById('clearAll');
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
  setupFileInputs();
}

// Setup import buttons
function setupImportButtons() {
  if (importSynthesizableBtn) {
    importSynthesizableBtn.addEventListener('click', () => {
      synthesizableFileInput.click();
    });
  }
  
  if (importTestbenchBtn) {
    importTestbenchBtn.addEventListener('click', () => {
      testbenchFileInput.click();
    });
  }
}

// Setup file input handlers
function setupFileInputs() {
  if (synthesizableFileInput) {
    synthesizableFileInput.addEventListener('change', (e) => {
      handleFileImport(e.target.files, 'synthesizable');
      e.target.value = ''; // Clear input
    });
  }
  
  if (testbenchFileInput) {
    testbenchFileInput.addEventListener('change', (e) => {
      handleFileImport(e.target.files, 'testbench');
      e.target.value = ''; // Clear input
    });
  }
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
}

// Remove highlight from drop area
function unhighlight(dropArea) {
  dropArea.classList.remove('dragover');
}

// Handle file drop events
function handleDrop(e, type) {
  const files = e.dataTransfer.files;
  handleFileImport(files, type);
}

// Handle file import (both drag & drop and button click) - IMPROVED
function handleFileImport(files, type) {
  const validFiles = [];
  
  // Filter and validate files
  for (let file of files) {
    if (validateFile(file, type)) {
      // Check for duplicates
      const existingFiles = type === 'synthesizable' ? synthesizableFiles : testbenchFiles;
      if (!existingFiles.some(f => f.name === file.name)) {
        validFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          starred: false,
          lastModified: file.lastModified
        });
      } else {
        showFileError(`File "${file.name}" already exists in the ${type} list.`);
      }
    }
  }
  
  // Add valid files to appropriate array
  if (type === 'synthesizable') {
    synthesizableFiles.push(...validFiles);
    updateFileList('synthesizable');
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
  
  // Save configuration if files were added
  if (validFiles.length > 0) {
    saveProjectConfiguration();
    showFileSuccess(`Successfully added ${validFiles.length} file(s) to ${type} list.`);
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
  
  // Clear current list
  fileList.innerHTML = '';
  
  if (type === 'synthesizable') {
    if (synthesizableFiles.length === 0) {
      // Show empty state
      if (emptyState) {
        emptyState.style.display = 'flex';
        fileList.appendChild(emptyState.cloneNode(true));
      }
    } else {
      // Hide empty state and show files
      if (emptyState) {
        emptyState.style.display = 'none';
      }
      
      // Sort files: starred first, then alphabetically
      const sortedFiles = [...synthesizableFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedFiles.forEach((file, originalIndex) => {
        const actualIndex = synthesizableFiles.findIndex(f => f.name === file.name);
        const fileItem = createFileItem(file, actualIndex, 'synthesizable');
        fileList.appendChild(fileItem);
      });
    }
  } else if (type === 'testbench') {
    const totalFiles = testbenchFiles.length + gtkwFiles.length;
    
    if (totalFiles === 0) {
      // Show empty state
      if (emptyState) {
        emptyState.style.display = 'flex';
        fileList.appendChild(emptyState.cloneNode(true));
      }
    } else {
      // Hide empty state and show files
      if (emptyState) {
        emptyState.style.display = 'none';
      }
      
      // Sort and display testbench files
      const sortedTestbench = [...testbenchFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedTestbench.forEach((file, originalIndex) => {
        const actualIndex = testbenchFiles.findIndex(f => f.name === file.name);
        const fileItem = createFileItem(file, actualIndex, 'testbench');
        fileList.appendChild(fileItem);
      });
      
      // Sort and display GTKW files
      const sortedGtkw = [...gtkwFiles].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sortedGtkw.forEach((file, originalIndex) => {
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
  
  // Add animation class for new files
  setTimeout(() => fileItem.classList.add('file-animate-in'), 10);
  
  const fileExtension = file.name.split('.').pop().toLowerCase();
  const isStarred = file.starred || false;
  
  fileItem.innerHTML = `
    <div class="project-file-info">
      <div class="project-file-icon ${fileExtension === 'v' ? 'verilog-icon' : 'gtkw-icon'}">
        ${fileExtension === 'v' ? 'V' : 'GTK'}
      </div>
      <div class="project-file-details">
        <div class="project-file-name">${file.name}</div>
        <div class="project-file-type">${fileExtension.toUpperCase()}</div>
        <div class="project-file-size">${formatFileSize(file.size || 0)}</div>
      </div>
    </div>
    <div class="project-file-actions">
      <button class="project-icon-btn star-btn ${isStarred ? 'starred' : ''}" 
              data-index="${index}" 
              data-type="${type}"
              title="${isStarred ? 'Remove from favorites' : 'Add to favorites'}">
        <i class="fa-solid fa-star"></i>
      </button>
      <button class="project-icon-btn delete-btn" 
              data-index="${index}" 
              data-type="${type}"
              title="Remove file">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;
  
  // Add event listeners directly to the buttons
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

// Toggle file star status - UPDATED with visual feedback
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
  
  // Toggle starred status
  targetFile.starred = !targetFile.starred;
  
  // Update the file item immediately with animation
  const fileItem = document.querySelector(`[data-file-index="${index}"][data-file-type="${type}"]`);
  if (fileItem) {
    const starBtn = fileItem.querySelector('.star-btn');
    
    if (targetFile.starred) {
      fileItem.classList.add('starred');
      starBtn.classList.add('starred');
      starBtn.title = 'Remove from favorites';
    } else {
      fileItem.classList.remove('starred');
      starBtn.classList.remove('starred');
      starBtn.title = 'Add to favorites';
    }
  }
  
  // Update the UI with new sorting
  setTimeout(() => {
    updateFileList(type === 'gtkw' ? 'testbench' : type);
  }, 100);
  
  // Save configuration
  saveProjectConfiguration();
  
  // Show feedback
  const action = targetFile.starred ? 'added to' : 'removed from';
  showFileSuccess(`File "${targetFile.name}" ${action} favorites.`);
}

// Remove file from list - FIXED
function removeFile(index, type) {
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
    console.error('File not found for removal:', index, type);
    return;
  }
  
  // Show confirmation dialog
  if (!confirm(`Are you sure you want to remove "${targetFile.name}" from the project?`)) {
    return;
  }
  
  // Find and animate the file item
  const fileItem = document.querySelector(`[data-file-index="${index}"][data-file-type="${type}"]`);
  
  if (fileItem) {
    // Add removal animation
    fileItem.classList.add('file-animate-out');
    
    setTimeout(() => {
      // Remove from array
      files.splice(index, 1);
      
      // Update UI
      updateFileList(type === 'gtkw' ? 'testbench' : type);
      
      // Save configuration
      saveProjectConfiguration();
      
      // Show feedback
      showFileSuccess(`File "${targetFile.name}" removed successfully.`);
    }, 300);
  } else {
    // Direct removal if animation element not found
    files.splice(index, 1);
    updateFileList(type === 'gtkw' ? 'testbench' : type);
    saveProjectConfiguration();
    showFileSuccess(`File "${targetFile.name}" removed successfully.`);
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
    
    saveProjectConfiguration();
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

// Enhanced file validation
function validateFile(file, type) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedExtensions = type === 'synthesizable' ? ['.v'] : ['.v', '.gtkw'];
  
  // Check file size
  if (file.size > maxSize) {
    showFileError(`File "${file.name}" is too large. Maximum size is 10MB.`);
    return false;
  }
  
  // Check file extension
  const hasValidExtension = allowedExtensions.some(ext => 
    file.name.toLowerCase().endsWith(ext.toLowerCase())
  );
  
  if (!hasValidExtension) {
    showFileError(`File "${file.name}" has invalid extension. Allowed: ${allowedExtensions.join(', ')}`);
    return false;
  }
  
  // Check for empty file name
  if (!file.name.trim()) {
    showFileError('File name cannot be empty.');
    return false;
  }
  
  return true;
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
  
  // Configurar os botões do modal
  function setupModalButtons() {
    // Botão para fechar o modal (X no canto superior direito)
    if (closeProjectModalBtn) {
      closeProjectModalBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Cancel
    if (cancelProjectConfigBtn) {
      cancelProjectConfigBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Save
    if (saveProjectConfigBtn) {
      saveProjectConfigBtn.addEventListener('click', () => {
        saveProjectConfiguration();
        closeProjectModal();
      });
    }
    
    // Botão Clear All
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        clearAllSettings();
      });
    }
    
    // Fechar modal ao clicar fora
    window.addEventListener('click', (event) => {
      if (event.target === projectModal) {
        closeProjectModal();
      }
    });
    
    // Tecla ESC para fechar o modal
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !projectModal.hidden && projectModal.classList.contains('active')) {
        closeProjectModal();
      }
    });
  }
  
  // Configurar a seção de processadores
  function setupProcessorsSection() {
    if (addProcessorBtn) {
      addProcessorBtn.addEventListener('click', () => {
        addProcessorRow();
      });
    }
    
    // Configurar event listener para botões de exclusão de processador
    processorsList.addEventListener('click', (event) => {
      if (event.target.classList.contains('delete-processor') || 
          event.target.closest('.delete-processor')) {
        const row = event.target.closest('.modalConfig-processor-row');
        if (row) {
          row.remove();
        }
      }
    });
  }
  
  // Configurar o sistema de toggle UI
  function setupToggleUI() {
    // Verificar se os elementos necessários existem
    if (!toggleUiButton || !settingsButton) {
        console.error('Elementos necessários para toggle UI não encontrados');
        return;
    }
    
    // Adicionar estilos para a animação
    addToggleStyles();
    
    // Criar um novo botão para configuração de projeto (oculto por padrão)
    const projectSettingsButton = document.createElement('button');
    projectSettingsButton.id = 'settings-project';
    projectSettingsButton.className = 'toolbar-button';
    projectSettingsButton.setAttribute('titles', 'Project Configuration');
    projectSettingsButton.style.display = 'none'; // Início oculto
    
    // Adicionar ícone ao botão de projeto
    const projectIcon = document.createElement('i');
    projectIcon.className = 'fa-solid fa-gear';
    projectSettingsButton.appendChild(projectIcon);
    
    // Inserir o novo botão após o botão original
    settingsButton.parentNode.insertBefore(projectSettingsButton, settingsButton.nextSibling);
    
    // Adicionar listener apenas para o botão de projeto
    projectSettingsButton.addEventListener('click', function(e) {
        e.preventDefault();
        openProjectModal();
    });
    
    toggleUiButton.addEventListener('click', function () {
      const isToggleActive = toggleUiButton.classList.contains('active');
    
      // Atualizar botões com transição
      if (isToggleActive) {
        fadeOutIn(settingsButton, projectSettingsButton);
      } else {
        fadeOutIn(projectSettingsButton, settingsButton);
      }
    
      // Atualizar texto com ícone e transição suave
      const statusText = document.getElementById("processorProjectOriented");
      const statusTexttwo = document.getElementById("processorNameID");

      if (statusText) {
        statusText.style.opacity = "0"; // Fade out
    
        setTimeout(() => {
          if (isToggleActive) {
            // Processor Oriented
            statusText.innerHTML = `<i class="fa-solid fa-lock"></i> Project Oriented`;
            statusTexttwo.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
          } else {
            // Project Oriented
            statusText.innerHTML = `<i class="fa-solid fa-lock-open"></i> Processor Oriented`;
          }
    
          statusText.style.opacity = "1"; // Fade in
        }, 300);
      }
    });
    
    // Verificar estado inicial do toggle-ui após um pequeno atraso
    setTimeout(() => {
        if (toggleUiButton.classList.contains('active')) {
            // Se o toggle estiver ativo, mostrar o botão de projeto
            fadeOutIn(settingsButton, projectSettingsButton);
        }
    }, 600);
  }
  
  // Função para realizar a transição suave entre botões
  function fadeOutIn(buttonToHide, buttonToShow) {
    // Verificar se os botões existem
    if (!buttonToHide || !buttonToShow) {
        console.error('Botões não encontrados para transição');
        return;
    }
    
    // Fade out do botão atual
    buttonToHide.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    buttonToHide.style.opacity = '0';
    
    // Após o fade out, trocar os botões
    setTimeout(() => {
        buttonToHide.style.display = 'none';
        
        // Mostrar o novo botão com opacity 0
        buttonToShow.style.opacity = '0';
        buttonToShow.style.display = '';
        buttonToShow.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
        
        // Forçar reflow para garantir que a transição ocorra
        buttonToShow.offsetHeight;
        
        // Iniciar fade in
        buttonToShow.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }

  // Lidar com o clique no botão settings
  function handleSettingsClick(e) {
    // Se o toggleUI estiver ativo, abrir o modal de projeto em vez do modal de processor
    if (toggleUiButton && toggleUiButton.classList.contains('active')) {
      e.preventDefault();
      e.stopPropagation(); // Impede a propagação do evento
      openProjectModal();
      return false; // Impede qualquer comportamento adicional
    }
    // Caso contrário, o comportamento original é mantido (abrir modalConfig)
    // Isso é gerenciado pelo código original, não precisamos fazer nada aqui
  }

  // Lidar com o clique no botão toggle UI
  function handleToggleUI() {
    // Verificar se o toggleUiButton está ativo
    const isToggleActive = toggleUiButton.classList.contains('active');
    
    // Atualizar o ícone do botão settings com base no estado do toggle
    updateSettingsButtonIcon(isToggleActive);
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
  
 // Modern Toggle Styles Function
function addToggleStyles() {
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    /* Toggle UI Animation Styles */
    #settings, #settings-project {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateY(0);
    }
    
    #settings:hover, #settings-project:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    
    /* Modal visibility and animation */
    .modalConfig {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
      transform: scale(0.95);
      opacity: 0;
    }
    
    .modalConfig.active {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      transform: scale(1);
    }
    
    /* Status text transitions */
    #processorProjectOriented, #processorNameID {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    /* Smooth icon transitions */
    .toolbar-button i {
      transition: all var(--transition-fast) cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .toolbar-button:hover i {
      transform: scale(1.1);
    }
    
    /* Disabled state styling */
    .toolbar-button.disabled {
      opacity: 0.4;
      cursor: not-allowed !important;
      pointer-events: none;
    }
    
    .toolbar-button.disabled i {
      opacity: 0.5;
    }
  `;
  document.head.appendChild(styleElement);
}

  
  
// Cache for processor instances mapping
let processorInstancesMap = {};

// Parse Verilog files to extract processor instances
async function parseProcessorInstances() {
  try {
    processorInstancesMap = {};
    
    // Initialize map for all available processors
    for (const processor of availableProcessors) {
      processorInstancesMap[processor] = [];
    }
    
    // Get project path
    let projectPath = window.currentProjectPath;
    if (!projectPath) {
      const projectData = await window.electronAPI.getCurrentProject();
      projectPath = projectData?.projectPath;
    }
    
    if (!projectPath) return;
    
    // Check for TopLevel folder
    const topLevelPath = await window.electronAPI.joinPath(projectPath, 'TopLevel');
    const topLevelExists = await window.electronAPI.directoryExists(topLevelPath);
    const searchPath = topLevelExists ? topLevelPath : projectPath;
    
    // Get all .v files in the search path
    const verilogFiles = await window.electronAPI.getFilesWithExtension(searchPath, '.v');
    
    // Process each .v file to find processor instances
    for (const verilogFile of verilogFiles) {
      const fileContent = await window.electronAPI.readFile(verilogFile);
      extractAllInstancesFromContent(fileContent);
    }
    
    console.log('Processor instances map:', processorInstancesMap);
  } catch (error) {
    console.error('Error parsing processor instances:', error);
  }
}

// Extract all processor instances from a single Verilog file content
function extractAllInstancesFromContent(content) {
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip comments
    if (line.startsWith('//') || line.startsWith('/*')) continue;
    
    // Check each available processor
    for (const processorName of availableProcessors) {
      if (line.includes(processorName)) {
        // Check if this line contains processor instantiation
        let instanceLine = line;
        let lineIndex = i;
        
        // Sometimes the instance name is on the next line, so we concatenate lines
        // until we find the opening parenthesis
        while (lineIndex < lines.length - 1 && !instanceLine.includes('(')) {
          lineIndex++;
          instanceLine += ' ' + lines[lineIndex].trim();
        }
        
        // Extract instance name using regex
        // Pattern: processor_name instance_name (
        const regex = new RegExp(`\\b${processorName}\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`);
        const match = instanceLine.match(regex);
        
        if (match && match[1]) {
          const instanceName = match[1];
          // Add instance to the processor if not already present
          if (!processorInstancesMap[processorName].includes(instanceName)) {
            processorInstancesMap[processorName].push(instanceName);
          }
        }
      }
    }
  }
}

// Update processor row to use select for instances
function addProcessorRow() {
  const newRow = document.createElement('div');
  newRow.className = 'modalConfig-processor-row';
  
  newRow.innerHTML = `
    <div class="modalConfig-select-container">
      <select class="processor-select modalConfig-select">
        <option value="">Select Processor</option>
        ${availableProcessors.map(proc => `<option value="${proc}">${proc}</option>`).join('')}
      </select>
    </div>
    <div class="modalConfig-select-container">
      <select class="processor-instance modalConfig-select" disabled>
        <option value="">Select Instance</option>
      </select>
    </div>
    <button class="delete-processor modalConfig-icon-btn" aria-label="Delete Processor">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  
  // Add event listeners
  const processorSelect = newRow.querySelector('.processor-select');
  const instanceSelect = newRow.querySelector('.processor-instance');
  
  processorSelect.addEventListener('change', function() {
    updateInstanceSelect(this.value, instanceSelect);
    // Refresh other selects when processor changes
    setTimeout(refreshAllInstanceSelects, 100);
  });
  
  instanceSelect.addEventListener('change', function() {
    // Refresh other selects when instance changes
    setTimeout(refreshAllInstanceSelects, 100);
  });
  
  processorsList.appendChild(newRow);
}

// Update instance select based on processor selection
function updateInstanceSelect(processorName, instanceSelect) {
  // Clear current options
  instanceSelect.innerHTML = '<option value="">Select Instance</option>';
  
  if (!processorName || !processorInstancesMap[processorName]) {
    instanceSelect.disabled = true;
    return;
  }
  
  // Get available instances for this specific processor
  const availableInstances = processorInstancesMap[processorName];
  const usedInstances = getUsedInstances();
  
  // Add available instances (excluding already used ones)
  const unusedInstances = availableInstances.filter(instance => !usedInstances.includes(instance));
  
  unusedInstances.forEach(instance => {
    const option = document.createElement('option');
    option.value = instance;
    option.textContent = instance;
    instanceSelect.appendChild(option);
  });
  
  // Enable/disable based on available instances
  instanceSelect.disabled = unusedInstances.length === 0;
  
  // Show message if no instances available
  if (availableInstances.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No instances found';
    instanceSelect.appendChild(option);
  } else if (unusedInstances.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'All instances already used';
    instanceSelect.appendChild(option);
  }
}

// Get list of currently used instances
function getUsedInstances() {
  const usedInstances = [];
  const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');
  
  processorRows.forEach(row => {
    const instanceSelect = row.querySelector('.processor-instance');
    if (instanceSelect && instanceSelect.value) {
      usedInstances.push(instanceSelect.value);
    }
  });
  
  return usedInstances;
}

  function refreshAllInstanceSelects() {
  const processorRows = processorsList.querySelectorAll('.modalConfig-processor-row');
  
  processorRows.forEach(row => {
    const processorSelect = row.querySelector('.processor-select');
    const instanceSelect = row.querySelector('.processor-instance');
    
    if (processorSelect && instanceSelect && processorSelect.value) {
      const currentValue = instanceSelect.value;
      updateInstanceSelect(processorSelect.value, instanceSelect);
      // Restore selection if still valid
      if (instanceSelect.querySelector(`option[value="${currentValue}"]`)) {
        instanceSelect.value = currentValue;
      }
    }
  });
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

// Modified prepareModalBeforeOpen function
async function prepareModalBeforeOpen() {
  await loadAvailableProcessors();
  await parseProcessorInstances();
  await loadProjectConfiguration();
}

// Modern Toggle Styles Function
function addToggleStyles() {
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    /* Toggle UI Animation Styles */
    #settings, #settings-project {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateY(0);
    }
    
    #settings:hover, #settings-project:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    
    /* Modal visibility and animation */
    .modalConfig {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
      transform: scale(0.95);
      opacity: 0;
    }
    
    .modalConfig.active {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      transform: scale(1);
    }
    
    /* Status text transitions */
    #processorProjectOriented, #processorNameID {
      transition: all var(--transition-normal) cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    /* Smooth icon transitions */
    .toolbar-button i {
      transition: all var(--transition-fast) cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .toolbar-button:hover i {
      transform: scale(1.1);
    }
    
    /* Disabled state styling */
    .toolbar-button.disabled {
      opacity: 0.4;
      cursor: not-allowed !important;
      pointer-events: none;
    }
    
    .toolbar-button.disabled i {
      opacity: 0.5;
    }
  `;
  document.head.appendChild(styleElement);
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
  
  // Função para carregar configurações do projeto do arquivo JSON
  async function loadProjectConfiguration() {
    try {
      // Reset da configuração atual
      currentConfig = {
        topLevelFile: '',
        testbenchFile: '',
        gtkwaveFile: '',
        processors: [],
        iverilogFlags: ''
      };
      
      // Verificar se temos o caminho do projeto
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
        console.error('Caminho do projeto não disponível. Impossível carregar configuração.');
        return;
      }
      
      // Usar a função joinPath da API electron
      const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
      
      // Verificar se o arquivo de configuração existe
      const configExists = await window.electronAPI.fileExists(configPath);
      
      if (configExists) {
        // Carregar configuração do arquivo
        const configContent = await window.electronAPI.readFile(configPath);
        currentConfig = JSON.parse(configContent);
        
        console.log('Configuração carregada:', currentConfig);
        
        // Atualizar campos do formulário
        updateFormWithConfig();
      } else {
        console.log('Arquivo de configuração não encontrado. Usando configuração padrão.');
      }
    } catch (error) {
      console.error('Erro ao carregar configuração do projeto:', error);
    }
  }
  
// Modified updateFormWithConfig function to work with file lists
function updateFormWithConfig() {
  // Load file lists from config
  if (currentConfig.synthesizableFiles) {
    synthesizableFiles = currentConfig.synthesizableFiles;
  }
  if (currentConfig.testbenchFiles) {
    testbenchFiles = currentConfig.testbenchFiles;
  }
  if (currentConfig.gtkwFiles) {
    gtkwFiles = currentConfig.gtkwFiles;
  }
  
  // Update UI
  updateFileListUI();
  
  // Update processor list (keeping existing logic)
  if (processorsList) {
    processorsList.innerHTML = '';
    
    if (currentConfig.processors && currentConfig.processors.length > 0) {
      currentConfig.processors.forEach(processor => {
        const newRow = document.createElement('div');
        newRow.className = 'modalConfig-processor-row';
        
        newRow.innerHTML = `
          <div class="modalConfig-select-container">
            <select class="processor-select modalConfig-select">
              <option value="">Select Processor</option>
              ${availableProcessors.map(proc => 
                `<option value="${proc}" ${proc === processor.type ? 'selected' : ''}>${proc}</option>`
              ).join('')}
            </select>
          </div>
          <div class="modalConfig-select-container">
            <select class="processor-instance modalConfig-select">
              <option value="">Select Instance</option>
            </select>
          </div>
          <button class="delete-processor modalConfig-icon-btn" aria-label="Delete Processor">
            <i class="fa-solid fa-trash"></i>
          </button>
        `;
        
        processorsList.appendChild(newRow);
        
        // Setup event listeners and populate instance select
        const processorSelect = newRow.querySelector('.processor-select');
        const instanceSelect = newRow.querySelector('.processor-instance');
        
        processorSelect.addEventListener('change', function() {
          updateInstanceSelect(this.value, instanceSelect);
          setTimeout(refreshAllInstanceSelects, 100);
        });
        
        instanceSelect.addEventListener('change', function() {
          setTimeout(refreshAllInstanceSelects, 100);
        });
        
        // Populate instances for the selected processor
        if (processor.type) {
          updateInstanceSelect(processor.type, instanceSelect);
          if (processor.instance) {
            instanceSelect.value = processor.instance;
          }
        }
      });
    } else {
      addProcessorRow();
    }
  }
  
  // Update iverilog flags
  if (iverilogFlags) {
    iverilogFlags.value = currentConfig.iverilogFlags || '';
  }
}
  
  // Atualizar um select de processador com os processadores disponíveis
  function updateProcessorSelect(selectElement, selectedValue = '') {
    if (!selectElement) return;
    
    // Salvar o valor atual se não for fornecido um valor
    if (!selectedValue) {
      selectedValue = selectElement.value;
    }
    
    // Limpar opções existentes
    selectElement.innerHTML = '';
    
    // Adicionar opção padrão
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select Processor';
    selectElement.appendChild(defaultOption);
    
    // Adicionar processadores disponíveis
    availableProcessors.forEach(processor => {
      const option = document.createElement('option');
      option.value = processor;
      option.textContent = processor;
      
      // Verificar se este é o processador selecionado anteriormente
      if (processor === selectedValue) {
        option.selected = true;
      }
      
      selectElement.appendChild(option);
    });
  }
  
// Modified collectFormData function to work with file lists
function collectFormData() {
  const starredSynthesizable = synthesizableFiles.find(file => file.isStarred);
  const starredTestbench = testbenchFiles.find(file => file.isStarred);
  const starredGtkw = gtkwFiles.find(file => file.isStarred);
  
  const config = {
    topLevelFile: starredSynthesizable ? starredSynthesizable.name : '',
    testbenchFile: starredTestbench ? starredTestbench.name : '',
    gtkwaveFile: starredGtkw ? starredGtkw.name : '',
    synthesizableFiles: synthesizableFiles.map(file => ({
      name: file.name,
      path: file.path,
      isStarred: file.isStarred
    })),
    testbenchFiles: testbenchFiles.map(file => ({
      name: file.name,
      path: file.path,
      isStarred: file.isStarred
    })),
    gtkwFiles: gtkwFiles.map(file => ({
      name: file.name,
      path: file.path,
      isStarred: file.isStarred
    })),
    processors: [],
    iverilogFlags: iverilogFlags ? iverilogFlags.value : ''
  };
  
  // Collect processor data (keeping existing logic)
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
    const processorTb = testbenchSelect.value;

    el.innerHTML = `${unique.join(' | ')} <i class="fa-solid fa-gear"></i> ${processorTb || 'None'}`;
    el.classList.add('has-processors');
  } else {
    el.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
    el.classList.remove('has-processors');
  }

  // dispara fade-in
  el.style.opacity = '1';
}


// Modificar a função saveProjectConfiguration para chamar updateProcessorStatus após salvar
async function saveProjectConfiguration() {
  try {
    // Check if we have the project path
    let projectPath;
    
    try {
      // Use the correct API call that returns an object with projectPath
      const projectInfo = await window.electronAPI.getCurrentProject();
      projectPath = projectInfo.projectPath || window.currentProjectPath || localStorage.getItem('currentProjectPath');
    } catch (err) {
      console.warn('Failed to get project path via API:', err);
    }
    
    // Check again if project path is available
    if (!projectPath) {
      console.error('Project path not available. Cannot save configuration.');
      alert('Failed to save: no project open.');
      return;
    }
    
    // Collect form data
    const formData = collectFormData();
    currentConfig = formData;
    
    // Use the joinPath function from the electron API
    const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
    
    // Save to JSON file
    await window.electronAPI.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
    
    console.log('Project configuration saved at:', configPath);
    console.log('Saved configuration:', currentConfig);
    
    // Atualizar a exibição dos tipos de processadores
    updateProcessorStatus();
    
    // Show success notification and close modal
    showNotification("Configuration saved successfully", 'success');
    
  } catch (error) {
    console.error("Failed to save configuration:", error);
    showNotification("Failed to save configuration: " + error.message, 'error');
  }
}

// Modified clearAllSettings function
function clearAllSettings() {
  // Clear file lists
  clearAllFiles();
  
  // Clear processor list
  if (processorsList) {
    processorsList.innerHTML = '';
    addProcessorRow();
  }
  
  // Clear iverilog flags
  if (iverilogFlags) {
    iverilogFlags.value = '';
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