/**
 * gtkw_picker.js: Toolbar dropdown for the active waveform layout file.
 *
 * Companion to the WaveStore: cada testbench tem suas proprias listas
 * `gtkwFiles[]` (.gtkw, do GTKWave) e `surferFiles[]` (.surf.ron/.sucl,
 * do Surfer), cada uma com um entry marcado `isActive: true`. O picker
 * mostra as listas do testbench ATUAL (definido por `testbenchFile` em
 * structure do .spf) e troca de lista automaticamente quando o
 * testbench muda, listas isoladas, tb A nao ve layout de tb B.
 *
 * As duas listas aparecem JUNTAS no menu, cada extensao com o seu
 * icone. Antes o dropdown mostrava so a do visualizador ligado, e
 * escolher um layout do outro exigia lembrar de trocar o visualizador
 * primeiro, num botao que fica noutro canto da toolbar. Agora o
 * arquivo escolhido e quem decide: clicar num .gtkw com o Surfer
 * ligado liga o GTKWave junto, porque um layout so serve ao programa
 * que o escreveu.
 *
 * Operacoes:
 *   - Listar registrados, escolher o ativo (atualiza `isActive`).
 *   - "default" limpa a selecao do visualizador atual (o wave flow
 *     auto-gera o layout).
 *   - "+ Add file..." abre dialog filtrado e registra um arquivo.
 *   - "+ List from a folder..." varre uma pasta escolhida e registra
 *     de uma vez tudo que achar (.gtkw, .surf.ron, .sucl), cada um na
 *     sua lista. E o caminho para quem tem uma pasta de layouts e nao
 *     quer abrir o dialog uma vez por arquivo.
 *   - "X" inline (hover-revealed) remove o entry da lista.
 *
 * UI: um dropdown custom (button + menu div) em vez de um <select>
 * nativo, justamente porque <select> nao deixa adicionar botoes
 * per-option. O padrao de UX espelha o file tree (row + delete btn
 * que aparece no hover), entao remover entradas e familiar e nao
 * precisa de modo separado.
 *
 * Persistencia via `WaveStore.update(projectPath, tbKey, ...)`. Escritas
 * concorrentes serializam per-(projectPath, tbKey).
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { showCardNotification } from '../ui/notification.js';
import { WaveStore } from './wave_state_store.js';
import { getViewer, setViewer } from './viewer_preference.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

const NONE_VALUE = '';
const ADD_VALUE = '__add__';
const ADD_FOLDER_VALUE = '__add_folder__';

/**
 * Um icone por extensao, que e a unica coisa que distingue as linhas
 * depois que as duas listas passaram a conviver no mesmo menu. O .gtkw
 * herda o icone que ele ja tem nas abas (tab_utils.js), entao o mesmo
 * arquivo se parece com ele mesmo em toda a interface.
 */
const LAYOUT_KINDS = [
    { kind: 'gtkw',   viewer: 'gtkwave', test: /\.gtkw$/i,     icon: 'ph ph-waveform',  field: 'gtkwFiles' },
    { kind: 'surfer', viewer: 'surfer',  test: /\.surf\.ron$|\.ron$/i, icon: 'ph ph-waves', field: 'surferFiles' },
    { kind: 'sucl',   viewer: 'surfer',  test: /\.sucl$/i,     icon: 'ph ph-wave-sine', field: 'surferFiles' },
];

/** Pasta varrida em profundidade, com teto, para nao travar em arvore grande. */
const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_FILES = 300;

/** A regra de layout que casa com o arquivo, ou null se nao for um layout. */
function kindOf(filePath) {
    const name = String(filePath || '');
    return LAYOUT_KINDS.find((k) => k.test.test(name)) || null;
}

function tbKeyFromPath(tbPath) {
    if (!tbPath) return '';
    return tbPath.split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
}

class GtkwPickerManager {
    constructor() {
        this.root = null;
        this.button = null;
        this.labelEl = null;
        this.menu = null;
        this._initialized = false;
        this._open = false;
        this._currentTbKey = '';
        /** Entradas das DUAS listas, ja com a regra de extensao resolvida. */
        this._files = [];
        this._activePath = NONE_VALUE;
        // Viewer-aware: define qual lista responde por "default"/ativo e
        // qual grupo aparece primeiro. Re-derivado a cada refresh().
        this._isSurfer = false;
    }

    initialize() {
        if (this._initialized) return;
        this.root   = document.getElementById('gtkwPicker');
        this.button = document.getElementById('gtkwPickerButton');
        this.menu   = document.getElementById('gtkwPickerMenu');
        if (!this.root || !this.button || !this.menu) return;
        this.labelEl = this.button.querySelector('.gtkw-picker-label');
        // Track the menu's original home so we can put it back on close.
        // We move the menu to <body> while open because the toolbar zone
        // uses `overflow: hidden` to keep its layout tidy, that clips
        // any absolutely-positioned descendant. A body-level portal
        // bypasses the clip entirely and stacks above Monaco/welcome.
        this._menuHome = this.menu.parentNode;
        this.menu.classList.add('gtkw-picker-menu--portal');

        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleOpen();
        });

        // Outside click closes the menu. mousedown (capture) wins over
        // any internal listener that might stopPropagation. The menu
        // sits in <body> while open so `root.contains` would miss it
        //, check both root AND menu.
        document.addEventListener('mousedown', (e) => {
            if (!this._open) return;
            if (this.root.contains(e.target)) return;
            if (this.menu.contains(e.target)) return;
            this._closeMenu();
        }, true);

        // Reposition the open menu on resize / scroll so it stays
        // glued to the trigger button.
        window.addEventListener('resize', () => {
            if (this._open) this._positionMenu();
        });
        window.addEventListener('scroll', () => {
            if (this._open) this._positionMenu();
        }, true);

        // Locale change rebuilds the menu so "default" + "+ Add" pick
        // up the new translations.
        window.addEventListener('aurora:locale-changed', () => this.refresh());

        // Viewer change (GTKWave ↔ Surfer) muda qual grupo vem primeiro e
        // de qual lista sai o rotulo do botao, refresh.
        window.addEventListener('aurora:wave-viewer-changed', () => this.refresh());

        this._initialized = true;
        this.refresh();
    }

    /** A regra ('gtkw'/'surfer'/'sucl') do visualizador ligado agora. */
    get _activeViewer() {
        return this._isSurfer ? 'surfer' : 'gtkwave';
    }

    /** A lista que responde pelo visualizador ligado agora. */
    get _field() {
        return this._isSurfer ? 'surferFiles' : 'gtkwFiles';
    }

    async refresh() {
        if (!this.root) return;
        this._isSurfer = (typeof getViewer === 'function' ? getViewer() : 'gtkwave') === 'surfer';
        const projectPath = ProjectStore.getProjectPath();
        const spfPath = ProjectStore.getSpfPath();
        if (!projectPath || !spfPath) {
            this._currentTbKey = '';
            this._files = [];
            this._activePath = NONE_VALUE;
            this._setLabelKey('toolbar.gtkwPicker.noProject');
            this.button.disabled = true;
            this._renderMenu();
            return;
        }
        const config = await SpfStore.read(spfPath);
        const tbKey = tbKeyFromPath(config.testbenchFile);
        this._currentTbKey = tbKey;
        if (!tbKey) {
            this._files = [];
            this._activePath = NONE_VALUE;
            this._setLabelKey('toolbar.gtkwPicker.noTestbench');
            this.button.disabled = true;        // sem testbench: lista desabilitada
            this._renderMenu();
            return;
        }
        const state = await WaveStore.read(projectPath, tbKey);
        this._files = this._collect(state);
        // O ativo e sempre o da lista do visualizador ligado: e esse arquivo
        // que o wave flow vai carregar. O ativo da outra lista continua
        // guardado, so nao e o que o rotulo mostra.
        const active = this._files.find((f) => f.isActive === true && f.field === this._field);
        this._activePath = active?.path || NONE_VALUE;
        this._updateLabelFromState();
        this.button.disabled = false;
        this._renderMenu();
    }

    /**
     * As duas listas viram uma so, na ordem em que foram registradas, com o
     * grupo do visualizador ligado na frente: o que serve agora fica ao
     * alcance, e o resto continua visivel sem precisar trocar de modo antes.
     */
    _collect(state) {
        const out = [];
        const fields = this._isSurfer ? ['surferFiles', 'gtkwFiles'] : ['gtkwFiles', 'surferFiles'];
        for (const field of fields) {
            const list = Array.isArray(state?.[field]) ? state[field] : [];
            for (const f of list) {
                if (!f?.path) continue;
                const rule = kindOf(f.path);
                out.push({
                    name: f.name || f.path.split(/[\\/]/).pop(),
                    path: f.path,
                    isActive: f.isActive === true,
                    field,
                    viewer: rule?.viewer || (field === 'surferFiles' ? 'surfer' : 'gtkwave'),
                    icon: rule?.icon || 'ph ph-file',
                });
            }
        }
        return out;
    }

    _updateLabelFromState() {
        if (!this.labelEl) return;
        if (this._activePath && this._activePath !== NONE_VALUE) {
            const f = this._files.find((x) => x.path === this._activePath);
            const name = f?.name || this._activePath.split(/[\\/]/).pop();
            this.labelEl.textContent = name;
            this.labelEl.removeAttribute('data-i18n');
        } else {
            this._setLabelKey('toolbar.gtkwPicker.default');
        }
    }

    _setLabelKey(key) {
        if (!this.labelEl) return;
        this.labelEl.textContent = tr(key);
        this.labelEl.setAttribute('data-i18n', key);
    }

    _renderMenu() {
        if (!this.menu) return;
        this.menu.innerHTML = '';

        // Default row, clears the active selection.
        this.menu.appendChild(this._makeMenuRow({
            value: NONE_VALUE,
            label: tr('toolbar.gtkwPicker.default'),
            i18nKey: 'toolbar.gtkwPicker.default',
            icon: 'ph ph-magic-wand',
            removable: false,
            active: this._activePath === NONE_VALUE,
        }));

        for (const f of this._files) {
            this.menu.appendChild(this._makeMenuRow({
                value: f.path,
                label: f.name,
                title: f.path,
                icon: f.icon,
                removable: true,
                active: f.isActive && f.field === this._field,
            }));
        }

        // Linhas de acrescentar, sentinelas. O rotulo do "+ Add file" segue o
        // visualizador ligado porque o dialog filtra pela extensao dele; o de
        // pasta nao, ele varre tudo de uma vez.
        this.menu.appendChild(this._makeMenuRow({
            value: ADD_VALUE,
            label: this._isSurfer ? tr('toolbar.gtkwPicker.addSurfer') : tr('toolbar.gtkwPicker.add'),
            i18nKey: this._isSurfer ? 'toolbar.gtkwPicker.addSurfer' : 'toolbar.gtkwPicker.add',
            icon: 'ph ph-plus',
            removable: false,
            adder: true,
        }));
        this.menu.appendChild(this._makeMenuRow({
            value: ADD_FOLDER_VALUE,
            label: tr('toolbar.gtkwPicker.addFolder'),
            i18nKey: 'toolbar.gtkwPicker.addFolder',
            icon: 'ph ph-folder-open',
            removable: false,
            adder: true,
        }));
    }

    _makeMenuRow({ value, label, i18nKey, title, icon, removable, active, adder }) {
        const row = document.createElement('div');
        row.className = 'gtkw-picker-row';
        if (active)  row.classList.add('active');
        if (adder)   row.classList.add('adder');
        row.dataset.value = value;
        if (title) row.title = title;

        if (icon) {
            const iconEl = document.createElement('i');
            iconEl.className = `${icon} gtkw-picker-row-icon`;
            iconEl.setAttribute('aria-hidden', 'true');
            row.appendChild(iconEl);
        }

        const labelEl = document.createElement('span');
        labelEl.className = 'gtkw-picker-row-label';
        labelEl.textContent = label;
        if (i18nKey) labelEl.setAttribute('data-i18n', i18nKey);
        row.appendChild(labelEl);

        if (removable) {
            // The X is inside the row, hidden until hover, mirrors the
            // file tree's per-row delete affordance so the gesture is
            // familiar (and crucially, can't be triggered by mistake
            // while scanning the list).
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'gtkw-picker-row-remove';
            x.title = tr('toolbar.gtkwPicker.removeTooltip') || 'Remove from list';
            x.setAttribute('aria-label', x.title);
            x.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
            x.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this._removeEntry(value);
            });
            row.appendChild(x);
        }

        row.addEventListener('click', () => this._onRowClick(value));
        return row;
    }

    _toggleOpen() {
        if (this._open) this._closeMenu();
        else this._openMenu();
    }

    _openMenu() {
        if (!this.menu) return;
        // Move the menu out of the clipped toolbar zone and onto the
        // body, then position it under the button. Without this the
        // toolbar's `overflow: hidden` clips the menu away entirely
        // (which is what made it look like nothing happened on click).
        if (this.menu.parentNode !== document.body) {
            document.body.appendChild(this.menu);
        }
        this.menu.classList.remove('hidden');
        this.root.classList.add('open');
        this._open = true;
        this._positionMenu();
    }

    _closeMenu() {
        if (!this.menu) return;
        this.menu.classList.add('hidden');
        this.root.classList.remove('open');
        this._open = false;
        // Park the menu back in the picker root so a fresh open()
        // doesn't have to hunt for it (and inspecting the picker in
        // devtools shows the canonical structure).
        if (this._menuHome && this.menu.parentNode !== this._menuHome) {
            this._menuHome.appendChild(this.menu);
        }
    }

    _positionMenu() {
        if (!this._open || !this.button || !this.menu) return;
        const rect = this.button.getBoundingClientRect();
        // Glue the menu's left edge to the button. If the menu would
        // run off the right edge of the window, shift it left so it
        // stays on screen (with a small 8px breathing margin).
        const menuW = this.menu.offsetWidth || 240;
        const maxLeft = window.innerWidth - menuW - 8;
        const left = Math.min(rect.left, Math.max(8, maxLeft));
        this.menu.style.left = `${left}px`;
        this.menu.style.top  = `${rect.bottom + 4}px`;
    }

    async _onRowClick(value) {
        if (value === ADD_VALUE) {
            this._closeMenu();
            await this._handleAddFile();
            return;
        }
        if (value === ADD_FOLDER_VALUE) {
            this._closeMenu();
            await this._handleAddFolder();
            return;
        }
        this._closeMenu();
        await this._setActive(value);
    }

    async _handleAddFile() {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return;
        if (!this._currentTbKey) return;

        // Dialog filtrado pelo tipo de layout do visualizador ligado, "All
        // Files" de proposito nao e oferecido: o wave flow nao consome outra
        // coisa e falharia depois, na simulacao, com um erro menos obvio.
        const filters = this._isSurfer
            ? [{ name: 'Surfer layout (*.surf.ron, *.sucl)', extensions: ['ron', 'sucl'] }]
            : [{ name: 'GTKWave Save Files (*.gtkw)', extensions: ['gtkw'] }];
        const result = await electronAPI.showOpenDialogImport({
            properties: ['openFile'],
            filters,
        });
        if (!result || result.canceled || !result.filePaths?.length) return;

        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop();
        const tbKey = this._currentTbKey;
        const field = this._field;

        await WaveStore.update(projectPath, tbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            let existing = files.find((f) => f?.path === filePath);
            if (!existing) {
                existing = { name: fileName, path: filePath, isActive: false };
                files.push(existing);
            }
            for (const f of files) f.isActive = (f === existing);
            cfg[field] = files;
        });
        await this.refresh();
    }

    /**
     * Escolher uma pasta e registrar de uma vez todo layout que houver nela.
     *
     * Quem mantem os layouts numa pasta so (a do projeto, uma pasta de
     * exemplos, a saida de outra ferramenta) estava obrigado a abrir o dialog
     * de arquivo uma vez por arquivo, sabendo o nome de cada um de antemao.
     * Aqui a pessoa aponta a pasta e escolhe depois, olhando a lista.
     *
     * Nada e ativado automaticamente: registrar e listar, escolher continua
     * sendo um clique separado, senao apontar uma pasta trocaria o layout da
     * simulacao sem a pessoa ter pedido.
     */
    async _handleAddFolder() {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;

        const folder = await electronAPI.selectDirectory({ defaultPath: projectPath });
        if (!folder) return;

        const folderName = String(folder).split(/[\\/]/).pop() || folder;
        const found = await this._scanFolder(folder);
        if (found.length === 0) {
            showCardNotification(
                tr('toolbar.gtkwPicker.folderEmpty', { name: folderName }),
                'warning', 4000, tr('toolbar.gtkwPicker.folderTitle'),
            );
            return;
        }

        let added = 0;
        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            for (const field of ['gtkwFiles', 'surferFiles']) {
                const files = Array.isArray(cfg[field]) ? cfg[field] : [];
                const seen = new Set(files.map((f) => String(f?.path || '').toLowerCase()));
                for (const f of found) {
                    if (f.field !== field) continue;
                    if (seen.has(f.path.toLowerCase())) continue;
                    files.push({ name: f.name, path: f.path, isActive: false });
                    seen.add(f.path.toLowerCase());
                    added++;
                }
                cfg[field] = files;
            }
        });

        await this.refresh();
        showCardNotification(
            tr('toolbar.gtkwPicker.folderAdded', { count: added, found: found.length, name: folderName }),
            added > 0 ? 'success' : 'info', 4000, tr('toolbar.gtkwPicker.folderTitle'),
        );
        // Reabre a lista ja preenchida: quem apontou a pasta veio escolher.
        this._openMenu();
    }

    /**
     * Varre a pasta atras de .gtkw / .surf.ron / .sucl, descendo em
     * subpastas ate SCAN_MAX_DEPTH. Pastas ocultas e node_modules ficam de
     * fora, e o total para em SCAN_MAX_FILES: apontar a raiz de um disco por
     * engano devolve uma lista grande, nao um travamento.
     */
    async _scanFolder(root) {
        const found = [];
        const seen = new Set();

        const walk = async (dir, depth) => {
            if (depth > SCAN_MAX_DEPTH || found.length >= SCAN_MAX_FILES) return;
            let entries;
            try {
                entries = await electronAPI.getFolderFiles(dir);
            } catch (_e) {
                return; // pasta sem permissao / sumiu no meio da varredura
            }
            for (const entry of (Array.isArray(entries) ? entries : [])) {
                if (found.length >= SCAN_MAX_FILES) return;
                if (entry.isDirectory) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    await walk(entry.path, depth + 1);
                    continue;
                }
                const rule = kindOf(entry.name);
                if (!rule) continue;
                const key = String(entry.path).toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                found.push({ name: entry.name, path: entry.path, field: rule.field });
            }
        };

        await walk(root, 0);
        return found;
    }

    /**
     * Marca um layout como ativo. Se ele for do outro visualizador, o
     * visualizador troca junto: um .gtkw so tem sentido no GTKWave e um
     * .surf.ron so no Surfer, entao escolher o arquivo ja e escolher o
     * programa. A troca dispara o evento de sempre, entao o botao da toolbar
     * e o aviso de mudanca de visualizador continuam corretos.
     */
    async _setActive(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;

        const entry = this._files.find((f) => f.path === targetPath);
        const field = entry ? entry.field : this._field;

        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            for (const f of files) {
                f.isActive = (f?.path === targetPath);
            }
            cfg[field] = files;
        });

        if (entry && entry.viewer !== this._activeViewer) {
            const applied = setViewer(entry.viewer);
            window.dispatchEvent(new CustomEvent('aurora:wave-viewer-changed', { detail: { viewer: applied } }));
            return; // o listener do evento ja chama refresh()
        }
        await this.refresh();
    }

    async _removeEntry(targetPath) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !this._currentTbKey) return;
        if (!targetPath || targetPath === NONE_VALUE
            || targetPath === ADD_VALUE || targetPath === ADD_FOLDER_VALUE) return;
        const entry = this._files.find((f) => f.path === targetPath);
        const field = entry ? entry.field : this._field;
        await WaveStore.update(projectPath, this._currentTbKey, (cfg) => {
            const files = Array.isArray(cfg[field]) ? cfg[field] : [];
            cfg[field] = files.filter((f) => f?.path !== targetPath);
        });
        await this.refresh();
        // Keep the menu open if it was open so the user can remove
        // several in a row without re-opening between clicks.
        if (this._open) this._renderMenu();
    }
}

const gtkwPickerManager = new GtkwPickerManager();

if (typeof window !== 'undefined') {
    window.gtkwPickerManager = gtkwPickerManager;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => gtkwPickerManager.initialize());
} else {
    gtkwPickerManager.initialize();
}

export { gtkwPickerManager, GtkwPickerManager, kindOf, LAYOUT_KINDS };
