/**
 * fechar_abas.ts: fechar uma aba (com a pergunta de salvar so na ultima
 * instancia do arquivo), fechar a previa em silencio, fechar todas, e reabrir
 * a ultima fechada.
 *
 * Saiu do tab_manager em 05/10/2026, no formato dos outros mixins da pasta:
 * metodos que usam `this`, instalados no TabManager por Object.assign.
 */

import { electronAPI } from '../app/electron_api.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showUnsavedChangesDialog } from './dialogo_nao_salvo.js';
import type * as Monaco from 'monaco-editor';

/** Uma aba fechada, para o Ctrl+Shift+T. */
type AbaFechada = { filePath: string, content: string, timestamp: number };

/** O que este mixin usa do TabManager. */
export interface AnfitriaoDoFechar {
    tabs: Map<string, unknown>;
    unsavedChanges: Set<string>;
    untitledDocuments: Map<string, unknown>;
    editorStates: Map<string, unknown>;
    viewerInstances: Map<string, HTMLElement>;
    pdfStateIntervals: Map<string, ReturnType<typeof setInterval>>;
    surferViews: Map<string, { tabId: string, pageUrl: string }>;
    prismViews: Map<string, unknown>;
    closedTabsStack: AbaFechada[];
    previewTab: string | null;
    activeTab: string | null;
    isClosingTab: boolean;
    isBinaryFile(filePath: string): boolean;
    isUntitledPath(filePath: string): boolean;
    getDisplayName(filePath: string): string;
    stopWatchingFile(filePath: string): unknown;
    stopPeriodicFileCheck(): void;
    updateTabsContainerVisibility(): void;
    updateContextPath(filePath: string | null): void;
    activateTab(filePath: string): void;
    addTab(filePath: string, content?: string | null, options?: Record<string, unknown>): void;
    showOverlay(): void;
    markFileAsModified(filePath: string): void;
    saveFile(filePath?: string | null): Promise<boolean>;
}

/** Os metodos deste mixin. */
export interface FecharAbas {
    closeAllTabs(): Promise<void>;
    getInstanceCount(filePath: string | null | undefined): number;
    _closePreviewSilently(filePath: string): void;
    closeTab(filePath: string): Promise<void>;
    reopenLastClosedTab(): Promise<void>;
}

export const fecharAbas: FecharAbas & ThisType<AnfitriaoDoFechar & FecharAbas> = {
    // Add this method to close all tabs
    async closeAllTabs() {
        // Create a copy of the tabs keys to avoid modification during iteration
        const openTabs = Array.from(this.tabs.keys());

        // Close each tab
        for (const filePath of openTabs) {
            await this.closeTab(filePath);
        }
    },

    /**
     * How many open editor instances point at this file? Counts the main
     * pane tab plus every split-pane tab. Used by the close flow to decide
     * whether closing this view should prompt for unsaved changes, only
     * the LAST instance triggers the prompt; earlier ones just dispose
     * their view, since the shared model (and the user's edits) survives
     * in the remaining instances.
     */
    getInstanceCount(filePath) {
        if (!filePath) return 0;
        let count = this.tabs.has(filePath) ? 1 : 0;
        const split = window.SplitEditorManager;
        if (split && Array.isArray(split.panes)) {
            for (const pane of split.panes) {
                if (pane?.tabs?.has?.(filePath)) count += 1;
            }
        }
        return count;
    },

    // Silently close preview tab without dialogs
    _closePreviewSilently(filePath) {
        if (!this.tabs.has(filePath)) return;
        // Remove from UI
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) tab.remove();
        // Cleanup editor
        if (!this.isBinaryFile(filePath)) {
            EditorManager.closeEditor(filePath);
        }
        this.tabs.delete(filePath);
        this.unsavedChanges.delete(filePath);
        if (this.isUntitledPath(filePath) && !window.SharedModelRegistry?.has?.(filePath)) {
            this.untitledDocuments.delete(filePath);
        }
        this.editorStates.delete(filePath);
        this.stopWatchingFile(filePath);
        this.previewTab = null;
        this.updateTabsContainerVisibility();
        // If this was the active tab, show overlay or activate another
        if (this.activeTab === filePath) {
            const remaining = Array.from(this.tabs.keys());
            if (remaining.length > 0) {
                this.activateTab(remaining[remaining.length - 1]);
            } else {
                this.activeTab = null;
                this.showOverlay();
                document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
                    detail: { filePath: null },
                }));
            }
        }
    },

    // Enhanced closeTab method
    // Enhanced closeTab with viewer cleanup
    async closeTab(filePath) {
        // Prevent multiple simultaneous closes
        if (this.isClosingTab) return;
        this.isClosingTab = true;

        try {
            const wasUntitled = this.isUntitledPath(filePath);
            // Handle unsaved changes for text files, but only when THIS is
            // the final instance. If the file is also open in a split pane,
            // the shared model (and the user's edits) will outlive this view,
            // so closing the main pane's tab is non-destructive and we skip
            // the prompt. VS Code does the same thing: closing one pane's
            // copy of a dirty file doesn't ask anything; only the last one
            // does.
            const isLastInstance = this.getInstanceCount(filePath) <= 1;
            if (
                isLastInstance
                && !this.isBinaryFile(filePath)
                && this.unsavedChanges.has(filePath)
            ) {
                const fileName = this.getDisplayName(filePath);
                const result = await showUnsavedChangesDialog(fileName);

                switch (result) {
                case 'save':
                    try {
                        const saved = await this.saveFile(filePath);
                        if (saved === false) return;
                    } catch (error) {
                        console.error('Failed to save file:', error);
                    }
                    break;
                case 'dont-save':
                    break;
                case 'cancel':
                default:
                    return;
                }
            }

            // A aba do Surfer leva o servidor junto: o processo headless so
            // existe para servir esta aba, e sem isto ele viraria orfao ate o
            // fechamento da IDE.
            if (this.surferViews.has(filePath)) {
                const { tabId } = this.surferViews.get(filePath) as { tabId: string };
                this.surferViews.delete(filePath);
                try { window.electronAPI?.surferTabStop?.(tabId); } catch (_) { /* best-effort */ }
            }
            // A aba do PRISM nao tem processo por tras: fechar e so esquecer.
            this.prismViews.delete(filePath);
            // Clean up viewer instance
            if (this.viewerInstances.has(filePath)) {
                const viewer = this.viewerInstances.get(filePath);
                if (viewer && viewer.parentNode) {
                    viewer.remove();
                }
                this.viewerInstances.delete(filePath);
            }
            // Stop the PDF state-tracking poll, if any (see setupPdfStateTracking).
            if (this.pdfStateIntervals.has(filePath)) {
                clearInterval(this.pdfStateIntervals.get(filePath));
                this.pdfStateIntervals.delete(filePath);
            }

            // Add to closed tabs stack
            if (!wasUntitled) {
                const currentContent = this.tabs.get(filePath) as string;
                this.closedTabsStack.push({
                    filePath: filePath,
                    content: currentContent,
                    timestamp: Date.now()
                });

                if (this.closedTabsStack.length > 10) {
                    this.closedTabsStack.shift();
                }
            }

            // Remove tab from UI
            const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
            if (tab) {
                tab.remove();
            }

            this.stopWatchingFile(filePath);

            if (this.tabs.size === 0) {
                this.stopPeriodicFileCheck();
            }

            // Clean up editor and data
            if (!this.isBinaryFile(filePath)) {
                EditorManager.closeEditor(filePath);
            }

            this.tabs.delete(filePath);
            // Only clear the global "this file is dirty" flag if no other
            // pane still holds the (dirty) shared model. Otherwise the
            // surviving split tab's yellow dot would be wiped while the
            // buffer it represents still has unsaved edits.
            const registry = window.SharedModelRegistry;
            const survivesDirty = registry?.has?.(filePath) && registry?.isDirty?.(filePath);
            if (!survivesDirty) {
                this.unsavedChanges.delete(filePath);
            }
            if (wasUntitled && !registry?.has?.(filePath)) {
                this.untitledDocuments.delete(filePath);
            }
            this.editorStates.delete(filePath);
            if (this.previewTab === filePath) this.previewTab = null;
            this.updateTabsContainerVisibility();

            // Handle active tab switching
            if (this.activeTab === filePath) {
                const remainingTabs = Array.from(this.tabs.keys());

                if (remainingTabs.length > 0) {
                    this.activateTab(remainingTabs[remainingTabs.length - 1]);
                } else {
                    // No tabs left - show overlay
                    this.activeTab = null;
                    this.updateContextPath(null);
                    this.showOverlay();
                    document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
                        detail: { filePath: null },
                    }));

                    // Clear the editor
                    const mainEditor = EditorManager.activeEditor;
                    if (mainEditor) {
                        mainEditor.setValue('');
                        const model = mainEditor.getModel();
                        if (model) {
                            (window.monaco as typeof Monaco).editor.setModelLanguage(model, 'plaintext');
                        }
                    }
                }
            }

        } finally {
            this.isClosingTab = false;
        }
    },

    // Fixed reopenLastClosedTab method
    async reopenLastClosedTab() {
        if (this.closedTabsStack.length === 0) return;

        const closedTab = this.closedTabsStack.pop() as AbaFechada;
        const {
            filePath,
            content
        } = closedTab;

        try {
            // Check if tab is already open
            if (this.tabs.has(filePath)) {
                this.activateTab(filePath);
                return;
            }

            // Try to read current file content
            let currentContent;
            try {
                currentContent = await electronAPI.readFile(filePath);
            } catch (error) {
                // File might not exist anymore, use stored content
                currentContent = content;
            }

            // Recreate the tab
            this.addTab(filePath, currentContent);

            // If content was different when closed, restore it and mark as modified
            if (content !== currentContent) {
                const editor = EditorManager.getEditorForFile(filePath);
                if (editor) {
                    editor.setValue(content);
                    this.markFileAsModified(filePath);
                }
            }

        } catch (error) {
            console.error('Error reopening tab:', error);
        }
    },
};
