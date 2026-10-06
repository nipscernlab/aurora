/**
 * salvar_abas.ts: gravar o arquivo de uma aba, o que esta em edicao, ou todos
 * os que tem mudanca.
 *
 * Saiu do tab_manager em 05/10/2026, no formato dos outros mixins da pasta:
 * metodos que usam `this`, instalados no TabManager por Object.assign.
 *
 * O texto vem do modelo compartilhado (window.SharedModelRegistry), e nao de
 * um editor em particular, para salvar do mesmo jeito tendo a pessoa digitado
 * no painel principal ou num dividido. Depois de gravar, o registro marca a
 * versao atual como a salva, e e isso que tira o ponto de "sujo" de todos os
 * paineis. O documento sem nome vai para o saveUntitledFile, que pede o nome.
 */

import { electronAPI } from '../app/electron_api.js';
import { EditorManager } from '../editor/monaco_editor.js';

/** O que o salvar usa do TabManager. */
interface AnfitriaoDoSalvar {
    tabs: Map<string, unknown>;
    unsavedChanges: Set<string>;
    lastModifiedTimes: Map<string, number>;
    getEditingFilePath(): string | null;
    isBinaryFile(filePath: string): boolean;
    isUntitledPath(filePath: string): boolean;
    saveUntitledFile(filePath: string): Promise<boolean>;
    markFileAsSaved(filePath: string): void;
}

/** Os metodos deste mixin. */
export interface SalvarAbas {
    saveCurrentFile(): Promise<boolean | undefined>;
    saveAllFiles(): Promise<void>;
    saveFile(filePath?: string | null): Promise<boolean>;
}

/** O modelo do arquivo: o compartilhado, ou o do editor que o mostra. */
function modeloDe(filePath: string) {
    return window.SharedModelRegistry?.getModel?.(filePath)
        ?? EditorManager.getEditorForFile(filePath)?.getModel();
}

/** A data no disco; sem ela, a comparacao de texto do vigia resolve. */
async function dataNoDisco(filePath: string) {
    const stats = await electronAPI.getFileStats(filePath) as { mtime: number };
    return stats.mtime;
}

export const salvarAbas: SalvarAbas & ThisType<AnfitriaoDoSalvar & SalvarAbas> = {
    // Comprehensive save method. Reads from the shared model rather than
    // a specific editor, so saving works the same whether the user typed
    // in the main pane or in a split. After the disk write, we pin the
    // current altVersionId as the new "saved" snapshot via the registry:
    // that's what propagates the cleared-dirty state to every other pane.
    async saveCurrentFile() {
        const currentPath = this.getEditingFilePath();
        if (!currentPath) return;
        if (this.isBinaryFile(currentPath)) return;

        if (this.isUntitledPath(currentPath)) {
            return this.saveUntitledFile(currentPath);
        }

        try {
            const model = modeloDe(currentPath);
            if (!model) return false;

            const content = model.getValue();

            // Update stored content first
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await electronAPI.writeFile(currentPath, content);
            window.SharedModelRegistry?.markSaved?.(currentPath);
            this.markFileAsSaved(currentPath);

            // Update last modified time
            try {
                this.lastModifiedTimes.set(currentPath, await dataNoDisco(currentPath));
            } catch (_) {
                // Ignore stats errors
            }

        } catch (error) {
            console.error('Error saving file:', error);
            return false;
        }
        return true;
    },

    // Enhanced saveAllFiles method with undo history preservation. Walks
    // every file the registry knows about (main + split-only), so a file
    // opened only in a split pane still saves on Ctrl+K S.
    async saveAllFiles() {
        const registry = window.SharedModelRegistry;
        if (!registry) return;

        // Build the universe of file paths we track: main-pane tabs plus
        // anything the split panes hold that the main pane doesn't.
        const paths = new Set(this.tabs.keys());
        const split = window.SplitEditorManager;
        if (split && Array.isArray(split.panes)) {
            for (const pane of split.panes) {
                pane?.tabs?.forEach?.((_info, p) => paths.add(p));
            }
        }

        for (const filePath of paths) {
            if (this.isBinaryFile(filePath)) continue;
            if (this.isUntitledPath(filePath)) {
                if (registry.isDirty(filePath) || this.unsavedChanges.has(filePath)) {
                    await this.saveUntitledFile(filePath);
                }
                continue;
            }
            if (!registry.isDirty(filePath)) continue;

            const model = registry.getModel(filePath)
                ?? EditorManager.getEditorForFile(filePath)?.getModel();
            if (!model) continue;

            const currentContent = model.getValue();
            try {
                this.tabs.set(filePath, currentContent);
                await electronAPI.writeFile(filePath, currentContent);
                registry.markSaved(filePath);
                this.markFileAsSaved(filePath);

                try {
                    this.lastModifiedTimes.set(filePath, await dataNoDisco(filePath));
                } catch (_) { /* stats errors are non-fatal */ }
            } catch (error) {
                console.error(`Error saving file ${filePath}:`, error);
            }
        }
    },

    // Enhanced saveFile method with undo history preservation
    async saveFile(filePath = null) {
        const currentPath = filePath || this.getEditingFilePath();
        if (!currentPath) return false;

        // Don't save binary files
        if (this.isBinaryFile(currentPath)) return true;

        if (this.isUntitledPath(currentPath)) {
            return this.saveUntitledFile(currentPath);
        }

        try {
            const model = modeloDe(currentPath);
            if (!model) {
                throw new Error('Editor model not found for file');
            }

            const content = model.getValue();

            // IMPORTANT: Update our stored content BEFORE writing to disk
            // This helps the external change handler recognize this as our own save
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await electronAPI.writeFile(currentPath, content);

            // Mark as saved
            window.SharedModelRegistry?.markSaved?.(currentPath);
            this.markFileAsSaved(currentPath);

            // Update the last modified time to prevent false external change detection
            try {
                this.lastModifiedTimes.set(currentPath, await dataNoDisco(currentPath));
            } catch (_) {
                // If we can't get stats, that's okay - the content comparison will handle it
            }

            // Sinaliza pra UI que o conteudo deste arquivo mudou em disco
            // por uma acao do usuario no editor. Subscribers (file_mode.js)
            // reclassificam o arquivo (synth vs testbench) e re-persistem
            // no .spf, sem isso, editar um .v adicionando $finish/$dumpvars
            // (= virou testbench) so seria refletido apos refresh manual
            // ou reabrir o projeto.
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('aurora:file-saved', {
                    detail: { path: currentPath, source: 'editor' },
                }));
            }

        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
        return true;
    },
};
