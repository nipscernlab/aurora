// js/command_palette.js

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

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide();
    });

    overlay.querySelector('.aurora-command-palette').addEventListener('click', (e) => e.stopPropagation());
  }

  _fuzzyMatch(query, target) {
    if (!query) return true;
    if (!target) return false;

    const q = query.trim().toLowerCase();
    const t = target.toLowerCase();

    const pattern = q.split('').join('.*');
    const regex = new RegExp(pattern);

    return regex.test(t);
  }

  _buildCommands() {
    const clickIfPossible = (selectorOrElement) => {
      try {
        let target = null;
        if (!selectorOrElement) return false;

        if (typeof selectorOrElement === 'string') {
          target = document.getElementById(selectorOrElement) || document.querySelector(selectorOrElement) || null;
        } else {
          target = selectorOrElement;
        }
        
        if (!target) {
          return false;
        }

        if (target.tagName === 'INPUT' && (target.type === 'radio' || target.type === 'checkbox')) {
            target.checked = true;
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('click', { bubbles: true }));
            return true;
        }

        if (typeof target.click === 'function') {
          target.click();
          return true;
        }

        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
        target.dispatchEvent(ev);
        return true;
      } catch (err) {
        return false;
      }
    };

    const clickTerminalTab = (terminalId) => {
      const node = document.querySelector(`[data-terminal="${terminalId}"]`);
      if (node) {
        if (typeof node.click === 'function') { 
            node.click(); 
        } else {
            node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        return true;
      }
      return false;
    };

    this.commands = [
      { id: 'newProjectBtn', label: 'New Project', description: 'Create a new project', category: 'Project', action: () => clickIfPossible('newProjectBtn') },
      { id: 'openProjectBtn', label: 'Open Project', description: 'Open an existing project', category: 'Project', action: () => clickIfPossible('openProjectBtn') },
      { id: 'open-folder-button', label: 'Open Folder', description: 'Open the current project folder', category: 'Project', action: () => clickIfPossible('#open-folder-button') },
      { id: 'refresh-button', label: 'Refresh File Tree', description: 'Reload file tree', category: 'Project', action: () => clickIfPossible('#refresh-button') },
      { id: 'open-hdl-button', label: 'Open HDL / Import Verilog', description: 'Open HDL or trigger import', category: 'Project', action: () => clickIfPossible('#open-hdl-button') },
      { id: 'toggle-file-tree', label: 'Toggle File Tree', description: 'Minimize / expand the file tree', category: 'Project', action: () => clickIfPossible('#toggle-file-tree') },
      { id: 'alternate-tree-toggle', label: 'Toggle Hierarchical View', description: 'Switch hierarchical view', category: 'Project', action: () => clickIfPossible('alternate-tree-toggle') },

      { id: 'cmmcomp', label: 'Compile C± (CMM)', description: 'Run C± compiler', category: 'Compilation', action: () => clickIfPossible('cmmcomp') },
      { id: 'asmcomp', label: 'Compile ASM', description: 'Run ASM compilation', category: 'Compilation', action: () => clickIfPossible('asmcomp') },
      { id: 'vericomp', label: 'Compile Verilog', description: 'Run Verilog compilation', category: 'Compilation', action: () => clickIfPossible('vericomp') },
      { id: 'wavecomp', label: 'Open Waveform Viewer', description: 'Open waveform viewer', category: 'Compilation', action: () => clickIfPossible('wavecomp') },
      { id: 'prismcomp', label: 'PRISM Compile', description: 'Run PRISM', category: 'Compilation', action: async () => {
        if (window.compilationFlowManager && typeof window.compilationFlowManager.runSingleStep === 'function') {
          await window.compilationFlowManager.runSingleStep('prism');
          return true;
        }
        return clickIfPossible('prismcomp');
      } },
      { id: 'allcomp', label: 'Full Build', description: 'Execute complete build process', category: 'Compilation', shortcut: 'Ctrl+Shift+B', action: () => clickIfPossible('allcomp') },
      { id: 'cancel-everything', label: 'Cancel Build', description: 'Cancel all running compilations', category: 'Compilation', action: () => clickIfPossible('cancel-everything') },

      { id: 'settings', label: 'Project / Processor Settings', description: 'Open settings modal', category: 'Settings', action: () => clickIfPossible('settings') },
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

    this.filtered = Array.from(this.commands);
  }

  _attachEvents() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        this.toggle();
        return;
      }

      if (!this.visible) return;

      const printable = (key) => key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (printable(e.key) && document.activeElement !== this.searchInput) {
        this.searchInput.value = this.searchInput.value + e.key;
        this._filter(this.searchInput.value);
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

    this.searchInput.addEventListener('input', (e) => {
      this._filter(e.target.value);
    });

    this.closeBtn.addEventListener('click', () => this.hide());

    this.listNode.addEventListener('pointerdown', (evt) => {
      const item = evt.target.closest('.cp-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) return;
      this._selectIndex(idx);
      this._executeSelected();
      evt.preventDefault();
    }, { passive: false });

    this.listNode.addEventListener('mousemove', (evt) => {
      const item = evt.target.closest('.cp-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) return;
      this._selectIndex(idx);
    });

    this.overlay.addEventListener('focusin', () => {});
  }

  show() {
    this.searchInput.value = '';
    this._filter('');
    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.visible = true;

    setTimeout(() => this.searchInput.focus(), 10);
  }

  hide() {
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.visible = false;
    this.searchInput.blur();
  }

  toggle() {
    if (this.visible) this.hide(); else this.show();
  }

  _filter(q) {
      const query = (q || '').trim();
      
      if (!query) {
        this.filtered = Array.from(this.commands);
      } else {
        this.filtered = this.commands.filter(c =>
          this._fuzzyMatch(query, c.label) ||
          (c.description && this._fuzzyMatch(query, c.description)) ||
          (c.category && this._fuzzyMatch(query, c.category))
        );
      }
      
      this.selectedIndex = 0;
      this._renderList();
    }

  _getIconHtmlForCommand(cmd) {
    try {
      if (cmd.icon) {
        if (!cmd.icon.trim().startsWith('<')) {
          return `<i class="${cmd.icon}"></i>`;
        }
        return cmd.icon;
      }

      let el = document.getElementById(cmd.id);
      
      if (!el && cmd.id && cmd.id.startsWith('switch-')) {
        const termId = cmd.id.replace('switch-', '');
        el = document.querySelector(`[data-terminal="${termId}"]`);
      }
      
      if (!el) el = document.querySelector(`#${CSS.escape ? CSS.escape(cmd.id) : cmd.id}`) || null;
      if (!el) return '<i class="fa-solid fa-keyboard"></i>';

      const icons = el.querySelectorAll('i, img, svg');

      if (icons.length > 0) {
        const combinedHtml = Array.from(icons).map(icon => icon.outerHTML).join('');
        return `<span style="display: inline-flex; align-items: center; gap: 2px;">${combinedHtml}</span>`;
      }

      return '<i class="fa-solid fa-keyboard"></i>';
    } catch (err) {
      return '<i class="fa-solid fa-keyboard"></i>';
    }
  }

  _renderList() {
    if (!this.filtered || this.filtered.length === 0) {
      this.listNode.innerHTML = `<div class="cp-empty"><i class="fa-solid fa-magnifying-glass"></i><div>No commands found</div></div>`;
      return;
    }

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
        const selectedClass = (idx === this.selectedIndex) ? 'selected' : '';
        const iconHtml = this._getIconHtmlForCommand(cmd);
        const shortcut = cmd.shortcut ? `<span class="cp-shortcut">${this._escape(cmd.shortcut)}</span>` : '';
        html += `
          <div class="cp-item ${selectedClass}" data-idx="${idx}" role="option">
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

    try {
      cmd.action();
    } catch (err) {
      console.error(err);
    }
    setTimeout(() => this.hide(), 80);
  }

  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.auroraCommandPalette) {
    window.auroraCommandPalette = new CommandPalette();
  }
});

export default CommandPalette;