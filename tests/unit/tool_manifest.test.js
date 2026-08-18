import { readFileSync } from 'node:fs';

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
// silently hands the API `undefined`, or, if it says 'object' by mistake, the
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

    // The three memory tools, specifically, they are what this pass added.
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

    // O comentário no topo deste arquivo diz que o manifesto e a função da API
    // são ligados por convenção, e não por tipos. Este é o teste dessa
    // convenção: um `api: [ns, fn]` que não existe do outro lado vira uma
    // ferramenta anunciada ao modelo que falha só quando o usuário a usa.
    //
    // O mapa NAMESPACES de js/api/aurora_api.js é a lista canônica do que a
    // API expõe, então é contra ele que conferimos. Lemos como texto de
    // propósito: aurora_api.js importa o Monaco e não carrega no Node.
    it('every api pair exists in the AuroraAPI namespace it names', () => {
        // Lemos como texto de propósito: aurora_api.js importa o Monaco e não
        // carrega no Node. Os objetos são `const <ns>Ns = { ... }` e é contra
        // eles que o runtime despacha.
        const fontes = ['../../js/api/aurora_api.js', '../../js/api/git_ns.js']
            .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'))
            .join('\n');

        /** Métodos declarados no literal `const <ns>Ns = {` . */
        const metodosDe = (ns) => {
            const marca = `const ${ns}Ns = {`;
            const i = fontes.indexOf(marca);
            if (i < 0) return null;
            const abre = i + marca.length - 1;
            let nivel = 0, fim = -1;
            for (let j = abre; j < fontes.length; j++) {
                if (fontes[j] === '{') nivel++;
                else if (fontes[j] === '}') { nivel--; if (nivel === 0) { fim = j; break; } }
            }
            if (fim < 0) return null;
            // Só o primeiro nível: um método é `  nome(` ou `  async nome(`,
            // com exatamente dois espaços de indentação.
            return new Set([...fontes.slice(abre, fim)
                .matchAll(/^ {2}(?:async\s+)?(\w+)\s*\(/gm)].map((m) => m[1]));
        };

        const cache = new Map();
        const faltando = [];
        for (const def of TOOL_MANIFEST) {
            const [ns, fn] = def.api;
            if (!cache.has(ns)) cache.set(ns, metodosDe(ns));
            const metodos = cache.get(ns);
            if (!metodos) { faltando.push(`${def.name} -> namespace ${ns} nao encontrado`); continue; }
            if (!metodos.has(fn)) faltando.push(`${def.name} -> ${ns}.${fn}`);
        }
        expect(faltando).toEqual([]);
    });

    // O modelo NAO ve o codigo: ele ve estes textos e so eles. Um parametro sem
    // descricao vira valor chutado, e uma descricao de tres palavras vira
    // ferramenta usada na hora errada. A auditoria de 08/08/2026 achou 50
    // parametros mudos e duas descricoes curtas demais; isto impede a volta.
    it('every tool description actually says something', () => {
        const magras = TOOL_MANIFEST
            .filter((d) => !d.description || d.description.trim().length < 25)
            .map((d) => d.name);
        expect(magras).toEqual([]);
    });

    it('every tool parameter is described', () => {
        const mudos = [];
        for (const def of TOOL_MANIFEST) {
            for (const [k, v] of Object.entries(def.inputSchema?.properties || {})) {
                if (!v.description || !String(v.description).trim()) mudos.push(`${def.name}.${k}`);
            }
        }
        expect(mudos).toEqual([]);
    });

    it('no required arg points at a property that does not exist', () => {
        const orfaos = [];
        for (const def of TOOL_MANIFEST) {
            const props = def.inputSchema?.properties || {};
            for (const r of def.inputSchema?.required || []) {
                if (!(r in props)) orfaos.push(`${def.name}.${r}`);
            }
        }
        expect(orfaos).toEqual([]);
    });

    // Uma ferramenta citada no prompt e que nao existe ensina o modelo a
    // inventar chamadas que vao falhar.
    it('the system prompt never names a tool that does not exist', () => {
        const prompt = readFileSync(
            new URL('../../js/ai/system_prompt.js', import.meta.url), 'utf8');
        const nomes = new Set(TOOL_MANIFEST.map((d) => d.name));
        const verbo = /^(get|set|list|read|write|create|delete|open|run|compile|add|remove|rename|import|select|ask|save|close|insert|replace|move|reopen|backup|toggle|search|format|remember|forget|clear|stage|unstage|commit|discard|fetch|pull|push|stash|switch)_/;
        const candidatos = [...new Set(
            [...prompt.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,4})\b/g)].map((m) => m[1]),
        )];
        const fantasmas = candidatos.filter((n) => verbo.test(n) && !nomes.has(n));
        expect(fantasmas).toEqual([]);
    });

    // A varinha e a IA compartilham um caminho só de formatação.
    it('wires format_file to the editor namespace', () => {
        expect(TOOL_MANIFEST.find((d) => d.name === 'format_file')).toMatchObject({
            access: 'write', api: ['editor', 'formatFile'], argStyle: 'object',
        });
    });
});
