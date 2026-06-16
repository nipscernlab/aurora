/**
 * Unit tests pra SpfStore — foco em garantias que outras camadas
 * dependem mas nao testam: read coalescing (varias leituras no mesmo
 * tick batem disk uma vez) e a notificacao `aurora:spf-changed`
 * disparada por update().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpfStore } from '../../js/project/spf_store.ts';

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

        // Mutators usam paths absolutos (igual ao caller real — file
        // tree sempre tem caminho absoluto via electronAPI). SpfStore
        // grava como relativo no disco se estiver dentro do basePath
        // (= dirname do .spf), mas leitura retorna absoluto de novo.
        await Promise.all([
            SpfStore.update('/proj/a.spf', (s) => { s.topLevelFile = '/proj/a.v'; }),
            SpfStore.update('/proj/a.spf', (s) => { s.testbenchFile = '/proj/b.v'; }),
            SpfStore.update('/proj/a.spf', (s) => { s.synthesizableFiles.push({ name: 'c.v', path: '/c.v' }); }),
        ]);

        // Tres writes serializados = tres eventos disparados.
        expect(window._eventCount).toBe(3);
        // Estado final reflete as 3 mutacoes (todos absolutos no read).
        const final = await SpfStore.read('/proj/a.spf');
        expect(final.topLevelFile).toBe('/proj/a.v');
        expect(final.testbenchFile).toBe('/proj/b.v');
        expect(final.synthesizableFiles).toEqual([{ name: 'c.v', path: '/c.v' }]);
    });

    it('mutator no-op NAO dispara evento', async () => {
        // Path absoluto pra match com o que read() vai retornar
        // (normalizacao expande relativos pra absoluto).
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            structure: { topLevelFile: '/proj/a.v', synthesizableFiles: [] },
        }));

        // Mutator que NAO muda structure (escreve o mesmo valor).
        await SpfStore.update('/proj/a.spf', (s) => {
            s.topLevelFile = '/proj/a.v';
        });

        // Update vazio idem.
        await SpfStore.update('/proj/a.spf', () => {});

        // Nenhum evento foi disparado.
        expect(window._eventCount).toBeUndefined();
    });

    it('mutator que muda structure dispara, no-op subsequente nao', async () => {
        window.electronAPI._files.set('/proj/a.spf', JSON.stringify({
            structure: { synthesizableFiles: [] },
        }));

        await SpfStore.update('/proj/a.spf', (s) => {
            s.synthesizableFiles.push({ name: 'a.v', path: '/a.v' });
        });
        expect(window._eventCount).toBe(1);

        // Mesma push gera mesmo estado — sem dedup do caller, o
        // mutator empurra de novo. STRUCTURE muda (array tem 2
        // entries agora). Event dispara.
        // Cobre o caso onde queremos garantir que comparamos
        // structure de verdade, nao so a referencia do objeto.
        await SpfStore.update('/proj/a.spf', (s) => {
            s.synthesizableFiles.push({ name: 'a.v', path: '/a.v' });
        });
        expect(window._eventCount).toBe(2);

        // Agora um no-op explicito.
        await SpfStore.update('/proj/a.spf', () => {});
        expect(window._eventCount).toBe(2);
    });
});

describe('SpfStore path normalization (relative-on-disk, absolute-in-memory)', () => {
    it('read: .spf antigo com paths absolutos continua funcionando (backward compat)', async () => {
        // .spf gravado antes do feature de relative paths.
        window.electronAPI._files.set('/proj/teste.spf', JSON.stringify({
            structure: {
                basePath: '/proj/teste',
                topLevelFile: '/proj/teste/top.v',
                testbenchFile: '/proj/teste/sim/tb.v',
                synthesizableFiles: [
                    { name: 'top.v', path: '/proj/teste/top.v' },
                    { name: 'helper.v', path: '/other/helper.v' },
                ],
            },
        }));
        const s = await SpfStore.read('/proj/teste.spf');
        // Tudo retorna absoluto, sem mudanca.
        expect(s.topLevelFile).toBe('/proj/teste/top.v');
        expect(s.testbenchFile).toBe('/proj/teste/sim/tb.v');
        expect(s.synthesizableFiles[0].path).toBe('/proj/teste/top.v');
        expect(s.synthesizableFiles[1].path).toBe('/other/helper.v');
    });

    it('read: paths relativos sao expandidos pra absoluto baseado em basePath', async () => {
        window.electronAPI._files.set('/proj/teste.spf', JSON.stringify({
            structure: {
                basePath: '/proj/teste',
                topLevelFile: 'top.v',
                synthesizableFiles: [{ name: 'top.v', path: 'top.v' }],
            },
        }));
        const s = await SpfStore.read('/proj/teste.spf');
        expect(s.topLevelFile).toBe('/proj/teste/top.v');
        expect(s.synthesizableFiles[0].path).toBe('/proj/teste/top.v');
    });

    it('read: sem basePath, usa dirname do .spf como fallback', async () => {
        window.electronAPI._files.set('/proj/teste/a.spf', JSON.stringify({
            structure: {
                topLevelFile: 'top.v',
            },
        }));
        const s = await SpfStore.read('/proj/teste/a.spf');
        expect(s.topLevelFile).toBe('/proj/teste/top.v');
    });

    it('update: paths dentro de basePath sao gravados como relativos', async () => {
        window.electronAPI._files.set('/proj/teste.spf', JSON.stringify({
            structure: { basePath: '/proj/teste' },
        }));
        await SpfStore.update('/proj/teste.spf', (s) => {
            s.topLevelFile = '/proj/teste/top.v';
            s.synthesizableFiles = [{ name: 'top.v', path: '/proj/teste/top.v' }];
        });
        // Inspeciona o que foi GRAVADO no disco.
        const onDisk = JSON.parse(window.electronAPI._files.get('/proj/teste.spf'));
        expect(onDisk.structure.topLevelFile).toBe('top.v');
        expect(onDisk.structure.synthesizableFiles[0].path).toBe('top.v');
    });

    it('update: paths fora de basePath sao mantidos absolutos', async () => {
        window.electronAPI._files.set('/proj/teste.spf', JSON.stringify({
            structure: { basePath: '/proj/teste' },
        }));
        await SpfStore.update('/proj/teste.spf', (s) => {
            s.synthesizableFiles = [{ name: 'lib.v', path: '/other/lib.v' }];
        });
        const onDisk = JSON.parse(window.electronAPI._files.get('/proj/teste.spf'));
        expect(onDisk.structure.synthesizableFiles[0].path).toBe('/other/lib.v');
    });

    it('migracao organica: ler .spf antigo + salvar = paths inside-base viram relativos', async () => {
        // Estado inicial: tudo absoluto (formato antigo).
        window.electronAPI._files.set('/proj/teste.spf', JSON.stringify({
            structure: {
                basePath: '/proj/teste',
                topLevelFile: '/proj/teste/top.v',
                synthesizableFiles: [
                    { name: 'a.v', path: '/proj/teste/a.v' },
                    { name: 'lib.v', path: '/other/lib.v' },  // fora — fica absoluto
                ],
            },
        }));

        // Ler + re-salvar (qualquer mutator que MUDE structure pra
        // disparar write — push em array conta como mudanca).
        await SpfStore.update('/proj/teste.spf', (s) => {
            s.synthesizableFiles.push({ name: 'b.v', path: '/proj/teste/b.v' });
        });

        const onDisk = JSON.parse(window.electronAPI._files.get('/proj/teste.spf'));
        // Paths inside-basePath migraram pra relativo.
        expect(onDisk.structure.topLevelFile).toBe('top.v');
        expect(onDisk.structure.synthesizableFiles[0].path).toBe('a.v');
        expect(onDisk.structure.synthesizableFiles[2].path).toBe('b.v');
        // Path outside-basePath manteve absoluto.
        expect(onDisk.structure.synthesizableFiles[1].path).toBe('/other/lib.v');

        // E read subsequente expande de volta pra absoluto — caller ve absoluto.
        const sAfter = await SpfStore.read('/proj/teste.spf');
        expect(sAfter.topLevelFile).toBe('/proj/teste/top.v');
        expect(sAfter.synthesizableFiles[0].path).toBe('/proj/teste/a.v');
        expect(sAfter.synthesizableFiles[1].path).toBe('/other/lib.v');
        expect(sAfter.synthesizableFiles[2].path).toBe('/proj/teste/b.v');
    });
});
