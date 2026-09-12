/**
 * delete_project.js: excluir o projeto aberto, mandando a pasta para a Lixeira.
 *
 * O gesto mora no menu de reticencias do cabecalho da arvore, junto de
 * "fechar projeto", e exige um projeto aberto NESTA janela. A ordem e fixa:
 *
 *   1. confirmar, num dialogo cujo botao de confirmar so libera depois de uma
 *      contagem de cinco segundos (5, 4, 3, 2, 1). Nao e enfeite: e o tempo
 *      de ler o caminho que vai embora e desistir, e o unico freio real para
 *      um clique dado no lugar errado do menu;
 *   2. fechar o projeto pelo MESMO fluxo do botao de fechar (abas, vigias,
 *      interface), porque uma pasta com arquivo aberto nao se move no
 *      Windows;
 *   3. pedir ao processo principal que mande a pasta para a Lixeira. Ele so
 *      aceita o projeto que esta janela acabou de fechar, e insiste algumas
 *      vezes enquanto os descritores caem;
 *   4. tirar dos recentes e avisar. Sem "apagado": foi para a Lixeira, e da
 *      para voltar por la.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';
import { showCardNotification } from '../ui/notification.js';
import { fecharProjetoAberto } from './close_project.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

/** Segundos de contagem antes de o botao de confirmar liberar. */
export const SEGUNDOS_DE_ESPERA = 5;

export function ligarExcluirProjeto() {
    const botao = document.getElementById('delete-project');
    if (!botao || botao.dataset.ligado === '1') return;
    botao.dataset.ligado = '1';
    botao.addEventListener('click', () => { excluirProjetoAberto().catch((e) => console.error('delete project:', e)); });
}

/** O fluxo inteiro. Devolve true se a pasta foi para a Lixeira. */
export async function excluirProjetoAberto() {
    const spf = window.currentSpfPath || window.ProjectStore?.getSpfPath?.() || '';
    if (!spf) {
        showCardNotification(tr('notification.project.noneToDelete'), 'info', 3000);
        return false;
    }
    const pasta = String(spf).replace(/[\\/][^\\/]+$/, '');

    const escolha = await showDialog({
        title: tr('dialog.deleteProject.title'),
        message: tr('dialog.deleteProject.message', { path: escapar(pasta) }),
        variant: 'warning',
        buttons: [
            { label: tr('dialog.deleteProject.cancel'), action: 'cancel', type: 'cancel' },
            { label: tr('dialog.deleteProject.confirm'), action: 'trash', type: 'danger', countdown: SEGUNDOS_DE_ESPERA },
        ],
    });
    if (escolha !== 'trash') return false;

    // 2. Fecha como o botao de fechar fecha. Sem isto a pasta esta em uso.
    const fechou = await fecharProjetoAberto();
    if (!fechou) {
        showCardNotification(tr('notification.project.trashFailed', { reason: tr('notification.project.couldNotClose') }), 'error', 6000);
        return false;
    }

    // 3. A Lixeira, pelo processo principal.
    const r = await electronAPI.trashProject?.(spf);
    if (!r || !r.success) {
        showCardNotification(tr('notification.project.trashFailed', { reason: (r && r.message) || '?' }), 'error', 8000);
        return false;
    }

    // 4. Recentes e aviso.
    try { window.recentProjectsManager?.removeProject?.(spf); } catch (_) { /* lista ausente */ }
    showCardNotification(tr('notification.project.trashed', { path: escapar(pasta) }), 'success', 6000);
    return true;
}

function escapar(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarExcluirProjeto);
    else ligarExcluirProjeto();
}
