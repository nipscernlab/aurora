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

// --- B12: on-demand AI CLI manifest must track the declared base versions ----
// The Claude Code / Codex native binaries are no longer bundled — they're
// fetched at runtime from a pinned manifest (main/ai/cli_manifest.js). Its
// versions MUST match the package.json dependency versions, or the app would
// declare one version and download another (with a stale integrity hash).
function baseVersion(spec) {
  // The first plain semver in the spec — strips a leading range operator
  // (^, ~, >=, …); the manifest tracks that floor version.
  const m = String(spec || '').match(/\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

let manifest;
try {
  manifest = require('../main/ai/cli_manifest');
} catch (e) {
  fail([`could not load main/ai/cli_manifest.js: ${e instanceof Error ? e.message : e}`]);
}

const cliChecks = [
  { label: '@anthropic-ai/claude-code', manifestVer: manifest.CLAUDE_VERSION, declared: allDeclared['@anthropic-ai/claude-code'] },
  { label: '@openai/codex', manifestVer: manifest.CODEX_VERSION, declared: allDeclared['@openai/codex'] },
];

const manifestFailures = [];
for (const { label, manifestVer, declared } of cliChecks) {
  if (!declared) {
    manifestFailures.push(`${label}: pinned in cli_manifest but missing from package.json dependencies`);
    continue;
  }
  const declaredBase = baseVersion(declared);
  if (declaredBase !== manifestVer) {
    manifestFailures.push(`${label}: cli_manifest pins ${manifestVer}, package.json declares ${declared} (base ${declaredBase})`);
  }
}

if (manifestFailures.length > 0) {
  fail([
    ...manifestFailures,
    '',
    'Fix: bump the version in main/ai/cli_manifest.js to match package.json,',
    'then refresh the tarball URL + integrity from the npm registry:',
    '  npm view <platform-pkg>@<ver> dist.integrity dist.tarball',
  ]);
}

for (const { label, manifestVer } of cliChecks) {
  console.log(`  ✓ cli manifest ${label} ${manifestVer}`);
}

// Cross-check the manifest's integrity + tarball against package-lock.json — the
// authoritative, offline source npm rewrites on every dependency bump. Without
// this, a maintainer could bump the version (which the check above rewards) but
// forget to refresh the integrity hash; the build would ship green and EVERY
// first-use download would abort at runtime with "integrity mismatch".
let lock = null;
try { lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8')); }
catch (_e) { /* no lockfile (e.g. partial checkout) — skip; CI always has one after npm ci */ }

if (lock && lock.packages) {
  const integrityFailures = [];
  let checked = 0;
  for (const kind of ['claude', 'codex']) {
    const cli = manifest.MANIFEST[kind];
    if (!cli) continue;
    for (const [pkey, entry] of Object.entries(cli.platforms)) {
      const lockEntry = lock.packages[`node_modules/${entry.pkg}`];
      if (!lockEntry) continue; // that platform isn't installed here — can't verify offline
      checked++;
      if (lockEntry.integrity && lockEntry.integrity !== entry.integrity) {
        integrityFailures.push(`${entry.pkg} (${pkey}): manifest integrity != package-lock.json`);
      }
      if (lockEntry.resolved && lockEntry.resolved !== entry.tarball) {
        integrityFailures.push(`${entry.pkg} (${pkey}): manifest tarball != package-lock.json (${lockEntry.resolved})`);
      }
    }
  }
  if (integrityFailures.length > 0) {
    fail([
      ...integrityFailures,
      '',
      'The on-demand CLI manifest drifted from package-lock.json. After bumping a',
      'CLI dep, copy its integrity + resolved URL from package-lock.json into',
      'main/ai/cli_manifest.js.',
    ]);
  }
  if (checked > 0) console.log(`  ✓ cli manifest integrity matches package-lock.json (${checked} pkg)`);
}
