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

// Get available processors from the main process
async function loadAvailableProcessors() {
  try {
    // Precisamos obter o caminho do projeto atual
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

// Handle processor selection change
processorSelect.addEventListener("change", function() {
  selectedProcessor = this.value;
  deleteProcessorButton.disabled = !selectedProcessor;
  
  // Find processor configuration if it exists
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
      await window.electronAPI.deleteProcessor(selectedProcessor);
      
      // Remove from available processors
      availableProcessors = availableProcessors.filter(p => p !== selectedProcessor);
      
      // Remove from current config
      currentConfig.processors = currentConfig.processors.filter(p => p.name !== selectedProcessor);
      
      // Reset selection
      selectedProcessor = null;
      
      // Update UI
      updateProcessorSelect();
      processorClkInput.value = '';
      processorNumClocksInput.value = '';
    } catch (error) {
      console.error("Failed to delete processor:", error);
      alert(`Failed to delete processor: ${error.message}`);
    }
  }
});

// Loads the configuration from the main process and populates the modal
async function loadConfiguration() {
  try {
    const config = await window.electronAPI.loadConfig();
    currentConfig = config;
    
    // Populate processor selection if available
    if (config.processors && config.processors.length > 0) {
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
saveConfigButton.addEventListener("click", async () => {
  // Create processor configuration for the selected processor
  let processors = [];
  
  if (selectedProcessor) {
    const clk = processorClkInput.value.trim();
    const numClocks = processorNumClocksInput.value.trim();
    
    if (clk && numClocks) {
      processors.push({
        name: selectedProcessor,
        clk: Number(clk),
        numClocks: Number(numClocks)
      });
    }
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
  
  // Extrair dados do evento
  const processorName = typeof data === 'object' ? data.processorName : data;
  const projectPath = typeof data === 'object' ? data.projectPath : window.currentProjectPath;
  
  if (projectPath) {
    // Armazenar o caminho do projeto para uso futuro
    if (window.currentProjectPath === undefined) {
      window.currentProjectPath = projectPath;
    }
    localStorage.setItem('currentProjectPath', projectPath);
  }
  
  // Always reload the processor list from the main process
  loadAvailableProcessors().then(processors => {
    // After loading, make sure the new processor is selected
    if (processorName && processors.includes(processorName)) {
      selectedProcessor = processorName;
      updateProcessorSelect();
      
      // Set default values for the new processor
      processorClkInput.value = '100'; // Default clock, adjust as needed
      processorNumClocksInput.value = '1000'; // Default clocks, adjust as needed
    }
  }).catch(error => {
    console.error("Failed to reload processors after creation:", error);
  });
});

// Initial load of available processors when the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Load processors at startup so they're available even before opening modal
  await loadAvailableProcessors();
});

// Toggles the Iverilog flags input based on the multicore checkbox
multicoreCheckbox.addEventListener("change", () => {
  iverilogFlagsInput.disabled = !multicoreCheckbox.checked;
});

// Add a new processor to the configuration when a processor is created
window.electronAPI.onProcessorCreated(async (event, processorName) => {
  try {
    // Load the current configuration
    currentConfig = await window.electronAPI.loadConfig();
    
    // Check if the processor already exists
    const exists = currentConfig.processors.some(p => p.name === processorName);
    if (!exists) {
      // Add the new processor to the configuration
      currentConfig.processors.push({
        name: processorName,
        clk: 0,
        numClocks: 0
      });
      
      // Save the configuration
      await window.electronAPI.saveConfig(currentConfig);
      console.log(`Added processor ${processorName} to configuration`);
    }
  } catch (error) {
    console.error(`Failed to add processor ${processorName} to configuration:`, error);
  }
});