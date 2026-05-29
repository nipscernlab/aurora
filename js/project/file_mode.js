/**
 * file_mode.js — ProjectTreeManager (state + lifecycle + persistencia).
 *
 * Renderiza a file tree do projeto — a unica vista de arquivos que
 * Aurora mostra hoje. Lista arquivos a partir do .spf
 * (structure.synthesizableFiles + testbenchFiles + per-processador
 * Software/Hardware/Simulation auto-descoberto).
 *
 * Pontos de entrada externos:
 *   refreshTree()   — UNICO entry point pra atualizar a tree. Faz
 *                     setup idempotente (DOM cache wait, project path
 *                     discovery, isTreeActive flag, view switch) +
 *                     loadConfiguration + renderTree em loop, tudo
 *                     coalescido via _refreshPromise + pending flag.
 *   activateTree()  — alias historico pra refreshTree (compat com
 *                     projectManager.loadProject e
 *                     fileTreeManager.initializeTreeBasedOnMode).
 *   reset()         — limpa estado transiente; chamado por
 *                     close_project pra que reabrir um projeto
 *                     dispare uma ativacao limpa.
 *
 * Estrutura do modulo: a classe vive aqui, com state + lifecycle +
 * persistencia + helpers de discovery. Os comportamentos pesados de
 * UI sao mixed-in via Object.assign(prototype, ...):
 *
 *   - RenderMixin  ([project_tree_render.js](project_tree_render.js))
 *       renderTree, _createFileItem, _updateFileItem,
 *       _createProcessorSeparator, getFileIcon, _getIconTooltip
 *   - ActionsMixin ([project_tree_actions.js](project_tree_actions.js))
 *       drag/drop, import, create/delete, context menus, toggles
 *
 * Dentro dos mixins, `this` aponta pra instancia da classe
 * normalmente — todos os metodos podem usar fields/methods desta
 * file livremente.
 */

import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from './project_store.js';
import { setAvailableProcessors, addAvailableProcessor } from './processor_list.js';
import { SpfStore } from './spf_store.js';

// Single click on a file in the tree opens it as a VS Code-style preview
// (italic tab; clicking another file replaces it). Double click pins it
// as a permanent tab. The same `options.preview` flag flows through to
// SplitPane.openFile so a focused split treats clicks identically — each
// pane carries its own preview slot, decoupled from the main pane.
async function openTreeFile(filePath, fileName, options, ctx) {
    try {
        const content = await window.electronAPI.readFile(filePath);
        const sem = window.SplitEditorManager;
        if (sem && sem.focusedPane > 0) {
            await sem.openInFocusedPane(filePath, content, options);
        } else {
            TabManager.addTab(filePath, content, options);
        }
    } catch (err) {
        console.error('Error opening file:', err);
        ctx?.showNotification?.(
            window.t ? window.t('notification.fileMode.errorOpen', { name: fileName }) : `Error opening file: ${fileName}`,
            'error',
            3000,
        );
    }
}
import { RenderMixin } from './project_tree_render.js';
import { ActionsMixin } from './project_tree_actions.js';
import { classifyVerilogContent } from './verilog_classifier.js';

class ProjectTreeManager {
    constructor() {
        // File tree drag-and-drop accepts Verilog source and header
        // files only. .gtkw save files have a dedicated entry point
        // — the toolbar's gtkw picker (+ Add .gtkw file...) — and
        // don't belong in the same list as Verilog sources, so
        // dropping one here is rejected with the same notification a
        // .txt would get.
        this.ALLOWED_EXTENSIONS = ['.v', '.sv', '.vh', '.py'];
        // Extensoes "software" — moram em <proc>/Software/, nao em
        // Hardware/. Aparecem na arvore agrupadas com o processador,
        // mas nao recebem toggle synth/tb, delete, nem entram no
        // synthesizableFiles do .spf.
        // .asm e GERADO (C± → ASM) e nao deve poluir a arvore — so o
        // fonte .cmm aparece. (A compilacao le o .asm direto do disco,
        // independente da arvore.)
        this.SOFTWARE_EXTENSIONS = ['.cmm'];

        // State management. currentProjectPath is intentionally NOT
        // cached here — vive em ProjectStore (single source of truth).
        // Caching it on the manager was the root cause of files-
        // disappearing on close+reopen, since close didn't reset it
        // and the early-return branch in activateTree used the stale
        // path.
        this.verilogFiles = [];
        this.isTreeActive = false;

        // DOM element cache (populado em cacheElements pos-DOMReady).
        this.elements = {};

        // Bind handlers que sao passados por referencia (addEventListener
        // os armazena bound). Os metodos vivem nos mixins; o bind
        // garante que `this` continue apontando pra instancia mesmo
        // quando o listener dispara.
        this.preventDefaults = this.preventDefaults.bind(this);
        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleTreeContextMenu = this.handleTreeContextMenu.bind(this);
        this.createNewFile = this.createNewFile.bind(this);
        this.deleteFile = this.deleteFile.bind(this);
        this.closeContextMenu = this.closeContextMenu.bind(this);

        // Expose the init() promise so callers (app_initializer) can
        // safely await DOM-element caching before asking us to render.
        // Without this, a programmatic mode switch on cold start can
        // race past cacheElements and silently bail out in renderTree
        // (no fileTree element).
        this.initPromise = this.init();
    }

    async init() {
        try {
            if (document.readyState === 'loading') {
                await new Promise((resolve) => {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                });
            }
            this.cacheElements();
            this.setupEventListeners();
            // Estilos vivem em css/tree/verilog_tree.css — antes eram
            // injetados em runtime via injectStyles(), o que criava
            // uma terceira definicao de .confirm-modal brigando com a
            // canonica.
            console.log('✅ ProjectTreeManager initialized');
        } catch (error) {
            console.error('❌ Failed to initialize ProjectTreeManager:', error);
        }
    }

    cacheElements() {
        this.elements = {
            fileTree: document.getElementById('file-tree'),
            fileTreeContainer: document.querySelector('.file-tree-container'),
            refreshButton: document.getElementById('refresh-button'),
        };

        console.log('📦 Cached elements:', { fileTree: !!this.elements.fileTree });
    }

    setupEventListeners() {
        // Project Mode unico: file tree e sempre o verilog picker.
        // Atalho do construtor pra primeira pintura — chamadas
        // subsequentes vem via projectManager.loadProject e
        // fileTreeManager.initializeTreeBasedOnMode (coalescidas).
        this.activateTree();

        // Qualquer escritor do .spf (gtkw_picker, CLI tools, futuros
        // fluxos) dispara este evento — re-le e re-renderiza pra nao
        // ficar stale.
        document.addEventListener('project-config-saved', () => {
            if (this.isTreeActive) {
                this.refreshTree();
            }
        });

        // aurora:spf-changed e disparado por SpfStore.update apos cada
        // escrita bem-sucedida. E o hook canonico do design "spf como
        // fonte unica de verdade": handlers de user-action escrevem
        // via SpfStore.update (transacao atomica per-path) e dependem
        // deste evento pra atualizar a UI. Filtramos por spfPath pra
        // nao re-renderizar quando o write foi pra outro projeto
        // (importFiles, por exemplo, persiste no .spf original mesmo
        // depois do usuario trocar de projeto — ali NAO queremos
        // refresh: o projeto ativo agora e outro).
        window.addEventListener('aurora:spf-changed', (event) => {
            const changed = event?.detail?.spfPath;
            if (changed && changed === ProjectStore.getSpfPath() && this.isTreeActive) {
                this.refreshTree();
            }
        });

        // Editor save dispatched aurora:file-saved (tab_manager.js#saveFile).
        // Reclassifica + re-persiste so se o path salvo estiver tracked
        // em verilogFiles — evita refresh storm em saves de arquivos fora
        // do projeto Verilog (e.g. .json, .md). Path comparado via
        // _normalizePath pra cobrir Windows case/sep.
        window.addEventListener('aurora:file-saved', (event) => {
            const savedPath = event?.detail?.path;
            if (!savedPath || !this.isTreeActive) return;
            const key = this._normalizePath(savedPath);
            const tracked = this.verilogFiles.some((f) => this._normalizePath(f.path) === key);
            if (tracked) this.refreshTree();
        });

        // Highlight da row do arquivo em foco no Monaco. TabManager e
        // SplitEditorManager despacham este evento toda vez que o file
        // ativo muda (tab clicked, split pane focused, tab closed, etc).
        // refreshEditorFocusHighlight le TabManager.getEditingFilePath
        // que ja resolve "qual file e considerado em foco" entre main e
        // split — single source of truth.
        document.addEventListener('aurora:editing-file-changed', () => {
            this.refreshEditorFocusHighlight?.();
        });

        if (this.elements.fileTree) {
            this.elements.fileTree.addEventListener('contextmenu', this.handleTreeContextMenu);

            // Delegated click handler para as rows. Cada row carrega
            // `data-file-path`; action buttons carregam `data-action`.
            // Este listener unico substitui o trio antigo per-row
            // (open file / toggle / delete). Lookup do file por path
            // a cada click significa que listeners sobrevivem a sort
            // e updates in-place — nenhum indice capturado em closure
            // pode targetar a row errada.
            this.elements.fileTree.addEventListener('click', async (e) => {
                if (!this.isTreeActive) return;
                const row = e.target.closest('.verilog-file-item');
                if (!row) return;
                const path = row.dataset.filePath;
                if (!path) return;
                const file = this.verilogFiles.find((f) => f.path === path);
                if (!file) return;

                const actionBtn = e.target.closest('[data-action]');
                const action = actionBtn?.dataset.action;

                if (action === 'delete') {
                    e.preventDefault();
                    e.stopPropagation();
                    await this._removeFileByPath(path);
                    return;
                }
                // Plain row click → abre o arquivo como PREVIEW (italico,
                // VS Code-style). Clicar em outro arquivo substitui o preview;
                // dblclick promove o tab a permanente. Roteia pro pane focado:
                // se um split estiver focado (focusedPane > 0) abre nele,
                // senao cai no pane principal via TabManager.
                await openTreeFile(file.path, file.name, { preview: true }, this);
            });

            // Double-click → promote/open as permanent tab. The single-click
            // listener still fires first (it opens or activates the preview);
            // this one upgrades the same path to a permanent tab. We don't
            // re-read the file here — the preview already created the tab.
            this.elements.fileTree.addEventListener('dblclick', async (e) => {
                if (!this.isTreeActive) return;
                const row = e.target.closest('.verilog-file-item');
                if (!row) return;
                const path = row.dataset.filePath;
                if (!path) return;
                const file = this.verilogFiles.find((f) => f.path === path);
                if (!file) return;
                if (e.target.closest('[data-action]')) return; // delete button
                await openTreeFile(file.path, file.name, { preview: false }, this);
            });
        }

        this.elements.refreshButton?.addEventListener('click', () => {
            if (this.isTreeActive) {
                this.refreshTree();
            }
        });

        // Criacao/delete de processadores no main process — o .spf ja
        // foi reescrito quando esses eventos chegam aqui. Sem isso, a
        // tree fica stale (sem o separador do novo processador / sem
        // os .cmm e .asm que o template gera) ate proximo restart ou
        // ate o usuario clicar Refresh manualmente.
        //
        // _discoverProcessorFiles() varre as pastas <proj>/<proc>/{Hardware,
        // Software,Simulation}/ pra cada nome em window.availableProcessors.
        // Essa lista so e populada em projectManager.loadProject, entao
        // precisamos sincroniza-la aqui antes de refreshTree() — senao
        // o varredor pula a pasta do processador recem-criado e os
        // arquivos do template nunca aparecem.
        window.electronAPI?.onProcessorCreated?.((data) => {
            // addAvailableProcessor faz dedup case-insensitive — ver
            // processor_list.js.
            addAvailableProcessor(data?.processorName);
            this.refreshTree();
        });
        // onProcessorsUpdated traz a lista completa (disparado em
        // delete-processor e re-disparado em project open). Substituimos
        // a lista inteira; setAvailableProcessors faz dedup.
        window.electronAPI?.onProcessorsUpdated?.((data) => {
            if (Array.isArray(data?.processors)) {
                setAvailableProcessors(data.processors);
            }
            this.refreshTree();
        });

        this.setupDragAndDrop();
    }

    /**
     * Wire dos handlers de drag-and-drop. Os handlers em si vivem em
     * ActionsMixin — aqui so attachamos os listeners.
     */
    setupDragAndDrop() {
        const dropArea = this.elements.fileTree;
        if (!dropArea) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
            dropArea.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        dropArea.addEventListener('dragenter', this.handleDragEnter, false);

        // dragover usa um listener inline pra setar a classe; nao
        // precisa do bound handler porque o code roda inline.
        dropArea.addEventListener('dragover', (e) => {
            if (this.isTreeActive) {
                e.preventDefault();
                dropArea.classList.add('verilog-dragover');
            }
        }, false);

        dropArea.addEventListener('dragleave', this.handleDragLeave, false);
        dropArea.addEventListener('drop', this.handleDrop, false);
    }

    // ----- helpers de path / discovery ---------------------------------

    /** Ordena: Top Level primeiro, depois alfabetico. */
    sortFilesAlphabetically() {
        this.verilogFiles.sort((a, b) => {
            if (a.isTopLevel && !b.isTopLevel) return -1;
            if (!a.isTopLevel && b.isTopLevel) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    /** Extensao com ponto (e.g. '.v'). */
    getFileExtension(fileName) {
        const parts = fileName.toLowerCase().split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
    }

    /** Normaliza path pra comparacao case-insensitive cross-platform. */
    _normalizePath(p) {
        return (p || '').replace(/\\/g, '/').toLowerCase();
    }

    /**
     * Dado um arquivo, devolve o nome do processador "dono" se o path
     * cair em <projeto>/<proc>/{Hardware,Software,Simulation}/, senao
     * null. Lista canonica de processadores e window.availableProcessors
     * (semeada no load do .spf por project_manager).
     */
    _getProcessorForFile(file) {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath || !file?.path) return null;
        const procs = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
        if (procs.length === 0) return null;
        const np = this._normalizePath(file.path);
        const projN = this._normalizePath(projectPath);
        if (!np.startsWith(projN)) return null;
        const rel = np.slice(projN.length).replace(/^\/+/, '');
        const segs = rel.split('/');
        // Esperamos <proc>/{Hardware|Software|Simulation}/<arquivo> —
        // pelo menos 3 segs e o segundo precisa ser uma das tres
        // subpastas reconhecidas.
        if (segs.length < 3) return null;
        if (segs[1] !== 'hardware' && segs[1] !== 'software' && segs[1] !== 'simulation') {
            return null;
        }
        const candidate = segs[0];
        for (const p of procs) {
            if (p.toLowerCase() === candidate) return p;
        }
        return null;
    }

    /**
     * Varre <projeto>/<proc>/{Hardware,Software,Simulation}/ pra cada
     * processador configurado e adiciona qualquer .v/.sv/.vh ainda
     * nao listado em this.verilogFiles como synth, e qualquer .cmm
     * como software (nao persistido). Devolve quantos de cada —
     * caller usa pra decidir se vale chamar saveConfiguration().
     *
     * Nao-destrutivo: nao remove arquivos que sumiram do disco aqui
     * (isso fica a cargo do filtro fileExists em loadConfiguration).
     */
    async _discoverProcessorFiles() {
        const projectPath = ProjectStore.getProjectPath();
        if (!projectPath) return { addedPersist: 0, addedSoftware: 0 };
        const procs = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
        if (procs.length === 0) return { addedPersist: 0, addedSoftware: 0 };

        const seen = new Set(this.verilogFiles.map((f) => this._normalizePath(f.path)));
        let addedPersist = 0;
        let addedSoftware = 0;

        // Para cada processador, varremos as TRES subpastas reconhecidas
        // (Hardware/, Software/, Simulation/) e aceitamos qualquer
        // arquivo com extensao Verilog ou Software, independente da
        // pasta. A categoria (synth vs software) e decidida pela
        // EXTENSAO, nao pela pasta:
        //   .v / .sv / .vh   → synth, persistido no .spf
        //   .cmm             → software, isSoftware=true, NAO persistido
        //                       (.asm e gerado e fica fora da arvore;
        //                       re-descoberto a cada load pra evitar
        //                       loop com o file watcher)
        const subfolders = ['Hardware', 'Software', 'Simulation'];
        const allExts = [...this.ALLOWED_EXTENSIONS, ...this.SOFTWARE_EXTENSIONS];

        for (const procName of procs) {
            for (const subDirName of subfolders) {
                const subDir = await window.electronAPI.joinPath(projectPath, procName, subDirName);
                let entries;
                try {
                    entries = await window.electronAPI.listFilesInDirectory(subDir);
                } catch {
                    continue;
                }
                if (!Array.isArray(entries)) continue;
                for (const entry of entries) {
                    if (typeof entry !== 'string') continue;
                    const lower = entry.toLowerCase();
                    const matchedExt = allExts.find((ext) => lower.endsWith(ext));
                    if (!matchedExt) continue;
                    const isSoftware = this.SOFTWARE_EXTENSIONS.includes(matchedExt);
                    const fullPath = await window.electronAPI.joinPath(subDir, entry);
                    const key = this._normalizePath(fullPath);
                    if (seen.has(key)) continue;
                    const fileEntry = {
                        name: entry,
                        path: fullPath,
                        isTopLevel: false,
                        category: 'synthesizable',
                    };
                    if (isSoftware) {
                        fileEntry.isSoftware = true;
                        addedSoftware++;
                    } else {
                        addedPersist++;
                    }
                    this.verilogFiles.push(fileEntry);
                    seen.add(key);
                }
            }
        }
        return { addedPersist, addedSoftware };
    }

    /**
     * Re-classifica cada arquivo Verilog (.v/.sv/.vh) de this.verilogFiles
     * como synth ou testbench, lendo o conteudo e decidindo via
     * heuristica ([verilog_classifier.js](verilog_classifier.js)).
     * Substitui o antigo toggle manual: a categoria e sempre derivada
     * do conteudo, nunca de uma marca persistida pelo usuario.
     *
     * Roda a cada load/refresh e em todo import — editar um .v e
     * transforma-lo em testbench faz ele se reclassificar sozinho no
     * proximo refresh.
     *
     * Arquivos software (.cmm/.asm) sao pulados — nao sao Verilog.
     * Quando a categoria de um arquivo muda, sua marca isTopLevel e
     * limpa: um synth top nao e a mesma coisa que um testbench top.
     * Se o conteudo nao puder ser lido, a categoria atual e mantida
     * (ou 'synthesizable' como default seguro).
     *
     * Devolve true se ALGUM arquivo mudou de categoria — o caller usa
     * pra decidir se precisa re-persistir o .spf.
     */
    async _classifyAll() {
        let changed = false;
        for (const file of this.verilogFiles) {
            if (file.isSoftware) continue;
            // .py files (cocotb testbenches) sao sempre testbench — nao
            // ha conteudo Verilog pra classificar.
            if (this.getFileExtension(file.name || file.path || '') === '.py') {
                if (file.category !== 'testbench') {
                    file.category = 'testbench';
                    file.isTopLevel = false;
                    changed = true;
                }
                continue;
            }
            // isTopLevel is an explicit user choice (set via context menu or AI tool).
            // Auto-classification must not override it — that would silently undo the
            // user's intent every time the tree refreshes. Category is locked to
            // whatever the user chose when they marked the file.
            if (file.isTopLevel) continue;
            let content;
            try {
                content = await window.electronAPI.readFile(file.path);
            } catch (error) {
                console.warn(`Classifier: cannot read ${file.path}:`, error);
                if (!file.category) file.category = 'synthesizable';
                continue;
            }
            const category = classifyVerilogContent(content, file.name);
            // Regra atual: reclassifica TODOS (inclusive isTopLevel). Se
            // a categoria mudou — usuario editou o arquivo e a heuristica
            // virou de synth pra testbench ou vice-versa — a marca de
            // top do escopo anterior nao se aplica mais (synth-top e
            // tb-top sao escopos distintos), entao limpa isTopLevel.
            // Se a categoria continua igual, mantem isTopLevel intacto.
            // (Regra antiga skipava isTopLevel inteiro, o que travava a
            // categoria quando o conteudo mudava — Ctrl+S nao atualizava
            // o estado.)
            if (file.category !== category) {
                file.category = category;
                file.isTopLevel = false;
                changed = true;
            }
        }
        return changed;
    }

    // ----- lifecycle ---------------------------------------------------

    /**
     * Reset state transiente. Chamado por close_project pra que
     * reabrir dispare uma ativacao limpa contra o novo ProjectStore
     * em vez do early-return branch com dados stale.
     */
    reset() {
        this.isTreeActive = false;
        this.verilogFiles = [];
        // Tree DOM is already cleared by clearProjectInterface in
        // close_project.js; nothing to do here.
    }

    /**
     * Alias historico — refreshTree() faz tudo agora (setup idempotente
     * + load + render). Mantido pra nao quebrar callers existentes
     * (projectManager.loadProject, fileTreeManager.initializeTreeBasedOnMode).
     */
    async activateTree() {
        return this.refreshTree();
    }

    /**
     * UNICO entry point pra atualizar a tree. Coalesce concorrencia
     * via _refreshPromise + pending flag, faz setup idempotente
     * (DOM cache wait, project path discovery, isTreeActive flag,
     * view switch) e roda loadConfiguration + renderTree em loop ate
     * o estado estabilizar.
     *
     * Antes existia activateTree separada, mas seu corpo virou
     * essencialmente "setup once + refresh". Cada operacao do setup
     * e idempotente (initPromise resolve uma vez; setar isTreeActive=
     * true duas vezes e no-op; showFileMode reaplica o mesmo
     * data-active-view). Como activateTree e refreshTree tinham
     * locks SEPARADOS (_activatePromise vs _refreshPromise), eles
     * podiam rodar loadConfiguration em paralelo — e o segundo
     * fazia `this.verilogFiles = []` em cima dos pushes do primeiro,
     * duplicando entries de software files. Consolidacao mata essa
     * classe de race.
     */
    async refreshTree() {
        if (this._refreshPromise) {
            this._refreshPending = true;
            return this._refreshPromise;
        }

        this._refreshPromise = (async () => {
            // ----- Setup idempotente -----
            // Espera cacheElements() ter rodado. Apos a primeira
            // resolucao, initPromise vira no-op.
            if (this.initPromise) {
                try { await this.initPromise; } catch (_) { /* init logs its own errors */ }
            }

            // Descobre o project path se loadProject ainda nao rodou
            // (raro — startup com restoreLastSession em voo). Skip
            // depois que setProject foi chamado.
            if (!ProjectStore.hasProject()) {
                try {
                    const projectData = await window.electronAPI.getCurrentProject();
                    const discoveredPath =
                        (projectData && typeof projectData === 'object' && projectData.projectPath) ||
                        (typeof projectData === 'string' ? projectData : null);
                    const discoveredSpf =
                        (projectData && typeof projectData === 'object' && projectData.spfPath) || null;
                    if (discoveredPath) {
                        ProjectStore.setProject(discoveredSpf, discoveredPath);
                    }
                } catch (error) {
                    console.error('Error getting project path:', error);
                }
            }

            // Sem projeto, bail sem renderizar. Nao seta isTreeActive
            // — proxima chamada (apos setProject) precisa fazer
            // setup full.
            if (!ProjectStore.hasProject()) {
                console.log('⏸ No project yet — deferring refresh');
                return;
            }

            const wasActive = this.isTreeActive;
            this.isTreeActive = true;
            if (!wasActive) {
                console.log('🚀 Activating Verilog tree...');
                console.log('📂 Project path:', ProjectStore.getProjectPath());
            }

            // ----- Loop de load + render -----
            do {
                this._refreshPending = false;
                console.log('🔄 Refreshing Verilog tree...');
                await this.loadConfiguration();
                this.renderTree();
            } while (this._refreshPending);

            // Switch a view visivel pra file mode — idempotente, mas so
            // tem efeito util na primeira ativacao. Via controller
            // (em vez de setActive direto) mantem _activeView dele em
            // sync, drives o label e direcao do toggle button.
            if (!wasActive) {
                window.fileTreeViewController?.showFileMode?.();
                console.log('✅ Verilog tree active with', this.verilogFiles.length, 'files');
            }
        })();

        try {
            await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
            this._refreshPending = false;
        }
    }

    // ----- persistencia ------------------------------------------------

    /**
     * Persiste no .spf via SpfStore.update. Mantem nome historico
     * (saveConfiguration). Snapshot ANTES do await pra evitar a
     * seguinte race:
     *
     *   SpfStore.update enfileira numa promise chain per-spf, entao
     *   o mutator nao roda ate qualquer update anterior settled.
     *   Ler `this.verilogFiles` de DENTRO do mutator era race:
     *   entre o click e o mutator firing, nosso proprio file watcher
     *   (file_tree_manager.js#onDirectoryChanged) ve o .spf mudar
     *   por um write anterior, dispara refreshTree, que chama
     *   loadConfiguration, que faz `this.verilogFiles = []` e recarrega
     *   do estado OLD em disco — apagando a mudanca em memoria que
     *   o usuario acabou de fazer. O mutator entao escreve o array
     *   (still old-state) e a marca de testbench se perde silenciosamente.
     *
     *   Construir o patch sincronamente aqui significa que o mutator
     *   e pura assignment; qualquer load/refresh em paralelo nao
     *   consegue backdate o dado que estamos prestes a persistir.
     */
    async saveConfiguration() {
        try {
            const spfPath = ProjectStore.getSpfPath();
            if (!spfPath) {
                console.error('Spf path not available for sync');
                return;
            }

            const buildEntry = (f) => ({
                name: f.name,
                path: f.path,
                isTopLevel: f.isTopLevel || false,
            });
            // Software files (.cmm/.asm de <proc>/Software/) nao entram
            // em synthesizableFiles nem testbenchFiles — sao codigo do
            // processador, nao Verilog. Sao auto-redescobertos no
            // proximo load.
            const synthFiles = this.verilogFiles
                .filter((f) => !f.isSoftware && f.category !== 'testbench')
                .map(buildEntry);
            const tbFiles = this.verilogFiles
                .filter((f) => !f.isSoftware && f.category === 'testbench')
                .map(buildEntry);
            const topFile = this.verilogFiles.find(
                (f) => f.isTopLevel && f.category !== 'testbench',
            );
            const tbTopFile = this.verilogFiles.find(
                (f) => f.isTopLevel && f.category === 'testbench',
            );
            const topPath = topFile ? topFile.path : '';
            const tbPath = tbTopFile ? tbTopFile.path : '';

            await SpfStore.update(spfPath, (cfg) => {
                cfg.synthesizableFiles = synthFiles;
                cfg.testbenchFiles = tbFiles;
                cfg.topLevelFile = topPath;
                cfg.testbenchFile = tbPath;
            });

            // O dropdown da .gtkw na toolbar mostra a lista do testbench
            // atual (per-tb). Marcar/trocar testbench muda esse contexto
            // — refresh pra repopular sem precisar recarregar o projeto.
            window.gtkwPickerManager?.refresh?.();

            // Status bar (zona direita) reflete topLevelFile/testbenchFile.
            // Mesmo spfPath, conteudo mudou — ProjectStore.subscribe nao
            // dispara aqui, precisa de chamada explicita.
            window.statusBarManager?.refresh?.();

            console.log('Saved configuration with categories');
        } catch (error) {
            console.error('Error saving configuration:', error);
        }
    }

    /**
     * Le o .spf e popula this.verilogFiles. Inclui auto-discovery dos
     * arquivos das pastas <proc>/{Hardware,Software,Simulation}/.
     *
     * Build da lista LOCALMENTE primeiro, only swap into
     * `this.verilogFiles` no fim. Duas razoes:
     *   1. Atomicidade pra observers externos — saveConfiguration
     *      tava racing contra um load in-progress que brevemente
     *      deixava verilogFiles=[].
     *   2. Se o load falha no meio (read error, parse error), o
     *      estado in-memory anterior sobrevive em vez de ficar
     *      half-wiped.
     */
    async loadConfiguration() {
        try {
            const spfPath = ProjectStore.getSpfPath();
            if (!spfPath) {
                console.error('Spf path not available');
                return;
            }

            const nextFiles = [];
            // Junta TODOS os paths que o .spf referencia mas o disco nao
            // tem mais, pra que renderTree mostre o card "missing files"
            // no topo e o usuario veja o que sumiu sem precisar abrir o
            // devtools. Limpa a cada loadConfiguration pra refletir o
            // estado atual (arquivo restaurado some da lista no proximo
            // refresh, sem precisar recarregar o projeto).
            this.missingFiles = [];

            const configData = await SpfStore.read(spfPath);
            console.log('Loading configuration from:', spfPath);

            if (Array.isArray(configData.synthesizableFiles)) {
                for (const fileData of configData.synthesizableFiles) {
                    if (!fileData.path || !fileData.name) continue;
                    try {
                        const exists = await window.electronAPI.fileExists(fileData.path);
                        if (exists) {
                            nextFiles.push({
                                name: fileData.name,
                                path: fileData.path,
                                isTopLevel: fileData.isTopLevel || false,
                                category: 'synthesizable',
                            });
                        } else {
                            console.warn(`File no longer exists: ${fileData.path}`);
                            this.missingFiles.push({
                                name: fileData.name,
                                path: fileData.path,
                                category: 'synthesizable',
                            });
                        }
                    } catch (error) {
                        console.error(`Error validating file ${fileData.path}:`, error);
                    }
                }
            }

            if (Array.isArray(configData.testbenchFiles)) {
                for (const fileData of configData.testbenchFiles) {
                    if (!fileData.path || !fileData.name) continue;
                    try {
                        const exists = await window.electronAPI.fileExists(fileData.path);
                        if (exists) {
                            // Backward-compat: um codepath antigo
                            // persistia a marca de testbench-top como
                            // `isMarkedTestbench`. Trata os dois como
                            // equivalentes na leitura; o proximo save
                            // normaliza pra `isTopLevel` so.
                            const isTop = fileData.isTopLevel === true
                                || fileData.isMarkedTestbench === true;
                            nextFiles.push({
                                name: fileData.name,
                                path: fileData.path,
                                isTopLevel: isTop,
                                category: 'testbench',
                            });
                        } else {
                            console.warn(`File no longer exists: ${fileData.path}`);
                            this.missingFiles.push({
                                name: fileData.name,
                                path: fileData.path,
                                category: 'testbench',
                            });
                        }
                    } catch (error) {
                        console.error(`Error validating file ${fileData.path}:`, error);
                    }
                }
            }

            console.log('Loaded', nextFiles.length, 'files from configuration');

            // Dedup por path normalizado (cross-platform, case-insensitive)
            // ANTES de atribuir. Bug historico em saveConfiguration pode
            // ter escrito o mesmo arquivo em synthesizableFiles e
            // testbenchFiles, ou um .cmm pode ter sido persistido em
            // synthesizableFiles por engano — ambos causam rows
            // duplicadas no DOM porque o reconciler do render usa
            // Map.set por path (sobrescreve, deixando a row "perdida"
            // orfa no DOM ate o proximo full clear).
            const dedupSeen = new Set();
            this.verilogFiles = [];
            for (const f of nextFiles) {
                const key = this._normalizePath(f.path);
                if (dedupSeen.has(key)) continue;
                dedupSeen.add(key);
                this.verilogFiles.push(f);
            }
            const dedupRemoved = nextFiles.length - this.verilogFiles.length;
            if (dedupRemoved > 0) {
                console.warn(`Dropped ${dedupRemoved} duplicate file entries from .spf`);
            }

            // Auto-descobre arquivos dentro das pastas Hardware/ e
            // Software/ de cada processador configurado. Hardware/
            // entra como synth e PRECISA ser persistido no .spf (e o
            // que o iverilog le). Software/ aparece na arvore mas nao
            // e persistido — sao re-descobertos a cada load.
            //
            // Persistir tambem os de Software causaria loop: o save
            // mudaria o mtime do .spf, o file watcher dispararia
            // refresh, refresh chamaria loadConfiguration, que re-
            // descobriria os mesmos Software files (porque o filtro
            // do save os exclui da .spf), e assim por diante. Por
            // isso so chamamos saveConfiguration quando algo
            // PERSISTIVEL (Hardware) foi adicionado.
            const { addedPersist } = await this._discoverProcessorFiles();

            // Categoria synth-vs-testbench e derivada do conteudo, nao
            // do .spf. Reclassifica tudo agora; se algo mudou de
            // categoria (ou se um arquivo persistivel foi descoberto),
            // re-persiste pra que synthesizableFiles/testbenchFiles do
            // .spf reflitam a deteccao.
            const reclassified = await this._classifyAll();

            this.sortFilesAlphabetically();
            // Re-persiste se: descobrimos arquivos novos no Hardware/,
            // a classificacao mudou, OU o dedup acima removeu entries
            // (o .spf tinha duplicates — escrever a versao limpa agora
            // para que proximas loads nao precisem dedup'ar de novo).
            if (addedPersist > 0 || reclassified || dedupRemoved > 0) {
                await this.saveConfiguration();
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    // ----- notifications -----------------------------------------------

    /**
     * Pass-through pro window.showNotification global. Fallback pra
     * console.log se o sistema de notificacoes ainda nao montou.
     */
    showNotification(message, type = 'info', duration = 3000) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, duration);
            return;
        }
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Mix render + actions no prototype. Ordem: render primeiro, actions
// depois (caso uma key colida — nao deveria, mas a precedencia ficaria
// com actions, mais perto da intencao do usuario).
Object.assign(ProjectTreeManager.prototype, RenderMixin, ActionsMixin);

// Singleton — handlers bindados pra esta instancia sao referenciados
// pelo addEventListener; nao recriar.
const projectTreeManager = new ProjectTreeManager();

// Window-exposed pra non-module callers (project_manager,
// close_project, file_tree_manager) que ainda lookam por nome.
window.projectTreeManager = projectTreeManager;

export { ProjectTreeManager, projectTreeManager };
