/**
 * tree_selection.js: o que um clique faz com a seleção da árvore.
 *
 * Antes havia um caminho selecionado e só. Com Ctrl e Shift são vários, e a
 * regra de qual clique produz qual conjunto é onde este tipo de código
 * costuma errar em silêncio: o Shift precisa de uma âncora que não é o último
 * item selecionado, e sim o último clicado SEM Shift, senão arrastar o
 * intervalo para cima e para baixo vai comendo a seleção em vez de crescer e
 * encolher a partir do mesmo ponto.
 *
 * As regras, iguais às do VS Code e do Explorer do Windows:
 *
 *   clique               troca a seleção pelo item, e ele vira a âncora
 *   Ctrl+clique          alterna o item, e ele vira a âncora
 *   Shift+clique         seleciona da âncora até o item, trocando a seleção
 *   Ctrl+Shift+clique    soma esse intervalo ao que já estava selecionado
 *
 * "Da âncora até o item" é na ordem em que as linhas aparecem na tela, que é a
 * ordem do DOM: uma pasta fechada esconde os filhos, e o intervalo tem que
 * pular o que está escondido, senão o usuário apaga o que não estava vendo.
 * Por isso a lista de visíveis entra por parâmetro.
 *
 * Puro: entra estado, sai estado. Sem DOM e sem disco, para ter teste.
 */

/** Comparação de caminho tolerante a barra e a maiúscula (Windows). */
function chave(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase();
}

/**
 * O conjunto selecionado depois de um clique.
 *
 * @param {object} entrada
 * @param {string[]} entrada.visible caminhos das linhas visíveis, na ordem da tela
 * @param {string[]} entrada.selected seleção atual
 * @param {string|null} entrada.anchor âncora atual (último clique sem Shift)
 * @param {string} entrada.path caminho clicado
 * @param {boolean} [entrada.ctrl] Ctrl (ou Cmd) pressionado
 * @param {boolean} [entrada.shift] Shift pressionado
 * @returns {{ selected: string[], anchor: string|null }}
 */
export function nextSelection({ visible, selected, anchor, path, ctrl = false, shift = false }) {
    const lista = Array.isArray(visible) ? visible : [];
    const atual = Array.isArray(selected) ? selected : [];

    if (!path) return { selected: atual, anchor: anchor ?? null };

    if (shift) {
        // Sem âncora não há intervalo: o Shift no primeiro clique da sessão
        // seleciona só o item, como faz o Explorer.
        const base = anchor && lista.some((p) => chave(p) === chave(anchor)) ? anchor : null;
        if (!base) return { selected: [path], anchor: path };

        const i = lista.findIndex((p) => chave(p) === chave(base));
        const j = lista.findIndex((p) => chave(p) === chave(path));
        // O item clicado sumiu da tela entre o clique e aqui (um vigia de
        // diretório redesenhou): trata como clique simples em vez de devolver
        // um intervalo inventado.
        if (i < 0 || j < 0) return { selected: [path], anchor: path };

        const intervalo = lista.slice(Math.min(i, j), Math.max(i, j) + 1);
        // A âncora NÃO se move no Shift: é o que permite crescer e encolher o
        // intervalo a partir do mesmo ponto.
        if (!ctrl) return { selected: intervalo, anchor: base };

        const uniao = [...atual];
        const vistos = new Set(atual.map(chave));
        for (const p of intervalo) {
            if (!vistos.has(chave(p))) { uniao.push(p); vistos.add(chave(p)); }
        }
        return { selected: uniao, anchor: base };
    }

    if (ctrl) {
        const k = chave(path);
        const tinha = atual.some((p) => chave(p) === k);
        const novo = tinha ? atual.filter((p) => chave(p) !== k) : [...atual, path];
        return { selected: novo, anchor: path };
    }

    return { selected: [path], anchor: path };
}

/**
 * A seleção depois de a árvore mudar no disco: fica quem ainda existe.
 *
 * Chamado depois de cada desenho. Sem isto, um caminho apagado continuaria na
 * seleção e a próxima operação em lote tentaria mexer nele.
 *
 * @param {string[]} selected
 * @param {string[]} visible caminhos que existem agora
 * @returns {string[]}
 */
export function pruneSelection(selected, visible) {
    const vivos = new Set((visible || []).map(chave));
    return (selected || []).filter((p) => vivos.has(chave(p)));
}

/**
 * Tira da lista todo caminho que já está coberto por uma pasta também
 * selecionada. Mover ou apagar a pasta já leva o filho junto, e operar nos
 * dois seria mexer duas vezes no mesmo arquivo: a segunda falharia, porque
 * depois da primeira ele não está mais lá.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export function topMostPaths(paths) {
    const lista = (paths || []).filter(Boolean);
    return lista.filter((p) => {
        const filho = chave(p);
        return !lista.some((outro) => {
            const pai = chave(outro);
            return pai !== filho && filho.startsWith(pai + '/');
        });
    });
}
