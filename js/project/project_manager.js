// project_manager.js

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { fileTreeManager } from '../tree/file_tree_manager.js';
import { showDialog } from '../ui/dialog_manager.js';
import { ProjectStore } from './project_store.js';
import { setAvailableProcessors } from './processor_list.js';
import { abrirRelatorioDeFaltantes, apagarRelatorioDeFaltantes } from './arquivos_faltando.js';
import {
    habilitarBotoesDoProjeto, ligarIndicadorDeProjeto, mostrarInformacaoDoProjeto, mostrarNomeDoProjeto,
} from './interface_do_projeto.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

// O nome do projeto, os botoes, o indicador da barra e o dialogo de
// informacoes moram em interface_do_projeto.ts; o relatorio dos arquivos que
// sumiram do disco, em arquivos_faltando.ts.

/**
 * Load project with full orchestration
 */
async function loadProject(spfPath) {
    try {
        const result = await electronAPI.openProject(spfPath);

        if (!result || result.success === false) {
            const msg = (result && result.message) || 'Could not open project.';
            throw new Error(msg);
        }

        // Tolerância: result.projectData pode vir com forma variável dependendo
        // da versão do main.js. Tenta múltiplos caminhos antes de falhar.
        const projectData = result.projectData || result.data || {};

        // A RAIZ E ONDE O .spf ESTA, e nao o que esta escrito dentro dele.
        //
        // Defesa em profundidade, e nao o conserto de um defeito: o main JA
        // relocaliza o .spf ao abrir (main/ipc/project.js, `deepRemapPaths` +
        // a regravacao de `basePath`), entao o que chega aqui costuma estar
        // certo. Esta ordem existe para o caso em que nao esteja.
        //
        // A ordem ANTERIOR lia `structure.basePath` primeiro e deixava a pasta
        // do proprio .spf como ULTIMO recurso, o que e ler a verdade pela copia.
        // O caminho do .spf e o unico dado aqui que nao pode estar errado: ele
        // veio de a pessoa ter acabado de abrir AQUELE arquivo. O que esta
        // gravado dentro e, na melhor hipotese, uma copia velha dele.
        const raizDoSpf = typeof spfPath === 'string'
            ? spfPath.replace(/[\\/][^\\/]+\.spf$/i, '')
            : null;
        const basePath =
            raizDoSpf ||
            projectData.structure?.basePath ||
            projectData.basePath ||
            projectData.metadata?.projectPath ||
            null;

        if (!basePath) {
            throw new Error(window.t ? window.t('error.config.noProjectBase') : 'Project base path could not be determined.');
        }

        // A fonte unica do projeto aberto.
        ProjectStore.setProject(spfPath, basePath);

        // Clean slate BEFORE the new tree loads. A direct project→project
        // switch (e.g. clicking another project in the recents list / welcome
        // screen) doesn't pass through close_project, so the previous project's
        // in-memory file list and its rendered rows would otherwise still be
        // present while the new .spf loads, surfacing the old project's
        // imported files in the new one. reset() wipes both.
        window.projectTreeManager?.reset?.();

        // Seed the global processor list from the IPC payload BEFORE the file
        // tree renders. Without this, processor folders render as plain
        // directories and only pick up their per-processor color/trash icon
        // after a manual refresh (e.g. opening Settings). Tolerant to either
        // shape: array of { name } objects or array of strings.
        // Seed da lista de processadores a partir do .spf. setAvailableProcessors
        // ja faz dedup case-insensitive e normaliza entries string-only
        // ({name} vs "name"), ver processor_list.js.
        setAvailableProcessors(projectData?.structure?.processors);

        mostrarNomeDoProjeto(projectData, spfPath);
        await TabManager.closeAllTabs();

        // Tree e sempre populada do .spf via
        // projectTreeManager. A coalescencia interna em
        // activateTree garante que isso + a chamada de
        // fileTreeManager.initializeTreeBasedOnMode nao gerem duplo
        // loadConfiguration (ver ARCHITECTURE.md §6).
        if (window.projectTreeManager) {
            await window.projectTreeManager.activateTree();
        }
        fileTreeManager.watcher?.startWatching?.(ProjectStore.getProjectPath());

        if (window.recentProjectsManager) {
            window.recentProjectsManager.addProject(spfPath);
        }

        // Enable buttons and update status
        habilitarBotoesDoProjeto();

        // Save as last opened project
        if (window.appInitializer) {
            window.appInitializer.saveCurrentProject(spfPath);
        }

        // Tell the split/welcome layout that a project is now active so the
        // welcome overlay disappears even when no file has been auto-opened.
        window.SplitEditorManager?.refreshLayout?.();

        // Repopulate the toolbar's .gtkw picker against the just-loaded
        // project's gtkwFiles[]. No-op if the picker hasn't initialized
        // yet (e.g. PRISM window without that toolbar element).
        window.gtkwPickerManager?.refresh?.();

        // Force-refresh internal state subscribers (status bar, processor
        // config panel, etc) ate o final do load. ProjectStore.subscribe ja
        // dispara em setProject, mas componentes que so escutam
        // aurora:spf-changed (mudanca de structure, nao de spfPath) ficam
        // stale ate alguma escrita acontecer. Sintetizar o evento aqui
        // garante que variaveis derivadas do .spf (testbenchFile,
        // topLevelFile, processors, etc) sejam reaplicadas a cada abertura
        //, fix pro caso "abri o projeto e a status bar / picker / panel
        // mostraram o estado do projeto anterior".
        window.dispatchEvent(new CustomEvent('aurora:spf-changed', {
            detail: { spfPath, source: 'project-loaded' },
        }));

        // Re-aplica o highlight do arquivo focado AGORA: closeAllTabs acima
        // limpou todas as tabs, entao TabManager.getEditingFilePath retorna
        // null e a row destacada do projeto anterior precisa limpar.
        window.projectTreeManager?.refreshEditorFocusHighlight?.();

        // Surface arquivos faltantes via notification + log file no Monaco.
        // O card no topo da tree e o canal principal, a notification
        // confirma pro usuario que algo aconteceu, e o log file aberto no
        // Monaco da pro usuario a lista completa pronta pra copiar/buscar.
        const missing = window.projectTreeManager?.missingFiles;
        if (Array.isArray(missing) && missing.length > 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification(
                    tr('fileTree.missingFiles.notification', { count: missing.length }),
                    'warning',
                    5000,
                );
            }
            try {
                await abrirRelatorioDeFaltantes(missing, spfPath, basePath);
            } catch (logErr) {
                console.warn('Failed to open missing-files log:', logErr);
            }
        } else {
            // Cleanup: remove o .aurora-missing-files.log de runs
            // anteriores se nao tem mais nada faltando. Sem isso, o
            // usuario corrige tudo e o log fica grudado no projeto.
            try {
                await apagarRelatorioDeFaltantes(basePath);
            } catch (cleanupErr) {
                console.warn('Failed to remove stale missing-files log:', cleanupErr);
            }
        }

    } catch (error) {
        console.error('Error loading project:', error);
        try {
            await showDialog({
                title: tr('dialog.project.loadErrorTitle'),
                message: tr('dialog.project.loadErrorMessage', { error: error.message }),
                buttons: [{ label: tr('dialog.common.ok'), action: 'close', type: 'cancel' }]
            });
        } catch (dialogErr) {
            console.error('showDialog failed:', dialogErr);
        }
    }
}

class ProjectManager {
    initialize() {
        // Listener para o botão "Open Project" da UI principal
        document.getElementById('openProjectBtn')?.addEventListener('click', async () => {
            const result = await electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        // Listener para o botão da tela de boas-vindas
        document.getElementById('openProjectBtnWelcome')?.addEventListener('click', async () => {
            const result = await electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        document.getElementById('projectInfo')?.addEventListener('click', async () => {
            const spfPath = ProjectStore.getSpfPath();
            if (!spfPath) return;
            try {
                const projectData = await electronAPI.getProjectInfo(spfPath);
                mostrarInformacaoDoProjeto(projectData);
            } catch (error) {
                console.error('Error getting project info:', error);
            }
        });

        document.getElementById('open-folder-button')?.addEventListener('click', () => {
            const raiz = ProjectStore.getProjectPath();
            if (raiz) electronAPI.openFolder(raiz);
        });

        // Listener para quando o projeto é aberto via "File > Open" ou atalhos
        electronAPI.onSimulateOpenProject(async (result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                await loadProject(result.filePaths[0]);
            }
        });

        // Duplo clique num .cmm ou .v associado no Windows. Abre o arquivo
        // solto no editor, sem projeto: um fonte avulso nao tem .spf para
        // carregar junto, e obrigar um projeto so para ler um arquivo seria
        // pior que abrir vazio.
        electronAPI.onOpenLooseFile?.(async ({ filePath }) => {
            if (!filePath) return;
            try {
                const content = await electronAPI.readFile(filePath);
                window.TabManager?.addTab?.(filePath, content ?? '');
            } catch (e) {
                console.warn('open-loose-file falhou:', e?.message || e);
            }
        });

        // Right-click numa cell do Prism abre o .v aqui no editor principal
        // na linha exata. Reusa o pipeline existente (readFile + TabManager
        // ou SplitEditorManager) pra parity com clique no file tree, depois
        // posiciona o cursor monaco via EditorManager.
        electronAPI.onOpenFileAt(async ({ filePath, line, column }) => {
            try {
                const ln  = Number.isInteger(line)   && line   > 0 ? line   : 1;
                const col = Number.isInteger(column) && column > 0 ? column : 1;
                const reveal = (editor) => {
                    if (editor && typeof editor.revealLineInCenter === 'function') {
                        // Defer to the next frame and lay the editor out first:
                        // when the pane/tab just became visible, revealLineInCenter
                        // computes scroll against a stale (zero-height) layout and
                        // the viewport never moves. layout() + rAF fixes the scroll.
                        requestAnimationFrame(() => {
                            editor.layout();
                            editor.setPosition({ lineNumber: ln, column: col });
                            editor.revealLineInCenter(ln);
                            editor.focus();
                        });
                    }
                };

                // Already open in the main pane → the editor exists, so jump now.
                if (window.TabManager?.tabs?.has(filePath)) {
                    window.TabManager.activateTab(filePath);
                    reveal(window.EditorManager?.getEditorForFile?.(filePath));
                    return;
                }

                const content = await electronAPI.readFile(filePath);
                const sem = window.SplitEditorManager;
                if (sem && sem.focusedPane > 0) {
                    await sem.openInFocusedPane(filePath, content);
                    // Split panes create their Monaco editor synchronously in
                    // openFile, so it's available right after the await.
                    const pane = sem.panes.find(p => p.paneIndex === sem.focusedPane);
                    reveal(pane?.tabs?.get(filePath)?.editor);
                } else {
                    // Main pane: the editor is created on a deferred (Monaco-
                    // ready-gated) path, so getEditorForFile() would be null
                    // right here. Hand the target line to addTab, which
                    // positions the editor the moment it's created, no race.
                    window.TabManager.addTab(filePath, content, {
                        preview: false,
                        revealPosition: { line: ln, column: col },
                    });
                }
            } catch (e) {
                console.error('Failed to open file at line from Prism:', e);
            }
        });

        // A simulacao do PRISM gravou um .vcd com os sinais do monitor e pede
        // para abri-lo no visualizador de ondas da casa: GTKWave ou Surfer,
        // aba ou janela, conforme a preferencia, o mesmo caminho do botao Wave.
        electronAPI.onOpenWave?.(async ({ vcdPath, modulo, sinais }) => {
            try {
                await window.compilationModule?.abrirOndaExterna(vcdPath, modulo, sinais);
            } catch (e) {
                console.error('Failed to open the PRISM simulation wave:', e);
            }
        });
    }

    // Método público para ser chamado pelo renderer.js (New Project)
    loadProject(spfPath) {
        return loadProject(spfPath);
    }
}

document.addEventListener('DOMContentLoaded', ligarIndicadorDeProjeto);

const projectManager = new ProjectManager();
export { projectManager };
