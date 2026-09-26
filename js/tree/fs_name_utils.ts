/**
 * fs_name_utils.ts: pure name/path helpers for the file-tree CRUD
 * (standard_tree_crud.js). No DOM, no IPC, unit-tested in isolation.
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
export function normSlash(p: unknown): string {
    return String(p || '').replace(/\\/g, '/');
}

/** Last path segment. */
export function baseName(p: unknown): string {
    const n = normSlash(p).replace(/\/+$/, '');
    return n.slice(n.lastIndexOf('/') + 1);
}

/** Everything before the last segment ('' when none). */
export function parentDir(p: unknown): string {
    const n = normSlash(p).replace(/\/+$/, '');
    const i = n.lastIndexOf('/');
    return i <= 0 ? '' : n.slice(0, i);
}

/** True when `child` lives strictly under `parent` (case-insensitive, Windows FS). */
export function isUnder(child: unknown, parent: unknown): boolean {
    const c = normSlash(child).toLowerCase().replace(/\/+$/, '');
    const p = normSlash(parent).toLowerCase().replace(/\/+$/, '');
    return !!p && c !== p && c.startsWith(p + '/');
}

/**
 * Validate one path segment. Returns null when fine, or an error string key
 * (caller translates): 'invalidChars' | 'reserved' | 'dots' | 'endsBad'.
 */
function segmentError(seg: string): string | null {
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
 * @param name           raw input value
 * @param opts.siblings        names in the target directory
 * @param  opts.allowSeparators nested create ("a/b.txt") allowed?
 * @param opts.originalName rename: current name of the entry
 *   `error` is a key: 'empty' | 'whitespace' | 'separators' | 'invalidChars'
 *   | 'reserved' | 'dots' | 'endsBad' | 'exists'
 */
export function validateEntryName(name: string, opts: { siblings?: string[]; allowSeparators?: boolean; originalName?: string | null } = {}): { ok: true; name: string; }|{ ok: false; error: string; } {
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

    // Duplicate check, only meaningful for a single-segment name (nested
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
 * @param name       the conflicting name
 * @param siblings names already present in the target directory
 */
export function nextCopyName(name: string, siblings: string[]) {
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

/**
 * Para onde vai o que foi solto na árvore.
 *
 * Soltar sobre uma pasta joga dentro dela; soltar sobre um arquivo joga na
 * pasta desse arquivo, que é o que a pessoa quer dizer ao mirar num item
 * qualquer de uma pasta aberta; soltar na área vazia joga na raiz do projeto.
 *
 * @param sobre linha sob o cursor, ou
 *   null quando o cursor está na área vazia
 * @param raiz raiz do projeto
 * @returns pasta de destino, ou '' quando não há destino possível
 */
export function resolveDropTarget(sobre: { path: string; isDir: boolean; }|null, raiz: string | null): string {
    if (!sobre || !sobre.path) return raiz || '';
    return sobre.isDir ? sobre.path : parentDir(sobre.path);
}

/**
 * O arrasto é um não-movimento? Soltar algo na pasta onde já está, ou uma
 * pasta dentro de si mesma ou da própria subárvore, não é operação nenhuma.
 *
 * A guarda da subárvore é a que importa: mover `a/b` para dentro de `a/b/c`
 * arrastaria a pasta para dentro dela mesma e, dependendo do sistema de
 * arquivos, ou falha ou destrói o conteúdo.
 *
 * @param origem caminho arrastado
 * @param destino pasta de destino
 * @param ehPasta a origem é uma pasta
 */
export function isNoOpDrop(origem: string, destino: string, ehPasta: boolean) {
    if (!origem || !destino) return true;
    const o = normSlash(origem).toLowerCase();
    const d = normSlash(destino).toLowerCase();
    if (normSlash(parentDir(origem)).toLowerCase() === d) return true;
    if (!ehPasta) return false;
    return o === d || isUnder(destino, origem);
}
