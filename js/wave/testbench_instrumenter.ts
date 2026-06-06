/**
 * testbench_instrumenter.ts — Decide whether to inject
 * `$dumpfile` + `$dumpvars` into a Verilog-only testbench source, and
 * if so, build the instrumented text.
 *
 * Pure: takes the original .v contents + selection, returns the new
 * text (or null if no instrumentation needed). The compilation flow
 * handles the actual file reads/writes.
 *
 * Intent:
 *   - User testbenches that already have $dumpfile or $dumpvars are
 *     left alone — the user knows what they want; don't second-guess.
 *   - Otherwise we inject one initial-block before the last
 *     `endmodule`. The argument list comes from `selectedSignals`:
 *       - non-empty → `$dumpvars(0, sig1, sig2, ...)` — exactly the
 *         signals the user picked in the Wave Configuration modal.
 *       - empty (default) → `$dumpvars(1, <tb>)` — signals at the
 *         testbench-module scope only.
 *
 * Compilado por `tsc` (npm run build:ts) num testbench_instrumenter.js ao lado —
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

/** Why instrumentTestbenchSource did what it did — a caller-loggable diagnostic. */
export type InstrumentReason =
    | 'user-defined'
    | 'malformed'
    | 'auto'
    | 'auto-selection'
    | 'override-user';

export interface InstrumentResult {
    /** Whether the original differs from `content`. If false, content === original. */
    needsWrite: boolean;
    /** Instrumented (or original) Verilog. */
    content: string;
    reason: InstrumentReason;
}

export interface InstrumentInput {
    /** Source .v as-is from disk. */
    originalContent: string;
    /** Testbench module name. */
    tbModule: string;
    /** Picker selection. */
    selectedSignals?: string[];
    /**
     * Se true, e o testbench tem $dumpfile/$dumpvars hand-written, NAO cede o
     * controle: comenta as linhas originais e injeta o $dumpvars do Aurora
     * baseado em selectedSignals. Usado quando o usuario customiza a Wave
     * Configuration depois da primeira simulacao.
     */
    overrideUserDumpvars?: boolean;
}

/**
 * Substitui qualquer chamada a $dumpfile(...) ou $dumpvars(...) por
 * um comentario — preserva a estrutura e o resto do testbench, so
 * tira o efeito das chamadas. Lida com argumentos em multiplas
 * linhas via lazy match ate o `;`.
 */
export function commentOutDumpCalls(src: string): string {
    return src.replace(
        /\$dump(file|vars)\s*\([^;]*?\)\s*;/g,
        (match) => `/* Aurora: overridden by Wave Configuration ─ ${match.replace(/\n/g, ' ')} */`,
    );
}

/**
 * Remove comentarios Verilog (linha-dupla-barra e bloco barra-asterisco)
 * de um source. Usado pra deteccoes que precisam ignorar codigo
 * comentado — ex: $dumpfile dentro de comentario NAO deve contar
 * como "user-defined dump".
 *
 * Heuristica de strings: pula conteudo entre aspas duplas pra nao
 * confundir duas barras dentro de uma string. Verilog real raramente
 * tem isso mas eh defensivo. Nao trata escape sequences.
 */
export function stripVerilogComments(src: string): string {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '"') {
            // String literal — passa direto ate a proxima aspa nao-escapada.
            out += c;
            i++;
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\' && i + 1 < src.length) {
                    out += src[i] + src[i + 1];
                    i += 2;
                } else {
                    out += src[i++];
                }
            }
            if (i < src.length) { out += src[i++]; }
        } else if (c === '/' && next === '/') {
            // Comentario de linha: pula ate \n (mantem o \n pra
            // preservar numeracao de linhas em erros do iverilog).
            while (i < src.length && src[i] !== '\n') i++;
        } else if (c === '/' && next === '*') {
            // Comentario de bloco: pula ate */.
            i += 2;
            while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

/**
 * Retorna true se o source tem chamada hand-written a $dumpfile ou
 * $dumpvars (i.e., NAO em comentario). Usado pra decidir se o
 * Aurora cede o controle do dump pro usuario ou injeta o seu proprio.
 */
export function hasUserDumpCalls(src: string): boolean {
    const stripped = stripVerilogComments(src);
    return /\$dumpfile/.test(stripped) || /\$dumpvars/.test(stripped);
}

/**
 * Indice do ULTIMO `endmodule` que e um TOKEN de verdade — fora de
 * comentario, fora de string, e delimitado por nao-identificadores (word
 * boundary). -1 se nao houver.
 *
 * Um lastIndexOf('endmodule') cru casaria a palavra dentro de um comentario
 * (`// fim do endmodule`), de uma string, ou de um identificador (`reg
 * endmodule_done;`) — e a injecao do $dumpfile/$dumpvars iria pro lugar
 * errado, jogando codigo pra FORA do modulo e gerando um erro de compilacao
 * confuso. Espelha a maquina de estados de stripVerilogComments, mas em vez
 * de reescrever o texto devolve o indice no source ORIGINAL (os indices do
 * stripped nao corresponderiam ao original).
 */
export function lastEndmoduleIndex(src: string): number {
    const KW = 'endmodule';
    const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
    let i = 0;
    let last = -1;
    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '"') {
            // String literal — pula ate a proxima aspa nao-escapada.
            i++;
            while (i < src.length && src[i] !== '"') {
                i += (src[i] === '\\' && i + 1 < src.length) ? 2 : 1;
            }
            i++; // consome a aspa de fechamento
        } else if (c === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n') i++;
        } else if (c === '/' && next === '*') {
            i += 2;
            while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
        } else if (c === 'e' && src.startsWith(KW, i)
            && !isWord(src[i - 1]) && !isWord(src[i + KW.length])) {
            last = i;
            i += KW.length;
        } else {
            i++;
        }
    }
    return last;
}

// NOTA (YANC v4.3): antes existia aqui um workaround
// (stripVerilatorIncompatibleLines) que removia do _tb.v, na copia
// Verilator-only, o handler de early-finish `if (proc.valr10 == N) $finish`
// — Verilator otimizava o reg interno proc.valr10 fora e nao resolvia a
// hierarchical reference. Com o yanc v4.3 o harness compila sob Verilator
// via +define+YANC_TRACE (decls taggeadas /* verilator public_flat */),
// proc.valr10 resolve e o $finish funciona. O strip foi removido — o
// Verilator usa o mesmo tb instrumentado que o iverilog.

export function instrumentTestbenchSource({
    originalContent,
    tbModule,
    selectedSignals = [],
    overrideUserDumpvars = false,
}: InstrumentInput): InstrumentResult {
    const hasUserDump = hasUserDumpCalls(originalContent);

    if (hasUserDump && !overrideUserDumpvars) {
        // Sem override: cede o controle pro $dumpvars do testbench.
        return { needsWrite: false, content: originalContent, reason: 'user-defined' };
    }

    const lastEndmodule = lastEndmoduleIndex(originalContent);
    if (lastEndmodule === -1) {
        // Malformed testbench — bail and let iverilog produce its own
        // syntax error rather than us silently corrupting the file.
        return { needsWrite: false, content: originalContent, reason: 'malformed' };
    }

    // Se for override, primeiro neutraliza o $dumpfile/$dumpvars do
    // usuario no source. Aurora injeta o seu logo abaixo.
    const baseContent = hasUserDump ? commentOutDumpCalls(originalContent) : originalContent;
    // O endmodule index muda apos o replace porque o tamanho do
    // conteudo mudou. Recalcular.
    const endmoduleIdx = lastEndmoduleIndex(baseContent);

    const dumpvarsArgs = selectedSignals.length > 0
        ? `0, ${selectedSignals.join(', ')}`
        : `1, ${tbModule}`;
    const note = selectedSignals.length > 0
        ? `Signal list comes from the Wave Configuration picker (${selectedSignals.length} signals).`
        : 'Default: signals at the testbench module scope; configure via the Wave Configuration modal.';

    const headerComment = hasUserDump
        ? 'Aurora override: testbench had hand-written $dumpfile/$dumpvars but the user customized the Wave Configuration, so the originals were commented out and replaced.'
        : '$dumpfile / $dumpvars added because the testbench did not declare any.';

    // Single full-run dump. We only register the dump target + scopes here;
    // the simulator writes the FST as it runs to its own $finish. There is NO
    // header-only pass anymore — the VCD header (scopes/signals for the Wave
    // Config picker and the auto-gtkw) is pulled straight from the finished FST
    // by _extractFstHeaderVcd (streams fst2vcd, stops at $enddefinitions). So
    // the testbench no longer needs the +AURORA_HEADER_ONLY $finish gate, and
    // the simulation runs exactly once for all four wave paths.
    //
    // Sem flush periodico: o tb roda livre ate o $finish e o libfst/VCD
    // escreve em blocos grandes (mais rapido). Os $display do usuario
    // saem em bloco quando a sim termina (sem o $fflush ao vivo) — trade
    // deliberado por velocidade, junto com a remocao do overlay de progresso.
    const injection = `
// --- AURORA AUTO-INSTRUMENTATION ---
// ${headerComment} ${note}
initial begin
    $dumpfile("${tbModule}.vcd");
    $dumpvars(${dumpvarsArgs});
end
// --------------------------------------------------
`;

    const content = baseContent.slice(0, endmoduleIdx)
        + injection
        + baseContent.slice(endmoduleIdx);

    let reason: InstrumentReason;
    if (hasUserDump) reason = 'override-user';
    else if (selectedSignals.length > 0) reason = 'auto-selection';
    else reason = 'auto';

    return { needsWrite: true, content, reason };
}
