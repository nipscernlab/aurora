/**
 * Unit tests pra SpfStore — foco em garantias que outras camadas
 * dependem mas nao testam: read coalescing (varias leituras no mesmo
 * tick batem disk uma vez) e a notificacao `aurora:spf-changed`
 * disparada por update().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpfStore } from '../js/project/spf_store.js';

function makeFakeElectronApi() {
    const files = new Map();
    const dirs = new Set(['']);
    const counters = { readFile: 0, fileExists: 0, writeFile: 0 };

    const norm = (p) => p.replace(/\\/g, '/');

    return {
        _files: files,
        _counters: counters,
        fileExists: async (p) => {
            counters.fileExists++;
            return files.has(norm(p)) || dirs.has(norm(p));
        },
        readFile: async (p) => {
            counters.readFile++;
            const c = files.get(norm(p));
            if (c === undefined) throw new Error(`ENOENT: ${p}`);
            return c;
        },
        writeFile: async (p, content) => {
            counters.writeFile++;
            files.set(norm(p), content);
        },
        joinPath: async (...parts) => parts.filter(Boolean).join('/'),
    };
}

// `window` precisa existir antes do import do SpfStore (que faz
// `if (typeof window !== 'undefined') window.SpfStore = ...`). Como
// ja importamos no topo do arquivo, isso ja rodou contra um window
// undefined. Tudo bem — os testes usam SpfStore via import direto,
// nao via window.SpfStore.

beforeEach(() => {
    globalThis.window = {
        electronAPI: makeFakeElectronApi(),
        dispatchEvent: (event) => {
            globalThis.window._lastEvent = event;
            globalThis.window._eventCount = (globalThis.window._eventCount || 0) + 1;
        },
    };
});

afterEach(() => {
    delete globalThis.window;
});

describe('SpfStore.read', () => {
    it('retorna defaults quando o .spf nao existe', async () => {
        const structure = await SpfStore.read('/proj/a.spf');
        expect(structure.processors).toEqual([]);
        expect(structure.synthesizableFiles).toEqual([]);
        expect(structure.testbenchFiles).toEqual([]);
    });

    it('parseia structure de um .spf existente', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            metadata: { projectName: 'a' },
            structure: { processors: [{ name: 'cpu' }], topLevelFile: '/x.v' },
        }));
        const structure = await SpfStore.read('/proj/a.spf');
        expect(structure.processors).toEqual([{ name: 'cpu' }]);
        expect(structure.topLevelFile).toBe('/x.v');
        // Defaults preenchem o resto.
        expect(structure.synthesizableFiles).toEqual([]);
    });

    it('JSON invalido cai pra defaults sem throw', async () => {
        window.electronAPI._files.set('/proj/a.spf', 'not-json');
        const structure = await SpfStore.read('/proj/a.spf');
        expect(structure.processors).toEqual([]);
    });
});

describe('SpfStore read coalescing', () => {
    it('varias leituras no mesmo tick batem readFile uma vez', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            structure: { processors: [{ name: 'cpu' }] },
        }));

        // 6 reads paralelos do mesmo path — o cenario que motivou a
        // mudanca (status_bar + processor_config_panel + file_mode +
        // gtkw_picker + compilation_module + wave_config_manager
        // todos reagindo ao mesmo evento).
        const results = await Promise.all([
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/a.spf'),
        ]);

        expect(results).toHaveLength(6);
        // Todos veem o mesmo conteudo.
        for (const r of results) {
            expect(r.processors).toEqual([{ name: 'cpu' }]);
        }
        // E so 1 readFile fisico — coalescing funcionou.
        expect(window.electronAPI._counters.readFile).toBe(1);
        expect(window.electronAPI._counters.fileExists).toBe(1);
    });

    it('leituras em ticks separados leem do disco de novo', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            structure: { processors: [{ name: 'cpu' }] },
        }));

        await SpfStore.read('/proj/a.spf');
        await SpfStore.read('/proj/a.spf');

        // 2 reads sequenciais (cada um em seu proprio tick apos await)
        // = 2 readFile fisicos. Sem cache atravessando ticks.
        expect(window.electronAPI._counters.readFile).toBe(2);
    });

    it('paths diferentes nao se coalescem entre si', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({ structure: {} }));
        window.electronAPI._files.set('/proj/b.spf', JSON.stringify({ structure: {} }));

        await Promise.all([
            SpfStore.read('/proj/a.spf'),
            SpfStore.read('/proj/b.spf'),
        ]);

        expect(window.electronAPI._counters.readFile).toBe(2);
    });
});

describe('SpfStore.update dispatches aurora:spf-changed', () => {
    it('dispara o evento apos um write bem-sucedido', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            structure: { processors: [] },
        }));

        await SpfStore.update('/proj/a.spf', (s) => {
            s.processors.push({ name: 'cpu' });
        });

        expect(window._eventCount).toBe(1);
        expect(window._lastEvent.type).toBe('aurora:spf-changed');
        expect(window._lastEvent.detail.spfPath).toBe('/proj/a.spf');
        expect(window._lastEvent.detail.source).toBe('renderer');
    });

    it('updates serializados disparam o evento uma vez cada', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({ structure: {} }));

        await Promise.all([
            SpfStore.update('/proj/a.spf', (s) => { s.topLevelFile = 'a.v'; }),
            SpfStore.update('/proj/a.spf', (s) => { s.testbenchFile = 'b.v'; }),
            SpfStore.update('/proj/a.spf', (s) => { s.synthesizableFiles.push({ name: 'c.v', path: '/c.v' }); }),
        ]);

        // Tres writes serializados = tres eventos disparados.
        expect(window._eventCount).toBe(3);
        // Estado final reflete as 3 mutacoes.
        const final = await SpfStore.read('/proj/a.spf');
        expect(final.topLevelFile).toBe('a.v');
        expect(final.testbenchFile).toBe('b.v');
        expect(final.synthesizableFiles).toEqual([{ name: 'c.v', path: '/c.v' }]);
    });
});
