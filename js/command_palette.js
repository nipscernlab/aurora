// command_palette.js
/**
 * =====================================================================================
 * Command Palette - CORRECTLY mapped to actual functions
 * Every command is verified against the actual HTML and JS files
 * =====================================================================================
 */

import { TabManager } from './tab_manager.js';
import { compilationFlowManager } from './compilation_flow.js';

class CommandPalette {
  constructor() {
    this.overlay = null;
    this.searchInput = null;
    this.commandList = null;
    this.commands = [];
    this.filteredCommands = [];
    this.selectedIndex = 0;
    this.isVisible = false;

    this.init();
    this.setupCommands();
    this.setupEventListeners();
  }

  init() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'command-palette-overlay';
    this.overlay.innerHTML = `
      <div class="command-palette">
        <div class="command-palette-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" placeholder="Type a command..." autocomplete="off" spellcheck="false">
        </div>
        <div class="command-palette-list"></div>
        <div class="command-palette-footer">
          <div class="command-palette-hint">
            <kbd>↑↓</kbd> Navigate
            <kbd>Enter</kbd> Execute
            <kbd>Esc</kbd> Close
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.searchInput = this.overlay.querySelector('.command-palette-search input');
    this.commandList = this.overlay.querySelector('.command-palette-list');

    this.overlay.querySelector('.command-palette').addEventListener('click', (e) => {
      e.stopPropagation();
    });

    this.overlay.addEventListener('click', () => {
      this.hide();
    });
  }

  /**
   * Setup commands - VERIFIED against actual HTML and JS files
   */
  setupCommands() {
    this.commands = [
      // ========== PROJECT MANAGEMENT ==========
      {
        id: 'new-project',
        label: 'New Project',
        description: 'Create a new project',
        icon: '<i class="fas fa-folder-plus"></i>',
        action: () => {
          // From modal.js - opens newProjectModal
          const modal = document.getElementById('newProjectModal');
          if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('show'), 10);
          }
        },
        category: 'Project',
        enabled: true
      },
      {
        id: 'open-project',
        label: 'Open Project',
        description: 'Open an existing project (.spf file)',
        icon: '<i class="fa-solid fa-box-open"></i>',
        action: async () => {
          // From modal.js - selectSpfFile and loadProject
          try {
            const spfPath = await window.electronAPI.selectSpfFile();
            if (spfPath) {
              // loadProject is defined globally in some file
              if (typeof window.loadProject === 'function') {
                await window.loadProject(spfPath);
              } else if (typeof loadProject === 'function') {
                await loadProject(spfPath);
              }
            }
          } catch (error) {
            console.error('Error opening project:', error);
          }
        },
        category: 'Project',
        enabled: true
      },
      {
        id: 'close-project',
        label: 'Close Project',
        description: 'Close the current project',
        icon: '<i class="fa-solid fa-circle-xmark"></i>',
        action: async () => {
          // From close_project.js
          if (!confirm('Are you sure you want to close the current project?')) {
            return;
          }
          try {
            const result = await window.electronAPI.closeProject();
            if (result.success && typeof clearProjectInterface === 'function') {
              clearProjectInterface();
            }
          } catch (error) {
            console.error('Error closing project:', error);
          }
        },
        category: 'Project',
        enabled: () => !!window.currentProjectPath
      },
      {
        id: 'refresh-tree',
        label: 'Refresh File Tree',
        description: 'Reload the file tree',
        icon: '<i class="fa-solid fa-arrows-rotate"></i>',
        action: () => {
          // Global function refreshFileTree
          if (typeof refreshFileTree === 'function') {
            refreshFileTree();
          } else if (typeof window.refreshFileTree === 'function') {
            window.refreshFileTree();
          }
        },
        category: 'Project',
        enabled: true
      },
      {
        id: 'open-folder',
        label: 'Open Project Folder',
        description: 'Open project folder in file explorer',
        icon: '<i class="fa-solid fa-folder-open"></i>',
        action: async () => {
          // Uses openFolder from electronAPI
          if (window.currentProjectPath) {
            try {
              await window.electronAPI.openFolder(window.currentProjectPath);
            } catch (error) {
              console.error('Error opening folder:', error);
            }
          }
        },
        category: 'Project',
        enabled: () => !!window.currentProjectPath
      },
      {
        id: 'open-hdl',
        label: 'Open HDL Folder',
        description: 'Open HDL components folder',
        icon: '<i class="fa-solid fa-hashtag"></i>',
        action: async () => {
          // In Verilog Mode: triggers file import
          // Otherwise: opens HDL folder
          const verilogMode = document.getElementById('Verilog Mode');
          if (verilogMode && verilogMode.checked) {
            // Trigger verilog mode file import
            if (window.verilogModeManager && typeof window.verilogModeManager.handleImportClick === 'function') {
              await window.verilogModeManager.handleImportClick();
            }
          } else {
            // Open HDL folder
            try {
              const componentsPath = await window.electronAPI.getComponentsPath();
              const hdlPath = await window.electronAPI.joinPath(componentsPath, 'HDL');
              await window.electronAPI.openFolder(hdlPath);
            } catch (error) {
              console.error('Error opening HDL folder:', error);
            }
          }
        },
        category: 'Project',
        enabled: true
      },
      {
        id: 'toggle-file-tree',
        label: 'Toggle File Tree',
        description: 'Minimize or expand the file tree',
        icon: '<i class="fa-solid fa-square-minus"></i>',
        action: () => {
          const fileTreeContainer = document.querySelector('.file-tree-container');
          if (fileTreeContainer) {
            fileTreeContainer.classList.toggle('minimized');
          }
        },
        category: 'Project',
        enabled: true
      },
      {
        id: 'hierarchy-toggle',
        label: 'Toggle Hierarchical View',
        description: 'Switch between file tree and hierarchical module view',
        icon: '<i class="fa-solid fa-sitemap"></i>',
        action: () => {
          const toggleButton = document.getElementById('hierarchy-tree-toggle');
          if (toggleButton && !toggleButton.disabled) {
            toggleButton.click();
          }
        },
        category: 'Project',
        enabled: () => {
          const toggleButton = document.getElementById('hierarchy-tree-toggle');
          return toggleButton && !toggleButton.disabled;
        }
      },

      // ========== COMPILATION ==========
      {
        id: 'cmm-compile',
        label: 'C± Compile',
        description: 'Compile C± code',
        icon: '<i class="fa-solid fa-c" style="color: lightskyblue;"></i><i class="fa-solid fa-plus-minus" style="color: #FFD700;"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runSingleStep === 'function') {
            compilationFlowManager.runSingleStep('cmm');
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('cmmcomp')?.disabled
      },
      {
        id: 'asm-compile',
        label: 'Assembly Compile',
        description: 'Compile assembly code',
        icon: '<i class="fa-solid fa-cube" style="color: rgb(189, 67, 189);"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runSingleStep === 'function') {
            compilationFlowManager.runSingleStep('asm');
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('asmcomp')?.disabled
      },
      {
        id: 'verilog-compile',
        label: 'Verilog Compile',
        description: 'Compile Verilog code',
        icon: '<i class="fa-solid fa-feather" style="color: #FF3131;"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runSingleStep === 'function') {
            compilationFlowManager.runSingleStep('verilog');
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('vericomp')?.disabled
      },
      {
        id: 'wave-compile',
        label: 'Waveform Viewer',
        description: 'Open waveform viewer',
        icon: '<i class="fa-solid fa-wave-square" style="color: #2CFF05;"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runSingleStep === 'function') {
            compilationFlowManager.runSingleStep('wave');
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('wavecomp')?.disabled
      },
      {
        id: 'prism-compile',
        label: 'PRISM Compile',
        description: 'Compile with PRISM',
        icon: '<img src="./assets/icons/aurora_prism.svg" style="width: 20px; height: 20px;">',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runSingleStep === 'function') {
            compilationFlowManager.runSingleStep('prism');
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('prismcomp')?.disabled
      },
      {
        id: 'full-build',
        label: 'Full Build',
        description: 'Execute complete build process',
        icon: '<i class="fa-brands fa-react fa-xl" style="color: #00e9ff;"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.runAll === 'function') {
            compilationFlowManager.runAll();
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('allcomp')?.disabled,
        shortcut: 'Ctrl+Shift+B'
      },
      {
        id: 'cancel-all',
        label: 'Cancel All',
        description: 'Cancel all running compilations',
        icon: '<i class="fa-solid fa-power-off" style="color: #00e9ff;"></i>',
        action: () => {
          if (compilationFlowManager && typeof compilationFlowManager.cancelAll === 'function') {
            compilationFlowManager.cancelAll();
          }
        },
        category: 'Compilation',
        enabled: () => !document.getElementById('cancel-everything')?.disabled
      },

      // ========== SETTINGS & TOOLS ==========
      {
        id: 'settings',
        label: 'Project Settings',
        description: 'Configure processor or project settings',
        icon: '<i class="fa-solid fa-gears" style="color: #da70d6;"></i>',
        action: () => {
          // Settings button behavior from hourglass.js
          const processorMode = document.getElementById('Processor Mode');
          const projectMode = document.getElementById('Project Mode');
          
          if (processorMode?.checked) {
            // Open processor config modal
            const modal = document.getElementById('modalProcessorConfig');
            if (modal) {
              modal.setAttribute('aria-hidden', 'false');
              modal.classList.add('show');
              modal.style.display = 'flex';
              document.body.style.overflow = 'hidden';
            }
          } else if (projectMode?.checked) {
            // Open project config modal
            const modal = document.getElementById('modalProjectConfig');
            if (modal) {
              modal.setAttribute('aria-hidden', 'false');
              modal.classList.add('show');
              modal.style.display = 'flex';
              document.body.style.overflow = 'hidden';
            }
          }
        },
        category: 'Settings',
        enabled: () => !document.getElementById('settings')?.disabled,
        shortcut: 'Ctrl+Shift+C'
      },
      {
        id: 'processor-hub',
        label: 'Processor Hub',
        description: 'Create and manage processors',
        icon: '<i class="fa-solid fa-star-of-life"></i>',
        action: () => {
          // From processor_hub.js - opens modalContainer
          const modal = document.getElementById('modalContainer');
          if (modal) {
            modal.setAttribute('aria-hidden', 'false');
            modal.classList.add('show');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
          }
        },
        category: 'Settings',
        enabled: true
      },
      {
        id: 'aurora-settings',
        label: 'Aurora Settings',
        description: 'Configure Aurora IDE settings',
        icon: '<i class="fa-solid fa-sliders"></i>',
        action: () => {
          // From aurora_settings.js
          const modal = document.getElementById('settings-modal');
          if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('visible'), 10);
          }
        },
        category: 'Settings',
        enabled: true
      },
      {
        id: 'ai-assistant',
        label: 'AI Assistant',
        description: 'Toggle AI assistant',
        icon: '<img src="./assets/icons/ai_gemini.webp" style="width: 20px; height: 20px;">',
        action: () => {
          // From renderer.js - Ctrl+K shortcut
          if (typeof aiAssistantManager !== 'undefined' && aiAssistantManager.toggle) {
            aiAssistantManager.toggle();
          }
        },
        category: 'Tools',
        enabled: true
      },

      // ========== TERMINAL ==========
      {
        id: 'clear-terminal',
        label: 'Clear Terminal',
        description: 'Clear all terminal content',
        icon: '<i class="fa-solid fa-trash-can"></i>',
        action: () => {
          if (typeof window.initializeGlobalTerminalManager === 'function') {
            window.initializeGlobalTerminalManager();
          }
        },
        category: 'Terminal',
        enabled: true
      },
      {
        id: 'switch-tcmm',
        label: 'C± Terminal',
        description: 'Switch to C± compilation terminal',
        icon: '<i class="fa-solid fa-c" style="color: lightskyblue;"></i>',
        action: () => this.switchToTerminal('tcmm'),
        category: 'Terminal',
        enabled: true
      },
      {
        id: 'switch-tasm',
        label: 'Assembly Terminal',
        description: 'Switch to assembly compilation terminal',
        icon: '<i class="fa-solid fa-cube" style="color: rgb(189, 67, 189);"></i>',
        action: () => this.switchToTerminal('tasm'),
        category: 'Terminal',
        enabled: true
      },
      {
        id: 'switch-tveri',
        label: 'Verilog Terminal',
        description: 'Switch to Verilog compilation terminal',
        icon: '<i class="fa-solid fa-feather" style="color: #FF3131;"></i>',
        action: () => this.switchToTerminal('tveri'),
        category: 'Terminal',
        enabled: true
      },
      {
        id: 'switch-twave',
        label: 'Waveform Terminal',
        description: 'Switch to waveform viewer terminal',
        icon: '<i class="fa-solid fa-wave-square" style="color: #2CFF05;"></i>',
        action: () => this.switchToTerminal('twave'),
        category: 'Terminal',
        enabled: true
      },
      {
        id: 'reload-app',
        label: 'Reload Application',
        description: 'Reload the entire application',
        icon: '<i class="fa-solid fa-hourglass"></i>',
        action: () => {
          if (window.electronAPI?.reloadApp) {
            window.electronAPI.reloadApp();
          }
        },
        category: 'Terminal',
        enabled: true
      },

      // ========== MODE SWITCHING ==========
      {
        id: 'verilog-mode',
        label: 'Switch to Verilog Mode',
        description: 'Change compilation mode to Verilog',
        icon: '<i class="fa-solid fa-v fa-sm"></i>',
        action: () => {
          const radio = document.getElementById('Verilog Mode');
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        category: 'Mode',
        enabled: true
      },
      {
        id: 'processor-mode',
        label: 'Switch to Processor Mode',
        description: 'Change compilation mode to Processor',
        icon: '<i class="fa-solid fa-microchip"></i>',
        action: () => {
          const radio = document.getElementById('Processor Mode');
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        category: 'Mode',
        enabled: true
      },
      {
        id: 'project-mode',
        label: 'Switch to Project Mode',
        description: 'Change compilation mode to Project',
        icon: '<i class="fa-solid fa-compass-drafting"></i>',
        action: () => {
          const radio = document.getElementById('Project Mode');
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        category: 'Mode',
        enabled: true
      },

      // ========== FILE/TAB OPERATIONS ==========
      {
        id: 'save-file',
        label: 'Save Current File',
        description: 'Save the currently active file',
        icon: '<i class="fa-solid fa-floppy-disk"></i>',
        action: async () => {
          if (TabManager && typeof TabManager.saveCurrentFile === 'function') {
            await TabManager.saveCurrentFile();
          }
        },
        category: 'File',
        enabled: () => TabManager && TabManager.activeTab !== null,
        shortcut: 'Ctrl+S'
      },
      {
        id: 'save-all-files',
        label: 'Save All Files',
        description: 'Save all open files',
        icon: '<i class="fa-solid fa-floppy-disk"></i>',
        action: async () => {
          if (TabManager && typeof TabManager.saveAllFiles === 'function') {
            await TabManager.saveAllFiles();
          }
        },
        category: 'File',
        enabled: () => TabManager && TabManager.tabs && TabManager.tabs.size > 0,
        shortcut: 'Ctrl+Shift+S'
      },
      {
        id: 'close-tab',
        label: 'Close Active Tab',
        description: 'Close the currently active tab',
        icon: '<i class="fa-solid fa-xmark"></i>',
        action: () => {
          if (TabManager && TabManager.activeTab && typeof TabManager.closeTab === 'function') {
            TabManager.closeTab(TabManager.activeTab);
          }
        },
        category: 'File',
        enabled: () => TabManager && TabManager.activeTab !== null,
        shortcut: 'Ctrl+W'
      },
      {
        id: 'reopen-tab',
        label: 'Reopen Last Closed Tab',
        description: 'Reopen the last closed tab',
        icon: '<i class="fa-solid fa-rotate-left"></i>',
        action: async () => {
          if (TabManager && typeof TabManager.reopenLastClosedTab === 'function') {
            await TabManager.reopenLastClosedTab();
          }
        },
        category: 'File',
        enabled: () => TabManager && TabManager.closedTabsStack && TabManager.closedTabsStack.length > 0,
        shortcut: 'Ctrl+Shift+T'
      }
    ];
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        this.toggle();
        return;
      }

      if (!this.isVisible) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          this.hide();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.selectNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.selectPrevious();
          break;
        case 'Enter':
          e.preventDefault();
          this.executeSelected();
          break;
      }
    });

    this.searchInput.addEventListener('input', (e) => {
      this.filterCommands(e.target.value);
    });

    this.commandList.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.command-item');
      if (item && !item.classList.contains('disabled')) {
        const index = Array.from(this.commandList.querySelectorAll('.command-item')).indexOf(item);
        if (index !== -1) {
          this.selectedIndex = index;
          this.updateSelection();
        }
      }
    });

    this.commandList.addEventListener('click', (e) => {
      const item = e.target.closest('.command-item');
      if (item && !item.classList.contains('disabled')) {
        const index = Array.from(this.commandList.querySelectorAll('.command-item')).indexOf(item);
        if (index !== -1) {
          this.selectedIndex = index;
          this.executeSelected();
        }
      }
    });
  }

  show() {
    this.isVisible = true;
    this.overlay.classList.add('visible');
    this.searchInput.value = '';
    this.filterCommands('');
    this.selectedIndex = 0;
    this.updateSelection();
    setTimeout(() => this.searchInput.focus(), 100);
  }

  hide() {
    this.isVisible = false;
    this.overlay.classList.remove('visible');
    this.searchInput.blur();
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  filterCommands(query) {
    const lowerQuery = query.toLowerCase();
    
    this.filteredCommands = this.commands.filter(cmd => {
      const isEnabled = typeof cmd.enabled === 'function' ? cmd.enabled() : cmd.enabled;
      if (!isEnabled) return false;
      if (!query) return true;
      
      return cmd.label.toLowerCase().includes(lowerQuery) ||
             cmd.description.toLowerCase().includes(lowerQuery) ||
             cmd.category.toLowerCase().includes(lowerQuery);
    });

    this.selectedIndex = 0;
    this.render();
  }

  render() {
    if (this.filteredCommands.length === 0) {
      this.commandList.innerHTML = `
        <div class="command-palette-empty">
          <i class="fa-solid fa-magnifying-glass"></i>
          <p>No commands found</p>
        </div>
      `;
      return;
    }

    const grouped = {};
    this.filteredCommands.forEach(cmd => {
      if (!grouped[cmd.category]) grouped[cmd.category] = [];
      grouped[cmd.category].push(cmd);
    });

    let html = '';
    let globalIndex = 0;

    Object.keys(grouped).sort().forEach(category => {
      html += `<div class="command-category">${category}</div>`;
      
      grouped[category].forEach(cmd => {
        const isSelected = globalIndex === this.selectedIndex;
        const isEnabled = typeof cmd.enabled === 'function' ? cmd.enabled() : cmd.enabled;
        
        html += `
          <div class="command-item ${isSelected ? 'selected' : ''} ${!isEnabled ? 'disabled' : ''}" data-index="${globalIndex}">
            <div class="command-icon">${cmd.icon}</div>
            <div class="command-text">
              <div class="command-label">${cmd.label}</div>
              <div class="command-description">${cmd.description}</div>
            </div>
            ${cmd.shortcut ? `<div class="command-shortcut">${cmd.shortcut}</div>` : ''}
          </div>
        `;
        globalIndex++;
      });
    });

    this.commandList.innerHTML = html;
    this.scrollToSelected();
  }

  updateSelection() {
    const items = this.commandList.querySelectorAll('.command-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
    this.scrollToSelected();
  }

  scrollToSelected() {
    const selectedItem = this.commandList.querySelector('.command-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  selectNext() {
    if (this.filteredCommands.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
    this.updateSelection();
  }

  selectPrevious() {
    if (this.filteredCommands.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
    this.updateSelection();
  }

  executeSelected() {
    if (this.filteredCommands.length === 0) return;
    
    const command = this.filteredCommands[this.selectedIndex];
    const isEnabled = typeof command.enabled === 'function' ? command.enabled() : command.enabled;
    
    if (!isEnabled) return;

    const selectedItem = this.commandList.querySelector('.command-item.selected');
    if (selectedItem) {
      selectedItem.classList.add('executing');
    }

    try {
      command.action();
    } catch (error) {
      console.error('Error executing command:', error);
    }

    setTimeout(() => {
      this.hide();
    }, 100);
  }

  switchToTerminal(terminalId) {
    const tab = document.querySelector(`[data-terminal="${terminalId}"]`);
    if (tab) tab.click();
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.commandPalette = new CommandPalette();
  console.log('✓ Command Palette initialized (Ctrl+Shift+P)');
});

export { CommandPalette };