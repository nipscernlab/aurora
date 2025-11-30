// =====================================================================================
// Zoom Control System - Browser Environment Script
// Simple zoom controls with buttons and keyboard shortcuts
// =====================================================================================

// Inject CSS styles for zoom control UI
const zoomStyles = document.createElement('style');
zoomStyles.textContent = `
  /* Zoom Control Styles - Using theme variables */
  .zoom-control-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .zoom-icon-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
  }

  .zoom-icon-btn:hover {
    color: var(--accent-primary);
    background: var(--overlay-hover);
  }

  .zoom-icon-btn:active {
    background: var(--overlay-active);
  }

  .zoom-buttons-container {
    position: fixed;
    bottom: 40px;
    right: 20px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    padding: 8px;
    box-shadow: var(--shadow-xl);
    display: none;
    align-items: center;
    justify-content: center;
    gap: 8px;
    z-index: 9999;
    backdrop-filter: blur(10px);
    transform: scale(1);
    transform-origin: bottom right;
  }

  body[style*="zoom"] .zoom-buttons-container,
  html[style*="zoom"] .zoom-buttons-container {
    transform: scale(1) !important;
  }

  .zoom-buttons-container.active {
    display: flex;
    animation: fadeIn var(--transition-normal) ease-out;
  }

  .zoom-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    transition: all var(--transition-fast);
    flex-shrink: 0;
  }

  .zoom-btn:hover {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }

  .zoom-btn:active {
    transform: scale(0.95);
  }

  .zoom-btn.reset-btn {
    width: auto;
    padding: 0 12px;
    font-size: 11px;
    font-weight: var(--font-medium);
  }

  .zoom-divider {
    width: 1px;
    height: 24px;
    background: var(--border-primary);
  }

  /* Animation keyframe */
  @keyframes fadeIn {
    from { 
      opacity: 0; 
      transform: translateY(10px);
    }
    to { 
      opacity: 1; 
      transform: translateY(0);
    }
  }
`;
document.head.appendChild(zoomStyles);

// =====================================================================================
// Zoom Control Manager
// =====================================================================================
class ZoomControlManager {
  constructor() {
    this.currentZoom = 1.0;
    this.minZoom = 0.5; // 50%
    this.maxZoom = 2.0; // 200%
    this.isMenuOpen = false;
    
    this.init();
  }

  init() {
    this.createZoomControl();
    this.setupKeyboardShortcuts();
    this.setupClickOutside();
  }

  createZoomControl() {
    // Find the editor status element
    const editorStatus = document.getElementById('editorStatus');
    
    if (!editorStatus) {
      console.error('Editor status element not found');
      return;
    }

    // Create zoom control wrapper as a status item
    const zoomWrapper = document.createElement('div');
    zoomWrapper.className = 'status-item zoom-control-wrapper';
    zoomWrapper.id = 'zoomControl';

    // Create zoom icon button
    const zoomIconBtn = document.createElement('button');
    zoomIconBtn.className = 'zoom-icon-btn';
    zoomIconBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    zoomIconBtn.setAttribute('aria-label', 'Zoom control');
    zoomIconBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    // Create buttons container (will be appended to body for proper z-index)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'zoom-buttons-container';
    buttonsContainer.id = 'zoomButtonsContainer';
    buttonsContainer.innerHTML = `
      <button class="zoom-btn" data-action="decrease" aria-label="Decrease zoom">
        <i class="fa-solid fa-minus"></i>
      </button>
      <button class="zoom-btn reset-btn" data-action="reset" aria-label="Reset zoom">
        <i class="fa-solid fa-rotate-left"></i> Reset
      </button>
      <button class="zoom-btn" data-action="increase" aria-label="Increase zoom">
        <i class="fa-solid fa-plus"></i>
      </button>
    `;

    // Append zoom button to wrapper
    zoomWrapper.appendChild(zoomIconBtn);
    
    // Insert zoom control after editor status
    editorStatus.parentNode.insertBefore(zoomWrapper, editorStatus.nextSibling);
    
    // Append buttons container to body for proper z-index stacking
    document.body.appendChild(buttonsContainer);

    // Setup button event listeners
    this.setupButtonEvents(buttonsContainer);
  }

  setupButtonEvents(container) {
    const decreaseBtn = container.querySelector('[data-action="decrease"]');
    const increaseBtn = container.querySelector('[data-action="increase"]');
    const resetBtn = container.querySelector('[data-action="reset"]');

    // Decrease button
    decreaseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomOut();
    });

    // Increase button
    increaseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomIn();
    });

    // Reset button
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomReset();
    });

    // Prevent clicks inside container from closing it
    container.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  toggleMenu() {
    const container = document.getElementById('zoomButtonsContainer');
    this.isMenuOpen = !this.isMenuOpen;
    
    if (this.isMenuOpen) {
      container.classList.add('active');
      this.maintainMenuSize();
    } else {
      container.classList.remove('active');
    }
  }

  setupClickOutside() {
    document.addEventListener('click', (e) => {
      const zoomWrapper = document.getElementById('zoomControl');
      const buttonsContainer = document.getElementById('zoomButtonsContainer');
      
      if (this.isMenuOpen && 
          zoomWrapper && 
          !zoomWrapper.contains(e.target) && 
          buttonsContainer && 
          !buttonsContainer.contains(e.target)) {
        this.toggleMenu();
      }
    });
  }

  maintainMenuSize() {
    const container = document.getElementById('zoomButtonsContainer');
    if (container && this.currentZoom !== 1.0) {
      const inverseZoom = 1 / this.currentZoom;
      container.style.transform = `scale(${inverseZoom})`;
    } else if (container) {
      container.style.transform = 'scale(1)';
    }
  }

  zoomIn() {
    this.currentZoom = Math.min(this.maxZoom, this.currentZoom + 0.1);
    if (window.electronAPI && window.electronAPI.zoomIn) {
      window.electronAPI.zoomIn();
    }
    this.maintainMenuSize();
  }

  zoomOut() {
    this.currentZoom = Math.max(this.minZoom, this.currentZoom - 0.1);
    if (window.electronAPI && window.electronAPI.zoomOut) {
      window.electronAPI.zoomOut();
    }
    this.maintainMenuSize();
  }

  zoomReset() {
    this.currentZoom = 1.0;
    if (window.electronAPI && window.electronAPI.zoomReset) {
      window.electronAPI.zoomReset();
    }
    this.maintainMenuSize();
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      // Check if Ctrl (Windows/Linux) or Command (macOS) is pressed
      if (event.ctrlKey || event.metaKey) {
        let handled = false;

        switch (event.key) {
          case '+':
          case '=': // '+' usually requires Shift, so we catch '=' as well
            this.zoomIn();
            handled = true;
            break;

          case '-':
            this.zoomOut();
            handled = true;
            break;

          case '0':
            this.zoomReset();
            handled = true;
            break;
        }

        // Prevent browser's default action for these shortcuts
        if (handled) {
          event.preventDefault();
        }
      }
    });
  }
}

// =====================================================================================
// Initialize zoom control when DOM is ready
// =====================================================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ZoomControlManager();
  });
} else {
  new ZoomControlManager();
}


