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

// Função para preencher os cartões com os arquivos encontrados
function populateFileCards(tbFiles, gtkwFiles) {
  const tbFilesContainer = document.getElementById('tb-files-container');
  const gtkwFilesContainer = document.getElementById('gtkw-files-container');
  
  // Limpar os containers
  tbFilesContainer.innerHTML = '';
  gtkwFilesContainer.innerHTML = '';
  
  // Preencher cartões de arquivos _tb.v
  if (tbFiles.length > 0) {
      tbFiles.forEach(file => {
          const fileName = file.split('/').pop();
          const card = createFileCard(fileName, 'tb');
          tbFilesContainer.appendChild(card);
      });
  } else {
      tbFilesContainer.innerHTML = '<p class="empty-message">Nenhum arquivo testbench encontrado</p>';
  }
  
  // Preencher cartões de arquivos .gtkw
  if (gtkwFiles.length > 0) {
      gtkwFiles.forEach(file => {
          const fileName = file.split('/').pop();
          const card = createFileCard(fileName, 'gtkw');
          gtkwFilesContainer.appendChild(card);
      });
  } else {
      gtkwFilesContainer.innerHTML = '<p class="empty-message">Nenhum arquivo GTKW encontrado</p>';
  }
  
  // Atualizar contadores de arquivos
  updateFileCounters();
}

// Função para criar cartões de arquivo
function createFileCard(fileName, type) {
  const card = document.createElement('div');
  card.classList.add('file-card');
  card.dataset.filename = fileName;
  card.dataset.type = type;
  
  let icon = type === 'tb' ? 'fa-file-code' : 'fa-chart-line';
  let typeLabel = type === 'tb' ? 'Testbench' : 'GTKW';
  let typeColor = type === 'tb' ? 'var(--accent-primary)' : 'var(--success)';
  
  card.innerHTML = `
      <div class="file-card-header">
          <i class="fas ${icon}" style="color: ${typeColor}"></i>
          <span class="file-type-badge" style="background-color: ${typeColor}">${typeLabel}</span>
      </div>
      <div class="file-card-body">
          <h3 class="file-name">${fileName}</h3>
          <p class="file-info">Clique para selecionar</p>
      </div>
  `;
  
  card.addEventListener('click', () => {
      // Desmarcar outros cartões do mesmo tipo
      document.querySelectorAll(`.file-card[data-type="${type}"]`).forEach(c => c.classList.remove('selected'));
      
      // Marcar este cartão como selecionado
      card.classList.add('selected');
      
      // Atualizar a seleção no objeto global
      if (type === 'tb') {
          if (!window.selectedFiles) window.selectedFiles = {};
          window.selectedFiles.tb = fileName;
      } else {
          if (!window.selectedFiles) window.selectedFiles = {};
          window.selectedFiles.gtkw = fileName;
      }
  });
  
  return card;
}

// Função para atualizar contadores de arquivos
function updateFileCounters() {
  const tbFilesContainer = document.getElementById('tb-files-container');
  const gtkwFilesContainer = document.getElementById('gtkw-files-container');
  const tbFileCount = document.getElementById('tb-file-count');
  const gtkwFileCount = document.getElementById('gtkw-file-count');
  
  if (tbFileCount && gtkwFileCount) {
      const tbCount = tbFilesContainer.querySelectorAll('.file-card').length;
      const gtkwCount = gtkwFilesContainer.querySelectorAll('.file-card').length;
      
      tbFileCount.textContent = tbCount;
      gtkwFileCount.textContent = gtkwCount;
  }
}

// Modificar o trecho que carrega os arquivos no evento de click do saveConfigButton
saveConfigButton.addEventListener('click', () => {
  if (multicoreCheckbox.checked) {
      // Criar overlay de carregamento
      const loadingOverlay = document.createElement('div');
      loadingOverlay.classList.add('loading-overlay');
      loadingOverlay.innerHTML = `
          <div class="loading-content">
              <div class="loading-spinner"></div>
              <p>Loading Multicore Configuration...</p>
          </div>
      `;
      document.body.appendChild(loadingOverlay);

      // Carregar modal após um tempo
      setTimeout(() => {
          // Carregar conteúdo de multicore.html e escanear pasta TopLevel
          window.electronAPI.scanTopLevelFolder(currentProjectPath)
              .then(files => {
                  // Separar arquivos _tb.v e .gtkw
                  const tbFiles = files.filter(file => file.endsWith('_tb.v'));
                  const gtkwFiles = files.filter(file => file.endsWith('.gtkw'));
                  
                  // Carregar o HTML base
                  return fetch('./html/multicore.html')
                      .then(response => {
                          if (!response.ok) {
                              throw new Error(`HTTP error! Status: ${response.status}`);
                          }
                          return response.text();
                      })
                      .then(html => {
                          return { html, tbFiles, gtkwFiles };
                      });
              })
              .then(data => {
                  // Remover overlay de carregamento
                  loadingOverlay.remove();
                  
                  // Selecionar o corpo do modal multicore
                  const multicoreModalBody = document.getElementById('multicore-modal-body');
                  multicoreModalBody.innerHTML = data.html;
                  
                  // Exibir o modal
                  const multicoreModal = document.getElementById('multicore-modal');
                  multicoreModal.classList.remove('hidden');
                  multicoreModal.classList.add('active');
                  
                  // Preencher os cartões apenas após o HTML ser carregado
                  setTimeout(() => {
                      populateFileCards(data.tbFiles, data.gtkwFiles);
                  }, 100);
                  
                  // Inicializar qualquer JavaScript necessário no conteúdo carregado
                  initializeMulticoreContent();
              })
              .catch(error => {
                  console.error('Erro ao carregar multicore.html:', error);
                  loadingOverlay.remove();
                  alert('Erro ao carregar configuração multicore. Por favor, tente novamente.');
              });
      }, 800);
  }
});

// Modificar a função que inicializa o conteúdo multicore
function initializeMulticoreContent() {
  console.log('Inicializando conteúdo multicore');
  
  // Botão para executar simulação multicore
  const runMulticoreButton = document.getElementById('run-multicore-sim');
  if (runMulticoreButton) {
      runMulticoreButton.addEventListener('click', () => {
          const selectedFiles = window.selectedFiles || {};
          
          if (!selectedFiles.tb) {
              alert('Por favor, selecione um arquivo testbench para executar a simulação.');
              return;
          }
          
          if (!selectedFiles.gtkw) {
              alert('Por favor, selecione um arquivo GTKW para visualização.');
              return;
          }
          
          // Aqui você pode implementar a lógica para executar a simulação
          console.log(`Executando simulação multicore para TB: ${selectedFiles.tb}, GTKW: ${selectedFiles.gtkw}`);
          
          // Exemplo: Chamar API Electron para executar a simulação
          // window.electronAPI.runMulticoreSimulation(currentProjectPath, selectedFiles.tb, selectedFiles.gtkw);
          
          // Fechar o modal
          const multicoreModal = document.getElementById('multicore-modal');
          multicoreModal.classList.remove('active');
          multicoreModal.classList.add('hidden');
          
          // Salvar a configuração (se necessário)
          saveMulticoreConfig(selectedFiles);
      });
  }
}

// Função para salvar a configuração multicore
function saveMulticoreConfig(selectedFiles) {
  // Aqui você pode salvar a configuração, por exemplo, em localStorage ou enviando para o backend
  console.log('Salvando configuração multicore:', selectedFiles);
  
  // Exemplo: Salvar em localStorage
  localStorage.setItem('multicoreConfig', JSON.stringify(selectedFiles));
  
  // Opcional: Mostrar feedback para o usuário
  const toast = document.createElement('div');
  toast.classList.add('toast');
  toast.innerHTML = `
      <div class="toast-content">
          <i class="fas fa-check-circle" style="color: var(--success);"></i>
          <span>Configuração multicore salva com sucesso!</span>
      </div>
  `;
  document.body.appendChild(toast);
  
  // Remover o toast após alguns segundos
  setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
  }, 3000);
}
  
  // Adicionar evento para fechar o modal quando o botão de fechamento for clicado
  const closeMulticoreButton = document.getElementById('close-multicore-modal');
  if (closeMulticoreButton) {
    closeMulticoreButton.addEventListener('click', () => {
      const multicoreModal = document.getElementById('multicore-modal');
      multicoreModal.classList.remove('active');
      multicoreModal.classList.add('hidden');
    });
  }
  
  // Fechar o modal se o usuário clicar fora do conteúdo do modal
  document.addEventListener('click', (event) => {
    const multicoreModal = document.getElementById('multicore-modal');
    if (multicoreModal && event.target === multicoreModal) {
      multicoreModal.classList.remove('active');
      multicoreModal.classList.add('hidden');
    }
  });
});

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
document.addEventListener('DOMContentLoaded', () => {
  setupTcmdTerminal();
});

function setupTcmdTerminal() {
  // Obter referências aos elementos do DOM
  const terminalTcmd = document.getElementById('terminal-tcmd');
  if (!terminalTcmd) return;
  
  const terminalBody = terminalTcmd.querySelector('.terminal-body');
  
  // Substituir o conteúdo do terminal
  terminalBody.innerHTML = '';
  
  // Criar o container do terminal
  const tcmdTerminal = document.createElement('div');
  tcmdTerminal.className = 'tcmd-terminal';
  terminalBody.appendChild(tcmdTerminal);
  
  // Criar a área de output
  const outputArea = document.createElement('div');
  outputArea.className = 'tcmd-output';
  tcmdTerminal.appendChild(outputArea);
  
  // Criar o wrapper para input
  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'tcmd-input-wrapper';
  tcmdTerminal.appendChild(inputWrapper);
  
  // Criar o prompt
  const prompt = document.createElement('span');
  prompt.className = 'tcmd-prompt';
  prompt.textContent = '> ';
  inputWrapper.appendChild(prompt);
  
  // Criar o input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tcmd-input';
  input.autofocus = true;
  inputWrapper.appendChild(input);
  
  // Flag para verificar se o terminal foi iniciado
  let terminalStarted = false;
  
  // Iniciar o terminal ao clicar na aba TCMD
  const tabTcmd = document.querySelector('button.tab[data-terminal="tcmd"]');
  if (tabTcmd) {
    tabTcmd.addEventListener('click', () => {
      if (!terminalStarted) {
        startTerminal();
      }
      setTimeout(() => input.focus(), 100);
    });
  }
  
  // Inicializar terminal
  function startTerminal() {
    if (window.terminalAPI) {
      // Iniciar o processo do terminal
      window.terminalAPI.start();
      
      // Quando o terminal é iniciado
      window.terminalAPI.onStarted(() => {
        terminalStarted = true;
        outputArea.textContent = 'Conectando ao CMD...\n';
      });
      
      // Quando há saída do terminal
      window.terminalAPI.onData((data) => {
        // Remover caracteres de controle extras (se necessário)
        let cleanData = data
          .replace(/\r?\n/g, '\n') // Normalizar quebras de linha
          .replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); // Remover códigos ANSI (opcional)
        
        // Adicionar à área de saída
        outputArea.textContent += cleanData;
        
        // Atualizar o prompt se houver um padrão de diretório
        const dirMatch = outputArea.textContent.match(/([A-Z]:\\[^\r\n>]*?)>/);
        if (dirMatch) {
          prompt.textContent = dirMatch[0];
        }
        
        // Rolar para baixo
        tcmdTerminal.scrollTop = tcmdTerminal.scrollHeight;
      });
    } else {
      outputArea.textContent += 'API de terminal não disponível no ambiente atual.\n';
    }
  }
  
  // Lidar com a entrada do usuário
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && terminalStarted) {
      const command = input.value;
      
      // Adicionar comando à saída (opcional, já que o terminal vai ecoar o comando)
      // outputArea.textContent += `${prompt.textContent}${command}\n`;
      
      // Enviar comando para o processo
      window.terminalAPI.write(command + '\r');
      
      // Limpar input
      input.value = '';
      
      // Rolar para baixo
      tcmdTerminal.scrollTop = tcmdTerminal.scrollHeight;
      
      e.preventDefault();
    }
  });
  
  // Manter o foco no input
  tcmdTerminal.addEventListener('click', () => {
    input.focus();
  });
  
  // Botão Clear
  const clearButton = document.getElementById('clear-terminal');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.terminal === 'tcmd') {
        outputArea.textContent = '';
        if (terminalStarted) {
          window.terminalAPI.clear();
        }
      }
    });
  }
}