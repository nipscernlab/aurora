/**
 * gtkw_writer.ts — Helpers de inspeção/parsing de .gtkw.
 *
 * O builder principal do .gtkw (header + secao top-level + secoes por
 * processador) vive em `gtkw_proc_writer.js` (`buildAuroraGtkw`).
 *
 * Aqui resta `extractSignalRefs`: extrai os scope paths referenciados
 * por um .gtkw existente. Usado pra cross-checar um .gtkw user-curated
 * contra o VCD da simulacao atual (`_waveValidateUserGtkwAgainstVcd`)
 * — sinais referenciados pelo layout mas nao presentes no VCD geram
 * warning ao usuario.
 *
 * Compilado por `tsc` (npm run build:ts) num gtkw_writer.js ao lado — é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */

/**
 * Extract dotted signal references from a .gtkw file. Used to detect
 * stale paths in a user-curated layout (signal renamed since the file
 * was saved).
 *
 * .gtkw is a line-oriented format with several decoration kinds:
 *   - `[*]` / `[dumpfile]` / `[savefile]` / `[timestart]` — headers
 *   - `@<hex>` — format codes (radix, color, etc.)
 *   - `-<name>` — group open marker
 *   - `[group_close]` / `[group_end]` — group close
 *   - `<dotted.path>[range]?` — actual signal reference
 *
 * The signal lines we care about are: starts with a letter or
 * underscore, contains at least one dot. Strip a trailing `[a:b]`
 * range to get the bare path. Everything else is decoration we
 * don't validate.
 *
 * @returns unique dotted paths referenced by the file
 */
export function extractSignalRefs(gtkwContent: string): string[] {
    if (typeof gtkwContent !== 'string' || gtkwContent.length === 0) return [];
    const paths = new Set<string>();
    for (const rawLine of gtkwContent.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line) continue;
        // Decoration / metadata: skip.
        if (line.startsWith('[') || line.startsWith('@') || line.startsWith('-')
            || line.startsWith('*') || line.startsWith('#')
            || line.startsWith('^')) continue;
        // Alias-prefixed signal: `+{alias} <path>` — strip the prefix
        // and keep the path. buildAuroraGtkw emits these for any
        // signal with a human-friendly label (Stack, ULA, typed vars).
        if (line.startsWith('+')) {
            const m = line.match(/^\+\{[^}]*\}\s+(.+)$/);
            if (!m) continue;
            line = m[1].trim();
        }
        // Signal candidate: must start with [a-zA-Z_], contain at least one
        // `.`, and use a dotted-identifier shape. Strip a trailing range.
        const noRange = line.replace(/\[[^\]]*\]\s*$/, '').trim();
        if (!/^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)+$/.test(noRange)) continue;
        paths.add(noRange);
    }
    return [...paths];
}
