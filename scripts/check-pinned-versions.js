#!/usr/bin/env node
/**
 * check-pinned-versions.js — Guard against installed npm packages drifting
 * off their exact-pinned declared versions.
 *
 * The convention: a dependency in package.json with a bare semver
 * (no `^`, `~`, or other range modifier) is opted-in to strict checking.
 * Anything with a range stays unmanaged — npm is free to resolve it as
 * usual. To strictly pin a new package, drop its caret in package.json
 * and this script will start watching it on the next run.
 *
 * Background: monaco-editor 0.53.0 throws inside its own
 * monaco.contribution.js during init, blocking EditorManager.initialize()
 * and leaving the editor half-broken — cursor renders, typing is dead.
 * That class of upstream regression is what this guard exists to catch
 * before the user does. monaco-editor is the only one we know of today
 * (and the only one currently pinned), but the mechanism extends with
 * zero ceremony to electron, electron-builder, electron-updater, etc.
 * if a similar issue surfaces.
 *
 * Run from package.json `prestart` and from .github/workflows/ci.yml
 * after `npm ci`.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');

// Plain semver, no range modifier, no operators. Pre-release allowed
// (e.g. "1.0.0-beta.3"). Build metadata not allowed because npm strips
// it on resolve and the comparison would always fail.
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function fail(lines) {
  console.error('\n  ✗ Pinned-version check failed.\n');
  for (const line of lines) {
    console.error('    ' + line);
  }
  console.error('');
  process.exit(1);
}

function readInstalledVersion(pkgName) {
  const installedPkgPath = path.join(REPO_ROOT, 'node_modules', pkgName, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(installedPkgPath, 'utf8')).version;
  } catch (_e) {
    return null;
  }
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

// Walk dependencies + devDependencies. Peer/optional are not in this
// repo today; if that changes, add them here.
const allDeclared = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};

const pinned = Object.entries(allDeclared).filter(([, spec]) => EXACT_SEMVER_RE.test(spec));

if (pinned.length === 0) {
  // Not an error — just nothing to check. Surface it so the user can
  // see the script ran rather than silently no-opping.
  console.log('  · no exact-pinned dependencies in package.json (nothing to check)');
  process.exit(0);
}

const failures = [];
const passed = [];

for (const [name, expected] of pinned) {
  const installed = readInstalledVersion(name);
  if (installed === null) {
    failures.push({ name, expected, installed: '(not installed)' });
    continue;
  }
  if (installed !== expected) {
    failures.push({ name, expected, installed });
    continue;
  }
  passed.push({ name, version: installed });
}

if (failures.length > 0) {
  const lines = [];
  for (const { name, expected, installed } of failures) {
    lines.push(`${name}: expected ${expected}, got ${installed}`);
  }
  lines.push('');
  lines.push('Fix: npm install');
  lines.push('or:  rm -rf node_modules && npm ci');
  lines.push('');
  lines.push('If a pinned version is intentionally wrong (e.g. testing a new');
  lines.push("release), update package.json — don't bypass this check.");
  fail(lines);
}

for (const { name, version } of passed) {
  console.log(`  ✓ ${name} ${version}`);
}
