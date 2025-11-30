document.addEventListener('DOMContentLoaded', () => {
  // Elements to be controlled
  const TOGGLE_BUTTON_ID = 'toggle-ui';
  const SETTINGS_BUTTON_ID = 'settings'; // Adicionado
  const IMPORT_BTN_ID = 'importBtn';
  const HIDE_ELEMENTS = {
    buttons: ['cmmcomp', 'asmcomp'],
    tabs: ['tcmm', 'tasm']
  };
  
  const ANIMATION_DURATION = 300;
  let elementsVisible = true;
  
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
  const settingsButton = document.getElementById(SETTINGS_BUTTON_ID); // Adicionado
  const importBtn = document.getElementById(IMPORT_BTN_ID);

  if (!toggleButton) {
    console.error('Toggle button not found!');
    return;
  }
  
  function init() {
    const savedState = localStorage.getItem('uiToggleState');
    if (savedState === 'hidden') {
      elementsVisible = false;
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
      if (importBtn) {
        importBtn.classList.remove('ui-element-hidden');
        importBtn.style.display = 'flex';
      }
      updateToggleButtonUI();
    } else {
      if (importBtn) {
        importBtn.classList.add('ui-element-hidden');
        importBtn.style.display = 'none';
      }
    }
    
    toggleButton.addEventListener('click', toggleElementsVisibility);
    
    // --- NOVA LÓGICA PARA O BOTÃO SETTINGS ---
    if (settingsButton) {
    settingsButton.addEventListener('click', () => {
        const processorMode = document.getElementById('Processor Mode');
        const projectMode = document.getElementById('Project Mode');
        
        if (processorMode?.checked) {
            // Open Processor Configuration Modal
            const processorModal = document.getElementById('modalProcessorConfig');
            if (processorModal) {
                processorModal.setAttribute('aria-hidden', 'false');
                processorModal.classList.add('show');
                document.body.style.overflow = 'hidden';
            } else {
                console.error('Processor config modal not found');
            }
        } else if (projectMode?.checked) {
            // Open Project Configuration Modal
            const projectModal = document.getElementById('modalProjectConfig');
            if (projectModal) {
                projectModal.setAttribute('aria-hidden', 'false');
                projectModal.classList.add('show');
                document.body.style.overflow = 'hidden';
            } else {
                console.error('Project config modal not found');
            }
        }
        // Verilog Mode: button is disabled, no action needed
    });
    }
    // --- FIM DA NOVA LÓGICA ---
    
    toggleButton.addEventListener('mouseenter', () => {
      const icon = toggleButton.querySelector('i');
      if (icon && !elementsVisible) return;
      icon?.classList.add('hover-rotate');
    });
    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.querySelector('i')?.classList.remove('hover-rotate');
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        toggleElementsVisibility();
      }
    });
    toggleButton.setAttribute('titles', 'Toggle UI elements (Ctrl+R)');
    console.log('UI control system initialized');
  }
  
  function toggleElementsVisibility() {
    elementsVisible = !elementsVisible;
    updateElementsVisibility();
    updateToggleButtonUI();
    localStorage.setItem('uiToggleState', elementsVisible ? 'visible' : 'hidden');
    console.log(`UI elements are now ${elementsVisible ? 'visible' : 'hidden'}`);
  }

  // openProcessorModal is defined but not used in current code
  // function openProcessorModal() {
  //   const modal = document.getElementById('modalProcessorConfig');
  //   if (modal) {
  //       modal.setAttribute('aria-hidden', 'false');
  //       modal.classList.add('show');
  //       document.body.style.overflow = 'hidden';
  //   }
  // }  
  function updateElementsVisibility() {
    HIDE_ELEMENTS.buttons.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (elementsVisible) {
          element.style.display = 'flex';
          element.classList.remove('ui-element-hidden');
          element.classList.add('ui-element-show');
          element.classList.remove('ui-element-hide');
          setTimeout(() => { element.style.pointerEvents = 'auto'; }, ANIMATION_DURATION);
        } else {
          element.classList.add('ui-element-hide');
          element.classList.remove('ui-element-show');
          element.style.pointerEvents = 'none';
          setTimeout(() => {
            if (!elementsVisible) {
              element.classList.add('ui-element-hidden');
              element.style.display = 'none';
            }
          }, ANIMATION_DURATION);
        }
      }
    });
    
    HIDE_ELEMENTS.tabs.forEach(tabId => {
      const tab = document.querySelector(`.terminal-tabs .tab[data-terminal="${tabId}"]`);
      if (tab) {
        if (elementsVisible) {
          tab.style.display = 'flex';
          tab.classList.remove('ui-element-hidden');
          tab.classList.add('ui-element-show');
          tab.classList.remove('ui-element-hide');
          setTimeout(() => { tab.style.pointerEvents = 'auto'; }, ANIMATION_DURATION);
        } else {
          tab.classList.add('ui-element-hide');
          tab.classList.remove('ui-element-show');
          tab.style.pointerEvents = 'none';
          setTimeout(() => {
            if (!elementsVisible) {
              tab.classList.add('ui-element-hidden');
              tab.style.display = 'none';
            }
          }, ANIMATION_DURATION);
        }
      }
    });
    
    if (importBtn) {
      if (elementsVisible) {
        importBtn.classList.add('ui-element-hide');
        importBtn.classList.remove('ui-element-show');
        importBtn.style.pointerEvents = 'none';
        setTimeout(() => {
          if (elementsVisible) {
            importBtn.classList.add('ui-element-hidden');
            importBtn.style.display = 'none';
          }
        }, ANIMATION_DURATION);
      } else {
        importBtn.style.display = 'flex';
        importBtn.classList.remove('ui-element-hidden');
        importBtn.classList.add('ui-element-show');
        importBtn.classList.remove('ui-element-hide');
        setTimeout(() => { importBtn.style.pointerEvents = 'auto'; }, ANIMATION_DURATION);
      }
    }
  }
  
  function updateToggleButtonUI() {
    const icon = toggleButton.querySelector('i');
    if (elementsVisible) {
      toggleButton.classList.remove('active');
      if (icon) {
        icon.classList.remove('continuous-spin');
        icon.style.animation = '';
      }
    } else {
      toggleButton.classList.add('active');
      if (icon) {
        icon.classList.remove('continuous-spin');
        setTimeout(() => { icon.classList.add('continuous-spin'); }, 10);
      }
    }
  }
  
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    .continuous-spin {
      animation: counter-clockwise-spin 2s linear infinite !important;
    }
    @keyframes counter-clockwise-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(-360deg); }
    }
    .hover-rotate {
      transition: transform 0.3s ease;
      transform: rotate(-15deg);
    }
  `;
  document.head.appendChild(styleElement);
  
  setTimeout(init, 500);
});