document.addEventListener('DOMContentLoaded', () => {
  // Elements to be controlled
  const TOGGLE_BUTTON_ID = 'toggle-ui';
  const HIDE_ELEMENTS = {
    buttons: ['cmmcomp'],
    tabs: ['tcmm', 'tasm']
  };
  
  const ANIMATION_DURATION = 300;
  let elementsVisible = true;
  
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);

  // Toggle UI button is optional (não está mais na toolbar v3).
  // Sai silenciosamente se ele não existir — sem poluir o console.
  if (!toggleButton) return;
  
  function init() {
    const savedState = localStorage.getItem('uiToggleState');
    if (savedState === 'hidden') {
      elementsVisible = false;
      HIDE_ELEMENTS.buttons.forEach(_id => {
        /*
        const element = document.getElementById(id);
        if (element) {
          element.classList.add('ui-element-hidden');
          element.style.display = 'none';
        } */
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

    toggleButton.addEventListener('click', toggleElementsVisibility);

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