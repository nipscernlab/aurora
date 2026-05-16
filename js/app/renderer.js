// renderer.js

// --- Module Imports ---
import { initMonaco } from '../editor/monaco_editor.js';
import { RecentProjectsManager } from '../project/recent_projects.js';
import { TabManager } from '../tabs/tab_manager.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import { CompilationModule } from '../compilation/compilation_module.js';
import { fileTreeManager } from '../tree/file_tree_manager.js';
import { treeView } from '../tree/tree_view.js';
import { fileTreeViewController } from '../tree/file_tree_view_controller.js';
// Make sure the view subcontainers exist before any renderer runs.
treeView.initialize();
fileTreeViewController.initialize();
import { projectManager } from '../project/project_manager.js';
import { aiAssistantManager } from '../ui/ai_assistant_manager.js';
import { uiComponentsManager } from '../ui/ui_components.js';
import { compilationFlowManager } from '../compilation/compilation_flow.js';
import { SplitEditorManager } from '../editor/split_editor.js';

// Non-module callers (shortcut_manager.js, status_bar.js) reach into
// TabManager via window. Expor aqui satisfaz esses lookups que
// historicamente eram silenciosamente undefined.
window.TabManager = TabManager;

// --- Global State ---
let currentProjectPath = null;
let globalTerminalManager = null;

// --- Global Functions ---
window.initializeGlobalTerminalManager = function() {
    if (!globalTerminalManager) {
        globalTerminalManager = new TerminalManager();
    }
    return globalTerminalManager;
};

window.toggleSidebar = function() {
    const fileTreeContainer = document.querySelector('.file-tree-container');
    if (!fileTreeContainer) return;
    const isCollapsed = fileTreeContainer.classList.contains('sidebar-collapsed');
    if (isCollapsed) {
        fileTreeContainer.classList.remove('sidebar-collapsed');
        const saved = localStorage.getItem('fileTreeWidth');
        fileTreeContainer.style.width = saved ? saved + 'px' : '250px';
    } else {
        localStorage.setItem('fileTreeWidth', fileTreeContainer.offsetWidth);
        fileTreeContainer.classList.add('sidebar-collapsed');
    }
};

// --- Initialization on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize core components first
    TabManager.initialize();
    fileTreeManager.initialize();
    projectManager.initialize();
    uiComponentsManager.initialize();
    compilationFlowManager.initialize();

    // Split editor: initialize layout
    SplitEditorManager.initialize();
    window.SplitEditorManager = SplitEditorManager;

    // Keep split button enabled/disabled in sync with active tab state
    const _origActivate = TabManager.activateTab.bind(TabManager);
    TabManager.activateTab = function(filePath) {
        _origActivate(filePath);
        SplitEditorManager._updateButton();
    };
    const _origClose = TabManager._closePreviewSilently?.bind(TabManager);
    if (_origClose) {
        TabManager._closePreviewSilently = function(filePath) {
            _origClose(filePath);
            SplitEditorManager._updateButton();
        };
    }
    
    // ✅ Expor globalmente para o Command Palette
    window.compilationFlowManager = compilationFlowManager;
    
    // Initialize managers that depend on the DOM
    const recentProjectsManager = new RecentProjectsManager(projectManager.loadProject);
    window.recentProjectsManager = recentProjectsManager;

    // Initialize the main CompilationModule. Its constructor pins
    // itself as window._latestCompilationModule, which is what the
    // file-tree view controller reads to find the renderer for the
    // hierarchy view — no explicit registration needed.
    if (typeof CompilationModule !== 'undefined') {
        const compilationModule = new CompilationModule(window.currentProjectPath);
        window.compilationModule = compilationModule;
    }

    // Initialize global terminal manager
    window.initializeGlobalTerminalManager();

    // New Verilog file button — delega pro projectTreeManager, que e o
    // unico dono da file tree. Uma implementacao paralela aqui (writeFile
    // + window.refreshFileTree) gravava o arquivo no disco mas nunca no
    // .spf nem em verilogFiles, entao o arquivo novo nunca aparecia na
    // arvore. createNewFile faz o fluxo completo: dialog → write → push
    // → classifica → persiste no .spf → re-renderiza → abre na aba.
    const newVerilogBtn = document.getElementById('new-verilog-file');
    if (newVerilogBtn) {
        newVerilogBtn.addEventListener('click', () => {
            window.projectTreeManager?.createNewFile?.();
        });
    }

    // ✅ Command Palette is auto-initialized via its own DOMContentLoaded listener
});

// --- Initialization on Window Load ---
window.onload = () => {
    initMonaco();
    aiAssistantManager.initialize();

    const aiBtn = document.getElementById('aiButton');
    if (aiBtn) {
        aiBtn.addEventListener('click', () => aiAssistantManager.toggle());
    }
};

// --- Global Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    // Toggle AI Assistant: Ctrl/Cmd + K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        aiAssistantManager.toggle();
    }
    
    // Open Project Folder: F2
    if (e.key === 'F2' && currentProjectPath) {
        window.electronAPI.openFolder(currentProjectPath);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const websiteLink = document.getElementById('website-link');
    
    if (websiteLink) {
        websiteLink.addEventListener('click', (e) => {
            e.preventDefault();
            // CORREÇÃO AQUI: Usando a API exposta pelo preload
            window.electronAPI.openExternal('https://nipscern.com');
        });
    }
});