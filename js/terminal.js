document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const terminalContents = document.querySelectorAll('.terminal-content');
  
    // Alternância entre abas de terminais
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        terminalContents.forEach(tc => tc.classList.add('hidden'));
  
        tab.classList.add('active');
        document.getElementById(`terminal-${tab.dataset.terminal}`).classList.remove('hidden');
      });
    });
  
    // Configurando o terminal CMD
    const cmdOutput = document.getElementById('cmd-output');
    const cmdInput = document.getElementById('cmd-input');
  
    cmdInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const command = cmdInput.value;
        try {
          // Comunicação com o processo principal via API
          const result = await window.api.runCommand(command);
          cmdOutput.innerHTML += `<div>${result}</div>`;
        } catch (error) {
          cmdOutput.innerHTML += `<div style="color: red;">${error}</div>`;
        }
        cmdInput.value = '';
        cmdOutput.scrollTop = cmdOutput.scrollHeight;
      }
    });
  });
  
  let isFileCompiled = false; // Controle para verificar se o arquivo foi compilado

  // Função para ativar a aba e o conteúdo correspondente
  function activateTerminal(tabId, contentId) {
    if (!isFileCompiled) {
      // Se o arquivo não foi compilado, não faz nada
      return;
    }
  
    // Desativar todas as abas e conteúdos
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.terminal-content').forEach(content => content.classList.remove('active'));
  
    // Ativar a aba e conteúdo correspondente
    document.querySelector(`[data-terminal="${tabId}"]`).classList.add('active');
    document.getElementById(contentId).classList.add('active');
  }
  
  // Eventos para os botões cmmcomp e asmcomp
  document.getElementById('cmmcomp').addEventListener('click', () => {
    // Compilação do arquivo (simulada aqui)
    console.log("Compilando com o CMM...");
    isFileCompiled = true; // Define que o arquivo foi compilado
    activateTerminal('tcmm', 'terminal-tcmm'); // Ativa o terminal TCMM
  });
  
  document.getElementById('asmcomp').addEventListener('click', () => {
    // Compilação do arquivo (simulada aqui)
    console.log("Compilando com o ASM...");
    isFileCompiled = true; // Define que o arquivo foi compilado
    activateTerminal('tasm', 'terminal-tasm'); // Ativa o terminal TASM
  });
  
  // Eventos de clique nas abas (agora ativam o terminal apenas se o arquivo foi compilado)
  document.querySelectorAll('.terminal-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-terminal');
      activateTerminal(tabName, `terminal-${tabName}`);
    });
  });
  
// Evento de compilação do CMM
document.getElementById('cmmcomp').addEventListener('click', async () => {
  if (!this.activeTab || compiling) return; // Verifica se há um arquivo ativo e se não está compilando

  activateTerminal('tcmm', 'terminal-tcmm'); // Foca no terminal TCMM

  const button = document.getElementById('cmmcomp');
  const icon = button.querySelector('i');

  try {
    compiling = true;
    button.disabled = true;
    icon.className = 'fas fa-spinner fa-spin';

    const content = editor.getValue();
    const inputDir = this.activeTab.substring(0, this.activeTab.lastIndexOf('\\') + 1); // Diretório do arquivo ativo
    const inputFile = this.activeTab.split('\\').pop(); // Nome do arquivo CMM
    const outputFile = inputFile.replace('.cmm', '.asm'); // Gerar o nome do arquivo de saída com extensão .asm

    writeToTerminal('terminal-tcmm', 'Starting CMM compilation...', 'command');
    writeToTerminal('terminal-tcmm', `Input file: ${inputFile}`, 'info');

    // Monta o comando com o executável, arquivo de entrada e arquivo de saída
    const compileCommand = `${inputDir}\compilers\\cmmcomp.exe ${inputDir}${inputFile} ${inputDir}${outputFile}`;
    writeToTerminal('terminal-tcmm', `Running: ${compileCommand}`, 'command'); // Exibe o comando que será executado

    const result = await window.electronAPI.compile({
      compiler: '/compilers/cmmcomp.exe', // O caminho do compilador
      content: content,
      filePath: this.activeTab, // Caminho do arquivo ativo
      workingDir: inputDir,
      outputPath: outputFile, // Arquivo de saída com extensão .asm
      compileCommand: compileCommand // Passa o comando de compilação para o processo
    });

    // Atualizando com a saída do compilador
    writeToTerminal('terminal-tcmm', 'CMM to ASM compiler: Processing compilation', 'info');

    if (result.stderr) {
      result.stderr.split('\n').forEach(line => {
        if (line.trim()) {
          writeToTerminal('terminal-tcmm', `CMM to ASM compiler: ${line}`, 'error');
        }
      });
    }

    if (result.stdout) {
      result.stdout.split('\n').forEach(line => {
        if (line.trim()) {
          writeToTerminal('terminal-tcmm', `CMM to ASM compiler: ${line}`, 'success');
        }
      });
    }

    writeToTerminal('terminal-tcmm', 'CMM compilation finished.', 'info');

    document.dispatchEvent(new CustomEvent('refresh-file-tree'));


  } catch (error) {
    console.error('Compilation error:', error);
    writeToTerminal('terminal-tcmm', `CMM to ASM compiler error: ${error.message}`, 'error');
  } finally {
    compiling = false;
    button.disabled = false;
    icon.className = 'fa-solid fa-c';
  }
});

// Evento de compilação do ASM
document.getElementById('asmcomp').addEventListener('click', async () => {
  if (!this.activeTab || compiling) return;

  activateTerminal('tasm', 'terminal-tasm');

  const button = document.getElementById('asmcomp');
  const icon = button.querySelector('i');

  try {
    compiling = true;
    button.disabled = true;
    icon.className = 'fas fa-spinner fa-spin';

    const content = editor.getValue();
    const inputDir = this.activeTab.substring(0, this.activeTab.lastIndexOf('\\') + 1);
    const inputFile = this.activeTab.split('\\').pop();

    const processorName = inputFile.split('.')[0];

    const hardwareFolderPath = await window.electronAPI.getHardwareFolderPath(processorName, inputDir);

    writeToTerminal('terminal-tasm', 'Starting ASM compilation...', 'command');
    writeToTerminal('terminal-tasm', `Input file: ${inputFile}`, 'info');

    const result = await window.electronAPI.compile({
      compiler: '/compilers/asmcomp.exe',
      content: content,
      filePath: this.activeTab,
      workingDir: inputDir,
      outputPath: inputDir,
      hardwareFolderPath: hardwareFolderPath,
    });

    await window.electronAPI.moveFilesToHardwareFolder(inputDir, hardwareFolderPath);

    writeToTerminal('terminal-tasm', 'ASM compilation finished.', 'info');
    
    // Disparar evento para atualizar a file tree
    document.dispatchEvent(new CustomEvent('refresh-file-tree'));

  } catch (error) {
    console.error('Compilation error:', error);
    writeToTerminal('terminal-tasm', `ASM to MIF compiler error: ${error.message}`, 'error');
  } finally {
    compiling = false;
    button.disabled = false;
    icon.className = 'fa-solid fa-cube';  
  }
});

//ICARUS

// Função para executar comandos do terminal passo a passo
async function executeCommand(command, terminalId) {
  // Imprime o comando no terminal
  writeToTerminal(terminalId, `Running: ${command}`, 'command');

  try {
      // Executa o comando usando a API do Electron
      const result = await window.electronAPI.runCommand(command);

      // Verifica se a saída padrão (stdout) existe e imprime linha por linha
      if (result.stdout) {
          result.stdout.split('\n').forEach((line) => {
              if (line.trim()) writeToTerminal(terminalId, line, 'success');
          });
      }

      // Verifica se há erros e imprime a saída de erro (stderr)
      if (result.stderr) {
          result.stderr.split('\n').forEach((line) => {
              if (line.trim()) writeToTerminal(terminalId, line, 'error');
          });
      }

  } catch (error) {
      // Caso ocorra erro, imprime no terminal
      writeToTerminal(terminalId, `Error: ${error.message}`, 'error');
  }
}

// Listener para iniciar os comandos do Icarus
document.addEventListener('vericomp', async (e) => {
  const { processorName, hardwarePath } = e.detail;
  const terminalId = 'terminal-tveri';

  // Ativar o terminal TVERI
  activateTerminal('tveri', terminalId);

  // Lista de comandos a serem executados
  const commands = [
      `iverilog -o ${hardwarePath}\\${processorName}.vvp ${hardwarePath}\\${processorName}.v ${hardwarePath}\\${processorName}_tb.v`,
      `vvp ${hardwarePath}\\${processorName}.vvp`,
      `gtkwave ${hardwarePath}\\${processorName}_wave.vcd`,
  ];

  // Executa cada comando de forma sequencial, um de cada vez
  for (const command of commands) {
      await executeCommand(command, terminalId);  // Executa o comando e espera a resposta antes de continuar
  }
  document.dispatchEvent(new CustomEvent('refresh-file-tree'));

});


// Initialize Terminal.js
function initializeTerminal() {
  terminal = new Terminal({
    fontSize: 14,
    fontFamily: 'JetBrains Mono, monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4'
    },
    cursorBlink: true
  });
  
  const terminalContainer = document.getElementById('terminal');
  terminal.open(terminalContainer);
  
  // Clear terminal with Ctrl+K
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      terminal.clear();
    }
  });
}


// Utility function to write to terminal with colors
function writeToTerminal(terminalId, message, type = 'info') {
  const terminalBody = document.querySelector(`#${terminalId} .terminal-body`);
  const timestamp = new Date().toLocaleString();

  if (!terminalBody) return;

  const logEntry = document.createElement('div');
  logEntry.classList.add('log-entry', type);

  const timestampDiv = document.createElement('div');
  timestampDiv.classList.add('timestamp');
  timestampDiv.textContent = timestamp;
  logEntry.appendChild(timestampDiv);

  const messageDiv = document.createElement('div');
  messageDiv.classList.add('log-message');

  switch (type) {
    case 'command':
      messageDiv.style.color = '#FF0000'; // Red for commands
      break;
    case 'success':
      messageDiv.style.color = '#00FF00'; // Green for success
      break;
    case 'error':
      messageDiv.style.color = '#FF0000'; // Red for errors
      break;
    default:
      messageDiv.style.color = '#D3D3D3'; // Light gray for normal output
  }

  messageDiv.textContent = message;
  logEntry.appendChild(messageDiv);

  terminalBody.appendChild(logEntry);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Function to add spacing between commands
function addSpacing(terminalId) {
  writeToTerminal(terminalId, '', 'spacing');
}
