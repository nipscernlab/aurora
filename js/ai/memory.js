// memory.js — naming rules for PROJECT MEMORY (<root>/.aurora/memory/<name>.md).
//
// Pure: no DOM, no globals, no IO — same posture as tool_permission.js, so the
// unit suite can cover it without a renderer. The IO itself lives in
// aurora_api.js (project.remember / listMemories / forget); this module owns
// only the part that has to be provably safe.

/**
 * Slugify a memory name into a safe bare filename (no extension).
 *
 * This is a SECURITY BOUNDARY, not cosmetics: `name` is written by the model and
 * becomes a path segment under the project's memory dir. It is an allowlist —
 * the output alphabet is [a-z0-9] plus '-', so `../`, absolute paths, drive
 * letters, NTFS streams, dotfiles and null bytes cannot survive it by
 * construction rather than by a blocklist someone has to keep complete.
 *
 * Returns '' when nothing usable is left; callers MUST treat that as a rejected
 * name rather than substituting a default, or the model could land every memory
 * on one file. Capped at 64 chars to stay well under the path limit.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function memorySlug(name) {
    if (typeof name !== 'string') return '';
    return name
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // acentos → ascii
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .slice(0, 64)
        .replace(/-+$/, '');
}
