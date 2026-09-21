#!/usr/bin/env node
/**
 * sync-cli-manifest.js: Auto-heal the on-demand AI CLI manifest so it never
 * drifts off the declared dependency versions.
 *
 * Background: the Claude Code / Codex native binaries are fetched at runtime
 * from main/ai/cli_manifest.json, which pins version + tarball URL + integrity
 * hash per platform. Those values are baked in as literals because the manifest
 * runs inside the shipped app, where package-lock.json does not exist, so they
 * cannot be read at runtime and MUST be code-generated at build time.
 *
 * The catch: the version lives in TWO places, package.json (the real
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
const MANIFEST_PATH = path.join(REPO_ROOT, 'main', 'ai', 'cli_manifest.json');

/** The first plain semver in a spec, strips a leading range operator (^, ~, >=, …). */
function baseVersion(spec) {
  const m = String(spec || '').match(/\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

function warnSkip(reason) {
  // Not a hard failure, check-pinned-versions.js is the authoritative guard
  // and will fail loudly if the manifest is genuinely out of sync. This script
  // is a best-effort self-heal; if its inputs are missing, step aside quietly.
  console.log(`  · sync-cli-manifest skipped: ${reason}`);
  process.exit(0);
}

let pkg, lock;
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

if (!lock.packages) warnSkip('package-lock.json has no "packages" map (lockfile v1?)');

const declared = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};

const dados = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const changes = [];

// --- 1. Versoes ---------------------------------------------------------------
// Cada CLI do manifesto declara o pacote base que ele acompanha (`base`), e a
// versao dele vem do que o package.json declara para esse pacote. O nome do
// pacote esta no dado, entao nada e cravado aqui.
for (const cli of Object.values(dados)) {
  if (!cli || typeof cli !== 'object' || !cli.base) continue;   // ignora o _leia
  const want = baseVersion(declared[cli.base]);
  if (!want) {
    console.log(`  \u00b7 ${cli.base}: not in package.json dependencies \u2014 leaving version as-is`);
    continue;
  }
  if (want !== cli.version) {
    changes.push(`${cli.base}: version ${cli.version} \u2192 ${want}`);
    cli.version = want;
  }
}

// --- 2. Integridade por plataforma --------------------------------------------
// Para cada entrada de plataforma, copia a integridade resolvida no
// package-lock.json, achada pelo nome do pacote da propria entrada.
for (const [kind, cli] of Object.entries(dados)) {
  if (!cli || typeof cli !== 'object' || !cli.platforms) continue;
  for (const [platKey, entry] of Object.entries(cli.platforms)) {
    const lockEntry = lock.packages[`node_modules/${entry.pkg}`];
    if (!lockEntry || !lockEntry.integrity) {
      console.log(`  \u00b7 ${kind} ${platKey} (${entry.pkg}): not in lockfile \u2014 cannot sync integrity`);
      continue;
    }
    if (lockEntry.integrity !== entry.integrity) {
      entry.integrity = lockEntry.integrity;
      changes.push(`${entry.pkg} (${platKey}): integrity refreshed`);
    }
    // A URL e a versao da plataforma vem do lockfile pelo mesmo caminho: sao o
    // que o npm realmente resolveu, e e contra isso que o verificador compara.
    if (lockEntry.resolved && lockEntry.resolved !== entry.tarball) {
      changes.push(`${entry.pkg} (${platKey}): tarball ${entry.tarball} → ${lockEntry.resolved}`);
      entry.tarball = lockEntry.resolved;
    }
    if (lockEntry.version && lockEntry.version !== entry.version) {
      changes.push(`${entry.pkg} (${platKey}): version ${entry.version} → ${lockEntry.version}`);
      entry.version = lockEntry.version;
    }
  }
}

// --- Write back ---------------------------------------------------------------
if (changes.length === 0) {
  console.log('  OK  cli manifest already in sync with package.json + package-lock.json');
  process.exit(0);
}

fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(dados, null, 2)}\n`);
console.log('  OK  cli manifest synced from package.json + package-lock.json:');
for (const c of changes) console.log(`      - ${c}`);
