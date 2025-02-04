const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalConfig");
const closeModal = document.getElementById("closeModal");
const addProcessorButton = document.getElementById("addProcessor");
const processorsDiv = document.getElementById("processors");
const clearAllButton = document.getElementById("clearAll");
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const iverilogFlagsInput = document.getElementById("iverilogFlags");

let processorCount = 0;

// Function to clear existing processors
function clearProcessors() {
    const processorItems = document.querySelectorAll(".processor-item");
    processorItems.forEach(item => item.remove());
}

// Function to populate modal with configuration
async function loadConfiguration() {
    try {
        // Request configuration from main process
        const config = await window.electronAPI.loadConfig();

        // Clear existing processors
        clearProcessors();

        // Populate processors
        if (config.processors) {
            config.processors.forEach(processor => {
                const processorItem = document.createElement("div");
                processorItem.className = "processor-item";
                processorItem.innerHTML = `
                    <input type="text" placeholder="Processor Name" data-processor-name value="${processor.name}">
                    <input type="number" placeholder="CLK (MHz)" data-clk value="${processor.clk}">
                    <input type="number" placeholder="Number of Clocks" data-num-clocks value="${processor.numClocks}">
                    <button class="removeProcessor">&times;</button>
                `;

                processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
                    processorItem.remove();
                });

                processorsDiv.insertBefore(processorItem, addProcessorButton);
            });
        }

        // Populate Iverilog flags
        if (config.iverilogFlags) {
            iverilogFlagsInput.value = config.iverilogFlags.join("; ");
        }
    } catch (error) {
        console.error("Failed to load configuration:", error);
    }
}

// Event Listeners
settingsButton.addEventListener("click", () => {
    loadConfiguration();
    modal.hidden = false; // Remove a propriedade hidden
    modal.classList.add("active");
});

closeModal.addEventListener("click", () => {
    modal.classList.remove("active");
    setTimeout(() => modal.hidden = true, 300); // Aguarda a transição antes de esconder
});


addProcessorButton.addEventListener("click", () => {
    processorCount++;

    const processorItem = document.createElement("div");
    processorItem.className = "processor-item";
    processorItem.innerHTML = `
        <input type="text" placeholder="Processor Name" data-processor-name>
        <input type="number" placeholder="CLK (MHz)" data-clk>
        <input type="number" placeholder="Number of Clocks" data-num-clocks>
        <button class="removeProcessor">&times;</button>
    `;

    processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
        processorItem.remove();
    });

    processorsDiv.insertBefore(processorItem, addProcessorButton);
});

clearAllButton.addEventListener("click", () => {
    clearProcessors();
    iverilogFlagsInput.value = "";
});

saveConfigButton.addEventListener("click", () => {
    const processors = [];
    const processorItems = document.querySelectorAll(".processor-item");

    processorItems.forEach(item => {
        const name = item.querySelector("[data-processor-name]").value;
        const clk = item.querySelector("[data-clk]").value;
        const numClocks = item.querySelector("[data-num-clocks]").value;
        if (name && clk && numClocks) {
            processors.push({ name, clk: Number(clk), numClocks: Number(numClocks) });
        }
    });

    const flags = iverilogFlagsInput.value.split(";").map(flag => flag.trim()).filter(flag => flag);

    const config = {
        processors,
        iverilogFlags: flags
    };

    console.log("Saved Configuration:", config);
    modal.classList.remove("active");
    window.electronAPI.saveConfig(config);
});

cancelConfigButton.addEventListener("click", () => {
    modal.classList.remove("active");
    setTimeout(() => modal.hidden = true, 300);
});