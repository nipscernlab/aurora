/**
 * External-file-change detection for the tab system.
 *
 * Each open file is watched two ways:
 *   1. chokidar via electronAPI.watchFile (push)
 *   2. a 2-second periodic stat poll (pull, fallback for editors that race
 *      with the OS file events on Windows)
 *
 * When a change is observed, we read the file from disk and either silently
 * sync the editor (no local edits) or pop a conflict dialog (local edits).
 *
 * Mixin shape: methods reference `this`, installed onto TabManager via
 * Object.assign at the bottom of tab_manager.js.
 */

import { electronAPI } from '../app/electron_api.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showDialog } from '../ui/dialog_manager.js';
import type * as Monaco from 'monaco-editor';

type Editor = Monaco.editor.IStandaloneCodeEditor;

/** O que o vigia le e escreve no TabManager, que o recebe por Object.assign. */
interface AnfitriaoDoVigia {
    tabs: Map<string, unknown>;
    fileWatchers: Map<string, string | null>;
    lastModifiedTimes: Map<string, number>;
    externalChangeQueue: Set<string>;
    unsavedChanges: Set<string>;
    periodicCheckInterval: ReturnType<typeof setInterval> | null;
    isCheckingFiles: boolean;
    _fileCheckFocusBound?: boolean;
    isUntitledPath?(filePath: string): boolean;
    isEmbeddedView?(filePath: string): boolean;
    markFileAsSaved(filePath: string): void;
    saveFile(filePath: string): Promise<unknown>;
}

/** Os metodos deste mixin. */
export interface VigiaDasAbas {
    startPeriodicFileCheck(): void;
    stopPeriodicFileCheck(): void;
    checkAllOpenFilesForChanges(): Promise<void>;
    checkSingleFileForChanges(filePath: string): Promise<void>;
    initFileChangeListeners(): void;
    restartFileWatcher(filePath: string): Promise<void>;
    startWatchingFile(filePath: string): Promise<void>;
    stopWatchingFile(filePath: string): Promise<void>;
    stopAllWatchers(): void;
    handleExternalFileChange(filePath: string): Promise<void>;
    updateTabWithExternalContent(filePath: string, newContent: string, editor: Editor): Promise<void>;
    showFileConflictDialog(filePath: string, diskContent?: string, editorContent?: string): Promise<string>;
    handleConflictResolution(filePath: string, resolution: string, diskContent: string, editorContent?: string): Promise<void>;
    showExternalChangeNotification(filePath: string, action: string): void;
}

/** O que o stat do main devolve; nulo ou sem data lanca adiante, dentro do try de quem chama. */
type Stat = { mtime: number };

const tr = (k: string, p?: Record<string, unknown>) => (window.t ? window.t(k, p) : k);

export const tabWatchers: VigiaDasAbas & ThisType<AnfitriaoDoVigia & VigiaDasAbas> = {
    // -- Periodic poll --------------------------------------------------------

    startPeriodicFileCheck() {
        if (this.periodicCheckInterval) {
            clearInterval(this.periodicCheckInterval);
        }

        const runCheck = async () => {
            if (this.isCheckingFiles || this.tabs.size === 0) return;
            this.isCheckingFiles = true;
            try {
                await this.checkAllOpenFilesForChanges();
            } catch (error) {
                console.error('Error in periodic file check:', error);
            } finally {
                this.isCheckingFiles = false;
            }
        };

        // chokidar (push) is the primary change signal; this stat poll is only a
        // fallback for the Windows race where OS events lag (P15). It now runs
        // ONLY while the window is focused, chokidar keeps pushing while you're
        // away, so the poll's disk churn isn't needed in the background, and we
        // do a single catch-up check the moment focus returns, so nothing edited
        // externally while away is missed.
        this.periodicCheckInterval = setInterval(() => {
            if (document.hidden || !document.hasFocus()) return;
            runCheck();
        }, 4000);

        if (!this._fileCheckFocusBound) {
            this._fileCheckFocusBound = true;
            window.addEventListener('focus', runCheck);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) runCheck();
            });
        }
    },

    stopPeriodicFileCheck() {
        if (this.periodicCheckInterval) {
            clearInterval(this.periodicCheckInterval);
            this.periodicCheckInterval = null;
        }
    },

    async checkAllOpenFilesForChanges() {
        const filesToCheck = Array.from(this.tabs.keys());

        // Batches of 3 with a tiny gap so a slow disk doesn't stall the loop.
        const batchSize = 3;
        for (let i = 0; i < filesToCheck.length; i += batchSize) {
            const batch = filesToCheck.slice(i, i + batchSize);
            await Promise.allSettled(
                batch.map((filePath) => this.checkSingleFileForChanges(filePath)),
            );
            if (i + batchSize < filesToCheck.length) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    },

    async checkSingleFileForChanges(filePath) {
        try {
            if (!this.tabs.has(filePath)) return;
            if (this.isUntitledPath?.(filePath)) return;
            // A aba do PRISM (prism://PRISM) e a do Surfer nao sao arquivos: a
            // ronda dava stat em "prism:\PRISM" e enchia o log de ENOENT.
            if (this.isEmbeddedView?.(filePath)) return;

            const stats = await electronAPI.getFileStats(filePath) as Stat;
            const lastKnownTime = this.lastModifiedTimes.get(filePath);

            if (!lastKnownTime || stats.mtime > lastKnownTime) {
                await this.handleExternalFileChange(filePath);
            }
        } catch (error) {
            // ENOENT = file deleted while we held a tab on it. Don't yank the
            // tab, the user might still want to save back to that path.
            const msg = (error as Error).message;
            if (msg.includes('ENOENT') || msg.includes('no such file')) {
                this.stopWatchingFile(filePath);
            } else {
                console.error(`Error checking file ${filePath}:`, error);
            }
        }
    },

    // -- Push-side watcher (chokidar via main) -------------------------------

    initFileChangeListeners() {
        electronAPI.onFileChanged((filePath) => {
            this.handleExternalFileChange(filePath);
        });

        electronAPI.onFileWatcherError((filePath, error) => {
            console.error(`File watcher error for ${filePath}:`, error);
            // Try to restart the watcher after a delay.
            setTimeout(() => this.restartFileWatcher(filePath), 2000);
        });
    },

    async restartFileWatcher(filePath) {
        try {
            if (!this.tabs.has(filePath)) return;
            if (this.isUntitledPath?.(filePath)) return;

            await this.stopWatchingFile(filePath);
            await this.startWatchingFile(filePath);
        } catch (error) {
            console.error(`Failed to restart watcher for ${filePath}:`, error);
        }
    },

    async startWatchingFile(filePath) {
        if (this.isUntitledPath?.(filePath)) return;
        if (this.isEmbeddedView?.(filePath)) return;
        if (this.fileWatchers.has(filePath)) return;

        try {
            const stats = await electronAPI.getFileStats(filePath) as Stat;
            this.lastModifiedTimes.set(filePath, stats.mtime);

            const watcherId = await electronAPI.watchFile(filePath);
            this.fileWatchers.set(filePath, watcherId);
        } catch (error) {
            console.error(`Error starting file watcher for ${filePath}:`, error);
        }
    },

    async stopWatchingFile(filePath) {
        const watcher = this.fileWatchers.get(filePath);
        if (!watcher) return;
        // Drop local state synchronously so it's consistent even while the
        // close is in flight. The IPC resolves only when the main process has
        // awaited chokidar's watcher.close(), i.e. the OS handle is actually
        // released, so awaiting this is the real "stopped" signal a restart
        // can rely on (vs the old blind setTimeout(500)).
        this.fileWatchers.delete(filePath);
        this.lastModifiedTimes.delete(filePath);
        try {
            await electronAPI.stopWatchingFile(watcher);
        } catch (_) { /* main may have already torn it down */ }
    },

    stopAllWatchers() {
        for (const [filePath] of this.fileWatchers) {
            this.stopWatchingFile(filePath);
        }
        this.stopPeriodicFileCheck();
    },

    // -- Change handling ------------------------------------------------------

    async handleExternalFileChange(filePath) {
        // De-dupe concurrent triggers for the same file.
        if (this.externalChangeQueue.has(filePath)) return;
        this.externalChangeQueue.add(filePath);

        try {
            const stats = await electronAPI.getFileStats(filePath) as Stat;
            const lastKnownTime = this.lastModifiedTimes.get(filePath);

            // 1s tolerance for clock skew between filesystem and process.
            if (lastKnownTime && Math.abs(stats.mtime - lastKnownTime) < 1000) return;

            this.lastModifiedTimes.set(filePath, stats.mtime);
            if (!this.tabs.has(filePath)) return;

            const editor = EditorManager.getEditorForFile(filePath);
            if (!editor) return;

            const currentEditorContent = editor.getValue();
            const originalTabContent = this.tabs.get(filePath);

            const newFileContent = await electronAPI.readFile(filePath);

            // If the editor already matches what's on disk, this was almost
            // certainly our own save round-tripping back to us. Just store
            // the new content; rebuilding the editor would nuke undo history.
            if (currentEditorContent === newFileContent) {
                this.tabs.set(filePath, newFileContent);
                this.markFileAsSaved(filePath);
                return;
            }

            const hasUnsavedChanges = this.unsavedChanges.has(filePath);
            const editorContentChanged = currentEditorContent !== originalTabContent;

            if (hasUnsavedChanges || editorContentChanged) {
                const resolution = await this.showFileConflictDialog(filePath, newFileContent, currentEditorContent);
                await this.handleConflictResolution(filePath, resolution, newFileContent, currentEditorContent);
            } else {
                await this.updateTabWithExternalContent(filePath, newFileContent, editor);
            }
        } catch (error) {
            console.error(`Error handling external change for ${filePath}:`, error);
        } finally {
            this.externalChangeQueue.delete(filePath);
        }
    },

    async updateTabWithExternalContent(filePath, newContent, editor) {
        const currentContent = editor.getValue();

        // Identical content: just update bookkeeping. Touching the model
        // would clear undo history.
        if (currentContent === newContent) {
            this.tabs.set(filePath, newContent);
            this.markFileAsSaved(filePath);
            return;
        }

        // Sem posicao, o acesso lanca no try abaixo e o cursor volta ao inicio.
        const position = editor.getPosition() as Monaco.Position;
        const scrollTop = editor.getScrollTop();

        // Use pushEditOperations (not setValue) so the swap is undoable.
        const model = editor.getModel() as Monaco.editor.ITextModel;
        const fullRange = model.getFullModelRange();
        model.pushEditOperations(
            [],
            [{ range: fullRange, text: newContent, forceMoveMarkers: true }],
            () => null,
        );

        // Best-effort cursor + scroll restoration.
        try {
            const lineCount = model.getLineCount();
            if (position.lineNumber <= lineCount) {
                const maxColumn = model.getLineMaxColumn(position.lineNumber);
                editor.setPosition({
                    lineNumber: position.lineNumber,
                    column: Math.min(position.column, maxColumn),
                });
            }
        } catch (_) {
            editor.setPosition({ lineNumber: 1, column: 1 });
        }
        editor.setScrollTop(scrollTop);

        this.tabs.set(filePath, newContent);
        this.markFileAsSaved(filePath);
        this.showExternalChangeNotification(filePath, 'updated');
    },

    /**
     * Routes through the canonical showDialog so the conflict prompt picks up
     * the same compact styling as every other confirm. The original
     * implementation built its own .conflict-modal which had no CSS rule.
     */
    async showFileConflictDialog(filePath /*, diskContent, editorContent */) {
        const fileName = filePath.split(/[\\/]/).pop();
        const action = await showDialog({
            title: tr('dialog.fileConflict.title'),
            message: tr('dialog.fileConflict.message', { name: fileName }),
            variant: 'warning',
            buttons: [
                { label: tr('dialog.fileConflict.keepEditor'),    action: 'keep-editor',     type: 'cancel'    },
                { label: tr('dialog.fileConflict.useDisk'),       action: 'use-disk',        type: 'dont-save' },
                { label: tr('dialog.fileConflict.saveAndReload'), action: 'save-and-reload', type: 'save'      },
            ],
        });
        // showDialog resolves to 'cancel' on Esc, map that to keep-editor
        // since that's the safest default (no overwrite of user's work).
        return action === 'cancel' ? 'keep-editor' : action;
    },

    async handleConflictResolution(filePath, resolution, diskContent /*, editorContent */) {
        const editor = EditorManager.getEditorForFile(filePath);
        if (!editor) return;

        switch (resolution) {
            case 'keep-editor':
                await this.saveFile(filePath);
                this.showExternalChangeNotification(filePath, 'kept-editor');
                break;

            case 'use-disk':
                await this.updateTabWithExternalContent(filePath, diskContent, editor);
                break;

            case 'save-and-reload': {
                await this.saveFile(filePath);
                // Re-read in case the save itself triggered yet another change.
                const freshContent = await electronAPI.readFile(filePath);
                await this.updateTabWithExternalContent(filePath, freshContent, editor);
                this.showExternalChangeNotification(filePath, 'saved-and-reloaded');
                break;
            }
        }
    },

    showExternalChangeNotification(filePath, action) {
        const fileName = filePath.split(/[\\/]/).pop();
        let message = '';
        switch (action) {
            case 'updated': message = `${fileName} was updated with external changes`; break;
            case 'kept-editor': message = `Kept your version of ${fileName}`; break;
            case 'saved-and-reloaded': message = `Saved and reloaded ${fileName}`; break;
        }
        console.log(message);
    },
};
