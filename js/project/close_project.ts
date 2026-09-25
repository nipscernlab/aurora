/**
 * close_project.ts: fechar o projeto aberto.
 *
 * O botao de fechar pergunta; o fluxo (fecharProjetoAberto) avisa o main,
 * fecha as abas, limpa a interface, esquece o projeto e o "ultimo aberto", e
 * reseta a arvore. O excluir projeto (delete_project.ts) usa o mesmo fluxo.
 *
 * Ate 25/09/2026 a limpeza tambem mexia em #processor-list, #editor,
 * #project-title e .project-action-button, que nao existem em pagina nenhuma,
 * e desligava uma lista de botoes que estava toda comentada. Sobrou o que
 * existe: a arvore, o nome do projeto e o indicador da barra.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from './project_store.js';
import { treeView } from '../tree/tree_view.js';
import { renderTreeEmptyState } from '../tree/file_tree_manager.js';
import { mostrarNomeDoProjeto, mostrarSemProjeto } from './interface_do_projeto.js';

// i18n shim, fallback pra key path se i18n nao bootou ainda.
const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A janela sem projeto: arvore vazia com o cartao de criar, nome e indicador. */
function limparInterfaceDoProjeto(): void {
    treeView.clearAll();
    treeView.setActive('verilog');
    // O cartao "clique para criar um projeto" na vista de arquivos, para o
    // painel nunca ficar em branco.
    renderTreeEmptyState();
    mostrarNomeDoProjeto(null, null);
    mostrarSemProjeto();
}

document.addEventListener('DOMContentLoaded', () => {
    const closeButton = document.querySelector<HTMLButtonElement>('#close-button');

    if (!closeButton) return;

    closeButton.addEventListener('click', async () => {
        
        // 1. Replace native confirm with custom dialog
        const userChoice = await showDialog({
            title: tr('dialog.closeProject.title'),
            message: tr('dialog.closeProject.message'),
            buttons: [
                { label: tr('dialog.closeProject.cancel'),  action: 'cancel',  type: 'cancel' },
                { label: tr('dialog.closeProject.confirm'), action: 'confirm', type: 'save'   }
            ]
        });

        if (userChoice !== 'confirm') {
            return;
        }

        closeButton.disabled = true;
        closeButton.style.cursor = 'not-allowed';

        try {
            await fecharProjetoAberto();
        } finally {
            closeButton.disabled = false;
            closeButton.style.cursor = 'pointer';
        }
    });
});


/**
 * Fecha o projeto aberto nesta janela, do jeito que o botao de fechar fecha:
 * avisa o main, fecha as abas (o que para os vigias), limpa a interface e
 * esquece o "ultimo projeto" do arranque. Sem dialogo: a confirmacao e de
 * quem chama. Exportada porque excluir um projeto (delete_project.js) precisa
 * fechar ANTES de mandar a pasta para a Lixeira, e fechar de outro jeito
 * deixaria descritor aberto e a pasta presa.
 *
 * @returns true se o projeto foi fechado
 */
export async function fecharProjetoAberto(): Promise<boolean> {
    let fechou = false;
    try {
        const result = await electronAPI.closeProject();

        if (result.success) {
            fechou = true;
            // Close all open tabs properly using TabManager
            // This ensures watchers are stopped and UI state is cleared
            const openFiles = Array.from(TabManager.tabs?.keys() ?? []);
            for (const file of openFiles) {
                await TabManager.closeTab(file);
            }

            limparInterfaceDoProjeto();

            // A fonte unica do projeto aberto.
            ProjectStore.clearProject();

            // Forget the last-opened project so the next Aurora launch
            // doesn't auto-reopen what we just closed. The path lives
            // in localStorage (`aurora-last-project-path`); we route
            // through appInitializer instead of touching the key
            // directly so the storage shape stays owned by one module.
            (window.appInitializer as { clearLastProject?(): unknown } | undefined)?.clearLastProject?.();

            // Reset do verilog tree pra que reabrir dispare um
            // re-activate full (le o .spf fresco,
            // pega arquivos fora da pasta do projeto). Sem isso,
            // isTreeActive fica true e o proximo activate
            // cai no early-return.
            window.projectTreeManager?.reset?.();

            window.SplitEditorManager?.refreshLayout?.();
        } else {
            console.error('Failed to close project:', result.error);
            
            // 2. Replace native alert (Error) with custom dialog
            await showDialog({
                title: tr('dialog.closeProject.errorTitle'),
                message: tr('dialog.closeProject.errorMessage', { reason: result.error }),
                buttons: [
                    { label: tr('dialog.common.ok'), action: 'ok', type: 'cancel' }
                ]
            });
        }
    } catch (error) {
        console.error('An unexpected error occurred while closing the project:', error);
        
        // 3. Replace native alert (Exception) with custom dialog
        await showDialog({
            title: tr('dialog.closeProject.unexpectedTitle'),
            message: tr('dialog.closeProject.unexpectedMessage'),
            buttons: [
                { label: tr('dialog.common.ok'), action: 'ok', type: 'cancel' }
            ]
        });
    }
    return fechou;
}
