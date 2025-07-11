// js/titleBar.js
// Enhanced TitleBar JavaScript with Windows-like behavior and smooth animations

class TitleBarController {
  constructor() {
    this.isMaximized = false;
    this.isAnimating = false;
    this.isDragging = false;
    this.restorePosition = null;
    this.restoreSize = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragThreshold = 5;
    
    // Initialize after DOM is ready
    setTimeout(() => {
      this.init();
    }, 100);
  }
  
  init() {
    this.addWindowContainer();
    this.setupEventListeners();
    this.setupWindowStateListeners();
    this.setupKeyboardShortcuts();
    this.setupDragHandling();
    this.setupResizeHandles();
    this.checkInitialWindowState();
  }

  addWindowContainer() {
    // Create window container with proper rounded corners
    const body = document.body;
    const existingContainer = document.querySelector('.window-container');
    
    if (!existingContainer) {
      const container = document.createElement('div');
      container.className = 'window-container';
      
      // Move all existing content to container
      while (body.firstChild) {
        container.appendChild(body.firstChild);
      }
      
      body.appendChild(container);
    }
  }

  setupEventListeners() {
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const restoreBtn = document.getElementById('restore-btn');
    const closeBtn = document.getElementById('close-btn');

    // Button click handlers with enhanced feedback
    minimizeBtn?.addEventListener('click', (e) => this.handleMinimize(e));
    maximizeBtn?.addEventListener('click', (e) => this.handleMaximize(e));
    restoreBtn?.addEventListener('click', (e) => this.handleRestore(e));
    closeBtn?.addEventListener('click', (e) => this.handleClose(e));

    // Double-click to maximize/restore
    const dragRegion = document.getElementById('title-bar-drag-region');
    dragRegion?.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

    // Enhanced hover effects
    this.setupHoverEffects();
    
    // Prevent context menu on title bar
    dragRegion?.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setupDragHandling() {
    const dragRegion = document.getElementById('title-bar-drag-region');
    if (!dragRegion) return;

    let startX, startY, startWindowX, startWindowY;
    let isDragging = false;
    let dragStarted = false;

    dragRegion.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click
      
      startX = e.screenX;
      startY = e.screenY;
      isDragging = false;
      dragStarted = true;
      
      // Get initial window position
      this.getWindowPosition().then(pos => {
        startWindowX = pos.x;
        startWindowY = pos.y;
      });
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      // Prevent text selection
      e.preventDefault();
    });

    const onMouseMove = (e) => {
      if (!dragStarted) return;
      
      const deltaX = Math.abs(e.screenX - startX);
      const deltaY = Math.abs(e.screenY - startY);
      
      if (!isDragging && (deltaX > this.dragThreshold || deltaY > this.dragThreshold)) {
        isDragging = true;
        this.startDrag();
        
        // If maximized, restore window at cursor position
        if (this.isMaximized) {
          this.restoreFromDrag(e);
        }
      }
      
      if (isDragging && !this.isMaximized) {
        // Calculate new position
        const newX = startWindowX + (e.screenX - startX);
        const newY = startWindowY + (e.screenY - startY);
        
        // Move window smoothly
        this.moveWindow(newX, newY);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      if (isDragging) {
        this.endDrag();
      }
      
      isDragging = false;
      dragStarted = false;
    };
  }

  setupResizeHandles() {
    // Add resize handles for custom window resizing
    const container = document.querySelector('.window-container');
    if (!container) return;

    const handles = [
      'top', 'bottom', 'left', 'right',
      'top-left', 'top-right', 'bottom-left', 'bottom-right'
    ];

    handles.forEach(handle => {
      const element = document.createElement('div');
      element.className = `resize-handle ${handle}`;
      element.addEventListener('mousedown', (e) => this.startResize(e, handle));
      container.appendChild(element);
    });
  }

  startResize(e, direction) {
    if (this.isMaximized) return;
    
    e.preventDefault();
    
    const startX = e.screenX;
    const startY = e.screenY;
    
    this.getWindowState().then(state => {
      const startBounds = state.bounds;
      
      const onMouseMove = (e) => {
        const deltaX = e.screenX - startX;
        const deltaY = e.screenY - startY;
        
        const newBounds = this.calculateNewBounds(startBounds, deltaX, deltaY, direction);
        this.setWindowBounds(newBounds);
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  calculateNewBounds(startBounds, deltaX, deltaY, direction) {
    const newBounds = { ...startBounds };
    const minWidth = 400;
    const minHeight = 300;
    
    switch (direction) {
      case 'top':
        newBounds.height = Math.max(minHeight, startBounds.height - deltaY);
        newBounds.y = startBounds.y + (startBounds.height - newBounds.height);
        break;
      case 'bottom':
        newBounds.height = Math.max(minHeight, startBounds.height + deltaY);
        break;
      case 'left':
        newBounds.width = Math.max(minWidth, startBounds.width - deltaX);
        newBounds.x = startBounds.x + (startBounds.width - newBounds.width);
        break;
      case 'right':
        newBounds.width = Math.max(minWidth, startBounds.width + deltaX);
        break;
      case 'top-left':
        newBounds.width = Math.max(minWidth, startBounds.width - deltaX);
        newBounds.height = Math.max(minHeight, startBounds.height - deltaY);
        newBounds.x = startBounds.x + (startBounds.width - newBounds.width);
        newBounds.y = startBounds.y + (startBounds.height - newBounds.height);
        break;
      case 'top-right':
        newBounds.width = Math.max(minWidth, startBounds.width + deltaX);
        newBounds.height = Math.max(minHeight, startBounds.height - deltaY);
        newBounds.y = startBounds.y + (startBounds.height - newBounds.height);
        break;
      case 'bottom-left':
        newBounds.width = Math.max(minWidth, startBounds.width - deltaX);
        newBounds.height = Math.max(minHeight, startBounds.height + deltaY);
        newBounds.x = startBounds.x + (startBounds.width - newBounds.width);
        break;
      case 'bottom-right':
        newBounds.width = Math.max(minWidth, startBounds.width + deltaX);
        newBounds.height = Math.max(minHeight, startBounds.height + deltaY);
        break;
    }
    
    return newBounds;
  }

  async restoreFromDrag(e) {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    
    try {
      // Calculate proportional position based on mouse
      const mouseX = e.screenX;
      const mouseY = e.screenY;
      
      // Use stored restore size or calculate default
      const newWidth = this.restoreSize?.width || 1000;
      const newHeight = this.restoreSize?.height || 700;
      
      // Position window so cursor is at same relative position
      const relativeX = mouseX - (newWidth / 2);
      const relativeY = mouseY - 16; // Account for title bar height
      
      // Ensure window stays on screen
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;
      
      const newX = Math.max(0, Math.min(relativeX, screenWidth - newWidth));
      const newY = Math.max(0, Math.min(relativeY, screenHeight - newHeight));
      
      // Set new bounds
      await this.setWindowBounds({
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight
      });
      
      // Toggle maximize state
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

  startDrag() {
    this.isDragging = true;
    document.body.classList.add('window-dragging');
  }

  endDrag() {
    this.isDragging = false;
    document.body.classList.remove('window-dragging');
  }

  async moveWindow(x, y) {
    const currentState = await this.getWindowState();
    if (currentState && currentState.bounds) {
      this.setWindowBounds({
        x: x,
        y: y,
        width: currentState.bounds.width,
        height: currentState.bounds.height
      });
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

    window.electronAPI?.onWindowMoved(() => {
      // Handle window moved events if needed
    });

    window.electronAPI?.onWindowResized(() => {
      // Handle window resized events if needed
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Alt + F4 to close
      if (e.altKey && e.key === 'F4') {
        e.preventDefault();
        this.handleClose();
      }
      
      // F11 for fullscreen toggle
      if (e.key === 'F11') {
        e.preventDefault();
        this.toggleMaximize();
      }
    });
  }

  async checkInitialWindowState() {
    try {
      const state = await this.getWindowState();
      if (state) {
        this.isMaximized = state.isMaximized;
        this.updateButtonVisibility();
        this.updateWindowStateClass();
      }
    } catch (error) {
      console.error('Error checking initial window state:', error);
    }
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

  async toggleMaximize() {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    
    try {
      if (!this.isMaximized) {
        // Save current state before maximizing
        const currentState = await this.getWindowState();
        if (currentState && currentState.bounds) {
          this.restorePosition = { x: currentState.bounds.x, y: currentState.bounds.y };
          this.restoreSize = { width: currentState.bounds.width, height: currentState.bounds.height };
        }
      }
      
      // Trigger maximize/restore
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
      }, 200);
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
    if (!button) return;
    
    button.style.transform = 'scale(0.9)';
    button.style.transition = 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1)';
    
    setTimeout(() => {
      button.style.transform = '';
      if (callback) callback();
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

  // Helper methods for window operations
  async getWindowState() {
    return await window.electronAPI.getWindowState();
  }

  async getWindowPosition() {
    const state = await this.getWindowState();
    return state ? { x: state.bounds.x, y: state.bounds.y } : { x: 0, y: 0 };
  }

  setWindowBounds(bounds) {
    window.electronAPI.setWindowBounds(bounds);
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

  getControllerState() {
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

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TitleBarController;
}