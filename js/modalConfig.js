const settingsButton = document.getElementById("settings");
const modal = document.getElementById("modalConfig");
const closeModal = document.getElementById("closeModal");
const addProcessorButton = document.getElementById("addProcessor");
const processorsDiv = document.getElementById("processors");
const clearAllButton = document.getElementById("clearAll");
const clearTempButton = document.getElementById("clearTemp"); // Botão para limpar a pasta Temp
const saveConfigButton = document.getElementById("saveConfig");
const cancelConfigButton = document.getElementById("cancelConfig");
const iverilogFlagsInput = document.getElementById("iverilogFlags");

let processorCount = 0;
// Armazena os nomes dos processadores carregados anteriormente
let previousProcessorNames = [];

function clearProcessors() {
  const processorItems = document.querySelectorAll(".processor-item");
  processorItems.forEach(item => item.remove());
}

async function loadConfiguration() {
  try {
    // Solicita a configuração do processo principal
    const config = await window.electronAPI.loadConfig();

    // Limpa os processadores existentes
    clearProcessors();

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

        processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
          processorItem.remove();
        });

        processorsDiv.insertBefore(processorItem, addProcessorButton);
      });

      // Salva os nomes para identificar processadores removidos posteriormente
      previousProcessorNames = config.processors.map(p => p.name);
    }

    if (config.iverilogFlags) {
      iverilogFlagsInput.value = config.iverilogFlags.join("; ");
    }
  } catch (error) {
    console.error("Failed to load configuration:", error);
  }
}

// Abertura e fechamento do modal
settingsButton.addEventListener("click", () => {
  loadConfiguration();
  modal.hidden = false;
  modal.classList.add("active");
});

closeModal.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Adiciona novo processador com o seletor estilizado
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

  processorItem.querySelector(".removeProcessor").addEventListener("click", () => {
    processorItem.remove();
  });

  processorsDiv.insertBefore(processorItem, addProcessorButton);
});

clearAllButton.addEventListener("click", () => {
  clearProcessors();
  iverilogFlagsInput.value = "";
});

saveConfigButton.addEventListener("click", async () => {
  const processors = [];
  const processorItems = document.querySelectorAll(".processor-item");

  processorItems.forEach(item => {
    const name = item.querySelector("[data-processor-name]").value;
    const clk = item.querySelector("[data-clk]").value;
    const numClocks = item.querySelector("[data-num-clocks]").value;
    if (name && clk && numClocks) {
      processors.push({ name, clk: Number(clk), numClocks: Number(numClocks)});
    }
  });

  const flags = iverilogFlagsInput.value
    .split(";")
    .map(flag => flag.trim())
    .filter(flag => flag);

  const config = {
    processors,
    iverilogFlags: flags
  };

  console.log("Saved Configuration:", config);

  // Identifica processadores removidos para excluir o arquivo tcl_infos.txt
  const newProcessorNames = processors.map(p => p.name);
  const removedProcessors = previousProcessorNames.filter(name => !newProcessorNames.includes(name));

  for (const processorName of removedProcessors) {
    try {
      const appPath = await window.electronAPI.getAppPath();
      const basePath = await window.electronAPI.joinPath(appPath, '..', '..');
      const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', processorName);
      const tclInfoPath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');
      await window.electronAPI.deleteTclFile(tclInfoPath);
      console.log(`Deleted TCL file for processor ${processorName}`);
    } catch (error) {
      console.error(`Error deleting TCL file for processor ${processorName}:`, error);
    }
  }

  // Para cada processador, cria ou atualiza o arquivo tcl_infos.txt
  for (const processor of processors) {
    try {
      const appPath = await window.electronAPI.getAppPath();
      const basePath = await window.electronAPI.joinPath(appPath, '..', '..');
      const tempPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'Temp', processor.name);
      const binPath = await window.electronAPI.joinPath(basePath, 'saphoComponents', 'bin');
      const tclInfoPath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');

      await window.electronAPI.createTclInfoFile(tclInfoPath, processorType, tempPath, binPath);
      console.log(`Created/Updated TCL file for processor ${processor.name}`);
    } catch (error) {
      console.error(`Error creating/updating TCL file for processor ${processor.name}:`, error);
    }
  }

  modal.classList.remove("active");
  await window.electronAPI.saveConfig(config);
  // Atualiza os processadores previamente carregados
  previousProcessorNames = newProcessorNames;
});

cancelConfigButton.addEventListener("click", () => {
  modal.classList.remove("active");
  setTimeout(() => modal.hidden = true, 300);
});

// Evento para o botão Clear Temp: apaga a pasta Temp e avisa o usuário
clearTempButton.addEventListener("click", async () => {
  try {
    await window.electronAPI.clearTempFolder();
    alert("Pasta Temp excluída com sucesso!");
  } catch (error) {
    console.error("Erro ao excluir pasta Temp:", error);
    alert("Falha ao excluir pasta Temp.");
  }
});


/*
<select data-point-type>
            <option value="floating" ${processor.pointType === 'floating' ? 'selected' : ''}>Float</option>
            <option value="int" ${processor.pointType === 'int' || !processor.pointType ? 'selected' : ''}>Int</option>
*/