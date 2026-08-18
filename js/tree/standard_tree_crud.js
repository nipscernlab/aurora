/**
 * standard_tree_crud.js: VS Code-style CRUD for the Folders (standard) view.
 *
 * Owns everything the user does TO entries of the folder tree (the renderer,
 * standard_tree_render.js: owns painting them):
 *
 *   - Context menu (rows + empty area): New File / New Folder, Cut / Copy /
 *     Paste, Copy Path / Copy Relative Path, Rename, Delete, Reveal in
 *     Explorer, Open in Integrated Terminal (TCMD `cd`s there), Refresh,
 *     Collapse All, plus the legacy quick-creates (cocotb testbench,
 *     .gitignore) the old empty-area menu offered.
 *   - Inline create/rename inputs with LIVE validation (VS Code behaviour:
 *     duplicate names, invalid/reserved names, Enter commits, Esc cancels,
 *     blur commits-if-valid). Nested create ("a/b/c.txt") works. O ícone à
 *     esquerda acompanha o que está sendo digitado, então dá para ver que
 *     "main.py" vira um Python antes de o arquivo existir.
 *   - Arrastar e soltar: arrastar move, com Ctrl copia, soltar na área vazia
 *     joga na raiz. Tudo termina em paste(), que já resolve conflito de nome,
 *     aba aberta, buffer sujo e pasta arrastada para dentro de si mesma.
 *   - Open-editor awareness: renaming or deleting files that are open in
 *     tabs migrates/closes those tabs; dirty buffers are saved (rename) or
 *     explicitly confirmed as lost (delete) BEFORE touching the disk.
 *   - Paste conflicts: paste-into-same-folder auto-suffixes "name copy.ext";
 *     cross-folder conflicts ask Replace / Keep both / Cancel (move offers
 *     Replace / Cancel, like VS Code).
 *   - Keyboard: F2 rename, Delete (Shift+Delete = permanent), Ctrl+C/X/V,
 *     Ctrl+Z e Ctrl+Shift+Z (ou Ctrl+Y), while the tree has focus.
 *   - Desfazer e refazer criar, renomear, mover, copiar e deletar. A pilha
 *     está em tree_history.js; aqui ficam só os executores, porque quem toca
 *     disco é esta camada. Vale só para a árvore: o Ctrl+Z do editor continua
 *     sendo do Monaco, e as duas pilhas nunca se cruzam porque isto só escuta
 *     com o foco na árvore.
 *
 * Deletar NÃO vai direto para a Lixeira, e é isso que torna o Ctrl+Z possível:
 * `shell.trashItem` não tem volta por API. O que sai da árvore passa pela área
 * de espera de main/ipc/tree_undo.js, e de lá vai para a Lixeira quando sai da
 * pilha, quando o projeto fecha ou quando o aplicativo encerra. Delete
 * permanente (Shift+Delete) continua sem volta, por definição.
 *
 * The routing hook lives in project_tree_actions.handleTreeContextMenu: when
 * the active view is 'standard' it delegates here instead of the verilog
 * picker's menu.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { standardTreeRenderer } from './standard_tree_render.js';
import { treeView } from './tree_view.js';
import { iconUrlForFile, iconUrlForFolder } from './material_icons.js';
import { TreeHistory, Op } from './tree_history.js';
import { ProjectStore } from '../project/project_store.js';
import { switchTerminal } from '../terminal/terminal.js';
import { showCardNotification } from '../ui/notification.js';
import {
    validateEntryName, nextCopyName, normSlash, baseName, parentDir, isUnder,
    resolveDropTarget, isNoOpDrop,
} from './fs_name_utils.js';

// i18n with English fallback (same pattern as file_tree_toggler.js), the
// menu works before locales load and the keys are optional.
const tr = (k, fb, p) => {
    const v = window.t ? window.t(k, p) : null;
    if (v && v !== k) return v;
    // Interpolate {placeholders} into the English fallback too.
    return String(fb).replace(/\{(\w+)\}/g, (m, key) => (p && key in p ? String(p[key]) : m));
};

const VALIDATION_MSGS = {
    empty:        () => tr('fileTree.crud.errEmpty', 'A file or folder name must be provided.'),
    whitespace:   () => tr('fileTree.crud.errWhitespace', 'Leading or trailing whitespace detected in the name.'),
    separators:   () => tr('fileTree.crud.errSeparators', 'The name contains invalid path separators.'),
    invalidChars: () => tr('fileTree.crud.errInvalidChars', 'The name contains characters that are not allowed (< > : " | ? *).'),
    reserved:     () => tr('fileTree.crud.errReserved', 'This name is reserved by the operating system.'),
    dots:         () => tr('fileTree.crud.errDots', '"." and ".." are not valid names.'),
    endsBad:      () => tr('fileTree.crud.errEndsBad', 'Names cannot end with a dot or a space.'),
    exists:       () => tr('fileTree.crud.errExists', 'A file or folder with this name already exists here.'),
};

class StandardTreeCrud {
    constructor() {
        this.selectedPath = null;
        // { path, name, isDir, cut }, single-entry clipboard (multi-select is
        // a future step; documented in TODO.md, secao 5).
        this.clipboard = null;
        this._inlineCleanup = null;

        // Ctrl+Z e Ctrl+Shift+Z da arvore. Os executores ficam aqui porque a
        // pilha nao toca disco: ela so sabe a forma das operacoes.
        this.history = new TreeHistory({
            mover: async (de, para) => {
                const ehPasta = await this._ehPasta(de);
                const abertas = this._affectedTabs(de, ehPasta);
                const res = await electronAPI.renamePath(de, para);
                if (!res?.success) return false;
                await this._migrateOpenTabs(de, para, abertas);
                this._remapExpanded(de, para);
                return true;
            },
            guardar: async (caminho) => {
                // Fechar as abas antes: o arquivo vai sair do lugar.
                for (const t of this._affectedTabs(caminho, await this._ehPasta(caminho))) {
                    TabManager.unsavedChanges?.delete?.(t);
                    await TabManager.closeTab(t);
                }
                const res = await electronAPI.undoStage(caminho);
                return res?.success ? res.token : null;
            },
            restaurar: async (token, caminho) => {
                const res = await electronAPI.undoRestore(token, caminho);
                return !!res?.success;
            },
            descartar: (token) => electronAPI.undoDiscard(token),
        });

        // Desfazer nao atravessa projeto: os caminhos guardados apontariam para
        // fora do que esta aberto. Trocar de projeto devolve a Lixeira o que
        // estava esperando e zera a pilha.
        let projetoAtual = null;
        ProjectStore.subscribe(() => {
            const novo = ProjectStore.getProjectPath();
            if (novo === projetoAtual) return;
            projetoAtual = novo;
            this.history.limpar();
        });

        // Re-apply selection / cut-pending decorations after every re-render
        // (renders rebuild the rows from scratch).
        document.addEventListener('aurora:standard-tree-rendered', () => this._refreshDecorations());

        document.addEventListener('DOMContentLoaded', () => this._wireContainer());
        if (document.readyState !== 'loading') this._wireContainer();
    }

    // ------------------------------------------------------------------ util

    _container() { return treeView.getContainer('standard'); }
    _root() { return window.currentProjectPath || null; }
    _isStandardView() {
        return (window.fileTreeViewController?.getActiveView?.() ?? '') === 'standard';
    }

    /** Native separator of the current project paths ('\\' on Windows). */
    _sep() {
        const r = this._root() || '';
        return r.includes('\\') ? '\\' : '/';
    }

    _join(dir, name) {
        // `name` may be nested ("a/b.txt"), normalize to native separators.
        const sep = this._sep();
        const cleanName = String(name).replace(/[\\/]+/g, sep);
        return dir.replace(/[\\/]+$/, '') + sep + cleanName;
    }

    async _siblingNames(dir) {
        try {
            const list = await electronAPI.getFolderFiles(dir);
            return Array.isArray(list) ? list.map((e) => e.name) : [];
        } catch (_) { return []; }
    }

    /** A linha ainda existe na arvore? Senao, pergunta ao disco. */
    async _ehPasta(caminho) {
        const row = this._rowFor(caminho);
        if (row) return row.dataset.isDir === '1';
        try {
            const st = await electronAPI.getFileStats(caminho);
            return !!(st?.isDirectory ?? st?.isDir);
        } catch (_) { return false; }
    }

    // ------------------------------------------------------ desfazer/refazer

    /**
     * Desfaz a ultima operacao da arvore. So a arvore: o Ctrl+Z do editor
     * continua sendo do Monaco, e as duas pilhas nunca se cruzam porque isto
     * so e chamado com o foco na arvore.
     */
    async desfazer() { await this._passo('desfazer'); }

    async refazer() { await this._passo('refazer'); }

    async _passo(qual) {
        const h = this.history;
        if (qual === 'desfazer' && !h.podeDesfazer()) {
            showCardNotification(tr('fileTree.crud.nothingToUndo', 'Nothing to undo.'), 'info', 1800);
            return;
        }
        if (qual === 'refazer' && !h.podeRefazer()) {
            showCardNotification(tr('fileTree.crud.nothingToRedo', 'Nothing to redo.'), 'info', 1800);
            return;
        }
        const r = qual === 'desfazer' ? await h.desfazer() : await h.refazer();
        if (!r.ok) {
            showCardNotification(
                tr('fileTree.crud.undoFailed', 'Could not undo: {error}', { error: r.erro || 'unknown' }),
                'error', 4000,
            );
            return;
        }
        await standardTreeRenderer.render();
        // O caminho pode ter deixado de existir (desfazer uma criacao), e ai
        // nao ha o que selecionar.
        if (r.foco && await electronAPI.fileExists(r.foco)) this.select(r.foco);
        else { this.selectedPath = null; this._refreshDecorations(); }
    }

    _openTabPaths() {
        try { return Array.from(TabManager.tabs?.keys?.() || []); } catch (_) { return []; }
    }

    /** Open tabs equal to `path` (file) or under it (directory). */
    _affectedTabs(path, isDir) {
        const target = normSlash(path).toLowerCase();
        return this._openTabPaths().filter((p) => {
            const n = normSlash(p).toLowerCase();
            return n === target || (isDir && isUnder(p, path));
        });
    }

    _dialog(opts) {
        const dialog = window.AuroraUI?.dialog;
        if (typeof dialog === 'function') return dialog(opts);
        // Fallback: collapse to a confirm() on the LAST (primary) button.
        const primary = opts.buttons?.[opts.buttons.length - 1];
        return Promise.resolve(window.confirm(`${opts.title}\n\n${opts.message}`)
            ? (primary?.action ?? 'ok') : 'cancel');
    }

    // ------------------------------------------------------- selection state

    select(path) {
        this.selectedPath = path;
        this._refreshDecorations();
    }

    _refreshDecorations() {
        const container = this._container();
        if (!container) return;
        const selected = this.selectedPath ? normSlash(this.selectedPath).toLowerCase() : null;
        const cut = this.clipboard?.cut ? normSlash(this.clipboard.path).toLowerCase() : null;
        container.querySelectorAll('.file-tree-item[data-path]').forEach((w) => {
            const p = normSlash(w.getAttribute('data-path')).toLowerCase();
            const row = w.querySelector(':scope > .file-item');
            if (!row) return;
            row.classList.toggle('selected', p === selected);
            row.classList.toggle('cut-pending', !!cut && (p === cut || (this.clipboard?.isDir && isUnder(p, cut))));
        });
    }

    // ------------------------------------------------------------ wiring

    _wireContainer() {
        const host = document.getElementById('file-tree');
        if (!host || host.__crudWired) return;
        host.__crudWired = true;
        host.tabIndex = -1; // receive keydown after clicks

        host.addEventListener('click', (e) => {
            if (!this._isStandardView()) return;
            const row = e.target.closest('.file-tree-item[data-path]');
            if (row) {
                this.select(row.getAttribute('data-path'));
                // Focus the tree so F2/Delete/Ctrl+C-X-V shortcuts work. Opening
                // a file still wins focus afterwards (activateTab's deferred
                // editor.focus()), so typing is never hijacked.
                host.focus({ preventScroll: true });
            }
        });

        host.addEventListener('keydown', (e) => {
            if (!this._isStandardView()) return;
            if (this._inlineCleanup) return; // inline input owns the keyboard
            const sel = this.selectedPath;
            const ctrl = e.ctrlKey || e.metaKey;
            if (e.key === 'F2' && sel) {
                e.preventDefault(); this.startRename(sel);
            } else if (e.key === 'Delete' && sel) {
                e.preventDefault(); this.deleteEntry(sel, { permanent: e.shiftKey });
            } else if (ctrl && (e.key === 'c' || e.key === 'C') && sel) {
                e.preventDefault(); this.copy(sel, false);
            } else if (ctrl && (e.key === 'x' || e.key === 'X') && sel) {
                e.preventDefault(); this.copy(sel, true);
            } else if (ctrl && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault(); this.paste(this._pasteTargetDir());
            } else if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault(); this.refazer();
            } else if (ctrl && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault(); this.desfazer();
            } else if (ctrl && (e.key === 'y' || e.key === 'Y')) {
                // Ctrl+Y tambem refaz, porque metade do mundo Windows usa isso.
                e.preventDefault(); this.refazer();
            }
        });

        this._wireDragAndDrop(host);
    }

    /**
     * Arrastar e soltar, como no VS Code: arrastar move, arrastar com Ctrl
     * copia, e soltar na área vazia joga na raiz do projeto.
     *
     * Tudo aqui termina em `paste()`, que já sabe o que fazer com conflito de
     * nome, aba aberta, buffer sujo e pasta arrastada para dentro de si mesma.
     * Reimplementar mover seria repetir essas quatro decisões e errar uma.
     */
    _wireDragAndDrop(host) {
        /** Linha sob o cursor no momento, para limpar o realce depois. */
        let realce = null;
        const realcar = (el) => {
            if (realce === el) return;
            realce?.classList.remove('drop-target');
            realce = el;
            realce?.classList.add('drop-target');
        };

        host.addEventListener('dragstart', (e) => {
            if (!this._isStandardView()) return;
            const row = e.target.closest?.('.file-tree-item[data-path]');
            if (!row) return;
            const entry = this._entryFromRow(row);
            // Marcador próprio: sem ele, qualquer arrasto de fora (uma imagem
            // do navegador, texto selecionado) cairia como se fosse da árvore.
            e.dataTransfer.setData('application/x-aurora-tree-path', entry.path);
            e.dataTransfer.effectAllowed = 'copyMove';
            this.select(entry.path);
        });

        host.addEventListener('dragover', (e) => {
            if (!this._isStandardView()) return;
            if (!e.dataTransfer.types.includes('application/x-aurora-tree-path')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? 'copy' : 'move';
            // Soltar sobre um arquivo significa soltar na pasta dele, que é o
            // que o usuário quer dizer ao mirar num item qualquer da pasta.
            const row = e.target.closest?.('.file-tree-item[data-path]');
            realcar(row?.dataset.isDir === '1' ? row : null);
        });

        host.addEventListener('dragleave', (e) => {
            if (!host.contains(e.relatedTarget)) realcar(null);
        });

        host.addEventListener('drop', async (e) => {
            if (!this._isStandardView()) return;
            const origem = e.dataTransfer.getData('application/x-aurora-tree-path');
            realcar(null);
            if (!origem) return;
            e.preventDefault();

            const row = e.target.closest?.('.file-tree-item[data-path]');
            const alvo = resolveDropTarget(
                row ? { path: row.getAttribute('data-path'), isDir: row.dataset.isDir === '1' } : null,
                this._root(),
            );
            if (!alvo) return;
            await this.dropOnto(origem, alvo, { copy: e.ctrlKey || e.metaKey });
        });

        host.addEventListener('dragend', () => realcar(null));
    }

    /**
     * Move (ou copia) `origem` para dentro de `alvo`, reaproveitando `paste`.
     *
     * O clipboard do usuário é preservado: arrastar um arquivo não pode comer
     * um Ctrl+X que estava pendente.
     */
    async dropOnto(origem, alvo, { copy = false } = {}) {
        const row = this._rowFor(origem);
        const ehPasta = row ? row.dataset.isDir === '1' : false;
        if (isNoOpDrop(origem, alvo, ehPasta)) return;

        const anterior = this.clipboard;
        this.clipboard = {
            path: origem,
            name: baseName(origem),
            isDir: ehPasta,
            cut: !copy,
        };
        try {
            await this.paste(alvo);
        } finally {
            this.clipboard = anterior;
            this._refreshDecorations();
        }
    }

    _entryFromRow(row) {
        const path = row.getAttribute('data-path');
        return {
            path,
            isDir: row.dataset.isDir === '1',
            name: baseName(path),
        };
    }

    _rowFor(path) {
        const container = this._container();
        if (!container || !path) return null;
        return container.querySelector(`.file-tree-item[data-path="${CSS.escape(path)}"]`);
    }

    _pasteTargetDir() {
        const root = this._root();
        if (!this.selectedPath) return root;
        const row = this._rowFor(this.selectedPath);
        if (!row) return root;
        const entry = this._entryFromRow(row);
        return entry.isDir ? entry.path : parentDir(entry.path);
    }

    // -------------------------------------------------------- context menu

    /** Entry point, routed from project_tree_actions.handleTreeContextMenu. */
    showMenu(event) {
        const root = this._root();
        if (!root) return;
        this._closeMenu();

        const row = event.target.closest('.file-tree-item[data-path]');
        const entry = row ? this._entryFromRow(row) : null;
        if (entry) this.select(entry.path);

        const items = entry ? this._rowMenuItems(entry) : this._emptyAreaMenuItems(root);
        this._renderMenu(items, event.pageX, event.pageY);
    }

    _rowMenuItems(entry) {
        const items = [];
        const dirForNew = entry.isDir ? entry.path : null;
        if (dirForNew) {
            items.push(
                { icon: 'ph-file-plus', label: tr('fileTree.crud.newFile', 'New File...'), run: () => this.startCreate(dirForNew, 'file') },
                { icon: 'ph-folder-plus', label: tr('fileTree.crud.newFolder', 'New Folder...'), run: () => this.startCreate(dirForNew, 'folder') },
                'divider',
            );
        }
        items.push(
            { icon: 'ph-scissors', label: tr('fileTree.crud.cut', 'Cut'), run: () => this.copy(entry.path, true) },
            { icon: 'ph-copy', label: tr('fileTree.crud.copy', 'Copy'), run: () => this.copy(entry.path, false) },
            {
                icon: 'ph-clipboard-text', label: tr('fileTree.crud.paste', 'Paste'),
                disabled: !this.clipboard,
                run: () => this.paste(entry.isDir ? entry.path : parentDir(entry.path)),
            },
            'divider',
            { icon: 'ph-link', label: tr('fileTree.crud.copyPath', 'Copy Path'), run: () => this._copyText(entry.path) },
            { icon: 'ph-link-simple', label: tr('fileTree.crud.copyRelPath', 'Copy Relative Path'), run: () => this._copyRelPath(entry.path) },
            'divider',
            { icon: 'ph-pencil-simple', label: tr('fileTree.crud.rename', 'Rename...'), run: () => this.startRename(entry.path) },
            {
                icon: 'ph-trash', label: tr('fileTree.crud.delete', 'Delete'), danger: true,
                run: () => this.deleteEntry(entry.path),
            },
            'divider',
            {
                icon: 'ph-terminal-window', label: tr('fileTree.crud.openTerminal', 'Open in Integrated Terminal'),
                run: () => this.openTerminalHere(entry.isDir ? entry.path : parentDir(entry.path)),
            },
            {
                icon: 'ph-folder-notch-open', label: tr('fileTree.crud.reveal', 'Reveal in File Explorer'),
                run: () => electronAPI.openFolder?.(entry.isDir ? entry.path : parentDir(entry.path)),
            },
        );
        return items;
    }

    _emptyAreaMenuItems(root) {
        return [
            { icon: 'ph-file-plus', label: tr('fileTree.crud.newFile', 'New File...'), run: () => this.startCreate(root, 'file') },
            { icon: 'ph-folder-plus', label: tr('fileTree.crud.newFolder', 'New Folder...'), run: () => this.startCreate(root, 'folder') },
            // Legacy quick-creates kept from the old empty-area menu.
            { icon: 'ph-file-py', label: tr('contextMenu.newCocotb', 'New cocotb Testbench (.py)'), run: () => window.projectTreeManager?.createNewCocotbFile?.() },
            { icon: 'ph-git-branch', label: tr('contextMenu.newGitignore', 'New .gitignore'), run: () => window.projectTreeManager?.createGitignore?.() },
            'divider',
            {
                icon: 'ph-clipboard-text', label: tr('fileTree.crud.paste', 'Paste'),
                disabled: !this.clipboard, run: () => this.paste(root),
            },
            'divider',
            { icon: 'ph-terminal-window', label: tr('fileTree.crud.openTerminal', 'Open in Integrated Terminal'), run: () => this.openTerminalHere(root) },
            { icon: 'ph-folder-notch-open', label: tr('fileTree.crud.reveal', 'Reveal in File Explorer'), run: () => electronAPI.openFolder?.(root) },
            'divider',
            { icon: 'ph-arrows-clockwise', label: tr('fileTree.crud.refresh', 'Refresh'), run: () => standardTreeRenderer.render() },
            { icon: 'ph-minus-square', label: tr('fileTree.crud.collapseAll', 'Collapse All'), run: () => standardTreeRenderer.collapseAll() },
        ];
    }

    _renderMenu(items, x, y) {
        const menu = document.createElement('div');
        menu.className = 'verilog-context-menu';
        menu.id = 'standard-tree-context-menu';

        for (const it of items) {
            if (it === 'divider') {
                const d = document.createElement('div');
                d.className = 'context-menu-divider';
                menu.appendChild(d);
                continue;
            }
            const el = document.createElement('div');
            el.className = 'context-menu-item'
                + (it.danger ? ' delete-item' : '')
                + (it.disabled ? ' disabled' : '');
            el.innerHTML = `<i class="ph ${it.icon}"></i><span></span>`;
            el.querySelector('span').textContent = it.label;
            if (!it.disabled) {
                el.addEventListener('click', () => {
                    this._closeMenu();
                    Promise.resolve(it.run()).catch((err) => {
                        console.error('tree action failed:', err);
                        showCardNotification(String(err?.message || err), 'error', 4000);
                    });
                });
            }
            menu.appendChild(el);
        }

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        document.body.appendChild(menu);
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
            if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
            menu.classList.add('show');
        });

        this._menuDismiss = (e) => {
            if (e.type === 'keydown' && e.key !== 'Escape') return;
            if (e.type === 'click' && e.target.closest('#standard-tree-context-menu')) return;
            this._closeMenu();
        };
        setTimeout(() => {
            document.addEventListener('click', this._menuDismiss);
            document.addEventListener('contextmenu', this._menuDismiss);
            document.addEventListener('keydown', this._menuDismiss);
        }, 0);
    }

    _closeMenu() {
        const menu = document.getElementById('standard-tree-context-menu');
        if (menu) {
            menu.classList.remove('show');
            setTimeout(() => menu.remove(), 150);
        }
        if (this._menuDismiss) {
            document.removeEventListener('click', this._menuDismiss);
            document.removeEventListener('contextmenu', this._menuDismiss);
            document.removeEventListener('keydown', this._menuDismiss);
            this._menuDismiss = null;
        }
    }

    // ------------------------------------------------- open terminal / paths

    openTerminalHere(dirPath) {
        if (!dirPath) return;
        switchTerminal('terminal-tcmd');
        window.shellTerminal?.openAt?.(dirPath);
    }

    async _copyText(text) {
        try { await navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    }

    _copyRelPath(path) {
        const root = this._root() || '';
        let rel = path;
        if (normSlash(path).toLowerCase().startsWith(normSlash(root).toLowerCase() + '/')) {
            rel = path.slice(root.length + 1);
        }
        return this._copyText(rel);
    }

    // ---------------------------------------------------------- inline input

    _cancelInline() {
        if (this._inlineCleanup) { this._inlineCleanup(); this._inlineCleanup = null; }
    }

    /**
     * Shared inline-input builder. Mounts `inputWrap` (a .file-item lookalike
     * with an <input> and a validation bubble), wires validation + commit /
     * cancel semantics and returns the input element.
     */
    _mountInline({ mountEl, before, depth, kind, initial, selectRange, validate, commit, onClose }) {
        this._cancelInline();

        const wrapper = document.createElement('div');
        wrapper.className = 'file-tree-item tree-inline-edit';
        wrapper.style.setProperty('--depth', String(depth));
        wrapper.innerHTML = `
            <div class="file-item">
                <div class="file-item-row">
                    <span class="folder-toggle-spacer"></span>
                    <span class="file-item-icon"></span>
                    <input class="tree-inline-input" type="text" spellcheck="false" />
                </div>
            </div>
            <div class="tree-inline-error hidden"></div>
        `;
        const input = wrapper.querySelector('input');
        const errorBox = wrapper.querySelector('.tree-inline-error');
        const iconEl = wrapper.querySelector('.file-item-icon');

        // O icone acompanha o que esta sendo digitado, em vez de esperar o
        // arquivo existir. Assim da para ver, ainda durante a digitacao, que
        // "main.py" vai virar um Python e "main.v" um Verilog, e um erro de
        // extensao aparece antes de criar o arquivo e nao depois.
        const pintarIcone = () => {
            const nome = baseName(input.value.trim()) || (kind === 'folder' ? 'nova-pasta' : 'novo-arquivo');
            iconEl.style.backgroundImage = '';
            iconEl.classList.remove('aurora-icon-cmm');
            if (kind === 'folder') {
                iconEl.style.backgroundImage = `url("${iconUrlForFolder(nome)}")`;
                return;
            }
            // .cmm nao tem equivalente no tema Material e mantem o glifo
            // proprio da AURORA, como nas abas e no resto da arvore.
            if (nome.toLowerCase().endsWith('.cmm')) {
                iconEl.classList.add('aurora-icon-cmm');
                return;
            }
            iconEl.style.backgroundImage = `url("${iconUrlForFile(nome)}")`;
        };
        pintarIcone();

        if (before) mountEl.insertBefore(wrapper, before);
        else mountEl.prepend(wrapper);

        input.value = initial || '';

        let done = false;
        const cleanup = () => {
            if (done) return;
            done = true;
            wrapper.remove();
            this._inlineCleanup = null;
            onClose?.();
        };
        this._inlineCleanup = cleanup;

        const showError = (msg) => {
            errorBox.textContent = msg || '';
            errorBox.classList.toggle('hidden', !msg);
            input.classList.toggle('invalid', !!msg);
        };

        const currentError = () => {
            const res = validate(input.value);
            return res.ok ? null : VALIDATION_MSGS[res.error]?.() || res.error;
        };

        input.addEventListener('input', () => { showError(currentError()); pintarIcone(); });

        const tryCommit = async () => {
            const err = currentError();
            if (err) { showError(err); return; }
            const value = input.value;
            cleanup();
            await commit(value);
        };

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
        });
        // VS Code semantics: blur commits when valid, cancels otherwise.
        input.addEventListener('blur', () => {
            if (done) return;
            if (!input.value.trim() || currentError()) cleanup();
            else tryCommit();
        });

        wrapper.scrollIntoView({ block: 'nearest' });
        input.focus();
        if (selectRange) input.setSelectionRange(selectRange[0], selectRange[1]);
        else input.select();
        return input;
    }

    /** Inline "New File" / "New Folder" at the top of `dir`. */
    async startCreate(dir, kind) {
        const container = this._container();
        if (!container || !dir) return;

        // Make sure the target folder is expanded and rendered so the input
        // has a child box to live in (root mounts at the container top).
        const root = this._root();
        const isRoot = normSlash(dir).toLowerCase() === normSlash(root || '').toLowerCase();
        let mountEl = container;
        let depth = 0;
        if (!isRoot) {
            if (!standardTreeRenderer.isExpanded(dir)) {
                standardTreeRenderer._expanded.add(dir);
                await standardTreeRenderer.render();
            }
            const row = this._rowFor(dir);
            const childBox = row?.querySelector(':scope > .folder-content');
            if (!childBox) return;
            mountEl = childBox;
            depth = (parseInt(row.style.getPropertyValue('--depth'), 10) || 0) + 1;
        }

        const siblings = await this._siblingNames(dir);

        this._mountInline({
            mountEl,
            before: mountEl.firstChild,
            depth,
            kind,
            initial: '',
            validate: (v) => validateEntryName(v, { siblings, allowSeparators: true }),
            commit: async (name) => {
                const target = this._join(dir, name);
                if (await electronAPI.fileExists(target)) {
                    showCardNotification(VALIDATION_MSGS.exists(), 'warning', 3000);
                    return;
                }
                try {
                    if (kind === 'folder') await electronAPI.createDirectory(target);
                    else await electronAPI.writeFile(target, '');
                    // Expand every intermediate folder of a nested create.
                    let cursor = dir;
                    const segs = normSlash(name).split('/');
                    for (let i = 0; i < segs.length - 1; i++) {
                        cursor = this._join(cursor, segs[i]);
                        standardTreeRenderer._expanded.add(cursor);
                    }
                    if (kind === 'folder') standardTreeRenderer._expanded.add(target);
                    this.history.registrar(Op.criado(target));
                    await standardTreeRenderer.render();
                    this.select(target);
                    if (kind === 'file') TabManager.addTab(target, '');
                    // Avisa quem classifica arquivo por extensao. Sem isto, um
                    // .v criado aqui so aparecia na visao Verilog depois de um
                    // refresh forte: aquela visao so escutava `file-saved`, e
                    // criar nao e salvar.
                    try {
                        window.dispatchEvent(new CustomEvent('aurora:file-created',
                            { detail: { path: target, kind } }));
                    } catch (_) { /* melhor esforco */ }
                    showCardNotification(
                        tr('notification.tree.created', 'Created "{name}"', { name: baseName(target) }),
                        'success', 2000,
                    );
                } catch (err) {
                    showCardNotification(
                        tr('fileTree.crud.errCreate', 'Could not create: {error}', { error: err?.message || err }),
                        'error', 4000,
                    );
                }
            },
        });
    }

    /** Inline rename on the entry's own row (F2 / context menu). */
    async startRename(path) {
        const row = this._rowFor(path);
        if (!row) return;
        const entry = this._entryFromRow(row);
        const dir = parentDir(path);
        const siblings = await this._siblingNames(dir);

        // Swap the row out for the inline editor at the same depth.
        const depth = parseInt(row.style.getPropertyValue('--depth'), 10) || 0;
        row.classList.add('hidden-during-rename');

        const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.');
        const selectRange = dot > 0 ? [0, dot] : [0, entry.name.length];

        this._mountInline({
            mountEl: row.parentNode,
            before: row,
            depth,
            kind: entry.isDir ? 'folder' : 'file',
            initial: entry.name,
            selectRange,
            validate: (v) => validateEntryName(v, {
                siblings, allowSeparators: false, originalName: entry.name,
            }),
            onClose: () => row.classList.remove('hidden-during-rename'),
            commit: async (newName) => {
                if (newName === entry.name) return;
                await this._performRename(entry, this._join(dir, newName));
            },
        });
    }

    async _performRename(entry, newPath) {
        const affected = this._affectedTabs(entry.path, entry.isDir);
        const dirty = affected.filter((p) => TabManager.unsavedChanges?.has?.(p));

        if (dirty.length > 0) {
            const action = await this._dialog({
                title: tr('fileTree.crud.renameTitle', 'Rename'),
                message: tr('fileTree.crud.renameDirty',
                    '{count} open file(s) have unsaved changes. They will be saved before renaming.',
                    { count: dirty.length }),
                variant: 'warning',
                buttons: [
                    { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
                    { label: tr('fileTree.crud.saveAndRename', 'Save and Rename'), action: 'go', type: 'primary' },
                ],
            });
            if (action !== 'go') return;
            for (const p of dirty) {
                const ok = await TabManager.saveFile(p);
                if (ok === false) return;
            }
        }

        let res = await electronAPI.renamePath(entry.path, newPath);
        if (!res?.success && res?.code === 'EEXIST') {
            const action = await this._dialog({
                title: tr('fileTree.crud.renameTitle', 'Rename'),
                message: tr('fileTree.crud.conflictReplace',
                    '"{name}" already exists at this location. Replace it?',
                    { name: baseName(newPath) }),
                variant: 'warning',
                buttons: [
                    { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
                    { label: tr('fileTree.crud.replace', 'Replace'), action: 'replace', type: 'danger' },
                ],
            });
            if (action !== 'replace') return;
            res = await electronAPI.renamePath(entry.path, newPath, { overwrite: true });
        }
        if (!res?.success) {
            showCardNotification(
                tr('fileTree.crud.errRename', 'Could not rename: {error}', { error: res?.error || 'unknown' }),
                'error', 4000,
            );
            return;
        }

        await this._migrateOpenTabs(entry.path, newPath, affected);
        this._remapExpanded(entry.path, newPath);
        this.history.registrar(Op.move(entry.path, newPath));
        if (this.clipboard && normSlash(this.clipboard.path).toLowerCase() === normSlash(entry.path).toLowerCase()) {
            this.clipboard = null; // stale — the source moved
        }
        await standardTreeRenderer.render();
        this.select(newPath);
    }

    /** Close-and-reopen every affected tab at its new path (saved first by callers). */
    async _migrateOpenTabs(oldBase, newBase, affected) {
        if (!affected.length) return;
        const activeBefore = TabManager.activeTab;
        let newActive = null;
        for (const p of affected) {
            const newP = newBase + p.slice(oldBase.length);
            // Buffers were saved before the rename, skip the unsaved prompt.
            TabManager.unsavedChanges?.delete?.(p);
            await TabManager.closeTab(p);
            try {
                const content = await electronAPI.readFile(newP);
                TabManager.addTab(newP, content);
                if (activeBefore === p) newActive = newP;
            } catch (err) {
                console.error('tab migration failed for', newP, err);
            }
        }
        if (newActive) TabManager.activateTab(newActive);
    }

    _remapExpanded(oldBase, newBase) {
        const expanded = standardTreeRenderer._expanded;
        const oldNorm = normSlash(oldBase).toLowerCase();
        for (const p of Array.from(expanded)) {
            const n = normSlash(p).toLowerCase();
            if (n === oldNorm || isUnder(p, oldBase)) {
                expanded.delete(p);
                expanded.add(newBase + p.slice(oldBase.length));
            }
        }
    }

    // --------------------------------------------------------------- delete

    async deleteEntry(path, { permanent = false } = {}) {
        const row = this._rowFor(path);
        const entry = row ? this._entryFromRow(row) : { path, isDir: false, name: baseName(path) };
        const affected = this._affectedTabs(entry.path, entry.isDir);
        const dirtyCount = affected.filter((p) => TabManager.unsavedChanges?.has?.(p)).length;

        let message = entry.isDir
            ? tr('fileTree.crud.deleteFolderMsg', 'Delete "{name}" and all its contents?', { name: entry.name })
            : tr('fileTree.crud.deleteFileMsg', 'Delete "{name}"?', { name: entry.name });
        if (affected.length) {
            message += '\n' + tr('fileTree.crud.deleteOpenTabs',
                '{count} open editor(s) will be closed.', { count: affected.length });
        }
        if (dirtyCount) {
            message += '\n' + tr('fileTree.crud.deleteDirty',
                'Unsaved changes in {count} file(s) will be LOST.', { count: dirtyCount });
        }
        if (!permanent) {
            message += '\n' + tr('fileTree.crud.trashNote',
                'Ctrl+Z undoes this. Afterwards it goes to the Recycle Bin.');
        }

        const action = await this._dialog({
            title: permanent
                ? tr('fileTree.crud.deletePermTitle', 'Delete Permanently')
                : tr('fileTree.crud.deleteTitle', 'Delete'),
            message,
            variant: 'warning',
            buttons: [
                { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
                {
                    label: permanent
                        ? tr('fileTree.crud.deletePerm', 'Delete Permanently')
                        : tr('fileTree.crud.moveToTrash', 'Move to Recycle Bin'),
                    action: 'delete', type: 'danger',
                },
            ],
        });
        if (action !== 'delete') return;

        // Close affected editors WITHOUT the per-tab unsaved prompt, the user
        // just confirmed the data loss above.
        for (const p of affected) {
            TabManager.unsavedChanges?.delete?.(p);
            await TabManager.closeTab(p);
        }

        let ok = false;
        if (permanent) {
            try { await electronAPI.deleteFileOrDirectory(entry.path); ok = true; }
            catch (err) {
                showCardNotification(
                    tr('fileTree.crud.errDelete', 'Could not delete: {error}', { error: err?.message || err }),
                    'error', 4000,
                );
            }
        } else {
            // Nao vai direto para a Lixeira: passa pela area de espera, de onde
            // o Ctrl+Z consegue trazer de volta. De la vai para a Lixeira quando
            // sai da pilha, quando o projeto fecha ou quando o app encerra.
            const res = await electronAPI.undoStage(entry.path);
            if (res?.success) {
                ok = true;
                this.history.registrar(Op.removido(entry.path, res.token));
            } else {
                // Trash unavailable (e.g. network drive), offer permanent.
                const retry = await this._dialog({
                    title: tr('fileTree.crud.deleteTitle', 'Delete'),
                    message: tr('fileTree.crud.trashFailed',
                        'Could not stage the deletion ({error}). Delete permanently instead?',
                        { error: res?.error || 'unknown' }),
                    variant: 'warning',
                    buttons: [
                        { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
                        { label: tr('fileTree.crud.deletePerm', 'Delete Permanently'), action: 'perm', type: 'danger' },
                    ],
                });
                if (retry === 'perm') {
                    try { await electronAPI.deleteFileOrDirectory(entry.path); ok = true; }
                    catch (err) {
                        showCardNotification(
                            tr('fileTree.crud.errDelete', 'Could not delete: {error}', { error: err?.message || err }),
                            'error', 4000,
                        );
                    }
                }
            }
        }
        if (!ok) return;

        // Housekeeping: expansion state, selection, clipboard.
        const expanded = standardTreeRenderer._expanded;
        for (const p of Array.from(expanded)) {
            if (normSlash(p).toLowerCase() === normSlash(entry.path).toLowerCase() || isUnder(p, entry.path)) {
                expanded.delete(p);
            }
        }
        if (this.selectedPath === entry.path) this.selectedPath = null;
        if (this.clipboard && normSlash(this.clipboard.path).toLowerCase() === normSlash(entry.path).toLowerCase()) {
            this.clipboard = null;
        }
        await standardTreeRenderer.render();
        showCardNotification(
            tr('notification.tree.deleted', 'Deleted "{name}"', { name: entry.name }),
            'success', 2000,
        );
    }

    // ----------------------------------------------------------- cut / paste

    copy(path, cut) {
        const row = this._rowFor(path);
        const entry = row ? this._entryFromRow(row) : { path, isDir: false, name: baseName(path) };
        this.clipboard = { path: entry.path, name: entry.name, isDir: entry.isDir, cut: !!cut };
        this._refreshDecorations();
    }

    async paste(targetDir) {
        const clip = this.clipboard;
        const root = this._root();
        if (!clip || !targetDir || !root) return;

        if (!(await electronAPI.fileExists(clip.path))) {
            this.clipboard = null;
            this._refreshDecorations();
            showCardNotification(tr('fileTree.crud.srcGone', 'The copied item no longer exists.'), 'warning', 3000);
            return;
        }
        // A folder cannot be pasted into itself or its own subtree.
        if (clip.isDir && (normSlash(targetDir).toLowerCase() === normSlash(clip.path).toLowerCase()
            || isUnder(targetDir, clip.path))) {
            showCardNotification(
                tr('fileTree.crud.intoItself', 'Cannot paste a folder into itself.'), 'warning', 3000,
            );
            return;
        }

        const siblings = await this._siblingNames(targetDir);
        const conflict = siblings.some((s) => s.toLowerCase() === clip.name.toLowerCase());
        const sameDir = normSlash(parentDir(clip.path)).toLowerCase() === normSlash(targetDir).toLowerCase();

        let destName = clip.name;
        let overwrite = false;

        if (conflict) {
            if (!clip.cut && sameDir) {
                // VS Code: paste-in-place duplicates with the "copy" suffix.
                destName = nextCopyName(clip.name, siblings);
            } else if (clip.cut && sameDir) {
                return; // moving onto itself — no-op
            } else {
                const buttons = [
                    { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
                ];
                if (!clip.cut) {
                    buttons.push({ label: tr('fileTree.crud.keepBoth', 'Keep Both'), action: 'keep', type: 'primary' });
                }
                buttons.push({ label: tr('fileTree.crud.replace', 'Replace'), action: 'replace', type: 'danger' });
                const action = await this._dialog({
                    title: tr('fileTree.crud.pasteTitle', 'Paste'),
                    message: tr('fileTree.crud.conflictPaste',
                        '"{name}" already exists in the destination folder.', { name: clip.name }),
                    variant: 'warning',
                    buttons,
                });
                if (action === 'keep') destName = nextCopyName(clip.name, siblings);
                else if (action === 'replace') overwrite = true;
                else return;
            }
        }

        const dest = this._join(targetDir, destName);
        if (clip.cut) {
            const affected = this._affectedTabs(clip.path, clip.isDir);
            const dirty = affected.filter((p) => TabManager.unsavedChanges?.has?.(p));
            for (const p of dirty) {
                const ok = await TabManager.saveFile(p);
                if (ok === false) return;
            }
            const res = await electronAPI.renamePath(clip.path, dest, { overwrite });
            if (!res?.success) {
                showCardNotification(
                    tr('fileTree.crud.errMove', 'Could not move: {error}', { error: res?.error || 'unknown' }),
                    'error', 4000,
                );
                return;
            }
            await this._migrateOpenTabs(clip.path, dest, affected);
            this._remapExpanded(clip.path, dest);
            this.history.registrar(Op.move(clip.path, dest));
            this.clipboard = null;
        } else {
            const res = await electronAPI.copyAnyPath(clip.path, dest, { overwrite });
            if (!res?.success) {
                showCardNotification(
                    tr('fileTree.crud.errCopy', 'Could not copy: {error}', { error: res?.error || 'unknown' }),
                    'error', 4000,
                );
                return;
            }
            // Sobrescrevendo nao da para desfazer: o que estava ali ja se foi.
            if (!overwrite) this.history.registrar(Op.criado(dest));
        }

        if (clip.isDir) standardTreeRenderer._expanded.add(dest);
        await standardTreeRenderer.render();
        this.select(dest);
        this._refreshDecorations();
    }
}

const standardTreeCrud = new StandardTreeCrud();

if (typeof window !== 'undefined') {
    window.standardTreeCrud = standardTreeCrud;
}

export { standardTreeCrud, StandardTreeCrud };
