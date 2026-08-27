/**
 * vcd_parser.ts: Pure VCD-header walker.
 *
 * Used by the Wave-flow code (.gtkw generation, picker validation) to
 * inspect a VCD's `$scope` / `$var` declarations without touching the
 * filesystem or pulling in heavy dependencies.
 *
 * Intentionally a free function (not a method on CompilationModule) so
 * test code can feed it raw VCD text directly. The compilation flow
 * passes `vcdContent.slice(0, vcdContent.indexOf('$enddefinitions'))`
 * to skip the (potentially huge) value-change section.
 *
 * Output:
 *   [{ name: 'tb_counter', path: 'tb_counter', signals: [...] },
 *    { name: 'dut',        path: 'tb_counter.dut', signals: [...] },
 *    ...]
 *
 *   - `path` is the dotted hierarchical path from simulation root.
 *     Picker selections are stored in the same form, so matching is a
 *     plain Set lookup.
 *   - non-module scopes ($task / $function / etc.) are skipped, only
 *     module scopes carry signals the picker / .gtkw care about. The
 *     placeholder pushed onto the stack keeps `$upscope` balanced.
 *
 * Compilado por `tsc` (npm run build:ts) num vcd_parser.js ao lado, é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */

export interface VcdSignal {
    name: string;
    width: number;
    range: string | null;
    type: string;
}

export interface VcdScope {
    name: string;
    path: string;
    signals: VcdSignal[];
}

/**
 * @param vcdHeader  Text up to (but not including) `$enddefinitions`.
 */
export function parseVcdScopes(vcdHeader: string): VcdScope[] {
    // Tokenise: keep `[a:b]` / `[N]` ranges as one token, everything
    // else whitespace-delimited.
    //
    // Note `[^\]\s]+` (no whitespace inside brackets), antes era
    // `[^\]]+` que casava tudo ate o proximo `]`, inclusive `\r\n`
    // e centenas de outros tokens depois. Iverilog usa caracteres
    // ASCII printable (incluindo `[`) como signal IDs em $var, e
    // havia VCDs com `$var reg 1 [ out_en_sim_2 $end` onde o `[`
    // sozinho era o ID. O regex antigo ia ate o proximo `]` no
    // file todo, consumindo \$scope/\$upscope/etc no caminho:
    // resultava em paths com `top_level_tb.top_level_tb` ou pior.
    const tokens = vcdHeader.match(/\[[^\]\s]+\]|\S+/g) || [];

    const stack: (VcdScope | null)[] = [];
    const scopes: VcdScope[] = [];
    // Indexed by path. VCDs gerados por iverilog quando o testbench tem
    // varios `$dumpvars` espalhados (caso do asmcomp) reentram o mesmo
    // escopo varias vezes, cada `$scope module X` reabre X em vez de
    // continuar acumulando. Sem deduplicar por path, terminamos com N
    // objetos VcdScope com `path === 'tb.proc'` cada um carregando UM
    // sinal, e consumers que fazem lookup-por-path so acham o primeiro.
    const byPath = new Map<string, VcdScope>();

    const skipToEnd = (i: number): number => {
        while (i < tokens.length && tokens[i] !== '$end') i++;
        return i;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '$scope') {
            const scopeType = tokens[i + 1];
            const name = tokens[i + 2];
            i = skipToEnd(i + 2);
            if (scopeType === 'module') {
                const parent = stack.slice().reverse().find((s) => s !== null);
                const path = parent ? `${parent.path}.${name}` : name;
                let scope = byPath.get(path);
                if (!scope) {
                    scope = { name, path, signals: [] };
                    scopes.push(scope);
                    byPath.set(path, scope);
                }
                stack.push(scope);
            } else {
                stack.push(null);
            }
        } else if (token === '$upscope') {
            i = skipToEnd(i);
            stack.pop();
        } else if (token === '$var') {
            const type = tokens[i + 1];
            const width = parseInt(tokens[i + 2], 10);
            const name = tokens[i + 4];
            let range: string | null = null;
            if (tokens[i + 5] && tokens[i + 5].startsWith('[') && tokens[i + 5] !== '$end') {
                range = tokens[i + 5].slice(1, -1);
            }
            i = skipToEnd(i);
            // Vars are attributed to the IMMEDIATE enclosing scope, not
            // the nearest module ancestor. A $var inside a $scope task
            // (or function/fork) is dropped, it belongs to that
            // procedural construct, not to the module that contains the
            // task. The picker can't address task-locals anyway.
            const current = stack[stack.length - 1];
            if (!current) continue;
            // Dedupe signals tambem: se o mesmo $var aparece em duas
            // reaberturas, mantemos o primeiro.
            if (current.signals.some((s) => s.name === name)) continue;
            current.signals.push({ name, width, range, type });
        } else if (token === '$enddefinitions') {
            break;
        }
    }

    return scopes;
}

/**
 * Convenience wrapper that strips the value-change section before
 * parsing. Same shape as parseVcdScopes; safe to call on a full VCD
 * file's contents.
 *
 * @param vcdContent  Full VCD file contents.
 */
export function parseVcdHeaderFromContent(vcdContent: string): VcdScope[] {
    const enddef = vcdContent.indexOf('$enddefinitions');
    const header = enddef >= 0 ? vcdContent.slice(0, enddef) : vcdContent;
    return parseVcdScopes(header);
}
