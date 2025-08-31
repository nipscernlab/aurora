// unified.js - Gerencia o toggle UI, abertura de modais e configuração do projeto.
document.addEventListener('DOMContentLoaded', () => {
  // === Configuração dos IDs ===
  const TOGGLE_BUTTON_ID = 'toggle-ui';
  const SETTINGS_BUTTON_ID = 'settings';
  const PROJECT_MODAL_ID = 'modalProjectConfig';
  const PROCESSOR_MODAL_ID = 'modalProcessorConfig';

  // === Referências aos elementos ===
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
  const settingsButton = document.getElementById(SETTINGS_BUTTON_ID);
  const projectModal = document.getElementById(PROJECT_MODAL_ID);
  const processorModal = document.getElementById(PROCESSOR_MODAL_ID);

  // === Estado inicial ===
  let isProjectModeActive = false;

  // === Funções auxiliares ===

  /**
   * Abre um modal específico.
   * @param {HTMLElement} modal O modal a ser aberto.
   */
  function openModal(modal) {
    if (!modal) {
      console.error('Modal inválido!');
      return;
    }

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Fecha um modal específico.
   * @param {HTMLElement} modal O modal a ser fechado.
   */
  function closeModal(modal) {
    if (!modal) {
      console.error('Modal inválido!');
      return;
    }

    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('show');
    document.body.style.overflow = ''; // Restaura o scroll
  }

  /**
   * Atualiza a aparência do botão de toggle.
   */
  function updateToggleButtonUI() {
    const icon = toggleButton.querySelector('i');
    if (isProjectModeActive) {
      toggleButton.classList.add('active');
      if (icon) {
        icon.classList.remove('continuous-spin');
        setTimeout(() => icon.classList.add('continuous-spin'), 10);
      }
    } else {
      toggleButton.classList.remove('active');
      if (icon) {
        icon.classList.remove('continuous-spin');
      }
    }
  }

  // === Manipuladores de eventos ===

  /**
   * Alterna entre os modos Projeto e Processador.
   */
  function toggleMode() {
    isProjectModeActive = !isProjectModeActive;
    localStorage.setItem('uiToggleState', isProjectModeActive ? 'project' : 'processor');
    updateToggleButtonUI();
  }

  /**
   * Abre o modal correto com base no estado atual.
   */
  function handleSettingsClick(event) {
    event.preventDefault(); // Evita o comportamento padrão do link
    if (isProjectModeActive) {
      openModal(projectModal);
    } else {
      openModal(processorModal);
    }
  }

  // === Inicialização ===
  function init() {
    // Garante que os elementos essenciais existam
    if (!toggleButton || !settingsButton || !projectModal || !processorModal) {
      console.error('Um ou mais elementos essenciais não foram encontrados.');
      return;
    }

    // Garante que o botão settings esteja habilitado
    settingsButton.disabled = false;

    // Restaura o estado do toggle do localStorage
    const savedState = localStorage.getItem('uiToggleState');
    isProjectModeActive = savedState === 'project';
    updateToggleButtonUI();

    // Adiciona os listeners de eventos
    toggleButton.addEventListener('click', toggleMode);
    settingsButton.addEventListener('click', handleSettingsClick);

    // Adiciona os listeners para fechar os modais
    projectModal.querySelector('.modal-close-btn')?.addEventListener('click', () => closeModal(projectModal));
    processorModal.querySelector('.modal-close-btn')?.addEventListener('click', () => closeModal(processorModal));

    // Tecla ESC para fechar modais
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (projectModal.classList.contains('show')) closeModal(projectModal);
        if (processorModal.classList.contains('show')) closeModal(processorModal);
      }
    });

    // Inicia as animações
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #toggle-ui.active i { color: #da70d6; }
      .continuous-spin { animation: counter-clockwise-spin 2s linear infinite !important; }
      @keyframes counter-clockwise-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(-360deg); }
      }
    `;
    document.head.appendChild(styleElement);
  }

  // Inicia o script
  init();
});