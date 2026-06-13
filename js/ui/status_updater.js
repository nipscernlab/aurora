// statusUpdater.js - Manages compilation status in the status bar

// `tr` is a thin i18n shim; `window.t` is read lazily so a render before
// i18n boots falls back to the raw key instead of throwing.
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

      // A "run" is a whole pipeline (one toolbar button = many steps:
      // e.g. Verilator = cmm+asm → json → build → run). While a run is
      // active we must NOT let a per-step success reset the bar back to
      // "Start Compilation" — the next steps (and the heavy Verilator
      // build/run, which don't touch this updater at all) are still going.
      // beginRun/endRun bracket the pipeline; runActive gates the resets.
      this.runActive = false;
      this.resetTimer = null;
      this._pulsing = false;

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

    _clearReset() {
      if (this.resetTimer) {
        clearTimeout(this.resetTimer);
        this.resetTimer = null;
      }
    }

    _scheduleReset(ms) {
      this._clearReset();
      this.resetTimer = setTimeout(() => this.setDefaultStatus(), ms);
    }

    // Set the status item back to default
    setDefaultStatus() {
      this._clearReset();
      this.statusItem.innerHTML = this._defaultHtml();
      this.statusItem.className = 'status-item';
      this.isCompiling = false;
      this.runActive = false;
    }

    // ---- Run lifecycle (whole pipeline / toolbar button) -------------

    // Mark the start of a pipeline run. Keeps the bar in a "running"
    // state until endRun/cancelRun, so per-step successes can't bounce
    // it back to the default label while later steps are still working.
    beginRun(type) {
      if (!this.statusItem) return;
      this.runActive = true;
      this._clearReset();
      const name = compName(type);
      this.isCompiling = true;
      this.statusItem.className = 'status-item status-compiling';
      this.statusItem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${tr('compilation.inProgress', { name })}`;
      this.startPulsing();
    }

    // Mark the end of a pipeline run. If a step already surfaced an error
    // (which clears runActive and shows its own message), leave it alone;
    // otherwise show the overall success and schedule the reset.
    endRun(type) {
      if (!this.runActive) return; // an error already terminated the run
      this.runActive = false;
      if (!this.statusItem) return;
      const name = compName(type);
      this.statusItem.className = 'status-item status-success';
      this.statusItem.innerHTML = `<i class="fa-solid fa-check"></i> ${tr('compilation.success', { name })}`;
      this.isCompiling = false;
      this._scheduleReset(5000);
    }

    // User cancelled the run (cancel-everything button).
    cancelRun() {
      this.runActive = false;
      this.isCompiling = false;
      if (!this.statusItem) return;
      this.statusItem.className = 'status-item status-error';
      this.statusItem.innerHTML = `<i class="fa-solid fa-ban"></i> ${tr('compilation.cancelled')}`;
      this._scheduleReset(3000);
    }

    // Show that compilation has started
    startCompilation(type) {
      if (!this.statusItem) return;
      const name = compName(type);
      this._clearReset();
      this.isCompiling = true;
      this.statusItem.className = 'status-item status-compiling';
      this.statusItem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${tr('compilation.inProgress', { name })}`;

      // Start a gentle pulsing animation
      this.startPulsing();
    }

    // Show successful compilation
    compilationSuccess(type) {
      if (!this.statusItem || !this.isCompiling) return;
      // Inside a multi-step run, a step finishing is not the end — keep the
      // running state and let endRun decide. Only standalone steps reset.
      if (this.runActive) return;
      const name = compName(type);
      this.statusItem.className = 'status-item status-success';
      this.statusItem.innerHTML = `<i class="fa-solid fa-check"></i> ${tr('compilation.success', { name })}`;

      // Reset after 5 seconds
      this._scheduleReset(5000);
    }

    // Show failed compilation
    compilationError(type, errorMsg = '') {
      if (!this.statusItem || !this.isCompiling) return;
      // A failed step ends the whole run.
      this.runActive = false;
      this.isCompiling = false;
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
      this._scheduleReset(8000);
    }
    
    // Start a subtle pulsing animation during compilation
    startPulsing() {
      if (!this.isCompiling) return;
      // Guard against stacking loops: beginRun + each step's
      // startCompilation both call this within a single run.
      if (this._pulsing) return;
      this._pulsing = true;

      // Toggle opacity slightly for pulsing effect
      let opacity = 1;
      let decreasing = true;

      const pulse = () => {
        if (!this.isCompiling) { this._pulsing = false; return; }

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
  
// Singleton: the status bar has exactly one compilation indicator.
export const statusUpdater = new StatusUpdater();