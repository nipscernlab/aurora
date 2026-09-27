// @vitest-environment happy-dom
//
// O que todo caminho de simulacao usa (Icarus, Verilator, cocotb):
//
//   - enquanto roda: a linha de progresso que vira barra, o aviso de bateria
//     e o vigia do tamanho do dump;
//   - os arquivos: os dados que o testbench le, copiados para a pasta onde a
//     simulacao roda; achar o dump que ela gravou; e as duas defesas do dump
//     (dump_guard.ts), a de escrita antes e a de frescor depois.
//
// Os casos entram pelo que o fluxo chama. `chamar` e o unico ponto que sabe
// onde cada peca mora, para o mesmo arquivo provar o comportamento antes e
// depois de elas sairem do compilation_module.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(),
    runSpecStreamed: vi.fn(),
    setAuditHook: vi.fn(),
    setTerminalHook: vi.fn(),
    resolveSpec: vi.fn(),
}));
vi.mock('../../js/tabs/tab_manager.js', () => ({
    TabManager: { saveAllFiles: vi.fn(async () => {}), tabs: new Map() },
}));
let terminal;
vi.mock('../../js/terminal/terminal_module.js', () => ({
    TerminalManager: class {
        constructor() { return terminal; }
    },
}));

import { CompilationModule } from '../../js/compilation/compilation_module.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';

const chamar = {
    progresso: (mod, ...a) => mod._consumirProgresso(...a),
    bateria: (mod, ...a) => mod._avisarSeNaBateria(...a),
    vigia: (mod, ...a) => mod._vigiarTamanhoDoDump(...a),
    dadosDoTestbench: (mod, ...a) => mod._stageTestbenchDataFiles(...a),
    acharDump: (mod, ...a) => mod._waveResolveVcdFile(...a),
    exigirGravavel: (mod, ...a) => mod._waveExigirDumpGravavel(...a),
    exigirNovo: (mod, ...a) => mod._waveExigirDumpNovo(...a),
};

function makeTerminal() {
    const calls = [];
    return {
        calls,
        barras: [],
        tamanhos: [],
        appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }),
        renderHardwareProgress: function (term, p) { this.barras.push([term, p]); },
        renderDumpSize: function (term, d) { this.tamanhos.push([term, d]); },
    };
}

let api;
function makeFakeApi() {
    const arquivos = new Map();
    const norm = (p) => String(p).replace(/\\/g, '/');
    const a = {
        _arquivos: arquivos,
        _escrever(p, conteudo, mtime = 1_000_000) { arquivos.set(norm(p), { conteudo, mtime }); },
        joinPath: vi.fn(async (...partes) => partes.join('/').replace(/\/+/g, '/')),
        dirname: vi.fn(async (p) => norm(p).split('/').slice(0, -1).join('/')),
        fileExists: vi.fn(async (p) => arquivos.has(norm(p))),
        readFile: vi.fn(async (p) => {
            const x = arquivos.get(norm(p));
            if (!x) throw new Error('ENOENT ' + p);
            return x.conteudo;
        }),
        mkdir: vi.fn(async () => {}),
        copyFile: vi.fn(async (de, para) => { a._escrever(para, arquivos.get(norm(de))?.conteudo ?? ''); }),
        getFileStats: vi.fn(async (p) => {
            const x = arquivos.get(norm(p));
            if (!x) throw new Error('ENOENT ' + p);
            return { mtime: x.mtime, size: String(x.conteudo).length };
        }),
        listFilesInDirectory: vi.fn(async (dir) => {
            const d = norm(dir) + '/';
            return [...arquivos.keys()].filter((p) => p.startsWith(d) && !p.slice(d.length).includes('/'))
                .map((p) => p.slice(d.length));
        }),
        checkFileWritable: vi.fn(async (p) => ({ exists: arquivos.has(norm(p)), writable: true })),
        isOnBattery: vi.fn(async () => false),
        getComponentsPath: vi.fn(async () => COMP),
    };
    return a;
}

async function novoModulo() {
    const mod = new CompilationModule(PROJ);
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    return mod;
}

const msgs = () => terminal.calls.map((c) => c.msg);

beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    window.t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    delete window.t;
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('enquanto a simulacao roda', () => {
    it('linha de progresso vira barra e nao vai ao terminal', async () => {
        const mod = await novoModulo();
        expect(chamar.progresso(mod, 'twave', 'progress: 3/10', 'padrao')).toBe(true);
        expect(chamar.progresso(mod, 'twave', 'saida comum', 'padrao')).toBe(false);
        expect(terminal.barras).toEqual([
            ['twave', { pct: 30, cyc: 3, total: 10, reads: null, label: 'progress', done: false }],
        ]);
    });

    it('terminal sem barra: a linha e consumida do mesmo jeito', async () => {
        delete terminal.renderHardwareProgress;
        const mod = await novoModulo();
        expect(chamar.progresso(mod, 'twave', '[ 42%] building', 'padrao')).toBe(true);
    });

    it('na bateria, uma dica; na tomada, nada', async () => {
        const mod = await novoModulo();
        api.isOnBattery.mockResolvedValueOnce(true);
        await chamar.bateria(mod, 'twave');
        await chamar.bateria(mod, 'twave');
        expect(terminal.calls).toEqual([{ term: 'twave', msg: 'terminal.wave.onBattery', level: 'tips' }]);
    });

    it('bateria sem ponte ou com a ponte falhando: cortesia, nada acontece', async () => {
        const mod = await novoModulo();
        api.isOnBattery.mockRejectedValueOnce(new Error('ipc'));
        await chamar.bateria(mod, 'twave');
        delete api.isOnBattery;
        await chamar.bateria(mod, 'twave');
        expect(terminal.calls).toEqual([]);
    });

    it('o vigia adota o primeiro candidato que aparece e fecha com done', async () => {
        const mod = await novoModulo();
        vi.useFakeTimers();
        const parar = chamar.vigia(mod, [PROJ + '/tb.vcd', PROJ + '/tb.fst']);

        await vi.advanceTimersByTimeAsync(700);
        expect(terminal.tamanhos).toEqual([]);

        api._escrever(PROJ + '/tb.fst', '12345');
        await vi.advanceTimersByTimeAsync(700);
        api._escrever(PROJ + '/tb.vcd', 'x');
        api._escrever(PROJ + '/tb.fst', '1234567');
        await vi.advanceTimersByTimeAsync(700);
        await parar();
        // Depois de parado, o intervalo nao mede mais.
        await vi.advanceTimersByTimeAsync(2100);

        expect(terminal.tamanhos).toEqual([
            ['twave', { name: 'tb.fst', path: PROJ + '/tb.fst', bytes: 5, done: false }],
            ['twave', { name: 'tb.fst', path: PROJ + '/tb.fst', bytes: 7, done: false }],
            ['twave', { name: 'tb.fst', path: PROJ + '/tb.fst', bytes: 7, done: true }],
        ]);
    });

    it('stat que responde depois do stop nao desenha; stat quebrado nao para o vigia', async () => {
        const mod = await novoModulo();
        vi.useFakeTimers();
        api._escrever(PROJ + '/tb.fst', 'abc');
        let soltar;
        api.getFileStats.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
        const parar = chamar.vigia(mod, [PROJ + '/tb.fst']);
        await vi.advanceTimersByTimeAsync(700);
        // A leitura final roda e desenha; a atrasada chega depois e e descartada.
        await parar();
        soltar({ size: 99 });
        await vi.advanceTimersByTimeAsync(0);
        expect(terminal.tamanhos).toEqual([
            ['twave', { name: 'tb.fst', path: PROJ + '/tb.fst', bytes: 3, done: true }],
        ]);

        terminal.tamanhos.length = 0;
        api.getFileStats.mockRejectedValueOnce(new Error('sumiu'));
        api.getFileStats.mockResolvedValueOnce(null);
        const parar2 = chamar.vigia(mod, [PROJ + '/tb.fst']);
        await vi.advanceTimersByTimeAsync(700);
        await parar2();
        expect(terminal.tamanhos).toEqual([
            ['twave', { name: 'tb.fst', path: PROJ + '/tb.fst', bytes: 0, done: true }],
        ]);
    });

    it('terminal sem o pill do dump: o vigia roda sem desenhar', async () => {
        delete terminal.renderDumpSize;
        const mod = await novoModulo();
        api._escrever(PROJ + '/tb.fst', 'abc');
        const parar = chamar.vigia(mod, [PROJ + '/tb.fst']);
        await expect(parar()).resolves.toBeUndefined();
    });
});

describe('os dados que o testbench le', () => {
    const TB = PROJ + '/Simulation/tb.v';
    const SIM = PROJ;

    it('copia so o que o testbench le, e cria as subpastas', async () => {
        api._escrever(TB, [
            '$readmemb("pesos.txt", mem);',
            '$readmemh( "./dados/amostras.hex" , m2);',
            'f = $fopen("entrada.txt", "r");',
            'g = $fopen("bin.dat", "RB");',
            'h = $fopen("rw.txt", "r+");',
            'k = $fopen("rbw.txt", "rb+");',
            'o = $fopen("saida.txt", "w");',
            'p = $fopen("log.txt");',
            '$readmemb("C:/abs/x.txt", m3);',
            '$readmemb("/abs/y.txt", m4);',
            '$readmemb("\\\\abs\\\\z.txt", m5);',
        ].join('\n'));
        for (const n of ['pesos.txt', 'dados/amostras.hex', 'entrada.txt', 'bin.dat', 'rw.txt', 'rbw.txt']) {
            api._escrever(`${PROJ}/Simulation/${n}`, n);
        }
        const mod = await novoModulo();

        await chamar.dadosDoTestbench(mod, SIM, TB);

        expect(api.copyFile.mock.calls.map(([, para]) => para).sort()).toEqual([
            `${SIM}/bin.dat`, `${SIM}/dados/amostras.hex`, `${SIM}/entrada.txt`,
            `${SIM}/pesos.txt`, `${SIM}/rbw.txt`, `${SIM}/rw.txt`,
        ]);
        expect(api.mkdir).toHaveBeenCalledWith(`${SIM}/dados`);
        expect(terminal.calls).toEqual([]);
    });

    it('arquivo que falta ou copia que falha viram aviso, um por arquivo', async () => {
        api._escrever(TB, '$readmemb("falta.txt", a);\n$readmemb("sub/trava.txt", b);');
        api._escrever(`${PROJ}/Simulation/sub/trava.txt`, 'x');
        api.copyFile.mockRejectedValueOnce(new Error('EPERM'));
        api.mkdir.mockRejectedValueOnce(new Error('EEXIST'));
        const mod = await novoModulo();

        await chamar.dadosDoTestbench(mod, SIM, TB);

        expect(msgs()).toEqual([
            'terminal.wave.couldNotStageTbFile {"name":"falta.txt","reason":"not found in testbench folder"}',
            'terminal.wave.couldNotStageTbFile {"name":"sub/trava.txt","reason":"EPERM"}',
        ]);
        expect(terminal.calls.every((c) => c.level === 'warning')).toBe(true);
    });

    it('testbench ja na pasta da simulacao: origem igual ao destino, nada a copiar', async () => {
        const tbNaPasta = PROJ + '/tb.v';
        api._escrever(tbNaPasta, '$readmemb("pesos.txt", mem);');
        api._escrever(PROJ + '/pesos.txt', 'p');
        api.joinPath.mockImplementation(async (...partes) => {
            const j = partes.join('/').replace(/\/+/g, '/');
            // O destino chega com outra caixa e outra barra, e ainda e o mesmo arquivo.
            return partes[0] === 'C:\\PROJ' ? j.replace(/\//g, '\\') : j;
        });
        const mod = await novoModulo();

        await chamar.dadosDoTestbench(mod, 'C:\\PROJ', tbNaPasta);

        expect(api.copyFile).not.toHaveBeenCalled();
    });

    it.each([
        ['sem testbench', null],
        ['testbench que nao le', PROJ + '/sumiu.v'],
    ])('%s: nada acontece', async (_nome, tb) => {
        const mod = await novoModulo();
        await chamar.dadosDoTestbench(mod, SIM, tb);
        expect(api.copyFile).not.toHaveBeenCalled();
        expect(api.dirname).not.toHaveBeenCalled();
    });

    it('testbench sem leitura de arquivo: nada acontece', async () => {
        api._escrever(TB, 'initial $display("oi");');
        const mod = await novoModulo();
        await chamar.dadosDoTestbench(mod, SIM, TB);
        expect(api.dirname).not.toHaveBeenCalled();
    });
});

describe('achar o dump que a simulacao gravou', () => {
    const SIM = PROJ;

    it('prefere o .fst com o nome do topo, depois o .vcd', async () => {
        const mod = await novoModulo();
        api._escrever(`${SIM}/tb.vcd`, 'v');
        expect(await chamar.acharDump(mod, 'tb', SIM)).toBe(`${SIM}/tb.vcd`);
        api._escrever(`${SIM}/tb.fst`, 'f');
        expect(await chamar.acharDump(mod, 'tb', SIM)).toBe(`${SIM}/tb.fst`);
        expect(terminal.calls).toEqual([]);
    });

    it('um unico dump com outro nome e adotado, com aviso', async () => {
        api._escrever(`${SIM}/meu.FST`, 'f');
        api._escrever(`${SIM}/leia.txt`, 't');
        const mod = await novoModulo();
        expect(await chamar.acharDump(mod, 'tb', SIM)).toBe(`${SIM}/meu.FST`);
        expect(terminal.calls).toEqual([{
            term: 'twave', msg: 'terminal.wave.dumpfileMismatch {"name":"meu.FST","expected":"tb"}', level: 'warning',
        }]);
    });

    it('nenhum dump: erro que diz o que se procurava', async () => {
        const mod = await novoModulo();
        await expect(chamar.acharDump(mod, 'tb', SIM)).rejects.toThrow(
            'Dump file was not generated as tb.fst.\nNo .fst/.vcd was produced.\n'
            + 'Aurora looks for a .fst (or .vcd) named after the testbench module.');
    });

    it('varios candidatos: erro que nomeia todos', async () => {
        api._escrever(`${SIM}/a.vcd`, 'a');
        api._escrever(`${SIM}/b.fst`, 'b');
        const mod = await novoModulo();
        await expect(chamar.acharDump(mod, 'tb', SIM))
            .rejects.toThrow('Multiple dump candidates were produced: a.vcd, b.fst.');
    });

    it('pasta que nao lista, ou lista vazia de verdade, conta como nenhum', async () => {
        const mod = await novoModulo();
        api.listFilesInDirectory.mockRejectedValueOnce(new Error('EACCES'));
        await expect(chamar.acharDump(mod, 'tb', SIM)).rejects.toThrow('No .fst/.vcd was produced.');
        api.listFilesInDirectory.mockResolvedValueOnce(null);
        await expect(chamar.acharDump(mod, 'tb', SIM)).rejects.toThrow('No .fst/.vcd was produced.');
    });
});

describe('as defesas do dump', () => {
    const SIM = PROJ;

    it('dump que nao existe ou que aceita escrita passa', async () => {
        api._escrever(`${SIM}/tb.fst`, 'f');
        const mod = await novoModulo();
        await expect(chamar.exigirGravavel(mod, SIM, ['tb.fst', 'tb.vcd'])).resolves.toBeUndefined();
    });

    it.each([
        ['preso por um visualizador', 'EBUSY', 'error.compilation.dumpLockedBusy {"file":"tb.fst","code":"EBUSY"}'],
        ['somente leitura ou politica', 'EPERM', 'error.compilation.dumpLockedDenied {"file":"tb.fst","code":"EPERM"}'],
        ['sem codigo', undefined, 'error.compilation.dumpLockedDenied {"file":"tb.fst","code":"?"}'],
    ])('dump existente %s: erro com a ajuda', async (_nome, code, mensagem) => {
        api.checkFileWritable.mockResolvedValue({ exists: true, writable: false, code });
        const mod = await novoModulo();
        const erro = await chamar.exigirGravavel(mod, SIM, ['tb.fst']).catch((e) => e);
        expect(erro.message).toBe(mensagem);
        expect(erro.ajuda).toBe('dumpBloqueadoHelp');
    });

    it('ponte sem a checagem, checagem que falha ou resposta vazia: passa (fail-open)', async () => {
        const mod = await novoModulo();
        api.checkFileWritable.mockRejectedValueOnce(new Error('ipc'));
        api.checkFileWritable.mockResolvedValueOnce(null);
        await expect(chamar.exigirGravavel(mod, SIM, ['a.fst', 'b.fst'])).resolves.toBeUndefined();
        delete api.checkFileWritable;
        await expect(chamar.exigirGravavel(mod, SIM, ['a.fst'])).resolves.toBeUndefined();
    });

    it('dump desta corrida passa; o de uma corrida anterior e recusado com a ajuda', async () => {
        const mod = await novoModulo();
        api._escrever(`${SIM}/tb.fst`, 'f', 10_000);
        await expect(chamar.exigirNovo(mod, `${SIM}/tb.fst`, 11_000)).resolves.toBeUndefined();

        const erro = await chamar.exigirNovo(mod, `${SIM}/tb.fst`, 60_000).catch((e) => e);
        expect(erro.message).toBe('error.compilation.dumpStale {"file":"tb.fst"}');
        expect(erro.ajuda).toBe('dumpBloqueadoHelp');
    });

    it('stat que falha ou vem vazio nao bloqueia', async () => {
        const mod = await novoModulo();
        await expect(chamar.exigirNovo(mod, `${SIM}/sumiu.fst`, 60_000)).resolves.toBeUndefined();
        api.getFileStats.mockResolvedValueOnce(null);
        await expect(chamar.exigirNovo(mod, `${SIM}/x.fst`, 60_000)).resolves.toBeUndefined();
    });
});
