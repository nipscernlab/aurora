#!/usr/bin/env node
/**
 * check-monaco-version.js — Guard against monaco-editor drifting off the
 * pinned version.
 *
 * Aurora pins monaco-editor exactly because 0.53.0 throws "Property
 * description must be an object" inside its own css/monaco.contribution.js
 * during initialization. That error blocks EditorManager.initialize() and
 * cascades into a partially-broken editor — cursor visible, typing dead.
 * The symptom is intermittent (depends on which contribution module
 * happens to fail first) so it dodges most casual testing.
 *
 * 0.52.2 is the last release before that upstream regression. Until
 * Monaco fixes 0.53+, we want any drift to fail loudly: locally on
 * `npm start`, in CI on every PR.
 *
 * The script compares the version declared in package.json against the
 * version actually installed in node_modules. Run from package.json
 * `prestart` and from .github/workflows/ci.yml after `npm ci`.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const INSTALLED_PATH = path.join(
  REPO_ROOT, 'node_modules', 'monaco-editor', 'package.json'
);

function fail(msg) {
  console.error('\n  ✗ Monaco version check failed.\n');
  console.error('    ' + msg.split('\n').join('\n    '));
  console.error('');
  process.exit(1);
}

function stripRange(v) {
  // Strip ^ and ~ if someone re-loosens the pin. We don't try to handle
  // ranges (>=, <, ||) — the pin needs to be exact for this guard to mean
  // anything, and the script flags loose pins via the !== compare below.
  return v.replace(/^[\^~]/, '');
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const declared = pkg.dependencies && pkg.dependencies['monaco-editor'];
if (!declared) {
  fail('monaco-editor missing from package.json dependencies.');
}
const expected = stripRange(declared);

let installed;
try {
  installed = JSON.parse(fs.readFileSync(INSTALLED_PATH, 'utf8')).version;
} catch (_e) {
  fail(
    'monaco-editor is not installed in node_modules.\n' +
    'Fix: npm install'
  );
}

if (installed !== expected) {
  fail(
    `Expected monaco-editor ${expected}, got ${installed}.\n\n` +
    `Why this matters: 0.53.x throws inside monaco.contribution.js during\n` +
    `init, which leaves the editor partially broken — cursor renders but\n` +
    `typing is dead. The symptom is intermittent and a nightmare to debug.\n\n` +
    `Fix: npm install monaco-editor@${expected}\n` +
    `or:  rm -rf node_modules && npm ci`
  );
}

console.log(`  ✓ monaco-editor ${installed}`);
