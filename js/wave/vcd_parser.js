/**
 * vcd_parser.js — Pure VCD-header walker.
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
 *   - non-module scopes ($task / $function / etc.) are skipped — only
 *     module scopes carry signals the picker / .gtkw care about. The
 *     placeholder pushed onto the stack keeps `$upscope` balanced.
 */

/**
 * @typedef {{ name: string, width: number, range: string|null, type: string }} VcdSignal
 * @typedef {{ name: string, path: string, signals: VcdSignal[] }} VcdScope
 */

/**
 * @param {string} vcdHeader  Text up to (but not including) `$enddefinitions`.
 * @returns {VcdScope[]}
 */
export function parseVcdScopes(vcdHeader) {
    // Tokenise: keep `[a:b]` ranges as one token, everything else
    // whitespace-delimited. VCD headers are small and whitespace-only —
    // a regex split is fast enough.
    const tokens = vcdHeader.match(/\[[^\]]+\]|\S+/g) || [];

    /** @type {(VcdScope|null)[]} */
    const stack = [];
    /** @type {VcdScope[]} */
    const scopes = [];
    /** @type {Map<string, VcdScope>} */
    // Indexed by path. VCDs gerados por iverilog quando o testbench tem
    // varios `$dumpvars` espalhados (caso do asmcomp) reentram o mesmo
    // escopo varias vezes — cada `$scope module X` reabre X em vez de
    // continuar acumulando. Sem deduplicar por path, terminamos com N
    // objetos VcdScope com `path === 'tb.proc'` cada um carregando UM
    // sinal, e consumers que fazem lookup-por-path so acham o primeiro.
    const byPath = new Map();

    const skipToEnd = (i) => {
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
            let range = null;
            if (tokens[i + 5] && tokens[i + 5].startsWith('[') && tokens[i + 5] !== '$end') {
                range = tokens[i + 5].slice(1, -1);
            }
            i = skipToEnd(i);
            // Vars are attributed to the IMMEDIATE enclosing scope, not
            // the nearest module ancestor. A $var inside a $scope task
            // (or function/fork) is dropped — it belongs to that
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
 * @param {string} vcdContent  Full VCD file contents.
 * @returns {VcdScope[]}
 */
export function parseVcdHeaderFromContent(vcdContent) {
    const enddef = vcdContent.indexOf('$enddefinitions');
    const header = enddef >= 0 ? vcdContent.slice(0, enddef) : vcdContent;
    return parseVcdScopes(header);
}
