/**
 * verilator_trace_rules.js: a selecao do picker vira regras de escopo no .vlt
 * do Verilator, para que ela limite o TAMANHO do dump e nao so o layout.
 *
 * Sob --binary o Verilator ignora os argumentos do $dumpvars e grava todo
 * sinal publico da hierarquia. O que ele respeita e o arquivo de configuracao
 * (.vlt), e o que foi PROVADO em 22/08/2026 com o Verilator 5.048 embarcado,
 * construindo o mediamovel dos testes de toolchain nove vezes:
 *
 *   - `tracing_off -scope "<caminho>"` precisa do caminho COMPLETO a partir do
 *     modulo de topo (`mediamovel_tb.proc.min`); `proc.min` nao faz nada.
 *   - Sem curinga: `mediamovel_tb.proc.*` desligou o proprio `proc` tambem.
 *   - Sem `-levels`: com 0 ou 1 ele desligou a subarvore inteira do mesmo
 *     jeito que sem o argumento.
 *   - Na composicao, a ULTIMA regra vence: `tracing_off` no pai seguido de
 *     `tracing_on` no filho mantem o filho; na ordem inversa, mata o filho.
 *
 * Dai o algoritmo: percorrer a arvore em pre-ordem (pai antes do filho) e
 * emitir uma regra so onde o estado muda em relacao ao pai. Um escopo esta
 * ligado quando ao menos um sinal selecionado mora nele; a granularidade e o
 * escopo, nao o sinal, porque e isso que o Verilator oferece.
 *
 * O escopo do testbench (a raiz) fica SEMPRE ligado e sem regra: seus sinais
 * sao poucos, e e nele que vivem os espelhos dos monitores de pilha e ULA,
 * dos quais os grupos Stack e ULA do layout automatico dependem.
 *
 * Puro: recebe a arvore de signal_parser.buildHierarchyTree e a selecao em
 * caminhos pontilhados; devolve as linhas do .vlt. Sem IO.
 */

/**
 * @typedef {{ scopePath: string, children: Node[] }} Node
 */

/**
 * @param {Node | null | undefined} tree raiz da hierarquia (o testbench)
 * @param {string[]} selectedSignals caminhos `escopo.sinal`, validados
 * @returns {string[]} linhas para o .vlt, na ordem em que devem ser escritas
 */
export function verilatorTraceRules(tree, selectedSignals) {
    if (!tree || !Array.isArray(selectedSignals) || selectedSignals.length === 0) return [];
    const ligados = new Set();
    for (const sinal of selectedSignals) {
        if (typeof sinal !== 'string') continue;
        const corte = sinal.lastIndexOf('.');
        if (corte > 0) ligados.add(sinal.slice(0, corte));
    }
    /** @type {string[]} */
    const regras = [];
    const visitar = (/** @type {Node} */ no, /** @type {boolean} */ paiLigado) => {
        const ligado = ligados.has(no.scopePath);
        if (ligado !== paiLigado) {
            regras.push(`tracing_${ligado ? 'on' : 'off'} -scope "${no.scopePath}"`);
        }
        for (const filho of no.children || []) visitar(filho, ligado);
    };
    for (const filho of tree.children || []) visitar(filho, true);
    return regras;
}

/**
 * Quantos escopos da arvore ficam ligados e desligados com a selecao, para a
 * linha do terminal. A raiz conta como ligada.
 * @param {Node | null | undefined} tree
 * @param {string[]} selectedSignals
 * @returns {{ ligados: number, desligados: number }}
 */
export function contarEscopos(tree, selectedSignals) {
    const ligados = new Set();
    for (const sinal of selectedSignals || []) {
        const corte = typeof sinal === 'string' ? sinal.lastIndexOf('.') : -1;
        if (corte > 0) ligados.add(sinal.slice(0, corte));
    }
    let on = 0;
    let off = 0;
    const visitar = (/** @type {Node} */ no, /** @type {boolean} */ raiz) => {
        if (raiz || ligados.has(no.scopePath)) on++; else off++;
        for (const filho of no.children || []) visitar(filho, false);
    };
    if (tree) visitar(tree, true);
    return { ligados: on, desligados: off };
}
