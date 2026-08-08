#!/usr/bin/env node
/**
 * sync-cli-manifest.js — Auto-heal the on-demand AI CLI manifest so it never
 * drifts off the declared dependency versions.
 *
 * Background: the Claude Code / Codex native binaries are fetched at runtime
 * from main/ai/cli_manifest.js, which pins version + tarball URL + integrity
 * hash per platform. Those values are baked in as literals because the manifest
 * runs inside the shipped app, where package-lock.json does not exist — so they
 * cannot be read at runtime and MUST be code-generated at build time.
 *
 * The catch: the version lives in TWO places — package.json (the real
 * dependency, which Dependabot bumps) and the manifest (which nobody bumps).
 * When they diverge, scripts/check-pinned-versions.js fails the build. This
 * script closes that gap: it rewrites the manifest's version constants and
 * per-platform integrity hashes from the authoritative offline sources
 * (package.json for the declared version floor, package-lock.json for the
 * resolved integrity), so a routine `npm install` + build self-heals.
 *
 * It is GENERIC: it walks every CLI and every platform declared in the
 * manifest, so it covers Codex and any CLI added later, not just Claude. The
 * tarball URLs are templated off the version constants, so syncing the version
 * is enough for them to follow.
 *
 * Wiring: runs from `bootstrap` BEFORE check-pinned-versions.js, so local
 * builds auto-correct. CI calls check-pinned-versions.js directly (not via
 * bootstrap), so it stays the strict guard that fails when a synced manifest
 * was not committed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const LOCK_PATH = path.join(REPO_ROOT, 'package-lock.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'main', 'ai', 'cli_manifest.js');

/** The first plain semver in a spec — strips a leading range operator (^, ~, >=, …). */
function baseVersion(spec) {
  const m = String(spec || '').match(/\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

function warnSkip(reason) {
  // Not a hard failure — check-pinned-versions.js is the authoritative guard
  // and will fail loudly if the manifest is genuinely out of sync. This script
  // is a best-effort self-heal; if its inputs are missing, step aside quietly.
  console.log(`  · sync-cli-manifest skipped: ${reason}`);
  process.exit(0);
}

let pkg, lock, manifest;
try {
  pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
} catch (e) {
  warnSkip(`cannot read package.json (${e instanceof Error ? e.message : e})`);
}
try {
  lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
} catch (_e) {
  warnSkip('no package-lock.json (partial checkout) — cannot resolve integrity offline');
}
try {
  manifest = require('../main/ai/cli_manifest');
} catch (e) {
  warnSkip(`cannot load main/ai/cli_manifest.js (${e instanceof Error ? e.message : e})`);
}

if (!lock.packages) warnSkip('package-lock.json has no "packages" map (lockfile v1?)');

const declared = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};

let src = fs.readFileSync(MANIFEST_PATH, 'utf8');
const changes = [];

// --- 1. Version constants -----------------------------------------------------
// Match every `const XXX_VERSION = '<ver>'; // <base-package>` declaration and
// re-pin it to the version package.json declares for that base package. The
// trailing comment tells us which dependency the constant tracks, so we never
// hardcode the constant names here.
src = src.replace(
  /(const \w+_VERSION = ')([^']+)(';\s*\/\/\s*)(\S+)/g,
  (full, prefix, oldVer, mid, basePkg) => {
    const want = baseVersion(declared[basePkg]);
    if (!want) {
      console.log(`  · ${basePkg}: not in package.json dependencies — leaving version as-is`);
      return full;
    }
    if (want !== oldVer) changes.push(`${basePkg}: version ${oldVer} → ${want}`);
    return prefix + want + mid + basePkg;
  }
);

// --- 2. Per-platform integrity hashes -----------------------------------------
// For every platform entry in the manifest, copy the resolved integrity from
// package-lock.json (keyed by the entry's npm package name). Integrity strings
// are unique sha512 values, so replacing the exact old string anywhere in the
// source is unambiguous.
for (const [kind, cli] of Object.entries(manifest.MANIFEST || {})) {
  for (const [platKey, entry] of Object.entries(cli.platforms || {})) {
    const lockEntry = lock.packages[`node_modules/${entry.pkg}`];
    if (!lockEntry || !lockEntry.integrity) {
      console.log(`  · ${kind} ${platKey} (${entry.pkg}): not in lockfile — cannot sync integrity`);
      continue;
    }
    if (lockEntry.integrity !== entry.integrity) {
      if (!src.includes(entry.integrity)) {
        console.log(`  · ${kind} ${platKey}: current integrity not found verbatim in source — skipping`);
        continue;
      }
      src = src.split(entry.integrity).join(lockEntry.integrity);
      changes.push(`${entry.pkg} (${platKey}): integrity refreshed`);
    }
  }
}

// --- Write back ---------------------------------------------------------------
if (changes.length === 0) {
  console.log('  OK  cli manifest already in sync with package.json + package-lock.json');
  process.exit(0);
}

fs.writeFileSync(MANIFEST_PATH, src);
console.log('  OK  cli manifest synced from package.json + package-lock.json:');
for (const c of changes) console.log(`      - ${c}`);
