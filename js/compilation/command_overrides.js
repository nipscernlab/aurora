/**
 * command_overrides.ts — registry of pending and persisted command
 * overrides for the compilation pipeline.
 *
 * Two layers, two lifetimes:
 *
 *   - Ephemeral (in-memory Map): set by `setOverride(..., persist:false)`.
 *     Survives only until the next invocation of the matching step;
 *     the executor wrapper consumes it and clears the slot. Good for
 *     "try this one flag for the next compile".
 *
 *   - Persisted (.spf structure.commandOverrides): set by
 *     `setOverride(..., persist:true)`. Survives across sessions, ships
 *     with the project, and stacks under ephemeral when both exist
 *     (ephemeral wins for that single run).
 *
 * Override keys are `<step>` for global, `<step>:<processorName>` for
 * per-processor. Per-processor wins over global when both apply.
 *
 * This module is renderer-side because it needs SpfStore and lives next
 * to the builders. The main-process executor never re-reads the store
 * — the renderer applies overrides into the spec before calling
 * `electronAPI.execSpec`.
 *
 * Compilado por `tsc` (npm run build:ts) num command_overrides.js ao lado — é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */
import { SpfStore } from '../project/spf_store.js';
import * as CommandSpec from './command_spec.js';
/** Ephemeral overrides keyed by `<step>` or `<step>:<processor>`. */
const ephemeral = new Map();
function makeKey(step, processorName) {
    return processorName ? `${step}:${processorName}` : step;
}
function parseKey(key) {
    const idx = key.indexOf(':');
    if (idx === -1)
        return { step: key, processorName: null };
    return { step: key.slice(0, idx), processorName: key.slice(idx + 1) };
}
/**
 * Pure merge: combine two overrides (later wins for primitives,
 * arrays concatenate, removeArgs dedupes).
 */
function mergeOverrides(a, b) {
    if (!a)
        return b ? { ...b } : null;
    if (!b)
        return { ...a };
    return {
        appendArgs: [...(a.appendArgs || []), ...(b.appendArgs || [])],
        prependArgs: [...(a.prependArgs || []), ...(b.prependArgs || [])],
        removeArgs: [...new Set([...(a.removeArgs || []), ...(b.removeArgs || [])])],
        envSet: { ...(a.envSet || {}), ...(b.envSet || {}) },
        envUnset: [...new Set([...(a.envUnset || []), ...(b.envUnset || [])])],
        note: [a.note, b.note].filter(Boolean).join(' | ') || undefined,
        scope: b.scope || a.scope,
    };
}
async function readPersisted() {
    const spfPath = window.currentSpfPath;
    if (!spfPath)
        return {};
    try {
        const structure = await SpfStore.read(spfPath);
        return structure.commandOverrides || {};
    }
    catch (_) {
        return {};
    }
}
async function writePersisted(updater) {
    const spfPath = window.currentSpfPath;
    if (!spfPath)
        throw new Error('No project is open — cannot persist override');
    await SpfStore.update(spfPath, (structure) => {
        if (!structure.commandOverrides || typeof structure.commandOverrides !== 'object') {
            structure.commandOverrides = {};
        }
        updater(structure.commandOverrides);
    });
}
/**
 * Resolve the effective override for `(step, processorName)`.
 * Combines:
 *   1. persisted global   (step alone)
 *   2. persisted specific (step:processor)
 *   3. ephemeral global   (step alone)
 *   4. ephemeral specific (step:processor)
 * in that order so the most-specific most-recent layer wins.
 *
 * Returns `{ override, sources }` where `sources` lists which layers
 * contributed (for audit + UX).
 */
export async function resolveOverride(step, processorName) {
    const persisted = await readPersisted();
    let merged = null;
    const sources = [];
    const tryLayer = (key, layer, source) => {
        const ov = layer instanceof Map ? layer.get(key) : layer[key];
        if (ov) {
            merged = mergeOverrides(merged, ov);
            sources.push({ source, key });
        }
    };
    tryLayer(makeKey(step, null), persisted, 'persisted:global');
    if (processorName)
        tryLayer(makeKey(step, processorName), persisted, 'persisted:processor');
    tryLayer(makeKey(step, null), ephemeral, 'ephemeral:global');
    if (processorName)
        tryLayer(makeKey(step, processorName), ephemeral, 'ephemeral:processor');
    return { override: merged, sources };
}
/**
 * Apply any resolved override to the base spec and return both, so
 * the caller can log/diff/audit. `consumeEphemeral:true` removes the
 * ephemeral slot after read — what the actual executor wrapper does
 * on each step invocation.
 */
export async function applyResolved(baseSpec, options = {}) {
    const { step, processorName } = baseSpec;
    const { override, sources } = await resolveOverride(step, processorName);
    const appliedSpec = override ? CommandSpec.applyOverride(baseSpec, override) : baseSpec;
    if (options.consumeEphemeral && override) {
        const globalKey = makeKey(step, null);
        const specificKey = makeKey(step, processorName);
        if (ephemeral.has(globalKey))
            ephemeral.delete(globalKey);
        if (ephemeral.has(specificKey))
            ephemeral.delete(specificKey);
    }
    return { baseSpec, appliedSpec, override, sources };
}
/**
 * Register an override. `persist:true` writes to .spf and survives
 * sessions; `persist:false` (default) stays in memory until the next
 * matching step runs.
 *
 * Throws if the spec or shape is invalid. The protected-flag check
 * happens later (in the main executor) against the actual base spec
 * — we can't run it here without rebuilding the base.
 */
export async function setOverride({ step, processorName = null, override, persist = false, note }) {
    if (!step)
        throw new Error('setOverride: step is required');
    if (!override || typeof override !== 'object')
        throw new Error('setOverride: override is required');
    const scope = persist ? 'persisted' : 'ephemeral';
    const cleaned = {
        ...(override.appendArgs ? { appendArgs: override.appendArgs } : {}),
        ...(override.prependArgs ? { prependArgs: override.prependArgs } : {}),
        ...(override.removeArgs ? { removeArgs: override.removeArgs } : {}),
        ...(override.envSet ? { envSet: override.envSet } : {}),
        ...(override.envUnset ? { envUnset: override.envUnset } : {}),
        note: note || override.note || undefined,
        scope,
    };
    const key = makeKey(step, processorName);
    if (persist) {
        await writePersisted((map) => { map[key] = cleaned; });
    }
    else {
        ephemeral.set(key, cleaned);
    }
    return { key, scope };
}
export async function clearOverride({ step, processorName = null, scope = 'both' }) {
    const key = makeKey(step, processorName);
    const cleared = { ephemeral: false, persisted: false };
    if (scope === 'ephemeral' || scope === 'both') {
        if (ephemeral.delete(key))
            cleared.ephemeral = true;
    }
    if (scope === 'persisted' || scope === 'both') {
        let had = false;
        try {
            await writePersisted((map) => {
                if (map[key]) {
                    delete map[key];
                    had = true;
                }
            });
        }
        catch (_) { /* no project open — nothing to clear */ }
        cleared.persisted = had;
    }
    return { key, ...cleared };
}
/** Snapshot of every active override across both layers. */
export async function listOverrides() {
    const persisted = await readPersisted();
    const out = [];
    for (const [key, ov] of Object.entries(persisted)) {
        out.push({ key, ...parseKey(key), scope: 'persisted', override: ov });
    }
    for (const [key, ov] of ephemeral.entries()) {
        out.push({ key, ...parseKey(key), scope: 'ephemeral', override: ov });
    }
    return out;
}
/**
 * Test helper / safety hatch: wipe all in-memory overrides. Persisted
 * ones stay on disk. Called by close-project so a stale ephemeral
 * doesn't bleed into the next project's first run.
 */
export function clearAllEphemeral() {
    ephemeral.clear();
}
if (typeof window !== 'undefined') {
    window.CommandOverrides = {
        resolveOverride,
        applyResolved,
        setOverride,
        clearOverride,
        listOverrides,
        clearAllEphemeral,
    };
}
