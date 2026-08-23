/**
 * generate_blocks.ts: os blocos `generate if` nomeados, e quando eles existem.
 *
 * POR QUE ISTO PRECISOU EXISTIR
 * -----------------------------
 * O `signal_parser` jogava fora todo `generate if/case`, e com razão: ele não
 * avalia parâmetros, então capturar as instâncias de dentro como se sempre
 * existissem produzia caminhos que o `$dumpvars` pedia e a elaboração recusava,
 * com o Icarus falhando em "Unable to bind". Jogar fora era o lado seguro.
 *
 * O custo foi a pilha de instrução do SAPHO. Ela vive em
 *
 *     generate
 *       if (CAL) begin : isp_blk
 *         stack #(...) isp(...);
 *       end else begin : isp_blk
 *         ...
 *       end
 *     endgenerate
 *
 * e por isso o monitor dela ficou de fora quando os monitores de pilha e ULA
 * voltaram, em 20/08/2026: o caminho `core.isp_blk.isp` não existia para o
 * parser, e espelho de nome fabricado foi exatamente o que derrubou a
 * elaboração antes.
 *
 * A SAÍDA NÃO É ADIVINHAR, É RESOLVER
 * -----------------------------------
 * O `CAL` é um parâmetro com valor conhecido: ou o `<proc>.v` gerado passa
 * `.CAL(1)` na instanciação, ou vale o padrão declarado no `processor.v`, que é
 * zero. Um programa C± sem funções não tem pilha de instrução, e nesse caso o
 * ramo tomado é o `else`, que não instancia `isp` nenhum.
 *
 * Então este módulo faz três coisas pequenas e checáveis: lê os parâmetros
 * declarados de um módulo, lê os que uma instanciação sobrescreve, e decide se
 * a condição de um `generate if` é verdadeira. Quando não consegue decidir, diz
 * que não consegue, e quem chama volta ao comportamento antigo de descartar o
 * bloco. Errar para o lado de mostrar de menos custa um monitor ausente; errar
 * para o lado de mostrar de mais custa uma simulação que não elabora.
 *
 * Puro: entra texto, sai dado. Sem DOM, sem disco.
 *
 * Compilado por `tsc` (npm run build:ts) num generate_blocks.js ao lado; é esse
 * .js que o runtime carrega, e os imports usam a extensão `.js`.
 */

/** Um ramo de `generate if` que tem rótulo, e por isso vira escopo. */
export interface GenerateBranch {
    /** O nome depois do `begin :`, que é o escopo na hierarquia. */
    label: string;
    /** A condição do `if`, como texto. O `else` carrega a mesma, negada. */
    condition: string;
    /** True quando este é o ramo `else`. */
    negated: boolean;
    /** O corpo do ramo, para o chamador extrair sinais e instâncias. */
    body: string;
}

/** Valor de parâmetro que conseguimos entender: só inteiro. */
export type ParamValue = number | undefined;

/**
 * Casa `begin : label` logo depois de um `)` de condição.
 * Aceita `begin: x`, `begin : x` e quebra de linha no meio.
 */
const BEGIN_LABEL = /^\s*begin\s*:\s*([A-Za-z_][\w$]*)/;

/**
 * Acha o índice do caractere logo depois do parêntese que fecha o que abre em
 * `abre`. Devolve -1 quando não fecha, que é fonte malformado.
 */
function fimDoParen(texto: string, abre: number): number {
    let nivel = 0;
    for (let i = abre; i < texto.length; i++) {
        const c = texto[i];
        if (c === '(') nivel++;
        else if (c === ')') { nivel--; if (nivel === 0) return i + 1; }
    }
    return -1;
}

/**
 * Acha o `end` que fecha o `begin` que abre em `inicio`, contando aninhamento
 * de `begin`/`end`. Devolve o índice do `end`, ou -1.
 *
 * Conta só `begin`/`end` porque dentro de um ramo de generate os outros pares
 * (`case`/`endcase`, `function`/`endfunction`) fecham com palavra própria e não
 * consomem um `end`.
 */
function fimDoBegin(texto: string, inicio: number): number {
    const re = /\b(begin|end)\b/g;
    re.lastIndex = inicio;
    let nivel = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
        if (m[1] === 'begin') nivel++;
        else {
            nivel--;
            if (nivel === 0) return m.index;
        }
    }
    return -1;
}

/**
 * Os ramos NOMEADOS de todo `generate if` do corpo de um módulo.
 *
 * Ramo sem rótulo fica de fora de propósito: sem nome ele não é um escopo na
 * hierarquia, e o que está dentro dele mistura-se ao módulo pai de um jeito que
 * o parser não sabe reproduzir. `generate for` também fica de fora: ele elabora
 * sempre, com um escopo por iteração, e isso é outro problema.
 *
 * @param body corpo do módulo, já sem comentários
 */
export function extractNamedGenerates(body: string): GenerateBranch[] {
    const out: GenerateBranch[] = [];
    const src = String(body || '');
    const re = /\bgenerate\b/g;
    let g: RegExpExecArray | null;

    while ((g = re.exec(src)) !== null) {
        // O `if` pode vir na mesma linha ou na seguinte.
        const resto = src.slice(g.index + 'generate'.length);
        const mIf = /^\s*if\s*\(/.exec(resto);
        if (!mIf) continue;
        const abre = g.index + 'generate'.length + mIf[0].length - 1;
        const depoisDaCond = fimDoParen(src, abre);
        if (depoisDaCond < 0) continue;
        const condition = src.slice(abre + 1, depoisDaCond - 1).trim();

        // Ramo verdadeiro.
        let cursor = depoisDaCond;
        const mBegin = BEGIN_LABEL.exec(src.slice(cursor));
        if (!mBegin) continue;                       // ramo sem rótulo: fora
        const inicioBegin = cursor + src.slice(cursor).indexOf('begin');
        const fim = fimDoBegin(src, inicioBegin);
        if (fim < 0) continue;
        out.push({
            label: mBegin[1],
            condition,
            negated: false,
            body: src.slice(inicioBegin + 'begin'.length, fim),
        });

        // Ramo `else`, se houver e se for nomeado.
        cursor = fim + 'end'.length;
        const mElse = /^\s*else\b/.exec(src.slice(cursor));
        if (!mElse) continue;
        cursor += mElse[0].length;
        const mBegin2 = BEGIN_LABEL.exec(src.slice(cursor));
        if (!mBegin2) continue;
        const inicioBegin2 = cursor + src.slice(cursor).indexOf('begin');
        const fim2 = fimDoBegin(src, inicioBegin2);
        if (fim2 < 0) continue;
        out.push({
            label: mBegin2[1],
            condition,
            negated: true,
            body: src.slice(inicioBegin2 + 'begin'.length, fim2),
        });
    }

    return out;
}

/** Um inteiro escrito como o Verilog permite, ou undefined. */
export function parseIntLiteral(texto: string): ParamValue {
    const s = String(texto ?? '').trim();
    if (!s) return undefined;
    // Formas: 42, -3, 8'd12, 4'b1010, 32'h1F, com _ de separação.
    const comBase = /^[+-]?(?:\d+)?'\s*[sS]?([bBoOdDhH])([0-9a-fA-F_]+)$/.exec(s);
    if (comBase) {
        const base = { b: 2, o: 8, d: 10, h: 16 }[comBase[1].toLowerCase()] as number;
        const n = parseInt(comBase[2].replace(/_/g, ''), base);
        return Number.isFinite(n) ? n : undefined;
    }
    if (/^[+-]?\d[\d_]*$/.test(s)) {
        const n = parseInt(s.replace(/_/g, ''), 10);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

/**
 * Os parâmetros DECLARADOS de um módulo, com o valor padrão de cada um.
 *
 * Cobre as duas formas que o Verilog aceita, a lista ANSI em `#(...)` e as
 * declarações `parameter X = 1;` no corpo. Só entra o que resolve para
 * inteiro: um padrão que dependa de outro parâmetro (`parameter W = N*2`) fica
 * de fora, e o efeito é a condição virar indecidível, que é o lado seguro.
 *
 * @param header o `#(...)` do cabeçalho, sem os parênteses externos
 * @param body corpo do módulo
 */
export function declaredParams(header: string, body: string): Map<string, number> {
    const out = new Map<string, number>();
    const varrer = (texto: string) => {
        const re = /\b(?:parameter|localparam)\b[^;]*?/g;
        // Uma declaração pode listar vários: `parameter A = 1, B = 2;`
        const decls = String(texto || '').split(/\bparameter\b|\blocalparam\b/).slice(1);
        for (const decl of decls) {
            const ateFim = decl.split(';')[0];
            for (const par of ateFim.split(',')) {
                const m = /^[^=]*?\b([A-Za-z_][\w$]*)\s*=\s*([^,;]+)$/.exec(par.trim());
                if (!m) continue;
                const v = parseIntLiteral(m[2]);
                if (v !== undefined && !out.has(m[1])) out.set(m[1], v);
            }
        }
        void re;
    };
    varrer(header);
    varrer(body);
    return out;
}

/**
 * Os parâmetros que uma instanciação SOBRESCREVE, na forma nomeada
 * `#(.NAME(valor), ...)`, como TEXTO ainda por resolver.
 *
 * Texto e não número porque o valor pode ser o nome de um parâmetro do módulo
 * de cima: o `processor.v` instancia o core com `.CAL(CAL)`, repassando o
 * próprio. Resolver aqui exigiria conhecer o escopo de quem instancia, que é o
 * que a hierarquia sabe e este módulo não. Ver {@link resolveParamValue}.
 *
 * A forma posicional (`#(16, 10, 5)`) fica de fora: casar posição com a ordem
 * de declaração é possível, mas errar a ordem produziria um valor errado com
 * cara de certo, e um valor errado aqui decide se um escopo existe.
 *
 * @param paramList o conteúdo do `#(...)` da instanciação
 */
export function overriddenParams(paramList: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /\.\s*([A-Za-z_][\w$]*)\s*\(/g;
    const src = String(paramList || '');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const abre = m.index + m[0].length - 1;
        const fim = fimDoParen(src, abre);
        if (fim < 0) continue;
        out.set(m[1], src.slice(abre + 1, fim - 1).trim());
    }
    return out;
}

/**
 * O valor de um texto de parâmetro, no escopo de quem instancia.
 *
 * Duas formas, e só elas: um inteiro escrito direto, ou o nome de um parâmetro
 * do módulo de cima, que é o repasse `.CAL(CAL)`. Expressão (`N*2`,
 * `$clog2(X)`) devolve undefined, e o efeito é a condição virar indecidível,
 * que é o lado seguro.
 *
 * @param texto o que estava dentro dos parênteses
 * @param escopo parâmetros efetivos de quem instancia
 */
export function resolveParamValue(texto: string, escopo: Map<string, number>): ParamValue {
    const s = String(texto ?? '').trim().replace(/^\((.*)\)$/s, '$1').trim();
    const lit = parseIntLiteral(s);
    if (lit !== undefined) return lit;
    if (/^[A-Za-z_][\w$]*$/.test(s)) return escopo.get(s);
    return undefined;
}

/**
 * A condição de um `generate if` é verdadeira?
 *
 * Entende só as formas que o HDL do SAPHO usa, e diz "não sei" para o resto:
 *
 *     CAL            um parâmetro sozinho, verdade quando != 0
 *     (CAL) != 0     e as variações com espaço e sem parênteses
 *     CAL > 0        comparação com literal
 *     1 / 0          literal direto
 *
 * O retorno é `undefined` quando não dá para decidir, e nunca um palpite: quem
 * chama descarta o bloco nesse caso, que é o comportamento de antes.
 *
 * @param condition texto da condição
 * @param params valores efetivos dos parâmetros naquele ponto da hierarquia
 * @param negated true para o ramo `else`
 */
export function evaluateCondition(
    condition: string,
    params: Map<string, number>,
    negated = false,
): boolean | undefined {
    const bruto = String(condition || '').trim();
    if (!bruto) return undefined;
    const valorDe = (texto: string): ParamValue => {
        const s = texto.trim().replace(/^\((.*)\)$/s, '$1').trim();
        const lit = parseIntLiteral(s);
        if (lit !== undefined) return lit;
        if (/^[A-Za-z_][\w$]*$/.test(s)) return params.get(s);
        return undefined;
    };

    let verdade: boolean | undefined;
    const cmp = /^(.+?)\s*(!==|===|!=|==|>=|<=|>|<)\s*(.+)$/.exec(bruto);
    if (cmp) {
        const a = valorDe(cmp[1]);
        const b = valorDe(cmp[3]);
        if (a === undefined || b === undefined) return undefined;
        switch (cmp[2]) {
            case '==': case '===': verdade = a === b; break;
            case '!=': case '!==': verdade = a !== b; break;
            case '>': verdade = a > b; break;
            case '<': verdade = a < b; break;
            case '>=': verdade = a >= b; break;
            case '<=': verdade = a <= b; break;
            default: return undefined;
        }
    } else {
        const v = valorDe(bruto);
        if (v === undefined) return undefined;
        verdade = v !== 0;
    }

    return negated ? !verdade : verdade;
}
