import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Static import: o WaveStore so toca o filesystem via window.electronAPI,
// e o beforeEach stuba um fake fresh per-test. Estado interno
// (writeChainByKey) sobrevive entre testes mas cada teste usa
// (projectPath, tbKey) distintos (ou await todas as promises antes da
// proxima assertion) — sem risco de cross-test interference.
import { WaveStore } from '../../js/wave/wave_state_store.js';

/**
 * In-memory fake do window.electronAPI usado pelo WaveStore. Cobre so
 * os ipc handles que o store toca: joinPath, fileExists, readFile,
 * writeFile, mkdir, listFilesInDirectory.
 */
function makeFakeElectronApi() {
    /** @type {Map<string, string>} */
    const files = new Map();
    /** @type {Set<string>} */
    const dirs = new Set(['']);

    const norm = (p) => p.replace(/\\/g, '/');
    const dirname = (p) => {
        const i = norm(p).lastIndexOf('/');
        return i === -1 ? '' : p.slice(0, i);
    };

    return {
        _files: files,
        _dirs: dirs,
        joinPath: async (...parts) => parts.filter(Boolean).join('/'),
        fileExists: async (p) => files.has(norm(p)) || dirs.has(norm(p)),
        readFile: async (p) => {
            const c = files.get(norm(p));
            if (c === undefined) throw new Error(`ENOENT: ${p}`);
            return c;
        },
        writeFile: async (p, content) => {
            const np = norm(p);
            files.set(np, content);
            // Garante que os ancestrais existem (o caller deve ter feito mkdir,
            // mas tudo bem ser defensivo).
            let d = dirname(np);
            while (d) { dirs.add(d); d = dirname(d); }
        },
        mkdir: async (p) => {
            const np = norm(p);
            let d = np;
            while (d) { dirs.add(d); d = dirname(d); }
        },
        listFilesInDirectory: async (p) => {
            const np = norm(p);
            const out = new Set();
            for (const file of files.keys()) {
                if (file.startsWith(np + '/')) {
                    const rest = file.slice(np.length + 1);
                    if (!rest.includes('/')) out.add(rest);
                }
            }
            return [...out].sort();
        },
    };
}

beforeEach(() => {
    globalThis.window = { electronAPI: makeFakeElectronApi() };
});

afterEach(() => {
    delete globalThis.window;
});

describe('WaveStore.get / read', () => {
    it('get retorna null pra testbench nao registrado', async () => {
        expect(await WaveStore.get('/proj', 'tb_foo')).toBeNull();
    });

    it('read retorna DEFAULTS quando o arquivo nao existe', async () => {
        const state = await WaveStore.read('/proj', 'tb_foo');
        expect(state.gtkwFiles).toEqual([]);
        expect(state.waveSignals).toEqual([]);
        expect(state.wcInitialized).toBe(false);
        expect(state.wcCustomized).toBe(false);
        expect(state.tbModule).toBe('tb_foo');
        // Nao persistiu o read — get continua retornando null.
        expect(await WaveStore.get('/proj', 'tb_foo')).toBeNull();
    });
});

describe('WaveStore.update', () => {
    it('cria o JSON na primeira chamada e mutacoes persistem', async () => {
        const state = await WaveStore.update('/proj', 'tb_foo', (cfg) => {
            cfg.tbPath = '/proj/tb_foo.v';
            cfg.hadOriginalDumpvars = true;
            cfg.waveSignals = ['tb_foo.clk', 'tb_foo.q'];
        });
        expect(state.tbPath).toBe('/proj/tb_foo.v');
        expect(state.hadOriginalDumpvars).toBe(true);
        expect(state.waveSignals).toEqual(['tb_foo.clk', 'tb_foo.q']);

        // Persistiu: leitura subsequente bate.
        const reloaded = await WaveStore.get('/proj', 'tb_foo');
        expect(reloaded).toMatchObject({
            tbPath: '/proj/tb_foo.v',
            hadOriginalDumpvars: true,
            waveSignals: ['tb_foo.clk', 'tb_foo.q'],
        });
    });

    it('mutacoes sucessivas merge no estado existente', async () => {
        await WaveStore.update('/proj', 'tb_foo', (cfg) => {
            cfg.waveSignals = ['a', 'b'];
        });
        await WaveStore.update('/proj', 'tb_foo', (cfg) => {
            cfg.wcCustomized = true;
        });
        const state = await WaveStore.get('/proj', 'tb_foo');
        // waveSignals preservado mesmo so tendo mexido em wcCustomized.
        expect(state.waveSignals).toEqual(['a', 'b']);
        expect(state.wcCustomized).toBe(true);
    });

    it('updates pra tbs diferentes ficam isolados', async () => {
        await WaveStore.update('/proj', 'tb_a', (cfg) => { cfg.waveSignals = ['x']; });
        await WaveStore.update('/proj', 'tb_b', (cfg) => { cfg.waveSignals = ['y']; });

        expect((await WaveStore.get('/proj', 'tb_a')).waveSignals).toEqual(['x']);
        expect((await WaveStore.get('/proj', 'tb_b')).waveSignals).toEqual(['y']);
    });

    it('serializa updates concorrentes do mesmo tb sem perda', async () => {
        // Dispara dois updates em paralelo. Sem serializacao, o segundo
        // leria o snapshot pre-write do primeiro e clobraria.
        const p1 = WaveStore.update('/proj', 'tb_foo', (cfg) => {
            cfg.gtkwFiles = [...(cfg.gtkwFiles || []), { name: 'a.gtkw', path: '/a' }];
        });
        const p2 = WaveStore.update('/proj', 'tb_foo', (cfg) => {
            cfg.gtkwFiles = [...(cfg.gtkwFiles || []), { name: 'b.gtkw', path: '/b' }];
        });
        await Promise.all([p1, p2]);
        const state = await WaveStore.get('/proj', 'tb_foo');
        expect(state.gtkwFiles.map((f) => f.name).sort()).toEqual(['a.gtkw', 'b.gtkw']);
    });
});

describe('WaveStore.ensureRegistered', () => {
    it('cria com os defaults+initial quando nao existe', async () => {
        const state = await WaveStore.ensureRegistered('/proj', 'tb_new', {
            tbPath: '/proj/tb_new.v',
            tbModule: 'tb_new',
            hadOriginalDumpvars: false,
        });
        expect(state.tbPath).toBe('/proj/tb_new.v');
        expect(state.hadOriginalDumpvars).toBe(false);
        expect(await WaveStore.get('/proj', 'tb_new')).not.toBeNull();
    });

    it('idempotente: re-chamar nao sobrescreve estado existente', async () => {
        // 1a chamada — registra com hadOriginalDumpvars=true.
        await WaveStore.ensureRegistered('/proj', 'tb_x', {
            hadOriginalDumpvars: true,
            waveSignals: ['original'],
        });
        // 2a chamada — tenta sobrescrever com defaults diferentes.
        // Deve devolver o estado existente, NAO mexer em
        // hadOriginalDumpvars (motivo: e snapshot da 1a visita; mudar
        // depois confundiria a logica do botao wave).
        const state = await WaveStore.ensureRegistered('/proj', 'tb_x', {
            hadOriginalDumpvars: false,
            waveSignals: ['overwritten'],
        });
        expect(state.hadOriginalDumpvars).toBe(true);
        expect(state.waveSignals).toEqual(['original']);
    });
});

describe('WaveStore.list', () => {
    it('lista todos os tbs registrados no projeto, ordenados', async () => {
        await WaveStore.update('/proj', 'tb_zebra', (cfg) => { cfg.tbModule = 'tb_zebra'; });
        await WaveStore.update('/proj', 'tb_alpha', (cfg) => { cfg.tbModule = 'tb_alpha'; });
        await WaveStore.update('/proj', 'tb_mid',   (cfg) => { cfg.tbModule = 'tb_mid'; });
        const list = await WaveStore.list('/proj');
        expect(list.map((e) => e.tbKey)).toEqual(['tb_alpha', 'tb_mid', 'tb_zebra']);
    });

    it('retorna lista vazia se a pasta nao existe', async () => {
        expect(await WaveStore.list('/empty-proj')).toEqual([]);
    });
});

describe('WaveStore safe keys', () => {
    it('escapa caracteres de path traversal no tbKey', async () => {
        // Pra evitar bugs onde alguem passa um path como tbKey, o store
        // sanitiza. Nao falha o write, so escreve num filename safe.
        await WaveStore.update('/proj', '../escape', (cfg) => { cfg.tbModule = 'oops'; });
        // O arquivo escrito tem o nome safeado; nao escapou do testbench/.
        const list = await WaveStore.list('/proj');
        expect(list.some((e) => e.tbKey.startsWith('__'))).toBe(true);
    });
});
