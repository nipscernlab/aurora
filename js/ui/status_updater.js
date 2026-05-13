// statusUpdater.js - Manages compilation status in the status bar

// Declared as a `function` (not `const`) so multiple classic scripts can each
// define their own `tr` helper without colliding — classic-script top-level
// const declarations share a lexical scope and would throw "Identifier
// already declared" if another script (e.g. import_file.js) does the same.
function tr(key, params) { return window.t ? window.t(key, params) : key; }

// Resolve a compilation type to its display name via i18n. Unknown
// types fall back to the raw `type` string so we keep the previous
// "show what came in" default behaviour.
function compName(type) {
    const key = `compilation.type.${type}`;
    const v = tr(key);
    return v === key ? type : v;
}

class StatusUpdater {
    constructor() {
      // Antes: .status-item:nth-child(3) — seletor obsoleto, foi quebrado
      // quando os status-items foram divididos em .status-zone-left /
      // -center / -right. Cada zone tem seus proprios filhos, entao
      // nenhum status-item e o "3o filho" mais. Resultado: this.statusItem
      // ficava null, todos os metodos tinham guarda `if (!this.statusItem)
      // return` e o texto "Start Compilation" hardcoded em index.html
      // nunca era substituido.
      this.statusItem = document.getElementById('statusUpdater');
      this.isCompiling = false;

      // Initialize - make sure placeholder is empty
      if (this.statusItem) {
        this.setDefaultStatus();
      }

      // Locale flips while at rest → re-render the default label.
      // Mid-compilation we deliberately don't disturb the spinner.
      window.addEventListener('aurora:locale-changed', () => {
          if (this.statusItem && !this.isCompiling) this.setDefaultStatus();
      });
    }

    _defaultHtml() {
      return `<i class="fa-solid fa-bolt" style="color: #0066FF;"></i> ${tr('statusBar.startCompilation')}`;
    }

    // Set the status item back to default
    setDefaultStatus() {
      this.statusItem.innerHTML = this._defaultHtml();
      this.statusItem.className = 'status-item';
      this.isCompiling = false;
    }

    // Show that compilation has started
    startCompilation(type) {
      if (!this.statusItem) return;
      const name = compName(type);
      this.isCompiling = true;
      this.statusItem.className = 'status-item status-compiling';
      this.statusItem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${tr('compilation.inProgress', { name })}`;

      // Start a gentle pulsing animation
      this.startPulsing();
    }

    // Show successful compilation
    compilationSuccess(type) {
      if (!this.statusItem || !this.isCompiling) return;
      const name = compName(type);
      this.statusItem.className = 'status-item status-success';
      this.statusItem.innerHTML = `<i class="fa-solid fa-check"></i> ${tr('compilation.success', { name })}`;

      // Reset after 5 seconds
      setTimeout(() => {
        this.setDefaultStatus();
      }, 5000);
    }

    // Show failed compilation
    compilationError(type, errorMsg = '') {
      if (!this.statusItem || !this.isCompiling) return;
      const name = compName(type);
      this.statusItem.className = 'status-item status-error';

      // Include error message if provided, otherwise just show generic failure
      if (errorMsg && errorMsg.length > 0) {
        const shortErrorMsg = errorMsg.length > 30 ? errorMsg.substring(0, 30) + '...' : errorMsg;
        this.statusItem.innerHTML = `<i class="fa-solid fa-xmark"></i> ${tr('compilation.failedWithError', { name, error: shortErrorMsg })}`;
      } else {
        this.statusItem.innerHTML = `<i class="fa-solid fa-xmark"></i> ${tr('compilation.failed', { name })}`;
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
        
        if (!this.isCompiling) {
          requestAnimationFrame(pulse);
        } else {
          this.statusItem.style.opacity = 1; // Reset opacity when done
        }
      };
      
      requestAnimationFrame(pulse);
    }
  }
  
  // Create global instance and expose on window so ES modules
  // (compilation_module.js etc.) can reference it — classic-script
  // top-level `const` is NOT visible from module scope.
  const statusUpdater = new StatusUpdater();
  window.statusUpdater = statusUpdater;

  // Export for use in other modules
  if (typeof module !== 'undefined') {
    module.exports = statusUpdater;
  }