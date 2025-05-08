// projectOriented.js - Implementação do gerenciamento de configuração orientada a projetos
document.addEventListener('DOMContentLoaded', () => {
  // Elementos do modal
  const projectModal = document.getElementById('modalProjectConfig');
  const topLevelSelect = document.getElementById('topLevelSelect');
  const testbenchSelect = document.getElementById('testbenchSelect');
  const gtkwaveSelect = document.getElementById('gtkwaveSelect');
  const processorsList = document.getElementById('processorsList');
  const addProcessorBtn = document.getElementById('addProcessor');
  const iverilogFlags = document.getElementById('iverilogFlags');
  const saveProjectConfigBtn = document.getElementById('saveProjectConfig');
  const cancelProjectConfigBtn = document.getElementById('cancelProjectConfig');
  const clearAllBtn = document.getElementById('clearAll');
  const closeProjectModalBtn = document.getElementById('closeProjectModal');
  
  // Elementos para o toggle UI
  const toggleUiButton = document.getElementById('toggle-ui');
  const settingsButton = document.getElementById('settings');
  
  // Duração da animação para troca de ícones
  const ICON_TRANSITION_DURATION = 300;
  
  // Nome do arquivo de configuração
  const CONFIG_FILENAME = 'projectOriented.json';
  
  // Configuração atual do projeto
  let currentConfig = {
    topLevelFile: '',
    testbenchFile: '',
    gtkwaveFile: '',
    processors: [],
    iverilogFlags: ''
  };

  // Lista de processadores disponíveis
  let availableProcessors = [];

  // Cache para os arquivos encontrados
  let foundVerilogFiles = [];
  let foundGtkwaveFiles = [];
  
  // Inicialização
  function init() {
    // Verificar se os elementos necessários existem
    if (!projectModal) {
      console.error('Modal de configuração de projeto não encontrado');
      return;
    }
    
    // Configurar botões
    setupModalButtons();
    
    // Configurar adição de processadores
    setupProcessorsSection();
    
    // Configurar toggle UI para alternar entre modais
    setupToggleUI();
    
    // Carregar processadores disponíveis
    loadAvailableProcessors();
    
    console.log('Sistema de configuração orientada a projetos inicializado');
  }
  
  // Carregar processadores disponíveis
  async function loadAvailableProcessors() {
    try {
      // Obter informações do projeto atual usando a API Electron
      const projectInfo = await window.electronAPI.getCurrentProject();
      
      if (projectInfo && projectInfo.projectOpen) {
        console.log("Projeto atual encontrado:", projectInfo);
        window.currentProjectPath = projectInfo.projectPath;
        
        // Usar processadores do projeto atual
        availableProcessors = projectInfo.processors || [];
      } else {
        // Se não houver projeto atual, tente usar o caminho do projeto armazenado
        const currentProjectPath = window.currentProjectPath || localStorage.getItem('currentProjectPath');
        
        if (!currentProjectPath) {
          console.warn("Nenhum caminho de projeto disponível para carregar processadores");
          availableProcessors = [];
          return;
        }
        
        console.log("Carregando processadores para o projeto:", currentProjectPath);
        
        // Chamar o método IPC para obter processadores com o caminho do projeto atual
        const processors = await window.electronAPI.getAvailableProcessors(currentProjectPath);
        console.log("Processadores carregados:", processors);
        
        availableProcessors = processors || [];
      }
    } catch (error) {
      console.error("Falha ao carregar processadores disponíveis:", error);
      availableProcessors = [];
    }
  }
  
  // Configurar os botões do modal
  function setupModalButtons() {
    // Botão para fechar o modal (X no canto superior direito)
    if (closeProjectModalBtn) {
      closeProjectModalBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Cancel
    if (cancelProjectConfigBtn) {
      cancelProjectConfigBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Save
    if (saveProjectConfigBtn) {
      saveProjectConfigBtn.addEventListener('click', () => {
        saveProjectConfiguration();
        closeProjectModal();
      });
    }
    
    // Botão Clear All
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        clearAllSettings();
      });
    }
    
    // Fechar modal ao clicar fora
    window.addEventListener('click', (event) => {
      if (event.target === projectModal) {
        closeProjectModal();
      }
    });
    
    // Tecla ESC para fechar o modal
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !projectModal.hidden && projectModal.classList.contains('active')) {
        closeProjectModal();
      }
    });
  }
  
  // Configurar a seção de processadores
  function setupProcessorsSection() {
    if (addProcessorBtn) {
      addProcessorBtn.addEventListener('click', () => {
        addProcessorRow();
      });
    }
    
    // Configurar event listener para botões de exclusão de processador
    processorsList.addEventListener('click', (event) => {
      if (event.target.classList.contains('delete-processor') || 
          event.target.closest('.delete-processor')) {
        const row = event.target.closest('.mconfig-processor-row');
        if (row) {
          row.remove();
        }
      }
    });
  }
  
  // Configurar o sistema de toggle UI
  function setupToggleUI() {
    // Verificar se os elementos necessários existem
    if (!toggleUiButton || !settingsButton) {
        console.error('Elementos necessários para toggle UI não encontrados');
        return;
    }
    
    // Adicionar estilos para a animação
    addToggleStyles();
    
    // Criar um novo botão para configuração de projeto (oculto por padrão)
    const projectSettingsButton = document.createElement('button');
    projectSettingsButton.id = 'settings-project';
    projectSettingsButton.className = 'toolbar-button';
    projectSettingsButton.setAttribute('titles', 'Project Configuration');
    projectSettingsButton.style.display = 'none'; // Início oculto
    
    // Adicionar ícone ao botão de projeto
    const projectIcon = document.createElement('i');
    projectIcon.className = 'fa-solid fa-gear';
    projectSettingsButton.appendChild(projectIcon);
    
    // Inserir o novo botão após o botão original
    settingsButton.parentNode.insertBefore(projectSettingsButton, settingsButton.nextSibling);
    
    // Adicionar listener apenas para o botão de projeto
    projectSettingsButton.addEventListener('click', function(e) {
        e.preventDefault();
        openProjectModal();
    });
    
    toggleUiButton.addEventListener('click', function () {
      const isToggleActive = toggleUiButton.classList.contains('active');
    
      // Atualizar botões com transição
      if (isToggleActive) {
        fadeOutIn(settingsButton, projectSettingsButton);
      } else {
        fadeOutIn(projectSettingsButton, settingsButton);
      }
    
      // Atualizar texto com ícone e transição suave
      const statusText = document.getElementById("processorProjectOriented");
      const statusTexttwo = document.getElementById("processorName");

      if (statusText) {
        statusText.style.opacity = "0"; // Fade out
    
        setTimeout(() => {
          if (isToggleActive) {
            // Processor Oriented
            statusText.innerHTML = `<i class="fa-solid fa-water"></i> Processor Oriented`;
            statusTexttwo.innerHTML = `<i class="fa-solid fa-xmark" style="color: #FF3131"></i> No Processor Configured`;
          } else {
            // Project Oriented
            statusText.innerHTML = `<i class="fa-solid fa-fire"></i> Project Oriented`;
          }
    
          statusText.style.opacity = "1"; // Fade in
        }, 300);
      }
    });
    
    // Verificar estado inicial do toggle-ui após um pequeno atraso
    setTimeout(() => {
        if (toggleUiButton.classList.contains('active')) {
            // Se o toggle estiver ativo, mostrar o botão de projeto
            fadeOutIn(settingsButton, projectSettingsButton);
        }
    }, 600);
  }
  
  // Função para realizar a transição suave entre botões
  function fadeOutIn(buttonToHide, buttonToShow) {
    // Verificar se os botões existem
    if (!buttonToHide || !buttonToShow) {
        console.error('Botões não encontrados para transição');
        return;
    }
    
    // Fade out do botão atual
    buttonToHide.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    buttonToHide.style.opacity = '0';
    
    // Após o fade out, trocar os botões
    setTimeout(() => {
        buttonToHide.style.display = 'none';
        
        // Mostrar o novo botão com opacity 0
        buttonToShow.style.opacity = '0';
        buttonToShow.style.display = '';
        buttonToShow.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
        
        // Forçar reflow para garantir que a transição ocorra
        buttonToShow.offsetHeight;
        
        // Iniciar fade in
        buttonToShow.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }

  // Lidar com o clique no botão settings
  function handleSettingsClick(e) {
    // Se o toggleUI estiver ativo, abrir o modal de projeto em vez do modal de processor
    if (toggleUiButton && toggleUiButton.classList.contains('active')) {
      e.preventDefault();
      e.stopPropagation(); // Impede a propagação do evento
      openProjectModal();
      return false; // Impede qualquer comportamento adicional
    }
    // Caso contrário, o comportamento original é mantido (abrir modalConfig)
    // Isso é gerenciado pelo código original, não precisamos fazer nada aqui
  }

  // Lidar com o clique no botão toggle UI
  function handleToggleUI() {
    // Verificar se o toggleUiButton está ativo
    const isToggleActive = toggleUiButton.classList.contains('active');
    
    // Atualizar o ícone do botão settings com base no estado do toggle
    updateSettingsButtonIcon(isToggleActive);
  }
  
  // Atualizar o ícone do botão settings
  function updateSettingsButtonIcon(isToggleActive) {
    // Verificar se o botão settings existe
    if (!settingsButton) return;
    
    // Obter o ícone atual
    const iconElement = settingsButton.querySelector('i');
    if (!iconElement) return;
    
    // Iniciar a transição de opacidade
    settingsButton.style.transition = `opacity ${ICON_TRANSITION_DURATION}ms ease`;
    settingsButton.style.opacity = '0';
    
    // Após o fade out, trocar o ícone
    setTimeout(() => {
      // Alterar a classe do ícone com base no estado do toggle
      if (isToggleActive) {
        iconElement.className = 'fa-solid fa-gear'; // Ícone único para projeto
        settingsButton.setAttribute('titles', 'Project Configuration');
      } else {
        iconElement.className = 'fa-solid fa-gears'; // Ícone múltiplo para processador
        settingsButton.setAttribute('titles', 'Processor Configuration');
      }
      
      // Iniciar fade in
      settingsButton.style.opacity = '1';
    }, ICON_TRANSITION_DURATION);
  }
  
  // Modificar a função addToggleStyles para incluir os novos elementos
  function addToggleStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        #settings, #settings-project {
            transition: opacity ${ICON_TRANSITION_DURATION}ms ease;
        }
        
        /* Garantir que os modais sejam visíveis quando abertos */
        .mconfig-modal.active {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
    `;
    document.head.appendChild(styleElement);
  }
  
  // Adicionar nova linha de processador
  function addProcessorRow() {
    const newRow = document.createElement('div');
    newRow.className = 'mconfig-processor-row';
    
    newRow.innerHTML = `
      <div class="mconfig-select-container">
        <select class="processor-select mconfig-select">
          <option value="">Selecione um Processador</option>
          ${availableProcessors.map(proc => `<option value="${proc}">${proc}</option>`).join('')}
        </select>
      </div>
      <div class="mconfig-form-group instance-name-group">
        <input type="text" class="processor-instance mconfig-input" placeholder="Instance name">
      </div>
      <button class="delete-processor mconfig-icon-btn" aria-label="Delete Processor">
        <i class="fa-solid fa-trash"></i>
      </button>
    `;
    
    processorsList.appendChild(newRow);
  }
  
  // Carregar arquivos .v e .gtkw para as listas suspensas
  async function loadFileOptions() {
    try {
      // Obtém o caminho do projeto atual através do API
      let projectPath = window.currentProjectPath;
      
      // Se não estiver definido, tenta obtê-lo via API
      if (!projectPath) {
        try {
          const projectData = await window.electronAPI.getCurrentProject();
          // Verificar se projectData é um objeto e extrair o caminho correto
          if (projectData && typeof projectData === 'object' && projectData.projectPath) {
            projectPath = projectData.projectPath;
            // Atualiza a variável global
            window.currentProjectPath = projectPath;
          } else if (typeof projectData === 'string') {
            // Caso a API retorne diretamente o caminho como string
            projectPath = projectData;
            window.currentProjectPath = projectPath;
          } else {
            console.error('Formato de dados do projeto inválido:', projectData);
          }
        } catch (err) {
          console.warn('Falha ao obter caminho do projeto via API:', err);
        }
      }
      
      // Verifica novamente se o caminho do projeto está disponível
      if (!projectPath) {
        console.error('Caminho do projeto atual não encontrado');
        // Exibe mensagem visual para o usuário
        showNoProjectError();
        return;
      }
      
      console.log('Usando caminho do projeto:', projectPath);
      
      // Tentar primeiro na pasta Top Level (se existir)
      const topLevelPath = await window.electronAPI.joinPath(projectPath, 'Top Level');
      let topLevelExists = false;
      
      try {
        topLevelExists = await window.electronAPI.directoryExists(topLevelPath);
      } catch (err) {
        console.warn('Erro ao verificar existência da pasta Top Level:', err);
      }
      
      // Definir o caminho onde procurar os arquivos
      const searchPath = topLevelExists ? topLevelPath : projectPath;
      console.log('Procurando arquivos em:', searchPath);
      
      // Obter arquivos usando o caminho correto
      try {
        foundVerilogFiles = await window.electronAPI.getFilesWithExtension(searchPath, '.v');
        foundGtkwaveFiles = await window.electronAPI.getFilesWithExtension(searchPath, '.gtkw');
      } catch (err) {
        console.error('Erro ao obter arquivos:', err);
        foundVerilogFiles = [];
        foundGtkwaveFiles = [];
      }
      
      // Limpar e popular as listas suspensas
      populateSelectOptions(topLevelSelect, foundVerilogFiles);
      populateSelectOptions(testbenchSelect, foundVerilogFiles);
      populateSelectOptions(gtkwaveSelect, foundGtkwaveFiles);
      
      // Exibir log de arquivos encontrados
      console.log('Arquivos Verilog (.v) encontrados:', foundVerilogFiles);
      console.log('Arquivos GTKWave (.gtkw) encontrados:', foundGtkwaveFiles);
    } catch (error) {
      console.error('Erro ao carregar arquivos para as listas suspensas:', error);
    }
  }
  
  // Função para exibir erro visual quando não há projeto
  function showNoProjectError() {
    // Adicionar mensagem visual ao modal
    const errorDiv = document.createElement('div');
    errorDiv.className = 'project-error-message';
    errorDiv.innerHTML = `
      <div class="alert alert-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Nenhum projeto aberto. Por favor, abra ou crie um projeto primeiro.
      </div>
    `;
    
    // Adicionar no início do modal
    const modalContent = document.querySelector('.mconfig-modal-content');
    if (modalContent && !modalContent.querySelector('.project-error-message')) {
      modalContent.insertBefore(errorDiv, modalContent.firstChild);
    }
    
    // Adicionar estilo para a mensagem
    const style = document.createElement('style');
    style.textContent = `
      .project-error-message {
        margin-bottom: 15px;
      }
      .alert {
        padding: 10px 15px;
        border-radius: 4px;
        font-weight: bold;
      }
      .alert-warning {
        background-color: #fff3cd;
        color: #856404;
        border: 1px solid #ffeeba;
      }
      .alert i {
        margin-right: 8px;
      }
    `;
    document.head.appendChild(style);
  }
  
  // Popular uma lista suspensa com opções
  function populateSelectOptions(selectElement, files) {
    if (!selectElement) return;
    
    // Salvar seleção atual (se houver)
    const currentSelectedValue = selectElement.value;
    
    // Limpar todas as opções existentes
    selectElement.innerHTML = '';
    
    // Adicionar opção padrão/placeholder
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Selecione um arquivo';
    selectElement.appendChild(defaultOption);
    
    // Adicionar novas opções
    files.forEach(file => {
      const option = document.createElement('option');
      
      // Extrair apenas o nome do arquivo do caminho completo
      const fileName = file.split('/').pop().split('\\').pop();
      
      option.value = fileName;
      option.textContent = fileName;
      selectElement.appendChild(option);
    });
    
    // Tentar restaurar seleção anterior
    if (currentSelectedValue && Array.from(selectElement.options).some(opt => opt.value === currentSelectedValue)) {
      selectElement.value = currentSelectedValue;
    } else {
      selectElement.selectedIndex = 0;
    }
  }
  
  // Antes de abrir o modal, carregar arquivos e configuração atual
  async function prepareModalBeforeOpen() {
    // Carregar processadores disponíveis
    await loadAvailableProcessors();
    
    // Carregar arquivos para as listas suspensas
    await loadFileOptions();
    
    // Carregar configurações salvas anteriormente
    await loadProjectConfiguration();
    
    // Adicionar prompt visual para o usuário escolher as opções se for a primeira vez
    showFileSelectionPrompt();
  }
  
  // Mostrar um prompt visual para selecionar arquivos se for necessário
  function showFileSelectionPrompt() {
    // Verificar se temos alguma configuração salva
    const isFirstTime = !currentConfig.topLevelFile && !currentConfig.testbenchFile && !currentConfig.gtkwaveFile;
    
    if (isFirstTime) {
      // Adicionar classe visual para indicar que precisa selecionar
      if (topLevelSelect) {
        topLevelSelect.classList.add('needs-selection');
        const label = topLevelSelect.closest('.mconfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      if (testbenchSelect) {
        testbenchSelect.classList.add('needs-selection');
        const label = testbenchSelect.closest('.mconfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      if (gtkwaveSelect) {
        gtkwaveSelect.classList.add('needs-selection');
        const label = gtkwaveSelect.closest('.mconfig-form-group')?.querySelector('label');
        if (label) label.innerHTML += ' <span class="selection-required">*</span>';
      }
      
      // Adicionar estilo CSS para indicação visual
      const styleElement = document.createElement('style');
      styleElement.textContent = `
        .needs-selection {
          border: 1px solid #2563eb;
        }
        .selection-required {
          color: #2563eb;
          font-weight: bold;
        }
      `;
      document.head.appendChild(styleElement);
      
      // Exibir mensagem no console
      console.log('Primeira configuração! Por favor, selecione um arquivo de cada tipo.');
    }
  }
  
  // Função para carregar configurações do projeto do arquivo JSON
  async function loadProjectConfiguration() {
    try {
      // Reset da configuração atual
      currentConfig = {
        topLevelFile: '',
        testbenchFile: '',
        gtkwaveFile: '',
        processors: [],
        iverilogFlags: ''
      };
      
      // Verificar se temos o caminho do projeto
      let projectPath = window.currentProjectPath;
      
      // Se não estiver definido, tenta obtê-lo via API
      if (!projectPath) {
        try {
          const projectData = await window.electronAPI.getCurrentProject();
          // Verificar se projectData é um objeto e extrair o caminho correto
          if (projectData && typeof projectData === 'object' && projectData.projectPath) {
            projectPath = projectData.projectPath;
            // Atualiza a variável global
            window.currentProjectPath = projectPath;
          } else if (typeof projectData === 'string') {
            // Caso a API retorne diretamente o caminho como string
            projectPath = projectData;
            window.currentProjectPath = projectPath;
          } else {
            console.error('Formato de dados do projeto inválido:', projectData);
          }
        } catch (err) {
          console.warn('Falha ao obter caminho do projeto via API:', err);
        }
      }
      
      // Verifica novamente se o caminho do projeto está disponível
      if (!projectPath) {
        console.error('Caminho do projeto não disponível. Impossível carregar configuração.');
        return;
      }
      
      // Usar a função joinPath da API electron
      const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
      
      // Verificar se o arquivo de configuração existe
      const configExists = await window.electronAPI.fileExists(configPath);
      
      if (configExists) {
        // Carregar configuração do arquivo
        const configContent = await window.electronAPI.readFile(configPath);
        currentConfig = JSON.parse(configContent);
        
        console.log('Configuração carregada:', currentConfig);
        
        // Atualizar campos do formulário
        updateFormWithConfig();
      } else {
        console.log('Arquivo de configuração não encontrado. Usando configuração padrão.');
      }
    } catch (error) {
      console.error('Erro ao carregar configuração do projeto:', error);
    }
  }
  
  // Atualizar formulário com a configuração carregada
  function updateFormWithConfig() {
    // Atualizar selects
    if (topLevelSelect && currentConfig.topLevelFile) {
      // Verificar se o arquivo existe nas opções
      const exists = Array.from(topLevelSelect.options).some(opt => opt.value === currentConfig.topLevelFile);
      
      if (exists) {
        topLevelSelect.value = currentConfig.topLevelFile;
      } else if (foundVerilogFiles.length > 0) {
        // Se o arquivo não existe mais, adicionar como opção para preservar a configuração
        const option = document.createElement('option');
        option.value = currentConfig.topLevelFile;
        option.textContent = `${currentConfig.topLevelFile} (não encontrado)`;
        option.classList.add('missing-file');
        topLevelSelect.appendChild(option);
        topLevelSelect.value = currentConfig.topLevelFile;
        
        console.warn(`Arquivo Top Level configurado não encontrado: ${currentConfig.topLevelFile}`);
      }
    }
    
    if (testbenchSelect && currentConfig.testbenchFile) {
      // Verificar se o arquivo existe nas opções
      const exists = Array.from(testbenchSelect.options).some(opt => opt.value === currentConfig.testbenchFile);
      
      if (exists) {
        testbenchSelect.value = currentConfig.testbenchFile;
      } else if (foundVerilogFiles.length > 0) {
        // Se o arquivo não existe mais, adicionar como opção para preservar a configuração
        const option = document.createElement('option');
        option.value = currentConfig.testbenchFile;
        option.textContent = `${currentConfig.testbenchFile} (não encontrado)`;
        option.classList.add('missing-file');
        testbenchSelect.appendChild(option);
        testbenchSelect.value = currentConfig.testbenchFile;
        
        console.warn(`Arquivo Testbench configurado não encontrado: ${currentConfig.testbenchFile}`);
      }
    }
    
    if (gtkwaveSelect && currentConfig.gtkwaveFile) {
      // Verificar se o arquivo existe nas opções
      const exists = Array.from(gtkwaveSelect.options).some(opt => opt.value === currentConfig.gtkwaveFile);
      
      if (exists) {
        gtkwaveSelect.value = currentConfig.gtkwaveFile;
      } else if (foundGtkwaveFiles.length > 0) {
        // Se o arquivo não existe mais, adicionar como opção para preservar a configuração
        const option = document.createElement('option');
        option.value = currentConfig.gtkwaveFile;
        option.textContent = `${currentConfig.gtkwaveFile} (não encontrado)`;
        option.classList.add('missing-file');
        gtkwaveSelect.appendChild(option);
        gtkwaveSelect.value = currentConfig.gtkwaveFile;
        
        console.warn(`Arquivo GTKWave configurado não encontrado: ${currentConfig.gtkwaveFile}`);
      }
    }
    
    // Limpar lista de processadores e adicionar os salvos
    if (processorsList) {
      // Limpar lista de processadores
      processorsList.innerHTML = '';
      
      // Adicionar processadores da configuração
      if (currentConfig.processors && currentConfig.processors.length > 0) {
        currentConfig.processors.forEach(processor => {
          const newRow = document.createElement('div');
          newRow.className = 'mconfig-processor-row';
          
          newRow.innerHTML = `
            <div class="mconfig-select-container">
              <select class="processor-select mconfig-select">
                <option value="">Selecione um Processador</option>
                ${availableProcessors.map(proc => 
                  `<option value="${proc}" ${proc === processor.type ? 'selected' : ''}>${proc}</option>`
                ).join('')}
              </select>
            </div>
            <div class="mconfig-form-group instance-name-group">
              <input type="text" class="processor-instance mconfig-input" placeholder="Instance name" value="${processor.instance || ''}">
            </div>
            <button class="delete-processor mconfig-icon-btn" aria-label="Delete Processor">
              <i class="fa-solid fa-trash"></i>
            </button>
          `;
          
          processorsList.appendChild(newRow);
        });
      } else {
        // Adicionar uma linha em branco para começar
        addProcessorRow();
      }
    }
    
    // Atualizar flags do iverilog
    if (iverilogFlags) {
      iverilogFlags.value = currentConfig.iverilogFlags || '';
    }
  }
  
  // Atualizar um select de processador com os processadores disponíveis
  function updateProcessorSelect(selectElement, selectedValue = '') {
    if (!selectElement) return;
    
    // Salvar o valor atual se não for fornecido um valor
    if (!selectedValue) {
      selectedValue = selectElement.value;
    }
    
    // Limpar opções existentes
    selectElement.innerHTML = '';
    
    // Adicionar opção padrão
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Selecione um Processador';
    selectElement.appendChild(defaultOption);
    
    // Adicionar processadores disponíveis
    availableProcessors.forEach(processor => {
      const option = document.createElement('option');
      option.value = processor;
      option.textContent = processor;
      
      // Verificar se este é o processador selecionado anteriormente
      if (processor === selectedValue) {
        option.selected = true;
      }
      
      selectElement.appendChild(option);
    });
  }
  
  // Função para coletar dados do formulário
  function collectFormData() {
    const config = {
      topLevelFile: topLevelSelect ? topLevelSelect.value : '',
      testbenchFile: testbenchSelect ? testbenchSelect.value : '',
      gtkwaveFile: gtkwaveSelect ? gtkwaveSelect.value : '',
      processors: [],
      iverilogFlags: iverilogFlags ? iverilogFlags.value : ''
    };
    
    // Coletar dados dos processadores
    const processorRows = processorsList.querySelectorAll('.mconfig-processor-row');
    processorRows.forEach(row => {
      const processorSelect = row.querySelector('.processor-select');
      const instanceInput = row.querySelector('.processor-instance');
      
      if (processorSelect && instanceInput && instanceInput.value.trim()) {
        config.processors.push({
          type: processorSelect.value,
          instance: instanceInput.value.trim()
        });
      }
    });
    
    return config;
  }
  
  // Função para salvar configurações do projeto em arquivo JSON
  async function saveProjectConfiguration() {
    try {
      // Verificar se temos o caminho do projeto
      let projectPath = window.currentProjectPath;
    
    // Se não estiver definido, tenta obtê-lo via API
    if (!projectPath) {
      try {
        projectPath = await window.electronAPI.getCurrentProject();
        // Atualiza a variável global se encontrado
        if (projectPath) {
          window.currentProjectPath = projectPath;
        }
      } catch (err) {
        console.warn('Falha ao obter caminho do projeto via API:', err);
      }
    }
    
    // Verifica novamente se o caminho do projeto está disponível
    if (!projectPath) {
      console.error('Caminho do projeto não disponível. Impossível salvar configuração.');
      alert('Falha ao salvar: nenhum projeto aberto.');
      return;
    }
    
    // Coletar dados do formulário
    const formData = collectFormData();
    currentConfig = formData;
    
    // Usar a função joinPath da API electron
    const configPath = await window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
    
    // Salvar em arquivo JSON
    await window.electronAPI.writeFile(configPath, JSON.stringify(currentConfig, null, 2));
    
    console.log('Configuração do projeto salva em:', configPath);
    console.log('Configuração salva:', currentConfig);
  } catch (error) {
    console.error('Erro ao salvar configuração do projeto:', error);
    alert('Erro ao salvar configuração: ' + error.message);
  }
}
  // Limpar todas as configurações
  function clearAllSettings() {
    // Limpar selects
    if (topLevelSelect) topLevelSelect.selectedIndex = 0;
    if (testbenchSelect) testbenchSelect.selectedIndex = 0;
    if (gtkwaveSelect) gtkwaveSelect.selectedIndex = 0;
    
    // Limpar processadores (manter apenas uma linha em branco)
    if (processorsList) {
      processorsList.innerHTML = '';
      addProcessorRow();
    }
    
    // Limpar flags do iverilog
    if (iverilogFlags) iverilogFlags.value = '';
    
    // Atualizar a configuração atual
    currentConfig = {
      topLevelFile: '',
      testbenchFile: '',
      gtkwaveFile: '',
      processors: [],
      iverilogFlags: ''
    };
    
    console.log('Todas as configurações foram limpas');
  }
  
  // Função para fechar o modal do projeto
  function closeProjectModal() {
    if (projectModal) {
      projectModal.classList.remove('active');
      
      // Pequeno delay antes de esconder completamente para permitir a animação
      setTimeout(() => {
        projectModal.hidden = true;
      }, 300);
    }
  }
  
  // Função para abrir o modal e preparar os dados
  async function openProjectModal() {
    if (projectModal) {
      // Mostrar o modal primeiro para evitar impressão de que nada aconteceu
      projectModal.hidden = false;
      projectModal.classList.add("active");
      
      // Em seguida, carregar os dados
      await prepareModalBeforeOpen();
    }
  }
  
  // Exportar funções que precisam ser acessadas externamente
  window.projectOrientedConfig = {
    openModal: openProjectModal,
    saveConfig: saveProjectConfiguration,
    loadConfig: loadProjectConfiguration
  };
  
  // Inicializar após um pequeno atraso
  setTimeout(init, 800);
});