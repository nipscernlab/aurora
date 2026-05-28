/**
 * path_utils.ts — Tiny path-separator helpers.
 *
 * Aurora has ~5 ad-hoc `replace(/\//g, '\\')` (and inverse) calls scattered
 * across drag&drop handlers and the compilation pipeline. They do the same
 * two things over and over:
 *
 *   1. Convert a path to Windows-native `\` form. Used at boundaries where
 *      external strings (drag&drop payloads, some Electron events) hand us
 *      forward-slash paths even on Windows.
 *
 *   2. Convert to forward-slash form for tools that don't tolerate backslashes
 *      (cygwin-flavoured shells, makefile-style command lines).
 *
 * Behaviour matches the existing inline calls exactly — this is a
 * readability/discoverability fix, not a portability change.
 */

/**
 * Convert any path to Windows-native `\` separators. Idempotent on inputs
 * that already use backslashes.
 */
export function toNativeSeparators(p: string): string {
  if (typeof p !== 'string' || !p) return p;
  return p.replace(/\//g, '\\');
}

/**
 * Convert any path to forward-slash form. Idempotent.
 */
export function toForwardSlashes(p: string): string {
  if (typeof p !== 'string' || !p) return p;
  return p.replace(/\\/g, '/');
}
