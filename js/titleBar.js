// js/titleBar.js
// Enhanced TitleBar JavaScript with Windows-like behavior

class TitleBarController {
  // Add this to the end of your titleBar.js constructor:
    constructor() {
    this.isMaximized = false;
    this.isAnimating = false;
    this.isDragging = false;
    this.restorePosition = null;
    this.restoreSize = null;
    
    // Add this timeout to ensure proper initialization
    setTimeout(() => {
        this.init();
    }, 100);
    }
  
  init() {
    this.setupEventListeners();
    this.setupWindowStateListeners();
    this.setupKeyboardShortcuts();
    this.setupDragHandling();
    this.addWindowContainer();
  }

  addWindowContainer() {
    // Wrap content in window container for proper styling
    const body = document.body;
    const container = document.createElement('div');
    container.className = 'window-container';
    
    // Move all existing content to container
    while (body.firstChild) {
      container.appendChild(body.firstChild);
    }
    
    body.appendChild(container);
  }

  setupEventListeners() {
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const restoreBtn = document.getElementById('restore-btn');
    const closeBtn = document.getElementById('close-btn');

    // Button click handlers
    minimizeBtn?.addEventListener('click', (e) => this.handleMinimize(e));
    maximizeBtn?.addEventListener('click', (e) => this.handleMaximize(e));
    restoreBtn?.addEventListener('click', (e) => this.handleRestore(e));
    closeBtn?.addEventListener('click', (e) => this.handleClose(e));

    // Double-click to maximize/restore
    const dragRegion = document.getElementById('title-bar-drag-region');
    dragRegion?.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

    // Enhanced hover effects
    this.setupHoverEffects();
  }

  setupDragHandling() {
    const dragRegion = document.getElementById('title-bar-drag-region');
    if (!dragRegion) return;

    let startX, startY;
    let isDragging = false;

    dragRegion.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click
      
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e) => {
      const deltaX = Math.abs(e.clientX - startX);
      const deltaY = Math.abs(e.clientY - startY);
      
      if (!isDragging && (deltaX > 5 || deltaY > 5)) {
        isDragging = true;
        this.startDrag();
      }
      
      if (isDragging && this.isMaximized) {
        // Restore window when dragging from maximized state
        this.restoreFromDrag(e);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      if (isDragging) {
        this.endDrag();
      }
      
      isDragging = false;
    };
  }

  startDrag() {
    document.body.classList.add('window-dragging');
  }

  endDrag() {
    document.body.classList.remove('window-dragging');
  }

  // Replace the restoreFromDrag method with this corrected version:
async restoreFromDrag(e) {
  if (this.isAnimating) return;
  
  this.isAnimating = true;
  
  try {
    // Get current window state
    const currentState = await window.electronAPI.getWindowState();
    if (!currentState) return;
    
    // Calculate new position
    const mouseX = e.screenX;
    const mouseY = e.screenY;
    
    // Use screen dimensions for proper sizing
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    
    const newWidth = Math.floor(screenWidth * 0.8);
    const newHeight = Math.floor(screenHeight * 0.8);
    
    const newX = Math.max(0, mouseX - (newWidth / 2));
    const newY = Math.max(0, mouseY - 16);
    
    // First set bounds, then toggle maximize state
    window.electronAPI.setWindowBounds({
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    });
    
    // Small delay to ensure bounds are set before toggling maximize
    setTimeout(() => {
      window.electronAPI.maximizeRestoreWindow();
    }, 50);
    
  } catch (error) {
    console.error('Error in restoreFromDrag:', error);
  } finally {
    setTimeout(() => {
      this.isAnimating = false;
    }, 300);
  }
}

  setupWindowStateListeners() {
    window.electronAPI?.onWindowMaximized(() => {
      this.handleWindowMaximized();
    });

    window.electronAPI?.onWindowRestored(() => {
      this.handleWindowRestored();
    });

    window.electronAPI?.onWindowBlur(() => {
      document.body.classList.add('window-blur');
    });

    window.electronAPI?.onWindowFocus(() => {
      document.body.classList.remove('window-blur');
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'F4') {
        e.preventDefault();
        this.handleClose();
      }
    });
  }

  handleMinimize(e) {
    if (this.isAnimating) return;
    
    this.animateButtonPress(e.target, () => {
      window.electronAPI?.minimizeWindow();
    });
  }

  handleMaximize(e) {
    if (this.isAnimating) return;
    
    this.animateButtonPress(e.target, () => {
      this.toggleMaximize();
    });
  }

  handleRestore(e) {
    if (this.isAnimating) return;
    
    this.animateButtonPress(e.target, () => {
      this.toggleMaximize();
    });
  }

  // Replace the toggleMaximize method with this corrected version:
async toggleMaximize() {
  if (this.isAnimating) return;
  
  this.isAnimating = true;
  
  try {
    if (!this.isMaximized) {
      // Save current state before maximizing
      const currentState = await window.electronAPI.getWindowState();
      if (currentState && currentState.bounds) {
        this.restorePosition = { x: currentState.bounds.x, y: currentState.bounds.y };
        this.restoreSize = { width: currentState.bounds.width, height: currentState.bounds.height };
      }
    }
    
    // Toggle maximize state
    window.electronAPI.maximizeRestoreWindow();
    
  } catch (error) {
    console.error('Error in toggleMaximize:', error);
  } finally {
    setTimeout(() => {
      this.isAnimating = false;
    }, 300);
  }
}

  handleClose(e) {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    
    // Add closing animation
    document.body.classList.add('window-closing');
    
    this.animateButtonPress(e?.target, () => {
      setTimeout(() => {
        window.electronAPI?.closeWindow();
      }, 250);
    });
  }

  handleDoubleClick(e) {
    if (this.isAnimating) return;
    if (e.target.closest('.title-bar-btn')) return;
    
    this.toggleMaximize();
  }

  handleWindowMaximized() {
    this.isMaximized = true;
    this.updateButtonVisibility();
    this.updateWindowStateClass();
    this.triggerStateTransition();
  }

  handleWindowRestored() {
    this.isMaximized = false;
    this.updateButtonVisibility();
    this.updateWindowStateClass();
    this.triggerStateTransition();
  }

  updateButtonVisibility() {
    const maximizeBtn = document.getElementById('maximize-btn');
    const restoreBtn = document.getElementById('restore-btn');

    if (this.isMaximized) {
      maximizeBtn.style.display = 'none';
      restoreBtn.style.display = 'flex';
    } else {
      maximizeBtn.style.display = 'flex';
      restoreBtn.style.display = 'none';
    }
  }

  updateWindowStateClass() {
    const body = document.body;
    
    if (this.isMaximized) {
      body.classList.add('window-maximized');
      body.classList.remove('window-restored');
    } else {
      body.classList.remove('window-maximized');
      body.classList.add('window-restored');
    }
  }

  triggerStateTransition() {
    const container = document.querySelector('.window-container');
    if (container) {
      container.classList.add('window-state-transition');
      setTimeout(() => {
        container.classList.remove('window-state-transition');
      }, 300);
    }
  }

  animateButtonPress(button, callback) {
    if (!button || this.isAnimating) return;
    
    const wasAnimating = this.isAnimating;
    if (!wasAnimating) this.isAnimating = true;
    
    button.style.transform = 'scale(0.9)';
    button.style.transition = 'transform 0.1s ease-out';
    
    setTimeout(() => {
      button.style.transform = '';
      callback();
      
      if (!wasAnimating) {
        setTimeout(() => {
          this.isAnimating = false;
        }, 100);
      }
    }, 100);
  }

  setupHoverEffects() {
    const buttons = document.querySelectorAll('.title-bar-btn');
    
    buttons.forEach(button => {
      button.addEventListener('mouseenter', () => {
        if (!this.isAnimating) {
          button.style.transform = 'translateY(-0.5px)';
        }
      });
      
      button.addEventListener('mouseleave', () => {
        if (!this.isAnimating) {
          button.style.transform = '';
        }
      });
    });
  }

  setAppTitle(title) {
    let titleElement = document.querySelector('#title-bar-drag-region .app-title');
    if (!titleElement) {
      titleElement = document.createElement('span');
      titleElement.className = 'app-title';
      document.getElementById('title-bar-drag-region')?.appendChild(titleElement);
    }
    titleElement.textContent = title;
  }

  getWindowState() {
    return {
      isMaximized: this.isMaximized,
      isAnimating: this.isAnimating,
      isDragging: this.isDragging
    };
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.titleBarController = new TitleBarController();
  window.titleBarController.setAppTitle('Aurora IDE');
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Enhanced TitleBar initialized successfully');
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TitleBarController;
}