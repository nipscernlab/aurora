/**
 * main/ipc/compile: os canais que abrem os visualizadores (GTKWave, Surfer),
 * gravam os tradutores do Surfer, decodificam complexos e param processos.
 *
 * Rodado de verdade, este modulo abre programas e mata processos. O cercado,
 * montado antes de o modulo carregar:
 *
 *   1. o execFile e o process.kill ficam travados (tests/helpers/cercado.js), e
 *      o beforeAll prova que o taskkill do utils cai na trava;
 *   2. o process_registry e falso nas duas copias: o spawnTracked devolve um
 *      filho de mentira, e o stopToolchainRun nao mata nada;
 *   3. o Electron e falso, com a pasta appData numa pasta temporaria, para a
 *      config e os tradutores do Surfer serem escritos ali.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { trancarProcessos, pastaTemporaria } from '../helpers/cercado.js';

const req = createRequire(import.meta.url);
const processos = trancarProcessos();
const tmp = pastaTemporaria('aurora-compile-');
const APPDATA = path.join(tmp.raiz, 'appData');
const CONFIG_SURFER = path.join(APPDATA, 'surfer-project', 'surfer', 'config');

const falsos = vi.hoisted(() => ({ filhos: [], permitido: { ok: true }, parada: null }));

const electron = vi.hoisted(() => ({
    ipcMain: { handle: (canal, fn) => { globalThis.__compileHandlers.set(canal, fn); } },
    app: { getPath: () => globalThis.__compileAppData },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}));
globalThis.__compileHandlers = new Map();
globalThis.__compileAppData = APPDATA;
vi.mock('electron', () => ({ default: electron, ...electron }));
req.cache[req.resolve('electron')] = { id: 'electron', loaded: true, exports: electron };

const log = { warn: () => {}, error: () => {}, info: () => {} };
vi.mock('electron-log', () => ({ default: log, ...log }));
req.cache[req.resolve('electron-log')] = { id: 'electron-log', loaded: true, exports: log };

/** Um filho de mentira: guarda o que recebe e emite quando o teste manda. */
function filhoFalso(pid = 4242) {
    const f = new EventEmitter();
    f.pid = pid;
    f.exitCode = null;
    f.killed = false;
    f.unref = vi.fn();
    f.stdout = new EventEmitter();
    f.stdin = Object.assign(new EventEmitter(), { escrito: '', write(t) { this.escrito += t; }, end: vi.fn() });
    return f;
}
const registro = {
    GROUP: Object.freeze({ RUN: 'run', VIEWER: 'viewer', SERVICE: 'service' }),
    spawnTracked: vi.fn((bin, args, opcoes, grupo) => {
        if (falsos.lancaNoSpawn) throw new Error(falsos.lancaNoSpawn);
        const f = filhoFalso(4242 + falsos.filhos.length);
        falsos.filhos.push({ bin, args, opcoes, grupo, filho: f });
        return f;
    }),
    stopToolchainRun: vi.fn(async () => falsos.parada),
};
vi.mock('../../main/process_registry.js', () => ({ default: registro, ...registro }));
req.cache[req.resolve('../../main/process_registry.js')] = { id: 'registry', loaded: true, exports: registro };

const allowlist = { isAllowed: vi.fn(() => falsos.permitido) };
vi.mock('../../main/compile/binary_allowlist.js', () => ({ default: allowlist, ...allowlist }));
req.cache[req.resolve('../../main/compile/binary_allowlist.js')] = { id: 'allowlist', loaded: true, exports: allowlist };

const handlers = globalThis.__compileHandlers;
const chamar = (canal, ...args) => handlers.get(canal)({}, ...args);
let state;

beforeAll(async () => {
    const mod = await import('../../main/ipc/compile.js');
    (mod.register ?? mod.default.register)();
    // A mesma copia que o modulo usa: pelo Vite (import), e nao pelo require nativo.
    const st = await import('../../main/state.js');
    state = st.default ?? st;
    await processos.provar();
});

afterAll(() => tmp.apagar());

beforeEach(() => {
    falsos.filhos.length = 0;
    falsos.permitido = { ok: true };
    falsos.parada = null;
    falsos.lancaNoSpawn = null;
    processos.execs.length = 0;
    processos.responder(() => ({}));
    fs.rmSync(APPDATA, { recursive: true, force: true });
    vi.clearAllMocks();
});

describe('launch-gtkwave-only', () => {
    const BIN = 'C:/comp/Packages/gtkwave-nipscern/gtkwave.exe';

    it('abre o GTKWave destacado, rastreado como visualizador', async () => {
        const r = await chamar('launch-gtkwave-only', { gtkwaveBin: BIN, args: ['a.fst'], workingDir: 'C:/tmp' });

        expect(r).toEqual({ success: true, gtkwavePid: 4242, message: 'GTKWave launched successfully' });
        const [{ bin, args, opcoes, grupo, filho }] = falsos.filhos;
        expect([bin, args, grupo]).toEqual([BIN, ['a.fst'], 'viewer']);
        expect(opcoes).toEqual({ cwd: 'C:/tmp', detached: true, stdio: 'ignore', windowsHide: false, shell: false });
        expect(filho.unref).toHaveBeenCalled();
        expect(allowlist.isAllowed).toHaveBeenCalledWith(BIN);
    });

    it.each([
        ['sem binario', { args: [] }, 'launch-gtkwave-only requires { gtkwaveBin, args[] }'],
        ['args que nao e lista', { gtkwaveBin: BIN, args: 'a' }, 'launch-gtkwave-only requires { gtkwaveBin, args[] }'],
    ])('%s: recusa', async (_nome, opcoes, mensagem) => {
        expect(await chamar('launch-gtkwave-only', opcoes)).toEqual({ success: false, message: mensagem });
        expect(falsos.filhos).toHaveLength(0);
    });

    it('binario fora da lista da toolchain: recusa sem abrir', async () => {
        falsos.permitido = { ok: false, error: 'nao permitido' };
        expect(await chamar('launch-gtkwave-only', { gtkwaveBin: 'C:/x.exe', args: [] }))
            .toEqual({ success: false, message: 'Refused to launch: nao permitido' });
        expect(falsos.filhos).toHaveLength(0);
    });

    it('erro do spawn que chega antes da resposta vira falha; spawn que lanca tambem', async () => {
        registro.spawnTracked.mockImplementationOnce(() => {
            const f = filhoFalso();
            f.on = (ev, cb) => { if (ev === 'error') cb(Object.assign(new Error('nao achou'), { code: 'ENOENT' })); return f; };
            return f;
        });
        const r = await chamar('launch-gtkwave-only', { gtkwaveBin: BIN, args: [] });
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/^GTKWave error: /);

        falsos.lancaNoSpawn = 'EACCES';
        const r2 = await chamar('launch-gtkwave-only', { gtkwaveBin: BIN, args: [] });
        expect(r2.success).toBe(false);
        expect(r2.message).toMatch(/^Failed to launch GTKWave: /);
    });
});

describe('launch-surfer', () => {
    let BIN;
    beforeAll(() => {
        BIN = path.join(tmp.raiz, 'surfer-aurora.exe');
        fs.writeFileSync(BIN, 'MZ');
    });

    it('abre o Surfer, escreve a janela centrada e fecha o anterior', async () => {
        const r = await chamar('launch-surfer', { surferBin: BIN, args: ['a.fst'], workingDir: 'C:/tmp' });
        expect(r).toEqual({ success: true, surferPid: 4242, message: 'Surfer launched successfully' });
        expect(falsos.filhos[0].grupo).toBe('viewer');
        const toml = fs.readFileSync(path.join(CONFIG_SURFER, 'config.toml'), 'utf8');
        expect(toml.length).toBeGreaterThan(0);

        // O segundo lancamento fecha o primeiro (uma janela so): taskkill pelo PID.
        await chamar('launch-surfer', { surferBin: BIN, args: [], workingDir: 'C:/tmp' });
        expect(processos.execs.some((e) => e[0] === 'taskkill' && e.includes('4242'))).toBe(true);
    });

    it('com varias janelas, o anterior fica aberto', async () => {
        await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true });
        processos.execs.length = 0;
        await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true });
        expect(processos.execs).toEqual([]);
    });

    it('config escrita a mao nao e sobrescrita', async () => {
        fs.mkdirSync(CONFIG_SURFER, { recursive: true });
        fs.writeFileSync(path.join(CONFIG_SURFER, 'config.toml'), 'minha = true\n');
        await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true });
        expect(fs.readFileSync(path.join(CONFIG_SURFER, 'config.toml'), 'utf8')).toBe('minha = true\n');
    });

    it('config que nao se escreve nao impede de abrir', async () => {
        const antes = electron.screen.getPrimaryDisplay;
        electron.screen.getPrimaryDisplay = () => { throw new Error('sem tela'); };
        try {
            expect((await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true })).success).toBe(true);
        } finally {
            electron.screen.getPrimaryDisplay = antes;
        }
    });

    it.each([
        ['sem binario', { args: [] }, 'launch-surfer requires { surferBin, args[] }'],
        ['binario que nao existe', { surferBin: 'C:/nao/existe.exe', args: [] }, 'Surfer not found at C:/nao/existe.exe'],
    ])('%s: recusa', async (_nome, opcoes, mensagem) => {
        expect(await chamar('launch-surfer', { multiWindow: true, ...opcoes })).toEqual({ success: false, message: mensagem });
    });

    it('binario fora da lista: recusa', async () => {
        falsos.permitido = { ok: false, error: 'fora' };
        expect(await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true }))
            .toEqual({ success: false, message: 'Refused to launch: fora' });
    });

    it('erro do spawn antes da resposta vira falha, uma vez so; spawn que lanca tambem', async () => {
        registro.spawnTracked.mockImplementationOnce(() => {
            const f = filhoFalso();
            f.on = (ev, cb) => {
                if (ev === 'error') { cb(new Error('um')); cb(new Error('dois')); }
                return f;
            };
            return f;
        });
        const r = await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true });
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/^Surfer error: /);

        falsos.lancaNoSpawn = 'EACCES';
        const r2 = await chamar('launch-surfer', { surferBin: BIN, args: [], multiWindow: true });
        expect(r2.message).toMatch(/^Failed to launch Surfer: /);
    });

    it('anterior que ja saiu nao e morto; taskkill que falha nao impede', async () => {
        await chamar('launch-surfer', { surferBin: BIN, args: [] });
        falsos.filhos.at(-1).filho.exitCode = 0;
        processos.execs.length = 0;
        await chamar('launch-surfer', { surferBin: BIN, args: [] });
        expect(processos.execs).toEqual([]);

        processos.responder(() => ({ lanca: 'taskkill quebrou' }));
        expect((await chamar('launch-surfer', { surferBin: BIN, args: [] })).success).toBe(true);
    });
});

describe('write-surfer-mappings', () => {
    const MAPAS = path.join(CONFIG_SURFER, 'mappings');

    it('grava cada tradutor valido na pasta global de mapeamentos', () => {
        const r = chamar('write-surfer-mappings', [
            { name: 'aurora_fir_opcode', content: 'Name = x\n' },
            { name: 'outro', content: 'Name = y\n' },
            null,
            { name: 3, content: 'x' },
            { name: '../../fora', content: 'x' },
        ]);
        expect(r.success).toBe(true);
        expect(r.written).toBeGreaterThanOrEqual(1);
        expect(fs.readdirSync(MAPAS).every((n) => !n.endsWith('.aurora.tmp'))).toBe(true);
        expect(fs.readdirSync(MAPAS).some((n) => fs.readFileSync(path.join(MAPAS, n), 'utf8') === 'Name = x\n')).toBe(true);
    });

    it('lista vazia ou que nao e lista: nada a gravar', () => {
        expect(chamar('write-surfer-mappings', [])).toEqual({ success: true, written: 0, failed: [] });
        expect(chamar('write-surfer-mappings', null)).toEqual({ success: true, written: 0, failed: [] });
    });

    it('tradutor que nao grava entra na lista de falhas; pasta que nao se cria, tambem', () => {
        fs.mkdirSync(MAPAS, { recursive: true });
        const alvo = fs.readdirSync(MAPAS).length;
        // Uma pasta com o nome do arquivo temporario faz o write dele falhar.
        const r0 = chamar('write-surfer-mappings', [{ name: 'aurora_a', content: 'x' }]);
        const nome = fs.readdirSync(MAPAS).find((n) => n.includes('aurora_a'));
        fs.rmSync(path.join(MAPAS, nome));
        fs.mkdirSync(path.join(MAPAS, `${nome}.aurora.tmp`));
        const r = chamar('write-surfer-mappings', [{ name: 'aurora_a', content: 'x' }]);
        expect(r0.success).toBe(true);
        expect(alvo).toBeGreaterThanOrEqual(0);
        expect(r.success).toBe(false);
        expect(r.failed).toEqual([{ name: 'aurora_a', error: expect.any(String) }]);

        const antes = electron.app.getPath;
        electron.app.getPath = () => { throw new Error('sem appData'); };
        try {
            expect(chamar('write-surfer-mappings', [{ name: 'aurora_b', content: 'x' }]))
                .toEqual({ success: false, written: 0, failed: [{ name: '*', error: 'sem appData' }] });
        } finally {
            electron.app.getPath = antes;
        }
    });
});

describe('decode-complex', () => {
    let EXE;
    beforeAll(() => {
        EXE = path.join(tmp.raiz, 'comp2gtkw.exe');
        fs.writeFileSync(EXE, 'MZ');
    });

    it('manda um valor por linha no stdin e devolve as linhas da saida', async () => {
        const pronto = chamar('decode-complex', { exePath: EXE, values: ['0001', '0010'] });
        const { filho, grupo, opcoes } = falsos.filhos[0];
        expect(grupo).toBe('run');
        expect(opcoes).toEqual({ stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
        expect(filho.stdin.escrito).toBe('0001\n0010\n');
        filho.stdin.emit('error', new Error('EPIPE'));
        filho.stdout.emit('data', Buffer.from('1 0i\r\n'));
        filho.stdout.emit('data', Buffer.from('2 0i\n\n'));
        filho.emit('close', 0);
        filho.emit('close', 0);
        expect(await pronto).toEqual({ success: true, decoded: ['1 0i', '2 0i'] });
    });

    it('filho que falha: success false com o que saiu', async () => {
        const pronto = chamar('decode-complex', { exePath: EXE, values: ['1'] });
        falsos.filhos[0].filho.emit('error', new Error('x'));
        expect(await pronto).toEqual({ success: false, decoded: [] });
    });

    it.each([
        ['sem pedido', undefined],
        ['sem valores', { exePath: 'C:/x.exe', values: [] }],
        ['valores que nao sao lista', { exePath: 'C:/x.exe', values: 'a' }],
        ['binario que nao existe', { exePath: 'C:/nao/existe.exe', values: ['1'] }],
    ])('%s: nada a decodificar', async (_nome, pedido) => {
        expect(await chamar('decode-complex', pedido)).toEqual({ success: false, decoded: [] });
        expect(falsos.filhos).toHaveLength(0);
    });

    it('binario fora da lista: recusa; spawn que lanca: falha', async () => {
        falsos.permitido = { ok: false, error: 'fora' };
        expect(await chamar('decode-complex', { exePath: EXE, values: ['1'] })).toEqual({ success: false, decoded: [] });
        falsos.permitido = { ok: true };
        falsos.lancaNoSpawn = 'EACCES';
        expect(await chamar('decode-complex', { exePath: EXE, values: ['1'] })).toEqual({ success: false, decoded: [] });
    });
});

describe('parar', () => {
    it('cancel-vvp-process: o registro mata o que estava rodando', async () => {
        falsos.parada = { hadActive: true, killed: 3 };
        expect(await chamar('cancel-vvp-process'))
            .toEqual({ success: true, message: 'Compilation canceled: 3 process(es) terminated' });
        falsos.parada = { hadActive: false, killed: 0 };
        expect(await chamar('cancel-vvp-process'))
            .toEqual({ success: false, message: 'No compilation process is currently running.' });
        registro.stopToolchainRun.mockRejectedValueOnce(new Error('quebrou'));
        expect(await chamar('cancel-vvp-process'))
            .toEqual({ success: false, message: 'Error occurred while canceling processes: quebrou' });
    });

    it('kill-current-spec-process mata so o filho parqueado e limpa o estado', async () => {
        state.currentVvpProcess = { pid: 777, killed: false };
        state.vvpProcessPid = 777;
        expect(await chamar('kill-current-spec-process')).toEqual({ success: true });
        expect(processos.execs.some((e) => e[0] === 'taskkill' && e.includes('777'))).toBe(true);
        expect(state.currentVvpProcess).toBeNull();
        expect(state.vvpProcessPid).toBeNull();
    });

    it('sem filho parqueado, ou ja morto: nada a fazer', async () => {
        state.currentVvpProcess = null;
        expect(await chamar('kill-current-spec-process')).toEqual({ success: false });
        state.currentVvpProcess = { pid: 1, killed: true };
        expect(await chamar('kill-current-spec-process')).toEqual({ success: false });
    });

    it('taskkill que lanca: falha com a mensagem, e o estado limpo mesmo assim', async () => {
        processos.responder(() => ({ lanca: 'sem permissao' }));
        state.currentVvpProcess = { pid: 9, killed: false };
        expect(await chamar('kill-current-spec-process')).toEqual({ success: false, message: 'sem permissao' });
        expect(state.currentVvpProcess).toBeNull();
    });
});
