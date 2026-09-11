/**
 * testbench_instrumenter.ts: Decide whether to inject
 * `$dumpfile` + `$dumpvars` into a Verilog-only testbench source, and
 * if so, build the instrumented text.
 *
 * Pure: takes the original .v contents + selection, returns the new
 * text (or null if no instrumentation needed). The compilation flow
 * handles the actual file reads/writes.
 *
 * Intent:
 *   - User testbenches that already have $dumpfile or $dumpvars are
 *     left alone, the user knows what they want; don't second-guess.
 *   - Otherwise we inject one initial-block before the last
 *     `endmodule`. The argument list comes from `selectedSignals`:
 *       - non-empty → `$dumpvars(0, sig1, sig2, ...)`, exactly the
 *         signals the user picked in the Wave Configuration modal.
 *       - empty (default) → `$dumpvars(1, <tb>)`, signals at the
 *         testbench-module scope only.
 *
 * Compilado por `tsc` (npm run build:ts) num testbench_instrumenter.js ao lado:
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

/** Why instrumentTestbenchSource did what it did, a caller-loggable diagnostic. */
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
    /**
     * True quando o testbench tem gerador de eventos livre e nenhum
     * $finish/$stop. Sai daqui porque este e o unico ponto do fluxo que ja
     * tem o texto do testbench na mao; quem chama decide como avisar.
     */
    mayRunForever: boolean;
}

export interface InstrumentInput {
    /** Source .v as-is from disk. */
    originalContent: string;
    /** Testbench module name. */
    tbModule: string;
    /** Picker selection. */
    selectedSignals?: string[];
    /**
     * Escopos de monitoramento do processador (core.sp/isp/ula), derivados da
     * hierarquia dos fontes por deriveMonitorScopes. Ganham um $dumpvars(1,..)
     * proprio: os flags de pilha e o erro da ULA moram fundo demais para o
     * dump raso default e nao sao opcao do picker — sem isto os grupos
     * Stack/ULA do layout automatico ficam vazios em silencio.
     */
    monitorScopes?: import('./signal_parser.js').MonitorMirror[];
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
 * um comentario, preserva a estrutura e o resto do testbench, so
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
 * comentado, ex: $dumpfile dentro de comentario NAO deve contar
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
            // String literal, passa direto ate a proxima aspa nao-escapada.
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
 * Tira comentarios E o miolo das strings.
 *
 * stripVerilogComments preserva as strings inteiras de proposito (ele serve
 * para reescrever o testbench, e apagar o texto de um $display mudaria o que
 * a simulacao imprime). Para PROCURAR uma chamada, o miolo atrapalha: um
 * $display("chame $finish no fim") daria um $finish que nao existe. Aqui a
 * string vira "" e sobra so o codigo.
 */
function semComentariosNemTexto(src: string): string {
    return stripVerilogComments(src).replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/**
 * True se o testbench manda a simulacao parar em algum ponto.
 *
 * $finish encerra; $stop devolve o controle ao simulador, que em lote tambem
 * para. Qualquer um dos dois basta: o que se quer saber e se existe um fim
 * escrito no testbench, nao qual dos dois o autor preferiu.
 */
export function hasSimulationEnd(src: string): boolean {
    return /\$(finish|stop)\b/.test(semComentariosNemTexto(src));
}

/**
 * True se o testbench gera eventos para sempre sozinho.
 *
 * O caso classico e o gerador de clock: `always #5 clk = ~clk;` (ou com o
 * `begin` no meio, ou um `forever`). Enquanto ele existe a fila de eventos
 * nunca esvazia, entao a simulacao so termina se alguem mandar parar. Um
 * testbench SEM esse gerador termina por conta propria quando os eventos
 * acabam, e ali a falta de $finish nao e problema nenhum: e por isso que a
 * pergunta "tem $finish?" sozinha nao serve para avisar ninguem.
 *
 * `always @(posedge clk)` nao conta: ele so acorda quando outra coisa mexe
 * no clk, entao nao se sustenta.
 */
export function hasFreeRunningClock(src: string): boolean {
    const code = semComentariosNemTexto(src);
    if (/\bforever\b/.test(code)) return true;
    return /\balways\b\s*(?:begin\b\s*)?#/.test(code);
}

/**
 * True quando vale a pena avisar que a simulacao pode nao terminar: ha um
 * gerador livre de eventos e nenhum $finish/$stop para desliga-lo.
 *
 * As duas condicoes juntas, nunca uma so. Avisar todo testbench sem $finish
 * encheria de alarme falso os que terminam sozinhos, e alarme falso repetido
 * e como nao avisar.
 */
export function mayRunForever(src: string): boolean {
    return hasFreeRunningClock(src) && !hasSimulationEnd(src);
}

/**
 * Indice do ULTIMO `endmodule` que e um TOKEN de verdade, fora de
 * comentario, fora de string, e delimitado por nao-identificadores (word
 * boundary). -1 se nao houver.
 *
 * Um lastIndexOf('endmodule') cru casaria a palavra dentro de um comentario
 * (`// fim do endmodule`), de uma string, ou de um identificador (`reg
 * endmodule_done;`), e a injecao do $dumpfile/$dumpvars iria pro lugar
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
            // String literal, pula ate a proxima aspa nao-escapada.
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
//, Verilator otimizava o reg interno proc.valr10 fora e nao resolvia a
// hierarchical reference. Com o yanc v4.3 o harness compila sob Verilator
// via +define+YANC_TRACE (decls taggeadas /* verilator public_flat */),
// proc.valr10 resolve e o $finish funciona. O strip foi removido, o
// Verilator usa o mesmo tb instrumentado que o iverilog.

export function instrumentTestbenchSource({
    originalContent,
    tbModule,
    selectedSignals = [],
    overrideUserDumpvars = false,
    monitorScopes = [],
}: InstrumentInput): InstrumentResult {
    const hasUserDump = hasUserDumpCalls(originalContent);
    // Olha o texto ORIGINAL, e nao o instrumentado: o $dumpvars que o Aurora
    // injeta nao muda quando a simulacao acaba, e a pergunta e sobre o
    // testbench que a pessoa escreveu.
    const semFim = mayRunForever(originalContent);

    if (hasUserDump && !overrideUserDumpvars) {
        // Sem override: cede o controle pro $dumpvars do testbench.
        return {
            needsWrite: false, content: originalContent,
            reason: 'user-defined', mayRunForever: semFim,
        };
    }

    const lastEndmodule = lastEndmoduleIndex(originalContent);
    if (lastEndmodule === -1) {
        // Malformed testbench, bail and let iverilog produce its own
        // syntax error rather than us silently corrupting the file.
        return {
            needsWrite: false, content: originalContent,
            reason: 'malformed', mayRunForever: semFim,
        };
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
    // header-only pass anymore, the VCD header (scopes/signals for the Wave
    // Config picker and the auto-gtkw) is pulled straight from the finished FST
    // by _extractFstHeaderVcd (streams fst2vcd, stops at $enddefinitions). So
    // the testbench no longer needs the +AURORA_HEADER_ONLY $finish gate, and
    // the simulation runs exactly once for all four wave paths.
    //
    // Sem flush periodico: o tb roda livre ate o $finish e o libfst/VCD
    // escreve em blocos grandes (mais rapido). Os $display do usuario
    // saem em bloco quando a sim termina (sem o $fflush ao vivo), trade
    // deliberado por velocidade, junto com a remocao do overlay de progresso.
    // Monitores do processador como ESPELHOS: variaveis declaradas AQUI no
    // tb copiando (always @(*)) os sinais internos por referencia
    // hierarquica. E o unico desenho que funciona nos dois simuladores sem
    // custo: o Verilator ignora argumentos de $dumpvars e rastreia so a
    // hierarquia visivel (o tb sempre e), e expor os modulos internos
    // arrastava o array mem das pilhas (854 MB de FST no ensaio). O .vlt
    // gerado pelo fluxo Verilator marca os alvos como public_flat_rd para
    // as referencias resolverem; no Icarus referencias hierarquicas sao
    // nativas.
    const mirrorDecls = monitorScopes.map((mo) =>
        mo.kind + ' ' + mo.mirror + '; always @ (*) ' + mo.mirror + ' = ' + mo.ref + ';');
    const mirrorBlock = mirrorDecls.length > 0
        ? '// --- AURORA MONITOR MIRRORS (stack/ULA) ---\n' + mirrorDecls.join('\n') + '\n'
        : '';
    // No modo picker o $dumpvars lista sinais explicitos e os espelhos
    // precisam entrar na lista; no modo default (1, tb) ja estao cobertos,
    // e a linha extra e inofensiva. Nomes locais do tb: sem hierarquia,
    // sem risco de elaboracao.
    const monitorLine = monitorScopes.length > 0
        ? '    $dumpvars(0, ' + monitorScopes.map((mo) => mo.mirror).join(', ') + '); // SAPHO stack/ULA monitors\n'
        : '';
    const injection = `
// --- AURORA AUTO-INSTRUMENTATION ---
// ${headerComment} ${note}
${mirrorBlock}initial begin
    $dumpfile("${tbModule}.vcd");
    $dumpvars(${dumpvarsArgs});
${monitorLine}end
// --------------------------------------------------
`;

    const content = baseContent.slice(0, endmoduleIdx)
        + injection
        + baseContent.slice(endmoduleIdx);

    let reason: InstrumentReason;
    if (hasUserDump) reason = 'override-user';
    else if (selectedSignals.length > 0) reason = 'auto-selection';
    else reason = 'auto';

    return { needsWrite: true, content, reason, mayRunForever: semFim };
}
