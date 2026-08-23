/**
 * standard_tree_render.js: the 'standard' file-tree view: a plain
 * folder/file hierarchy rooted at the project (.spf) directory.
 *
 * This is the third view in the toggle cycle (verilog flat files →
 * toplevel module hierarchy → folder tree). Unlike the verilog view
 * (processor-grouped) and the hierarchy view (Yosys module instances),
 * this one mirrors the actual on-disk folder structure under
 * `window.currentProjectPath`, the way a generic file explorer would.
 *
 * Reads are LAZY: only the project root is listed up front; a folder's
 * children are fetched (electronAPI.getFolderFiles) the first time it's
 * expanded, then kept in the DOM so re-expanding is instant. Expanded
 * paths are remembered in a Set so a full re-render (refresh / view
 * re-entry) restores the open folders.
 *
 * Single file-open path, readFile → focused split pane or TabManager
 * preview, double-click promotes to a permanent tab, identical to the
 * verilog view (file_mode.openTreeFile). There is intentionally no
 * second handler here; the duplicate-handler bug that got the old
 * standard view deleted in 2026-05 does not come back.
 */

import { electronAPI } from '../app/electron_api.js';
import { treeView } from './tree_view.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ensureManifest, iconUrlForFile, iconUrlForFolder } from './material_icons.js';
import { parseInv, isInvHidden } from './inv_filter.js';
// CRUD layer (context menu, inline create/rename, cut/copy/paste, delete).
// Imported for its side effect: registers the singleton + window hook that
// project_tree_actions routes right-clicks to when this view is active.
import './standard_tree_crud.js';

// Files that never belong in the explorer: legacy config blobs, the
// .spf project file itself, and dotfiles. Mirrors the old standard
// tree's filter so behaviour is unchanged for existing projects.
const IGNORED_FILES = ['projectOriented.json', 'processorConfig.json', 'fileOriented.json'];

function isIgnored(entry) {
    if (entry.isDirectory) return false;
    const name = entry.name || '';
    return name.startsWith('.')
        || IGNORED_FILES.includes(name)
        || name.endsWith('.spf');
}

// .cmm has no Material icon, it keeps Aurora's custom masked glyph
// (.aurora-icon-cmm, currentColor) used across the tabs and verilog tree.
function isCmm(name) {
    return String(name || '').toLowerCase().endsWith('.cmm');
}

// Path of `p` relative to project root `root` (forward-slashed, root-relative,
// no leading slash). '' when p IS the root; full path if p is outside root.
function relTo(root, p) {
    const norm = (x) => String(x || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const r = norm(root);
    const f = norm(p);
    const rl = r.toLowerCase();
    const fl = f.toLowerCase();
    if (fl === rl) return '';
    if (fl.startsWith(rl + '/')) return f.slice(r.length + 1);
    return f;
}

// Directories first, then alphabetical, case-insensitive, the way a
// file explorer sorts.
function sortEntries(entries) {
    return entries.slice().sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

class StandardTreeRenderer {
    constructor() {
        // Paths the user has expanded, survives re-render so the tree
        // doesn't collapse on refresh / view switch.
        this._expanded = new Set();
        // Guard against overlapping renders racing on the same container.
        this._rendering = false;
        /** Chegou pedido durante o render? Uma passada extra ao terminar. */
        this._sujo = false;
        // Compiled `.inv` rules for the current project (loaded per full render).
        // Entries matching these are dropped from the view (still git-tracked).
        this._invRules = [];
        // Keep the open-in-editor file highlighted in the folder tree too
        // (parity with the verilog tree), updating as the active file changes.
        // The event is dispatched on `document` (and doesn't bubble to window),
        // so we MUST listen on document, listening on window silently never
        // fired, which is why the folder tree never showed the open file.
        document.addEventListener('aurora:editing-file-changed', () => this.refreshFocusHighlight());

        // `.inv` lives outside the chokidar dir-watch (dotfiles are ignored),
        // so editing it in the editor wouldn't otherwise refresh the tree.
        // Re-render when an `.inv` is saved (dispatched on both window/document).
        const onSaved = (e) => {
            const p = e?.detail?.path || '';
            if (/\.inv$/i.test(p)) this.render();
        };
        window.addEventListener('aurora:file-saved', onSaved);
        document.addEventListener('aurora:file-saved', onSaved);
    }

    isExpanded(path) { return this._expanded.has(path); }

    /**
     * Mark the row of the file currently focused in Monaco with `.editor-focused`
     * so the folder tree shows which file is open (same affordance as the
     * verilog tree). Re-scans the rendered rows; cheap and idempotent.
     */
    refreshFocusHighlight() {
        const container = treeView.getContainer('standard');
        if (!container) return;
        const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
        const target = norm(window.TabManager?.getEditingFilePath?.() || '');
        container.querySelectorAll('.file-tree-item[data-path]').forEach((w) => {
            const match = !!target && norm(w.getAttribute('data-path')) === target;
            const row = w.querySelector(':scope > .file-item');
            if (row) row.classList.toggle('editor-focused', match);
        });
    }
    hasExpanded() { return this._expanded.size > 0; }

    /**
     * Collapse every folder. Clears the expanded set and flips the DOM
     * (chevrons, folder icons, child boxes) without re-reading the disk:
     * the already-rendered children stay in the DOM, just hidden.
     */
    collapseAll() {
        this._expanded.clear();
        const container = treeView.getContainer('standard');
        if (!container) return;
        container.querySelectorAll('.folder-content').forEach((fc) => fc.classList.add('hidden'));
        container.querySelectorAll('.folder-toggle-icon').forEach((t) => t.classList.add('collapsed'));
        container.querySelectorAll('.file-item-icon[data-folder]').forEach((i) => {
            this._setFolderIcon(i, i.dataset.folder, false);
        });
    }

    /**
     * Expand every folder under the root. Walks the tree reading each
     * directory (lazy reads mean nested folders aren't in memory yet),
     * marks them all expanded, then re-renders fully open.
     */
    async expandAll() {
        const root = window.currentProjectPath;
        if (!root) return;
        await this._collectAllFolders(root, this._expanded);
        await this.render();
    }

    async _collectAllFolders(dirPath, acc) {
        const entries = await this._read(dirPath);
        for (const entry of entries) {
            if (entry.isDirectory) {
                acc.add(entry.path);
                await this._collectAllFolders(entry.path, acc);
            }
        }
    }

    /**
     * Full (re)render of the standard view from the project root. Safe
     * to call repeatedly; restores previously-expanded folders. Returns
     * the in-flight promise when a render is already running, so callers
     * (e.g. revealFolder) can await actual completion instead of racing.
     */
    /**
     * Redesenha a arvore, coalescendo pedidos.
     *
     * O guarda antigo devolvia o render EM VOO e ia embora, o que tem dois
     * problemas. A mudanca que chegou durante o render era perdida, entao a
     * arvore podia terminar desatualizada ate o proximo evento. E, fora da
     * sobreposicao, pedidos em sequencia faziam cada um a reconstrucao
     * completa: uma compilacao que escreve dezenas de arquivos vira uma rajada
     * de renders, cada um limpando e remontando todas as linhas.
     *
     * Agora um pedido que chega durante o render marca a arvore como suja, e ao
     * terminar ela roda MAIS UMA vez, uma so, por mais pedidos que tenham
     * chegado. Nada se perde e nada se repete a toa.
     */
    render() {
        if (this._rendering) {
            this._sujo = true;
            return this._renderPromise;
        }
        this._renderPromise = this._doRender();
        return this._renderPromise;
    }

    /**
     * O elemento que de fato rola. Hoje é `.file-tree-actions`, mas procurar
     * pelo `overflow-y` em vez de fixar a classe faz isto sobreviver a uma
     * mudança de CSS em vez de virar um no-op silencioso.
     */
    _scroller(container) {
        for (let el = container; el && el !== document.body; el = el.parentElement) {
            const y = getComputedStyle(el).overflowY;
            if (y === 'auto' || y === 'scroll') return el;
        }
        return null;
    }

    async _doRender() {
        const container = treeView.getContainer('standard');
        if (!container) return;

        const root = window.currentProjectPath;
        if (!root) {
            container.innerHTML = '';
            return;
        }

        this._rendering = true;
        try {
            // Material icon manifest (cached after first load) + this project's
            // `.inv` rules must be ready before we build any rows.
            await ensureManifest();
            await this._loadInvRules(root);
            const entries = await this._read(root);
            // Drop expanded paths that no longer exist under the root so
            // the Set doesn't grow unbounded across project switches.
            this._pruneExpanded(root);
            // Cada desenho reconstrói as linhas do zero, e com elas a altura
            // rolável: sem guardar a posição, renomear um arquivo no fim de
            // uma árvore grande jogava o usuário de volta ao topo, longe do
            // que ele estava fazendo. Guardar antes de esvaziar, porque o
            // container vazio tem rolagem zero.
            const scroller = this._scroller(container);
            const scrollTop = scroller ? scroller.scrollTop : 0;
            container.innerHTML = '';
            await this._renderLevel(entries, container, 0);
            // Quem restaura é o mesmo elemento de onde veio; se a árvore
            // encolheu, o navegador limita sozinho ao novo fim.
            if (scroller && scrollTop) scroller.scrollTop = scrollTop;
            this.refreshFocusHighlight();
            // Renders rebuild every row, let the CRUD layer re-apply its
            // selection / cut-pending decorations on the fresh DOM.
            document.dispatchEvent(new CustomEvent('aurora:standard-tree-rendered'));
        } catch (err) {
            console.error('StandardTreeRenderer.render failed:', err);
        } finally {
            this._rendering = false;
        }
        // Chegou pedido enquanto desenhavamos: uma passada extra, so uma,
        // fecha a diferenca sem repetir por cada pedido que se acumulou.
        if (this._sujo) {
            this._sujo = false;
            this._renderPromise = this._doRender();
            await this._renderPromise;
        }
    }

    /**
     * Switch to the folder view and reveal `folderPath`: expand every
     * ancestor from the project root down to it (so it's visible and open),
     * then scroll it into view with a brief highlight. Walks via
     * getFolderFiles so the expanded keys match exactly what the renderer
     * compares against (same separators/casing). No-op outside the project.
     */
    async revealFolder(folderPath) {
        const root = window.currentProjectPath;
        if (!root || !folderPath) return;

        const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const rootN = norm(root);
        const targetN = norm(folderPath);
        if (targetN !== rootN && !targetN.startsWith(rootN + '/')) return;

        // Expand each ancestor dir (root → … → target), inclusive, so the
        // target itself renders open (showing its files).
        let dir = root;
        while (norm(dir) !== targetN) {
            const entries = await this._read(dir);
            const next = entries.find((e) => e.isDirectory &&
                (norm(e.path) === targetN || targetN.startsWith(norm(e.path) + '/')));
            if (!next) break;
            this._expanded.add(next.path);
            dir = next.path;
        }

        window.fileTreeViewController?.showStandardMode?.();
        await this.render();

        const container = treeView.getContainer('standard');
        const el = container?.querySelector(`.file-tree-item[data-path="${(window.CSS?.escape ? CSS.escape(folderPath) : folderPath)}"]`);
        if (el) {
            el.scrollIntoView({ block: 'center' });
            el.classList.add('reveal-flash');
            setTimeout(() => el.classList.remove('reveal-flash'), 1400);
        }
    }

    // ---------------- private ----------------

    async _read(dirPath) {
        const list = await electronAPI?.getFolderFiles?.(dirPath);
        if (!Array.isArray(list)) return [];
        const root = window.currentProjectPath;
        const rules = this._invRules;
        const keep = (e) => {
            if (isIgnored(e)) return false;
            if (rules && rules.length && root) {
                const rel = relTo(root, e.path);
                if (rel && isInvHidden(rel, e.isDirectory, rules)) return false;
            }
            return true;
        };
        return sortEntries(list.filter(keep));
    }

    /**
     * Load `<root>/.inv` into compiled rules for this render pass. Missing/
     * unreadable `.inv` → empty rules (nothing hidden). The `.inv` file itself
     * is a dotfile, so it's already excluded by isIgnored.
     */
    async _loadInvRules(root) {
        this._invRules = [];
        if (!root) return;
        try {
            const invPath = await electronAPI.joinPath(root, '.inv');
            // Pergunta antes de ler. O `.inv` e opcional, entao nao existir e o
            // caso NORMAL, e tentar ler direto fazia o handler read-file logar
            // um erro e relancar a cada render da arvore: duas entradas de erro
            // no log por projeto aberto, para uma condicao esperada. Era a maior
            // fonte de ruido em %APPDATA%\SAPHO\logs.
            if (!(await electronAPI.fileExists(invPath))) return;
            const txt = await electronAPI.readFile(invPath);
            this._invRules = parseInv(txt);
        } catch (_) {
            this._invRules = []; // ilegivel ou malformado — nao esconde nada
        }
    }

    _pruneExpanded(root) {
        const norm = (p) => String(p || '').replace(/\\/g, '/');
        const r = norm(root);
        for (const p of Array.from(this._expanded)) {
            if (!norm(p).startsWith(r)) this._expanded.delete(p);
        }
    }

    /**
     * Render one directory level's entries into `container`. Recurses
     * (awaiting child reads) only for folders the user has expanded.
     *
     * Rows are built into an off-DOM DocumentFragment and attached in ONE
     * appendChild, so the whole level (and any expanded subtree, which fills
     * the off-DOM child boxes first) costs a single reflow instead of one per
     * row, that's the freeze on expanding a big folder / refreshing a deep
     * tree (P9). `container` is the live container only at the top of the call
     * chain; nested levels append into still-detached child boxes.
     */
    async _renderLevel(entries, container, level) {
        const frag = document.createDocumentFragment();
        for (const entry of entries) {
            const wrapper = this._buildRow(entry, level);
            frag.appendChild(wrapper);

            if (entry.isDirectory && this.isExpanded(entry.path)) {
                const childBox = wrapper.querySelector(':scope > .folder-content');
                if (childBox) {
                    const children = await this._read(entry.path);
                    await this._renderLevel(children, childBox, level + 1);
                }
            }
        }
        container.appendChild(frag);
    }

    _buildRow(entry, level) {
        const wrapper = document.createElement('div');
        wrapper.className = 'file-tree-item';
        wrapper.setAttribute('data-path', entry.path);
        // Consumed by the CRUD layer (context menu / paste-target resolution).
        wrapper.dataset.isDir = entry.isDirectory ? '1' : '';
        // Arrastar e soltar é do CRUD (standard_tree_crud._wireDragAndDrop);
        // aqui só marcamos a linha como arrastável.
        wrapper.draggable = true;
        wrapper.style.setProperty('--depth', String(level));

        const row = document.createElement('div');
        row.className = 'file-item';

        const inner = document.createElement('div');
        inner.className = 'file-item-row';

        // Chevron (folders) or invisible spacer (files), same 16px width
        // so names line up across types, VS Code style.
        if (entry.isDirectory) {
            const chevron = document.createElement('i');
            chevron.className = 'ph ph-caret-down folder-toggle-icon';
            if (!this.isExpanded(entry.path)) chevron.classList.add('collapsed');
            inner.appendChild(chevron);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'folder-toggle-spacer';
            inner.appendChild(spacer);
        }

        // Icon, Material Icon Theme SVG in its OWN colours, painted as a
        // background-image (no recolouring; the old per-ext/per-depth tinting
        // is gone). Folders get name-specific glyphs; .cmm keeps Aurora's
        // custom masked currentColor glyph (no Material equivalent).
        const icon = document.createElement('span');
        icon.className = 'file-item-icon';
        if (entry.isDirectory) {
            this._setFolderIcon(icon, entry.name, this.isExpanded(entry.path));
        } else if (isCmm(entry.name)) {
            icon.classList.add('aurora-icon-cmm');
        } else {
            icon.style.backgroundImage = `url("${iconUrlForFile(entry.name)}")`;
        }
        inner.appendChild(icon);

        // Name
        const name = document.createElement('span');
        name.className = 'file-item-name';
        name.textContent = entry.name;
        inner.appendChild(name);

        row.appendChild(inner);
        wrapper.appendChild(row);

        // Empty child container created up front for folders so toggling
        // is a class flip; populated lazily on first expand.
        if (entry.isDirectory) {
            const childBox = document.createElement('div');
            childBox.className = 'folder-content';
            if (!this.isExpanded(entry.path)) childBox.classList.add('hidden');
            wrapper.appendChild(childBox);
        }

        row.addEventListener('click', (e) => {
            // Ctrl e Shift são gestos de SELEÇÃO (standard_tree_crud cuida
            // deles). Abrir o arquivo ou abrir a pasta no meio de uma seleção
            // múltipla tiraria da tela justamente as linhas que o usuário está
            // marcando, e o Ctrl+clique para desmarcar reabriria o arquivo.
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (entry.isDirectory) {
                this._toggleFolder(entry, wrapper, level);
            } else {
                this._openFile(entry.path, entry.name, { preview: true });
            }
        });

        if (!entry.isDirectory) {
            row.addEventListener('dblclick', () => {
                // Single click already opened it as preview; promote the
                // existing tab to permanent without a second readFile.
                if (TabManager.tabs?.has?.(entry.path)) {
                    TabManager.promotePreviewToPermanent(entry.path);
                    TabManager.activateTab(entry.path);
                } else {
                    this._openFile(entry.path, entry.name, { preview: false });
                }
            });
        }

        return wrapper;
    }

    async _toggleFolder(entry, wrapper, level) {
        const willExpand = !this.isExpanded(entry.path);
        const childBox = wrapper.querySelector(':scope > .folder-content');
        const chevron = wrapper.querySelector(':scope > .file-item > .file-item-row > .folder-toggle-icon');
        const icon = wrapper.querySelector(':scope > .file-item .file-item-icon');

        if (willExpand) {
            this._expanded.add(entry.path);
            if (childBox && childBox.childElementCount === 0) {
                const children = await this._read(entry.path);
                await this._renderLevel(children, childBox, level + 1);
            }
        } else {
            this._expanded.delete(entry.path);
        }

        if (chevron) chevron.classList.toggle('collapsed', !willExpand);
        if (childBox) childBox.classList.toggle('hidden', !willExpand);
        if (icon) this._setFolderIcon(icon, entry.name, willExpand);
    }

    /**
     * Paint a folder row's icon: a name-specific Material folder glyph
     * (folder-test/folder-scripts/…) in its open or closed variant. Stamps
     * data-folder so collapseAll can recompute the closed icon without the
     * entry object.
     */
    _setFolderIcon(iconEl, name, open) {
        iconEl.dataset.folder = name || '';
        iconEl.style.backgroundImage = `url("${iconUrlForFolder(name, { open })}")`;
    }

    async _openFile(filePath, fileName, options) {
        try {
            const content = await electronAPI.readFile(filePath);
            const sem = window.SplitEditorManager;
            if (sem && sem.focusedPane > 0) {
                await sem.openInFocusedPane(filePath, content, options);
            } else {
                TabManager.addTab(filePath, content, options);
            }
        } catch (err) {
            console.error('Error opening file:', err);
        }
    }
}

const standardTreeRenderer = new StandardTreeRenderer();

if (typeof window !== 'undefined') {
    window.standardTreeRenderer = standardTreeRenderer;
}

export { standardTreeRenderer };
