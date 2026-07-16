import { describe, it, expect } from 'vitest';
import pkg from '../../main/ai/tools.js';

const { TOOL_MANIFEST } = pkg;

// Contract tests for the tool manifest.
//
// tool_runner.js:buildCallArgs turns the model's JSON args into the AuroraAPI
// call, driven ENTIRELY by these fields:
//   'none'       → fn()
//   'object'     → fn(args)
//   'positional' → fn(args[argNames[0]], args[argNames[1]], …)
//
// So a positional def whose argNames don't line up with its own inputSchema
// silently hands the API `undefined` — or, if it says 'object' by mistake, the
// whole args object as the first parameter. Either way the tool fails at
// runtime, on the user, on every call, with nothing catching it earlier: the
// manifest and the API function are wired together by convention, not by types.
describe('TOOL_MANIFEST', () => {
    it('loads', () => {
        expect(Array.isArray(TOOL_MANIFEST)).toBe(true);
        expect(TOOL_MANIFEST.length).toBeGreaterThan(0);
    });

    it('every positional tool declares argNames', () => {
        const bad = TOOL_MANIFEST
            .filter((d) => d.argStyle === 'positional' && !Array.isArray(d.argNames))
            .map((d) => d.name);
        expect(bad).toEqual([]);
    });

    it('every argName is a real property of the tool schema', () => {
        const bad = [];
        for (const d of TOOL_MANIFEST) {
            if (d.argStyle !== 'positional') continue;
            const props = d.inputSchema?.properties || {};
            for (const n of d.argNames || []) if (!(n in props)) bad.push(`${d.name}.${n}`);
        }
        expect(bad).toEqual([]);
    });

    it('every required arg of a positional tool is actually passed through', () => {
        const bad = [];
        for (const d of TOOL_MANIFEST) {
            if (d.argStyle !== 'positional') continue;
            for (const r of d.inputSchema?.required || []) {
                if (!(d.argNames || []).includes(r)) bad.push(`${d.name}.${r}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('no tool declares argStyle none while its schema takes args', () => {
        const bad = TOOL_MANIFEST
            .filter((d) => d.argStyle === 'none' && Object.keys(d.inputSchema?.properties || {}).length > 0)
            .map((d) => d.name);
        expect(bad).toEqual([]);
    });

    it('every tool has a name, description, access and api pair', () => {
        const bad = [];
        for (const d of TOOL_MANIFEST) {
            if (!d.name || !d.description) bad.push(`${d.name || '?'}: name/description`);
            if (!['read', 'write'].includes(d.access)) bad.push(`${d.name}: access=${d.access}`);
            if (!Array.isArray(d.api) || d.api.length !== 2) bad.push(`${d.name}: api`);
        }
        expect(bad).toEqual([]);
    });

    it('names are unique', () => {
        const seen = new Set();
        const dupes = [];
        for (const d of TOOL_MANIFEST) {
            if (seen.has(d.name)) dupes.push(d.name);
            seen.add(d.name);
        }
        expect(dupes).toEqual([]);
    });

    // The three memory tools, specifically — they are what this pass added.
    it('wires the memory tools to the project namespace', () => {
        const by = (n) => TOOL_MANIFEST.find((d) => d.name === n);
        expect(by('remember')).toMatchObject({
            access: 'write', api: ['project', 'remember'],
            argStyle: 'positional', argNames: ['name', 'content'],
        });
        expect(by('forget')).toMatchObject({
            access: 'write', api: ['project', 'forget'],
            argStyle: 'positional', argNames: ['name'],
        });
        expect(by('list_memories')).toMatchObject({
            access: 'read', api: ['project', 'listMemories'], argStyle: 'none',
        });
    });
});
