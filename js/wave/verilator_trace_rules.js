/**
 * verilator_trace_rules.js: o que o usuario pediu para gravar vira regras de
 * escopo no .vlt do Verilator, para que o pedido limite o TAMANHO do dump e
 * nao so o layout.
 *
 * Sob --binary (e sob o cocotb) o Verilator ignora os argumentos do $dumpvars
 * e grava todo sinal publico da hierarquia. O que ele respeita e o arquivo de
 * configuracao (.vlt), e isto e o que foi PROVADO em 22/08/2026 com o
 * Verilator 5.048 embarcado, construindo o mediamovel dos testes de toolchain
 * doze vezes, pelo fluxo nativo e pelo cocotb:
 *
 *   - `tracing_off -scope "<caminho>"` precisa do caminho COMPLETO a partir do
 *     modulo de topo (`mediamovel_tb.proc.min`); `proc.min` nao faz nada. No
 *     cocotb a raiz e o modulo de topo do HDL, sem o prefixo TOP do dump.
 *   - Sem curinga: `mediamovel_tb.proc.*` desligou o proprio `proc` tambem.
 *   - Sem `-levels`: com 0 ou 1 ele desligou a subarvore inteira do mesmo
 *     jeito que sem o argumento.
 *   - Na composicao, a ULTIMA regra vence: `tracing_off` no pai seguido de
 *     `tracing_on` no filho mantem o filho; na ordem inversa, mata o filho.
 *   - No cocotb o .vlt entra pelos argumentos de build, nao pela lista de
 *     fontes, que o runner recusa por nao saber o tipo do arquivo.
 *
 * Dai o algoritmo: decidir quais escopos ficam ligados, percorrer a arvore em
 * pre-ordem (pai antes do filho) e emitir uma regra so onde o estado muda em
 * relacao ao pai. A granularidade e o escopo, nao o sinal, porque e isso que
 * o Verilator oferece: um escopo ligado grava todos os seus sinais publicos.
 *
 * Tres origens de pedido, as mesmas do fluxo Icarus:
 *   - a selecao do picker (Wave Configuration ou .gtkw ativo): liga o escopo
 *     de cada sinal selecionado;
 *   - o testbench com $dumpvars proprio (o gerado pelo yanc, por exemplo):
 *     cada chamada e lida; `$dumpvars(0, x)` com x escopo liga a subarvore,
 *     `$dumpvars(1, x)` liga so x, e x sinal liga o escopo dele. Uma chamada
 *     sem argumentos, ou uma referencia que a arvore nao conhece, desiste das
 *     regras e grava tudo, porque cortar no escuro esconderia o que o usuario
 *     pediu;
 *   - o padrao da AURORA, `$dumpvars(1, tb)`: so o escopo do testbench.
 *
 * A raiz fica SEMPRE ligada e sem regra: seus sinais sao poucos, e e nela que
 * vivem os espelhos dos monitores de pilha e ULA, dos quais os grupos Stack e
 * ULA do layout automatico dependem.
 *
 * Puro: recebe a arvore de signal_parser.buildHierarchyTree; devolve linhas
 * do .vlt. Sem IO.
 */

/**
 * @typedef {{ name: string }} Sinal
 * @typedef {{ scopePath: string, signals?: Sinal[], children: Node[] }} Node
 * @typedef {{ signals?: string[], scopes?: string[], subtrees?: string[] }} Pedido
 *   signals: caminhos `escopo.sinal`, ligam o escopo; scopes: escopos ligados
 *   sozinhos; subtrees: escopos ligados com tudo abaixo.
 */

/**
 * Resolve o pedido num conjunto de escopos ligados, com a raiz sempre dentro.
 * @param {Node | null | undefined} tree
 * @param {Pedido} pedido
 * @returns {Set<string>}
 */
function escoposLigados(tree, pedido) {
    const ligados = new Set();
    if (!tree) return ligados;
    ligados.add(tree.scopePath);
    for (const s of pedido.signals || []) {
        if (typeof s !== 'string') continue;
        const corte = s.lastIndexOf('.');
        if (corte > 0) ligados.add(s.slice(0, corte));
    }
    for (const s of pedido.scopes || []) if (typeof s === 'string') ligados.add(s);
    const subarvores = new Set((pedido.subtrees || []).filter((s) => typeof s === 'string'));
    const visitar = (/** @type {Node} */ no, /** @type {boolean} */ dentro) => {
        const agora = dentro || subarvores.has(no.scopePath);
        if (agora) ligados.add(no.scopePath);
        for (const filho of no.children || []) visitar(filho, agora);
    };
    visitar(tree, false);
    return ligados;
}

/**
 * As linhas do .vlt para um pedido. Vazio quando nao ha o que cortar.
 * @param {Node | null | undefined} tree raiz da hierarquia
 * @param {Pedido | string[]} pedido um array e tratado como `signals`
 * @returns {string[]}
 */
export function verilatorTraceRules(tree, pedido) {
    const p = Array.isArray(pedido) ? { signals: pedido } : (pedido || {});
    const vazio = !(p.signals || []).length && !(p.scopes || []).length && !(p.subtrees || []).length;
    if (!tree || vazio) return [];
    const ligados = escoposLigados(tree, p);
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
 * O padrao da AURORA sem selecao: `$dumpvars(1, tb)`, so o escopo do
 * testbench. Sob Verilator isso e desligar cada filho da raiz.
 * @param {Node | null | undefined} tree
 * @returns {string[]}
 */
export function defaultScopeRules(tree) {
    if (!tree) return [];
    return (tree.children || []).map((filho) => `tracing_off -scope "${filho.scopePath}"`);
}

/**
 * Le as chamadas `$dumpvars(...)` de um fonte Verilog (comentarios ja
 * descontados pelo chamador ou nao; a regex ignora o que nao parece chamada).
 * @param {string} src
 * @returns {{ calls: Array<{ level: number, refs: string[] }>, bare: boolean }}
 *   bare: houve um `$dumpvars` sem argumentos, que significa tudo.
 */
export function parseDumpvarsCalls(src) {
    const calls = [];
    let bare = false;
    const re = /\$dumpvars\s*(?:\(\s*([^)]*)\))?\s*;/g;
    let m;
    while ((m = re.exec(String(src || ''))) !== null) {
        const dentro = (m[1] || '').trim();
        if (!dentro) { bare = true; continue; }
        const partes = dentro.split(',').map((s) => s.trim()).filter(Boolean);
        const level = Number(partes[0]);
        if (!Number.isFinite(level)) { bare = true; continue; }
        const refs = partes.slice(1);
        if (!refs.length) { bare = true; continue; }
        calls.push({ level, refs });
    }
    return { calls, bare };
}

/**
 * Regras a partir dos `$dumpvars` do proprio testbench. Desiste (devolve [])
 * quando uma chamada pede tudo ou cita algo que a arvore nao conhece.
 * @param {Node | null | undefined} tree
 * @param {string} src fonte do testbench
 * @returns {string[]}
 */
export function rulesFromDumpvars(tree, src) {
    if (!tree) return [];
    const { calls, bare } = parseDumpvarsCalls(src);
    if (bare || !calls.length) return [];
    const escopos = new Map();
    const sinais = new Set();
    const indexar = (/** @type {Node} */ no) => {
        escopos.set(no.scopePath, no);
        for (const s of no.signals || []) sinais.add(`${no.scopePath}.${s.name}`);
        for (const filho of no.children || []) indexar(filho);
    };
    indexar(tree);
    /** @type {Pedido} */
    const pedido = { signals: [], scopes: [], subtrees: [] };
    for (const { level, refs } of calls) {
        for (const ref of refs) {
            if (escopos.has(ref)) {
                (level === 1 ? pedido.scopes : pedido.subtrees).push(ref);
            } else if (sinais.has(ref)) {
                pedido.signals.push(ref);
            } else {
                // Uma referencia desconhecida: pode ser um elemento de array,
                // um bit, ou algo que o parser nao viu. Cortar aqui e o risco
                // de esconder o que foi pedido; grava tudo.
                return [];
            }
        }
    }
    return verilatorTraceRules(tree, pedido);
}

/**
 * Quantos escopos ficam ligados e desligados, para a linha do terminal.
 * @param {Node | null | undefined} tree
 * @param {string[]} regras as linhas que serao escritas
 * @returns {{ ligados: number, desligados: number }}
 */
export function contarEscopos(tree, regras) {
    if (!tree) return { ligados: 0, desligados: 0 };
    const estado = new Map();
    for (const r of regras || []) {
        const m = /^tracing_(on|off) -scope "(.+)"$/.exec(r);
        if (m) estado.set(m[2], m[1] === 'on');
    }
    let on = 0;
    let off = 0;
    const visitar = (/** @type {Node} */ no, /** @type {boolean} */ herdado) => {
        const ligado = estado.has(no.scopePath) ? estado.get(no.scopePath) : herdado;
        if (ligado) on++; else off++;
        for (const filho of no.children || []) visitar(filho, ligado);
    };
    visitar(tree, true);
    return { ligados: on, desligados: off };
}
