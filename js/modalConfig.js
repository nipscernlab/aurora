const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalConfig");
const closeModal = document.getElementById("closeModal");
const addProcessorButton = document.getElementById("addProcessor");
const processorsDiv = document.getElementById("processors");
const clearAllButton = document.getElementById("clearAll");
const clearTempButton = document.getElementById("clearTemp");
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const iverilogFlagsInput = document.getElementById("iverilogFlags");

let processorCount = 0;
let previousProcessorNames = []; // Stores previously loaded processor names

// Clears all processor items from the configuration
function clearProcessors() {
  const processorItems = document.querySelectorAll(".processor-item");
  processorItems.forEach(item => item.remove());
}

// Loads the configuration from the main process and populates the modal
async function loadConfiguration() {
  try {
    const config = await window.electronAPI.loadConfig();

    // Clear existing processors
    clearProcessors();

    // Populate processors if available in the configuration
    if (config.processors) {
      config.processors.forEach(processor => {
        const processorItem = document.createElement("div");
        processorItem.className = "processor-item";
        processorItem.innerHTML = `
          <input type="text" placeholder="Processor Name" data-processor-name value="${processor.name}">
          <input type="number" placeholder="CLK (MHz)" data-clk value="${processor.clk}">
          <input type="number" placeholder="Number of Clocks" data-num-clocks value="${processor.numClocks}">
          <button class="removeProcessor" 
            style="margin-left: 8px; color: #fff; border: none; cursor: pointer; font-size: 16px; margin-bottom: 15px;">
              &times;
          </button>
        `;

        // Add event listener to remove the processor item
        processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
          processorItem.remove();
        });

        processorsDiv.insertBefore(processorItem, addProcessorButton);
      });

      // Save processor names for later comparison
      previousProcessorNames = config.processors.map(p => p.name);
    }

    // Populate iverilog flags if available
    if (config.iverilogFlags) {
      iverilogFlagsInput.value = config.iverilogFlags.join("; ");
    }
  } catch (error) {
    console.error("Failed to load configuration:", error);
  }
}

// Opens the configuration modal and loads the current configuration
settingsButton.addEventListener("click", () => {
  loadConfiguration();
  modal.hidden = false;
  modal.classList.add("active");
});

// Closes the configuration modal
closeModal.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Adds a new processor item to the configuration
addProcessorButton.addEventListener("click", () => {
  processorCount++;

  const processorItem = document.createElement("div");
  processorItem.className = "processor-item";
  processorItem.innerHTML = `
    <input type="text" placeholder="Processor Name" data-processor-name>
    <input type="number" placeholder="CLK (MHz)" data-clk>
    <input type="number" placeholder="Number of Clocks" data-num-clocks>
    <button class="removeProcessor" 
            style="margin-left: 8px; color: #fff; border: none; cursor: pointer; font-size: 16px; margin-bottom: 15px;">
        &times;
    </button>
  `;

  // Add event listener to remove the processor item
  processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
    processorItem.remove();
  });

  processorsDiv.insertBefore(processorItem, addProcessorButton);
});

// Clears all processors and resets the iverilog flags input
clearAllButton.addEventListener("click", () => {
  clearProcessors();
  iverilogFlagsInput.value = "";
});

// Saves the current configuration and sends it to the main process
saveConfigButton.addEventListener("click", async () => {
  const processors = [];
  const processorItems = document.querySelectorAll(".processor-item");

  // Collect processor data from the input fields
  processorItems.forEach(item => {
    const name = item.querySelector("[data-processor-name]").value;
    const clk = item.querySelector("[data-clk]").value;
    const numClocks = item.querySelector("[data-num-clocks]").value;
    if (name && clk && numClocks) {
      processors.push({ name, clk: Number(clk), numClocks: Number(numClocks)});
    }
  });

  // Collect iverilog flags from the input field
  const flags = iverilogFlagsInput.value
    .split(";")
    .map(flag => flag.trim())
    .filter(flag => flag);

  const config = {
    processors,
    iverilogFlags: flags
  };

  console.log("Saved Configuration:", config);

  // Close the modal and save the configuration
  modal.classList.remove("active");
  await window.electronAPI.saveConfig(config);

  // Update previously loaded processor names
  previousProcessorNames = processors.map(p => p.name);
});

// Cancels the configuration changes and closes the modal
cancelConfigButton.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Clears the Temp folder and notifies the user
clearTempButton.addEventListener("click", async () => {
  try {
    await window.electronAPI.clearTempFolder();
    alert("Temp folder successfully deleted!");
  } catch (error) {
    console.error("Error deleting Temp folder:", error);
    alert("Failed to delete Temp folder.");
  }
});