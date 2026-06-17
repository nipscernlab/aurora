import '../components/aurora-tabs.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { showCardNotification } from '../ui/notification.js';
import { tabViewers } from './tab_viewers.js';
import { tabDrag } from './tab_drag.js';
import { tabWatchers } from './tab_watchers.js';
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

const UNTITLED_PREFIX = 'Untitled-';
const VALID_VERILOG_FILENAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_PYTHON_MODULE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_PROCESSOR_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const CMM_SNIPPET_TRIGGER = '$cmm';
const CMM_DEFAULTS = Object.freeze({
    nBits: 23,
    dataStackSize: 5,
    instructionStackSize: 5,
    inputPorts: 1,
    outputPorts: 1,
    nbMantissa: 16,
    nbExponent: 6,
    gain: 128,
});

function basenameOf(filePath) {
    return String(filePath || '').split(/[\\/]/).pop();
}

function withoutExtension(fileName) {
    return String(fileName || '').replace(/\.[^.\\/]+$/, '');
}

function extensionOf(filePath) {
    const match = String(filePath || '').match(/\.([^.\\/]+)$/);
    return match ? match[1].toLowerCase() : '';
}

function normalizeKey(filePath) {
    return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function sanitizeVerilogFileName(baseName) {
    const cleaned = String(baseName || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'untitled';
}

function sanitizePythonModuleName(baseName) {
    let cleaned = String(baseName || 'test_dut')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!cleaned) cleaned = 'test_dut';
    if (!/^[a-zA-Z_]/.test(cleaned)) cleaned = `test_${cleaned}`;
    return cleaned;
}

function sanitizeProcessorName(baseName) {
    const cleaned = String(baseName || 'processor')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'processor';
}

function createCmmTemplate(processorName = 'processor') {
    return `#PRNAME ${processorName}
#NUBITS ${CMM_DEFAULTS.nBits}
#NDSTAC ${CMM_DEFAULTS.dataStackSize}
#SDEPTH ${CMM_DEFAULTS.instructionStackSize}
#NUIOIN ${CMM_DEFAULTS.inputPorts}
#NUIOOU ${CMM_DEFAULTS.outputPorts}
#NBMANT ${CMM_DEFAULTS.nbMantissa}
#NBEXPO ${CMM_DEFAULTS.nbExponent}
#NUGAIN ${CMM_DEFAULTS.gain}

void main()
{
    // Øk. Você criou um processador em C±, mas e agora?
}
`;
}

function ensureCmmPrname(content, processorName) {
    const source = String(content || '').trim()
        ? String(content)
        : createCmmTemplate(processorName);
    if (/^#PRNAME\s+.+$/mi.test(source)) {
        return source.replace(/^#PRNAME\s+.+$/mi, `#PRNAME ${processorName}`);
    }
    return `#PRNAME ${processorName}\n${source.replace(/^\s+/, '')}`;
}

function typeFromExtension(filePath) {
    const ext = extensionOf(filePath);
    if (ext === 'py') return 'python';
    if (ext === 'v') return 'verilog';
    if (ext === 'cmm') return 'cmm';
    return null;
}

function showNotification(message, type = 'info', duration = 3000) {
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type, duration);
    } else if (typeof showCardNotification === 'function') {
        showCardNotification(message, type, duration);
    }
}

export class TabManager {
    static tabs = new Map();
    static activeTab = null;
    static previewTab = null; // path of current preview (italic) tab, or null
    static editorStates = new Map();
    static unsavedChanges = new Set();
    static closedTabsStack = [];
    static fileWatchers = new Map();
    static lastModifiedTimes = new Map();
    static externalChangeQueue = new Set();
    static periodicCheckInterval = null;
    static isCheckingFiles = false;
    static viewerInstances = new Map();
    static pdfViewerStates = new Map();
    static untitledCounter = 0;
    static untitledDocuments = new Map();
    static applyingSnippet = new Set();
    // filePath -> setInterval id for the PDF state-tracking poll. Tracked so
    // closing a PDF tab can clear it; otherwise each opened PDF left a 2s
    // interval running forever against a detached iframe.
    static pdfStateIntervals = new Map();
    // Optional delegate for the welcome-overlay decision. SplitEditorManager
    // registers one so the overlay reflects ALL panes (main + splits), not
    // just the main pane. When null, show/hideOverlay do the plain toggle.
    // (Replaces an older monkey-patch that reassigned show/hideOverlay.)
    static overlayDelegate = null;

    // Image and PDF extensions
    static imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']);
    static pdfExtensions = new Set(['pdf']);
    static hideOverlay() {
        if (TabManager.overlayDelegate) { TabManager.overlayDelegate(); return; }
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    static updateTabsContainerVisibility() {
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            // If there are more than 0 tabs, display it, otherwise hide it.
            if (this.tabs.size > 0) {
                tabsContainer.style.display = 'flex';
            } else {
                tabsContainer.style.display = 'none';
            }
        }
    }

    // Show overlay when no content
    static showOverlay() {
        if (TabManager.overlayDelegate) { TabManager.overlayDelegate(); return; }
        const overlay = document.getElementById('editor-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    static isUntitledPath(filePath) {
        return this.untitledDocuments.has(filePath);
    }

    static getDisplayName(filePath) {
        if (this.isUntitledPath(filePath)) {
            const meta = this.untitledDocuments.get(filePath);
            const ext = getExtensionForDocumentType(meta?.detectedType);
            return ext ? `${filePath}.${ext}` : filePath;
        }
        return basenameOf(filePath);
    }

    static createNewFile() {
        let filePath;
        do {
            this.untitledCounter += 1;
            filePath = `${UNTITLED_PREFIX}${this.untitledCounter}`;
        } while (this.tabs.has(filePath) || this.untitledDocuments.has(filePath));

        this.untitledDocuments.set(filePath, { detectedType: null });
        window.SplitEditorManager?.setFocus?.(0);
        this.addTab(filePath, '');
        this.markFileAsModified(filePath);
        return filePath;
    }

    static updateUntitledDocumentType(filePath, content) {
        if (!this.isUntitledPath(filePath) || !window.monaco) return null;

        const meta = this.untitledDocuments.get(filePath);
        const detectedType = detectDocumentType(content);
        if (meta.detectedType === detectedType) return detectedType;

        meta.detectedType = detectedType;
        this.untitledDocuments.set(filePath, meta);

        const model = window.SharedModelRegistry?.getModel?.(filePath)
            ?? EditorManager.getEditorForFile(filePath)?.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, getLanguageForDocumentType(detectedType));
        }

        this.updateUntitledTabPresentation(filePath);
        return detectedType;
    }

    static expandUntitledSnippet(filePath, editor) {
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
                monaco.editor.setModelLanguage(model, 'cmm');
            }
            this.updateUntitledTabPresentation(filePath);
            editor.setPosition({ lineNumber: 13, column: 5 });
            editor.focus();
        } finally {
            this.applyingSnippet.delete(filePath);
        }
        return true;
    }

    static updateUntitledTabPresentation(filePath) {
        const displayName = this.getDisplayName(filePath);
        const iconClass = this.getFileIcon(displayName);
        document
            .querySelectorAll(`.tab[data-path="${CSS.escape(filePath)}"]`)
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
    }

    static appendDefaultExtension(filePath, documentType) {
        if (/\.(?:py|v|cmm)$/i.test(filePath)) return filePath;
        const extension = getExtensionForDocumentType(documentType) || 'v';
        return `${filePath}.${extension}`;
    }

    static validateSaveName(filePath) {
        const ext = extensionOf(filePath);
        const baseName = withoutExtension(basenameOf(filePath));
        if (ext === 'py' && !VALID_PYTHON_MODULE_RE.test(baseName)) {
            return {
                ok: false,
                suggestion: `${sanitizePythonModuleName(baseName)}.py`,
            };
        }
        if (ext === 'v' && !VALID_VERILOG_FILENAME_RE.test(baseName)) {
            return {
                ok: false,
                suggestion: `${sanitizeVerilogFileName(baseName)}.v`,
            };
        }
        if (ext === 'cmm' && !VALID_PROCESSOR_NAME_RE.test(baseName)) {
            return {
                ok: false,
                suggestion: `${sanitizeProcessorName(baseName)}.cmm`,
            };
        }
        return { ok: true };
    }

    static async confirmOverwrite(filePath) {
        try {
            const exists = await window.electronAPI.fileExists(filePath);
            if (!exists) return true;
        } catch (_) {
            return true;
        }

        const fileName = basenameOf(filePath);
        const tr = (k, p) => (window.t ? window.t(k, p) : k);
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
    }

    static async getProcessorCmmTarget(selectedPath) {
        const projectPath = ProjectStore.getProjectPath();
        const processorName = sanitizeProcessorName(withoutExtension(basenameOf(selectedPath)));
        if (!projectPath) {
            return { processorName, cmmPath: selectedPath, projectPath: null };
        }

        const processorPath = await window.electronAPI.joinPath(projectPath, processorName);
        const softwarePath = await window.electronAPI.joinPath(processorPath, 'Software');
        const hardwarePath = await window.electronAPI.joinPath(processorPath, 'Hardware');
        const simulationPath = await window.electronAPI.joinPath(processorPath, 'Simulation');
        const cmmPath = await window.electronAPI.joinPath(softwarePath, `${processorName}.cmm`);
        return { processorName, processorPath, softwarePath, hardwarePath, simulationPath, cmmPath, projectPath };
    }

    static async choosePathForUntitledFile(filePath, content) {
        const detectedType = this.updateUntitledDocumentType(filePath, content)
            || detectDocumentType(content);
        let suggestedBase = getDefaultBaseNameForDocumentType(detectedType);
        const suggestedExt = getExtensionForDocumentType(detectedType) || 'v';

        while (true) {
            const projectPath = ProjectStore.getProjectPath();
            const defaultFileName = `${suggestedBase}.${suggestedExt}`;
            const defaultPath = projectPath
                ? await window.electronAPI.joinPath(projectPath, defaultFileName)
                : defaultFileName;

            const result = await window.electronAPI.showSaveDialog({
                title: window.t ? window.t('contextMenu.saveNewFile') : 'Save New File',
                defaultPath,
                filters: getSaveDialogFilters(detectedType),
                properties: ['createDirectory', 'showOverwriteConfirmation'],
            });

            if (result.canceled || !result.filePath) return null;

            const finalPath = this.appendDefaultExtension(result.filePath, detectedType);
            const validation = this.validateSaveName(finalPath);
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
    }

    static async registerSavedProjectFile(filePath, content) {
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
    }

    static async registerProcessor(processorName) {
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
    }

    static async saveCmmProcessorFile(selectedPath, content) {
        const target = await this.getProcessorCmmTarget(selectedPath);
        const finalContent = ensureCmmPrname(content, target.processorName);

        if (!target.projectPath) {
            const finalPath = this.appendDefaultExtension(selectedPath, 'cmm');
            if (!await this.confirmOverwrite(finalPath)) return null;
            await window.electronAPI.writeFile(finalPath, finalContent);
            return { filePath: finalPath, content: finalContent, processorName: target.processorName };
        }

        await window.electronAPI.mkdir(target.softwarePath);
        await window.electronAPI.mkdir(target.hardwarePath);
        await window.electronAPI.mkdir(target.simulationPath);

        if (!await this.confirmOverwrite(target.cmmPath)) return null;

        await window.electronAPI.writeFile(target.cmmPath, finalContent);
        await this.registerProcessor(target.processorName);
        return { filePath: target.cmmPath, content: finalContent, processorName: target.processorName };
    }

    static async replaceUntitledWithSavedFile(untitledPath, savedPath, content) {
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
                if (!pane?.tabs?.has?.(untitledPath)) continue;
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
                const info = pane?.tabs?.get?.(untitledPath);
                if (!info) continue;
                const wasActive = pane.activeFile === untitledPath;
                try { info.editor.dispose(); } catch (_) { /* ignore */ }
                info.editorDiv?.remove?.();
                window.SharedModelRegistry?.release?.(untitledPath);
                pane.tabs.delete(untitledPath);
                pane.element
                    ?.querySelector(`.split-tab[data-path="${CSS.escape(untitledPath)}"]`)
                    ?.remove();
                if (wasActive && pane.tabs.has(savedPath)) pane._activateFile(savedPath);
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
    }

    static async saveUntitledFile(filePath) {
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
            await window.electronAPI.writeFile(finalPath, content);
            await this.registerSavedProjectFile(finalPath, content);
        }
        await this.replaceUntitledWithSavedFile(filePath, savedPath, savedContent);

        try {
            const stats = await window.electronAPI.getFileStats(savedPath);
            this.lastModifiedTimes.set(savedPath, stats.mtime);
        } catch (_) { /* stats errors are non-fatal */ }

        if (ProjectStore.getProjectPath()) {
            try { await window.electronAPI.triggerFileTreeRefresh?.(); }
            catch (_) { /* tree refresh is best-effort */ }
        }
        return true;
    }

    static initialContentForType(type, filePath) {
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
        if (type === 'verilog') return '// New Verilog file\n';
        return '';
    }

    static async createNewFileFromDialog() {
        const projectPath = ProjectStore.getProjectPath();
        const defaultPath = projectPath
            ? await window.electronAPI.joinPath(projectPath, 'untitled.v')
            : 'untitled.v';
        const result = await window.electronAPI.showSaveDialog({
            title: window.t ? window.t('contextMenu.saveNewFile') : 'Save New File',
            defaultPath,
            filters: getSaveDialogFilters(null, { includeCmmFallback: true }),
            properties: ['createDirectory', 'showOverwriteConfirmation'],
        });

        if (result.canceled || !result.filePath) return false;

        let requestedPath = result.filePath;
        let type = typeFromExtension(requestedPath);
        if (!type) {
            type = 'verilog';
            requestedPath = this.appendDefaultExtension(requestedPath, type);
        }

        const validation = this.validateSaveName(requestedPath);
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
            await window.electronAPI.writeFile(requestedPath, content);
            await this.registerSavedProjectFile(requestedPath, content);
        }

        if (ProjectStore.getProjectPath()) {
            try { await window.electronAPI.triggerFileTreeRefresh?.(); }
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
    }

    // Utility method to check if file is an image
    static isImageFile(filePath) {
        const extension = filePath.split('.')
            .pop()
            .toLowerCase();
        return this.imageExtensions.has(extension);
    }

    // Utility method to check if file is a PDF
    static isPdfFile(filePath) {
        const extension = filePath.split('.')
            .pop()
            .toLowerCase();
        return this.pdfExtensions.has(extension);
    }

    // Utility method to check if file is binary (image or PDF)
    static isBinaryFile(filePath) {
        return this.isImageFile(filePath) || this.isPdfFile(filePath);
    }


    // Add this method to close all tabs
    static async closeAllTabs() {
        // Create a copy of the tabs keys to avoid modification during iteration
        const openTabs = Array.from(this.tabs.keys());

        // Close each tab
        for (const filePath of openTabs) {
            await this.closeTab(filePath);
        }
    }

    // Enhanced formatCurrentFile with undo history preservation
    static async formatCurrentFile() {
        if (!this.activeTab) {
            console.warn('No active tab to format');
            return;
        }

        const filePath = this.activeTab;

        // Don't format binary files
        if (this.isBinaryFile(filePath)) {
            console.warn('Cannot format binary files');
            return;
        }

        const editor = EditorManager.getEditorForFile(filePath);

        if (!editor) {
            console.error('No editor found for active tab');
            return;
        }

        // Show loading indicator
        this.showFormattingIndicator(true);

        try {
            const originalCode = editor.getValue();

            if (!originalCode.trim()) {
                console.warn('No code to format');
                return;
            }

            // Format the code
            const formattedCode = await CodeFormatter.formatCode(originalCode, filePath);

            if (formattedCode && formattedCode !== originalCode) {
                // Create undo stop before formatting
                editor.pushUndoStop();

                // Store cursor position and selection
                const position = editor.getPosition();
                const _selection = editor.getSelection();

                // Update editor content
                editor.setValue(formattedCode);

                // Create undo stop after formatting to make it undoable
                editor.pushUndoStop();

                // Try to restore cursor position (approximate)
                if (position) {
                    const lineCount = editor.getModel()
                        .getLineCount();
                    const restoredPosition = {
                        lineNumber: Math.min(position.lineNumber, lineCount),
                        column: Math.min(position.column, editor.getModel()
                            .getLineLength(Math.min(position.lineNumber, lineCount)) + 1)
                    };
                    editor.setPosition(restoredPosition);
                }

                // Mark file as modified
                this.markFileAsModified(filePath);

                // Show success feedback
                if (typeof showCardNotification === 'function') {
                    showCardNotification('Code formatted successfully', 'success');
                }
            } else {
                if (typeof showCardNotification === 'function') {
                    showCardNotification('Code is already properly formatted', 'info');
                }
            }

        } catch (error) {
            console.error('Code formatting failed:', error);
            if (typeof showCardNotification === 'function') {
                showCardNotification(`Formatting failed: ${error.message}`, 'error');
            }
        } finally {
            // Hide loading indicator
            this.showFormattingIndicator(false);
        }
    }

    static showFormattingIndicator(show) {
        const broomIcon = document.querySelector('.context-refactor-button');
        if (!broomIcon) return;

        const tr = (k) => (window.t ? window.t(k) : k);
        if (show) {
            broomIcon.classList.add('formatting');
            broomIcon.title = tr('tabs.formatting');
        } else {
            broomIcon.classList.remove('formatting');
            broomIcon.style.animation = '';
            broomIcon.title = tr('tabs.formatter');
        }
    }


    // Enhanced updateContextPath method
    static updateContextPath(filePath) {
        const contextContainer = document.getElementById('context-path');
        if (!contextContainer) return;

        if (!filePath) {
            contextContainer.className = 'context-path-container empty';
            contextContainer.innerHTML = '';
            return;
        }

        contextContainer.className = 'context-path-container';

        const segments = filePath.split(/[\\/]/);
        segments.pop();
        const fileName = this.getDisplayName(filePath);

        let html = '<i class="ph ph-folder-open"></i>';

        if (segments.length > 0) {
            html += segments.map(segment =>
                    `<span class="context-path-segment">${segment}</span>`
                )
                .join('<span class="context-path-separator">/</span>');

            html += '<span class="context-path-separator">/</span>';
        }

        const fileIcon = TabManager.getFileIcon(fileName);
        html += `<i class="${fileIcon}" style="color: var(--text)"></i>`;
        html += `<span class="context-path-filename">${fileName}</span>`;

        // Add file type indicator for binary files
        if (this.isBinaryFile(filePath)) {
            const fileType = this.isImageFile(filePath) ? 'Image' : 'PDF';
            html += `<span class="file-type-indicator">${fileType}</span>`;
        }

        contextContainer.innerHTML = html;

        // Add click listener for formatting (only for text files)
        if (!this.isBinaryFile(filePath)) {
            const broomIcon = contextContainer.querySelector('.context-refactor-button');
            if (broomIcon) {
                broomIcon.addEventListener('click', async () => {
                    await TabManager.formatCurrentFile();
                });
            }
        }
    }


    // Improved method to mark files as modified.
    //
    // Broadcasts the dirty marker to EVERY tab DOM element bound to this
    // file path — that's the main pane tab plus one entry per split pane
    // showing the same file. Querying with `.tab[data-path=...]` matches
    // both `.tab` (main) and `.tab.split-tab` (splits) because both share
    // the base class. VS Code-equivalent behaviour: edit in any pane, every
    // instance shows the dirty dot.
    static markFileAsModified(filePath) {
        if (!filePath) return;

        this.unsavedChanges.add(filePath);
        document
            .querySelectorAll(`.tab[data-path="${CSS.escape(filePath)}"]`)
            .forEach((tab) => {
                const closeButton = tab.querySelector('.close-tab');
                if (closeButton) {
                    closeButton.innerHTML = '•';
                    closeButton.style.color = '#ffd700';
                    closeButton.style.fontSize = '20px';
                }
            });
    }

    // Improved method to mark files as saved. Mirror of markFileAsModified
    // — every instance of the file (main + splits) drops the dirty dot.
    static markFileAsSaved(filePath) {
        if (!filePath) return;

        this.unsavedChanges.delete(filePath);
        document
            .querySelectorAll(`.tab[data-path="${CSS.escape(filePath)}"]`)
            .forEach((tab) => {
                const closeButton = tab.querySelector('.close-tab');
                if (closeButton) {
                    closeButton.innerHTML = '×';
                    closeButton.style.color = '';
                    closeButton.style.fontSize = '';
                }
            });
    }

    /**
     * How many open editor instances point at this file? Counts the main
     * pane tab plus every split-pane tab. Used by the close flow to decide
     * whether closing this view should prompt for unsaved changes — only
     * the LAST instance triggers the prompt; earlier ones just dispose
     * their view, since the shared model (and the user's edits) survives
     * in the remaining instances.
     */
    static getInstanceCount(filePath) {
        if (!filePath) return 0;
        let count = this.tabs.has(filePath) ? 1 : 0;
        const split = window.SplitEditorManager;
        if (split && Array.isArray(split.panes)) {
            for (const pane of split.panes) {
                if (pane?.tabs?.has?.(filePath)) count += 1;
            }
        }
        return count;
    }

    // (Removed dead saveEditorState/restoreEditorState: they were never called
    // and referenced an undeclared `editor` — a latent ReferenceError. Per-model
    // view state is owned by Monaco's model registry, not here.)

    // getFileIcon — returns Phosphor classes (no FA dependency)
    static getFileIcon(filename) {
        const extension = filename.split('.').pop().toLowerCase();

        // Images
        if (this.imageExtensions.has(extension)) {
            return extension === 'svg' ? 'ph ph-file-svg' : 'ph ph-file-image';
        }

        if (extension === 'pdf') return 'ph ph-file-pdf';

        const iconMap = {
            // SAPHO/AURORA file types — distinctive icons per family so the
            // hardware toolchain reads at a glance (Verilog = a chip, C± = a
            // custom C±-lettered document, assembly = binary, waves = waveform).
            'cmm':       'aurora-icon-cmm',
            'asm':       'ph ph-binary',
            'v':         'ph ph-cpu',
            'vh':        'ph ph-cpu',
            'sv':        'ph ph-cpu',
            'gtkw':      'ph ph-waveform',
            'vcd':       'ph ph-waveform',
            'fst':       'ph ph-waveform',
            'mif':       'ph ph-database',
            'spf':       'ph ph-package',

            // JS/TS
            'js':   'ph ph-file-js',
            'jsx':  'ph ph-file-jsx',
            'ts':   'ph ph-file-ts',
            'tsx':  'ph ph-file-tsx',
            'mjs':  'ph ph-file-js',
            'vue':  'ph ph-file-vue',

            // Web
            'html': 'ph ph-file-html',
            'htm':  'ph ph-file-html',
            'css':  'ph ph-file-css',
            'scss': 'ph ph-file-css',
            'sass': 'ph ph-file-css',
            'less': 'ph ph-file-css',

            // Data
            'json': 'ph ph-brackets-curly',
            'xml':  'ph ph-file-code',
            'yaml': 'ph ph-file-code',
            'yml':  'ph ph-file-code',
            'toml': 'ph ph-file-code',

            // Docs
            'md':       'ph ph-file-md',
            'markdown': 'ph ph-file-md',
            'txt':      'ph ph-file-text',
            'rtf':      'ph ph-file-text',

            // Other languages
            'py':    'ph ph-file-py',
            'java':  'ph ph-file-code',
            'c':     'ph ph-file-c',
            'cpp':   'ph ph-file-cpp',
            'cc':    'ph ph-file-cpp',
            'cxx':   'ph ph-file-cpp',
            // Phosphor has no ph-file-h — headers borrow the C/C++ document.
            'h':     'ph ph-file-c',
            'hpp':   'ph ph-file-cpp',
            'hh':    'ph ph-file-cpp',
            'hxx':   'ph ph-file-cpp',
            'cs':    'ph ph-file-c-sharp',
            'php':   'ph ph-file-code',
            'rb':    'ph ph-file-code',
            'go':    'ph ph-file-code',
            'rs':    'ph ph-file-rs',
            'swift': 'ph ph-file-code',
            'kt':    'ph ph-file-code',
            'scala': 'ph ph-file-code',

            // Shell
            'sh':   'ph ph-terminal',
            'bash': 'ph ph-terminal',
            'zsh':  'ph ph-terminal',
            'fish': 'ph ph-terminal',
            'ps1':  'ph ph-terminal',
            'bat':  'ph ph-terminal',
            'cmd':  'ph ph-terminal',

            // Config
            'ini':    'ph ph-gear',
            'conf':   'ph ph-gear',
            'config': 'ph ph-gear',
            'env':    'ph ph-gear',

            // Archive
            'zip': 'ph ph-file-zip',
            'rar': 'ph ph-file-zip',
            '7z':  'ph ph-file-zip',
            'tar': 'ph ph-file-zip',
            'gz':  'ph ph-file-zip',

            // Audio
            'mp3':  'ph ph-file-audio',
            'wav':  'ph ph-file-audio',
            'flac': 'ph ph-file-audio',
            'ogg':  'ph ph-file-audio',

            // Video
            'mp4': 'ph ph-file-video',
            'avi': 'ph ph-file-video',
            'mkv': 'ph ph-file-video',
            'mov': 'ph ph-file-video',

            // Office
            'doc':  'ph ph-file-doc',
            'docx': 'ph ph-file-doc',
            'xls':  'ph ph-file-xls',
            'xlsx': 'ph ph-file-xls',
            'ppt':  'ph ph-file-ppt',
            'pptx': 'ph ph-file-ppt'
        };

        return iconMap[extension] || 'ph ph-file';
    }

    // Promote preview tab to permanent (remove italic, keep tab)
    static promotePreviewToPermanent(filePath) {
        if (this.previewTab !== filePath) return;
        this.previewTab = null;
        const tab = document.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
        if (tab) tab.classList.remove('preview');
    }

    // Enhanced addTab method with binary file support
    // options: { preview: false }  — preview=true opens as italic preview tab (VS Code style)
    static addTab(filePath, content = null, options = {}) {
        // A new tab always lands in the focused split when one is focused — the
        // "open in the focused split, necessarily" rule — no matter which open
        // path (tree click, import, AI) called addTab. Safe from recursion:
        // openInFocusedPane only re-enters addTab for the MAIN pane
        // (focusedPane 0), which this guard doesn't re-route, and pane.openFile
        // manages its own editors without calling back here.
        const sem = window.SplitEditorManager;
        if (sem && sem.focusedPane > 0 && !options._fromSplit) {
            sem.openInFocusedPane(filePath, content ?? '', options);
            return;
        }

        const isPreview = options.preview === true;

        // Check if tab already exists
        if (this.tabs.has(filePath)) {
            // If file is currently a preview tab and we want permanent, promote it
            if (this.previewTab === filePath && !isPreview) {
                this.promotePreviewToPermanent(filePath);
            }
            this.activateTab(filePath);
            return;
        }

        // If opening as preview, silently close the existing preview tab first
        if (isPreview && this.previewTab && this.previewTab !== filePath) {
            this._closePreviewSilently(this.previewTab);
        }

        // Create tab element
        const tabContainer = document.querySelector('#tabs-container');
        if (!tabContainer) {
            console.error('Tabs container not found');
            return;
        }

        const tab = document.createElement('div');
        tab.classList.add('tab');
        tab.setAttribute('data-path', filePath);
        tab.setAttribute('draggable', 'true');
        tab.setAttribute('title', this.isUntitledPath(filePath) ? this.getDisplayName(filePath) : filePath);

        // Add binary file indicator
        const isBinary = this.isBinaryFile(filePath);
        if (isBinary) {
            tab.classList.add('binary-file');
        }

        // data-i18n-title pra que o applyDOM atualize o tooltip em
        // locale changes — sem ele, um tab criado em EN ficaria
        // preso em EN apos o toggle pra PT.
        const closeTitle = window.t ? window.t('tabs.close') : 'Close';
        const displayName = this.getDisplayName(filePath);
        tab.innerHTML = `
      <i class="${this.getFileIcon(displayName)}"></i>
      <span class="tab-name">${displayName}</span>
      <button class="close-tab" title="${closeTitle}" data-i18n-title="tabs.close">×</button>
    `;

        // Mark as preview if needed
        if (isPreview) {
            tab.classList.add('preview');
            this.previewTab = filePath;
        }

        // Add event listeners. Single click activates without promoting —
        // a preview tab stays italic until the user double-clicks it or
        // starts editing the buffer. VS Code parity.
        tab.addEventListener('click', () => {
            // Main pane is paneIndex 0 — clicking its tab must flip the
            // SplitEditorManager focus back here, otherwise a split pane
            // remains "focused" (un-dimmed) even though the user just
            // clicked a main-pane tab.
            window.SplitEditorManager?.setFocus?.(0);
            this.activateTab(filePath);
        });
        tab.addEventListener('dblclick', () => {
            // Double-click always promotes preview to permanent
            this.promotePreviewToPermanent(filePath);
            this.activateTab(filePath);
        });
        const closeBtn = tab.querySelector('.close-tab');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(filePath);
        });

        // Middle-click (mouse wheel button) on any part of the tab
        // closes it — same convention as browsers and VS Code. Bound on
        // `auxclick` so the browser already filtered out primary/secondary
        // buttons for us; we still gate by `button === 1` defensively in
        // case some envs surface other auxiliary buttons through this
        // event (e.g. back/forward thumb buttons on a mouse).
        tab.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.closeTab(filePath);
        });
        // Firefox/Electron-on-Linux occasionally autoscrolls on a
        // middle-button mousedown before auxclick fires; suppress that
        // for tabs so the close happens cleanly.
        tab.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        // Add to container
        tabContainer.appendChild(tab);

        // Start watching file and periodic checking if this is the first tab
        this.startWatchingFile(filePath);
        if (this.tabs.size === 0) {
            this.startPeriodicFileCheck();
        }

        // Handle binary files differently
        if (isBinary) {
            // Store file path for binary files
            this.tabs.set(filePath, '[BINARY_FILE]');
            this.activateTab(filePath);
        } else {
            // Handle text files normally
            this.tabs.set(filePath, content || '');

            // Editor creation needs Monaco's AMD modules + EditorManager
            // to be initialized. If the user opens a file before that
            // finishes (e.g. clicks a fresh .v right after app launch),
            // wait on EditorManager.ready before creating the instance.
            (async () => {
                try {
                    await EditorManager.ready;
                    const editor = EditorManager.createEditorInstance(filePath, content || '');
                    if (!editor) {
                        // initialize() couldn't bind the container; bail.
                        this.closeTab(filePath);
                        return;
                    }
                    this.setupContentChangeListener(filePath, editor);
                    this.activateTab(filePath);
                    // Optional jump-to-line (PRISM right-click → module
                    // definition). Done here, right after the editor exists,
                    // so it can't race the deferred creation — positioning
                    // straight after addTab() would hit a null editor.
                    // Deferred to the next frame + an explicit layout() so the
                    // just-shown editor has real dimensions: revealLineInCenter
                    // on an un-laid-out editor sets the cursor but doesn't
                    // scroll the viewport to the line.
                    if (options.revealPosition && typeof editor.revealLineInCenter === 'function') {
                        const ln = options.revealPosition.line || 1;
                        const col = options.revealPosition.column || 1;
                        requestAnimationFrame(() => {
                            editor.layout();
                            editor.setPosition({ lineNumber: ln, column: col });
                            editor.revealLineInCenter(ln);
                            editor.focus();
                        });
                    }
                } catch (error) {
                    console.error('Error creating editor:', error);
                    this.closeTab(filePath);
                }
            })();
        }
        this.updateTabsContainerVisibility();
        this.initSortableTabs();
    }



    // Enhanced activateTab with better viewer management
    static activateTab(filePath) {
        // Only the MAIN pane's tab bar — split panes own their .split-tab active
        // state (SplitEditorManager._activateFile). Querying all `.tab` here used
        // to strip the active class off split tabs, so a split's tab stopped
        // following its own editor's focus.
        const tabs = document.querySelectorAll('.tab:not(.split-tab)');
        tabs.forEach(tab => tab.classList.remove('active'));

        const activeTab = document.querySelector(`.tab:not(.split-tab)[data-path="${CSS.escape(filePath)}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
            // Capture the OUTGOING tab before overwriting activeTab, so the
            // PDF-state snapshot below saves the tab we're leaving — not the one
            // we're switching to (it used to read the already-updated value).
            const previousTab = this.activeTab;
            this.activeTab = filePath;
            // Notifica botoes gated-por-extensao (ex: C± so habilitado em
            // .cmm). Listeners em compilation_flow.js / outros consumers.
            document.dispatchEvent(new CustomEvent('aurora:editing-file-changed', {
                detail: { filePath },
            }));

            // Update context path
            this.updateContextPath(filePath);

            const editorContainer = document.getElementById('monaco-editor');
            this.hideOverlay();

            // Handle binary files
            if (this.isBinaryFile(filePath)) {
                // Save the OUTGOING tab's PDF state before switching away.
                if (previousTab && previousTab !== filePath && this.isPdfFile(previousTab)) {
                    this.savePdfViewerState(previousTab);
                }

                // Hide ALL editor instances
                const editorInstances = editorContainer.querySelectorAll('.editor-instance');
                editorInstances.forEach(el => {
                    el.style.display = 'none';
                    el.classList.remove('active');
                });

                // Hide all viewers first
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer');
                allViewers.forEach(viewer => {
                    viewer.style.display = 'none';
                });

                // Get or create appropriate viewer
                let viewer = this.viewerInstances.get(filePath);
                if (!viewer) {
                    if (this.isImageFile(filePath)) {
                        viewer = this.createImageViewer(filePath, editorContainer);
                    } else if (this.isPdfFile(filePath)) {
                        viewer = this.createPdfViewer(filePath, editorContainer);
                    }
                }

                // Add viewer to container if not already present
                if (viewer && !editorContainer.contains(viewer)) {
                    editorContainer.appendChild(viewer);
                }

                // Show only the current viewer
                if (viewer) {
                    viewer.style.display = 'flex';

                    // Restore PDF state if it's a PDF
                    if (this.isPdfFile(filePath)) {
                        this.restorePdfViewerState(filePath, viewer);
                    }
                }

            } else {
                // Hide all viewers for text files
                const allViewers = editorContainer.querySelectorAll('.image-viewer, .pdf-viewer');
                allViewers.forEach(viewer => {
                    viewer.style.display = 'none';
                });

                // Show and activate the appropriate editor instance
                const editorInstances = editorContainer.querySelectorAll('.editor-instance');
                editorInstances.forEach(el => {
                    if (el.dataset.filePath === filePath) {
                        el.style.display = 'block';
                        el.classList.add('active');
                    } else {
                        el.style.display = 'none';
                        el.classList.remove('active');
                    }
                });

                EditorManager.setActiveEditor(filePath);
            }
        }
    }
    // Resolve "the file the user is currently editing" — main pane uses
    // TabManager.activeTab, splits override with their own focused file.
    // Falls back to the main active tab if no split is focused.
    static getEditingFilePath() {
        const split = window.SplitEditorManager;
        if (split && typeof split.getFocusedFile === 'function') {
            const focused = split.getFocusedFile();
            if (focused) return focused;
        }
        return this.activeTab;
    }

    // Comprehensive save method. Reads from the shared model rather than
    // a specific editor, so saving works the same whether the user typed
    // in the main pane or in a split. After the disk write, we pin the
    // current altVersionId as the new "saved" snapshot via the registry —
    // that's what propagates the cleared-dirty state to every other pane.
    static async saveCurrentFile() {
        const currentPath = this.getEditingFilePath();
        if (!currentPath) return;
        if (this.isBinaryFile(currentPath)) return;

        if (this.isUntitledPath(currentPath)) {
            return this.saveUntitledFile(currentPath);
        }

        try {
            const model = window.SharedModelRegistry?.getModel?.(currentPath)
                ?? EditorManager.getEditorForFile(currentPath)?.getModel();
            if (!model) return false;

            const content = model.getValue();

            // Update stored content first
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await window.electronAPI.writeFile(currentPath, content);
            window.SharedModelRegistry?.markSaved?.(currentPath);
            this.markFileAsSaved(currentPath);

            // Update last modified time
            try {
                const stats = await window.electronAPI.getFileStats(currentPath);
                this.lastModifiedTimes.set(currentPath, stats.mtime);
            } catch (error) {
                // Ignore stats errors
            }

        } catch (error) {
            console.error('Error saving file:', error);
            return false;
        }
        return true;
    }

    // Enhanced saveAllFiles method with undo history preservation. Walks
    // every file the registry knows about (main + split-only), so a file
    // opened only in a split pane still saves on Ctrl+K S.
    static async saveAllFiles() {
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
                await window.electronAPI.writeFile(filePath, currentContent);
                registry.markSaved(filePath);
                this.markFileAsSaved(filePath);

                try {
                    const stats = await window.electronAPI.getFileStats(filePath);
                    this.lastModifiedTimes.set(filePath, stats.mtime);
                } catch (_) { /* stats errors are non-fatal */ }
            } catch (error) {
                console.error(`Error saving file ${filePath}:`, error);
            }
        }
    }

    // Silently close preview tab without dialogs
    static _closePreviewSilently(filePath) {
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
    }

    // Add listener for content changes.
    //
    // Uses the SharedModelRegistry's altVersionId snapshot rather than a
    // string-compare against this.tabs.get(filePath). The registry is the
    // pane-agnostic source of truth, so an edit made in a split pane that
    // shares the same model correctly clears/sets dirty here too — and
    // undoing all the way back to the saved state crosses the snapshot
    // and clears the dot, exactly like VS Code.
    static setupContentChangeListener(filePath, editor) {
        // Idempotent guard. createEditorInstance returns the SAME editor on
        // reopen, and addTab re-calls this — so without the guard every reopen
        // stacked another onDidChangeModelContent listener on the same editor:
        // a listener leak AND a callback that fired N times per keystroke.
        // Register exactly once per live editor; Monaco disposes the listener
        // when the editor itself is disposed (closeEditor), so a fresh editor
        // created after a close re-registers cleanly.
        if (editor.__auroraContentDisposable) return;
        editor.__auroraContentDisposable = editor.onDidChangeModelContent(() => {
            if (this.isUntitledPath(filePath)) {
                if (this.expandUntitledSnippet(filePath, editor)) {
                    this.markFileAsModified(filePath);
                    return;
                }
                this.updateUntitledDocumentType(filePath, editor.getValue());
                this.markFileAsModified(filePath);
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
                return;
            }
            const dirty = window.SharedModelRegistry?.isDirty?.(filePath) ?? false;
            if (dirty) {
                this.markFileAsModified(filePath);
                if (this.previewTab === filePath) {
                    this.promotePreviewToPermanent(filePath);
                }
            } else {
                this.markFileAsSaved(filePath);
            }
        });
    }



    static isClosingTab = false; // Prevent double closing

    // Enhanced closeTab method
    // Enhanced closeTab with viewer cleanup
    static async closeTab(filePath) {
        // Prevent multiple simultaneous closes
        if (this.isClosingTab) return;
        this.isClosingTab = true;

        try {
            const wasUntitled = this.isUntitledPath(filePath);
            // Handle unsaved changes for text files — but only when THIS is
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
                const currentContent = this.tabs.get(filePath);
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
                            monaco.editor.setModelLanguage(model, 'plaintext');
                        }
                    }
                }
            }

        } finally {
            this.isClosingTab = false;
        }
    }

    // Enhanced cleanup method
    static cleanup() {
        // Save all PDF states before cleanup
        for (const [filePath, _viewer] of this.viewerInstances.entries()) {
            if (this.isPdfFile(filePath)) {
                this.savePdfViewerState(filePath);
            }
        }

        for (const id of this.pdfStateIntervals.values()) clearInterval(id);
        this.pdfStateIntervals.clear();
        this.viewerInstances.clear();
        this.pdfViewerStates.clear();
        this.stopAllWatchers();

        // Disconnect the MutationObserver wired in tab_drag.js so the host
        // page can GC. Without this the observer holds a live reference to
        // the tabs container forever (it was set up in initSortableTabs
        // and stashed on TabManager precisely so cleanup could release it).
        if (this.tabObserver) {
            this.tabObserver.disconnect();
            this.tabObserver = null;
        }
    }

    // Handling unsaved changes with dialog
    static async handleUnsavedChanges(filePath) {
        const fileName = this.getDisplayName(filePath);
        const result = await showUnsavedChangesDialog(fileName);

        switch (result) {
        case 'save':
            try {
                const saved = await this.saveFile(filePath);
                return saved !== false;
            } catch (error) {
                console.error('Error saving file:', error);
                return true; // Continue closing even if save failed
            }
        case 'dont-save':
            this.unsavedChanges.delete(filePath);
            return true;
        case 'cancel':
        default:
            return false;
        }
    }

    // Enhanced saveFile method with undo history preservation
    static async saveFile(filePath = null) {
        const currentPath = filePath || this.getEditingFilePath();
        if (!currentPath) return false;

        // Don't save binary files
        if (this.isBinaryFile(currentPath)) return true;

        if (this.isUntitledPath(currentPath)) {
            return this.saveUntitledFile(currentPath);
        }

        try {
            const model = window.SharedModelRegistry?.getModel?.(currentPath)
                ?? EditorManager.getEditorForFile(currentPath)?.getModel();
            if (!model) {
                throw new Error('Editor model not found for file');
            }

            const content = model.getValue();

            // IMPORTANT: Update our stored content BEFORE writing to disk
            // This helps the external change handler recognize this as our own save
            this.tabs.set(currentPath, content);

            // Save file without interfering with undo history
            await window.electronAPI.writeFile(currentPath, content);

            // Mark as saved
            window.SharedModelRegistry?.markSaved?.(currentPath);
            this.markFileAsSaved(currentPath);

            // Update the last modified time to prevent false external change detection
            try {
                const stats = await window.electronAPI.getFileStats(currentPath);
                this.lastModifiedTimes.set(currentPath, stats.mtime);
            } catch (error) {
                // If we can't get stats, that's okay - the content comparison will handle it
            }

            // Sinaliza pra UI que o conteudo deste arquivo mudou em disco
            // por uma acao do usuario no editor. Subscribers (file_mode.js)
            // reclassificam o arquivo (synth vs testbench) e re-persistem
            // no .spf — sem isso, editar um .v adicionando $finish/$dumpvars
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
    }

    // Optional: Method to manually create undo stops when needed
    static createUndoStop(filePath = null) {
        const currentPath = filePath || this.activeTab;
        if (!currentPath) return;

        const editor = EditorManager.getEditorForFile(currentPath);
        if (editor && typeof editor.pushUndoStop === 'function') {
            editor.pushUndoStop();
        }
    }

    // Optional: Method to get undo/redo state information
    static getUndoRedoState(filePath = null) {
        const currentPath = filePath || this.activeTab;
        if (!currentPath) return null;

        const editor = EditorManager.getEditorForFile(currentPath);
        if (!editor) return null;

        return {
            canUndo: editor.getModel() ? editor.getModel()
                .canUndo() : false,
            canRedo: editor.getModel() ? editor.getModel()
                .canRedo() : false
        };
    }

    // Fixed reopenLastClosedTab method
    static async reopenLastClosedTab() {
        if (this.closedTabsStack.length === 0) return;

        const closedTab = this.closedTabsStack.pop();
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
                currentContent = await window.electronAPI.readFile(filePath);
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
    }

    static updateEditorContent(filePath) {
        const content = this.tabs.get(filePath); // Obtém o conteúdo da aba ativa
        if (editor && content !== undefined) {
            // Atualiza o conteúdo do Monaco Editor
            editor.setValue(content);

            // Determina a linguagem do arquivo com base na extensão
            const extension = filePath.split('.')
                .pop()
                .toLowerCase();
            const languageMap = {
                'js': 'javascript',
                'jsx': 'javascript',
                'ts': 'typescript',
                'tsx': 'typescript',
                'html': 'html',
                'css': 'css',
                'json': 'json',
                'md': 'markdown',
                'py': 'python',
                'c': 'c',
                'cpp': 'cpp',
                'h': 'c',
                'hpp': 'cpp'
            };
            const language = languageMap[extension] || 'plaintext';

            // Atualiza o modelo do Monaco Editor com o novo conteúdo e linguagem
            editor.getModel()
                ?.dispose();
            editor.setModel(monaco.editor.createModel(content, language));
        } else {
            console.error(`No content found for ${filePath}`);
        }
    }
    // Whenever a Monaco editor (main or split) gets keyboard focus, it
    // dispatches `aurora-editor-focused` with the file path it's showing.
    // We use that to keep the tab UI in sync with where the cursor really
    // lives — the user shouldn't have to click the tab manually after
    // tabbing through panes or focusing a split via the keyboard.
    static _bindEditorFocusActivation() {
        if (this._editorFocusBound) return;
        this._editorFocusBound = true;
        // VS Code-style: the file tree's open-file highlight is BRIGHT while an
        // editor has focus and MUTED otherwise. Toggle a body class from the
        // editors' focus/blur, debounced so switching main<->split (blur then
        // focus) doesn't flicker the highlight off for a frame.
        let _editorBlurTimer = null;
        document.addEventListener('aurora-editor-focusstate', (e) => {
            if (e.detail && e.detail.focused) {
                if (_editorBlurTimer) { clearTimeout(_editorBlurTimer); _editorBlurTimer = null; }
                document.body.classList.add('editor-has-focus');
            } else {
                if (_editorBlurTimer) clearTimeout(_editorBlurTimer);
                _editorBlurTimer = setTimeout(() => {
                    document.body.classList.remove('editor-has-focus');
                    _editorBlurTimer = null;
                }, 150);
            }
        });
        document.addEventListener('aurora-editor-focused', (e) => {
            const detail = e.detail || {};
            const { filePath, paneIndex } = detail;
            if (!filePath) return;

            if (paneIndex === 0) {
                // Main pane — promote preview if needed and activate. Re-activate
                // not just when the active FILE differs, but also when the file
                // is active yet its tab lost the visual `.active` class (a split
                // pane's own activation, or the global activateTab, can strip it)
                // — so focusing the editor ALWAYS leaves its tab highlighted.
                const tabEl = document.querySelector(`.tab:not(.split-tab)[data-path="${CSS.escape(filePath)}"]`);
                if (this.activeTab !== filePath || !tabEl?.classList.contains('active')) {
                    if (this.previewTab === filePath) {
                        this.promotePreviewToPermanent(filePath);
                    }
                    this.activateTab(filePath);
                }
                // Cross-pane focus: clicking into the main editor (or its
                // tab) must flip the SplitEditorManager focus back to 0,
                // otherwise a split pane stays "focused" (un-dimmed) even
                // though the cursor is in the main pane.
                window.SplitEditorManager?.setFocus?.(0);
            }
            // Split panes are handled inside SplitEditorManager so they can
            // reach into their own pane's tab bar without going through us.
        });
    }

    // Initialize on script load
    static initialize() {
        // Idempotent: this runs at module load (bottom of this file) AND from
        // renderer.js on DOMContentLoaded. Without the guard every listener
        // here — including onFileChanged — was registered twice, so an external
        // change fired its handler (and a reload) twice (P5).
        if (this._initialized) return;
        this._initialized = true;
        this.initSortableTabs();
        this.restoreTabOrder();
        this.initFileChangeListeners();
        this.updateTabsContainerVisibility();
        this._bindEditorFocusActivation();

        // Add event listener to save tab order when tabs change
        const tabContainer = document.getElementById('tabs-container');
        if (tabContainer) {
            const observer = new MutationObserver(() => {
                this.saveTabOrder();
            });

            observer.observe(tabContainer, {
                childList: true,
                subtree: true
            });
        }
    }
}

// Install all mixins. Methods reference `this`, which resolves to TabManager
// when called as TabManager.foo(...). Order doesn't matter — none of the
// mixins shadow each other or the core class methods.
Object.assign(TabManager, tabViewers, tabDrag, tabWatchers);

// Call initialization when the script loads
TabManager.initialize();

// Atualizar a função de inicialização do contexto
// (currently disabled — see commented call below)
// eslint-disable-next-line no-unused-vars
function initContextPath() {
    const _editorContainer = document.getElementById('monaco-editor')
        .parentElement;
    const contextContainer = document.createElement('div');
    contextContainer.id = 'context-path';
    contextContainer.className = 'context-path-container empty';

    // Inserir após o container de tabs
    const tabsContainer = document.getElementById('editor-tabs');
    if (tabsContainer) {
        tabsContainer.after(contextContainer);
    }
}

window.addEventListener('beforeunload', () => {
    TabManager.stopAllWatchers();
});

// Initialize tab container
function initTabs() {

    const editorContainer = document.getElementById('monaco-editor')
        .parentElement;
    const tabsContainer = document.createElement('div');
    if (document.getElementById('editor-tabs')) return;

    tabsContainer.id = 'editor-tabs';
    editorContainer.insertBefore(tabsContainer, editorContainer.firstChild);


    if (!document.getElementById('editor-tabs')) {
        const tabsContainer = document.createElement('div');
        tabsContainer.id = 'editor-tabs';
        editorContainer.insertBefore(tabsContainer, editorContainer.firstChild);
    }

    // if (!document.getElementById('context-path')) {
    //     initContextPath();  // temporarily disabled — context-path bar hidden
    // }
}

window.addEventListener('load', () => {
    initTabs();
});

// NOTE: the editor shortcuts (Ctrl+N / Ctrl+W / Ctrl+S / Ctrl+Shift+T /
// Ctrl+Shift+S) USED to live here as a SECOND document 'keydown' handler. It
// duplicated shortcut_manager.js — the Phase-B unified entry that routes
// through AuroraAPI, whose editor.closeTab()/reopenLastTab()/save()/saveAll()/
// newFile() call the IDENTICAL TabManager methods (so the split-to-split close
// behaviour is preserved). Having both meant Ctrl+W closed TWO tabs at once:
// this handler had no input-focus guard, so outside the Monaco editor BOTH
// handlers fired (the shortcut_manager skipped textareas, hence inside the
// editor only this one ran → a single close, which is why the doubling only
// showed up outside the editor). Removed — shortcut_manager.js is now the sole
// owner of these shortcuts (Ctrl+W closes exactly one tab; Ctrl+Shift+W no
// longer closes anything since shortcut_manager's closeTab requires shift:off).

// Simple, reliable confirmation dialog. Exported so split_editor.js can
// run the same VS Code-style "save / don't save / cancel" prompt before
// disposing the file's last instance.
export function showUnsavedChangesDialog(fileName) {
    return new Promise((resolve) => {
        // Remove any existing modals
        const existingModal = document.querySelector('.confirm-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHTML = `
            <div class="confirm-modal" id="unsaved-changes-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-header">
                        <div class="confirm-modal-icon">⚠</div>
                        <h3 class="confirm-modal-title">Unsaved Changes</h3>
                    </div>
                    <div class="confirm-modal-message">
                        Do you want to save the changes you made to "<strong>${fileName}</strong>"?<br>
                        Your changes will be lost if you don't save them.
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="confirm-btn cancel" data-action="cancel">Cancel</button>
                        <button class="confirm-btn dont-save" data-action="dont-save">Don't Save</button>
                        <button class="confirm-btn save" data-action="save">Save</button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('unsaved-changes-modal');

        // Handle button clicks
        modal.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action) {
                closeModal(action);
            }
        });

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal('cancel');
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Close modal function
        function closeModal(result) {
            document.removeEventListener('keydown', handleEscape);
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 300);
        }

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
            // Focus the Save button by default
            modal.querySelector('.confirm-btn.save')
                .focus();
        }, 10);
    });
}
