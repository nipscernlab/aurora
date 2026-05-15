/**
 * app_initializer.js — bootstrap do renderer.
 *
 * Responsabilidades:
 *   1. Restaurar a ultima sessao (auto-abre o ultimo projeto salvo em
 *      localStorage), se houver.
 *   2. Bookkeeping do last-project pra Recent Projects.
 *
 * Mode-switching, radio listeners, e o evento mode-state-changed
 * sairam quando os tres modos (Processor/Project/Verilog) viraram um
 * so. Aurora roda em modo unico desde 2026-05.
 */

import { showDialog } from '../ui/dialog_manager.js';
import { projectManager } from '../project/project_manager.js';

class AppInitializer {
    constructor() {
        this.isInitialized = false;
        this.lastProjectPath = null;

        this.STORAGE_KEYS = {
            LAST_PROJECT: 'aurora-last-project-path',
        };
    }

    async initialize() {
        if (this.isInitialized) {
            console.warn('⚠️ AppInitializer already initialized');
            return;
        }

        console.log('🚀 Initializing Aurora IDE...');

        try {
            await this.restoreLastSession();
            this.isInitialized = true;
            console.log('✅ Aurora IDE initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Aurora IDE:', error);
            await showDialog({
                title: 'Initialization Error',
                message: `Failed to initialize the application: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
            });
        }
    }

    async restoreLastSession() {
        console.log('🔄 Attempting to restore last session...');

        const lastProjectPath = localStorage.getItem(this.STORAGE_KEYS.LAST_PROJECT);

        if (!lastProjectPath) {
            console.log('ℹ️ No previous project found');
            return;
        }

        try {
            const exists = await window.electronAPI.fileExists(lastProjectPath);

            if (!exists) {
                console.warn('⚠️ Last project file not found');
                localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
                this._resetProjectNameLabel();

                await showDialog({
                    title: 'Project Not Found',
                    message: 'The previously opened project could not be found.',
                    buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
                });
                return;
            }

            console.log(`📂 Loading last project: ${lastProjectPath}`);
            await projectManager.loadProject(lastProjectPath);
            this.lastProjectPath = lastProjectPath;

            console.log('✅ Session restored successfully');

        } catch (error) {
            console.error('❌ Failed to restore session:', error);
            localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
            this._resetProjectNameLabel();

            await showDialog({
                title: 'Error Restoring Session',
                message: `Could not restore your previous session: ${error.message}`,
                buttons: [{ label: 'OK', action: 'close', type: 'cancel' }]
            });
        }
    }

    /**
     * Reset the file-tree project name label back to "No project open".
     * Called when an auto-load attempt fails so the synchronous "Loading…"
     * placeholder set in index.html doesn't get stuck on screen.
     */
    _resetProjectNameLabel() {
        const el = document.getElementById('current-spf-name');
        if (!el) return;
        // Re-instala o data-i18n pra que locale changes futuros
        // re-traduzam — updateProjectNameUI o remove quando seta
        // um nome de projeto real.
        el.setAttribute('data-i18n', 'fileTree.noProject');
        el.textContent = window.t ? window.t('fileTree.noProject') : 'No project open';
    }

    /**
     * Save current project as last opened
     */
    saveCurrentProject(projectPath) {
        if (projectPath) {
            this.lastProjectPath = projectPath;
            localStorage.setItem(this.STORAGE_KEYS.LAST_PROJECT, projectPath);
        }
    }

    /**
     * Forget the last-opened project. Called from close_project.js so a
     * "Close Project" + restart doesn't auto-reopen what the user just
     * closed.
     */
    clearLastProject() {
        this.lastProjectPath = null;
        try {
            localStorage.removeItem(this.STORAGE_KEYS.LAST_PROJECT);
        } catch (_e) {
            /* localStorage failure is non-fatal */
        }
    }

}

const appInitializer = new AppInitializer();

if (typeof window !== 'undefined') {
    window.appInitializer = appInitializer;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => appInitializer.initialize());
} else {
    appInitializer.initialize();
}

export { appInitializer };
