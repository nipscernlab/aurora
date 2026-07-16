import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Every custom property the CSS READS must be one the CSS DEFINES.
//
// `var(--nope)` with no fallback is invalid at computed-value time: the whole
// declaration is dropped and the element silently renders unstyled. No build
// error, no console warning, nothing — it just looks slightly wrong forever.
//
// This is not hypothetical. `--bg-elev-1` was read in SEVEN places in the AI
// panel and defined nowhere: the elevation scale is --bg / --bg-elev /
// --bg-elev-2 / --bg-elev-3, so the first rung has no number and someone
// reasonably assumed it did. The question card's option rows, the chat tables'
// zebra striping and the blockquotes all rendered with no background at all
// until it was found by hand.
const CSS_DIR = path.resolve(__dirname, '../../css');

/** @returns {string[]} every .css file under css/, recursively */
function cssFiles(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...cssFiles(p));
        else if (entry.name.endsWith('.css')) out.push(p);
    }
    return out;
}

const files = cssFiles(CSS_DIR);
const sources = files.map((f) => ({ file: path.relative(CSS_DIR, f), text: fs.readFileSync(f, 'utf-8') }));
const all = sources.map((s) => s.text).join('\n');

// `--x: value` — a definition.
const defined = new Set([...all.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((m) => m[1]));

describe('CSS custom properties', () => {
    it('finds the stylesheets', () => {
        expect(files.length).toBeGreaterThan(0);
        expect(defined.size).toBeGreaterThan(0);
    });

    it('never reads a token that is defined nowhere', () => {
        /** @type {string[]} */
        const orphans = [];
        for (const { file, text } of sources) {
            // var(--name) / var(--name, fallback). A fallback makes it safe, so
            // only bare reads count.
            for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
                const [, name, next] = m;
                if (next === ',') continue;            // has a fallback — survives
                if (defined.has(name)) continue;
                const line = text.slice(0, m.index).split('\n').length;
                orphans.push(`${file}:${line} var(${name})`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it('keeps the elevation scale intact — the rung that caused this', () => {
        for (const t of ['--bg', '--bg-elev', '--bg-elev-2', '--bg-elev-3']) {
            expect(defined.has(t)).toBe(true);
        }
        // If someone ever adds it for real, the orphan test above stops caring —
        // this is here so the rename is a deliberate act, not a typo that works.
        expect(defined.has('--bg-elev-1')).toBe(false);
    });
});
