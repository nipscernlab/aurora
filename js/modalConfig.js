//modalConfig.js Modal configuration Processor Oriented Configuration

const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalConfig");
const closeModal = document.getElementById("closeModal");
const processorSelect = document.getElementById("processorSelect");
const deleteProcessorButton = document.getElementById("deleteProcessor");
const clearAllButton = document.getElementById("clearAll");
const clearTempButton = document.getElementById("clearTemp");
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const processorClkInput = document.getElementById("processorClk");
const processorNumClocksInput = document.getElementById("processorNumClocks");
const iverilogFlagsInput = document.getElementById("iverilogFlags");
const cmmCompFlagsInput = document.getElementById("cmmCompFlags");
const asmCompFlagsInput = document.getElementById("asmCompFlags");
const testbenchSelect = document.getElementById("testbenchSelect");
const gtkwSelect = document.getElementById("gtkwSelect");

// Store available processors and current configuration
let availableProcessors = [];
let selectedProcessor = null;
let currentConfig = {
  processors: [],
  iverilogFlags: [],
  cmmCompFlags: [],
  asmCompFlags: [],
  testbenchFile: "standard",
  gtkwFile: "standard",
  isActive: "false",

};


// Create a custom confirmation dialog component
function createConfirmationDialog() {
  // Check if dialog already exists and remove it
  const existingDialog = document.getElementById('custom-confirm-dialog');
  if (existingDialog) {
    document.body.removeChild(existingDialog);
  }

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

// Function to display a custom confirmation dialog
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


// Temporary storage for processor configurations
let tempProcessorConfigs = {};

// Get available processors from the main process
async function loadAvailableProcessors() {
  try {
    // First try to get current project info from the main process
    const projectInfo = await window.electronAPI.getCurrentProject();
    
    if (projectInfo.projectOpen) {
      console.log("Current project found:", projectInfo);
      window.currentProjectPath = projectInfo.projectPath;
      localStorage.setItem('currentProjectPath', projectInfo.projectPath);
      localStorage.setItem('currentSpfPath', projectInfo.spfPath);
      
      // Use processors from the current project
      availableProcessors = projectInfo.processors || [];
      updateProcessorSelect();
      return availableProcessors;
    }
    
    // If no current project, try to use stored project path
    const currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
    
    if (!currentProjectPath) {
      console.warn("No project path available to load processors");
      availableProcessors = [];
      updateProcessorSelect();
      return [];
    }
    
    console.log("Loading processors for project:", currentProjectPath);
    
    // Call the IPC method to get processors with the current project path
    const processors = await window.electronAPI.getAvailableProcessors(currentProjectPath);
    console.log("Loaded processors:", processors);
    
    availableProcessors = processors || [];
    updateProcessorSelect();
    return availableProcessors;
  } catch (error) {
    console.error("Failed to load available processors:", error);
    // Don't throw the error, just use empty array to continue
    availableProcessors = [];
    updateProcessorSelect();
    return [];
  }
}

// Update the processor select dropdown with available processors
function updateProcessorSelect() {
  console.log("Updating processor select with processors:", availableProcessors);
  
  // Clear existing options
  processorSelect.innerHTML = '';
  
  // Add a default option
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "-- Select Processor --";
  defaultOption.disabled = true;
  
  // Se não há processadores ou nenhum está selecionado, selecione a opção padrão
  defaultOption.selected = availableProcessors.length === 0 || !selectedProcessor;
  processorSelect.appendChild(defaultOption);
  
  // Add processor options
  availableProcessors.forEach(processor => {
    const option = document.createElement("option");
    option.value = processor;
    option.textContent = processor;
    option.selected = processor === selectedProcessor;
    processorSelect.appendChild(option);
    console.log(`Added processor option: ${processor}`);
  });
  
  // Garantir que selectedProcessor está definido corretamente
  if (availableProcessors.length > 0 && !selectedProcessor) {
    selectedProcessor = availableProcessors[0];
    console.log("Auto-selected the first processor:", selectedProcessor);
  } else if (availableProcessors.length === 0) {
    // Se não há processadores, garantir que selectedProcessor é nulo
    selectedProcessor = null;
    console.log("No processors available, set selectedProcessor to null");
  }
  
  // Enable/disable delete button based on selection
  deleteProcessorButton.disabled = !selectedProcessor;
  
  // Force a UI refresh
  processorSelect.blur();
  processorSelect.focus();
}

// Update the saveCurrentProcessorToTemp function to save simulation file selections
// Update the saveCurrentProcessorToTemp function to correctly save simulation file selections
function saveCurrentProcessorToTemp() {
  if (selectedProcessor) {
    const clk = processorClkInput.value.trim();
    const numClocks = processorNumClocksInput.value.trim();
    const testbenchFile = testbenchSelect.value;
    const gtkwFile = gtkwSelect.value;
    
    tempProcessorConfigs[selectedProcessor] = {
      name: selectedProcessor,
      clk: clk ? Number(clk) : null,
      numClocks: numClocks ? Number(numClocks) : null,
      testbenchFile: testbenchFile,
      gtkwFile: gtkwFile
    };
    
    console.log(`Saved temporary config for ${selectedProcessor}:`, tempProcessorConfigs[selectedProcessor]);
  }
}


async function loadSimulationFiles(processorName) {
  if (!processorName) {
    // Reset and disable selects if no processor is selected
    testbenchSelect.innerHTML = '<option value="standard" selected>Standard Testbench</option>';
    gtkwSelect.innerHTML = '<option value="standard" selected>Standard GTKWave</option>';
    testbenchSelect.disabled = true;
    gtkwSelect.disabled = true;
    return;
  }

  try {
    testbenchSelect.disabled = true;
    gtkwSelect.disabled = true;
    
    console.log(`Loading simulation files for processor: ${processorName}`);
    
    // Get current project path from various possible sources
    const currentProjectPath = 
      window.currentProjectPath || 
      localStorage.getItem('currentProjectPath');
    
    console.log(`Current project path from local storage: ${currentProjectPath}`);
    
    if (currentProjectPath) {
      // Set the current project in the main process (for future reference)
      await window.electronAPI.setCurrentProject(currentProjectPath);
      console.log(`Set current project path to: ${currentProjectPath}`);
    } else {
      console.warn("No current project path available in local storage");
    }
    
    // Pass the project path directly when calling getSimulationFiles
    const result = await window.electronAPI.getSimulationFiles(processorName, currentProjectPath);
    
    if (!result.success) {
      console.warn(`Failed to get simulation files: ${result.message || 'Unknown error'}`);
      // Still allow default selection even in case of error
      testbenchSelect.disabled = false;
      gtkwSelect.disabled = false;
      return;
    }
    
    const { testbenchFiles, gtkwFiles } = result;
    
    // Update testbench select
    testbenchSelect.innerHTML = '<option value="standard">Standard Testbench</option>';
    testbenchFiles.forEach(file => {
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      // Select this option if it matches saved configuration
      if (currentConfig.testbenchFile === file) {
        option.selected = true;
      } else if (tempProcessorConfigs[processorName] && 
                tempProcessorConfigs[processorName].testbenchFile === file) {
        option.selected = true;
      }
      testbenchSelect.appendChild(option);
    });
    
    // Update GTKWave select
    gtkwSelect.innerHTML = '<option value="standard">Standard GTKWave</option>';
    gtkwFiles.forEach(file => {
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      // Select this option if it matches saved configuration
      if (currentConfig.gtkwFile === file) {
        option.selected = true;
      } else if (tempProcessorConfigs[processorName] && 
                tempProcessorConfigs[processorName].gtkwFile === file) {
        option.selected = true;
      }
      gtkwSelect.appendChild(option);
    });
    
    // Enable selects
    testbenchSelect.disabled = false;
    gtkwSelect.disabled = false;
    
    console.log(`Loaded ${testbenchFiles.length} testbench files and ${gtkwFiles.length} GTKWave files`);
    
  } catch (error) {
    console.error("Failed to load simulation files:", error);
    showNotification("Failed to load simulation files", 'error');
    
    // Still allow default selection even in case of error
    testbenchSelect.disabled = false;
    gtkwSelect.disabled = false;
  }
}


// Update the processor selection change event to load simulation files
processorSelect.addEventListener("change", function() {
  // Save current processor config to temp storage before switching
  saveCurrentProcessorToTemp();
  
  // Update selected processor
  selectedProcessor = this.value;
  deleteProcessorButton.disabled = !selectedProcessor;
  
  // Load simulation files for the selected processor
  loadSimulationFiles(selectedProcessor);
  
  // Check if we have a temp config for this processor
  if (selectedProcessor && tempProcessorConfigs[selectedProcessor]) {
    const tempConfig = tempProcessorConfigs[selectedProcessor];
    processorClkInput.value = tempConfig.clk || '';
    processorNumClocksInput.value = tempConfig.numClocks || '';
    
    // Set simulation file selections if available in temp config
    if (tempConfig.testbenchFile) {
      testbenchSelect.value = tempConfig.testbenchFile;
    } else {
      testbenchSelect.value = "standard";
    }
    
    if (tempConfig.gtkwFile) {
      gtkwSelect.value = tempConfig.gtkwFile;
    } else {
      gtkwSelect.value = "standard";
    }
    
    console.log(`Loaded temp config for ${selectedProcessor}:`, tempConfig);
    return;
  }
  
  // Otherwise look for config in current loaded config
  const processorConfig = currentConfig.processors.find(p => p.name === selectedProcessor);
  
  if (processorConfig) {
    processorClkInput.value = processorConfig.clk || '';
    processorNumClocksInput.value = processorConfig.numClocks || '';
    
    // Set simulation file selections if available in processor config
    if (processorConfig.testbenchFile) {
      testbenchSelect.value = processorConfig.testbenchFile;
    } else {
      testbenchSelect.value = "standard";
    }
    
    if (processorConfig.gtkwFile) {
      gtkwSelect.value = processorConfig.gtkwFile;
    } else {
      gtkwSelect.value = "standard";
    }
  } else {
    processorClkInput.value = '';
    processorNumClocksInput.value = '';
    testbenchSelect.value = "standard";
    gtkwSelect.value = "standard";
  }
});

function deleteProcessor(processorName) {
  return new Promise(async (resolve, reject) => {
    if (!processorName) {
      reject(new Error("No processor selected for deletion"));
      return;
    }
    
    console.log(`Starting deletion of processor: ${processorName}`);
    
    try {
      // Call API to delete processor with safety timeout
      const deletePromise = window.electronAPI.deleteProcessor(processorName);
      
      // Add timeout to prevent indefinite blocking
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation timed out")), 10000);
      });
      
      // Use Promise.race to ensure it doesn't get stuck
      await Promise.race([deletePromise, timeoutPromise]);
      
      console.log(`Successfully deleted processor: ${processorName}`);
      
      // Remove from available processors
      availableProcessors = availableProcessors.filter(p => p !== processorName);
      console.log("Updated available processors:", availableProcessors);
      
      // Remove from current config
      if (currentConfig && currentConfig.processors) {
        currentConfig.processors = currentConfig.processors.filter(p => p.name !== processorName);
      }
      
      // Remove from temp configs
      if (tempProcessorConfigs && tempProcessorConfigs[processorName]) {
        delete tempProcessorConfigs[processorName];
      }
      
      // Reset selection if we deleted the currently selected processor
      if (selectedProcessor === processorName) {
        selectedProcessor = null;
        console.log("Reset selectedProcessor to null after deletion");
      }
      
      // Handle UI updates if no processors remain
      if (availableProcessors.length === 0) {
        console.log("No processors remain after deletion");
        selectedProcessor = null;
        processorClkInput.value = '';
        processorNumClocksInput.value = '';
      } else if (!selectedProcessor) {
        // If there are still processors but none selected, select the first one
        selectedProcessor = availableProcessors[0];
        console.log("Selected first available processor after deletion:", selectedProcessor);
        
        // Update input fields with the new selection's values
        const newSelectedProc = currentConfig.processors.find(p => p.name === selectedProcessor);
        if (newSelectedProc) {
          processorClkInput.value = newSelectedProc.clk || '';
          processorNumClocksInput.value = newSelectedProc.numClocks || '';
        }
      }
      
      resolve(processorName);
    } catch (error) {
      console.error(`Error deleting processor ${processorName}:`, error);
      reject(error);
    }
  });
}

// Função melhorada para o event listener do botão de excluir
deleteProcessorButton.addEventListener("click", function() {
  if (!selectedProcessor) {
    showNotification("No processor selected for deletion", 'warning');
    return;
  }
  
  // Capturar o nome do processador a ser excluído antes de qualquer operação
  const processorToDelete = selectedProcessor;
  console.log(`Preparing to delete processor: ${processorToDelete}`);
  
  const confirmMessage = `Are you sure you want to delete processor "${processorToDelete}"?`;
  
  showConfirmationDialog(confirmMessage, async function() {
    try {
      // Disable button during operation to prevent multiple clicks
      deleteProcessorButton.disabled = true;
      
      // Use a função de exclusão melhorada
      await deleteProcessor(processorToDelete);
      
      // Update UI after a short delay
      setTimeout(() => {
        try {
          console.log("Updating UI after processor deletion");
          
          // Make sure we update the processor select correctly
          updateProcessorSelect();
          
          // Update button state based on whether we have a selection
          deleteProcessorButton.disabled = !selectedProcessor;

          setTimeout(() => {
            modal.hidden = true;
            // Force page re-render to ensure input events work
            document.body.style.display = 'none';
            setTimeout(() => { document.body.style.display = ''; }, 5);
          }, 300);
          
          // Show success notification
          showNotification(`Processor "${processorToDelete}" successfully deleted.`, 'success');
        } catch (innerError) {
          console.error("Error in UI update after processor deletion:", innerError);
        }
      }, 200);
      
      // If file tree refresh function exists, call it safely
      setTimeout(() => {
        try {
          if (typeof window.refreshFileTree === 'function') {
            window.refreshFileTree();
          } else if (typeof refreshFileTree === 'function') {
            refreshFileTree();
          }
        } catch (treeError) {
          console.error("Error refreshing file tree:", treeError);
        }
      }, 500);
      
    } catch (error) {
      console.error("Failed to delete processor:", error);
      showNotification(`Failed to delete processor: ${error.message}`, 'error');
      
      // Ensure button is reactivated in case of error
      deleteProcessorButton.disabled = false;
    }
  });
});


// Update the loadConfiguration function to load simulation file selections
async function loadConfiguration() {
  try {
    const config = await window.electronAPI.loadConfig();
    currentConfig = config;
    
    // Reset temp storage when loading new configuration
    tempProcessorConfigs = {};
    
    // Populate processor selection if available
    if (config.processors && config.processors.length > 0) {
      // Initialize temp configs with current configs
      config.processors.forEach(proc => {
        tempProcessorConfigs[proc.name] = {...proc};
      });
      
      const lastActiveProcessor = config.processors[0]; // Assume first processor is the active one
      selectedProcessor = lastActiveProcessor.name;
      
      processorClkInput.value = lastActiveProcessor.clk || '';
      processorNumClocksInput.value = lastActiveProcessor.numClocks || '';
      
      // Load simulation files for the selected processor
      loadSimulationFiles(selectedProcessor);
    } else {
      selectedProcessor = null;
      processorClkInput.value = '';
      processorNumClocksInput.value = '';
      
      // Disable simulation file selects
      loadSimulationFiles(null);
    }
    
    // Populate compiler flags inputs
    if (config.iverilogFlags) {
      iverilogFlagsInput.value = config.iverilogFlags.join("; ");
    } else {
      iverilogFlagsInput.value = "";
    }
    
    if (config.cmmCompFlags) {
      cmmCompFlagsInput.value = config.cmmCompFlags.join("; ");
    } else {
      cmmCompFlagsInput.value = "";
    }
    
    if (config.asmCompFlags) {
      asmCompFlagsInput.value = config.asmCompFlags.join("; ");
    } else {
      asmCompFlagsInput.value = "";
    }
    
    // Update the processor select dropdown
    updateProcessorSelect();
  } catch (error) {
    console.error("Failed to load configuration:", error);
  }
}

// Opens the configuration modal and loads the current configuration
settingsButton.addEventListener("click", async () => {
  try {
    // Reset temporary processor configs
    tempProcessorConfigs = {};
    
    await loadAvailableProcessors();
    await loadConfiguration();
    modal.hidden = false;
    modal.classList.add("active");
  } catch (error) {
    console.error("Error opening configuration modal:", error);
  }
});

// Closes the configuration modal
closeModal.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Clears all fields
clearAllButton.addEventListener("click", () => {
  processorClkInput.value = "";
  processorNumClocksInput.value = "";
  iverilogFlagsInput.value = "";
  cmmCompFlagsInput.value = "";
  asmCompFlagsInput.value = "";
});

// Clears the Temp folder
clearTempButton.addEventListener("click", async () => {
  try {
    await window.electronAPI.clearTempFolder();
    alert("Temp folder successfully deleted!");
  } catch (error) {
    console.error("Error deleting Temp folder:", error);
    alert("Failed to delete Temp folder.");
  }
});

// Saves the current configuration
// Saves the current configuration
saveConfigButton.addEventListener("click", async () => {
  saveCurrentProcessorToTemp();

  // Convert temporary processor configs to an array
  let processors = Object.values(tempProcessorConfigs);
  
  // Mark the selected processor as active and all others as inactive
  processors = processors.map(proc => ({
    ...proc,
    isActive: proc.name === selectedProcessor
  }));

  const iverilogFlags = iverilogFlagsInput.value
    .split(";")
    .map(flag => flag.trim())
    .filter(flag => flag);

  const cmmCompFlags = cmmCompFlagsInput.value
    .split(";")
    .map(flag => flag.trim())
    .filter(flag => flag);

  const asmCompFlags = asmCompFlagsInput.value
    .split(";")
    .map(flag => flag.trim())
    .filter(flag => flag);

  const config = {
    processors,
    iverilogFlags,
    cmmCompFlags,
    asmCompFlags
  };

  console.log("Saving Configuration:", config);

  try {
    // Call the IPC method to save the configuration
    await window.electronAPI.saveConfig(config);
    
    // Update currentConfig with the new values
    currentConfig = config;
    
    // Update processor status in UI
    const processorStatus = document.getElementById("processorNameID");
    if (processorStatus) {
      // Start transition: fade out
      processorStatus.style.opacity = "0";
    
      // Wait for transition before changing content
      setTimeout(() => {
        if (processors.length > 0) {
          // Find the active processor
          const activeProcessor = processors.find(proc => proc.isActive) || processors[0];
          const processorName = activeProcessor.name;
          processorStatus.innerHTML = `<i class="fa-solid fa-gears"></i> ${processorName}`;
        } else {
          processorStatus.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131;"></i> No Processor Configured`;
        }
    
        // Fade back in smoothly
        processorStatus.style.opacity = "1";
      }, 300);
    }
    
    // Show success notification and close modal
    showNotification("Configuration saved successfully", 'success');
    modal.classList.remove("active");
    setTimeout(() => modal.hidden = true, 300);
    
  } catch (error) {
    console.error("Failed to save configuration:", error);
    showNotification("Failed to save configuration: " + error.message, 'error');
  }
});


// Cancels the configuration changes and closes the modal
cancelConfigButton.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Listen for processor creation events to update the list
window.electronAPI.onProcessorCreated((data) => {
  console.log("Processor created event received:", data);
  
  // Extract data from the event
  const processorName = typeof data === 'object' ? data.processorName : data;
  const projectPath = typeof data === 'object' ? data.projectPath : window.currentProjectPath;
  
  if (projectPath) {
    // Store the project path for future use
    if (window.currentProjectPath === undefined) {
      window.currentProjectPath = projectPath;
    }
    localStorage.setItem('currentProjectPath', projectPath);
  }
  
  // Always reload the processor list from the main process
  loadAvailableProcessors().then(processors => {
    // After loading, make sure the new processor is selected
    if (processorName && processors.includes(processorName)) {
      // Save the current processor config first
      saveCurrentProcessorToTemp();
      
      // Update selection
      selectedProcessor = processorName;
      updateProcessorSelect();
      
      // Set default values for the new processor
      processorClkInput.value = '100'; // Default clock, adjust as needed
      processorNumClocksInput.value = '1000'; // Default clocks, adjust as needed
      
      // Save the new processor to temp configs
      tempProcessorConfigs[processorName] = {
        name: processorName,
        clk: 100,
        numClocks: 1000
      };
    }
  }).catch(error => {
    console.error("Failed to reload processors after creation:", error);
  });
});

// Listen for project open events to update processor list
window.electronAPI.onProjectOpen((data) => {
  console.log("Project opened event received:", data);
  
  // Extract project path
  if (data && data.projectPath) {
    window.currentProjectPath = data.projectPath;
    localStorage.setItem('currentProjectPath', data.projectPath);
  }
  
  // Reload processors
  loadAvailableProcessors().catch(error => {
    console.error("Failed to reload processors after project open:", error);
  });
});

// Listen for processor list updates
window.electronAPI.onProcessorsUpdated((data) => {
  console.log("Processors updated event received:", data);
  
  if (data && data.processors) {
    availableProcessors = data.processors;
    updateProcessorSelect();
  }
});

// Initial load of available processors when the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Load processors at startup so they're available even before opening modal
  await loadAvailableProcessors();
});

function showNotification(message, type = 'info') {
  console.log(`[${type}] ${message}`);
  
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.position = 'fixed';
  notification.style.bottom = '30px';
  notification.style.right = '30px';
  notification.style.maxWidth = '400px';
  notification.style.padding = '12px 20px';
  notification.style.borderRadius = '8px';
  notification.style.fontFamily = 'Segoe UI, Roboto, sans-serif';
  notification.style.fontSize = '14px';
  notification.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  notification.style.color = 'white';
  notification.style.zIndex = '9999';
  notification.style.opacity = '0';
  notification.style.transform = 'translateY(20px)';
  notification.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  
  // Estilo baseado no tipo de notificação
  if (type === 'error') {
    notification.style.backgroundColor = '#e74c3c'; // vermelho suave
  } else if (type === 'success') {
    notification.style.backgroundColor = '#2ecc71'; // verde suave
  } else {
    notification.style.backgroundColor = '#3498db'; // azul suave
  }

  document.body.appendChild(notification);

  // Forçar reflow para ativar a transição
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  });

  // Remover a notificação após 3 segundos
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 400); // deve combinar com o tempo de transição
  }, 3000);
}

// Add the style for the simulation selectors
const styleElement = document.createElement('style');
styleElement.textContent = `
  .mconfig-processor-simulation {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border-primary);
  }
  
  .mconfig-simulation-selectors {
    display: flex;
    gap: 16px;
    margin-top: 16px;
  }
  
  .mconfig-simulation-selectors .mconfig-form-group {
    flex: 1;
  }
`;
document.head.appendChild(styleElement);