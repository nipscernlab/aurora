/**
 * file_mode.js — ProjectTreeManager (state + lifecycle + persistencia).
 *
 * Renderiza a file tree do projeto — a unica vista de arquivos que
 * Aurora mostra hoje. Lista arquivos a partir do .spf
 * (structure.synthesizableFiles + testbenchFiles + per-processador
 * Software/Hardware/Simulation auto-descoberto).
 *
 * Pontos de entrada externos:
 *   activateTree()  — chamada por projectManager.loadProject e por
 *                     fileTreeManager.initializeTreeBasedOnMode.
 *                     Coalescida via _activatePromise (ver
 *                     ARCHITECTURE.md §6).
 *   refreshTree()   — re-le o .spf e re-renderiza (idempotente;
 *                     key-based reconciler).
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
import { SpfStore } from './spf_store.js';
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
        this.ALLOWED_EXTENSIONS = ['.v', '.sv', '.vh'];
        // Extensoes "software" — moram em <proc>/Software/, nao em
        // Hardware/. Aparecem na arvore agrupadas com o processador,
        // mas nao recebem toggle synth/tb, delete, nem entram no
        // synthesizableFiles do .spf.
        this.SOFTWARE_EXTENSIONS = ['.cmm', '.asm'];

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
                // Plain row click → abre o arquivo numa tab.
                try {
                    const content = await window.electronAPI.readFile(file.path);
                    TabManager.addTab(file.path, content);
                } catch (err) {
                    console.error('Error opening file:', err);
                    this.showNotification(
                        window.t ? window.t('notification.fileMode.errorOpen', { name: file.name }) : `Error opening file: ${file.name}`,
                        'error',
                        3000,
                    );
                }
            });
        }

        this.elements.refreshButton?.addEventListener('click', () => {
            if (this.isTreeActive) {
                this.refreshTree();
            }
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
     * nao listado em this.verilogFiles como synth, e qualquer .cmm/
     * .asm como software (nao persistido). Devolve quantos de cada —
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
        //   .cmm / .asm      → software, isSoftware=true, NAO persistido
        //                       (re-descoberto a cada load pra evitar
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
            let content;
            try {
                content = await window.electronAPI.readFile(file.path);
            } catch (error) {
                console.warn(`Classifier: cannot read ${file.path}:`, error);
                if (!file.category) file.category = 'synthesizable';
                continue;
            }
            const category = classifyVerilogContent(content, file.name);
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
     * Ativa o file tree. Idempotente quanto a re-chamadas — coalesced
     * via _activatePromise pra que tres caminhos concorrentes
     * (projectManager.loadProject, fileTreeManager.initializeTreeBasedOnMode
     * e o atalho do construtor) nao rodem loadConfiguration em
     * paralelo (cada um zeraria verilogFiles e duplicaria entries).
     */
    async activateTree() {
        if (this._activatePromise) return this._activatePromise;

        this._activatePromise = (async () => {
            // Espera cacheElements() ter rodado. Sem isso, uma ativacao
            // programatica precoce pode chegar antes de init() resolver
            // e silenciosamente no-op em renderTree.
            if (this.initPromise) {
                try { await this.initPromise; } catch (_) { /* init logs its own errors */ }
            }

            if (this.isTreeActive) {
                // Ja ativa mas um novo projeto pode ter sido aberto —
                // refresh em vez de retornar uma tree stale.
                await this.refreshTree();
                return;
            }

            console.log('🚀 Activating Verilog tree...');

            // Descobre o project path se loadProject ainda nao rodou
            // (raro — acontece no startup quando restoreLastSession
            // esta em voo). Uma vez descoberto, empurra pro ProjectStore
            // pra que todos os consumers vejam o mesmo valor em vez
            // de cada um cachear uma copia.
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

            // STILL sem projeto depois do discover? Bail sem
            // renderizar. Se procedessemos, loadConfiguration faria
            // early-return no path faltante e renderTree pintaria uma
            // tree vazia — exatamente o flash "parece em branco, dai
            // os files popam" que o usuario ve no startup. A proxima
            // chamada de activate (project_manager.loadProject apos
            // setProject) ira completar este body.
            //
            // Critically, isTreeActive NAO e setado pra true aqui —
            // caso contrario a proxima chamada cairia no early-return
            // refresh e pularia a ativacao full que ainda precisamos.
            if (!ProjectStore.hasProject()) {
                console.log('⏸ No project yet — deferring activation to next call');
                return;
            }

            this.isTreeActive = true;

            console.log('📂 Project path:', ProjectStore.getProjectPath());

            // Carrega configuracao.
            await this.loadConfiguration();

            // Switch a view visivel pra file mode E renderiza no
            // subcontainer verilog numa chamada so. Via controller
            // (em vez de renderTree direto) mantem o _activeView dele
            // em sync — que drives o label do toggle button e a
            // direcao do click.
            window.fileTreeViewController?.showFileMode?.();

            console.log('✅ Verilog tree active with', this.verilogFiles.length, 'files');
        })();

        try {
            await this._activatePromise;
        } finally {
            this._activatePromise = null;
        }
    }

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
     * Re-le o .spf e re-renderiza. Coalesced igual a activateTree —
     * duas chamadas no mesmo tick (ex: project-config-saved + tab
     * event) zerariam verilogFiles e intercalariam pushes.
     *
     * Sem toast no fim: este metodo roda de quatro call sites, so um
     * e user-triggered (botao manual de refresh). Os outros tres
     * (ativacao inicial, project-config-saved, fs watcher) disparam
     * em open ou em background — toast la e ruido. Tree atualizando
     * visualmente ja e o feedback pro caso manual.
     */
    async refreshTree() {
        if (this._refreshPromise) return this._refreshPromise;

        this._refreshPromise = (async () => {
            console.log('🔄 Refreshing Verilog tree...');
            await this.loadConfiguration();
            this.renderTree();
        })();

        try {
            await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
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
                        }
                    } catch (error) {
                        console.error(`Error validating file ${fileData.path}:`, error);
                    }
                }
            }

            console.log('Loaded', nextFiles.length, 'files from configuration');

            this.verilogFiles = nextFiles;

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
            if (addedPersist > 0 || reclassified) {
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
