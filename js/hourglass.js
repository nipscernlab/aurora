// Enhanced rotate-button.js
document.addEventListener('DOMContentLoaded', () => {
    const toggleButton = document.getElementById('toggle-ui');
    let isActive = false;
    
    // Function to set button state visually
    function setButtonState(active) {
      isActive = active;
      
      if (active) {
        toggleButton.classList.add('active');
        // Store state in localStorage to persist between sessions
        localStorage.setItem('rotateButtonState', 'active');
        
        // Apply starting animation with easing
        toggleButton.querySelector('i').style.animationName = 'none';
        // Force reflow
        void toggleButton.querySelector('i').offsetWidth;
        toggleButton.querySelector('i').style.animationName = 'spin';
      } else {
        // For smooth stopping of rotation
        const currentRotation = getComputedStyle(toggleButton.querySelector('i')).transform;
        toggleButton.querySelector('i').style.animationName = 'none';
        toggleButton.querySelector('i').style.transform = currentRotation;
        
        // Force reflow then reset
        void toggleButton.querySelector('i').offsetWidth;
        toggleButton.querySelector('i').style.transform = '';
        
        toggleButton.classList.remove('active');
        // Remove from localStorage when inactive
        localStorage.removeItem('rotateButtonState');
      }
    }
    
    // Function to toggle the state
    function toggleButtonState() {
      setButtonState(!isActive);
    }
    
    // Check initial state from localStorage (when opening the IDE)
    function initializeButtonState() {
      const savedState = localStorage.getItem('rotateButtonState');
      // If there's a saved active state, restore it
      if (savedState === 'active') {
        setButtonState(true);
      } else {
        setButtonState(false); // Ensure initial state is inactive if no saved data
      }
    }
    
    // Initialize state on load
    initializeButtonState();
    
    // Add click event
    toggleButton.addEventListener('click', toggleButtonState);
    
    // Ensure state is saved when closing the window/IDE
    window.addEventListener('beforeunload', () => {
      if (isActive) {
        localStorage.setItem('rotateButtonState', 'active');
      } else {
        localStorage.removeItem('rotateButtonState');
      }
    });
    
    // Optional: Add keyboard shortcut (Ctrl/Cmd + R)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault(); // Prevent browser refresh
        toggleButtonState();
      }
    });
    
    // Optional: Add tooltip functionality
    toggleButton.setAttribute('title', 'Toggle UI Mode (Ctrl+R)');
    toggleButton.addEventListener('mouseenter', () => {
      toggleButton.classList.add('tooltip-visible');
    });
    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.classList.remove('tooltip-visible');
    });
  });