// Regression tests for the monaco-editor version pin (ARCHITECTURE.md §8).
//
// monaco-editor 0.53.0 throws inside its own monaco.contribution.js during
// init, blocking EditorManager.initialize() and leaving the editor
// half-broken (cursor renders, typing dead). So the version is pinned
// EXACTLY (no caret) in package.json and verified by
// scripts/check-pinned-versions.js on prestart and in CI.
//
// The guard has one blind spot it cannot close itself: a ranged spec
// (^0.52.2) opts OUT of strict checking, so relaxing the pin makes the
// guard silently stop watching monaco, npm is then free to pull 0.53.
// The package.json invariant test below is what closes that gap; the
// end-to-end test confirms the guard is actually wired up and watching.
//
// Runs in the default node environment (no DOM): it only reads files and
// shells out to the guard script.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

// The exact-semver rule the guard uses to decide what is "pinned":
// bare semver, no range operator. Kept in sync with check-pinned-versions.js.
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function declaredSpec(name) {
    return PKG.dependencies?.[name] ?? PKG.devDependencies?.[name] ?? null;
}

describe('monaco-editor pin in package.json (§8)', () => {
    it('is declared with an exact version — no caret, tilde, or range', () => {
        const spec = declaredSpec('monaco-editor');
        expect(spec).not.toBeNull();
        // A ranged spec (e.g. ^0.52.2) would let npm resolve 0.53+ AND drop
        // monaco from the guard's strict check, the exact failure §8 forbids.
        expect(spec).toMatch(EXACT_SEMVER_RE);
        expect(spec).toBe('0.52.2');
    });

    it('common relaxations would not satisfy the exact-pin rule', () => {
        // Documents why the assertion above matters: every loosened form of
        // the same version fails the rule the guard keys off.
        expect(EXACT_SEMVER_RE.test('0.52.2')).toBe(true);
        for (const ranged of ['^0.52.2', '~0.52.2', '>=0.52.2', '0.52.x', '*', 'latest']) {
            expect(EXACT_SEMVER_RE.test(ranged)).toBe(false);
        }
    });
});

describe('check-pinned-versions.js guard (§8)', () => {
    it('runs green today and reports monaco-editor as a watched, matching pin', () => {
        const script = join(REPO_ROOT, 'scripts', 'check-pinned-versions.js');
        let stdout = '';
        try {
            stdout = execFileSync('node', [script], { cwd: REPO_ROOT, encoding: 'utf8' });
        } catch (err) {
            // Non-zero exit means some pinned dep drifted, surface the guard's
            // own diagnostics so the failure is actionable.
            throw new Error(`guard exited non-zero:\n${err.stdout ?? ''}\n${err.stderr ?? ''}`, { cause: err });
        }
        // Proves monaco-editor is in the set the guard actually verifies
        // (installed === declared), not silently dropped from watching.
        expect(stdout).toMatch(/monaco-editor\s+0\.52\.2/);
    });
});
