// toggle-ui.js - Implementation with improved animations
// Adds inverse logic for importBtn visibility based on toggle-ui active state

document.addEventListener('DOMContentLoaded', () => {
  // Elements to be controlled
  const TOGGLE_BUTTON_ID = 'toggle-ui';
  const IMPORT_BTN_ID = 'importBtn';
  const HIDE_ELEMENTS = {
    // Toolbar elements
    buttons: ['cmmcomp', 'asmcomp'],
    // Terminal tabs
    tabs: ['tcmm', 'tasm']
  };
  
  // Animation duration in milliseconds
  const ANIMATION_DURATION = 300;
  
  // Visibility state
  let elementsVisible = true;
  
  // References to buttons
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
  const importBtn = document.getElementById(IMPORT_BTN_ID);

  if (!toggleButton) {
    console.error('Toggle button not found!');
    return;
  }
  
  // Initialization
  function init() {
    // Restore state from localStorage
    const savedState = localStorage.getItem('uiToggleState');
    if (savedState === 'hidden') {
      elementsVisible = false;
      // Apply immediately without animation during initialization
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
      // Set importBtn inverse (show when hidden)
      if (importBtn) {
        importBtn.classList.remove('ui-element-hidden');
        importBtn.style.display = 'flex';
      }
      updateToggleButtonUI();
    } else {
      // On visible default state, ensure importBtn is hidden initially
      if (importBtn) {
        importBtn.classList.add('ui-element-hidden');
        importBtn.style.display = 'none';
      }
    }
    
    // Set up events
    toggleButton.addEventListener('click', toggleElementsVisibility);
     toggleButton.addEventListener('click', toggleElementsVisibility);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        toggleElementsVisibility();
      }
    });
    toggleButton.setAttribute('titles', 'Toggle UI elements (Ctrl+R)');
    console.log('UI control system initialized');
  }
  
  // Toggle visibility of elements
  function toggleElementsVisibility() {
    elementsVisible = !elementsVisible;
    updateElementsVisibility();
    updateToggleButtonUI();
    localStorage.setItem('uiToggleState', elementsVisible ? 'visible' : 'hidden');
    console.log(`UI elements are now ${elementsVisible ? 'visible' : 'hidden'}`);
  }
  
  // Update actual visibility of elements with animations
  function updateElementsVisibility() {
    // Process toolbar buttons
    HIDE_ELEMENTS.buttons.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (elementsVisible) {
          // Show element with animation
          element.style.display = 'flex';
          element.classList.remove('ui-element-hidden');
          element.classList.add('ui-element-show');
          element.classList.remove('ui-element-hide');
          setTimeout(() => { element.style.pointerEvents = 'auto'; }, ANIMATION_DURATION);
        } else {
          // Hide element with animation
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
    
    // Process terminal tabs
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
    
    // Inverse logic for importBtn with same animation
    if (importBtn) {
      if (elementsVisible) {
        // hide importBtn
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
        // show importBtn
        importBtn.style.display = 'flex';
        importBtn.classList.remove('ui-element-hidden');
        importBtn.classList.add('ui-element-show');
        importBtn.classList.remove('ui-element-hide');
        setTimeout(() => { importBtn.style.pointerEvents = 'auto'; }, ANIMATION_DURATION);
      }
    }
  }
  
  // Update toggle button appearance
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
  
  // Add CSS for counter-clockwise rotation
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
  
  // Initialize after a small delay to ensure the DOM is fully loaded
  setTimeout(init, 500);
});
