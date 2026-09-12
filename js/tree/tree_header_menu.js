/**
 * tree_header_menu.js: o menu de reticencias do cabecalho da arvore.
 *
 * O cabecalho tinha sete icones do mesmo peso lado a lado, e "fechar projeto"
 * morava ao lado de "atualizar": a vizinhanca que produz clique errado. Tres
 * gestos frequentes ficam a vista (novo arquivo, buscar, recolher tudo) e os
 * quatro raros (atualizar, abrir no explorador, backup, fechar projeto) vao
 * para este menu.
 *
 * Os quatro continuam sendo os MESMOS elementos, com os mesmos ids: cada um
 * ja tem quem o escute (renderer, file_tree_manager, project_manager,
 * file_tree_toggler, close_project) e nada disso muda. Este modulo so abre e
 * fecha a caixa que os contem.
 */

/** Liga o botao de reticencias ao menu. Idempotente; sem os elementos, nao faz nada. */
export function ligarMenuDoCabecalho() {
    const botao = document.getElementById('tree-more');
    const menu = document.getElementById('tree-more-menu');
    if (!botao || !menu || botao.dataset.ligado === '1') return;
    botao.dataset.ligado = '1';

    const aberto = () => !menu.hidden;
    const fechar = () => {
        if (!aberto()) return;
        menu.hidden = true;
        botao.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', foraDoMenu, true);
        document.removeEventListener('keydown', teclas, true);
    };
    const abrir = () => {
        if (aberto()) return;
        menu.hidden = false;
        botao.setAttribute('aria-expanded', 'true');
        // Fecha ao clicar fora e no Escape. Captura, para vencer quem para a
        // propagacao no meio do caminho.
        document.addEventListener('pointerdown', foraDoMenu, true);
        document.addEventListener('keydown', teclas, true);
        menu.querySelector('[role="menuitem"]')?.focus?.();
    };
    const foraDoMenu = (e) => {
        if (menu.contains(e.target) || botao.contains(e.target)) return;
        fechar();
    };
    const teclas = (e) => {
        if (e.key === 'Escape') { fechar(); botao.focus(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const itens = [...menu.querySelectorAll('[role="menuitem"]')];
        if (!itens.length) return;
        const i = itens.indexOf(document.activeElement);
        const passo = e.key === 'ArrowDown' ? 1 : -1;
        itens[(i + passo + itens.length) % itens.length].focus();
        e.preventDefault();
    };

    botao.addEventListener('click', () => (aberto() ? fechar() : abrir()));
    botao.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aberto() ? fechar() : abrir(); }
    });
    // Escolher um item fecha o menu; a acao em si e de quem escuta o id.
    menu.addEventListener('click', (e) => {
        if (e.target.closest('[role="menuitem"]')) fechar();
    });
    menu.addEventListener('keydown', (e) => {
        const item = e.target.closest('[role="menuitem"]');
        if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); item.click(); }
    });
}
