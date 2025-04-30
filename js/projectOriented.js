// config-toggle.js - Implementação para alternar entre modais de configuração
document.addEventListener('DOMContentLoaded', () => {
  // Elementos principais
  const toggleUiButton = document.getElementById('toggle-ui');
  const settingsButton = document.getElementById('settings');
  
  // Modais
  const processorModal = document.getElementById('modalConfig');
  const projectModal = document.getElementById('modalProjectConfig');
  
  // Botão para configuração de projeto (será criado)
  let projectSettingsButton = null;
  
  // Duração da animação para troca de ícones
  const ICON_TRANSITION_DURATION = 300;
  
  // Objeto para armazenar configurações temporárias do projeto
  let tempProjectConfigs = {};
  
  // Inicialização
  function init() {
    // Verificar se os elementos necessários existem
    if (!toggleUiButton || !settingsButton) {
      console.error('Elementos necessários não encontrados');
      return;
    }
    
    // NÃO modificar o botão original de configurações
    // Em vez disso, vamos criar um novo botão para configuração de projeto
    
    // Criar um novo botão para configuração de projeto (oculto por padrão)
    projectSettingsButton = document.createElement('button');
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
    
    // NÃO substituir o listener do botão de configurações original
    // Ele já tem a sua própria função que está funcionando
    
    // Adicionar listener apenas para o botão de projeto
    projectSettingsButton.addEventListener('click', function(e) {
      e.preventDefault();
      
      if (projectModal) {
        // Carregar configurações do projeto antes de abrir o modal
        loadProjectConfiguration();
        
        // Usar a mesma abordagem que já funciona com o modal original
        projectModal.hidden = false;
        projectModal.classList.add("active");
      } else {
        console.error('Modal de configuração de projeto não encontrado');
      }
    });
    
    // Configurar botões do modal de projeto
    setupProjectModalButtons();
    
    // Adicionar listener para o botão de toggle UI
    // Apenas para alternar entre os botões de configuração
    toggleUiButton.addEventListener('click', toggleConfigButtons);
    
    // Verificar estado inicial do toggle-ui
    setTimeout(() => {
      // Verificar se o toggle-ui já está ativo
      if (toggleUiButton.classList.contains('active')) {
        toggleConfigButtons();
      }
    }, 600); // Pequeno atraso para garantir que toggle-ui.js já inicializou
    
    console.log('Sistema de alternância de botões de configuração inicializado');
  }
  
  // Alterna entre os botões de configuração
  function toggleConfigButtons() {
    // Verificar se o toggleUiButton está ativo
    const isToggleActive = toggleUiButton.classList.contains('active');
    
    // Realizar a transição suave
    if (isToggleActive) {
      // Mostrar botão de projeto e ocultar botão original
      fadeOutIn(settingsButton, projectSettingsButton);
    } else {
      // Mostrar botão original e ocultar botão de projeto
      fadeOutIn(projectSettingsButton, settingsButton);
    }
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
  
  // Adicionar estilos CSS para a animação
  function addStyles() {
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
  
  // Configurar os botões do modal de projeto
  function setupProjectModalButtons() {
    if (!projectModal) return;
    
    // Botão para fechar o modal (X no canto superior direito)
    const closeProjectModalBtn = document.getElementById('closeProjectModal');
    if (closeProjectModalBtn) {
      closeProjectModalBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Cancel
    const cancelProjectBtn = projectModal.querySelector('.mconfig-cancel-btn');
    if (cancelProjectBtn) {
      cancelProjectBtn.addEventListener('click', () => {
        closeProjectModal();
      });
    }
    
    // Botão Save
    const saveProjectBtn = projectModal.querySelector('.mconfig-save-btn');
    if (saveProjectBtn) {
      saveProjectBtn.addEventListener('click', () => {
        saveProjectConfiguration();
        closeProjectModal();
      });
    }
    
    // Fechar modal ao clicar fora (comportamento padrão)
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
  
  // Função para carregar configurações do projeto
  function loadProjectConfiguration() {
    try {
      // Limpar configurações temporárias
      tempProjectConfigs = {};
      
      // Aqui você implementaria o carregamento das configurações do projeto
      // Exemplo: carregar de localStorage ou de um arquivo
      const savedConfig = localStorage.getItem('projectConfiguration');
      if (savedConfig) {
        tempProjectConfigs = JSON.parse(savedConfig);
        
        // Atualizar campos do formulário com os valores carregados
        updateProjectFormFields(tempProjectConfigs);
      }
      
      console.log('Configurações do projeto carregadas:', tempProjectConfigs);
    } catch (error) {
      console.error('Erro ao carregar configurações do projeto:', error);
    }
  }
  
  // Atualiza os campos do formulário com os valores carregados
  function updateProjectFormFields(config) {
    // Aqui você implementaria a atualização dos campos do formulário
    // com base nas configurações carregadas
    
    // Exemplo: atualizar campos de entrada, checkboxes, etc.
    // const fieldExample = projectModal.querySelector('#fieldId');
    // if (fieldExample && config.fieldName) {
    //   fieldExample.value = config.fieldName;
    // }
    
    // Para cada seção do formulário, você pode implementar
    // a atualização específica dos campos
  }
  
  // Função para salvar configurações do projeto
  function saveProjectConfiguration() {
    try {
      // Aqui você implementaria a coleta dos valores do formulário
      // e salvamento das configurações
      
      // Exemplo: coletar valores dos campos e salvar em localStorage
      // const fieldExample = projectModal.querySelector('#fieldId');
      // if (fieldExample) {
      //   tempProjectConfigs.fieldName = fieldExample.value;
      // }
      
      // Salvar configurações
      localStorage.setItem('projectConfiguration', JSON.stringify(tempProjectConfigs));
      
      console.log('Configurações do projeto salvas:', tempProjectConfigs);
    } catch (error) {
      console.error('Erro ao salvar configurações do projeto:', error);
    }
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

  // Adicionar estilos e inicializar após um pequeno atraso
  // para garantir que o DOM e outros scripts estejam carregados
  setTimeout(() => {
    addStyles();
    init();
  }, 800); // Esperar um pouco mais que o toggle-ui.js (que usa 500ms)
});