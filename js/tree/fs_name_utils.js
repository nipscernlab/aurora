/**
 * fs_name_utils.js — pure name/path helpers for the file-tree CRUD
 * (standard_tree_crud.js). No DOM, no IPC — unit-tested in isolation.
 *
 * The validation rules mirror VS Code's Explorer:
 *   - empty name           → "must be provided"
 *   - leading/trailing ws  → rejected
 *   - invalid characters   → < > : " | ? * and control chars (Windows superset,
 *                            applied on every platform like VS Code does)
 *   - reserved device names→ CON PRN AUX NUL COM1-9 LPT1-9 (segment base)
 *   - '.' / '..' segments  → rejected
 *   - trailing '.' / ' '   → rejected per segment (Windows strips them silently)
 *   - duplicate            → case-insensitive against siblings (Windows FS),
 *                            except a pure case-change of the SAME entry
 * Create accepts nested paths ("a/b/c.txt", VS Code behaviour); rename accepts
 * a single segment only.
 */

// eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
const INVALID_CHARS_RE = /[<>:"|?*\u0000-\u001F]/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Normalize separators to forward slashes (display/compare form). */
export function normSlash(p) {
    return String(p || '').replace(/\\/g, '/');
}

/** Last path segment. */
export function baseName(p) {
    const n = normSlash(p).replace(/\/+$/, '');
    return n.slice(n.lastIndexOf('/') + 1);
}

/** Everything before the last segment ('' when none). */
export function parentDir(p) {
    const n = normSlash(p).replace(/\/+$/, '');
    const i = n.lastIndexOf('/');
    return i <= 0 ? '' : n.slice(0, i);
}

/** True when `child` lives strictly under `parent` (case-insensitive, Windows FS). */
export function isUnder(child, parent) {
    const c = normSlash(child).toLowerCase().replace(/\/+$/, '');
    const p = normSlash(parent).toLowerCase().replace(/\/+$/, '');
    return !!p && c !== p && c.startsWith(p + '/');
}

/**
 * Validate one path segment. Returns null when fine, or an error string key
 * (caller translates): 'invalidChars' | 'reserved' | 'dots' | 'endsBad'.
 */
function segmentError(seg) {
    if (seg === '.' || seg === '..') return 'dots';
    if (INVALID_CHARS_RE.test(seg) ) return 'invalidChars';
    if (/[. ]$/.test(seg)) return 'endsBad';
    const base = seg.split('.')[0];
    if (RESERVED_RE.test(base)) return 'reserved';
    return null;
}

/**
 * Validate a new file/folder name typed in the tree's inline input.
 *
 * @param {string} name           raw input value
 * @param {object} opts
 * @param {string[]} opts.siblings        names in the target directory
 * @param {boolean}  opts.allowSeparators nested create ("a/b.txt") allowed?
 * @param {string|null} opts.originalName rename: current name of the entry
 * @returns {{ok: true, name: string} | {ok: false, error: string}}
 *   `error` is a key: 'empty' | 'whitespace' | 'separators' | 'invalidChars'
 *   | 'reserved' | 'dots' | 'endsBad' | 'exists'
 */
export function validateEntryName(name, opts = {}) {
    const { siblings = [], allowSeparators = false, originalName = null } = opts;
    const raw = String(name ?? '');
    if (raw.trim() === '') return { ok: false, error: 'empty' };
    if (raw !== raw.trim()) return { ok: false, error: 'whitespace' };

    const unified = raw.replace(/\\/g, '/');
    const hasSep = unified.includes('/');
    if (hasSep && !allowSeparators) return { ok: false, error: 'separators' };

    const segments = hasSep ? unified.split('/') : [unified];
    for (const seg of segments) {
        if (seg === '') return { ok: false, error: 'separators' }; // 'a//b', leading/trailing '/'
        const err = segmentError(seg);
        if (err) return { ok: false, error: err };
    }

    // Duplicate check — only meaningful for a single-segment name (nested
    // targets are existence-checked at commit time by the caller).
    if (!hasSep) {
        const lower = unified.toLowerCase();
        const isSelf = originalName !== null && lower === String(originalName).toLowerCase();
        if (!isSelf && siblings.some((s) => String(s).toLowerCase() === lower)) {
            return { ok: false, error: 'exists' };
        }
    }
    return { ok: true, name: unified };
}

/**
 * "Keep both" / paste-into-same-folder name: `foo.txt` → `foo copy.txt` →
 * `foo copy 2.txt` … (VS Code's suffix scheme). Dotfiles (".gitignore") and
 * folders get the suffix at the end ("folder copy").
 *
 * @param {string} name       the conflicting name
 * @param {string[]} siblings names already present in the target directory
 */
export function nextCopyName(name, siblings) {
    const lowerSet = new Set(siblings.map((s) => String(s).toLowerCase()));
    const dot = name.lastIndexOf('.');
    // ".gitignore" (dot === 0) and extension-less names keep the whole name as base.
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = `${base} copy${ext}`;
    for (let i = 2; lowerSet.has(candidate.toLowerCase()); i++) {
        candidate = `${base} copy ${i}${ext}`;
    }
    return candidate;
}
