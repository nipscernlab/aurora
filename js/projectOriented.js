// projectOriented.js - Project Configuration Modal Implementation

document.addEventListener('DOMContentLoaded', async () => {
  // Main Elements
  const toggleUiButton = document.getElementById('toggle-ui');
  const settingsButton = document.getElementById('settings');
  
  // Modals
  const processorModal = document.getElementById('modalConfig');
  const projectModal = document.getElementById('modalProjectConfig');
  
  // Project Config Form Elements
  const verilogFilesList = document.getElementById('verilogFilesList');
  const gtkwFilesList = document.getElementById('gtkwFilesList');
  const instanceNameInput = document.getElementById('instanceName');
  const processorSelectProject = document.getElementById('processorSelectProject');
  const addProcessorBtn = document.getElementById('addProcessor');
  const deleteProcessorBtnProject = document.getElementById('deleteProcessorProject');
  
  // Modal Buttons
  const closeProjectModalBtn = document.getElementById('closeProjectModal');
  const saveProjectConfigBtn = document.getElementById('saveProjectConfig');
  const cancelProjectConfigBtn = document.getElementById('cancelProjectConfig');
  
  // Project config storage
  let currentProjectPath = '';
  let spfPath = '';
  let projectProcessors = [];
  let availableVerilogFiles = [];
  let availableGtkwFiles = [];
  let selectedProcessor = null;
  let projectConfig = {
    processors: [],
    selectedVerilogFile: '',
    selectedGtkwFile: '',
    instanceName: ''
  };

  // Duration for icon transition animation
  const ICON_TRANSITION_DURATION = 300;
  
  // Project settings button (will be created)
  let projectSettingsButton = null;

  // Initialize the component
  function init() {
    // Check if required elements exist
    if (!toggleUiButton || !settingsButton || !projectModal) {
      console.error('Required elements not found for project configuration');
      return;
    }
    
    // Create project settings button
    projectSettingsButton = document.createElement('button');
    projectSettingsButton.id = 'settings-project';
    projectSettingsButton.className = 'toolbar-button';
    projectSettingsButton.setAttribute('title', 'Project Configuration');
    projectSettingsButton.style.display = 'none'; // Hidden by default
    
    // Add icon to project button
    const projectIcon = document.createElement('i');
    projectIcon.className = 'fa-solid fa-gear';
    projectSettingsButton.appendChild(projectIcon);
    
    // Insert new button after the original settings button
    settingsButton.parentNode.insertBefore(projectSettingsButton, settingsButton.nextSibling);
    
    // Add listener for project button
    projectSettingsButton.addEventListener('click', async function(e) {
      e.preventDefault();
      
      if (projectModal) {
        try {
          // Load project data before opening modal
          await loadProjectData();
          
          // Show the modal
          projectModal.hidden = false;
          projectModal.classList.add("active");
        } catch (error) {
          console.error('Failed to load project data:', error);
          showNotification('Failed to load project configuration', 'error');
        }
      } else {
        console.error('Project configuration modal not found');
      }
    });
    
    // Setup project modal buttons
    setupProjectModalButtons();
    
    // Add listener for UI toggle button
    toggleUiButton.addEventListener('click', toggleConfigButtons);
    
    // Check initial state of toggle-ui
    setTimeout(() => {
      if (toggleUiButton.classList.contains('active')) {
        toggleConfigButtons();
      }
    }, 600);
    
    // Set up form event listeners
    setupFormEventListeners();
    
    console.log('Project configuration system initialized');
  }
  
  // Toggle between configuration buttons
  function toggleConfigButtons() {
    const isToggleActive = toggleUiButton.classList.contains('active');
    
    if (isToggleActive) {
      // Show project button and hide original button
      fadeOutIn(settingsButton, projectSettingsButton);
    } else {
      // Show original button and hide project button
      fadeOutIn(projectSettingsButton, settingsButton);
    }
  }
  
  // Function for smooth transition between buttons
  function fadeOutIn(buttonToHide, buttonToShow) {
    if (!buttonToHide || !buttonToShow) {
      console.error('Buttons not found for transition');
      return;
    }
    
    // Fade out current button
    buttonToHide.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    buttonToHide.style.opacity = '0';
    
    // After fade out, switch buttons
    setTimeout(() => {
      buttonToHide.style.display = 'none';
      
      // Show new button with opacity 0
      buttonToShow.style.opacity = '0';
      buttonToShow.style.display = '';
      buttonToShow.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
      
      // Force reflow to ensure transition happens
      buttonToShow.offsetHeight;
      
      // Start fade in
      buttonToShow.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }
  
  // Add CSS styles for animation
  function addStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #settings, #settings-project {
        transition: opacity ${ICON_TRANSITION_DURATION}ms ease;
      }
      
      /* Ensure modals are visible when opened */
      .mconfig-modal.active {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      
      /* Style for file lists */
      .file-list {
        max-height: 150px;
        overflow-y: auto;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        margin-bottom: 15px;
        background-color: var(--bg-secondary);
      }
      
      .file-list-item {
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--border-primary);
        transition: background-color 0.2s ease;
      }
      
      .file-list-item:last-child {
        border-bottom: none;
      }
      
      .file-list-item:hover {
        background-color: var(--bg-hover);
      }
      
      .file-list-item.selected {
        background-color: var(--bg-selected);
        color: var(--text-selected);
        font-weight: 500;
      }
      
      /* Empty list message */
      .empty-list-message {
        padding: 12px;
        color: var(--text-secondary);
        font-style: italic;
        text-align: center;
      }
    `;
    document.head.appendChild(styleElement);
  }
  
  // Set up project modal buttons
  function setupProjectModalButtons() {
    if (!projectModal) return;
    
    // Close button (X in the top-right corner)
    if (closeProjectModalBtn) {
      closeProjectModalBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Cancel button
    if (cancelProjectConfigBtn) {
      cancelProjectConfigBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Save button
    if (saveProjectConfigBtn) {
      saveProjectConfigBtn.addEventListener('click', () => {
        saveProjectConfiguration();
      });
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
      if (event.target === projectModal) {
        closeProjectModal();
      }
    });
    
    // ESC key to close modal
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !projectModal.hidden && projectModal.classList.contains('active')) {
        closeProjectModal();
      }
    });
  }
  
  // Set up form event listeners
  function setupFormEventListeners() {
    // Processor selection
    if (processorSelectProject) {
      processorSelectProject.addEventListener('change', function() {
        selectedProcessor = this.value;
        updateProcessorButtons();
        
        // Update instance name from stored config if available
        updateInstanceNameForProcessor(selectedProcessor);
      });
    }
    
    // Add processor button
    if (addProcessorBtn) {
      addProcessorBtn.addEventListener('click', function() {
        addNewProcessor();
      });
    }
    
    // Delete processor button
    if (deleteProcessorBtnProject) {
      deleteProcessorBtnProject.addEventListener('click', function() {
        deleteSelectedProcessor();
      });
    }
    
    // Instance name input
    if (instanceNameInput) {
      instanceNameInput.addEventListener('input', function() {
        if (selectedProcessor) {
          // Update instance name in config
          const processorConfig = projectConfig.processors.find(p => p.name === selectedProcessor);
          if (processorConfig) {
            processorConfig.instanceName = this.value;
          } else {
            // Add new processor config if it doesn't exist
            projectConfig.processors.push({
              name: selectedProcessor,
              instanceName: this.value
            });
          }
        }
      });
    }
  }
  
  // Load project data (processors, files, etc.)
  async function loadProjectData() {
    try {
      // Get current project info
      const projectInfo = await window.electronAPI.getCurrentProject();
      
      if (projectInfo.projectOpen) {
        console.log("Current project found:", projectInfo);
        currentProjectPath = projectInfo.projectPath;
        spfPath = projectInfo.spfPath;
        
        // Store paths in localStorage for persistence
        localStorage.setItem('currentProjectPath', currentProjectPath);
        localStorage.setItem('currentSpfPath', spfPath);
      } else {
        // Try to use stored project path
        currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
        spfPath = localStorage.getItem('currentSpfPath');
        
        if (!currentProjectPath) {
          console.warn("No project path available");
          showNotification("No project is open", 'warning');
          return;
        }
      }
      
      console.log("Loading project data for:", currentProjectPath);
      
      // Load project configurations in parallel
      await Promise.all([
        loadProcessors(),
        scanTopLevelFiles(),
        loadProjectConfiguration()
      ]);
      
      // Update UI with loaded data
      updateProcessorSelect();
      updateFileLists();
      updateProcessorButtons();
      
      console.log("Project data loaded successfully");
    } catch (error) {
      console.error("Failed to load project data:", error);
      showNotification("Failed to load project data", 'error');
    }
  }
  
  // Load available processors
  async function loadProcessors() {
    try {
      // Call the IPC method to get processors with the current project path
      projectProcessors = await window.electronAPI.getAvailableProcessors(currentProjectPath);
      console.log("Loaded processors:", projectProcessors);
      
      if (!projectProcessors || projectProcessors.length === 0) {
        console.warn("No processors found in the project");
      }
      
      return projectProcessors;
    } catch (error) {
      console.error("Failed to load processors:", error);
      return [];
    }
  }
  
  // Scan Top Level directory for Verilog and GTKWave files
  async function scanTopLevelFiles() {
    try {
      // Construct Top Level path
      const topLevelPath = await window.electronAPI.joinPath(currentProjectPath, 'Top Level');
      console.log("Scanning Top Level directory:", topLevelPath);
      
      // Read directory contents
      const files = await window.electronAPI.readDirectory(topLevelPath);
      
      // Filter for .v and .gtkw files
      availableVerilogFiles = files.filter(file => file.toLowerCase().endsWith('.v'));
      availableGtkwFiles = files.filter(file => file.toLowerCase().endsWith('.gtkw'));
      
      console.log("Found Verilog files:", availableVerilogFiles);
      console.log("Found GTKWave files:", availableGtkwFiles);
      
      return { verilogFiles: availableVerilogFiles, gtkwFiles: availableGtkwFiles };
    } catch (error) {
      console.error("Failed to scan Top Level directory:", error);
      availableVerilogFiles = [];
      availableGtkwFiles = [];
      return { verilogFiles: [], gtkwFiles: [] };
    }
  }
  
  // Load project configuration
  async function loadProjectConfiguration() {
    try {
      // Define path to project config file
      const configPath = await window.electronAPI.joinPath(currentProjectPath, 'saphoComponents', 'Scripts', 'projectConfig.json');
      
      // Try to read the config file
      try {
        const config = await window.electronAPI.readJsonFile(configPath);
        projectConfig = config;
        console.log("Loaded project configuration:", projectConfig);
      } catch (error) {
        // If file doesn't exist or is invalid, use default config
        console.log("Using default project configuration");
        projectConfig = {
          processors: [],
          selectedVerilogFile: '',
          selectedGtkwFile: '',
          instanceName: ''
        };
      }
      
      return projectConfig;
    } catch (error) {
      console.error("Failed to load project configuration:", error);
      return null;
    }
  }
  
  // Update processor select dropdown
  function updateProcessorSelect() {
    if (!processorSelectProject) return;
    
    // Clear existing options
    processorSelectProject.innerHTML = '';
    
    // Add default option
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- Select Processor --";
    defaultOption.disabled = true;
    defaultOption.selected = !selectedProcessor;
    processorSelectProject.appendChild(defaultOption);
    
    // Add processor options
    if (projectProcessors && projectProcessors.length > 0) {
      projectProcessors.forEach(processor => {
        const option = document.createElement("option");
        option.value = processor;
        option.textContent = processor;
        option.selected = processor === selectedProcessor;
        processorSelectProject.appendChild(option);
      });
      
      // If no processor is selected, select the first one
      if (!selectedProcessor && projectProcessors.length > 0) {
        selectedProcessor = projectProcessors[0];
        processorSelectProject.value = selectedProcessor;
        updateInstanceNameForProcessor(selectedProcessor);
      }
    }
    
    // Update buttons state
    updateProcessorButtons();
  }
  
  // Update file lists in UI
  function updateFileLists() {
    // Update Verilog files list
    if (verilogFilesList) {
      verilogFilesList.innerHTML = '';
      
      if (availableVerilogFiles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-list-message';
        emptyMessage.textContent = 'No Verilog files found';
        verilogFilesList.appendChild(emptyMessage);
      } else {
        availableVerilogFiles.forEach(file => {
          const item = document.createElement('div');
          item.className = 'file-list-item';
          if (file === projectConfig.selectedVerilogFile) {
            item.classList.add('selected');
          }
          item.textContent = file;
          item.addEventListener('click', () => {
            // Remove selected class from all items
            verilogFilesList.querySelectorAll('.file-list-item').forEach(el => {
              el.classList.remove('selected');
            });
            
            // Add selected class to clicked item
            item.classList.add('selected');
            
            // Update config
            projectConfig.selectedVerilogFile = file;
          });
          verilogFilesList.appendChild(item);
        });
      }
    }
    
    // Update GTKWave files list
    if (gtkwFilesList) {
      gtkwFilesList.innerHTML = '';
      
      if (availableGtkwFiles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-list-message';
        emptyMessage.textContent = 'No GTKWave files found';
        gtkwFilesList.appendChild(emptyMessage);
      } else {
        availableGtkwFiles.forEach(file => {
          const item = document.createElement('div');
          item.className = 'file-list-item';
          if (file === projectConfig.selectedGtkwFile) {
            item.classList.add('selected');
          }
          item.textContent = file;
          item.addEventListener('click', () => {
            // Remove selected class from all items
            gtkwFilesList.querySelectorAll('.file-list-item').forEach(el => {
              el.classList.remove('selected');
            });
            
            // Add selected class to clicked item
            item.classList.add('selected');
            
            // Update config
            projectConfig.selectedGtkwFile = file;
          });
          gtkwFilesList.appendChild(item);
        });
      }
    }
  }
  
  // Update processor-related buttons state
  function updateProcessorButtons() {
    if (deleteProcessorBtnProject) {
      deleteProcessorBtnProject.disabled = !selectedProcessor;
    }
    
    // Enable/disable instance name input
    if (instanceNameInput) {
      instanceNameInput.disabled = !selectedProcessor;
    }
  }
  
  // Update instance name input for the selected processor
  function updateInstanceNameForProcessor(processorName) {
    if (!instanceNameInput) return;
    
    if (processorName) {
      const processorConfig = projectConfig.processors.find(p => p.name === processorName);
      if (processorConfig) {
        instanceNameInput.value = processorConfig.instanceName || '';
      } else {
        instanceNameInput.value = '';
      }
    } else {
      instanceNameInput.value = '';
    }
  }
  
  // Add a new processor
  async function addNewProcessor() {
    try {
      // Prompt for processor name
      const processorName = prompt("Enter new processor name:");
      
      if (!processorName || processorName.trim() === '') {
        return; // User cancelled or entered empty name
      }
      
      // Check if processor already exists
      if (projectProcessors.includes(processorName)) {
        showNotification(`Processor "${processorName}" already exists`, 'warning');
        return;
      }
      
      // Call API to create processor
      await window.electronAPI.createProcessor(processorName);
      
      // Reload processors
      await loadProcessors();
      
      // Update UI
      selectedProcessor = processorName;
      updateProcessorSelect();
      
      // Add to config with empty instance name
      projectConfig.processors.push({
        name: processorName,
        instanceName: ''
      });
      
      // Update instance name input
      instanceNameInput.value = '';
      instanceNameInput.focus();
      
      // Show success notification
      showNotification(`Processor "${processorName}" created successfully`, 'success');
    } catch (error) {
      console.error("Failed to create processor:", error);
      showNotification(`Failed to create processor: ${error.message}`, 'error');
    }
  }
  
  // Delete the selected processor
  async function deleteSelectedProcessor() {
    if (!selectedProcessor) {
      showNotification("No processor selected for deletion", 'warning');
      return;
    }
    
    // Store the processor name to be deleted
    const processorToDelete = selectedProcessor;
    
    // Confirm deletion
    const confirmMessage = `Are you sure you want to delete processor "${processorToDelete}"?`;
    
    showConfirmationDialog(confirmMessage, async function() {
      try {
        // Disable button during operation
        deleteProcessorBtnProject.disabled = true;
        
        // Call API to delete processor
        await window.electronAPI.deleteProcessor(processorToDelete);
        
        // Remove from project processors
        projectProcessors = projectProcessors.filter(p => p !== processorToDelete);
        
        // Remove from config
        projectConfig.processors = projectConfig.processors.filter(p => p.name !== processorToDelete);
        
        // Update selection
        if (projectProcessors.length > 0) {
          selectedProcessor = projectProcessors[0];
        } else {
          selectedProcessor = null;
        }
        
        // Update UI
        updateProcessorSelect();
        updateInstanceNameForProcessor(selectedProcessor);
        
        // Show success notification
        showNotification(`Processor "${processorToDelete}" deleted successfully`, 'success');
      } catch (error) {
        console.error("Failed to delete processor:", error);
        showNotification(`Failed to delete processor: ${error.message}`, 'error');
        
        // Re-enable button
        deleteProcessorBtnProject.disabled = false;
      }
    });
  }
  
  // Save project configuration
  async function saveProjectConfiguration() {
    try {
      // Ensure project path exists
      if (!currentProjectPath) {
        showNotification("No project is open", 'error');
        return;
      }
      
      // Create saphoComponents/Scripts directory if it doesn't exist
      const scriptsDir = await window.electronAPI.joinPath(currentProjectPath, 'saphoComponents', 'Scripts');
      await window.electronAPI.ensureDirectory(scriptsDir);
      
      // Define config file path
      const configPath = await window.electronAPI.joinPath(scriptsDir, 'projectConfig.json');
      
      // Write config to file
      await window.electronAPI.writeJsonFile(configPath, projectConfig);
      
      // Show success notification
      showNotification("Project configuration saved successfully", 'success');
      
      // Close modal
      closeProjectModal();
    } catch (error) {
      console.error("Failed to save project configuration:", error);
      showNotification(`Failed to save configuration: ${error.message}`, 'error');
    }
  }
  
  // Close project modal
  function closeProjectModal() {
    if (projectModal) {
      projectModal.classList.remove('active');
      
      // Small delay before completely hiding to allow animation
      setTimeout(() => {
        projectModal.hidden = true;
      }, 300);
    }
  }
  
  // Create confirmation dialog elements
function createConfirmationDialog() {
  // Create dialog container
  const dialog = document.createElement('div');
  dialog.id = 'custom-confirm-dialog';
  dialog.style.position = 'fixed';
  dialog.style.top = '0';
  dialog.style.left = '0';
  dialog.style.width = '100%';
  dialog.style.height = '100%';
  dialog.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  dialog.style.display = 'flex';
  dialog.style.justifyContent = 'center';
  dialog.style.alignItems = 'center';
  dialog.style.zIndex = '9999';
  dialog.style.opacity = '0';
  dialog.style.transition = 'opacity 0.3s ease';
  
  // Create dialog content
  const dialogContent = document.createElement('div');
  dialogContent.style.backgroundColor = 'var(--bg-tertiary)';
  dialogContent.style.borderRadius = '8px';
  dialogContent.style.boxShadow = 'var(--shadow-lg)';
  dialogContent.style.padding = '24px';
  dialogContent.style.maxWidth = '400px';
  dialogContent.style.width = '90%';
  dialogContent.style.transform = 'translateY(-20px)';
  dialogContent.style.transition = 'transform 0.3s ease';
  dialogContent.style.border = '1px solid var(--border-primary)';
  
  return {
    dialog,
    dialogContent
  };
}

// Show a confirmation dialog
function showConfirmationDialog(message, onConfirm, onCancel) {
  const { dialog, dialogContent } = createConfirmationDialog();
  
  // Create dialog header
  const header = document.createElement('div');
  header.style.marginBottom = '16px';
  
  const icon = document.createElement('span');
  icon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  `;
  icon.style.marginRight = '12px';
  icon.style.display = 'inline-block';
  icon.style.verticalAlign = 'middle';
  
  const title = document.createElement('span');
  title.textContent = "Confirm Deletion";
  title.style.fontSize = '18px';
  title.style.fontWeight = 'bold';
  title.style.color = 'var(--text-primary)';
  title.style.verticalAlign = 'middle';
  
  header.appendChild(icon);
  header.appendChild(title);
  
  // Create message
  const messageEl = document.createElement('p');
  messageEl.textContent = message;
  messageEl.style.color = 'var(--text-secondary)';
  messageEl.style.marginBottom = '20px';
  messageEl.style.fontSize = '14px';
  messageEl.style.lineHeight = '1.5';
  
  // Create buttons container
  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.display = 'flex';
  buttonsContainer.style.justifyContent = 'flex-end';
  buttonsContainer.style.gap = '12px';
  
  // Create cancel button
  const cancelButton = document.createElement('button');
  cancelButton.textContent = "Cancel";
  cancelButton.style.padding = '8px 16px';
  cancelButton.style.borderRadius = '4px';
  cancelButton.style.backgroundColor = 'transparent';
  cancelButton.style.color = 'var(--text-secondary)';
  cancelButton.style.border = '1px solid var(--border-primary)';
  cancelButton.style.cursor = 'pointer';
  cancelButton.style.fontFamily = 'var(--font-sans)';
  cancelButton.style.fontSize = '14px';
  cancelButton.style.transition = 'all 0.2s ease';
  
  // Hover effects for cancel button
  cancelButton.addEventListener('mouseover', () => {
    cancelButton.style.backgroundColor = 'var(--bg-hover)';
  });
  cancelButton.addEventListener('mouseout', () => {
    cancelButton.style.backgroundColor = 'transparent';
  });
  
  // Create confirm button
  const confirmButton = document.createElement('button');
  confirmButton.textContent = "Delete";
  confirmButton.style.padding = '8px 16px';
  confirmButton.style.borderRadius = '4px';
  confirmButton.style.backgroundColor = 'var(--error)';
  confirmButton.style.color = 'white';
  confirmButton.style.border = 'none';
  confirmButton.style.cursor = 'pointer';
  confirmButton.style.fontFamily = 'var(--font-sans)';
  confirmButton.style.fontSize = '14px';
  confirmButton.style.transition = 'all 0.2s ease';
  
  // Hover effect for confirm button
  confirmButton.addEventListener('mouseover', () => {
    confirmButton.style.backgroundColor = '#f65d78'; // Lighter error color
  });
  confirmButton.addEventListener('mouseout', () => {
    confirmButton.style.backgroundColor = 'var(--error)';
  });
  
  // Append elements to dialog content
  dialogContent.appendChild(header);
  dialogContent.appendChild(messageEl);
  buttonsContainer.appendChild(cancelButton);
  buttonsContainer.appendChild(confirmButton);
  dialogContent.appendChild(buttonsContainer);
  dialog.appendChild(dialogContent);
  
  // Add to DOM
  document.body.appendChild(dialog);
  
  // Trigger animation
  setTimeout(() => {
    dialog.style.opacity = '1';
    dialogContent.style.transform = 'translateY(0)';
  }, 10);
  
  // Close dialog function
  const closeDialog = () => {
    dialog.style.opacity = '0';
    dialogContent.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      if (dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
    }, 300);
  };
  
  // Add event listeners
  cancelButton.addEventListener('click', () => {
    closeDialog();
    if (onCancel) onCancel();
  });
  
  confirmButton.addEventListener('click', () => {
    closeDialog();
    onConfirm();
  });
  
  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeDialog();
      if (onCancel) onCancel();
    }
  });
  
  // Add keyboard support (Escape to cancel, Enter to confirm)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      if (onCancel) onCancel();
    } else if (e.key === 'Enter') {
      closeDialog();
      onConfirm();
    }
  };
  
  document.addEventListener('keydown', handleKeyDown);
  
  // Clean up event listener when dialog is closed
  const cleanupKeyListener = () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
  
  dialog.addEventListener('transitionend', () => {
    if (dialog.style.opacity === '0') {
      cleanupKeyListener();
    }
  });
  
  return {
    close: closeDialog
  };
}

// Show notification
function showNotification(message, type = 'info') {
  console.log(`[${type}] ${message}`);
  
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.position = 'fixed';
  notification.style.bottom = '30px';
  notification.style.right = '30px';
  notification.style.padding = '12px 16px';
  notification.style.borderRadius = '6px';
  notification.style.fontSize = '14px';
  notification.style.fontFamily = 'var(--font-sans)';
  notification.style.boxShadow = 'var(--shadow-md)';
  notification.style.transition = 'all 0.3s ease';
  notification.style.opacity = '0';
  notification.style.transform = 'translateY(10px)';
  notification.style.zIndex = '9998';
  notification.style.maxWidth = '300px';
  
  // Set styles based on notification type
  switch (type) {
    case 'success':
      notification.style.backgroundColor = 'var(--success-bg, #e6f7ed)';
      notification.style.color = 'var(--success, #2e7d32)';
      notification.style.border = '1px solid var(--success-border, #a5d8b7)';
      break;
    case 'error':
      notification.style.backgroundColor = 'var(--error-bg, #fae9eb)';
      notification.style.color = 'var(--error, #d32f2f)';
      notification.style.border = '1px solid var(--error-border, #f8c1c7)';
      break;
    case 'warning':
      notification.style.backgroundColor = 'var(--warning-bg, #fff8e6)';
      notification.style.color = 'var(--warning, #ed6c02)';
      notification.style.border = '1px solid var(--warning-border, #ffe4a3)';
      break;
    default: // info
      notification.style.backgroundColor = 'var(--info-bg, #e9f0fb)';
      notification.style.color = 'var(--info, #0288d1)';
      notification.style.border = '1px solid var(--info-border, #b3d9f0)';
  }
  
  // Add an icon based on type
  const iconContainer = document.createElement('span');
  iconContainer.style.marginRight = '10px';
  iconContainer.style.display = 'inline-flex';
  iconContainer.style.verticalAlign = 'middle';
  
  // Create message container for flex alignment
  const messageContainer = document.createElement('div');
  messageContainer.style.display = 'flex';
  messageContainer.style.alignItems = 'center';
  
  let iconSvg = '';
  switch (type) {
    case 'success':
      iconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      `;
      break;
    case 'error':
      iconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      `;
      break;
    case 'warning':
      iconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      `;
      break;
    default: // info
      iconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      `;
  }
  
  iconContainer.innerHTML = iconSvg;
  
  // Text element
  const textEl = document.createElement('span');
  textEl.textContent = message;
  textEl.style.verticalAlign = 'middle';
  
  // Close button
  const closeButton = document.createElement('button');
  closeButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeButton.style.background = 'transparent';
  closeButton.style.border = 'none';
  closeButton.style.cursor = 'pointer';
  closeButton.style.padding = '2px';
  closeButton.style.marginLeft = '8px';
  closeButton.style.color = 'inherit';
  closeButton.style.opacity = '0.7';
  closeButton.style.transition = 'opacity 0.2s ease';
  
  closeButton.addEventListener('mouseover', () => {
    closeButton.style.opacity = '1';
  });
  closeButton.addEventListener('mouseout', () => {
    closeButton.style.opacity = '0.7';
  });
  
  // Add elements to notification
  messageContainer.appendChild(iconContainer);
  messageContainer.appendChild(textEl);
  messageContainer.appendChild(closeButton);
  notification.appendChild(messageContainer);
  
  // Add to DOM
  document.body.appendChild(notification);
  
  // Trigger animation
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  }, 10);
  
  // Auto-hide after 5 seconds
  const hideTimeout = setTimeout(() => {
    hideNotification();
  }, 5000);
  
  // Hide notification function
  const hideNotification = () => {
    clearTimeout(hideTimeout);
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  };
  
  // Add event listener to close button
  closeButton.addEventListener('click', hideNotification);
  
  return {
    close: hideNotification
  };
}
  
  // Objeto para armazenar configurações temporárias do projeto
  let tempProjectConfigs = {};
  
  // Inicialização
  function init() {
    // Verificar se os elementos necessários existem
    if (!toggleUiButton || !settingsButton) {
      console.error('Elementos necessários não encontrados');
      return;
    }
    
    // Criar um novo botão para configuração de projeto (oculto por padrão)
    projectSettingsButton = document.createElement('button');
    projectSettingsButton.id = 'settings-project';
    projectSettingsButton.className = 'toolbar-button';
    projectSettingsButton.setAttribute('title', 'Project Configuration');
    projectSettingsButton.style.display = 'none'; // Início oculto
    
    // Adicionar ícone ao botão de projeto
    const projectIcon = document.createElement('i');
    projectIcon.className = 'fa-solid fa-gear';
    projectSettingsButton.appendChild(projectIcon);
    
    // Inserir o novo botão após o botão original
    settingsButton.parentNode.insertBefore(projectSettingsButton, settingsButton.nextSibling);
    
    // Adicionar listener para o botão de configurações original
    // Modificado para abrir o modal de projeto
    settingsButton.addEventListener('click', function(e) {
      e.preventDefault();
      
      if (projectModal) {
        // Primeiro alternamos o ícone com animação suave
        toggleSettingsIcon();
        
        // Depois abrimos o modal após a conclusão da animação
        setTimeout(() => {
          projectModal.hidden = false;
          projectModal.classList.add("active");
        }, ICON_TRANSITION_DURATION);
      } else {
        console.error('Modal de configuração de projeto não encontrado');
      }
    });
    
    // Adicionar listener para o botão de projeto
    projectSettingsButton.addEventListener('click', function(e) {
      e.preventDefault();
      
      if (projectModal) {
        // Carregar configurações do projeto antes de abrir o modal
        scanTopLevelFiles();
        loadProjectConfiguration();
        
        projectModal.hidden = false;
        projectModal.classList.add("active");
      } else {
        console.error('Modal de configuração de projeto não encontrado');
      }
    });
    
    // Configurar botões do modal de projeto
    setupProjectModalButtons();
    
    // Adicionar listener para o botão de toggle UI
    toggleUiButton.addEventListener('click', toggleConfigButtons);
    
    // Verificar estado inicial do toggle-ui
    setTimeout(() => {
      if (toggleUiButton.classList.contains('active')) {
        toggleConfigButtons();
      }
    }, 600);
    
    console.log('Sistema de alternância de botões de configuração inicializado');
  }
  
  // Função para alternar o ícone do botão settings com animação suave
  function toggleSettingsIcon() {
    const iconElement = settingsButton.querySelector('i');
    if (!iconElement) {
      console.error('Ícone não encontrado no botão settings');
      return;
    }
    
    // Configurar a transição
    iconElement.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    
    // Fade out
    iconElement.style.opacity = '0';
    
    // Após o fade out, trocar a classe e fazer fade in
    setTimeout(() => {
      // Verificar classe atual e alternar
      if (iconElement.classList.contains('fa-gears')) {
        iconElement.classList.remove('fa-gears');
        iconElement.classList.add('fa-gear');
      } else {
        iconElement.classList.remove('fa-gear');
        iconElement.classList.add('fa-gears');
      }
      
      // Força o reflow para garantir que a transição aconteça
      iconElement.offsetHeight;
      
      // Fade in
      iconElement.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }
  
  // Alterna entre os botões de configuração
  function toggleConfigButtons() {
    // Verificar se o toggleUiButton está ativo
    const isToggleActive = toggleUiButton.classList.contains('active');
    
    // Realizar a transição suave
    if (isToggleActive) {
      // Mostrar botão de projeto e ocultar botão original
      fadeOutIn(settingsButton, projectSettingsButton);
    } else {
      // Mostrar botão original e ocultar botão de projeto
      fadeOutIn(projectSettingsButton, settingsButton);
    }
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
  
  // Configurar os botões do modal de projeto
  function setupProjectModalButtons() {
    if (!projectModal) return;
    
    // Botão para fechar o modal (X no canto superior direito)
    const closeProjectModalBtn = document.getElementById('closeProjectModal');
    if (closeProjectModalBtn) {
      closeProjectModalBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Cancel
    const cancelProjectBtn = document.getElementById('cancelProjectConfig');
    if (cancelProjectBtn) {
      cancelProjectBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Save
    const saveProjectBtn = document.getElementById('saveProjectConfig');
    if (saveProjectBtn) {
      saveProjectBtn.addEventListener('click', () => {
        saveProjectConfiguration();
        closeProjectModal();
      });
    }
    
    // Fechar modal ao clicar fora (comportamento padrão)
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
  
  // Função para carregar configurações do projeto
  function loadProjectConfiguration() {
    try {
      // Limpar configurações temporárias
      tempProjectConfigs = {};
      
      // Aqui você implementaria o carregamento das configurações do projeto
      const savedConfig = localStorage.getItem('projectConfiguration');
      if (savedConfig) {
        tempProjectConfigs = JSON.parse(savedConfig);
        
        // Atualizar campos do formulário com os valores carregados
        updateProjectFormFields(tempProjectConfigs);
      }
      
      console.log('Configurações do projeto carregadas:', tempProjectConfigs);
    } catch (error) {
      console.error('Erro ao carregar configurações do projeto:', error);
    }
  }
  
  // Atualiza os campos do formulário com os valores carregados
  function updateProjectFormFields(config) {
    // Implementação específica para seus campos de formulário
  }
  
  // Função para salvar configurações do projeto
  function saveProjectConfiguration() {
    try {
      // Coletar valores dos seus campos específicos
      
      // Salvar configurações
      localStorage.setItem('projectConfiguration', JSON.stringify(tempProjectConfigs));
      
      console.log('Configurações do projeto salvas:', tempProjectConfigs);
    } catch (error) {
      console.error('Erro ao salvar configurações do projeto:', error);
    }
  }
  
  // Função para fechar o modal do projeto
  function closeProjectModal() {
    if (projectModal) {
      projectModal.classList.remove('active');
      
      // Pequeno delay antes de esconder completamente para permitir a animação
      setTimeout(() => {
        projectModal.hidden = true;
        
        // Restaurar o ícone original se necessário
        const iconElement = settingsButton.querySelector('i');
        if (iconElement && iconElement.classList.contains('fa-gear')) {
          toggleSettingsIcon();
        }
      }, 300);
    }
  }

  // Adicionar estilos CSS para a animação
  function addStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #settings, #settings-project {
        transition: opacity ${ICON_TRANSITION_DURATION}ms ease;
      }
      
      /* Garantir que os modais sejam visíveis quando abertos */
      .mconfig-modal.active {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(styleElement);
  }
  
  // Adicionar estilos e inicializar
  addStyles();
  init();
});