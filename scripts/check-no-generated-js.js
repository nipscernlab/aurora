// @ts-check
/**
 * check-no-generated-js.js — CI guard for the .ts → .js in-place build.
 *
 * `tsc` emits each TypeScript module's .js next to its .ts (outDir "."). Those
 * .js are BUILD ARTEFACTS and are gitignored (B5) so the committed tree never
 * drifts from the source. This guard fails CI if any generated .js (a tracked
 * .js that has a tracked .ts sibling) sneaks back into git — which would
 * re-introduce the exact .ts/.js desync B4/B5 closed.
 *
 * Pairs with `tsc --noEmit` in CI: that proves the .ts type-checks; this proves
 * no stale generated .js is committed alongside it.
 *
 * Usage: node scripts/check-no-generated-js.js
 */

'use strict';

const { execSync } = require('child_process');

/** @returns {string[]} forward-slashed tracked paths */
function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

function main() {
  let files;
  try { files = trackedFiles(); }
  catch (e) {
    console.error('[check-no-generated-js] could not list tracked files:', e instanceof Error ? e.message : e);
    process.exit(0); // not in a git checkout — don't block
    return;
  }

  const trackedSet = new Set(files);
  const offenders = files.filter((f) => f.endsWith('.js') && trackedSet.has(`${f.slice(0, -3)}.ts`));

  if (offenders.length) {
    console.error('[check-no-generated-js] FAIL — generated .js committed (they have a .ts sibling and');
    console.error('must stay gitignored; edit the .ts source, never the emitted .js):');
    for (const o of offenders) console.error(`  - ${o}`);
    console.error('\nFix: `git rm --cached <file>` and confirm it is matched by .gitignore.');
    process.exit(1);
  }
  console.log(`[check-no-generated-js] OK — no generated .js tracked (${files.length} files scanned).`);
}

main();
