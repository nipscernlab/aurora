/**
 * inv_filter.js, `.inv` parser/matcher for the Folders (standard) file-tree.
 *
 * `.inv` is a project-root file (gitignore-style syntax) listing folders/files
 * the user wants GONE from the Folders view while keeping them **tracked in
 * git**. It is NOT a .gitignore: nothing here touches git, the renderer simply
 * drops matching entries before they reach the DOM (and never recurses into a
 * hidden folder), so they vanish from the tree but stay versioned.
 *
 * Pure module (no DOM, no IO) so it is unit-testable. Supported syntax mirrors
 * the common subset of .gitignore:
 *   - blank lines and `# comments` are skipped (`\#` / `\!` escape a literal lead)
 *   - leading `!` negates (re-includes); last matching rule wins
 *   - trailing `/` matches directories only
 *   - a `/` anywhere else anchors the pattern to the project root; otherwise the
 *     pattern matches an entry's basename at ANY depth
 *   - globs: `*` (within a path segment), `?` (one non-`/` char), `**` (across
 *     segments)
 * Matching is case-insensitive (Windows-friendly, like git's default).
 */

const RE_SPECIALS = '\\^$.|+()[]{}';

/** Translate a glob body (no anchoring decision) into a regex source string. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume second '*'
        if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } // `**/` → zero+ dirs
        else out += '.*';                                    // `**`  → anything
      } else {
        out += '[^/]*'; // `*` → within a segment
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (RE_SPECIALS.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Parse `.inv` text into an ordered list of compiled rules.
 * @returns {Array<{re: RegExp, negate: boolean, dirOnly: boolean, anchored: boolean}>}
 */
export function parseInv(text) {
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, ''); // drop trailing whitespace
    if (!line || line.startsWith('#')) continue;

    let negate = false;
    if (line.startsWith('!')) { negate = true; line = line.slice(1); }
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);

    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    if (!line) continue;

    const anchored = line.includes('/'); // separator at start/middle → root-anchored
    let body = line;
    if (body.startsWith('/')) body = body.slice(1);

    try {
      rules.push({ re: new RegExp('^' + globToRegExp(body) + '$', 'i'), negate, dirOnly, anchored });
    } catch (_) { /* skip a pattern that won't compile */ }
  }
  return rules;
}

/**
 * Is `relPath` (relative to the project root, any separator) hidden by `rules`?
 * Anchored rules test the full relative path; unanchored ones test the basename.
 * Last matching rule wins (so `!` re-includes).
 */
export function isInvHidden(relPath, isDir, rules) {
  if (!rules || rules.length === 0) return false;
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) return false;
  const base = rel.split('/').pop();

  let hidden = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    const target = r.anchored ? rel : base;
    if (r.re.test(target)) hidden = !r.negate;
  }
  return hidden;
}
