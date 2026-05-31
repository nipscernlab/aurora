/**
 * testbench_instrumenter.js — Decide whether to inject
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
 */

/**
 * @typedef {object} InstrumentResult
 * @property {boolean} needsWrite       Whether the original differs from `content`.
 *                                      If false, content === original.
 * @property {string} content           Instrumented (or original) Verilog.
 * @property {('user-defined'|'malformed'|'auto'|'auto-selection'|'override-user')} reason
 *                                      Diagnostic — caller can log it.
 *                                      'override-user': testbench had hand-written
 *                                      $dumpfile/$dumpvars but the user has
 *                                      customized the Wave Configuration, so we
 *                                      commented those out and injected ours.
 */

/**
 * Substitui qualquer chamada a $dumpfile(...) ou $dumpvars(...) por
 * um comentario — preserva a estrutura e o resto do testbench, so
 * tira o efeito das chamadas. Lida com argumentos em multiplas
 * linhas via lazy match ate o `;`.
 */
function commentOutDumpCalls(src) {
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
export function stripVerilogComments(src) {
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
export function hasUserDumpCalls(src) {
    const stripped = stripVerilogComments(src);
    return /\$dumpfile/.test(stripped) || /\$dumpvars/.test(stripped);
}

// NOTA (YANC v4.3): antes existia aqui um workaround
// (stripVerilatorIncompatibleLines) que removia do _tb.v, na copia
// Verilator-only, o handler de early-finish `if (proc.valr10 == N) $finish`
// — Verilator otimizava o reg interno proc.valr10 fora e nao resolvia a
// hierarchical reference. Com o yanc v4.3 o harness compila sob Verilator
// via +define+YANC_TRACE (decls taggeadas /* verilator public_flat */),
// proc.valr10 resolve e o $finish funciona. O strip foi removido — o
// Verilator usa o mesmo tb instrumentado que o iverilog.

/**
 * @param {object} input
 * @param {string} input.originalContent  Source .v as-is from disk.
 * @param {string} input.tbModule         Testbench module name.
 * @param {string[]} [input.selectedSignals]  Picker selection.
 * @param {boolean} [input.overrideUserDumpvars]  Se true, e o testbench
 *      tem $dumpfile/$dumpvars hand-written, NAO cede o controle:
 *      comenta as linhas originais e injeta o $dumpvars do Aurora
 *      baseado em selectedSignals. Usado quando o usuario customiza
 *      a Wave Configuration depois da primeira simulacao.
 * @returns {InstrumentResult}
 */
export function instrumentTestbenchSource({
    originalContent,
    tbModule,
    selectedSignals = [],
    overrideUserDumpvars = false,
}) {
    const hasUserDump = hasUserDumpCalls(originalContent);

    if (hasUserDump && !overrideUserDumpvars) {
        // Sem override: cede o controle pro $dumpvars do testbench.
        return { needsWrite: false, content: originalContent, reason: 'user-defined' };
    }

    const lastEndmodule = originalContent.lastIndexOf('endmodule');
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
    const endmoduleIdx = baseContent.lastIndexOf('endmodule');

    const dumpvarsArgs = selectedSignals.length > 0
        ? `0, ${selectedSignals.join(', ')}`
        : `1, ${tbModule}`;
    const note = selectedSignals.length > 0
        ? `Signal list comes from the Wave Configuration picker (${selectedSignals.length} signals).`
        : 'Default: signals at the testbench module scope; configure via the Wave Configuration modal.';

    const headerComment = hasUserDump
        ? 'Aurora override: testbench had hand-written $dumpfile/$dumpvars but the user customized the Wave Configuration, so the originals were commented out and replaced.'
        : '$dumpfile / $dumpvars added because the testbench did not declare any.';

    // Pass-1 hook of the two-pass dump strategy. The `#1` + $dumpflush
    // before $finish are critical: $dumpvars at time 0 only *registers*
    // the scopes; vvp flushes the full VCD header (every $var line plus
    // $enddefinitions) once the simulator either advances past time 0
    // OR sees an explicit $dumpflush. A bare $finish at time 0 exits
    // before the header is committed and the resulting .vcd has scopes
    // but no $var lines.
    //
    // Pass 1: `vvp foo.vvp +AURORA_HEADER_ONLY` → runs initial block,
    // advances 1 tick, flushes header, exits. Pass 2: same .vvp without
    // the plusarg — the gate is false, the #1/$dumpflush/$finish are
    // skipped, simulation runs to its normal $finish.
    // Pass-1 hook of the two-pass dump strategy. The `#1` + $dumpflush
    // before $finish are critical: $dumpvars at time 0 only *registers*
    // the scopes; vvp flushes the full VCD header (every $var line plus
    // $enddefinitions) once the simulator either advances past time 0
    // OR sees an explicit $dumpflush. A bare $finish at time 0 exits
    // before the header is committed and the resulting .vcd has scopes
    // but no $var lines.
    //
    // Pass 1: `vvp foo.vvp +AURORA_HEADER_ONLY` → runs initial block,
    // advances 1 tick, flushes header, exits. Pass 2: same .vvp without
    // the plusarg — the gate is false, the #1/$dumpflush/$finish are
    // skipped, simulation runs to its normal $finish.
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
    if ($test$plusargs("AURORA_HEADER_ONLY")) begin
        #1;
        $dumpflush;
        $finish;
    end
end
// --------------------------------------------------
`;

    const content = baseContent.slice(0, endmoduleIdx)
        + injection
        + baseContent.slice(endmoduleIdx);

    let reason;
    if (hasUserDump) reason = 'override-user';
    else if (selectedSignals.length > 0) reason = 'auto-selection';
    else reason = 'auto';

    return { needsWrite: true, content, reason };
}
