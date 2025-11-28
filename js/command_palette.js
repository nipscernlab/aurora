// js/command_palette.js
/**
 * Command Palette (improved)
 *
 * - STRICTLY uses the existing toolbar elements: it triggers existing elements via .click()
 *   or dispatches events (radios), and it reads their icon markup to display icons.
 * - Single-click / pointerdown executes a command immediately.
 * - When opened, search is cleared and focused. Subsequent typing is captured into the search.
 *
 * Toggle: Ctrl+Shift+P
 */

class CommandPalette {
  constructor() {
    this.overlay = null;
    this.searchInput = null;
    this.listNode = null;
    this.closeBtn = null;

    this.commands = [];
    this.filtered = [];
    this.selectedIndex = 0;
    this.visible = false;

    this._initDOM();
    this._buildCommands();
    this._attachEvents();
  }

  /* -------------------- DOM -------------------- */
  _initDOM() {
    const overlay = document.createElement('div');
    overlay.className = 'aurora-command-palette-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="aurora-command-palette" role="dialog" aria-label="Command Palette" tabindex="-1">
        <div class="cp-searchbar">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input type="text" placeholder="Type a command or search..." aria-label="Search commands" />
          <button class="cp-close-btn" title="Close (Esc)" aria-label="Close palette">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="cp-list" role="listbox" tabindex="0"></div>
        <div class="cp-footer">
          <small><kbd>↑</kbd><kbd>↓</kbd> Navigate &nbsp; <kbd>Enter</kbd> Execute &nbsp; <kbd>Esc</kbd> Close</small>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.searchInput = overlay.querySelector('.cp-searchbar input');
    this.listNode = overlay.querySelector('.cp-list');
    this.closeBtn = overlay.querySelector('.cp-close-btn');

    // Click outside palette closes it
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide();
    });

    // stop propagation on inner container clicks
    overlay.querySelector('.aurora-command-palette').addEventListener('click', (e) => e.stopPropagation());
  }

  /* -------------------- Commands (mapped to existing toolbar elements) -------------------- */
  _buildCommands() {
    const clickIfPossible = (selectorOrElement) => {
      try {
        let target = null;
        if (!selectorOrElement) return false;

        if (typeof selectorOrElement === 'string') {
          // Try many selectors: by id, by data-terminal, or raw selector
          target = document.getElementById(selectorOrElement) || document.querySelector(selectorOrElement) || null;
        } else {
          target = selectorOrElement;
        }
        if (!target) {
          console.warn(`[CommandPalette] missing element for "${selectorOrElement}"`);
          return false;
        }

        // If radio input -> check and dispatch change
        if (target.tagName === 'INPUT' && (target.type === 'radio' || target.type === 'checkbox')) {
          if (!target.checked) {
            target.checked = true;
            target.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }

        // If disabled -> do nothing
        if ('disabled' in target && target.disabled) return false;

        // Prefer .click()
        if (typeof target.click === 'function') {
          target.click();
          return true;
        }

        // Fallback: dispatch MouseEvent
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
        target.dispatchEvent(ev);
        return true;
      } catch (err) {
        console.error('[CommandPalette] clickIfPossible error:', err);
        return false;
      }
    };

    // Helper for selecting a tab by data-terminal
    const clickTerminalTab = (terminalId) => {
      const node = document.querySelector(`[data-terminal="${terminalId}"]`);
      if (node) {
        if (typeof node.click === 'function') { node.click(); return true; }
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
      return false;
    };

    // Build commands list. IDs must match the toolbar/button IDs already in your app.
    // The `id` field is used when looking up the icon in the toolbar; `action` will use the actual element.
    this.commands = [
      { id: 'newProjectBtn', label: 'New Project', description: 'Create a new project', category: 'Project', action: () => clickIfPossible('newProjectBtn') },
      { id: 'openProjectBtn', label: 'Open Project', description: 'Open an existing project', category: 'Project', action: () => clickIfPossible('openProjectBtn') },
      { id: 'open-folder-button', label: 'Open Folder', description: 'Open the current project folder', category: 'Project', action: () => clickIfPossible('#open-folder-button') },
      { id: 'refresh-button', label: 'Refresh File Tree', description: 'Reload file tree', category: 'Project', action: () => clickIfPossible('#refresh-button') },
      { id: 'open-hdl-button', label: 'Open HDL / Import Verilog', description: 'Open HDL or trigger import', category: 'Project', action: () => clickIfPossible('#open-hdl-button') },
      { id: 'toggle-file-tree', label: 'Toggle File Tree', description: 'Minimize / expand the file tree', category: 'Project', action: () => clickIfPossible('#toggle-file-tree') },
      { id: 'hierarchy-tree-toggle', label: 'Toggle Hierarchical View', description: 'Switch hierarchical view', category: 'Project', action: () => clickIfPossible('hierarchy-tree-toggle') },

      { id: 'cmmcomp', label: 'Compile C± (CMM)', description: 'Run C± compiler', category: 'Compilation', action: () => clickIfPossible('cmmcomp') },
      { id: 'asmcomp', label: 'Compile ASM', description: 'Run ASM compilation', category: 'Compilation', action: () => clickIfPossible('asmcomp') },
      { id: 'vericomp', label: 'Compile Verilog', description: 'Run Verilog compilation', category: 'Compilation', action: () => clickIfPossible('vericomp') },
      { id: 'wavecomp', label: 'Open Waveform Viewer', description: 'Open waveform viewer', category: 'Compilation', action: () => clickIfPossible('wavecomp') },
      { id: 'prismcomp', label: 'PRISM Compile', description: 'Run PRISM', category: 'Compilation', action: () => clickIfPossible('prismcomp') },
      { id: 'allcomp', label: 'Full Build', description: 'Execute complete build process', category: 'Compilation', shortcut: 'Ctrl+Shift+B', action: () => clickIfPossible('allcomp') },
      { id: 'cancel-everything', label: 'Cancel Build', description: 'Cancel all running compilations', category: 'Compilation', action: () => clickIfPossible('cancel-everything') },

      { id: 'settings', label: 'Project / Processor Settings', description: 'Open settings modal (depends on mode)', category: 'Settings', action: () => clickIfPossible('settings') },
      { id: 'processorHub', label: 'Processor Hub', description: 'Create / manage processors', category: 'Settings', action: () => clickIfPossible('processorHub') },
      { id: 'aurora-settings', label: 'Aurora Settings', description: 'Open Aurora settings', category: 'Settings', action: () => clickIfPossible('aurora-settings') },
      { id: 'aiButton', label: 'AI Assistant', description: 'Toggle AI assistant', category: 'Tools', action: () => clickIfPossible('aiButton') },

      { id: 'clear-terminal', label: 'Clear Terminal', description: 'Clear terminal output', category: 'Terminal', action: () => clickIfPossible('clear-terminal') },
      { id: 'switch-tcmm', label: 'Show TCMM Terminal', description: 'Switch to C± terminal', category: 'Terminal', action: () => clickTerminalTab('tcmm') },
      { id: 'switch-tasm', label: 'Show TASM Terminal', description: 'Switch to Assembly terminal', category: 'Terminal', action: () => clickTerminalTab('tasm') },
      { id: 'switch-tveri', label: 'Show TVERI Terminal', description: 'Switch to Verilog terminal', category: 'Terminal', action: () => clickTerminalTab('tveri') },
      { id: 'switch-twave', label: 'Show TWAVE Terminal', description: 'Switch to waveform terminal', category: 'Terminal', action: () => clickTerminalTab('twave') },

      { id: 'Processor Mode', label: 'Switch to Processor Mode', description: 'Set Processor mode', category: 'Mode', icon: 'fa-solid fa-microchip', action: () => {
        const r = document.getElementById('Processor Mode'); if (r) { r.checked = true; r.dispatchEvent(new Event('change',{bubbles:true})); return true; } return false;
      } },
      { id: 'Project Mode', label: 'Switch to Project Mode', description: 'Set Project mode', category: 'Mode', icon: 'fa-solid fa-compass-drafting', action: () => {
        const r = document.getElementById('Project Mode'); if (r) { r.checked = true; r.dispatchEvent(new Event('change',{bubbles:true})); return true; } return false;
      } },

      { id: 'save-file', label: 'Save Current File', description: 'Save active file', category: 'File', shortcut: 'Ctrl+S', action: () => {
        const saveBtn = document.getElementById('save-file-btn') || document.getElementById('saveFileBtn');
        if (saveBtn) return clickIfPossible(saveBtn);
        if (window.TabManager && typeof window.TabManager.saveCurrentFile === 'function') return window.TabManager.saveCurrentFile();
        return false;
      }},
      

      { id: 'save-all-files', label: 'Save All Files', description: 'Save all open files', category: 'File', action: () => {
        if (window.TabManager && typeof window.TabManager.saveAllFiles === 'function') return window.TabManager.saveAllFiles();
        const btn = document.getElementById('saveAllBtn'); if (btn) return clickIfPossible(btn); return false;
      }},

      { id: 'close-tab', label: 'Close Active Tab', description: 'Close the active tab', category: 'File', action: () => {
        if (window.TabManager && typeof window.TabManager.closeTab === 'function' && window.TabManager.activeTab) return window.TabManager.closeTab(window.TabManager.activeTab);
        const btn = document.getElementById('closeTabBtn'); if (btn) return clickIfPossible(btn); return false;
      }},

      { id: 'reload-everything-terminal', label: 'Reload Application', description: 'Reload the application', category: 'App', action: () => clickIfPossible('reload-everything-terminal') }
    ];

    // default filtered list
    this.filtered = Array.from(this.commands);
  }

  /* -------------------- Events -------------------- */
  _attachEvents() {
    // Toggle palette with Ctrl+Shift+P
    document.addEventListener('keydown', (e) => {
      // If user types printable while palette closed but we just opened, we handle it in show()
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        this.toggle();
        return;
      }

      // When visible, special handling:
      if (!this.visible) return;

      // If user types a printable character while the input isn't focused, capture it
      const printable = (key) => key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (printable(e.key) && document.activeElement !== this.searchInput) {
        // append key into search input and filter
        this.searchInput.value = this.searchInput.value + e.key;
        this._filter(this.searchInput.value);
        // ensure input gets focus so further typing goes there
        this.searchInput.focus();
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          this.hide();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._selectRelative(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._selectRelative(-1);
          break;
        case 'Home':
          e.preventDefault();
          this._selectIndex(0);
          break;
        case 'End':
          e.preventDefault();
          this._selectIndex(this.filtered.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          this._executeSelected();
          break;
      }
    });

    // Input events
    this.searchInput.addEventListener('input', (e) => {
      this._filter(e.target.value);
    });

    // Close button
    this.closeBtn.addEventListener('click', () => this.hide());

    // Pointerdown executes immediately (single-click)
    this.listNode.addEventListener('pointerdown', (evt) => {
      const item = evt.target.closest('.cp-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) return;
      // If disabled, do nothing
      if (item.classList.contains('disabled')) return;
      this._selectIndex(idx);
      // execute without waiting for click (pointerdown => immediate feel)
      this._executeSelected();
      // prevent focus loss causing accidental double actions
      evt.preventDefault();
    }, { passive: false });

    // Hover updates selection
    this.listNode.addEventListener('mousemove', (evt) => {
      const item = evt.target.closest('.cp-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) return;
      this._selectIndex(idx);
    });

    // focus management: if overlay visible and input loses focus, keep it responsive
    this.overlay.addEventListener('focusin', () => {/* no-op */});
  }

  /* -------------------- Show / Hide -------------------- */
  show() {
    // Clear and focus search input
    this.searchInput.value = '';
    this._filter('');
    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.visible = true;

    // Focus input so immediate typing is captured
    setTimeout(() => this.searchInput.focus(), 10);
  }

  hide() {
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.visible = false;
    // blur the input so global shortcuts work normally
    this.searchInput.blur();
  }

  toggle() {
    if (this.visible) this.hide(); else this.show();
  }

  /* -------------------- Filtering / Rendering -------------------- */
  _filter(q) {
    const query = (q || '').trim().toLowerCase();
    if (!query) {
      this.filtered = Array.from(this.commands);
    } else {
      this.filtered = this.commands.filter(c =>
        c.label.toLowerCase().includes(query) ||
        (c.description && c.description.toLowerCase().includes(query)) ||
        (c.category && c.category.toLowerCase().includes(query))
      );
    }
    this.selectedIndex = 0;
    this._renderList();
  }

  // find icon markup from existing toolbar element (does not clone the button)
// find icon markup from existing toolbar element
  _getIconHtmlForCommand(cmd) {
    try {
      // 1. First, check if the command object has a manually defined icon
      if (cmd.icon) {
        if (!cmd.icon.trim().startsWith('<')) {
          return `<i class="${cmd.icon}"></i>`;
        }
        return cmd.icon;
      }

      // 2. Try to find element by id to extract icon
      let el = document.getElementById(cmd.id);
      
      // If not found and command is a "switch-*" terminal, try data-terminal
      if (!el && cmd.id && cmd.id.startsWith('switch-')) {
        const termId = cmd.id.replace('switch-', '');
        el = document.querySelector(`[data-terminal="${termId}"]`);
      }
      
      // fallback to querySelector by id selector
      if (!el) el = document.querySelector(`#${CSS.escape ? CSS.escape(cmd.id) : cmd.id}`) || null;
      if (!el) return '<i class="fa-solid fa-keyboard"></i>'; // fallback icon

      // 3. CHANGED: Search for ALL <i>, <img>, or <svg> children, not just the first one
      const icons = el.querySelectorAll('i, img, svg');

      if (icons.length > 0) {
        // Combine the HTML of all icons found (e.g. C icon + PlusMinus icon)
        const combinedHtml = Array.from(icons).map(icon => icon.outerHTML).join('');
        
        // Wrap in a span with inline-flex to keep them side-by-side and aligned
        return `<span style="display: inline-flex; align-items: center; gap: 2px;">${combinedHtml}</span>`;
      }

      return '<i class="fa-solid fa-keyboard"></i>';
    } catch (err) {
      console.warn('[CommandPalette] icon lookup error', err);
      return '<i class="fa-solid fa-keyboard"></i>';
    }
  }
  // is enabled: check underlying element disabled property if present
  _isEnabled(cmd) {
    try {
      const el = document.getElementById(cmd.id) || document.querySelector(cmd.id) || null;
      if (el) {
        if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) return true;
        if ('disabled' in el) return !el.disabled;
        return true;
      }
      // For terminal switch commands, check data-terminal tabs
      if (cmd.id && cmd.id.startsWith('switch-')) {
        const t = document.querySelector(`[data-terminal="${cmd.id.replace('switch-','')}"]`);
        return !!t;
      }
      // default allow
      return true;
    } catch {
      return true;
    }
  }

  _renderList() {
    if (!this.filtered || this.filtered.length === 0) {
      this.listNode.innerHTML = `<div class="cp-empty"><i class="fa-solid fa-magnifying-glass"></i><div>No commands found</div></div>`;
      return;
    }

    // Group by category for nicer display
    const groups = {};
    for (const c of this.filtered) {
      groups[c.category] = groups[c.category] || [];
      groups[c.category].push(c);
    }

    let html = '';
    let idx = 0;
    for (const category of Object.keys(groups)) {
      html += `<div class="cp-category">${this._escape(category)}</div>`;
      for (const cmd of groups[category]) {
        const enabled = this._isEnabled(cmd);
        const disabledClass = enabled ? '' : 'disabled';
        const selectedClass = (idx === this.selectedIndex) ? 'selected' : '';
        const iconHtml = this._getIconHtmlForCommand(cmd);
        const shortcut = cmd.shortcut ? `<span class="cp-shortcut">${this._escape(cmd.shortcut)}</span>` : '';
        html += `
          <div class="cp-item ${selectedClass} ${disabledClass}" data-idx="${idx}" role="option" aria-disabled="${!enabled}">
            <div class="cp-item-left">
              <div class="cp-item-icon">${iconHtml}</div>
              <div class="cp-item-body">
                <div class="cp-item-label">${this._escape(cmd.label)}</div>
                <div class="cp-item-desc">${this._escape(cmd.description || '')}</div>
              </div>
            </div>
            ${shortcut}
          </div>
        `;
        idx++;
      }
    }

    this.listNode.innerHTML = html;
    // keep selected visible
    const sel = this.listNode.querySelector('.cp-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  _selectRelative(delta) {
    if (!this.filtered || this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length;
    this._renderList();
  }

  _selectIndex(i) {
    if (!this.filtered || this.filtered.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(i, this.filtered.length - 1));
    this._renderList();
  }

  _executeSelected() {
    if (!this.filtered || this.filtered.length === 0) return;
    const cmd = this.filtered[this.selectedIndex];
    if (!cmd) return;
    if (!this._isEnabled(cmd)) return;

    // Execute mapped action
    try {
      const res = cmd.action();
      // close after slight delay so UI can update (if necessary)
    } catch (err) {
      console.error('[CommandPalette] error executing command', err);
    }
    setTimeout(() => this.hide(), 80);
  }

  /* -------------------- helpers -------------------- */
  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]);
  }
}

/* -------------------- init -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (!window.auroraCommandPalette) {
    window.auroraCommandPalette = new CommandPalette();
    // palette is ready — toggle with Ctrl+Shift+P
  }
});

export default CommandPalette;