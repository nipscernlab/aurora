// statusUpdater.js - Manages compilation status in the status bar

class StatusUpdater {
    constructor() {
      this.statusItem = document.querySelector('.status-item:nth-child(2)'); // Place Holder element
      this.defaultStatus = '';
      this.isCompiling = false;
      
      // Initialize - make sure placeholder is empty
      if (this.statusItem) {
        this.setDefaultStatus();
      }
    }
    
    // Set the status item back to default
    setDefaultStatus() {
      this.statusItem.innerHTML = this.defaultStatus;
      this.statusItem.className = 'status-item';
      this.isCompiling = false;
    }
    
    // Show that compilation has started
    startCompilation(type) {
      if (!this.statusItem) return;
      
      let compilationName = '';
      switch(type) {
        case 'cmm':
          compilationName = 'CMM';
          break;
        case 'asm':
          compilationName = 'Assembly';
          break;
        case 'verilog':
          compilationName = 'Verilog';
          break;
        case 'wave':
          compilationName = 'Waveform';
          break;
        case 'prism':
          compilationName = 'PRISM';
          break;
        case 'all':
          compilationName = 'All components';
          break;
        default:
          compilationName = type;
      }
      
      this.isCompiling = true;
      this.statusItem.className = 'status-item status-compiling';
      this.statusItem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${compilationName} compilation in progress...`;
      
      // Start a gentle pulsing animation
      this.startPulsing();
    }
    
    // Show successful compilation
    compilationSuccess(type) {
      if (!this.statusItem || !this.isCompiling) return;
      
      let compilationName = '';
      switch(type) {
        case 'cmm':
          compilationName = 'CMM';
          break;
        case 'asm':
          compilationName = 'Assembly';
          break;
        case 'verilog':
          compilationName = 'Verilog';
          break;
        case 'wave':
          compilationName = 'Waveform';
          break;
        case 'prism':
          compilationName = 'PRISM';
          break;
        case 'all':
          compilationName = 'All components';
          break;
        default:
          compilationName = type;
      }
      
      this.statusItem.className = 'status-item status-success';
      this.statusItem.innerHTML = `<i class="fa-solid fa-check"></i> ${compilationName} compilation successful`;
      
      // Reset after 5 seconds
      setTimeout(() => {
        this.setDefaultStatus();
      }, 5000);
    }
    
    // Show failed compilation
    compilationError(type, errorMsg = '') {
      if (!this.statusItem || !this.isCompiling) return;
      
      let compilationName = '';
      switch(type) {
        case 'cmm':
          compilationName = 'CMM';
          break;
        case 'asm':
          compilationName = 'Assembly';
          break;
        case 'verilog':
          compilationName = 'Verilog';
          break;
        case 'wave':
          compilationName = 'Waveform';
          break;
        case 'prism':
          compilationName = 'PRISM';
          break;
        case 'all':
          compilationName = 'All components';
          break;
        default:
          compilationName = type;
      }
      
      this.statusItem.className = 'status-item status-error';
      
      // Include error message if provided, otherwise just show generic failure
      if (errorMsg && errorMsg.length > 0) {
        const shortErrorMsg = errorMsg.length > 30 ? errorMsg.substring(0, 30) + '...' : errorMsg;
        this.statusItem.innerHTML = `<i class="fa-solid fa-xmark"></i> ${compilationName} compilation failed: ${shortErrorMsg}`;
      } else {
        this.statusItem.innerHTML = `<i class="fa-solid fa-xmark"></i> ${compilationName} compilation failed`;
      }
      
      // Reset after 8 seconds (longer for errors so user can read)
      setTimeout(() => {
        this.setDefaultStatus();
      }, 8000);
    }
    
    // Start a subtle pulsing animation during compilation
    startPulsing() {
      if (!this.isCompiling) return;
      
      // Toggle opacity slightly for pulsing effect
      let opacity = 1;
      let decreasing = true;
      
      const pulse = () => {
        if (!this.isCompiling) return;
        
        if (decreasing) {
          opacity -= 0.1;
          if (opacity <= 0.7) decreasing = false;
        } else {
          opacity += 0.1;
          if (opacity >= 1) decreasing = true;
        }
        
        this.statusItem.style.opacity = opacity;
        
        if (this.isCompiling) {
          requestAnimationFrame(pulse);
        } else {
          this.statusItem.style.opacity = 1; // Reset opacity when done
        }
      };
      
      requestAnimationFrame(pulse);
    }
  }
  
  // Create global instance
  const statusUpdater = new StatusUpdater();
  
  // Export for use in other modules
  if (typeof module !== 'undefined') {
    module.exports = statusUpdater;
  }