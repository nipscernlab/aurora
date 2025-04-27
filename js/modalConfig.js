// Modal configuration elements
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

// Store available processors and current configuration
let availableProcessors = [];
let selectedProcessor = null;
let currentConfig = {
  processors: [],
  iverilogFlags: [],
  cmmCompFlags: [],
  asmCompFlags: []
};

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
  defaultOption.selected = !selectedProcessor;
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
  
  // Enable/disable delete button based on selection
  deleteProcessorButton.disabled = !selectedProcessor;
  
  // Force a UI refresh
  processorSelect.blur();
  processorSelect.focus();
}

// Save the current processor configuration to temporary storage
function saveCurrentProcessorToTemp() {
  if (selectedProcessor) {
    const clk = processorClkInput.value.trim();
    const numClocks = processorNumClocksInput.value.trim();
    
    tempProcessorConfigs[selectedProcessor] = {
      name: selectedProcessor,
      clk: clk ? Number(clk) : null,
      numClocks: numClocks ? Number(numClocks) : null
    };
    
    console.log(`Saved temporary config for ${selectedProcessor}:`, tempProcessorConfigs[selectedProcessor]);
  }
}

// Handle processor selection change
processorSelect.addEventListener("change", function() {
  // Save current processor config to temp storage before switching
  saveCurrentProcessorToTemp();
  
  // Update selected processor
  selectedProcessor = this.value;
  deleteProcessorButton.disabled = !selectedProcessor;
  
  // Check if we have a temp config for this processor
  if (selectedProcessor && tempProcessorConfigs[selectedProcessor]) {
    const tempConfig = tempProcessorConfigs[selectedProcessor];
    processorClkInput.value = tempConfig.clk || '';
    processorNumClocksInput.value = tempConfig.numClocks || '';
    console.log(`Loaded temp config for ${selectedProcessor}:`, tempConfig);
    return;
  }
  
  // Otherwise look for config in current loaded config
  const processorConfig = currentConfig.processors.find(p => p.name === selectedProcessor);
  
  if (processorConfig) {
    processorClkInput.value = processorConfig.clk || '';
    processorNumClocksInput.value = processorConfig.numClocks || '';
  } else {
    processorClkInput.value = '';
    processorNumClocksInput.value = '';
  }
});

// Delete selected processor
deleteProcessorButton.addEventListener("click", async function() {
  if (!selectedProcessor) return;
  
  if (confirm(`Are you sure you want to delete processor "${selectedProcessor}"?`)) {
    try {
      // Desativar o botão durante a operação para evitar cliques múltiplos
      deleteProcessorButton.disabled = true;
      
      // Salvar o estado atual antes de excluir
      const currentProcessorSelection = selectedProcessor;
      
      // Chamar a API para excluir o processador com timeout de segurança
      const deletePromise = window.electronAPI.deleteProcessor(selectedProcessor);
      
      // Adicionar um timeout para evitar bloqueio indefinido
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation timed out")), 10000);
      });
      
      // Usar Promise.race para garantir que não ficará preso
      await Promise.race([deletePromise, timeoutPromise]);
      
      // Remove from available processors
      availableProcessors = availableProcessors.filter(p => p !== currentProcessorSelection);
      
      // Remove from current config
      currentConfig.processors = currentConfig.processors.filter(
        p => p.name !== currentProcessorSelection
      );
      
      // Remove from temp configs
      delete tempProcessorConfigs[currentProcessorSelection];
      
      // Reset selection
      selectedProcessor = null;
      
      // Limpar os campos de input
      processorClkInput.value = '';
      processorNumClocksInput.value = '';
      
      // Update UI depois de um pequeno delay
      setTimeout(() => {
        try {
          updateProcessorSelect();
          
          // Atualizar o estado dos botões
          deleteProcessorButton.disabled = true;
          
          // Fechar o modal corretamente e resetar seu estado
          modal.classList.remove("active");
          setTimeout(() => {
            modal.hidden = true;
            // Forçar um re-render da página para garantir que eventos de input funcionem
            document.body.style.display = 'none';
            setTimeout(() => { document.body.style.display = ''; }, 5);
          }, 300);
          
          // Mostrar notificação de sucesso
          showNotification(`Processor "${currentProcessorSelection}" successfully deleted.`, 'success');
        } catch (innerError) {
          console.error("Error in UI update after processor deletion:", innerError);
        }
      }, 200);
      
      // Se existir função para atualizar árvore de arquivos, chamá-la de forma segura
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
      
      // Garantir que o botão seja reativado em caso de erro
      deleteProcessorButton.disabled = false;
    }
  }
});

// Loads the configuration from the main process and populates the modal
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
    } else {
      selectedProcessor = null;
      processorClkInput.value = '';
      processorNumClocksInput.value = '';
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

// Saves the current configuration and sends it to the main process
saveConfigButton.addEventListener("click", async () => {
  // Save current processor to temp before saving
  saveCurrentProcessorToTemp();
  
  // Only save the currently selected processor to the config file
  let processors = [];
  
  if (selectedProcessor && tempProcessorConfigs[selectedProcessor]) {
    processors.push(tempProcessorConfigs[selectedProcessor]);
  }
  
  // Collect compiler flags
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
    // Close the modal and save the configuration
    modal.classList.remove("active");
    await window.electronAPI.saveConfig(config);
    setTimeout(() => modal.hidden = true, 300);
  } catch (error) {
    console.error("Failed to save configuration:", error);
    alert("Failed to save configuration: " + error.message);
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
