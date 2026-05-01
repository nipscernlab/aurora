//modalProcessorConfig.js Modal configuration Processor Oriented Configuration
import { showDialog } from '../ui/dialog_manager.js';

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

window.availableProcessors = [];

let currentConfig = {
  processors: [],
  iverilogFlags: [],
  cmmCompFlags: [],
  asmCompFlags: [],
  testbenchFile: "standard",
  gtkwFile: "standard",
  isActive: false,

};

// --- Global Delete Handler (Accessible by File Tree) ---
window.confirmAndDeleteProcessor = async function(processorName) {
    if (!processorName) return;

    // Usa o dialogManager padronizado
    const result = await showDialog({
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete the processor "<strong>${processorName}</strong>"?<br>This action cannot be undone.`,
        buttons: [
            { label: 'Cancel', action: 'cancel', type: 'cancel' },
            { label: 'Delete', action: 'confirm', type: 'save' } 
        ]
    });

    if (result === 'confirm') {
        try {
            await window.electronAPI.deleteProcessor(processorName);
            console.log(`Processor "${processorName}" deleted.`);

            // Atualiza listas e interface
            await loadAvailableProcessors(); 
            
            // Limpa a seleção no modal se necessário
            const processorSelect = document.getElementById("processorSelect");
            const deleteBtn = document.getElementById("deleteProcessor");
            
            if (processorSelect && processorSelect.value === processorName) {
                processorSelect.value = "";
                if (deleteBtn) deleteBtn.disabled = true;
                processorSelect.dispatchEvent(new Event('change'));
            }

        } catch (error) {
            console.error("Failed to delete processor:", error);
            await showDialog({
                title: 'Error',
                message: `Failed to delete processor: ${error.message}`,
                buttons: [{ label: 'Close', action: 'close', type: 'cancel' }]
            });
        }
    }
};

const dialogStyle = document.createElement('style');
dialogStyle.innerHTML = `
    .confirm-modal {
        z-index: 20000 !important; /* Valor bem alto para sobrepor o modal de settings */
    }
`;
document.head.appendChild(dialogStyle);

// Temporary storage for processor configurations
let tempProcessorConfigs = {};

// Get available processors from the main process
async function loadAvailableProcessors() {
    try {
        const projectInfo = await window.electronAPI.getCurrentProject();
        let processors = [];
        
        if (projectInfo.projectOpen) {
            processors = projectInfo.processors || [];
        } else {
             const currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
             if (currentProjectPath) {
                 processors = await window.electronAPI.getAvailableProcessors(currentProjectPath);
             }
        }

        availableProcessors = processors;
        window.availableProcessors = processors;

        updateProcessorSelect();

        // Atualiza a árvore para mostrar os ícones de lixeira (se necessário)
        if (typeof window.refreshFileTree === 'function') {
            await window.refreshFileTree();
        }

        return processors;
    } catch (error) {
        console.error("Error loading processors:", error);
        return [];
    }
}

function updateProcessorSelect() {
    const processorSelect = document.getElementById("processorSelect");
    if (!processorSelect) return;

    const currentSelection = processorSelect.value;
    processorSelect.innerHTML = '<option value="">Choose a processor...</option>';

    availableProcessors.forEach(proc => {
        const option = document.createElement("option");
        option.value = proc;
        option.textContent = proc;
        processorSelect.appendChild(option);
    });

    const deleteBtn = document.getElementById("deleteProcessor");

    if (availableProcessors.includes(currentSelection)) {
        processorSelect.value = currentSelection;
        if (deleteBtn) deleteBtn.disabled = false;
    } else if (availableProcessors.length === 1) {
        // Auto-select the only processor available so the user does not need
        // to open the dropdown just to pick the obvious choice.
        processorSelect.value = availableProcessors[0];
        if (deleteBtn) deleteBtn.disabled = false;
        processorSelect.dispatchEvent(new Event('change'));
    }
}

// Update the saveCurrentProcessorToTemp function to save simulation file selections

async function loadCmmFiles(processorName) {
  if (!cmmFileSelect) {
    console.error("C± file select element not found");
    return;
  }

  if (!processorName) {
    // Reseta e desabilita o seletor se nenhum processador for selecionado
    cmmFileSelect.innerHTML = '<option value="" selected>Select C± File</option>';
    cmmFileSelect.disabled = true;
    selectedCmmFile = null;
    return;
  }

  try {
    cmmFileSelect.disabled = true;
    cmmFileSelect.innerHTML = '<option value="">Loading...</option>';
    
    console.log(`Loading C± files for processor: ${processorName}`);
    
    // Obtém o caminho do projeto atual
    const projectInfo = await window.electronAPI.getCurrentProject();
    const currentProjectPath = projectInfo.projectPath || 
      window.currentProjectPath || 
      localStorage.getItem('currentProjectPath');
    
    if (!currentProjectPath) {
      console.warn("No current project path available");
      cmmFileSelect.innerHTML = '<option value="">No Project</option>';
      return;
    }
    
    // Obtém o caminho para a pasta Software do processador
    const softwareFolderPath = await window.electronAPI.joinPath(currentProjectPath, processorName, 'Software');
    
    // Obtém todos os arquivos .cmm da pasta
    const files = await window.electronAPI.listFilesInDirectory(softwareFolderPath);
    const cmmFiles = files.filter(file => file.toLowerCase().endsWith('.cmm'));
    
    console.log(`Found ${cmmFiles.length} C± files`);

    // NOVO: Se houver apenas um arquivo .cmm e nenhum já estiver configurado, seleciona-o por padrão
    if (cmmFiles.length === 1) {
        if (!tempProcessorConfigs[processorName]) {
            tempProcessorConfigs[processorName] = { name: processorName };
        }
        // Define o arquivo apenas se ele não foi previamente salvo na configuração
        if (!tempProcessorConfigs[processorName].cmmFile) {
            tempProcessorConfigs[processorName].cmmFile = cmmFiles[0];
            console.log(`Auto-selecting the single C± file: ${cmmFiles[0]}`);
        }
    }
    
    // Atualiza o seletor de arquivos CMM
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
        
        // Esta verificação agora selecionará uma configuração salva ou a que foi auto-selecionada
        if (tempProcessorConfigs[processorName] && 
            tempProcessorConfigs[processorName].cmmFile === file) {
          option.selected = true;
          selectedCmmFile = file;
        }
        
        cmmFileSelect.appendChild(option);
      });
    }
    
    // Habilita o seletor
    cmmFileSelect.disabled = false;
    
  } catch (error) {
    console.error("Failed to load C± files:", error);
    cmmFileSelect.innerHTML = '<option value="">Error Loading Files</option>';
    showNotification("Failed to load C± files", 'error');
  }
}


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

    // Auto-select the only custom file when there is exactly one and the user
    // has no prior choice saved — the obvious pick is just made for them.
    const tbHasUserChoice = (currentConfig.testbenchFile && currentConfig.testbenchFile !== 'standard') ||
                            (tempProcessorConfigs[processorName] && tempProcessorConfigs[processorName].testbenchFile && tempProcessorConfigs[processorName].testbenchFile !== 'standard');
    if (verilogFiles.length === 1 && !tbHasUserChoice) {
      testbenchSelect.value = verilogFiles[0];
    }
    const gtkwHasUserChoice = (currentConfig.gtkwFile && currentConfig.gtkwFile !== 'standard') ||
                              (tempProcessorConfigs[processorName] && tempProcessorConfigs[processorName].gtkwFile && tempProcessorConfigs[processorName].gtkwFile !== 'standard');
    if (gtkwFiles.length === 1 && !gtkwHasUserChoice) {
      gtkwSelect.value = gtkwFiles[0];
    }

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
      if (cmmFileSelect) cmmFileSelect.disabled = true;
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
    const DEFAULT_CLK = 100; // Default value of frequency
    const DEFAULT_NUM_CLOCKS = 2000; // Default value of number of clocks
    const clk = processorClkInput.value.trim();
    const numClocks = processorNumClocksInput.value.trim();
    const normalizedClk = clk === '' ? DEFAULT_CLK : Number(clk);
    const normalizedNumClocks = numClocks === '' ? DEFAULT_NUM_CLOCKS : Number(numClocks);
    const testbenchFile = testbenchSelect ? testbenchSelect.value : "standard";
    const gtkwFile = gtkwSelect ? gtkwSelect.value : "standard";
    const cmmFile = cmmFileSelect ? cmmFileSelect.value : ""; // ADICIONADO
    const showArrays = showArraysCheckbox.checked ? 1 : 0;
    
    tempProcessorConfigs[selectedProcessor] = {
      name: selectedProcessor,
      clk: normalizedClk, 
      numClocks: normalizedNumClocks,
      testbenchFile: testbenchFile,
      gtkwFile: gtkwFile,
      cmmFile: cmmFile, // ADICIONADO
      isActive: selectedProcessor === selectedProcessor,
      showArraysInGtkwave: showArrays
    };
    
    console.log(`Saved temporary config for ${selectedProcessor}:`, tempProcessorConfigs[selectedProcessor]);
  }
}

// Validate numeric fields used by the Processor Mode settings modal.
// Returns { ok: true } or { ok: false, errors: [string] }.
function validateProcessorNumericFields() {
  const errors = [];
  const clkVal       = (processorClkInput?.value || '').trim();
  const numClocksVal = (processorNumClocksInput?.value || '').trim();
  const simulTimeEl  = document.getElementById('processorSimulTime');
  const simulTimeVal = (simulTimeEl?.value || '').trim();

  const isPositiveInt = (v) => v !== '' && /^\d+$/.test(v) && Number(v) > 0;

  if (!isPositiveInt(clkVal)) {
    errors.push('CLK Frequency must be a positive integer.');
  } else if (Number(clkVal) > 1000) {
    errors.push('CLK Frequency must be at most 1000 MHz.');
  }
  if (!isPositiveInt(numClocksVal)) {
    errors.push('Number of Clocks must be a positive integer.');
  }
  if (!isPositiveInt(simulTimeVal)) {
    errors.push('Simulation Time must be a positive integer (in ps).');
  }
  return { ok: errors.length === 0, errors };
}

// Correção do event listener do saveConfigButton para incluir CMM file na configuração
saveConfigButton.addEventListener("click", async (event) => {
  const validation = validateProcessorNumericFields();
  if (!validation.ok) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    await showDialog({
      title: 'Invalid configuration',
      message: 'Please fix the following before saving:<br><br>• ' +
               validation.errors.join('<br>• '),
      buttons: [{ label: 'OK', action: 'ok', type: 'cancel' }]
    });
    return;
  }
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
      processorNumClocksInput.value = '2000'; // Default clocks, adjust as needed
      
      // Save the new processor to temp configs
      tempProcessorConfigs[processorName] = {
        name: processorName,
        clk: 100,
        numClocks: 2000
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

// Centralized notification — delegates to the canonical AuroraUI toast.
function showNotification(message, type = 'info', duration = 3000) {
  if (typeof window.showNotification === 'function' && window.showNotification !== showNotification) {
    return window.showNotification(message, type, duration);
  }
  console.log(`[Notification ${type}] ${message}`);
  return { close: () => {} };
}

// Legacy alias kept for callers — same behaviour as showNotification.
function showToastNotification(message, type = 'info', duration = 3000) {
  return showNotification(message, type, duration);
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

// Strict integer-only filter: blocks letters, spaces, dots, commas, signs,
// scientific notation, and any other junk users may try to type or paste.
// Used by the Processor Mode settings numeric fields below.
function restrictToPositiveInteger(input) {
  if (!input) return;
  // Block invalid keypresses BEFORE the value changes — gives instant feedback.
  input.addEventListener('beforeinput', (e) => {
    if (!e.inputType || !e.inputType.startsWith('insert')) return;
    const data = e.data || '';
    if (!/^\d+$/.test(data)) e.preventDefault();
  });
  // Paste / IME / programmatic value changes still need a sanitization pass.
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/[^\d]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Get references to the DOM elements once the document is ready
  const clkInput = document.getElementById("processorClk");
  const numClocksInput = document.getElementById("processorNumClocks");
  const simulTimeInput = document.getElementById("processorSimulTime");

  restrictToPositiveInteger(clkInput);
  restrictToPositiveInteger(numClocksInput);
  restrictToPositiveInteger(simulTimeInput);
const deleteProcessorButton = document.getElementById("deleteProcessor");
    const processorSelect = document.getElementById("processorSelect");

    // Remove qualquer listener antigo clonando o nó (hack rápido) ou apenas garantindo que o código antigo foi removido do arquivo.
    // Assumindo que você substituiu o código antigo por este:
    
    if (deleteProcessorButton && processorSelect) {
        // Removemos listeners anteriores para evitar "duplo aviso"
        const newBtn = deleteProcessorButton.cloneNode(true);
        deleteProcessorButton.parentNode.replaceChild(newBtn, deleteProcessorButton);
        
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const processorName = processorSelect.value;
            if (processorName) {
                window.confirmAndDeleteProcessor(processorName);
            }
        });

        processorSelect.addEventListener('change', () => {
            newBtn.disabled = !processorSelect.value;
        });
    }

    loadAvailableProcessors();

  function getClockPeriodInPicoseconds(freqMHz) {
    if (!freqMHz || freqMHz <= 0) {
      return null;
    }
    return 1000000 / freqMHz;
  }

  /**
   * Calculates and updates the Simulation Time (ps) field.
   * Triggered when clock frequency or number of clocks change.
   */
  function updateSimulationTime() {
    const freqMHz = parseFloat(clkInput.value);
    const numClocks = parseInt(numClocksInput.value, 10);
    const period_ps = getClockPeriodInPicoseconds(freqMHz);

    if (period_ps !== null && !isNaN(numClocks) && numClocks >= 0) {
      const totalTime = numClocks * period_ps;
      // Remove casas decimais e ponto
      simulTimeInput.value = Math.floor(totalTime).toString().replace(/\..*/, '');
    } else {
      simulTimeInput.value = '';
    }
  }

  /**
   * Calculates and updates the Number of Clocks field.
   * Triggered when simulation time changes.
   */
  function updateNumberOfClocks() {
    const freqMHz = parseFloat(clkInput.value);
    const simTime_ps = parseFloat(simulTimeInput.value);
    const period_ps = getClockPeriodInPicoseconds(freqMHz);

    if (period_ps !== null && !isNaN(simTime_ps) && simTime_ps >= 0) {
      const totalClocks = Math.floor(simTime_ps / period_ps);
      // Remove casas decimais e ponto
      numClocksInput.value = totalClocks.toString().replace(/\..*/, '');
    } else {
      numClocksInput.value = '';
    }
  }

  // 2. Add event listeners to trigger the recalculations on user input
  clkInput.addEventListener("input", updateSimulationTime);
  numClocksInput.addEventListener("input", updateSimulationTime);
  simulTimeInput.addEventListener("input", updateNumberOfClocks);
});

function openProcessorModal() {
    const modal = document.getElementById('modalProcessorConfig');
    if (modal) {
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeProcessorModal() {
    const modal = document.getElementById('modalProcessorConfig');
    if (modal) {
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('show');
        // Apenas restaura o scroll se nenhum outro modal estiver aberto
        if (!document.querySelector('.modal-overlay[aria-hidden="false"]')) {
            document.body.style.overflow = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modalProcessorConfig');
    const closeModalButton = document.getElementById('closeModal');
    const cancelConfigButton = document.getElementById('cancelConfig');
    const saveConfigButton = document.getElementById('saveConfig');
    
    // ATENÇÃO: O event listener para o botão 'settings' foi REMOVIDO daqui.

    // Event listeners para fechar o modal
    closeModalButton?.addEventListener('click', closeProcessorModal);
    cancelConfigButton?.addEventListener('click', closeProcessorModal);
    saveConfigButton?.addEventListener('click', closeProcessorModal);

});