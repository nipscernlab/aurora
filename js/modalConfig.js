const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalConfig");
const closeModal = document.getElementById("closeConfigModal");
const clearAllButton = document.getElementById("clearAllConfig");
const clearTempButton = document.getElementById("clearTempBtn");
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const processorListContainer = document.getElementById("processorListContainer");
const iverilogFlagsInput = document.getElementById("iverilogFlags");
const cmmCompFlagsInput = document.getElementById("cmmCompFlags");
const asmCompFlagsInput = document.getElementById("asmCompFlags");
const multicoreCheckbox = document.getElementById("multicoreCheckbox");

let selectedProcessor = null;
let currentConfig = null;

// Opens the configuration modal and loads the current configuration
settingsButton.addEventListener("click", () => {
  loadConfiguration();
  modal.classList.add("active");
  modal.hidden = false;
});

// Closes the configuration modal
closeModal.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Updates the processor list display based on the current configuration
function updateProcessorList() {
  // Clear the current list
  processorListContainer.innerHTML = "";

  if (!currentConfig || !currentConfig.processors || currentConfig.processors.length === 0) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "config-empty-message";
    emptyMessage.textContent = "No processors found";
    processorListContainer.appendChild(emptyMessage);
    return;
  }

  // Create a container for processor cards
  const processorCardsContainer = document.createElement("div");
  processorCardsContainer.className = "config-processor-cards";

  // Create a card for each processor
  currentConfig.processors.forEach(processor => {
    const processorCard = document.createElement("div");
    processorCard.className = "config-processor-card";
    
    // Add selected class if this is the currently selected processor
    if (selectedProcessor && selectedProcessor.name === processor.name) {
      processorCard.classList.add("selected");
    }

    processorCard.innerHTML = `
      <div class="config-processor-header">
        <h4>${processor.name}</h4>
        <button class="config-remove-processor" data-processor="${processor.name}" aria-label="Remove Processor">
          &times;
        </button>
      </div>
      <div class="config-processor-details">
        <div>Clock: ${processor.clk || 'N/A'} MHz</div>
        <div>Clocks: ${processor.numClocks || 'N/A'}</div>
      </div>
    `;

    // Add click event to select this processor
    processorCard.addEventListener("click", (event) => {
      // Don't select if clicking the remove button
      if (event.target.closest('.config-remove-processor')) return;
      
      // Deselect all processor cards
      document.querySelectorAll('.config-processor-card').forEach(card => {
        card.classList.remove('selected');
      });
      
      // Select this card
      processorCard.classList.add('selected');
      
      // Set this processor as selected and populate fields
      selectedProcessor = processor;
      populateProcessorFields(processor);
    });

    // Add the card to the container
    processorCardsContainer.appendChild(processorCard);
  });

  // Add event listeners for remove buttons
  processorListContainer.appendChild(processorCardsContainer);
  
  // Add settings panel for selected processor
  const processorSettings = document.createElement("div");
  processorSettings.className = "config-processor-settings";
  processorSettings.innerHTML = `
    <h4>Processor Settings</h4>
    <div class="config-form-group">
      <label for="processorClk">Clock (MHz)</label>
      <input type="number" id="processorClk" class="config-input" placeholder="Enter clock speed in MHz" ${selectedProcessor ? '' : 'disabled'}>
    </div>
    <div class="config-form-group">
      <label for="processorNumClocks">Number of Clocks</label>
      <input type="number" id="processorNumClocks" class="config-input" placeholder="Enter number of clocks" ${selectedProcessor ? '' : 'disabled'}>
    </div>
    <div class="config-form-message">
      ${selectedProcessor ? '' : 'Select a processor to edit settings'}
    </div>
  `;
  
  processorListContainer.appendChild(processorSettings);
  
  // Add event listeners to processor settings inputs
  const clkInput = document.getElementById("processorClk");
  const numClocksInput = document.getElementById("processorNumClocks");
  
  if (clkInput && numClocksInput && selectedProcessor) {
    clkInput.value = selectedProcessor.clk || '';
    numClocksInput.value = selectedProcessor.numClocks || '';
    
    clkInput.addEventListener("change", () => {
      selectedProcessor.clk = parseInt(clkInput.value) || 0;
    });
    
    numClocksInput.addEventListener("change", () => {
      selectedProcessor.numClocks = parseInt(numClocksInput.value) || 0;
    });
  }
  
  // Add event listeners for remove buttons
  document.querySelectorAll('.config-remove-processor').forEach(button => {
    button.addEventListener("click", (event) => {
      const processorName = event.target.dataset.processor;
      removeProcessor(processorName);
      event.stopPropagation();
    });
  });
}

// Populates the processor setting fields when a processor is selected
function populateProcessorFields(processor) {
  const clkInput = document.getElementById("processorClk");
  const numClocksInput = document.getElementById("processorNumClocks");
  
  if (clkInput && numClocksInput) {
    clkInput.value = processor.clk || '';
    numClocksInput.value = processor.numClocks || '';
    clkInput.disabled = false;
    numClocksInput.disabled = false;
  }
}

// Removes a processor from the configuration
function removeProcessor(processorName) {
  if (!currentConfig || !currentConfig.processors) return;
  
  currentConfig.processors = currentConfig.processors.filter(p => p.name !== processorName);
  
  // If the selected processor was removed, clear selection
  if (selectedProcessor && selectedProcessor.name === processorName) {
    selectedProcessor = null;
  }
  
  // Update the processor list
  updateProcessorList();
}

// Loads the configuration from the main process
async function loadConfiguration() {
  try {
    currentConfig = await window.electronAPI.loadConfig();
    
    // Set multicore checkbox state
    if (currentConfig.multicore !== undefined) {
      multicoreCheckbox.checked = currentConfig.multicore;
    }
    
    // Populate compiler flags if available
    if (currentConfig.iverilogFlags) {
      iverilogFlagsInput.value = currentConfig.iverilogFlags.join("; ");
    }
    
    if (currentConfig.cmmCompFlags) {
      cmmCompFlagsInput.value = currentConfig.cmmCompFlags.join("; ");
    }
    
    if (currentConfig.asmCompFlags) {
      asmCompFlagsInput.value = currentConfig.asmCompFlags.join("; ");
    }
    
    // Reset selected processor
    selectedProcessor = null;
    
    // Update the processor list
    updateProcessorList();
  } catch (error) {
    console.error("Failed to load configuration:", error);
    currentConfig = { processors: [], iverilogFlags: [], cmmCompFlags: [], asmCompFlags: [], multicore: false };
    updateProcessorList();
  }
}

// Clears all settings
clearAllButton.addEventListener("click", () => {
  if (confirm("Are you sure you want to clear all settings?")) {
    currentConfig = { processors: [], iverilogFlags: [], cmmCompFlags: [], asmCompFlags: [], multicore: false };
    iverilogFlagsInput.value = "";
    cmmCompFlagsInput.value = "";
    asmCompFlagsInput.value = "";
    multicoreCheckbox.checked = false;
    selectedProcessor = null;
    updateProcessorList();
  }
});

// Saves the current configuration
saveConfigButton.addEventListener("click", async () => {
  try {
    // Update the configuration with the current values
    currentConfig.multicore = multicoreCheckbox.checked;
    
    // Get the compiler flags from the input fields
    currentConfig.iverilogFlags = iverilogFlagsInput.value
      .split(";")
      .map(flag => flag.trim())
      .filter(flag => flag);
    
    currentConfig.cmmCompFlags = cmmCompFlagsInput.value
      .split(";")
      .map(flag => flag.trim())
      .filter(flag => flag);
    
    currentConfig.asmCompFlags = asmCompFlagsInput.value
      .split(";")
      .map(flag => flag.trim())
      .filter(flag => flag);
    
    // Update the processor values from the input fields if a processor is selected
    if (selectedProcessor) {
      const clkInput = document.getElementById("processorClk");
      const numClocksInput = document.getElementById("processorNumClocks");
      
      if (clkInput && numClocksInput) {
        const index = currentConfig.processors.findIndex(p => p.name === selectedProcessor.name);
        if (index !== -1) {
          currentConfig.processors[index].clk = parseInt(clkInput.value) || 0;
          currentConfig.processors[index].numClocks = parseInt(numClocksInput.value) || 0;
        }
      }
    }
    
    // Save the configuration
    await window.electronAPI.saveConfig(currentConfig);
    
    // Close the modal
    modal.classList.remove("active");
    setTimeout(() => modal.hidden = true, 300);
    
    // Show a success message
    alert("Configuration saved successfully");
  } catch (error) {
    console.error("Failed to save configuration:", error);
    alert("Failed to save configuration");
  }
});

// Cancels the configuration changes and closes the modal
cancelConfigButton.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
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