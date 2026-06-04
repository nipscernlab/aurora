/**
 * project_tree_actions.js — ActionsMixin do ProjectTreeManager.
 *
 * Camada de interacao do usuario:
 *   - Drag-and-drop de .v na file tree
 *   - Context menu (right-click numa row) com set/unset top-level,
 *     mark/unmark testbench, delete
 *   - Context menu de area vazia: "New Verilog File"
 *   - Delete inline via botao da row
 *
 * A categoria synth-vs-testbench NAO e editada aqui — e derivada do
 * conteudo do arquivo por [verilog_classifier.js](verilog_classifier.js),
 * via this._classifyAll() (definido em file_mode.js).
 *
 * Mixed in via Object.assign(ProjectTreeManager.prototype, ActionsMixin)
 * em file_mode.js. Cada metodo usa `this` da classe, com acesso a:
 *   - this.verilogFiles, this.isTreeActive, this.elements (state mixin)
 *   - this.ALLOWED_EXTENSIONS, this.SOFTWARE_EXTENSIONS (state mixin)
 *   - this.getFileExtension, this.sortFilesAlphabetically (state mixin)
 *   - this.saveConfiguration, this.refreshTree, this.showNotification
 *     (state mixin)
 *   - this.renderTree (render mixin)
 *
 * Os handlers `preventDefaults` / `handleDragEnter` / `handleDragLeave`
 * / `handleDrop` / `handleTreeContextMenu` / `createNewFile` /
 * `deleteFile` / `closeContextMenu` sao bindados a `this` no
 * constructor da classe — entao funcionam tanto como event handlers
 * (passados como referencia) quanto como metodos.
 */

import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from './project_store.js';
import { SpfStore } from './spf_store.js';
import { toNativeSeparators } from '../utils/path_utils.js';
import { classifyVerilogContent } from './verilog_classifier.js';

// i18n shim — falls back to the key path if i18n didn't boot yet
// (rare; renderer hits these only after DOMContentLoaded).
const tr = (k, p) => (window.t ? window.t(k, p) : k);

export const ActionsMixin = {
    // ----- drag and drop -----------------------------------------------

    /** Cancela o default do browser pra eventos drag/drop. */
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    },

    handleDragEnter() {
        if (this.isTreeActive) {
            this.elements.fileTree.classList.add('verilog-dragover');
        }
    },

    handleDragLeave(e) {
        if (this.isTreeActive) {
            const rect = this.elements.fileTree.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX >= rect.right ||
                e.clientY < rect.top || e.clientY >= rect.bottom) {
                this.elements.fileTree.classList.remove('verilog-dragover');
            }
        }
    },

    /**
     * File drop handler — itera os arquivos, valida path/extensao/
     * existencia e delega pra importFiles.
     */
    async handleDrop(e) {
        this.elements.fileTree.classList.remove('verilog-dragover');

        if (!this.isTreeActive) return;

        const droppedFiles = e.dataTransfer.files;

        if (!droppedFiles || droppedFiles.length === 0) {
            this.showNotification(tr('notification.tree.noFilesDropped'), 'warning', 2000);
            return;
        }

        const filesWithPath = [];

        for (let i = 0; i < droppedFiles.length; i++) {
            const file = droppedFiles[i];

            let filePath = window.electronAPI.getPathForFile(file);

            if (!filePath || filePath === '') {
                console.warn('Cannot get path for file:', file.name);
                this.showNotification(
                    tr('notification.tree.cannotGetPath', { name: file.name }),
                    'warning',
                    3000,
                );
                continue;
            }

            filePath = toNativeSeparators(filePath);

            const ext = this.getFileExtension(file.name);
            if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
                const hint = ext === '.gtkw' ? tr('notification.tree.gtkwHint') : '';
                this.showNotification(
                    tr('notification.tree.rejectedExt', { name: file.name, hint }),
                    'warning',
                    3000,
                );
                continue;
            }

            try {
                const exists = await window.electronAPI.fileExists(filePath);

                if (!exists) {
                    this.showNotification(
                        tr('notification.tree.fileNotExist', { path: filePath }),
                        'warning',
                        3000,
                    );
                    continue;
                }

                filesWithPath.push({
                    name: file.name,
                    path: filePath,
                    isTopLevel: false,
                });
            } catch (error) {
                console.error('Error validating file:', error);
                this.showNotification(
                    tr('notification.tree.errorValidating', { name: file.name }),
                    'error',
                    3000,
                );
            }
        }

        if (filesWithPath.length > 0) {
            await this.importFiles(filesWithPath);
        }
    },

    // ----- import + remove + create ------------------------------------

    /**
     * Import via drag-drop. Desenho transacional:
     *
     *   1. Captura `targetSpfPath` da entrada — toda escrita usa este
     *      handle. Trocar de projeto durante uma chamada nao reescreve
     *      o .spf errado.
     *   2. Valida + classifica os arquivos em dados LOCAIS (validFiles).
     *      Nao toca this.verilogFiles ate o write completar.
     *   3. Persiste via SpfStore.update(targetSpfPath, mutator). O
     *      mutator le o .spf fresh de dentro do write-chain, faz
     *      append-com-dedup, e devolve. SpfStore.update serializa
     *      writes per-path, entao um refresh concorrente nao corrompe.
     *   4. SpfStore.update dispara aurora:spf-changed apos o write —
     *      se ainda estamos no mesmo projeto, file_mode.js refresca
     *      a tree do disco. Se trocou de projeto, o evento e
     *      filtrado pelo listener (spfPath nao bate) e a UI fica
     *      paciente; ao reabrir o projeto, o load le os novos files.
     *
     * "in-memory state nao e a fonte de verdade" e o invariante aqui.
     * this.verilogFiles e um cache, nao deve ser mutado por handlers.
     */
    async importFiles(files) {
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) {
            this.showNotification(tr('notification.tree.noValidFiles'), 'warning', 3000);
            return;
        }

        const validFiles = [];
        const errors = [];

        for (const file of files) {
            if (!file.path || file.path === '') {
                errors.push(tr('notification.tree.noPath', { name: file.name }));
                continue;
            }

            const ext = this.getFileExtension(file.name);

            if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
                errors.push(tr('notification.tree.unsupportedExt', { name: file.name, ext }));
                continue;
            }

            if (this.verilogFiles.some(f => f.path === file.path)) {
                errors.push(tr('notification.tree.alreadyExists', { name: file.name }));
                continue;
            }

            validFiles.push({
                name: file.name,
                path: file.path,
                isTopLevel: false,
                category: 'synthesizable',
            });
        }

        if (errors.length > 0) {
            errors.forEach((error) => {
                this.showNotification(error, 'warning', 2500);
            });
        }

        if (validFiles.length === 0) {
            if (errors.length === 0) {
                this.showNotification(tr('notification.tree.noValidFiles'), 'warning', 3000);
            }
            return;
        }

        // Classifica cada arquivo lendo conteudo do disco. Atualiza
        // os objetos LOCAIS (validFiles) — refreshs concorrentes nao
        // alcancam estes flags.
        for (const f of validFiles) {
            if (/\.py$/i.test(f.name)) {
                f.category = 'testbench';
                continue;
            }
            try {
                const content = await window.electronAPI.readFile(f.path);
                f.category = classifyVerilogContent(content, f.name);
            } catch (err) {
                console.warn(`Classifier: cannot read ${f.path}:`, err);
                f.category = 'synthesizable';
            }
        }

        // Transacao atomica. Le o .spf fresh dentro do write-chain
        // do SpfStore (serializado per-path), faz append-com-dedup,
        // escreve. Trocar de projeto durante a classificacao acima
        // nao afeta esta chamada — targetSpfPath ja foi capturado.
        await SpfStore.update(targetSpfPath, (cfg) => {
            const synthFiles = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
            const tbFiles = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];
            const seen = new Set([
                ...synthFiles.map((f) => this._normalizePath(f.path)),
                ...tbFiles.map((f) => this._normalizePath(f.path)),
            ]);
            for (const f of validFiles) {
                const key = this._normalizePath(f.path);
                if (seen.has(key)) continue;
                const entry = { name: f.name, path: f.path, isTopLevel: false };
                if (f.category === 'testbench') tbFiles.push(entry);
                else synthFiles.push(entry);
                seen.add(key);
            }
            cfg.synthesizableFiles = synthFiles;
            cfg.testbenchFiles = tbFiles;
        });

        this.showNotification(
            tr('notification.tree.added', { count: validFiles.length }),
            'success',
            2000,
        );
    },

    /**
     * Cria um novo .v via Save Dialog, grava placeholder no disco,
     * adiciona à lista e abre na aba.
     *
     * Padrao transacional: captura `targetSpfPath` na entrada, escreve
     * o disco e persiste no .spf via SpfStore.update — ver doc do
     * importFiles. UI re-renderiza via aurora:spf-changed.
     */
    async createNewFile() {
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) {
            this.showNotification(tr('notification.tree.errorCreating'), 'error', 3000);
            return;
        }

        try {
            const projectPath = ProjectStore.getProjectPath();

            // O Save Dialog do Windows nao valida nome — aceita espacos,
            // acentos, simbolos. Como esses nomes viram identifier de
            // modulo Verilog e tambem sao passados na linha de comando
            // do iverilog/yanc, restringimos pra [a-zA-Z0-9_-]+.
            // Loop com nome sanitizado como sugestao pro usuario nao
            // precisar fechar/abrir o dialog manualmente.
            let suggested = 'untitled';
            let finalPath = null;
            while (finalPath === null) {
                const defaultPath = projectPath
                    ? await window.electronAPI.joinPath(projectPath, `${suggested}.v`)
                    : `${suggested}.v`;

                const result = await window.electronAPI.showSaveDialog({
                    title: tr('contextMenu.saveNewVerilog'),
                    defaultPath,
                    filters: [
                        { name: 'Verilog Files', extensions: ['v'] },
                    ],
                    properties: ['createDirectory', 'showOverwriteConfirmation'],
                });

                if (result.canceled || !result.filePath) return;

                const filePath = result.filePath;
                const candidatePath = filePath.endsWith('.v') ? filePath : filePath + '.v';
                const candidateBase = basenameOf(candidatePath).replace(/\.v$/i, '');

                if (isValidVerilogFileName(candidateBase)) {
                    finalPath = candidatePath;
                } else {
                    suggested = sanitizeVerilogFileName(candidateBase);
                    this.showNotification(
                        tr('notification.tree.invalidName', { name: basenameOf(candidatePath), suggestion: `${suggested}.v` }),
                        'warning',
                        4000,
                    );
                }
            }
            const finalFileName = basenameOf(finalPath);

            await window.electronAPI.writeFile(finalPath, '// New Verilog file\n');

            // Append-com-dedup atomico no .spf capturado. Arquivo novo
            // / vazio cai como 'synthesizable' (default seguro;
            // _classifyAll re-roda no refresh e ajusta se necessario).
            await SpfStore.update(targetSpfPath, (cfg) => {
                const synthFiles = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
                const tbFiles = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];
                const targetKey = this._normalizePath(finalPath);
                const synthIdx = synthFiles.findIndex((f) => this._normalizePath(f.path) === targetKey);
                const tbIdx = tbFiles.findIndex((f) => this._normalizePath(f.path) === targetKey);
                if (synthIdx < 0 && tbIdx < 0) {
                    synthFiles.push({ name: finalFileName, path: finalPath, isTopLevel: false });
                }
                cfg.synthesizableFiles = synthFiles;
                cfg.testbenchFiles = tbFiles;
            });

            this.showNotification(tr('notification.tree.created', { name: finalFileName }), 'success', 2000);

            try {
                const content = await window.electronAPI.readFile(finalPath);
                TabManager.addTab(finalPath, content);
            } catch (error) {
                console.error('Error opening new file:', error);
            }
        } catch (error) {
            console.error('Error creating file:', error);
            this.showNotification(tr('notification.tree.errorCreating'), 'error', 3000);
        }
    },

    async createNewCocotbFile() {
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) {
            this.showNotification(tr('notification.tree.errorCreating'), 'error', 3000);
            return;
        }

        try {
            const projectPath = ProjectStore.getProjectPath();
            let suggested = 'test_dut';
            let finalPath = null;
            while (finalPath === null) {
                const defaultPath = projectPath
                    ? await window.electronAPI.joinPath(projectPath, `${suggested}.py`)
                    : `${suggested}.py`;

                const result = await window.electronAPI.showSaveDialog({
                    title: tr('contextMenu.saveNewCocotb'),
                    defaultPath,
                    filters: [
                        { name: 'Python cocotb Testbenches', extensions: ['py'] },
                    ],
                    properties: ['createDirectory', 'showOverwriteConfirmation'],
                });

                if (result.canceled || !result.filePath) return;

                const filePath = result.filePath;
                const candidatePath = filePath.endsWith('.py') ? filePath : filePath + '.py';
                const candidateBase = basenameOf(candidatePath).replace(/\.py$/i, '');

                if (isValidPythonModuleName(candidateBase)) {
                    finalPath = candidatePath;
                } else {
                    suggested = sanitizePythonModuleName(candidateBase);
                    this.showNotification(
                        tr('notification.tree.invalidName', { name: basenameOf(candidatePath), suggestion: `${suggested}.py` }),
                        'warning',
                        4000,
                    );
                }
            }

            const finalFileName = basenameOf(finalPath);
            const template = `import cocotb
from cocotb.triggers import Timer


@cocotb.test()
async def basic_test(dut):
    dut._log.info("Starting cocotb test")
    await Timer(1, unit="ns")
`;

            await window.electronAPI.writeFile(finalPath, template);

            await SpfStore.update(targetSpfPath, (cfg) => {
                const synthFiles = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
                const tbFiles = Array.isArray(cfg.testbenchFiles) ? cfg.testbenchFiles : [];
                const targetKey = this._normalizePath(finalPath);
                const synthIdx = synthFiles.findIndex((f) => this._normalizePath(f.path) === targetKey);
                if (synthIdx >= 0) synthFiles.splice(synthIdx, 1);
                if (!tbFiles.some((f) => this._normalizePath(f.path) === targetKey)) {
                    tbFiles.push({ name: finalFileName, path: finalPath, isTopLevel: false });
                }
                cfg.synthesizableFiles = synthFiles;
                cfg.testbenchFiles = tbFiles;
            });

            this.showNotification(tr('notification.tree.created', { name: finalFileName }), 'success', 2000);

            try {
                const content = await window.electronAPI.readFile(finalPath);
                TabManager.addTab(finalPath, content);
            } catch (error) {
                console.error('Error opening new cocotb file:', error);
            }
        } catch (error) {
            console.error('Error creating cocotb file:', error);
            this.showNotification(tr('notification.tree.errorCreating'), 'error', 3000);
        }
    },

    /**
     * Apaga o arquivo do disco e remove a entry do .spf. Confirma com
     * o usuario antes via dialog canonico. Padrao transacional — ver
     * doc do importFiles.
     */
    async deleteFile(index) {
        if (!this.verilogFiles[index]) return;
        // Captura path + nome ANTES do confirm: o array pode mudar
        // durante o await (refresh, project switch, outro delete) e o
        // index nao significa mais nada. Path/name sao stable.
        const filePath = this.verilogFiles[index].path;
        const fileName = this.verilogFiles[index].name;
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) return;

        const confirmed = await showDeleteConfirmDialog(fileName);
        if (!confirmed) return;

        try {
            await window.electronAPI.deleteFile(filePath);
            await this._dropFileFromSpf(targetSpfPath, filePath);
            this.showNotification(tr('notification.tree.deleted', { name: fileName }), 'success', 2000);
            if (TabManager.tabs && TabManager.tabs.has(filePath)) {
                TabManager.closeTab(filePath);
            }
        } catch (error) {
            console.error('Error deleting file:', error);

            if (error.code === 'ENOENT') {
                // Arquivo ja sumiu do disco — limpa a entry stale do .spf.
                await this._dropFileFromSpf(targetSpfPath, filePath);
                this.showNotification(tr('notification.tree.alreadyDeleted', { name: fileName }), 'info', 2000);
            } else {
                this.showNotification(
                    tr('notification.tree.errorDeleting', { name: fileName, error: error.message }),
                    'error',
                    3000,
                );
            }
        }
    },

    /** Remocao sem prompt — apaga do .spf, anima a row out. */
    async removeFile(index) {
        if (!this.verilogFiles[index]) return;
        const filePath = this.verilogFiles[index].path;
        const fileName = this.verilogFiles[index].name;
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) return;

        const fileItem = document.querySelector(`.verilog-file-item[data-file-index="${index}"]`);

        const doRemove = async () => {
            await this._dropFileFromSpf(targetSpfPath, filePath);
            this.showNotification(tr('notification.tree.removed', { name: fileName }), 'success', 2000);
        };

        if (fileItem) {
            fileItem.classList.add('verilog-file-animate-out');
            setTimeout(doRemove, 300);
        } else {
            await doRemove();
        }
    },

    // ----- path-keyed actions ------------------------------------------

    /** Delete path-keyed — direto ao mutator, sem traduzir pra index. */
    async _removeFileByPath(path) {
        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) return;
        const file = this.verilogFiles.find((f) => f.path === path);
        if (!file) return;
        await this._dropFileFromSpf(targetSpfPath, path);
        this.showNotification(tr('notification.tree.removed', { name: file.name }), 'success', 2000);
    },

    /**
     * Mutator helper: remove uma entry path-keyed dos arrays do .spf.
     * Idempotente (no-op se nao existe). Limpa topLevelFile e
     * testbenchFile se eles apontavam pro path removido.
     */
    async _dropFileFromSpf(spfPath, filePath) {
        const targetKey = this._normalizePath(filePath);
        await SpfStore.update(spfPath, (cfg) => {
            const filterOut = (arr) => (Array.isArray(arr) ? arr : []).filter(
                (f) => this._normalizePath(f.path) !== targetKey,
            );
            cfg.synthesizableFiles = filterOut(cfg.synthesizableFiles);
            cfg.testbenchFiles = filterOut(cfg.testbenchFiles);
            if (typeof cfg.topLevelFile === 'string' && this._normalizePath(cfg.topLevelFile) === targetKey) {
                cfg.topLevelFile = '';
            }
            if (typeof cfg.testbenchFile === 'string' && this._normalizePath(cfg.testbenchFile) === targetKey) {
                cfg.testbenchFile = '';
            }
        });
    },

    // ----- context menus -----------------------------------------------

    /** Context menu displayed when the user right-clicks a processor separator. */
    showProcessorContextMenu(event, procName) {
        this.closeAllTreeMenus();

        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'verilog-context-menu';
        menu.innerHTML = `
            <div class="context-menu-item delete-item" data-action="delete-processor">
                <i class="fa-solid fa-trash"></i>
                <span>Delete processor</span>
            </div>
        `;

        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
        document.body.appendChild(menu);

        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth)  menu.style.left = (event.pageX - rect.width) + 'px';
            if (rect.bottom > window.innerHeight) menu.style.top  = (event.pageY - rect.height) + 'px';
            menu.classList.add('show');
        }, 10);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;
            if (item.dataset.action === 'delete-processor') {
                this.closeContextMenu();
                await this._deleteProcessorByName(procName);
            }
        });

        setTimeout(() => {
            document.addEventListener('click', this.closeContextMenu, { once: true });
        }, 100);
    },

    /** Delete a processor folder entirely (same flow as the trash icon on the folder row). */
    async _deleteProcessorByName(procName) {
        const dialog = window.AuroraUI?.dialog;
        let confirmed;
        if (typeof dialog === 'function') {
            const action = await dialog({
                title: 'Delete processor',
                message: `Delete processor "${procName}" and all its files from disk? This cannot be undone.`,
                variant: 'warning',
                buttons: [
                    { label: 'Cancel',  action: 'cancel', type: 'cancel' },
                    { label: 'Delete',  action: 'delete', type: 'danger' },
                ],
            });
            confirmed = action === 'delete';
        } else {
            confirmed = window.confirm(`Delete processor "${procName}" and all its files? This cannot be undone.`);
        }
        if (!confirmed) return;

        try {
            await window.electronAPI.deleteProcessor(procName);
            // Tree refresh is triggered by the project:processors IPC broadcast
            // from the main process after deletion. No explicit refreshTree() needed.
        } catch (err) {
            console.error('Error deleting processor:', err);
            this.showNotification(`Error deleting processor: ${err.message}`, 'error', 4000);
        }
    },

    /** Fecha o context menu de row (set top-level, mark tb, delete). */
    closeContextMenu() {
        const existingMenu = document.getElementById('verilog-context-menu');
        if (existingMenu) {
            existingMenu.classList.remove('show');
            setTimeout(() => existingMenu.remove(), 200);
        }
    },

    /** Fecha o context menu de area vazia (New Verilog File). */
    closeCreateMenu() {
        const existingMenu = document.getElementById('verilog-create-menu');
        if (existingMenu) {
            existingMenu.classList.remove('show');
            setTimeout(() => existingMenu.remove(), 200);
        }
    },

    /**
     * Card unico: fecha AMBOS os menus (row context + create) antes de abrir
     * qualquer um. Sem isso os dois coexistem — eles abrem no evento
     * `contextmenu` (botao direito), que nao dispara os handlers de
     * fechar-no-click (botao esquerdo), entao um right-click numa row com o
     * menu "New File" aberto deixava os dois cards na tela ao mesmo tempo.
     */
    closeAllTreeMenus() {
        this.closeContextMenu();
        this.closeCreateMenu();
    },

    /**
     * Monta e exibe o context menu de uma row (right-click num arquivo).
     * Para arquivos .v/.sv, ambas as opcoes (Top Level e Testbench Top)
     * sao sempre exibidas — o usuario pode setar qualquer .v como
     * qualquer dos dois sem ficar preso na categoria auto-detectada.
     */
    showContextMenu(event, file, index) {
        this.closeAllTreeMenus();

        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'verilog-context-menu';

        const ext = this.getFileExtension(file.name || '');
        const isVerilog = ext === '.v' || ext === '.sv';
        const isPython = ext === '.py';
        const canBeTestbench = isVerilog || isPython;

        // isTopLevel is relative to the file's current category.
        // A synthesizable file with isTopLevel=true is the synth top;
        // a testbench file with isTopLevel=true is the testbench top.
        const isSynthTop = isVerilog && file.category !== 'testbench' && !!file.isTopLevel;
        const isTbTop    = canBeTestbench && file.category === 'testbench'  && !!file.isTopLevel;

        let menuItems = '';

        if (canBeTestbench) {
            if (file.category === 'testbench') {
                // Testbench file — only the testbench-top toggle is relevant.
                menuItems += `
                    <div class="context-menu-item" data-action="${isTbTop ? 'remove-testbench' : 'set-testbench'}">
                        <i class="fa-solid fa-flask"></i>
                        <span>${isTbTop ? tr('contextMenu.unmarkTestbench') : tr('contextMenu.markTestbench')}</span>
                    </div>
                    <div class="context-menu-divider"></div>
                `;
            } else if (isVerilog) {
                // Synthesizable file — only the top-level toggle is relevant.
                menuItems += `
                    <div class="context-menu-item" data-action="${isSynthTop ? 'remove-top-level' : 'set-top-level'}">
                        <i class="fa-solid fa-flag"></i>
                        <span>${isSynthTop ? tr('contextMenu.removeTopLevel') : tr('contextMenu.setTopLevel')}</span>
                    </div>
                    <div class="context-menu-divider"></div>
                `;
            }
        }

        // "Remove from tree" is handled by the × button on each row.
        menu.innerHTML = `
            ${menuItems}
            <div class="context-menu-item delete-item" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>Delete file</span>
            </div>
        `;

        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';

        document.body.appendChild(menu);

        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (event.pageX - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (event.pageY - rect.height) + 'px';
            }
            menu.classList.add('show');
        }, 10);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item || item.classList.contains('disabled')) return;

            const action = item.getAttribute('data-action');
            await this.handleContextMenuAction(action, file, index);
            this.closeContextMenu();
        });

        setTimeout(() => {
            document.addEventListener('click', this.closeContextMenu, { once: true });
        }, 100);
    },

    /**
     * Handler do click no tree todo: right-click em row abre o
     * context menu da row; right-click em area vazia abre o "New
     * Verilog File" menu.
     */
    async handleTreeContextMenu(event) {
        if (!this.isTreeActive) return;

        // Right-click numa row → context menu per-row. Listeners
        // per-row sumiram com o render-reconciler refactor; este path
        // delegado os substitui. Busca por data-file-path —
        // lookups por indice sao evitados (quebram sob sort).
        const row = event.target.closest('.verilog-file-item');
        if (row) {
            event.preventDefault();
            event.stopPropagation();
            const path = row.dataset.filePath;
            const idx = this.verilogFiles.findIndex((f) => f.path === path);
            if (idx >= 0) this.showContextMenu(event, this.verilogFiles[idx], idx);
            return;
        }

        // Right-click on a processor separator → delete-processor menu.
        const sep = event.target.closest('.verilog-processor-separator');
        if (sep) {
            event.preventDefault();
            event.stopPropagation();
            const procName = sep.dataset.processorName;
            if (procName && procName !== '__imported__') {
                this.showProcessorContextMenu(event, procName);
            }
            return;
        }

        // Right-click em area vazia → menu "New File" (Verilog / Python).
        event.preventDefault();
        if (event.target.closest('button')) return;

        this.showCreateMenu(event.pageX, event.pageY);
    },

    /**
     * "New File" picker — the Verilog / Python (cocotb) chooser. Shared by
     * the empty-area right-click on the tree and the toolbar "New File"
     * button, so both entry points offer the exact same two options.
     *
     * `x`/`y` are viewport coordinates for the menu's top-left corner; the
     * menu flips back on-screen if it would overflow the right/bottom edge.
     */
    showCreateMenu(x, y) {
        this.closeAllTreeMenus();

        const menu = document.createElement('div');
        menu.className = 'verilog-create-menu';
        menu.id = 'verilog-create-menu';

        menu.innerHTML = `
            <div class="create-menu-item" data-action="create-file">
                <i class="fa-solid fa-file-code"></i>
                <span>${tr('contextMenu.newFile')}</span>
            </div>
            <div class="create-menu-item" data-action="create-cocotb">
                <i class="fa-brands fa-python"></i>
                <span>${tr('contextMenu.newCocotb')}</span>
            </div>
        `;

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        document.body.appendChild(menu);

        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (x - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (y - rect.height) + 'px';
            }
            menu.classList.add('show');
        }, 10);

        menu.addEventListener('click', async (e) => {
            const item = e.target.closest('.create-menu-item');
            if (!item) return;

            const action = item.getAttribute('data-action');
            if (action === 'create-file') {
                await TabManager.createNewFileFromDialog();
            } else if (action === 'create-cocotb') {
                await this.createNewCocotbFile();
            }
            this.closeCreateMenu();
        });

        const closeOnClickOutside = (e) => {
            if (!e.target.closest('#verilog-create-menu')) {
                this.closeCreateMenu();
                document.removeEventListener('click', closeOnClickOutside);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeOnClickOutside);
        }, 100);
    },

    /**
     * Aplica a acao escolhida no context menu da row. set/remove
     * top-level e mark/unmark testbench compartilham o campo
     * `isTopLevel` — o que muda e o escopo (synth vs testbench).
     */
    async handleContextMenuAction(action, file, index) {
        if (action === 'remove') {
            await this._removeFileByPath(file.path);
            return;
        }
        if (action === 'delete') {
            await this.deleteFile(index);
            return;
        }

        const targetSpfPath = ProjectStore.getSpfPath();
        if (!targetSpfPath) return;
        const targetKey = this._normalizePath(file.path);

        switch (action) {
            case 'set-top-level': {
                // AuroraAPI.setTopLevel handles cross-array membership
                // (moves the file to synthesizableFiles if needed).
                await window.AuroraAPI?.project?.setTopLevel(file.path);
                this.showNotification(tr('notification.tree.setAsTop', { name: file.name }), 'success', 2000);
                break;
            }

            case 'remove-top-level': {
                await this._mutateTopFlag(targetSpfPath, targetKey, 'synth', false);
                this.showNotification(tr('notification.tree.topRemoved', { name: file.name }), 'success', 2000);
                break;
            }

            case 'set-testbench': {
                // AuroraAPI.setTestbenchTop handles cross-array membership
                // (moves the file to testbenchFiles if needed).
                await window.AuroraAPI?.project?.setTestbenchTop(file.path);
                this.showNotification(tr('notification.tree.markedTb', { name: file.name }), 'success', 2000);
                break;
            }

            case 'remove-testbench': {
                await this._mutateTopFlag(targetSpfPath, targetKey, 'tb', false);
                this.showNotification(tr('notification.tree.tbUnmarked', { name: file.name }), 'success', 2000);
                break;
            }
        }
    },

    /**
     * Mutator helper: seta/limpa o flag isTopLevel + o ponteiro
     * topLevelFile / testbenchFile no .spf. Synth e testbench tem
     * tops independentes (um synth top + um testbench top
     * coexistem); o flag e exclusivo DENTRO da categoria.
     *
     * @param {string} spfPath capturado pelo caller
     * @param {string} targetKey path normalizado do arquivo alvo
     * @param {'synth'|'tb'} scope categoria afetada
     * @param {boolean} setTrue true=setar, false=limpar
     */
    async _mutateTopFlag(spfPath, targetKey, scope, setTrue) {
        await SpfStore.update(spfPath, (cfg) => {
            const arrKey = scope === 'tb' ? 'testbenchFiles' : 'synthesizableFiles';
            const pointerKey = scope === 'tb' ? 'testbenchFile' : 'topLevelFile';
            const arr = Array.isArray(cfg[arrKey]) ? cfg[arrKey] : [];
            // Duas passadas: primeiro acha o alvo, so depois muta. Se
            // o alvo nao estiver no .spf (caso de Hardware auto-
            // descoberto que nunca foi persistido), abortamos como
            // no-op. Sem isso, o ramo `setTrue` apagaria isTopLevel
            // de TODOS os outros sem nunca encontrar o alvo —
            // limpando silenciosamente o top level que o usuario
            // tinha setado antes.
            const targetEntry = arr.find((f) => this._normalizePath(f.path) === targetKey);
            if (!targetEntry) return;
            for (const f of arr) {
                if (f === targetEntry) {
                    f.isTopLevel = setTrue;
                } else if (setTrue) {
                    // Exclusividade dentro da categoria — outros perdem
                    // o flag quando este ganha.
                    f.isTopLevel = false;
                }
            }
            cfg[arrKey] = arr;
            cfg[pointerKey] = setTrue ? targetEntry.path : '';
        });
    },
};

// ---- helpers privados ------------------------------------------------

function basenameOf(filePath) {
    return filePath.split(/[\\/]/).pop();
}

// Regras de nome aceitas pra .v criado pela tree:
//   - Caracteres: letras ASCII, digitos, '_', '-'
//   - Nao vazio
// Mais permissivo que identifier Verilog estrito (que proibe digito
// inicial), mas evita 100% dos problemas reais — espacos quebram a CLI
// do iverilog/yanc, acentos quebram em alguns toolchains, e simbolos
// como `(` `)` `&` precisariam de escape no shell.
const VALID_VERILOG_FILENAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_PYTHON_MODULE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isValidVerilogFileName(baseName) {
    return VALID_VERILOG_FILENAME_RE.test(baseName);
}

function sanitizeVerilogFileName(baseName) {
    // U+0300..U+036F = Combining Diacritical Marks. NFD separa
    // "ção" em "c" + "~" + "a" + "~" + "o"; removendo o range tira
    // o acento mas mantem o caractere base.
    const cleaned = String(baseName || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'untitled';
}

function isValidPythonModuleName(baseName) {
    return VALID_PYTHON_MODULE_RE.test(baseName);
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

/**
 * Confirm dialog do delete. Routes via showDialog canonico
 * (window.AuroraUI.dialog) pra que o visual case com o resto do IDE.
 * Defensive fallback pra window.confirm se o dialog_manager nao
 * carregou ainda.
 */
function showDeleteConfirmDialog(fileName) {
    const dialog = window.AuroraUI?.dialog;
    if (typeof dialog !== 'function') {
        return Promise.resolve(window.confirm(tr('dialog.deleteFile.fallbackPrompt', { name: fileName })));
    }
    return dialog({
        title: tr('dialog.deleteFile.title'),
        message: tr('dialog.deleteFile.message', { name: fileName }),
        variant: 'warning',
        buttons: [
            { label: tr('dialog.common.cancel'),  action: 'cancel', type: 'cancel' },
            { label: tr('dialog.deleteFile.delete'), action: 'delete', type: 'danger' },
        ],
    }).then((action) => action === 'delete');
}
