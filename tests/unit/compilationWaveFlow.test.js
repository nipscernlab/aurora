// @vitest-environment happy-dom
//
// A rede em volta do fluxo de onda do CompilationModule.
//
// Por que este arquivo existe, e por que ele mira no runGtkWave: o
// compilation_module.js tem 3459 linhas numa classe so, e o TODO decidiu que a
// ordem certa e cobrir por fora antes de mover codigo por dentro. Seguindo as
// chamadas `this.x(` a partir de cada entrada publica, o runGtkWave alcanca 45
// dos 64 metodos e 2571 linhas, tres quartos do arquivo; as catorze entradas
// juntas chegam a 98%. Nenhum outro teste rende tanta rede por linha escrita.
//
// O que torna isso possivel sem subir a janela: a classe NAO toca no DOM (uma
// unica referencia em 3459 linhas, um listener no construtor) e recebe o mundo
// por um import so, o `electron_api.js`, que e um Proxy vivo sobre
// `window.electronAPI`. Trocar o mundo e trocar um objeto, como ja fazem
// wave_toolchain.test.js e processor_compiler.test.js.
//
// O que fica travado aqui e o CONTRATO que uma refatoracao quebra: quais
// ferramentas sao chamadas, em que ordem, com quais argumentos, o que chega ao
// terminal e as duas defesas do dump. Detalhe interno de metodo nao entra, que
// e justamente o que vai mudar de lugar.
//
// DUAS ARMADILHAS, as duas encontradas escrevendo este arquivo, e as duas
// produzem teste verde que nao testa nada:
//
//   1. Um mundo falso incompleto faz o fluxo desistir na primeira fase. Por
//      isso cada caso termina contando o que exercitou, e nao so olhando se
//      houve excecao.
//   2. Um falso com a FORMA errada atravessa a defesa sem aciona-la. O
//      `getFileStats` do processo principal devolve `mtime` em milissegundos
//      (main/ipc/files.js), e a primeira versao deste falso devolvia `mtimeMs`;
//      `dumpEstaFresco` recebe NaN, decide fail-open, e o teste de dump velho
//      passava sem a defesa ter rodado uma vez.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// As bordas que nao interessam aqui. O terminal vira coletor, o statusUpdater e
// a barra da janela, e o TabManager so salva arquivos abertos antes de compilar.
vi.mock('../../js/compilation/spec_runner.js', () => ({
    runSpec: vi.fn(),
    runSpecStreamed: vi.fn(),
    setAuditHook: vi.fn(),
    setTerminalHook: vi.fn(),
    resolveSpec: vi.fn(),
}));
vi.mock('../../js/ui/status_updater.js', () => ({
    statusUpdater: {
        startCompilation: vi.fn(),
        compilationSuccess: vi.fn(),
        compilationError: vi.fn(),
        setStep: vi.fn(),
    },
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

import { runSpec, runSpecStreamed } from '../../js/compilation/spec_runner.js';
import { CompilationModule } from '../../js/compilation/compilation_module.js';

const PROJ = 'C:/proj';
const COMP = 'C:/comp';
const TB = PROJ + '/Simulation/mediamovel_tb.v';
const TOP = PROJ + '/Hardware/mediamovel.v';
const SIM_TOP = 'mediamovel_tb';
const DUMP = `${PROJ}/${SIM_TOP}.fst`;

function makeTerminal() {
    const calls = [];
    return {
        calls,
        appendToTerminal: (term, msg, level) => calls.push({ term, msg, level }),
        clearTerminal: async () => {},
        processExecutableOutput: () => {},
        atualizarCartao: () => {},
    };
}

/**
 * Um disco de mentira com data de modificacao, porque o frescor do dump e parte
 * do contrato: a defesa do dump_guard recusa onda de corrida anterior, e um
 * disco sem data nao exercitaria essa decisao.
 *
 * As formas de retorno seguem o processo principal, nao a conveniencia daqui:
 * `getFileStats` devolve `{ mtime (ms), size, isFile, isDirectory }` como o
 * handler de main/ipc/files.js, e `checkFileWritable` devolve
 * `{ exists, writable, code }`.
 */
function makeFakeApi() {
    const arquivos = new Map();     // caminho normalizado -> { conteudo, mtime }
    const norm = (p) => String(p).replace(/\\/g, '/');
    const api = {
        _arquivos: arquivos,
        _escrever(p, conteudo, mtime = Date.now()) {
            arquivos.set(norm(p), { conteudo, mtime });
        },
        _travado: null,             // { nome, code } quando o dump esta bloqueado
        joinPath: vi.fn(async (...partes) => partes.filter(Boolean).join('/').replace(/\/+/g, '/')),
        dirname: vi.fn(async (p) => norm(p).split('/').slice(0, -1).join('/')),
        fileExists: vi.fn(async (p) => arquivos.has(norm(p))),
        readFile: vi.fn(async (p) => {
            const a = arquivos.get(norm(p));
            if (!a) throw new Error('ENOENT ' + p);
            return a.conteudo;
        }),
        writeFile: vi.fn(async (p, conteudo) => { api._escrever(p, conteudo); return { success: true }; }),
        mkdir: vi.fn(async () => ({ success: true })),
        createDirectory: vi.fn(async () => ({ success: true })),
        copyFile: vi.fn(async (de, para) => {
            const a = arquivos.get(norm(de));
            api._escrever(para, a ? a.conteudo : '');
            return { success: true };
        }),
        getFileStats: vi.fn(async (p) => {
            const a = arquivos.get(norm(p));
            if (!a) throw new Error('ENOENT ' + p);
            return { mtime: a.mtime, size: String(a.conteudo).length, isFile: true, isDirectory: false };
        }),
        listFilesInDirectory: vi.fn(async (dir) => {
            const d = norm(dir) + '/';
            return [...arquivos.keys()]
                .filter((p) => p.startsWith(d) && !p.slice(d.length).includes('/'))
                .map((p) => p.slice(d.length));
        }),
        checkFileWritable: vi.fn(async (p) => {
            const nome = norm(p).split('/').pop();
            if (api._travado && api._travado.nome === nome) {
                return { exists: true, writable: false, code: api._travado.code };
            }
            return { exists: arquivos.has(norm(p)), writable: true };
        }),
        isOnBattery: vi.fn(async () => ({ naBateria: false })),
        isProcessRunning: vi.fn(async () => false),
        killCurrentSpecProcess: vi.fn(async () => ({ success: true })),
        // Os ouvintes de saida ao vivo, guardados de verdade: a captura do
        // cabecalho do FST depende deles. O caminho normal le o cabecalho pelo
        // fluxo e mata o fst2vcd em `$enddefinitions`; so quando o fluxo nao
        // existe e que ele cai para converter o dump inteiro. Um falso que
        // ignore o ouvinte testa sempre o caminho lento, que nao e o que roda
        // na maquina de ninguem.
        _ouvintes: [],
        onExecSpecStream: vi.fn((cb) => {
            api._ouvintes.push(cb);
            return () => { api._ouvintes = api._ouvintes.filter((o) => o !== cb); };
        }),
        _emitir: (payload) => { for (const o of [...api._ouvintes]) o(payload); },
        launchGtkwaveOnly: vi.fn(async () => ({ success: true })),
        launchSurfer: vi.fn(async () => ({ success: true })),
        getComponentsPath: vi.fn(async () => COMP),
        getCurrentProject: vi.fn(async () => ({ projectPath: PROJ })),
        getPythonStatus: vi.fn(async () => ({ ok: false })),
        surferTabAvailable: vi.fn(async () => ({ disponivel: false })),
    };
    return api;
}

/**
 * O executor falso. Ele nao devolve so sucesso: MATERIALIZA no disco o que a
 * ferramenta de verdade produziria, porque o fluxo decide o passo seguinte
 * olhando o disco. Um executor que apenas diga "deu certo" faz o resolvedor de
 * dump nao achar nada, e o teste morre longe da causa.
 *
 * `gravaDump: false` imita o caso do laboratorio: o simulador sai com codigo
 * zero e o dump da corrida anterior continua ali.
 */
function ligarExecutor(api, { gravaDump = true } = {}) {
    const passos = [];
    const CABECALHO = '$date hoje $end\n$timescale 1ns $end\n'
        + `$scope module ${SIM_TOP} $end\n$var wire 1 ! clk $end\n$upscope $end\n$enddefinitions $end\n`;
    const executar = async (spec) => {
        const bin = String(spec?.binary || spec?.bin || '');
        const args = spec?.args || [];
        const saidaDe = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
        passos.push({ step: spec?.step || null, bin, args });
        if (/iverilog/i.test(bin)) {
            const saida = saidaDe('-o');
            if (saida) api._escrever(saida, 'vvp-bytecode');
        }
        if (/vvp/i.test(bin) && gravaDump) {
            // O dump cai no cwd da simulacao, que e a pasta do projeto.
            api._escrever(DUMP, 'FST');
        }
        if (/fst2vcd/i.test(bin)) {
            api._emitir({ type: 'stdout', data: CABECALHO });
            const saida = saidaDe('-o');
            if (saida) api._escrever(saida, CABECALHO);
        }
        return { success: true, code: 0, exitCode: 0, stdout: '', stderr: '' };
    };
    runSpec.mockImplementation(executar);
    runSpecStreamed.mockImplementation(executar);
    return passos;
}

async function novoModulo(config) {
    const mod = new CompilationModule(PROJ);
    // initializeComponentsPath e disparado pelo construtor sem await.
    await vi.waitFor(() => expect(mod.componentsPath).toBe(COMP));
    mod.projectConfig = config;
    return mod;
}

const CONFIG_PADRAO = {
    synthesizableFiles: [{ path: TOP, name: 'mediamovel.v', isTopLevel: true }],
    testbenchFile: TB,
    testbenchFiles: [{ path: TB, name: 'mediamovel_tb.v', isTopLevel: true }],
};

const msgs = () => terminal.calls.map((c) => c.msg);
const houveErro = () => terminal.calls.some((c) => c.level === 'error');

let api;
beforeEach(() => {
    terminal = makeTerminal();
    api = makeFakeApi();
    window.electronAPI = api;
    api._escrever(TOP, 'module mediamovel(); endmodule');
    api._escrever(TB, 'module mediamovel_tb(); initial $dumpfile("mediamovel_tb.fst"); endmodule');
    // A toolchain empacotada. O fluxo confere a presenca de cada binario antes
    // de montar o comando e recusa com o caminho na mensagem se faltar, entao
    // um disco sem eles nao chega a exercitar nada.
    for (const bin of [
        `${COMP}/Packages/msys/mingw64/bin/iverilog.exe`,
        `${COMP}/Packages/msys/mingw64/bin/vvp.exe`,
        `${COMP}/Packages/gtkwave-nipscern/gtkwave.exe`,
        `${COMP}/Packages/gtkwave-nipscern/fst2vcd.exe`,
    ]) api._escrever(bin, 'MZ');
    localStorage.clear();
});

afterEach(() => {
    delete window.electronAPI;
    delete window._latestCompilationModule;
    vi.clearAllMocks();
});

describe('runGtkWave, Icarus com GTKWave', () => {
    it('constroi, simula, extrai o cabecalho e abre a onda, nesta ordem', async () => {
        const mod = await novoModulo(CONFIG_PADRAO);
        const passos = ligarExecutor(api);

        await mod.runGtkWave();

        expect(passos.map((p) => p.step)).toEqual(['iverilog-build', 'vvp-run', 'fst2vcd']);

        // O build precisa do -s (topo da simulacao), do -o (o .vvp) e da
        // biblioteca HDL do SAPHO em -y, senao modulos como processor.v e
        // myFIFO.v nao resolvem sem o usuario lista-los.
        const build = passos[0].args.join(' ');
        expect(build).toContain('-s ' + SIM_TOP);
        expect(build).toContain('-y ' + COMP + '/HDL');
        expect(build).toContain('-o ' + COMP + '/Temp/' + SIM_TOP + '.vvp');
        expect(build).toContain(TOP);
        expect(build).toContain(TB);

        // A simulacao roda o .vvp construido e pede FST, que e o formato que o
        // resto do fluxo espera achar.
        expect(passos[1].args).toContain(COMP + '/Temp/' + SIM_TOP + '.vvp');
        expect(passos[1].args).toContain('-fst');

        // O cabecalho sai pelo caminho rapido: fst2vcd sem -o, lido pelo fluxo e
        // interrompido em $enddefinitions. Se um dia isso cair para a conversao
        // inteira, o usuario espera a conversao de um dump que pode ter centenas
        // de megabytes, e o aviso abaixo aparece no terminal.
        expect(passos[2].args).toEqual(['-f', DUMP]);
        expect(api.killCurrentSpecProcess).toHaveBeenCalled();
        expect(msgs()).not.toContain('terminal.wave.headerFallback');

        // A onda abre com o dump e com o layout que o proprio fluxo gerou.
        expect(api.launchGtkwaveOnly).toHaveBeenCalledTimes(1);
        const [chamada] = api.launchGtkwaveOnly.mock.calls[0];
        expect(chamada.args).toContain(DUMP);
        expect(chamada.args).toContain(COMP + '/Temp/' + SIM_TOP + '.gtkw');
        expect(api._arquivos.has(COMP + '/Temp/' + SIM_TOP + '.gtkw')).toBe(true);

        // Contagem: sem isto, um mundo falso incompleto passaria verde por
        // desistir cedo.
        expect(passos).toHaveLength(3);
        expect(terminal.calls.length).toBeGreaterThan(10);
        expect(houveErro()).toBe(false);
    });

    it('registra o layout da onda para o testbench', async () => {
        const mod = await novoModulo(CONFIG_PADRAO);
        ligarExecutor(api);

        await mod.runGtkWave();

        // O WaveStore guarda por testbench, e e dele que a proxima corrida le o
        // layout ativo em vez de gerar outro do zero.
        expect(api._arquivos.has(PROJ + '/testbench/' + SIM_TOP + '.json')).toBe(true);
    });
});

describe('as defesas do dump, confirmadas em campo no LABEL', () => {
    it('recusa antes de simular quando o dump existente esta bloqueado', async () => {
        const mod = await novoModulo(CONFIG_PADRAO);
        api._escrever(DUMP, 'FST velho', Date.now() - 600_000);
        api._travado = { nome: SIM_TOP + '.fst', code: 'EBUSY' };
        const passos = ligarExecutor(api);

        await expect(mod.runGtkWave()).rejects.toThrow('error.compilation.dumpLockedBusy');

        // O ponto da defesa e nao gastar a simulacao inteira para falhar no fim,
        // entao o vvp NAO pode ter rodado.
        expect(passos.map((p) => p.step)).not.toContain('vvp-run');
        expect(houveErro()).toBe(true);
    });

    it('recusa abrir onda velha quando o simulador sai bem mas nao reescreve o dump', async () => {
        const mod = await novoModulo(CONFIG_PADRAO);
        api._escrever(DUMP, 'FST da corrida anterior', Date.now() - 600_000);
        const passos = ligarExecutor(api, { gravaDump: false });

        await expect(mod.runGtkWave()).rejects.toThrow('error.compilation.dumpStale');

        // Este e o sintoma que o laboratorio relatou: tudo parece ter dado
        // certo, o simulador roda ate o fim, e a onda que abriria seria a de
        // ontem. A defesa so vale se o dump for procurado depois de simular.
        expect(passos.map((p) => p.step)).toEqual(['iverilog-build', 'vvp-run']);
        expect(api.launchGtkwaveOnly).not.toHaveBeenCalled();
    });
});

describe('as recusas que protegem o usuario', () => {
    it('sem testbench, para antes de chamar qualquer ferramenta', async () => {
        const mod = await novoModulo({ synthesizableFiles: CONFIG_PADRAO.synthesizableFiles });
        const passos = ligarExecutor(api);

        await expect(mod.runGtkWave()).rejects.toThrow('error.config.noTestbench');

        expect(passos).toHaveLength(0);
        expect(houveErro()).toBe(true);
    });

    it('sem o iverilog empacotado, recusa nomeando o caminho que faltou', async () => {
        const mod = await novoModulo(CONFIG_PADRAO);
        api._arquivos.delete(COMP + '/Packages/msys/mingw64/bin/iverilog.exe');
        const passos = ligarExecutor(api);

        await expect(mod.runGtkWave()).rejects.toThrow('error.toolchain.iverilogNotFound');

        expect(passos).toHaveLength(0);
    });
});
