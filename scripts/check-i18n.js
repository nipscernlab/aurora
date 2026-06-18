// @ts-check
/**
 * check-i18n.js — i18n consistency audit (G4).
 *
 * Three checks, all from the real tree:
 *   1. EN/PT sync — every key in locales/en.json exists in locales/pt.json and
 *      vice-versa (a string translated in one language but not the other).
 *   2. Referenced-but-undefined — every key used via `data-i18n*` (HTML),
 *      `window.t('…')` or the `tt('…', fallback)` helper resolves to a key in
 *      en.json (a UI element that would otherwise show the raw `foo.bar` path).
 *
 * Exit 1 on any real inconsistency. Run: node scripts/check-i18n.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function loadLocale(name) {
  const p = path.join(ROOT, 'locales', name);
  return flatten(JSON.parse(fs.readFileSync(p, 'utf8')), '', {});
}

const en = loadLocale('en.json');
const pt = loadLocale('pt.json');
const enKeys = new Set(Object.keys(en));
const ptKeys = new Set(Object.keys(pt));

const inEnNotPt = [...enKeys].filter((k) => !ptKeys.has(k));
const inPtNotEn = [...ptKeys].filter((k) => !enKeys.has(k));

// --- referenced keys (HTML attrs + window.t + tt helper) ---
const REF_PATTERNS = [
  /data-i18n(?:-[a-z-]+)?\s*=\s*["']([^"']+)["']/g,
  /\bwindow\.t\(\s*["'`]([^"'`]+)["'`]/g,
  /\btt\(\s*["'`]([^"'`]+)["'`]/g,
];
const referenced = new Set();
const files = execSync('git ls-files "*.html" "*.js"', { encoding: 'utf8' })
  .split('\n').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean)
  .filter((f) => !f.startsWith('node_modules/') && !f.includes('/vendor/'))
  // i18n.js and this script itself document the i18n syntax with example keys
  // (`path.to.key`, `…`) in comments — not real references.
  .filter((f) => f !== 'js/i18n/i18n.js' && f !== 'scripts/check-i18n.js');
for (const f of files) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
  for (const re of REF_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      // Only treat it as a key if it looks like one (starts with a letter, then
      // word chars / dots / hyphens) — skips junk like a bare `…` from an example.
      if (/^[A-Za-z][\w.-]*$/.test(m[1])) referenced.add(m[1]);
    }
  }
}
const refMissing = [...referenced].filter((k) => !enKeys.has(k));

let bad = false;
function report(title, arr, fail) {
  if (!arr.length) return;
  if (fail) bad = true;
  console.log(`\n${title} (${arr.length}):`);
  for (const k of arr.sort()) console.log(`  ${k}`);
}

report('FAIL — in en.json but MISSING in pt.json', inEnNotPt, true);
report('FAIL — in pt.json but MISSING in en.json', inPtNotEn, true);
report('FAIL — referenced (data-i18n / window.t / tt) but UNDEFINED in en.json', refMissing, true);

if (bad) {
  console.log('\n[check-i18n] FAIL — fix the inconsistencies above.');
  process.exit(1);
}
console.log(`[check-i18n] OK — en=${enKeys.size} pt=${ptKeys.size} keys; all referenced keys defined; en/pt in sync.`);
