/**
 * verilog_classifier.ts: heuristica synth-vs-testbench.
 *
 * Decide se um arquivo Verilog/SystemVerilog e um testbench ou codigo
 * sintetizavel olhando so pro conteudo (+ um leve hint do nome do
 * arquivo). Roda no lugar do antigo toggle manual da file tree: a
 * categoria de cada arquivo e SEMPRE derivada daqui, nunca de uma
 * marca persistida pelo usuario. Re-roda a cada load/refresh, entao
 * editar um .v e transforma-lo em testbench o reclassifica sozinho.
 *
 * Nao e um parser, e um scorer. Sinais "definitivos" (dump de VCD,
 * $finish/$stop, modulo sem portas) sozinhos ja passam o threshold;
 * sinais mais fracos (initial, $display, delays procedurais, nome
 * *_tb) somam. Limiar em TB_THRESHOLD.
 *
 * Em caso de duvida → 'synthesizable'. E o default seguro: arquivos
 * synthesizable entram em synthesizableFiles do .spf (o que o
 * iverilog le como design) e header files (.vh, sem module) caem
 * naturalmente aqui.
 *
 * Compilado por `tsc` (npm run build:ts) num verilog_classifier.js ao lado:
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

export type VerilogCategory = 'testbench' | 'synthesizable';

const TB_THRESHOLD = 3;

/** Remove comentarios e string literals pra nao casar keywords dentro deles. */
function stripCommentsAndStrings(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') {
            while (i < n && src[i] !== '\n') i++;
        } else if (c === '/' && c2 === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
        } else if (c === '"') {
            i++;
            while (i < n && src[i] !== '"') {
                if (src[i] === '\\') i++;
                i++;
            }
            i++;
            out += ' ';
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

const isWs = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

function skipWs(code: string, i: number): number {
    while (i < code.length && isWs(code[i])) i++;
    return i;
}

/** Dado o indice de um '(', devolve o indice logo apos o ')' que casa. */
function skipBalancedParens(code: string, i: number): number {
    let depth = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return i;
}

/**
 * True se o codigo declara pelo menos um modulo sem portas:
 * `module top;` ou `module top();` (param block `#(...)` opcional no
 * meio). Modulos sintetizaveis sempre tem portas; um modulo sem
 * portas e quase sempre o top de um testbench.
 */
function hasPortlessModule(code: string): boolean {
    const re = /\bmodule\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        let i = skipWs(code, m.index + 'module'.length);
        const name = /^[\\A-Za-z_$][\w$]*/.exec(code.slice(i));
        if (!name) continue;
        i = skipWs(code, i + name[0].length);
        // Param block opcional: #( ... )
        if (code[i] === '#') {
            i = skipWs(code, i + 1);
            if (code[i] === '(') i = skipWs(code, skipBalancedParens(code, i));
        }
        if (code[i] === ';') return true;        // module top;
        if (code[i] === '(') {
            const j = skipWs(code, i + 1);
            if (code[j] === ')') return true;    // module top();
        }
    }
    return false;
}

/**
 * Classifica conteudo Verilog como 'testbench' ou 'synthesizable'.
 *
 * @param content   conteudo bruto do arquivo
 * @param fileName  nome do arquivo (so pro hint de nome)
 */
export function classifyVerilogContent(content: string, fileName = ''): VerilogCategory {
    if (typeof content !== 'string' || content.trim() === '') {
        return 'synthesizable';
    }
    const code = stripCommentsAndStrings(content);
    let score = 0;

    // --- Sinais definitivos (sozinhos ja passam o threshold) ---
    // Dump de VCD: so testbench escreve waveform.
    if (/\$dump(file|vars|on|off|all|limit|flush)\b/.test(code)) score += 3;
    // Terminacao de simulacao.
    if (/\$(finish|stop)\b/.test(code)) score += 3;
    // Modulo sem portas, top de testbench.
    if (hasPortlessModule(code)) score += 3;

    // --- Sinais fortes ---
    // Bloco initial. Codigo sintetizavel pode ter (init de reg em
    // FPGA), entao sozinho (+2) nao classifica, precisa de companhia.
    if (/\binitial\b/.test(code)) score += 2;

    // --- Sinais fracos ---
    // Tasks de I/O / introspeccao de tempo tipicas de testbench.
    if (/\$(display|write|monitor|strobe|time|realtime|random|sformatf?)\b/.test(code)) score += 1;
    // Delay procedural (#10, # 5). NAO casa `#(` de override de
    // parametro em instanciacao, esse e comum em codigo sintetizavel.
    if (/#\s*\d/.test(code)) score += 1;

    // --- Hint do nome ---
    if (/(^|[^a-z])(tb|test|testbench)([^a-z]|$)/.test(fileName.toLowerCase())) score += 2;

    return score >= TB_THRESHOLD ? 'testbench' : 'synthesizable';
}
