// toggle-ui.js - Implementation with improved animations
document.addEventListener('DOMContentLoaded', () => {
  // Elements to be controlled
  const TOGGLE_BUTTON_ID = 'toggle-ui';
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
  
  // Reference to the toggle button
  const toggleButton = document.getElementById(TOGGLE_BUTTON_ID);
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
      
      updateToggleButtonUI();
    }
    
    // Set up events
    toggleButton.addEventListener('click', toggleElementsVisibility);
    
    // Mouse hover animation
    toggleButton.addEventListener('mouseenter', () => {
      const icon = toggleButton.querySelector('i');
      if (icon && !elementsVisible) {
        // If already in continuous rotation, don't apply hover effect
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
    
    // Keyboard shortcut (Ctrl+R)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        toggleElementsVisibility();
      }
    });
    
    // Tooltip
    toggleButton.setAttribute('title', 'Toggle UI elements (Ctrl+R)');
    
    console.log('UI control system initialized');
  }
  
  // Toggle visibility of elements
  function toggleElementsVisibility() {
    elementsVisible = !elementsVisible;
    
    // Update visibility of elements
    updateElementsVisibility();
    
    // Update toggle button appearance
    updateToggleButtonUI();
    
    // Save state to localStorage
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
          element.style.display = 'flex'; // Or the original display of the element
          element.classList.remove('ui-element-hidden');
          element.classList.add('ui-element-show');
          element.classList.remove('ui-element-hide');
          
          // Restore interactivity after animation
          setTimeout(() => {
            element.style.pointerEvents = 'auto';
          }, ANIMATION_DURATION);
        } else {
          // Hide element with animation
          element.classList.add('ui-element-hide');
          element.classList.remove('ui-element-show');
          element.style.pointerEvents = 'none'; // Prevent clicks during animation
          
          // Complete hiding after animation
          setTimeout(() => {
            if (!elementsVisible) { // Check if we should still hide
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
          // Show tab with animation
          tab.style.display = 'flex'; // Or the original display of the element
          tab.classList.remove('ui-element-hidden');
          tab.classList.add('ui-element-show');
          tab.classList.remove('ui-element-hide');
          
          // Restore interactivity after animation
          setTimeout(() => {
            tab.style.pointerEvents = 'auto';
          }, ANIMATION_DURATION);
        } else {
          // Hide tab with animation
          tab.classList.add('ui-element-hide');
          tab.classList.remove('ui-element-show');
          tab.style.pointerEvents = 'none'; // Prevent clicks during animation
          
          // Complete hiding after animation
          setTimeout(() => {
            if (!elementsVisible) { // Check if we should still hide
              tab.classList.add('ui-element-hidden');
              tab.style.display = 'none';
            }
          }, ANIMATION_DURATION);
        }
      }
    });
  }
  
  // Update toggle button appearance
  function updateToggleButtonUI() {
    const icon = toggleButton.querySelector('i');
    
    if (elementsVisible) {
      // Normal state
      toggleButton.classList.remove('active');
      if (icon) {
        // Fixed: Properly remove the continuous spin class
        icon.classList.remove('continuous-spin');
        // Clear any inline styles
        icon.style.animation = '';
      }
    } else {
      // Active state
      toggleButton.classList.add('active');
      if (icon) {
        // Fixed: Force remove and add the class to ensure the animation restarts
        icon.classList.remove('continuous-spin');
        // Use setTimeout to ensure the browser recognizes the class change
        setTimeout(() => {
          icon.classList.add('continuous-spin');
        }, 10);
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
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(-360deg);
      }
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