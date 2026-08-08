// renderer.js

// --- Module Imports ---
import { electronAPI } from './electron_api.js';
import { setAuditHook, setTerminalHook } from '../compilation/spec_runner.js';
import { initMonaco } from '../editor/monaco_editor.js';
import { RecentProjectsManager } from '../project/recent_projects.js';
import { TabManager } from '../tabs/tab_manager.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import '../terminal/tab_orientation.js';   // abas em coluna quando o terminal fica estreito
import '../ui/bug_report.js';   // botao Relatar um problema, no painel Sobre
// Side-effect import: boots the TCMD tab's embedded interactive shell (PowerShell)
// and self-initializes on DOMContentLoaded.
import '../terminal/shell_terminal.js';
import { CompilationModule } from '../compilation/compilation_module.js';
import { fileTreeManager } from '../tree/file_tree_manager.js';
import { treeView } from '../tree/tree_view.js';
import { fileTreeViewController } from '../tree/file_tree_view_controller.js';
// Side-effect import: registers window.standardTreeRenderer, which the
// controller's 'standard' view renderer looks up at call time.
import '../tree/standard_tree_render.js';
// Side-effect import: VS Code-style git status decorations on the file tree
// (coloured M/A/D/R badges + folder dots). Self-starts on DOMContentLoaded.
import '../tree/git_decorations.js';
// Side-effect import: registers the <aurora-titlebar> custom element (the top
// toolbar / window chrome). No Shadow DOM — see the component for why.
import '../components/aurora-titlebar.js';
// Make sure the view subcontainers exist before any renderer runs.
treeView.initialize();
fileTreeViewController.initialize();
import { projectManager } from '../project/project_manager.js';
import { aiAssistantManager } from '../ui/ai_assistant_manager.js';
import { uiComponentsManager } from '../ui/ui_components.js';
import { compilationFlowManager } from '../compilation/compilation_flow.js';
import { SplitEditorManager } from '../editor/split_editor.js';
import { initAuroraAPI } from '../api/aurora_api.js';
import { initToolRunner } from '../ai/tool_runner.js';
import { initAiSettings } from '../ai/ai_settings.js';

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

// --- Initialization on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize core components first
    TabManager.initialize();
    fileTreeManager.initialize();
    projectManager.initialize();
    // Exposed for AuroraAPI.project.createProject/openProject, which need
    // loadProject to actually open a project after creating it.
    window.projectManager = projectManager;
    uiComponentsManager.initialize();
    compilationFlowManager.initialize();

    // Split editor: initialize layout. (It keeps the split button in sync by
    // listening to TabManager's aurora:editing-file-changed event — no
    // monkey-patching of activateTab / _closePreviewSilently.)
    SplitEditorManager.initialize();
    window.SplitEditorManager = SplitEditorManager;

    // Expor globalmente para o Command Palette
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

    // Initialize global terminal manager and expose the instance — the
    // AuroraAPI's terminal namespace reaches for it through window so
    // it doesn't need to be wired through every constructor.
    window.globalTerminalManager = window.initializeGlobalTerminalManager();

    // "New File" button — opens the same Verilog / Python (cocotb) picker
    // as right-clicking empty space in the file tree, anchored just below
    // the button. A generic save dialog "create any file" makes no sense
    // here: the tree only groups Verilog and CMM/Python sources, so the
    // button offers exactly those two. projectTreeManager owns the file
    // tree, so the menu and its create flows live there; this just
    // positions and shows it (falls back to createNewFile if unavailable).
    const newFileBtn = document.getElementById('new-file') || document.getElementById('new-verilog-file');
    if (newFileBtn) {
        newFileBtn.addEventListener('click', () => {
            const mgr = window.projectTreeManager;
            if (!mgr?.showCreateMenu) {
                mgr?.createNewFile?.();   // fallback if the picker isn't available
                return;
            }
            const rect = newFileBtn.getBoundingClientRect();
            mgr.showCreateMenu(rect.left, rect.bottom + 4);
        });
    }

    // Command Palette is auto-initialized via its own DOMContentLoaded listener

    // window.AuroraAPI — Phase A facade. Behaviour-neutral: nothing in
    // the UI is rewired yet, the surface is just *available* for the
    // upcoming Aurora Intelligence panel and for incremental migration
    // of toolbar handlers in Phase B.
    initAuroraAPI();

    // Aurora Intelligence tool runner — listens for tool-exec requests
    // from the chat backend and dispatches them against AuroraAPI
    // (with ask-before-write confirmation). Must run after initAuroraAPI.
    initToolRunner();

    // Hook the spec_runner audit/terminal callbacks. Done here (not in
    // spec_runner.js itself) so the module stays pure-importable from
    // tests and CLI tooling — only the live renderer wires the IPC.
    setAuditHook((entry) => {
        try { window.aiAPI?.auditOverrideApplied?.(entry); } catch (_) { /* fire-and-forget */ }
    });
    setTerminalHook((channel, message, level) => {
        try {
            // Reuse TerminalManager from compilation_module.js — same
            // 'tips' (blue) styling we use for AI-driven hints elsewhere.
            window._latestCompilationModule?.terminalManager?.appendToTerminal?.(channel, message, level || 'tips');
        } catch (_) { /* terminal not ready — skip silently */ }
    });

    // Toolbar badges + right-click-to-clear for active overrides.
    import('../compilation/override_badges.js').then(({ initOverrideBadges }) => {
        try { initOverrideBadges(); }
        catch (_) { /* badges are decorative; never block boot */ }
    }).catch(() => { /* missing module — no badges, pipeline still works */ });

    // Build the BYOK provider cards in Settings → AI Assistant.
    initAiSettings();
});

// --- Initialization on Window Load ---
window.onload = () => {
    initMonaco();
    aiAssistantManager.initialize();

    const aiBtn = document.getElementById('aiButton');
    if (aiBtn) {
        aiBtn.addEventListener('click', () => aiAssistantManager.toggle());
    }

    // Tell the splash screen the renderer finished booting so it can
    // fill its real-progress bar to 100% and hand off to this window.
    // Two rAFs = wait for Monaco's first layout/paint before signalling.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        electronAPI?.splashNotifyReady?.();
    }));

    // Post-update confirmation toast — main/updater.js persists the
    // running version to userData; a mismatch on the next launch means
    // SAPHO just installed an update. The handler is one-shot in main
    // (clears the flag after first read), so subsequent windows don't
    // re-toast. Delay the toast until after the splash → main handoff
    // (~1s splash fill + 1s reveal) so it doesn't compete with the
    // window appear animation.
    electronAPI?.getPostUpdateStatus?.().then((status) => {
        if (!status || !status.justUpdated) return;
        setTimeout(() => {
            const version = status.currentVersion;
            const title = window.t
                ? window.t('updates.upToDateTitle')
                : "You're up to date";
            const body = window.t
                ? window.t('updates.upToDateBody', { version })
                : `SAPHO has been updated to version <strong>${version}</strong>.`;
            window.showNotification?.(body, 'success', 8000, title);
        }, 2800);
    }).catch(() => { /* IPC failure here shouldn't break boot */ });
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
        electronAPI.openFolder(currentProjectPath);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const websiteLink = document.getElementById('website-link');
    
    if (websiteLink) {
        websiteLink.addEventListener('click', (e) => {
            e.preventDefault();
            // CORREÇÃO AQUI: Usando a API exposta pelo preload
            electronAPI.openExternal('https://nipscern.com');
        });
    }
});
