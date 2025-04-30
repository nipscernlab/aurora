// toggle-ui.js - Implementação com animações aprimoradas
document.addEventListener('DOMContentLoaded', () => {
  // Elementos a serem controlados
  const TOGGLE_BUTTON_ID = 'toggle-ui';
  const HIDE_ELEMENTS = {
    // Elementos da toolbar
    buttons: ['cmmcomp', 'asmcomp'],
    // Abas do terminal
    tabs: ['tcmm', 'tasm']
  };
  
  // Duração das animações em milissegundos
  const ANIMATION_DURATION = 300;
  
  // Estado de visibilidade
  let elementsVisible = true;
  
  // Referência para o botão de alternância
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
  if (!toggleButton) {
    console.error('Botão de alternância não encontrado!');
    return;
  }
  
  // Inicialização
  function init() {
    // Restaurar estado do localStorage
    const savedState = localStorage.getItem('uiToggleState');
    if (savedState === 'hidden') {
      elementsVisible = false;
      // Aplicar imediatamente sem animação na inicialização
      HIDE_ELEMENTS.buttons.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          element.classList.add('ui-element-hidden');
          element.style.display = 'none';
        }
      });
      
      HIDE_ELEMENTS.tabs.forEach(tabId => {
        const tab = document.querySelector(`.terminal-tabs .tab[data-terminal="${tabId}"]`);
        if (tab) {
          tab.classList.add('ui-element-hidden');
          tab.style.display = 'none';
        }
      });
      
      updateToggleButtonUI();
    }
    
    // Configurar eventos
    toggleButton.addEventListener('click', toggleElementsVisibility);
    
    // Animação ao passar o mouse
    toggleButton.addEventListener('mouseenter', () => {
      const icon = toggleButton.querySelector('i');
      if (icon && !elementsVisible) {
        // Se já estiver em rotação contínua, não aplicamos hover
        return;
      }
      icon.classList.add('hover-rotate');
    });
    
    toggleButton.addEventListener('mouseleave', () => {
      const icon = toggleButton.querySelector('i');
      if (icon) {
        icon.classList.remove('hover-rotate');
      }
    });
    
    // Atalho de teclado (Ctrl+R)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        toggleElementsVisibility();
      }
    });
    
    // Tooltip
    toggleButton.setAttribute('titles', 'Alternar elementos da UI (Ctrl+R)');
    
    console.log('Sistema de controle de UI inicializado');
  }
  
  // Alterna a visibilidade dos elementos
  function toggleElementsVisibility() {
    elementsVisible = !elementsVisible;
    
    // Atualiza a visibilidade dos elementos
    updateElementsVisibility();
    
    // Atualiza a aparência do botão de alternância
    updateToggleButtonUI();
    
    // Salva o estado no localStorage
    localStorage.setItem('uiToggleState', elementsVisible ? 'visible' : 'hidden');
    
    console.log(`Elementos da UI agora estão ${elementsVisible ? 'visíveis' : 'ocultos'}`);
  }
  
  // Atualiza a visibilidade real dos elementos com animações
  function updateElementsVisibility() {
    // Processa botões da toolbar
    HIDE_ELEMENTS.buttons.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (elementsVisible) {
          // Mostrar elemento com animação
          element.style.display = 'flex'; // Ou o display original do elemento
          element.classList.remove('ui-element-hidden');
          element.classList.add('ui-element-show');
          element.classList.remove('ui-element-hide');
          
          // Restaurar interatividade após a animação
          setTimeout(() => {
            element.style.pointerEvents = 'auto';
          }, ANIMATION_DURATION);
        } else {
          // Esconder elemento com animação
          element.classList.add('ui-element-hide');
          element.classList.remove('ui-element-show');
          element.style.pointerEvents = 'none'; // Impedir cliques durante a animação
          
          // Completar ocultação após a animação
          setTimeout(() => {
            if (!elementsVisible) { // Verificar se ainda devemos ocultar
              element.classList.add('ui-element-hidden');
              element.style.display = 'none';
            }
          }, ANIMATION_DURATION);
        }
      }
    });
    
    // Processa abas do terminal
    HIDE_ELEMENTS.tabs.forEach(tabId => {
      const tab = document.querySelector(`.terminal-tabs .tab[data-terminal="${tabId}"]`);
      if (tab) {
        if (elementsVisible) {
          // Mostrar aba com animação
          tab.style.display = 'flex'; // Ou o display original do elemento
          tab.classList.remove('ui-element-hidden');
          tab.classList.add('ui-element-show');
          tab.classList.remove('ui-element-hide');
          
          // Restaurar interatividade após a animação
          setTimeout(() => {
            tab.style.pointerEvents = 'auto';
          }, ANIMATION_DURATION);
        } else {
          // Esconder aba com animação
          tab.classList.add('ui-element-hide');
          tab.classList.remove('ui-element-show');
          tab.style.pointerEvents = 'none'; // Impedir cliques durante a animação
          
          // Completar ocultação após a animação
          setTimeout(() => {
            if (!elementsVisible) { // Verificar se ainda devemos ocultar
              tab.classList.add('ui-element-hidden');
              tab.style.display = 'none';
            }
          }, ANIMATION_DURATION);
        }
      }
    });
  }
  
  // Atualiza a aparência do botão de alternância
  function updateToggleButtonUI() {
    const icon = toggleButton.querySelector('i');
    
    if (elementsVisible) {
      // Estado normal
      toggleButton.classList.remove('active');
      if (icon) {
        icon.style.animation = 'none';
        icon.classList.remove('continuous-spin');
      }
    } else {
      // Estado ativo
      toggleButton.classList.add('active');
      if (icon) {
        icon.classList.add('continuous-spin');
      }
    }
  }
  
  // Inicializar após um pequeno atraso para garantir que o DOM está completamente carregado
  setTimeout(init, 500);
});