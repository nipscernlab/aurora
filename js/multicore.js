// No renderer.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');

  const saveConfigButton = document.getElementById('saveConfig');
  const multicoreCheckbox = document.querySelector('input[id="multicore"]');
  
  console.log('Save Config Button:', saveConfigButton);
  console.log('Multicore Checkbox:', multicoreCheckbox);

  if (!saveConfigButton || !multicoreCheckbox) {
      console.error('Elementos não encontrados! Verifique os IDs e seletores.');
      return;
  }

  saveConfigButton.addEventListener('click', () => {
    if (multicoreCheckbox.checked) {
        // Criar overlay de carregamento
        const loadingOverlay = document.createElement('div');
        loadingOverlay.classList.add('loading-overlay');
        loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <p>Opening MULTICORE modal</p>
            </div>
        `;
        document.body.appendChild(loadingOverlay);

        // Carregar modal após um tempo
        setTimeout(() => {
            // Remover overlay de carregamento
            loadingOverlay.remove();

            // Carregar conteúdo de multicore.html
            fetch('./html/multicore.html')
                .then(response => response.text())
                .then(html => {
                    // Selecionar o corpo do modal multicore
                    const multicoreModalBody = document.getElementById('multicoreModalBody');
                    multicoreModalBody.innerHTML = html;

                    // Exibir o modal
                    const multicoreModal = document.getElementById('multicoreModal');
                    multicoreModal.style.display = 'block';
                })
                .catch(error => {
                    console.error('Erro ao carregar multicore.html:', error);
                    alert('Erro ao carregar modal multicore');
                });
        }, 2000);
    }
});
  
});

const multicoreCheckbox = document.getElementById('multicore-checkbox');

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Fully Loaded');
    
    const button = document.getElementById('create-toplevel-folder');
    if (button) {
        console.log('Botão encontrado');
        button.addEventListener('click', (e) => {
            console.log('Botão clicado DIRETAMENTE');
            e.preventDefault();
        });
    } else {
        console.error('Botão NÃO encontrado');
    }
  });


  //TOP LEVEL
document.getElementById("create-toplevel-folder").addEventListener("click", async () => {
    console.log("Botão clicado"); // Log de diagnóstico
      
    if (!currentProjectPath) {
      console.error("Nenhum projeto aberto para TopLevel");
      alert("Nenhum projeto aberto para TopLevel.");
      return;
    }
    
    try {
      console.log("Tentando criar TopLevel em:", currentProjectPath);
      const result = await window.electronAPI.createTopLevel(currentProjectPath);
      
      console.log("Resultado:", result); // Log de diagnóstico
      alert(result.message);
  
      refreshFileTree(); // Atualiza a árvore de arquivos
    } catch (error) {
      console.error("Erro ao criar TopLevel:", error);
      alert("Erro ao criar TopLevel: " + error.message);
    }
  });
  
//CMD =========================================================================================================
class Terminal {
  constructor(containerId, terminalId) {
    this.container = document.getElementById(containerId);
    this.terminalId = terminalId;
    this.history = [];
    this.historyIndex = 0;
    
    this.createTerminalElement();
    this.initializeTerminal();
  }

  createTerminalElement() {
    // Limpa apenas o container do TCMD
    this.container.innerHTML = '';
    
    // Cria a estrutura do terminal dentro do container específico
    const terminalHTML = `
      <div class="terminal">
        <div class="terminal-output"></div>
        <div class="terminal-input-line">
          <span class="terminal-prompt">> </span>
          <input class="terminal-input" type="text" spellcheck="false">
        </div>
      </div>
    `;
    this.container.innerHTML = terminalHTML;
    
    this.terminalElement = this.container.querySelector('.terminal');
    this.outputElement = this.container.querySelector('.terminal-output');
    this.inputElement = this.container.querySelector('.terminal-input');
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.inputElement.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // Impede o comportamento padrão do Enter
        await this.handleCommand();
      } else if (e.key === 'ArrowUp') {
        this.navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        this.navigateHistory(1);
      }
    });
    
    // Certifique-se que window.terminalAPI está definido
    if (window.terminalAPI) {
      window.terminalAPI.onData((event, terminalId, data) => {
        if (terminalId === this.terminalId) {
          this.writeOutput(data);
        }
      });
      
      window.terminalAPI.onError((event, terminalId, error) => {
        if (terminalId === this.terminalId) {
          this.writeOutput(error, 'error');
        }
      });
    } else {
      console.error('terminalAPI não está definido no window');
    }
  }

  async initializeTerminal() {
    if (window.terminalAPI) {
      const success = await window.terminalAPI.createTerminal(this.terminalId);
      if (success) {
        this.writeOutput('Terminal inicializado. Digite "help" para comandos disponíveis.\r\n');
      } else {
        this.writeOutput('Falha ao inicializar o terminal.\r\n', 'error');
      }
    } else {
      this.writeOutput('Erro: API de terminal não disponível\r\n', 'error');
    }
  }

  async handleCommand() {
    const command = this.inputElement.value.trim();
    if (command) {
      this.history.push(command);
      this.historyIndex = this.history.length;
      this.writeOutput(`> ${command}\r\n`, 'command');
      
      // Limpa o input imediatamente
      this.inputElement.value = '';
      this.currentLine = '';
      
      // Envia o comando apenas se a API estiver disponível
      if (window.terminalAPI) {
        try {
          await window.terminalAPI.sendCommand(this.terminalId, command);
        } catch (error) {
          this.writeOutput(`Erro ao executar comando: ${error.message}\r\n`, 'error');
        }
      } else {
        this.writeOutput('Erro: API de terminal não disponível\r\n', 'error');
      }
    }
  }

  navigateHistory(direction) {
    if (this.history.length === 0) return;
    
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
    
    if (this.historyIndex < this.history.length) {
      this.inputElement.value = this.history[this.historyIndex];
    } else {
      this.inputElement.value = this.currentLine;
    }
  }

  writeOutput(text, type = 'normal') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    this.outputElement.appendChild(line);
    this.outputElement.scrollTop = this.outputElement.scrollHeight;
  }

  focus() {
    this.inputElement.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tcmdTab = document.querySelector('[data-terminal="tcmd"]');
  
  if (!tcmdTab) {
    console.error('Botão da aba TCMD não encontrado');
    return;
  }

  tcmdTab.addEventListener('click', () => {
    try {
      // Seleciona o container específico dentro do TCMD
      const tcmdContent = document.getElementById('terminal-tcmd');
      const terminalContainer = tcmdContent.querySelector('#terminal-container');
      
      if (!terminalContainer) {
        console.error('Container do terminal não encontrado dentro do TCMD');
        return;
      }

      // Mostra o conteúdo do TCMD (se estiver escondido)
      tcmdContent.classList.remove('hidden');
      
      // Inicializa o terminal apenas uma vez
      if (!window.tcmdTerminal) {
        window.tcmdTerminal = new Terminal('terminal-container', 'tcmd-terminal');
        console.log('Terminal CMD inicializado no container específico');
      }
      
      // Foca no input do terminal
      setTimeout(() => {
        if (window.tcmdTerminal) {
          window.tcmdTerminal.focus();
        }
      }, 50);
      
    } catch (error) {
      console.error('Erro ao inicializar terminal CMD:', error);
    }
  });
});

// Controle das abas - versão corrigida
document.querySelectorAll('.terminal-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const terminalId = tab.getAttribute('data-terminal');
    
    // Esconde todos os terminais
    document.querySelectorAll('.terminal-content').forEach(content => {
      content.classList.add('hidden');
    });
    
    // Mostra apenas o terminal clicado
    const activeTerminal = document.getElementById(`terminal-${terminalId}`);
    activeTerminal.classList.remove('hidden');
    
    // Inicializa o TCMD se for o caso
    if (terminalId === 'tcmd') {
      if (!window.tcmdTerminal) {
        window.tcmdTerminal = new Terminal('tcmd-terminal-container', 'tcmd-terminal-instance');
      }
      window.tcmdTerminal.focus();
    }
  });
});

// Verifica se a aba TCMD está ativa ao carregar
document.addEventListener('DOMContentLoaded', () => {
  const tcmdTab = document.querySelector('[data-terminal="tcmd"]');
  const tcmdContent = document.getElementById('terminal-tcmd');
  
  if (tcmdTab.classList.contains('active')) {
    tcmdContent.classList.remove('hidden');
    if (!window.tcmdTerminal) {
      window.tcmdTerminal = new Terminal('tcmd-terminal-container', 'tcmd-terminal-instance');
    }
  }
});

