//modalProcessorConfig.js Modal configuration Processor Oriented Configuration

const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalProcessorConfig");
const closeModal = document.getElementById("closeModal");
const processorSelect = document.getElementById("processorSelect");
const deleteProcessorButton = document.getElementById("deleteProcessor");
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const processorClkInput = document.getElementById("processorClk");
const processorNumClocksInput = document.getElementById("processorNumClocks");
const iverilogFlagsInput = document.getElementById("iverilogFlags");
const cmmCompFlagsInput = document.getElementById("cmmCompFlags");
const asmCompFlagsInput = document.getElementById("asmCompFlags");
const testbenchSelect = document.getElementById("processortestbenchSelect");
const gtkwSelect = document.getElementById("processorgtkwaveSelect");
const cmmFileSelect = document.getElementById("cmmFileSelect");
const showArraysCheckbox = document.getElementById("showArraysInGtkwave");

// Store available processors and current configuration
let availableProcessors = [];
let selectedProcessor = null;
let selectedCmmFile = null;

let currentConfig = {
  processors: [],
  iverilogFlags: [],
  cmmCompFlags: [],
  asmCompFlags: [],
  testbenchFile: "standard",
  gtkwFile: "standard",
  isActive: false,

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
  defaultOption.textContent = "Select Processor";
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
async function loadCmmFiles(processorName) {
  if (!cmmFileSelect) {
    console.error("C± file select element not found");
    return;
  }

  if (!processorName) {
    // Reset and disable select if no processor is selected
    cmmFileSelect.innerHTML = '<option value="" selected>Select C± File</option>';
    cmmFileSelect.disabled = true;
    selectedCmmFile = null;
    return;
  }

  try {
    cmmFileSelect.disabled = true;
    cmmFileSelect.innerHTML = '<option value="">Loading...</option>';
    
    console.log(`Loading C± files for processor: ${processorName}`);
    
    // Get current project path
    const projectInfo = await window.electronAPI.getCurrentProject();
    const currentProjectPath = projectInfo.projectPath || 
      window.currentProjectPath || 
      localStorage.getItem('currentProjectPath');
    
    if (!currentProjectPath) {
      console.warn("No current project path available");
      cmmFileSelect.innerHTML = '<option value="">No Project</option>';
      return;
    }
    
    // Get the software folder path for this processor
    const softwareFolderPath = await window.electronAPI.joinPath(currentProjectPath, processorName, 'Software');
    
    // Get all .cmm files from the software folder
    const files = await window.electronAPI.listFilesInDirectory(softwareFolderPath);
    const cmmFiles = files.filter(file => file.toLowerCase().endsWith('.cmm'));
    
    console.log(`Found ${cmmFiles.length} C± files`);
    
    // Update CMM file select
    cmmFileSelect.innerHTML = '<option value="">Select C± File</option>';
    
    if (cmmFiles.length === 0) {
      const noFilesOption = document.createElement('option');
      noFilesOption.value = "";
      noFilesOption.textContent = "No C± files found";
      noFilesOption.disabled = true;
      cmmFileSelect.appendChild(noFilesOption);
    } else {
      cmmFiles.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file;
        
        // Select this option if it matches saved configuration
        if (tempProcessorConfigs[processorName] && 
            tempProcessorConfigs[processorName].cmmFile === file) {
          option.selected = true;
          selectedCmmFile = file;
        }
        
        cmmFileSelect.appendChild(option);
      });
    }
    
    // Enable select
    cmmFileSelect.disabled = false;
    
  } catch (error) {
    console.error("Failed to load C± files:", error);
    cmmFileSelect.innerHTML = '<option value="">Error Loading Files</option>';
    showNotification("Failed to load C± files", 'error');
  }
}

// Add event listener for CMM file selection
cmmFileSelect.addEventListener("change", function() {
  selectedCmmFile = this.value;
  console.log(`Selected C± file: ${selectedCmmFile}`);
  
  // Save to temp config if processor is selected
  if (selectedProcessor && selectedCmmFile) {
    if (!tempProcessorConfigs[selectedProcessor]) {
      tempProcessorConfigs[selectedProcessor] = { name: selectedProcessor };
    }
    tempProcessorConfigs[selectedProcessor].cmmFile = selectedCmmFile;
  }
});


// Add this function to handle testbench selection changes
function handleTestbenchChange() {
 const isStandardTestbench = testbenchSelect.value === "standard";
 const clkContainer = document.querySelector('.clk-inputs-container') || 
                     processorClkInput.parentElement.parentElement;
 
 if (isStandardTestbench) {
   // Show clock inputs with smooth animation
   clkContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
   clkContainer.style.opacity = '0';
   clkContainer.style.transform = 'translateY(-10px)';
   clkContainer.style.display = 'flex';
   
   setTimeout(() => {
     clkContainer.style.opacity = '1';
     clkContainer.style.transform = 'translateY(0)';
   }, 10);
 } else {
   // Hide clock inputs with smooth animation
   clkContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
   clkContainer.style.opacity = '0';
   clkContainer.style.transform = 'translateY(-10px)';
   
   setTimeout(() => {
     clkContainer.style.display = 'none';
   }, 300);
 }
}

// Add event listener for testbench selection changes
testbenchSelect.addEventListener("change", handleTestbenchChange);

async function loadSimulationFiles(processorName) {
  // Check if elements exist before manipulating them
  if (!testbenchSelect || !gtkwSelect) {
    console.error("Required DOM elements testbenchSelect or gtkwSelect not found");
    return;
  }

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
    const projectInfo = await window.electronAPI.getCurrentProject();
    const currentProjectPath = projectInfo.projectPath || 
      window.currentProjectPath || 
      localStorage.getItem('currentProjectPath');
    
    console.log(`Current project path: ${currentProjectPath}`);
    
    if (!currentProjectPath) {
      console.warn("No current project path available");
      testbenchSelect.disabled = false;
      gtkwSelect.disabled = false;
      return;
    }
    
    // Get the simulation folder path for this processor
    const simulationFolderPath =  await window.electronAPI.joinPath(currentProjectPath, processorName, 'Simulation');

    
    console.log(`Simulation folder path: ${simulationFolderPath}`);
    
    // Get all .v and .gtkw files from the simulation folder
    const files = await window.electronAPI.listFilesInDirectory(simulationFolderPath);
    
    const verilogFiles = files.filter(file => file.toLowerCase().endsWith('.v'));
    const gtkwFiles = files.filter(file => file.toLowerCase().endsWith('.gtkw'));
    
    console.log(`Found ${verilogFiles.length} Verilog files and ${gtkwFiles.length} GTKWave files`);
    
    // Update testbench select
    testbenchSelect.innerHTML = '<option value="standard">Standard Testbench</option>';
    verilogFiles.forEach(file => {
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
    
  } catch (error) {
    console.error("Failed to load simulation files:", error);
    showNotification("Failed to load simulation files", 'error');
    
    // Still allow default selection even in case of error
    if (testbenchSelect) testbenchSelect.disabled = false;
    if (gtkwSelect) gtkwSelect.disabled = false;
  }
 setTimeout(() => {
   handleTestbenchChange();
 }, 100);
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
  
  // Load CMM files for the selected processor
  loadCmmFiles(selectedProcessor);
  
  // Check if we have a temp config for this processor
  if (selectedProcessor && tempProcessorConfigs[selectedProcessor]) {
    const tempConfig = tempProcessorConfigs[selectedProcessor];
    processorClkInput.value = tempConfig.clk || '';
    processorNumClocksInput.value = tempConfig.numClocks || '';
    showArraysCheckbox.checked = tempConfig.showArraysInGtkwave === 1;

    // Set simulation file selections if available in temp config
    if (tempConfig.testbenchFile && testbenchSelect) {
      testbenchSelect.value = tempConfig.testbenchFile;
    } else if (testbenchSelect) {
      testbenchSelect.value = "standard";
    }
    
    if (tempConfig.gtkwFile && gtkwSelect) {
      gtkwSelect.value = tempConfig.gtkwFile;
    } else if (gtkwSelect) {
      gtkwSelect.value = "standard";
    }
    
    // Set CMM file selection if available in temp config - CORRIGIDO
    if (tempConfig.cmmFile && cmmFileSelect) {
      cmmFileSelect.value = tempConfig.cmmFile;
      selectedCmmFile = tempConfig.cmmFile;
    } else if (cmmFileSelect) {
      cmmFileSelect.value = "";
      selectedCmmFile = null;
    }
    
    console.log(`Loaded temp config for ${selectedProcessor}:`, tempConfig);
    return;
  }
  
  // Otherwise look for config in current loaded config
  const processorConfig = currentConfig.processors.find(p => p.name === selectedProcessor);
  
  if (processorConfig) {
    processorClkInput.value = processorConfig.clk || '';
    processorNumClocksInput.value = processorConfig.numClocks || '';
    showArraysCheckbox.checked = processorConfig.showArraysInGtkwave === 1; 

    // Set simulation file selections if available in processor config
    if (processorConfig.testbenchFile && testbenchSelect) {
      testbenchSelect.value = processorConfig.testbenchFile;
    } else if (testbenchSelect) {
      testbenchSelect.value = "standard";
    }
    
    if (processorConfig.gtkwFile && gtkwSelect) {
      gtkwSelect.value = processorConfig.gtkwFile;
    } else if (gtkwSelect) {
      gtkwSelect.value = "standard";
    }
    
    // Set CMM file selection if available in processor config - CORRIGIDO
    if (processorConfig.cmmFile && cmmFileSelect) {
      cmmFileSelect.value = processorConfig.cmmFile;
      selectedCmmFile = processorConfig.cmmFile;
    } else if (cmmFileSelect) {
      cmmFileSelect.value = "";
      selectedCmmFile = null;
    }
  } else {
    processorClkInput.value = '';
    processorNumClocksInput.value = '';
    showArraysCheckbox.checked = false;
    if (testbenchSelect) testbenchSelect.value = "standard";
    if (gtkwSelect) gtkwSelect.value = "standard";
    if (cmmFileSelect) { // CORRIGIDO
      cmmFileSelect.value = "";
      selectedCmmFile = null;
    }
  }
  
  // Handle testbench visibility after processor change
  setTimeout(() => {
    if (testbenchSelect) {
      handleTestbenchChange();
    }
  }, 100);
});



  processorClkInput.addEventListener("input", () => {
      const value = parseInt(processorClkInput.value, 10);
      if (value > 1000) {
        processorClkInput.value = 1000;
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

async function loadConfiguration() {
  try {
    // Get current project info
    const projectInfo = await window.electronAPI.getCurrentProject();
    
    if (!projectInfo.projectOpen || !projectInfo.projectPath) {
      console.warn("No current project available for loading configuration");
      return;
    }
    
    // Use the joinPath method to get the processorConfig.json path
    const processorConfigPath = await window.electronAPI.joinPath(projectInfo.projectPath, 'processorConfig.json');
    const config = await window.electronAPI.loadConfigFromPath(processorConfigPath);
    
    currentConfig = config;
    
    // Reset temp storage when loading new configuration
    tempProcessorConfigs = {};
     const projectSimuDelayInput = document.getElementById('projectSimuDelay');
  if (projectSimuDelayInput && config.simuDelay) {
    projectSimuDelayInput.value = config.simuDelay;
  }
  
  // Load simuDelay for processor configuration
  const processorSimuDelayInput = document.getElementById('processorSimuDelay');
  if (processorSimuDelayInput && config.simuDelay) {
    processorSimuDelayInput.value = config.simuDelay;
  }
    // Populate processor selection if available
    if (config.processors && config.processors.length > 0) {
      // Initialize temp configs with current configs
      config.processors.forEach(proc => {
        tempProcessorConfigs[proc.name] = {...proc};
      });
      
      const lastActiveProcessor = config.processors.find(p => p.isActive) || config.processors[0];
      selectedProcessor = lastActiveProcessor.name;
      
      processorClkInput.value = lastActiveProcessor.clk || '';
      processorNumClocksInput.value = lastActiveProcessor.numClocks || '';
      showArraysCheckbox.checked = lastActiveProcessor.showArraysInGtkwave === 1;

      // Check if simulation file references exist and load files
      await loadSimulationFiles(selectedProcessor);
      
      // Load CMM files for the selected processor
      await loadCmmFiles(selectedProcessor);
      
      // Set CMM file selection if available - CORRIGIDO
      if (lastActiveProcessor.cmmFile && cmmFileSelect) {
        cmmFileSelect.value = lastActiveProcessor.cmmFile;
        selectedCmmFile = lastActiveProcessor.cmmFile;
      }
    } else {
      selectedProcessor = null;
      processorClkInput.value = '';
      processorNumClocksInput.value = '';
      showArraysCheckbox.checked = false;

      // Disable simulation file selects
      if (testbenchSelect) testbenchSelect.disabled = true;
      if (gtkwSelect) gtkwSelect.disabled = true;
      if (cmmFileSelect) cmmFileSelect.disabled = true; // CORRIGIDO
    }
    
    /*
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
    } */
    
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
    
    // After loading configuration, if there's a selected processor, load its simulation files
    if (selectedProcessor) {
      await loadSimulationFiles(selectedProcessor);
    }
    
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

// Modify the existing saveConfigButton event listener - ADD CMM file to config
// Correção do saveCurrentProcessorToTemp para incluir o arquivo CMM
function saveCurrentProcessorToTemp() {
  if (selectedProcessor) {
    const clk = processorClkInput.value.trim();
    const numClocks = processorNumClocksInput.value.trim();
    const testbenchFile = testbenchSelect ? testbenchSelect.value : "standard";
    const gtkwFile = gtkwSelect ? gtkwSelect.value : "standard";
    const cmmFile = cmmFileSelect ? cmmFileSelect.value : ""; // ADICIONADO
    const showArrays = showArraysCheckbox.checked ? 1 : 0;

    tempProcessorConfigs[selectedProcessor] = {
      name: selectedProcessor,
      clk: clk ? Number(clk) : null,
      numClocks: numClocks ? Number(numClocks) : null,
      testbenchFile: testbenchFile,
      gtkwFile: gtkwFile,
      cmmFile: cmmFile, // ADICIONADO
      isActive: selectedProcessor === selectedProcessor,
      showArraysInGtkwave: showArrays
    };
    
    console.log(`Saved temporary config for ${selectedProcessor}:`, tempProcessorConfigs[selectedProcessor]);
  }
}

// Correção do event listener do saveConfigButton para incluir CMM file na configuração
saveConfigButton.addEventListener("click", async () => {
  saveCurrentProcessorToTemp();

  // Convert temporary processor configs to an array
  let processors = Object.values(tempProcessorConfigs);
  
  // Mark the selected processor as active and all others as inactive
  processors = processors.map(proc => ({
    ...proc,
    isActive: proc.name === selectedProcessor
  }));

  // Get the current simulation file selections
  const selectedTestbench = testbenchSelect ? testbenchSelect.value : "standard";
  const selectedGtkw = gtkwSelect ? gtkwSelect.value : "standard";
  
  // The global 'simuDelay' is no longer needed here; it's handled by 'numClocks' per processor.
  const config = {
    processors,
    testbenchFile: selectedTestbench,
    gtkwFile: selectedGtkw,
  };

  console.log("Saving Configuration:", config);

  try {
    // Get current project path
    const projectInfo = await window.electronAPI.getCurrentProject();
    const currentProjectPath = projectInfo.projectPath || 
      window.currentProjectPath || 
      localStorage.getItem('currentProjectPath');
    
    if (!currentProjectPath) {
      showNotification("No current project path available for saving configuration", 'error');
      return;
    }
    
    // Call the IPC method to save the configuration with project path
    await window.electronAPI.saveConfig(config, currentProjectPath);
    
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
          const processorCMM = activeProcessor.cmmFile;
          const processorTb = activeProcessor.testbenchFile;
          const processorGTKW = activeProcessor.gtkwFile;

          processorStatus.innerHTML = `${processorName} &nbsp;<i class="fa-solid fa-gears"></i> ${processorCMM || "N/A"} | ${processorTb || "N/A"} | ${processorGTKW || "N/A"}`;
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

// Add the style for the simulation selectors
const styleElement = document.createElement('style');
styleElement.textContent = `
  .modalConfig-processor-simulation {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border-primary);
  }
  
  .modalConfig-simulation-selectors {
    display: flex;
    gap: 16px;
    margin-top: 16px;
  }
  
  .modalConfig-simulation-selectors .modalConfig-form-group {
    flex: 1;
  }
`;
document.head.appendChild(styleElement);

document.addEventListener('DOMContentLoaded', () => {
  // 1. Get references to the DOM elements once the document is ready
  const clkInput = document.getElementById("processorClk");
  const numClocksInput = document.getElementById("processorNumClocks");
  const simulTimeInput = document.getElementById("processorSimulTime");

  /**
   * Calculates the clock period in microseconds (µs) from a frequency in MHz.
   * @param {number} freqMHz - The clock frequency in MHz.
   * @returns {number|null} The clock period in µs, or null if frequency is invalid.
   */
  function getClockPeriodInMicroseconds(freqMHz) {
    // A frequency must be a positive number.
    if (!freqMHz || freqMHz <= 0) {
      return null;
    }
    // Formula: Period (µs) = 1 / Frequency (MHz)
    return 1 / freqMHz;
  }

  /**
   * Calculates and updates the Simulation Time (µs) field.
   * Triggered when clock frequency or number of clocks change.
   */
  function updateSimulationTime() {
    const freqMHz = parseFloat(clkInput.value);
    const numClocks = parseInt(numClocksInput.value, 10);
    const period_us = getClockPeriodInMicroseconds(freqMHz);

    // Check if all inputs are valid numbers
    if (period_us !== null && !isNaN(numClocks) && numClocks >= 0) {
      const totalTime = numClocks * period_us;
      // Update the simulation time input, rounding to 4 decimal places for clarity
      simulTimeInput.value = totalTime.toFixed(4);
    } else {
      // If inputs are invalid (e.g., empty or zero), clear the output
      simulTimeInput.value = '';
    }
  }

  /**
   * Calculates and updates the Number of Clocks field.
   * Triggered when simulation time changes.
   */
  function updateNumberOfClocks() {
    const freqMHz = parseFloat(clkInput.value);
    const simTime_us = parseFloat(simulTimeInput.value);
    const period_us = getClockPeriodInMicroseconds(freqMHz);

    // Check if all inputs are valid numbers
    if (period_us !== null && !isNaN(simTime_us) && simTime_us >= 0) {
      // As requested, round down to the nearest whole number of clocks
      const totalClocks = Math.floor(simTime_us / period_us);
      numClocksInput.value = totalClocks;
    } else {
      // If inputs are invalid, clear the output
      numClocksInput.value = '';
    }
  }

  // 2. Add event listeners to trigger the recalculations on user input

  // If clock frequency changes, recalculate simulation time based on the current number of clocks.
  clkInput.addEventListener("input", updateSimulationTime);

  // If the user types a number of clocks, calculate the resulting simulation time.
  numClocksInput.addEventListener("input", updateSimulationTime);

  // If the user types a simulation time, calculate the required number of clocks.
  simulTimeInput.addEventListener("input", updateNumberOfClocks);
});