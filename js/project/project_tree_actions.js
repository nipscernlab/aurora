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
import { toNativeSeparators } from '../utils/path_utils.js';

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
     * Caminho comum do import via drag-drop: valida extensoes,
     * dedup contra this.verilogFiles e empurra os validos antes de
     * persistir e re-renderizar.
     */
    async importFiles(files) {
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

        this.verilogFiles.push(...validFiles);
        // Categoria e detectada do conteudo, nao escolhida no import —
        // _classifyAll le cada .v e marca synth/testbench.
        await this._classifyAll();
        this.sortFilesAlphabetically();
        await this.saveConfiguration();
        this.renderTree();

        this.showNotification(
            tr('notification.tree.added', { count: validFiles.length }),
            'success',
            2000,
        );
    },

    /**
     * Cria um novo .v via Save Dialog, grava placeholder no disco,
     * adiciona à lista e abre na aba.
     */
    async createNewFile() {
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

            const newFile = {
                name: finalFileName,
                path: finalPath,
                isTopLevel: false,
            };

            this.verilogFiles.push(newFile);
            // Classifica pelo conteudo (um arquivo novo / vazio cai em
            // 'synthesizable' — o default seguro).
            await this._classifyAll();
            this.sortFilesAlphabetically();
            await this.saveConfiguration();
            this.renderTree();

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

    /**
     * Apaga o arquivo do disco e remove da lista. Confirma com o
     * usuario antes via dialog canonico.
     */
    async deleteFile(index) {
        if (!this.verilogFiles[index]) return;

        const file = this.verilogFiles[index];
        const fileName = file.name;

        const confirmed = await showDeleteConfirmDialog(fileName);

        if (!confirmed) return;

        try {
            await window.electronAPI.deleteFile(file.path);

            this.verilogFiles.splice(index, 1);
            await this.saveConfiguration();
            this.renderTree();

            this.showNotification(tr('notification.tree.deleted', { name: fileName }), 'success', 2000);

            if (TabManager.tabs && TabManager.tabs.has(file.path)) {
                TabManager.closeTab(file.path);
            }
        } catch (error) {
            console.error('Error deleting file:', error);

            if (error.code === 'ENOENT') {
                this.verilogFiles.splice(index, 1);
                await this.saveConfiguration();
                this.renderTree();
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

    /** Remocao sem prompt — splice + save + render. */
    async removeFile(index) {
        if (!this.verilogFiles[index]) return;

        const fileName = this.verilogFiles[index].name;
        const fileItem = document.querySelector(`.verilog-file-item[data-file-index="${index}"]`);

        const doRemove = async () => {
            this.verilogFiles.splice(index, 1);
            await this.saveConfiguration();
            this.renderTree();
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

    /** Delete path-keyed — splice + re-render (sem prompt). */
    async _removeFileByPath(path) {
        const idx = this.verilogFiles.findIndex((f) => f.path === path);
        if (idx < 0) return;
        return this.removeFile(idx);
    },

    // ----- context menus -----------------------------------------------

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
     * Monta e exibe o context menu de uma row (right-click num arquivo).
     * Opcoes mudam por categoria:
     *   - synth   → set/remove top level
     *   - tb      → mark/unmark testbench (mesma flag isTopLevel,
     *               label diferente)
     *   - sempre  → remove file
     */
    showContextMenu(event, file, index) {
        this.closeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'verilog-context-menu';

        // Single source of truth: `isTopLevel` significa "top da sua
        // categoria". Label e action variam por categoria, mas o flag
        // subjacente e o mesmo.
        const isTopLevel = file.isTopLevel || false;
        const isSynthesizable = file.category !== 'testbench';
        const isTestbench = file.category === 'testbench';

        const topLevelOption = isSynthesizable ? (
            isTopLevel
                ? { text: tr('contextMenu.removeTopLevel'),  action: 'remove-top-level', disabled: false, show: true }
                : { text: tr('contextMenu.setTopLevel'),     action: 'set-top-level',    disabled: false, show: true }
        ) : { show: false };

        const testbenchOption = isTestbench ? (
            isTopLevel
                ? { text: tr('contextMenu.unmarkTestbench'), action: 'remove-testbench', disabled: false, show: true }
                : { text: tr('contextMenu.markTestbench'),   action: 'set-testbench',    disabled: false, show: true }
        ) : { show: false };

        let menuItems = '';

        if (topLevelOption.show) {
            menuItems += `
                <div class="context-menu-item" data-action="${topLevelOption.action}">
                    <span>${topLevelOption.text}</span>
                </div>
            `;
        }

        if (testbenchOption.show) {
            menuItems += `
                <div class="context-menu-item" data-action="${testbenchOption.action}">
                    <span>${testbenchOption.text}</span>
                </div>
            `;
        }

        if (menuItems) {
            menuItems += '<div class="context-menu-divider"></div>';
        }

        menu.innerHTML = `
            ${menuItems}
            <div class="context-menu-item delete-item" data-action="delete">
                <span>${tr('contextMenu.removeFile')}</span>
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

        // Right-click em area vazia → "New Verilog File" menu.
        event.preventDefault();
        if (event.target.closest('button')) return;

        this.closeCreateMenu();

        const menu = document.createElement('div');
        menu.className = 'verilog-create-menu';
        menu.id = 'verilog-create-menu';

        menu.innerHTML = `
            <div class="create-menu-item" data-action="create-file">
                <i class="fa-solid fa-file-code"></i>
                <span>${tr('contextMenu.newVerilog')}</span>
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
            const item = e.target.closest('.create-menu-item');
            if (!item) return;

            const action = item.getAttribute('data-action');
            if (action === 'create-file') {
                await this.createNewFile();
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
        switch (action) {
            case 'set-top-level':
                if (file.category === 'testbench') {
                    this.showNotification(tr('notification.tree.cannotSetTopOnTb'), 'warning', 3000);
                    return;
                }
                // Clear the flag only within the same category. Um synth
                // top e um testbench top sao independentes — setar um
                // nao deveria limpar o outro (o codigo anterior
                // limpava, silenciosamente desmarcando seu testbench
                // toda vez que voce setava um Top Level).
                this.verilogFiles.forEach((f) => {
                    if (f.category !== 'testbench') f.isTopLevel = false;
                });
                this.verilogFiles[index].isTopLevel = true;
                this.showNotification(tr('notification.tree.setAsTop', { name: file.name }), 'success', 2000);
                break;

            case 'remove-top-level':
                this.verilogFiles[index].isTopLevel = false;
                this.showNotification(tr('notification.tree.topRemoved', { name: file.name }), 'success', 2000);
                break;

            case 'set-testbench':
                if (file.category !== 'testbench') {
                    this.showNotification(tr('notification.tree.notTestbench'), 'warning', 3000);
                    return;
                }
                // Idem set-top-level, mas escopado a testbench. O campo
                // unificado e `isTopLevel`; o render escolhe a label
                // certa via category.
                this.verilogFiles.forEach((f) => {
                    if (f.category === 'testbench') f.isTopLevel = false;
                });
                this.verilogFiles[index].isTopLevel = true;
                this.showNotification(tr('notification.tree.markedTb', { name: file.name }), 'success', 2000);
                break;

            case 'remove-testbench':
                this.verilogFiles[index].isTopLevel = false;
                this.showNotification(tr('notification.tree.tbUnmarked', { name: file.name }), 'success', 2000);
                break;

            case 'delete':
                await this.deleteFile(index);
                break;
        }

        if (action !== 'delete') {
            this.sortFilesAlphabetically();
            await this.saveConfiguration();
            this.renderTree();
        }
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

function isValidVerilogFileName(baseName) {
    return VALID_VERILOG_FILENAME_RE.test(baseName);
}

function sanitizeVerilogFileName(baseName) {
    // U+0300..U+036F = Combining Diacritical Marks. NFD separa
    // "ção" em "c" + "~" + "a" + "~" + "o"; removendo o range tira
    // o acento mas mantem o caractere base.
    const cleaned = baseName
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'untitled';
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
        return Promise.resolve(window.confirm(`Delete "${fileName}"? This cannot be undone.`));
    }
    return dialog({
        title: 'Delete File',
        message: `Are you sure you want to delete "<strong>${fileName}</strong>"? This action cannot be undone.`,
        variant: 'warning',
        buttons: [
            { label: 'Cancel', action: 'cancel', type: 'cancel' },
            { label: 'Delete', action: 'delete', type: 'danger' },
        ],
    }).then((action) => action === 'delete');
}
