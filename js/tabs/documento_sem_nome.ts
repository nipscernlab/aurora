/**
 * documento_sem_nome.ts: o documento que ainda nao foi salvo ("Untitled-N")
 * e o arquivo novo pelo dialogo de salvar.
 *
 * Saiu do tab_manager em 05/10/2026, no formato dos outros mixins da pasta:
 * metodos que usam `this`, instalados no TabManager por Object.assign.
 *
 * O documento sem nome detecta o tipo pelo texto (e a linguagem do editor
 * acompanha), expande o atalho `$cmm` no molde de processador C+-, e ao salvar
 * pede o nome, grava, entra no .spf do projeto e troca a aba sem nome pela do
 * arquivo, em todos os paineis. Um .cmm salvo dentro de um projeto vira um
 * processador: as tres pastas, o fonte com o #PRNAME e a entrada no .spf.
 */

import { electronAPI } from '../app/electron_api.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showCardNotification } from '../ui/notification.js';
import { showDialog } from '../ui/dialog_manager.js';
import {
    detectDocumentType,
    getDefaultBaseNameForDocumentType,
    getExtensionForDocumentType,
    getLanguageForDocumentType,
    getSaveDialogFilters,
} from '../editor/document_type_detector.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { classifyVerilogContent } from '../project/verilog_classifier.js';
import { addAvailableProcessor } from '../project/processor_list.js';
import {
    basenameOf, withoutExtension, extensionOf, normalizeKey,
    sanitizeProcessorName,
    createCmmTemplate, ensureCmmPrname, typeFromExtension,
    appendDefaultExtension, validateSaveName,
} from './tab_utils.js';
import { nextUntitledPath, type UntitledDocument } from './untitled_docs.js';
import type * as Monaco from 'monaco-editor';

type Editor = Monaco.editor.IStandaloneCodeEditor;
/** A resposta do dialogo de salvar; nula lanca no `result.canceled`, dentro do fluxo de quem chama, como antes. */
type RespostaDoSalvar = { canceled?: boolean, filePath?: string };
/** O monaco global, que o renderer carrega pelo AMD. */
const monacoGlobal = () => window.monaco as typeof Monaco;

/** Onde o .cmm de um processador vai parar: dentro do projeto, as pastas dele; fora, o caminho escolhido. */
type AlvoDoProcessador =
    | { processorName: string, cmmPath: string, projectPath: null }
    | {
        processorName: string, cmmPath: string, projectPath: string,
        processorPath: string, softwarePath: string, hardwarePath: string, simulationPath: string,
    };

/** O que este mixin usa do TabManager. */
export interface AnfitriaoDoSemNome {
    tabs: Map<string, unknown>;
    untitledDocuments: Map<string, UntitledDocument>;
    untitledCounter: number;
    applyingSnippet: Set<string>;
    unsavedChanges: Set<string>;
    editorStates: Map<string, unknown>;
    lastModifiedTimes: Map<string, number>;
    previewTab: string | null;
    activeTab: string | null;
    isUntitledPath(filePath: string): boolean;
    getDisplayName(filePath: string): string;
    getFileIcon(filename: string): string;
    getEditingFilePath(): string | null;
    updateContextPath(filePath: string | null): void;
    addTab(filePath: string, content?: string | null, options?: Record<string, unknown>): void;
    activateTab(filePath: string): void;
    markFileAsModified(filePath: string): void;
    markFileAsSaved(filePath: string): void;
    stopWatchingFile(filePath: string): unknown;
    updateTabsContainerVisibility(): void;
}

/** Os metodos deste mixin. */
export interface DocumentoSemNome {
    createNewFile(): string;
    updateUntitledDocumentType(filePath: string, content: string): string | null;
    expandUntitledSnippet(filePath: string, editor: Editor | null | undefined): boolean;
    updateUntitledTabPresentation(filePath: string): void;
    confirmOverwrite(filePath: string): Promise<boolean>;
    getProcessorCmmTarget(selectedPath: string): Promise<AlvoDoProcessador>;
    choosePathForUntitledFile(filePath: string, content: string): Promise<string | null>;
    registerSavedProjectFile(filePath: string, content: string): Promise<void>;
    registerProcessor(processorName: string): Promise<void>;
    saveCmmProcessorFile(selectedPath: string, content: string):
        Promise<{ filePath: string, content: string, processorName: string } | null>;
    replaceUntitledWithSavedFile(untitledPath: string, savedPath: string, content: string): Promise<void>;
    saveUntitledFile(filePath: string): Promise<boolean>;
    initialContentForType(type: string, filePath: string): string;
    createNewFileFromDialog(): Promise<boolean>;
}

const CMM_SNIPPET_TRIGGER = '$cmm';

function showNotification(message: string, type = 'info', duration = 3000) {
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type, duration);
    } else if (typeof showCardNotification === 'function') {
        showCardNotification(message, type, duration);
    }
}

export const documentoSemNome: DocumentoSemNome & ThisType<AnfitriaoDoSemNome & DocumentoSemNome> = {
    createNewFile() {
        const { filePath, counter } = nextUntitledPath(
            this.untitledDocuments, this.tabs, this.untitledCounter,
        );
        this.untitledCounter = counter;

        this.untitledDocuments.set(filePath, { detectedType: null });
        window.SplitEditorManager?.setFocus?.(0);
        this.addTab(filePath, '');
        this.markFileAsModified(filePath);
        return filePath;
    },

    updateUntitledDocumentType(filePath, content) {
        if (!this.isUntitledPath(filePath) || !window.monaco) return null;

        // E sem nome: a entrada existe.
        const meta = this.untitledDocuments.get(filePath) as UntitledDocument;
        const detectedType = detectDocumentType(content);
        if (meta.detectedType === detectedType) return detectedType;

        meta.detectedType = detectedType;
        this.untitledDocuments.set(filePath, meta);

        const model = window.SharedModelRegistry?.getModel?.(filePath)
            ?? EditorManager.getEditorForFile(filePath)?.getModel();
        if (model) {
            monacoGlobal().editor.setModelLanguage(model, getLanguageForDocumentType(detectedType));
        }

        this.updateUntitledTabPresentation(filePath);
        return detectedType;
    },

    expandUntitledSnippet(filePath, editor) {
        if (!this.isUntitledPath(filePath) || !editor || this.applyingSnippet.has(filePath)) {
            return false;
        }

        const meta = this.untitledDocuments.get(filePath);
        if (meta?.snippetApplied) return false;

        const value = editor.getValue();
        if (value.trim() !== CMM_SNIPPET_TRIGGER) return false;

        this.applyingSnippet.add(filePath);
        try {
            editor.setValue(createCmmTemplate('processor'));
            const nextMeta = {
                ...(this.untitledDocuments.get(filePath) || {}),
                detectedType: 'cmm',
                snippetApplied: true,
            };
            this.untitledDocuments.set(filePath, nextMeta);
            const model = editor.getModel();
            if (model && window.monaco) {
                monacoGlobal().editor.setModelLanguage(model, 'cmm');
            }
            this.updateUntitledTabPresentation(filePath);
            editor.setPosition({ lineNumber: 13, column: 5 });
            editor.focus();
        } finally {
            this.applyingSnippet.delete(filePath);
        }
        return true;
    },

    updateUntitledTabPresentation(filePath) {
        const displayName = this.getDisplayName(filePath);
        const iconClass = this.getFileIcon(displayName);
        document
            .querySelectorAll<HTMLElement>(`.tab[data-path="${CSS.escape(filePath)}"]`)
            .forEach((tab) => {
                tab.title = displayName;
                const icon = tab.querySelector('i');
                if (icon) icon.className = iconClass;
                const name = tab.querySelector('.tab-name');
                if (name) name.textContent = displayName;
            });

        if (this.activeTab === filePath || this.getEditingFilePath() === filePath) {
            this.updateContextPath(filePath);
        }
    },

    async confirmOverwrite(filePath) {
        try {
            const exists = await electronAPI.fileExists(filePath);
            if (!exists) return true;
        } catch (_) {
            return true;
        }

        const fileName = basenameOf(filePath);
        const tr = (k: string, p?: Record<string, unknown>) => (window.t ? window.t(k, p) : k);
        const action = await showDialog({
            title: tr('dialog.overwriteFile.title'),
            message: tr('dialog.overwriteFile.message', { name: fileName }),
            variant: 'warning',
            buttons: [
                { label: tr('dialog.common.cancel'), action: 'cancel', type: 'cancel' },
                { label: tr('dialog.overwriteFile.overwrite'), action: 'overwrite', type: 'save' },
            ],
        });
        return action === 'overwrite';
    },

    async getProcessorCmmTarget(selectedPath) {
        const projectPath = ProjectStore.getProjectPath();
        const processorName = sanitizeProcessorName(withoutExtension(basenameOf(selectedPath)));
        if (!projectPath) {
            return { processorName, cmmPath: selectedPath, projectPath: null };
        }

        const processorPath = await electronAPI.joinPath(projectPath, processorName);
        const softwarePath = await electronAPI.joinPath(processorPath, 'Software');
        const hardwarePath = await electronAPI.joinPath(processorPath, 'Hardware');
        const simulationPath = await electronAPI.joinPath(processorPath, 'Simulation');
        const cmmPath = await electronAPI.joinPath(softwarePath, `${processorName}.cmm`);
        return { processorName, processorPath, softwarePath, hardwarePath, simulationPath, cmmPath, projectPath };
    },

    async choosePathForUntitledFile(filePath, content) {
        const detectedType = this.updateUntitledDocumentType(filePath, content)
            || detectDocumentType(content);
        let suggestedBase = getDefaultBaseNameForDocumentType(detectedType);
        const suggestedExt = getExtensionForDocumentType(detectedType) || 'v';

        while (true) {
            const projectPath = ProjectStore.getProjectPath();
            const defaultFileName = `${suggestedBase}.${suggestedExt}`;
            const defaultPath = projectPath
                ? await electronAPI.joinPath(projectPath, defaultFileName)
                : defaultFileName;

            const result = (await electronAPI.showSaveDialog({
                title: window.t ? window.t('contextMenu.saveNewFile') : 'Save New File',
                defaultPath,
                filters: getSaveDialogFilters(detectedType),
                properties: ['createDirectory', 'showOverwriteConfirmation'],
            })) as RespostaDoSalvar;

            if (result.canceled || !result.filePath) return null;

            const finalPath = appendDefaultExtension(result.filePath, detectedType);
            const validation = validateSaveName(finalPath);
            if (validation.ok) return finalPath;

            suggestedBase = withoutExtension(validation.suggestion);
            showNotification(
                window.t
                    ? window.t('notification.tree.invalidName', {
                        name: basenameOf(finalPath),
                        suggestion: validation.suggestion,
                    })
                    : `"${basenameOf(finalPath)}" has invalid characters. Suggestion: ${validation.suggestion}`,
                'warning',
                4000,
            );
        }
    },

    async registerSavedProjectFile(filePath, content) {
        const ext = extensionOf(filePath);
        if (ext !== 'py' && ext !== 'v') return;

        const spfPath = ProjectStore.getSpfPath();
        if (!spfPath) {
            return;
        }

        const name = basenameOf(filePath);
        const targetKey = normalizeKey(filePath);
        await SpfStore.update(spfPath, (cfg) => {
            const synthFiles = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
            const tbFiles = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];

            const nextSynth = synthFiles.filter((f) => normalizeKey(f?.path) !== targetKey);
            const nextTb = tbFiles.filter((f) => normalizeKey(f?.path) !== targetKey);
            const entry = { name, path: filePath, isTopLevel: false };

            if (ext === 'py' || classifyVerilogContent(content, name) === 'testbench') {
                nextTb.push(entry);
            } else {
                nextSynth.push(entry);
            }

            cfg.synthesizableFiles = nextSynth;
            cfg.testbenchFiles = nextTb;
        });
    },

    async registerProcessor(processorName) {
        const spfPath = ProjectStore.getSpfPath();
        if (!spfPath || !processorName) return;

        await SpfStore.update(spfPath, (cfg) => {
            const processors = Array.isArray(cfg.processors) ? cfg.processors : [];
            const targetLower = processorName.toLowerCase();
            const already = processors.some((p) => {
                const name = typeof p === 'string' ? p : p?.name;
                return typeof name === 'string' && name.toLowerCase() === targetLower;
            });
            if (!already) processors.push({ name: processorName });
            cfg.processors = processors;
        });

        addAvailableProcessor(processorName);
        // Status bar / config panel atualizam via aurora:spf-changed,
        // disparado pelo SpfStore.update acima quando a lista mudou.
    },

    async saveCmmProcessorFile(selectedPath, content) {
        const target = await this.getProcessorCmmTarget(selectedPath);
        const finalContent = ensureCmmPrname(content, target.processorName);

        if (!target.projectPath) {
            const finalPath = appendDefaultExtension(selectedPath, 'cmm');
            if (!await this.confirmOverwrite(finalPath)) return null;
            await electronAPI.writeFile(finalPath, finalContent);
            return { filePath: finalPath, content: finalContent, processorName: target.processorName };
        }

        await electronAPI.mkdir(target.softwarePath);
        await electronAPI.mkdir(target.hardwarePath);
        await electronAPI.mkdir(target.simulationPath);

        if (!await this.confirmOverwrite(target.cmmPath)) return null;

        await electronAPI.writeFile(target.cmmPath, finalContent);
        await this.registerProcessor(target.processorName);
        return { filePath: target.cmmPath, content: finalContent, processorName: target.processorName };
    },

    async replaceUntitledWithSavedFile(untitledPath, savedPath, content) {
        const hadMainTab = this.tabs.has(untitledPath);
        const savedModel = window.SharedModelRegistry?.getModel?.(savedPath);
        if (savedModel) {
            savedModel.setValue(content);
            window.SharedModelRegistry?.markSaved?.(savedPath);
            this.tabs.set(savedPath, content);
            this.markFileAsSaved(savedPath);
        }

        const split = window.SplitEditorManager;
        if (split && Array.isArray(split.panes)) {
            for (const pane of split.panes) {
                if (!pane || !pane.tabs?.has?.(untitledPath)) continue;
                await pane.openFile(savedPath, content);
            }
        }

        if (hadMainTab) {
            const tab = document.querySelector(`.tab[data-path="${CSS.escape(untitledPath)}"]`);
            if (tab) tab.remove();
            EditorManager.closeEditor(untitledPath);
            this.tabs.delete(untitledPath);
            this.unsavedChanges.delete(untitledPath);
            this.editorStates.delete(untitledPath);
            this.stopWatchingFile(untitledPath);
            if (this.previewTab === untitledPath) this.previewTab = null;
        }

        if (split && Array.isArray(split.panes)) {
            for (const pane of split.panes) {
                const abas = pane?.tabs;
                const info = abas?.get?.(untitledPath);
                if (!pane || !abas || !info) continue;
                const wasActive = pane.activeFile === untitledPath;
                try { (info.editor as { dispose(): void }).dispose(); } catch (_) { /* ignore */ }
                info.editorDiv?.remove?.();
                window.SharedModelRegistry?.release?.(untitledPath);
                abas.delete(untitledPath);
                pane.element
                    ?.querySelector(`.split-tab[data-path="${CSS.escape(untitledPath)}"]`)
                    ?.remove();
                if (wasActive && abas.has(savedPath)) pane._activateFile(savedPath);
            }
        }

        if (!window.SharedModelRegistry?.has?.(untitledPath)) {
            this.untitledDocuments.delete(untitledPath);
        }

        if (hadMainTab) {
            if (!this.tabs.has(savedPath)) {
                this.addTab(savedPath, content);
            } else {
                this.activateTab(savedPath);
            }
        }

        this.updateTabsContainerVisibility();
    },

    async saveUntitledFile(filePath) {
        const model = window.SharedModelRegistry?.getModel?.(filePath)
            ?? EditorManager.getEditorForFile(filePath)?.getModel();
        if (!model) return false;

        const content = model.getValue();
        const finalPath = await this.choosePathForUntitledFile(filePath, content);
        if (!finalPath) return false;

        let savedPath = finalPath;
        let savedContent = content;
        if (extensionOf(finalPath) === 'cmm') {
            const saved = await this.saveCmmProcessorFile(finalPath, content);
            if (!saved) return false;
            savedPath = saved.filePath;
            savedContent = saved.content;
        } else {
            await electronAPI.writeFile(finalPath, content);
            await this.registerSavedProjectFile(finalPath, content);
        }
        await this.replaceUntitledWithSavedFile(filePath, savedPath, savedContent);

        try {
            const stats = await electronAPI.getFileStats(savedPath) as { mtime: number };
            this.lastModifiedTimes.set(savedPath, stats.mtime);
        } catch (_) { /* stats errors are non-fatal */ }

        if (ProjectStore.getProjectPath()) {
            try { await electronAPI.triggerFileTreeRefresh?.(); }
            catch (_) { /* tree refresh is best-effort */ }
        }
        return true;
    },

    initialContentForType(type, filePath) {
        const baseName = withoutExtension(basenameOf(filePath));
        if (type === 'cmm') return createCmmTemplate(sanitizeProcessorName(baseName));
        if (type === 'python') {
            return `import cocotb
from cocotb.triggers import Timer


@cocotb.test()
async def basic_test(dut):
    dut._log.info("Starting cocotb test")
    await Timer(1, unit="ns")
`;
        }
        // Verilog nao ganha semente: o "// New Verilog file" virou a dica de
        // arquivo vazio (js/editor/empty_placeholder.js), que aparece enquanto
        // nao ha texto e nunca entra no arquivo. C+- e Python continuam com
        // molde porque molde e andaime de verdade, nao um comentario que a
        // pessoa tem de apagar antes de comecar.
        return '';
    },

    async createNewFileFromDialog() {
        const projectPath = ProjectStore.getProjectPath();
        const defaultPath = projectPath
            ? await electronAPI.joinPath(projectPath, 'untitled.v')
            : 'untitled.v';
        const result = (await electronAPI.showSaveDialog({
            title: window.t ? window.t('contextMenu.saveNewFile') : 'Save New File',
            defaultPath,
            filters: getSaveDialogFilters(null, { includeCmmFallback: true }),
            properties: ['createDirectory', 'showOverwriteConfirmation'],
        })) as RespostaDoSalvar;

        if (result.canceled || !result.filePath) return false;

        let requestedPath = result.filePath;
        let type = typeFromExtension(requestedPath);
        if (!type) {
            type = 'verilog';
            requestedPath = appendDefaultExtension(requestedPath, type);
        }

        const validation = validateSaveName(requestedPath);
        if (!validation.ok) {
            showNotification(
                window.t
                    ? window.t('notification.tree.invalidName', {
                        name: basenameOf(requestedPath),
                        suggestion: validation.suggestion,
                    })
                    : `"${basenameOf(requestedPath)}" has invalid characters. Suggestion: ${validation.suggestion}`,
                'warning',
                4000,
            );
            return false;
        }

        const content = this.initialContentForType(type, requestedPath);
        let savedPath = requestedPath;
        let savedContent = content;
        if (type === 'cmm') {
            const saved = await this.saveCmmProcessorFile(requestedPath, content);
            if (!saved) return false;
            savedPath = saved.filePath;
            savedContent = saved.content;
        } else {
            await electronAPI.writeFile(requestedPath, content);
            await this.registerSavedProjectFile(requestedPath, content);
        }

        if (ProjectStore.getProjectPath()) {
            try { await electronAPI.triggerFileTreeRefresh?.(); }
            catch (_) { /* tree refresh is best-effort */ }
        }
        this.addTab(savedPath, savedContent);
        showNotification(
            window.t
                ? window.t('notification.tree.created', { name: basenameOf(savedPath) })
                : `Created "${basenameOf(savedPath)}" successfully`,
            'success',
            2000,
        );
        return true;
    },
};
