// file_tree_manager.ts
//
// O bootstrap da arvore de arquivos: o vigia da pasta do projeto, o botao de
// atualizar, o aviso de pasta sumida e o cartao de "nenhum projeto". As
// linhas de arquivo sao da vista de arquivos (file_mode.js), da hierarquia
// (compilation_module.js) e da vista de pastas (standard_tree_render.ts).
//
// Morava aqui um TreeViewState, fachada de compatibilidade sobre o
// file_tree_view_controller com metade dos metodos vazios; ninguem de fora o
// usava, e ele saiu em 25/09/2026, junto com um toggleHierarchyView sem
// chamador. Quem decide a vista e o controlador, chamado direto.

import { electronAPI } from '../app/electron_api.js';
import { showCardNotification } from '../ui/notification.js';
import { ProjectStore, type ProjectSnapshot } from '../project/project_store.js';
import { treeView } from './tree_view.js';
import { fileTreeViewController } from './file_tree_view_controller.js';
import { standardTreeRenderer } from './standard_tree_render.js';
import '../components/aurora-tree.js';
import { ligarMenuDoCabecalho } from './tree_header_menu.js';

// i18n com reserva em ingles, o mesmo padrao do standard_tree_crud.js: a
// mensagem vale mesmo que as traducoes ainda nao tenham carregado.
const tt = (k: string, fb: string): string => {
    const v = window.t ? window.t(k) : null;
    return v && v !== k ? v : fb;
};

/** A arvore de projeto (js/project/file_mode.js), so o que o bootstrap usa. */
interface ArvoreDoProjeto {
    refreshTree?(): unknown;
    activateTree?(): Promise<unknown>;
    initPromise?: Promise<unknown>;
}

const arvoreDoProjeto = (): ArvoreDoProjeto | undefined =>
    window.projectTreeManager as ArvoreDoProjeto | undefined;

// --- Empty-state placeholder ---------------------------------------
//
// "No project open" state → a click-to-create-project card. It renders
// into the verilog view subcontainer (the only file view now) and owns
// the whole pane. Intentionally one large tap target, the previous
// "empty file tree with just the header" left the user looking at a
// blank pane with no obvious next step.
//
// (The project-open-but-zero-processors hint is handled by the verilog
// view's own empty state in project_tree_render.js.)

function buildEmptyStateCard() {
    const tr = (k: string): string => (window.t ? window.t(k) : k);
    const config = {
        icon: 'ph ph-folder-plus',
        title: tr('fileTree.empty.noProjectTitle'),
        cta:   tr('fileTree.empty.noProjectCta'),
        onClick: () => {
            // The new-project modal is wired in index.html's inline
            // script via the trigger→modal map (newProjectBtn →
            // newProjectModal). Clicking the toolbar button keeps
            // every existing pre-condition (focus, store reset,
            // import-file priming) intact instead of forking a
            // second open path here.
            document.getElementById('newProjectBtn')?.click();
        },
    };

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tree-empty-state tree-empty-no-project';
    card.setAttribute('aria-label', config.title);
    card.innerHTML = `
        <span class="tree-empty-state-icon"><i class="${config.icon}" aria-hidden="true"></i></span>
        <span class="tree-empty-state-title">${escapeHtml(config.title)}</span>
        <span class="tree-empty-state-cta">${escapeHtml(config.cta)}</span>
    `;
    card.addEventListener('click', config.onClick);
    return card;
}

/**
 * Drop a full-replacement empty-state card into the verilog view
 * container (the active file view). Used for the "no project open"
 * state, there are no files to compete with, so the card owns the
 * whole pane. When a project later loads, renderTree() strips this
 * card before painting the file rows.
 */
function renderTreeEmptyState(): void {
    const container = treeView.getContainer('verilog');
    if (!container) return;
    container.innerHTML = '';
    container.appendChild(buildEmptyStateCard());
}


// Minimal escaper for the i18n strings we drop into innerHTML above.
function escapeHtml(s: unknown): string {
    const trocas: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s ?? '').replace(/[&<>"']/g, (ch) => trocas[ch]);
}


if (typeof window !== 'undefined') {
    // O close_project.js e um E2E ainda chamam por window.
    window.renderTreeEmptyState = renderTreeEmptyState;
}

// --- Directory Watcher ---
class DirectoryWatcher {
    currentWatchedDirectory: string | null = null;
    isWatching = false;

    async startWatching(directoryPath: string | null | undefined): Promise<void> {
        await this.stopWatching();
        if (!directoryPath) return;
        try {
            await electronAPI.watchDirectory(directoryPath);
            this.currentWatchedDirectory = directoryPath;
            this.isWatching = true;
        } catch (error) {
            console.error('Failed to start directory watching:', error);
        }
    }

    async stopWatching(): Promise<void> {
        if (this.currentWatchedDirectory && this.isWatching) {
            try {
                await electronAPI.stopWatchingDirectory(this.currentWatchedDirectory);
                this.currentWatchedDirectory = null;
                this.isWatching = false;
            } catch (error) {
                console.error('Failed to stop directory watching:', error);
            }
        }
    }
}

// --- Public Manager Object ---
class FileTreeManager {
    directoryWatcher = new DirectoryWatcher();

    initialize() {
        fileTreeViewController.showFileMode();

        document.getElementById('refresh-button')?.addEventListener('click', () => {
            if (fileTreeViewController.isShowingHierarchy()) return;
            if (fileTreeViewController.isShowingStandard()) {
                standardTreeRenderer.render();
                return;
            }
            arvoreDoProjeto()?.refreshTree?.();
        });

        // Hierarchy toggle e owned por file_tree_view_controller.js:
        // um unico click listener instalado la cuida do flip file ↔
        // hierarchy. Nao re-attachar aqui; ja tivemos dois listeners
        // brigando no mesmo botao.

        electronAPI.onDirectoryChanged((dir, _files) => {
            if (dir !== this.directoryWatcher.currentWatchedDirectory) return;
            if (fileTreeViewController.isShowingHierarchy()) return;
            // Standard (folder) view mirrors the disk, re-render it so
            // created/deleted files show up; the renderer restores the
            // currently-expanded folders.
            if (fileTreeViewController.isShowingStandard()) {
                standardTreeRenderer.render();
                return;
            }
            // Verilog view: re-le o .spf pra pegar processor creation/
            // deletion que reescreve o arquivo.
            arvoreDoProjeto()?.refreshTree?.();
        });

        // A pasta do projeto sumiu do disco enquanto ele estava aberto.
        //
        // A AURORA NAO trava a pasta, de proposito: segurar um descritor
        // aberto numa pasta no Windows e o que produz "nao foi possivel
        // excluir, o arquivo esta em uso", e a pasta e do usuario. O que cabe
        // aqui e parar de fingir que a arvore vale e dizer o que aconteceu,
        // uma vez, num card que nao some sozinho. Nada e fechado e nenhum
        // buffer e descartado: quem tiver trabalho nao salvo ainda pode
        // salva-lo noutro lugar.
        electronAPI.onDirectoryGone?.((dir) => {
            if (dir !== this.directoryWatcher.currentWatchedDirectory) return;
            console.warn('project folder is gone:', dir);
            showCardNotification(
                tt('fileTree.projectGone', 'The project folder is no longer on disk.'),
                'error', 0, tt('fileTree.projectGoneTitle', 'Project folder gone'),
            );
        });

        // Directory watcher errors used to be emitted by main but never
        // consumed (the renderer had no listener), the error was silently
        // lost. Mirror the file-watcher's handling: surface it to the console.
        electronAPI.onDirectoryWatcherError?.((dir, error) => {
            console.error(`Directory watcher error for ${dir}:`, error);
        });

        ligarMenuDoCabecalho();

        // Initialize tree based on saved mode
        this.initializeTreeBasedOnMode();
    }

    /**
     * Primeira pintura da tree: dispara o verilog picker assim que o
     * projectTreeManager terminou seu init.
     *
     * O nome "initializeTreeBasedOnMode" e historico (era um branch
     * sobre IDE mode). Modo unico hoje, chama activateTree
     * direto. A coalescencia em activateTree garante que isso
     * + projectManager.loadProject nao gerem duplo loadConfiguration.
     */
    async initializeTreeBasedOnMode(): Promise<void> {
        const ptm = arvoreDoProjeto();
        if (!ptm) return;
        // Espera o sinal REAL de readiness (DOMContentLoaded + cacheElements
        // + setupEventListeners, exposto como initPromise) em vez de chutar
        // 100ms. O sleep curto deixava activateTree rodar antes do DOM da
        // tree ser cacheado em cold start lento, e bailava silenciosamente.
        if (ptm.initPromise) await ptm.initPromise;
        await ptm.activateTree?.();
    }


    get watcher() {
        return this.directoryWatcher;
    }
}

const fileTreeManager = new FileTreeManager();
export { fileTreeManager, renderTreeEmptyState };


// --- Empty-state wiring ---------------------------------------------
//
// Two signals decide whether the no-project card belongs in the file
// view:
//
//   1. ProjectStore goes from "has project" to "no project" or vice
//      versa  →  swap between the no-project card and the live tree.
//   2. App boot with no auto-restored project  →  render the
//      no-project card immediately instead of leaving a blank pane.
//
// Both converge on `renderTreeEmptyState()` (no-project card) /
// projectTreeManager.refreshTree() (live tree), defined above /
// in file_mode.js. The "project open but zero processors" hint is
// owned by the verilog view's own empty state.
function bootstrapTreeEmptyStateWiring() {
    const onProjectChange = (snapshot: ProjectSnapshot) => {
        if (snapshot?.projectPath) {
            // Switched into a project, render the verilog tree so files
            // populate (it strips the no-project card on the way in).
            arvoreDoProjeto()?.refreshTree?.();
        } else {
            renderTreeEmptyState();
        }
    };

    ProjectStore.subscribe(onProjectChange);

    // Cold start with no project: paint the empty card immediately so
    // the user is never staring at a blank file-tree pane. Skipped
    // when a project auto-restore is in flight (signalled by the
    // localStorage key index.html's inline boot script reads), in
    // that case the user briefly sees the "Loading…" header and the
    // ProjectStore subscriber above will refresh into the live tree
    // once the IPC roundtrip lands.
    let willAutoRestore = false;
    try { willAutoRestore = !!localStorage.getItem('aurora-last-project-path'); }
    catch (_) { /* localStorage unavailable, treat as no restore */ }

    if (!ProjectStore.hasProject() && !willAutoRestore) {
        // Defer one tick so treeView has had a chance to mount its
        // subcontainers (initialize() runs on DOMContentLoaded).
        queueMicrotask(() => {
            if (!ProjectStore.hasProject()) renderTreeEmptyState();
        });
    } else if (!ProjectStore.hasProject() && willAutoRestore) {
        // Auto-restore in flight. When it settles without a project (the
        // stored .spf was moved, or loading failed), fall back to the empty
        // card so the user can create or open one. The signal is the
        // initializer's own "restore settled" event, not a clock: the old
        // three-second timer declared "no project" in the middle of loading a
        // big project on a slow disk, which invited creating another one on
        // top of it.
        document.addEventListener('aurora:session-restore-settled', () => {
            if (!ProjectStore.hasProject()) renderTreeEmptyState();
        }, { once: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapTreeEmptyStateWiring, { once: true });
} else {
    bootstrapTreeEmptyStateWiring();
}