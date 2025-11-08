// renderer.js

// --- Module Imports ---
import { initMonaco } from './monaco_editor.js';
import { RecentProjectsManager } from './recent_projects.js';
import { TabManager } from './tab_manager.js';
import { TerminalManager } from './terminal_module.js';
import { CompilationModule } from './compilation_module.js';
import { fileTreeManager, TreeViewState } from './file_tree_manager.js';
import { projectManager } from './project_manager.js';
import { aiAssistantManager } from './ai_assistant_manager.js';
import { uiComponentsManager } from './ui_components.js';
import { compilationFlowManager } from './compilation_flow.js';

// --- Global State ---
let currentProjectPath = null;
let currentSpfPath = null;
let globalTerminalManager = null;

// --- Global Functions ---
window.initializeGlobalTerminalManager = function() {
    if (!globalTerminalManager) {
        globalTerminalManager = new TerminalManager();
    }
    return globalTerminalManager;
};

// --- Initialization on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize core components first
    TabManager.initialize();
    fileTreeManager.initialize();
    projectManager.initialize();
    uiComponentsManager.initialize();
    compilationFlowManager.initialize();
    
    // Initialize managers that depend on the DOM
    const recentProjectsManager = new RecentProjectsManager(projectManager.loadProject);
    window.recentProjectsManager = recentProjectsManager; // Make it globally accessible if needed

    // Initialize the main CompilationModule and link it to the TreeViewState
    if (typeof CompilationModule !== 'undefined') {
        const compilationModule = new CompilationModule(window.currentProjectPath);
        TreeViewState.setCompilationModule(compilationModule);
        window.compilationModule = compilationModule; // Make it globally accessible
    }

    // Initialize global terminal manager
    window.initializeGlobalTerminalManager();
});

// --- Initialization on Window Load ---
window.onload = () => {
    initMonaco();
    aiAssistantManager.initialize(); // Initialize the AI assistant UI
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