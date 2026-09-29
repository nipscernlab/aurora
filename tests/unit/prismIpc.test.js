/**
 * main/ipc/prism: os caminhos que a sintese aceita, o esquematico (yosys,
 * divisao do hierarchy.json, SVG pelo netlistsvg com as skins do SAPHO), a
 * janela do PRISM, a simulacao interativa (DigitalJS) e os canais que a pagina
 * do PRISM usa para falar com a janela que a abriu.
 *
 * Rodado de verdade, este modulo roda o yosys. O cercado, montado antes de o
 * modulo carregar:
 *
 *   1. o execFile e o process.kill ficam travados (tests/helpers/cercado.js), e
 *      o beforeAll prova que a trava pegou;
 *   2. o process_registry e falso nas duas copias: o spawnTracked devolve um
 *      yosys de mentira, que grava o JSON que o yosys gravaria e fecha;
 *   3. o Electron, as janelas principais, o .spf da janela e o carregador de
 *      pagina sao falsos; o components/ e o projeto ficam numa pasta temporaria.
 *
 * O netlistsvg e as skins de assets/prism-skins sao os de verdade: o desenho
 * roda no proprio processo, sem nada de fora.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cercar, pastaTemporaria } from '../helpers/cercado.js';

const req = createRequire(import.meta.url);
const tmp = pastaTemporaria('aurora-prism-');
const COMPONENTES = path.join(tmp.raiz, 'components');
const HDL = path.join(COMPONENTES, 'SAPHO');
const PROJETO = path.join(tmp.raiz, 'proj');
const SPF = path.join(PROJETO, 'proj.spf');
const TEMP_PRISM = path.join(PROJETO, '.aurora', 'Temp', 'PRISM');
const YOSYS = path.join(COMPONENTES, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');

/** O que cada teste configura para os falsos. */
const falsos = {
    spf: SPF,
    yosys: null,
    filhos: [],
    permitido: { ok: true },
    falhaLoad: null,
    pagina: { ok: true, url: 'file:///dist/html/prism/prism.html' },
    mandarOk: true,
    minimizada: false,
};

/** Um webContents de mentira: guarda o que recebe. */
function contentsFalso(id) {
    const wc = new EventEmitter();
    wc.id = id;
    wc.recebidos = [];
    wc.carregando = false;
    wc.send = (canal, ...args) => { wc.recebidos.push({ canal, args }); };
    wc.isLoading = () => wc.carregando;
    wc.isDestroyed = () => false;
    return wc;
}

const criadas = [];
class JanelaFalsa extends EventEmitter {
    constructor(opcoes) {
        super();
        this.opcoes = opcoes;
        this.destruida = false;
        this.focos = 0;
        this.webContents = contentsFalso(900 + criadas.length);
        criadas.push(this);
    }
    isDestroyed() { return this.destruida; }
    destroy() { this.destruida = true; }
    focus() { this.focos++; }
    maximize() { this.maximizada = true; }
    show() { this.mostrada = true; }
    isMaximized() { return true; }
    isFullScreen() { return false; }
}

const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
const c = cercar({
    electron: { extra: { BrowserWindow: JanelaFalsa, dialog } },
    processos: true,
    paths: { componentsPath: COMPONENTES },
});

/** Poe o falso nas duas copias: a do Vite (import) e a do require nativo. */
function falsificar(rel, exports) {
    vi.doMock(rel, () => ({ default: exports, ...exports }));
    req.cache[req.resolve(rel)] = { id: rel, loaded: true, exports };
}

const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
falsificar('electron-log', log);

/** Um yosys de mentira: `falsos.yosys(filho, bin, args, opcoes)` decide o que ele faz. */
function filhoFalso() {
    const f = new EventEmitter();
    f.stdout = new EventEmitter();
    f.stderr = new EventEmitter();
    f.kill = vi.fn();
    return f;
}
const registro = {
    GROUP: Object.freeze({ RUN: 'run', VIEWER: 'viewer', SERVICE: 'service' }),
    spawnTracked: vi.fn((bin, args, opcoes, grupo) => {
        const f = filhoFalso();
        falsos.filhos.push({ bin, args, opcoes, grupo, filho: f });
        if (falsos.yosys) falsos.yosys(f, bin, args, opcoes);
        return f;
    }),
};
falsificar('../../main/process_registry.js', registro);

falsificar('../../main/compile/binary_allowlist.js', { isAllowed: vi.fn(() => falsos.permitido) });

// A janela principal que abre o PRISM tem webContents.id 1.
const principal = {
    webContents: contentsFalso(1),
    isMinimized: () => falsos.minimizada,
    restore: vi.fn(),
    focus: vi.fn(),
};
const janelas = {
    mandar: vi.fn(() => falsos.mandarOk),
    doSender: vi.fn((origem) => {
        const id = origem?.sender?.id ?? origem?.id;
        return id === 1 ? principal : null;
    }),
};
falsificar('../../main/main_windows.js', janelas);

// So a janela 1 tem projeto; a pagina do PRISM (outro id) nao tem.
falsificar('../../main/ipc/project_paths.js', {
    spfDaJanela: vi.fn((ev) => (ev?.sender?.id === 1 ? falsos.spf : null)),
});

falsificar('../../main/render_loader.js', {
    loadPage: vi.fn(async () => { if (falsos.falhaLoad) throw new Error(falsos.falhaLoad); }),
    pageUrl: vi.fn(() => falsos.pagina),
});

// O conversor do DigitalJS entra pelo require (preguicoso de proposito), nas
// duas versoes do modulo; o falso devolve o circuito que o teste montou.
const conversor = { yosys2digitaljs: vi.fn(() => structuredClone(falsos.circuito)) };
req.cache[req.resolve('yosys2digitaljs/core')] = { id: 'yosys2digitaljs/core', loaded: true, exports: conversor };

const handlers = c.electron.handlers;
const DA_JANELA = { sender: { id: 1 } };
const DA_PAGINA = { sender: { id: 7 } };
const chamar = (canal, evento, ...args) => handlers.get(canal)(evento, ...args);

let prism;
let state;

beforeAll(async () => {
    prism = await import('../../main/ipc/prism.js');
    (prism.register ?? prism.default.register)();
    // A mesma copia que o modulo usa: pelo Vite (import), e nao pelo require nativo.
    const st = await import('../../main/state.js');
    state = st.default ?? st;
    await c.provar();
});

afterAll(() => tmp.apagar());

/** O netlist que o yosys de mentira grava no hierarchy.json. */
function hierarquia() {
    return {
        creator: 'Yosys teste',
        modules: {
            top: {
                ports: { a: { direction: 'input', bits: [2] }, y: { direction: 'output', bits: [3] } },
                cells: {
                    u1: { type: 'filho', port_directions: { a: 'input', y: 'output' }, connections: { a: [2], y: [3] } },
                    'genblk3.u2': { type: '$paramod\\filho2\\W=8', port_directions: { a: 'input' }, connections: { a: [2] } },
                    'pc$top.v:3$1': {
                        type: 'pc',
                        port_directions: { clk: 'input', extra: 'input', addr: 'output' },
                        connections: { clk: [2], extra: [2], addr: [4] },
                    },
                },
            },
            filho: { ports: { a: { direction: 'input', bits: [2] } }, cells: {} },
            '$paramod\\filho2\\W=8': { ports: { a: { direction: 'input', bits: [2] } } },
            '$add': { cells: {} },
        },
    };
}

/** O yosys do esquematico: grava o hierarchy.json onde o script manda e fecha. */
function yosysDoEsquematico(codigo = 0, stderr = '') {
    return (f, _bin, _args, opcoes) => {
        setImmediate(() => {
            if (codigo === 0) fs.writeFileSync(path.join(opcoes.cwd, 'hierarchy.json'), JSON.stringify(hierarquia()));
            if (stderr) f.stderr.emit('data', Buffer.from(stderr));
            f.stdout.emit('data', Buffer.from('log'));
            f.emit('close', codigo);
        });
    };
}

/** O yosys da simulacao: grava o digitaljs.json com `celulas` celulas e fecha. */
function yosysDaSimulacao(celulas = 2, codigo = 0) {
    return (f, _bin, _args, opcoes) => {
        setImmediate(() => {
            const cells = {};
            for (let i = 0; i < celulas; i++) cells[`c${i}`] = { type: '$and' };
            fs.writeFileSync(path.join(opcoes.cwd, 'digitaljs.json'), JSON.stringify({ modules: { top: { cells }, vazio: null } }));
            if (codigo !== 0) f.stderr.emit('data', Buffer.from('erro do yosys'));
            f.emit('close', codigo);
        });
    };
}

function escrever(arquivo, texto = 'module m; endmodule\n') {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, texto);
}

/** Um projeto com arquivos em todos os lugares de onde a sintese os coleta. */
function montarProjeto(spf = {}) {
    fs.rmSync(tmp.raiz, { recursive: true, force: true });
    for (const f of ['lib.v', 'lib_tb.v', 'mytest.v']) escrever(path.join(HDL, f));
    escrever(path.join(HDL, 'leia.txt'), 'nada');
    escrever(path.join(PROJETO, 'rtl', 'top.v'));
    escrever(path.join(tmp.raiz, 'fora', 'abs.v'));
    escrever(path.join(PROJETO, 'TopLevel', 'tl.v'));
    escrever(path.join(PROJETO, 'TopLevel', 'tl_tb.v'));
    escrever(path.join(PROJETO, 'proc1', 'Hardware', 'p1.v'));
    escrever(path.join(PROJETO, 'proc1', 'Hardware', 'p1_tb.v'));
    escrever(path.join(PROJETO, 'proc2', 'Hardware', 'p2.v'));
    const structure = {
        topLevelFile: 'rtl/top.v',
        synthesizableFiles: ['rtl/top.v', { path: path.join(tmp.raiz, 'fora', 'abs.v') }, 'nota.txt', null],
        processors: ['proc1', { name: 'proc2' }, { name: 'proc3' }, {}],
        ...spf,
    };
    fs.writeFileSync(SPF, JSON.stringify({ structure }));
}

beforeEach(() => {
    falsos.spf = SPF;
    falsos.yosys = null;
    falsos.filhos.length = 0;
    falsos.permitido = { ok: true };
    falsos.falhaLoad = null;
    falsos.pagina = { ok: true, url: 'file:///dist/html/prism/prism.html' };
    falsos.mandarOk = true;
    falsos.minimizada = false;
    falsos.circuito = { devices: {} };
    criadas.length = 0;
    state.prismWindow = null;
    state.prismTabContents = new Map();
    state.prismDono = null;
    principal.webContents.recebidos.length = 0;
    c.electron.electron.app.getAppPath = () => path.resolve('.');
    vi.clearAllMocks();
    montarProjeto();
});

/** As linhas que foram para o terminal PRISM, por tipo. */
function terminal() {
    return janelas.mandar.mock.calls
        .filter(([, canal, term]) => canal === 'terminal-log' && term === 'tprism')
        .map(([, , , texto, tipo]) => [tipo, texto]);
}

describe('get-prism-compilation-paths (caminhosConfiaveis)', () => {
    it('tudo sai do components/ e do .spf da janela que pediu', async () => {
        expect(await chamar('get-prism-compilation-paths', DA_JANELA)).toEqual({
            projectPath: PROJETO,
            componentsPath: COMPONENTES,
            hdlPath: path.join(COMPONENTES, 'SAPHO'),
            tempPath: TEMP_PRISM,
            yosysPath: YOSYS,
            spfPath: SPF,
            topLevelPath: path.join(PROJETO, 'TopLevel'),
            prismMode: undefined,
            yosysOverride: undefined,
        });
    });

    it('da pagina do PRISM, vale o projeto de quem abriu o PRISM', async () => {
        state.prismDono = 1;
        expect((await chamar('get-prism-compilation-paths', DA_PAGINA)).spfPath).toBe(SPF);
    });

    it('sem projeto, recusa', async () => {
        await expect(chamar('get-prism-compilation-paths', DA_PAGINA)).rejects.toThrow('No project path available');
        expect(log.error).toHaveBeenCalled();
    });
});

describe('prism-compile-with-paths (o esquematico)', () => {
    it('sintetiza, divide a hierarquia, desenha o topo e abre a janela', async () => {
        falsos.yosys = yosysDoEsquematico();
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {
            // O que vira caminho no pedido e ignorado; so prismMode e yosysOverride contam.
            yosysPath: 'C:/malicioso.exe',
            tempPath: 'C:/qualquer',
            yosysOverride: { envSet: { BOA: '1', 'RUIM-CHAVE': 'x', NULO: 'a\0b', NUM: 3 }, envUnset: ['PATH'] },
        });

        expect(r).toEqual({
            success: true,
            message: 'PRISM compilation completed successfully',
            topLevelModule: 'top',
            svgPath: path.join(TEMP_PRISM, 'top.svg'),
            tempDir: TEMP_PRISM,
        });

        // O yosys e o do components/, rodando na Temp do projeto.
        const [{ bin, args, opcoes, grupo }] = falsos.filhos;
        const script = path.join(TEMP_PRISM, 'yosys_script.ys');
        expect([bin, args, grupo, opcoes.cwd]).toEqual([YOSYS, ['-s', script], 'run', TEMP_PRISM]);
        expect(opcoes.env.BOA).toBe('1');
        expect(opcoes.env).not.toHaveProperty('RUIM-CHAVE');
        expect(opcoes.env).not.toHaveProperty('NULO');
        expect(opcoes.env).not.toHaveProperty('NUM');
        expect(opcoes.env).not.toHaveProperty('PATH');

        // Os .v coletados: HDL sem testbench nem teste, o .spf (relativo e
        // absoluto), TopLevel/ e o Hardware/ de cada processador.
        const ys = fs.readFileSync(script, 'utf8');
        for (const f of ['lib.v', 'top.v', 'abs.v', 'tl.v', 'p1.v', 'p2.v']) expect(ys).toContain(f);
        for (const f of ['lib_tb.v', 'mytest.v', 'leia.txt', 'nota.txt', 'tl_tb.v', 'p1_tb.v']) expect(ys).not.toContain(f);

        // Um JSON por modulo clicavel, com o nome limpo.
        const jsons = fs.readdirSync(TEMP_PRISM).filter((f) => f.endsWith('.json')).sort();
        expect(jsons).toEqual(['filho.json', 'filho2.json', 'hierarchy.json', 'top.json']);
        const top = JSON.parse(fs.readFileSync(path.join(TEMP_PRISM, 'top.json'), 'utf8'));
        expect(top.creator).toBe('Yosys teste');
        expect(Object.keys(top.modules.top.cells)).toEqual(['u1', 'u2', 'pc$top.v:3$1']);
        expect(top.modules.top.cells.u2.type).toBe('filho2');

        // O SVG: tipo de cada instancia injetado, e a porta que a skin do pc
        // nao desenha fica de fora, com aviso.
        const svg = fs.readFileSync(r.svgPath, 'utf8');
        expect(svg).toContain('id="cell_u1" data-cell-type="filho"');
        expect(svg).not.toMatch(/cell_pc[^"]*\.extra|s:pid="extra"/);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('porta "extra" nao esta na skin'));

        // Terminal da janela do projeto, e a janela do PRISM aberta com o resultado.
        expect(terminal()).toEqual([
            ['info', 'Starting PRISM compilation process'],
            ['tips', 'Top-level: top.v'],
            ['info', 'Running Yosys synthesis...'],
            ['success', 'PRISM compilation completed successfully'],
        ]);
        expect(state.prismDono).toBe(1);
        expect(criadas).toHaveLength(1);
        const [janela] = criadas;
        expect(state.prismWindow).toBe(janela);
        expect(janela.opcoes.webPreferences.preload).toBe(path.resolve('js', 'app', 'preload_prism.js'));
        expect(janela.maximizada && janela.mostrada).toBe(true);
        expect(janela.webContents.recebidos).toEqual([{ canal: 'compilation-complete', args: [r] }]);
        expect(janelas.mandar).toHaveBeenCalledWith({ origem: { id: 1 }, reserva: false }, 'prism-status', true);

        // Os eventos da janela: estado de maximizar e o fechamento.
        janela.emit('maximize');
        expect(janela.webContents.recebidos.at(-1)).toEqual({
            canal: 'prism:window-state', args: [{ isMaximized: true, isFullScreen: false }],
        });
        janela.webContents.emit('did-fail-load', {}, -3, 'abortado', 'file:///x');
        expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'PRISM Load Failed' }));
        janela.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        janela.emit('closed');
        expect(state.prismWindow).toBeNull();
        expect(state.prismDono).toBeNull();
    });

    it('no modo aba, nao cria janela', async () => {
        falsos.yosys = yosysDoEsquematico();
        const r = await chamar('prism-compile-with-paths', DA_JANELA, { prismMode: 'tab' });
        expect(r.success).toBe(true);
        expect(criadas).toHaveLength(0);
    });

    it('com a janela ja aberta, manda o resultado para ela, agora ou quando carregar', async () => {
        falsos.yosys = yosysDoEsquematico();
        const aberta = new JanelaFalsa({});
        state.prismWindow = aberta;
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(aberta.focos).toBe(1);
        expect(aberta.webContents.recebidos).toEqual([{ canal: 'compilation-complete', args: [r] }]);

        aberta.webContents.recebidos.length = 0;
        aberta.webContents.carregando = true;
        const r2 = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(aberta.webContents.recebidos).toEqual([]);
        aberta.webContents.emit('did-finish-load');
        expect(aberta.webContents.recebidos).toEqual([{ canal: 'compilation-complete', args: [r2] }]);
    });

    it('yosys com erro: a mensagem vai ao terminal e volta como falha', async () => {
        falsos.yosys = yosysDoEsquematico(1, 'syntax error');
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(r).toEqual({ success: false, message: 'Yosys exited with code 1' });
        expect(terminal()).toContainEqual(['error', 'Yosys error: syntax error']);
        expect(terminal()).toContainEqual(['error', 'Compilation failed: Yosys exited with code 1']);
        expect(criadas).toHaveLength(0);
    });

    it('yosys que fecha sem gravar o hierarchy.json', async () => {
        falsos.yosys = (f) => setImmediate(() => f.emit('close', 0));
        expect(await chamar('prism-compile-with-paths', DA_JANELA, {}))
            .toEqual({ success: false, message: 'hierarchy.json was not created' });
    });

    it('yosys que nem nasce', async () => {
        falsos.yosys = (f) => setImmediate(() => f.emit('error', new Error('spawn ENOENT')));
        expect(await chamar('prism-compile-with-paths', DA_JANELA, {}))
            .toEqual({ success: false, message: 'spawn ENOENT' });
    });

    it('o -s do script e protegido: um override que o remove e recusado', async () => {
        const r = await chamar('prism-compile-with-paths', DA_JANELA, { yosysOverride: { removeArgs: ['-s'] } });
        expect(r.success).toBe(false);
        expect(falsos.filhos).toHaveLength(0);
    });

    it('prependArgs e appendArgs entram em volta do -s', async () => {
        falsos.yosys = yosysDoEsquematico();
        await chamar('prism-compile-with-paths', DA_JANELA, { yosysOverride: { prependArgs: ['-q'], appendArgs: ['-l', 'x.log'] } });
        expect(falsos.filhos[0].args).toEqual(['-q', '-s', path.join(TEMP_PRISM, 'yosys_script.ys'), '-l', 'x.log']);
    });

    it('binario fora da lista: recusa sem rodar', async () => {
        falsos.permitido = { ok: false, error: 'fora da lista' };
        expect(await chamar('prism-compile-with-paths', DA_JANELA, {}))
            .toEqual({ success: false, message: 'Yosys binary refused: fora da lista' });
        expect(falsos.filhos).toHaveLength(0);
    });

    it('sem .v nenhum, sem .spf, ou com top-level invalido', async () => {
        fs.rmSync(tmp.raiz, { recursive: true, force: true });
        fs.mkdirSync(PROJETO, { recursive: true });
        fs.writeFileSync(SPF, JSON.stringify({ structure: { topLevelFile: 'top.v' } }));
        expect((await chamar('prism-compile-with-paths', DA_JANELA, {})).message).toBe('No Verilog files found for compilation');

        fs.writeFileSync(SPF, JSON.stringify({ structure: { topLevelFile: 'nao-e-id.v' } }));
        expect((await chamar('prism-compile-with-paths', DA_JANELA, {})).message).toMatch(/not a plain Verilog identifier/);

        fs.rmSync(SPF);
        expect((await chamar('prism-compile-with-paths', DA_JANELA, {})).message).toBe('.spf not found');
    });

    it('.spf que nao e JSON na leitura da estrutura e tolerado so ali', async () => {
        fs.writeFileSync(SPF, '{ quebrado');
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(r.success).toBe(false);
    });

    it('sem projeto na janela: falha sem sintetizar', async () => {
        const r = await chamar('prism-compile-with-paths', DA_PAGINA, {});
        expect(r).toEqual({ success: false, message: 'No project path available' });
    });

    it('pagina que nao carrega: avisa, destroi a janela e falha', async () => {
        falsos.yosys = yosysDoEsquematico();
        falsos.falhaLoad = 'sem bundle';
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(r).toEqual({ success: false, message: 'sem bundle' });
        expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'PRISM Load Error' }));
        expect(criadas[0].destruida).toBe(true);
        expect(state.prismWindow).toBeNull();
    });

    it('sem o preload do PRISM, nem cria a janela', async () => {
        falsos.yosys = yosysDoEsquematico();
        c.electron.electron.app.getAppPath = () => tmp.raiz;
        const r = await chamar('prism-compile-with-paths', DA_JANELA, {});
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/^Preload script not found: /);
        expect(criadas).toHaveLength(0);
    });
});

describe('prism-recompile', () => {
    it('sem caminhos, recusa', async () => {
        expect(await chamar('prism-recompile', DA_JANELA, null))
            .toEqual({ success: false, message: 'Compilation paths are required for re-compilation.' });
    });

    it('com a janela aberta, manda o resultado para ela e a foca', async () => {
        falsos.yosys = yosysDoEsquematico();
        const aberta = new JanelaFalsa({});
        state.prismWindow = aberta;
        const r = await chamar('prism-recompile', DA_JANELA, {});
        expect(r.success).toBe(true);
        expect(aberta.webContents.recebidos).toEqual([{ canal: 'compilation-complete', args: [r] }]);
        expect(aberta.focos).toBe(1);

        aberta.webContents.recebidos.length = 0;
        aberta.webContents.carregando = true;
        const r2 = await chamar('prism-recompile', DA_JANELA, {});
        aberta.webContents.emit('did-finish-load');
        expect(aberta.webContents.recebidos).toEqual([{ canal: 'compilation-complete', args: [r2] }]);
    });

    it('sem janela, abre uma; no modo aba, nao', async () => {
        falsos.yosys = yosysDoEsquematico();
        await chamar('prism-recompile', DA_JANELA, { prismMode: 'tab' });
        expect(criadas).toHaveLength(0);
        await chamar('prism-recompile', DA_JANELA, {});
        expect(criadas).toHaveLength(1);
    });

    it('a falha da sintese volta como falha', async () => {
        falsos.yosys = yosysDoEsquematico(2);
        expect(await chamar('prism-recompile', DA_JANELA, {}))
            .toEqual({ success: false, message: 'Yosys exited with code 2' });
    });
});

describe('generate-svg-from-module', () => {
    it('desenha o modulo clicado a partir do JSON dele, na Temp do projeto', async () => {
        falsos.yosys = yosysDoEsquematico();
        await chamar('prism-compile-with-paths', DA_JANELA, { prismMode: 'tab' });
        state.prismDono = 1;
        const r = await chamar('generate-svg-from-module', DA_PAGINA, 'filho', 'C:/ignorado');
        expect(r).toEqual({
            success: true,
            svgPath: path.join(TEMP_PRISM, 'filho.svg'),
            moduleName: 'filho',
            moduleJsonPath: path.join(TEMP_PRISM, 'filho.json'),
        });
        expect(fs.readFileSync(r.svgPath, 'utf8')).toMatch(/^<svg/);
    });

    it('modulo sem JSON: falha', async () => {
        expect(await chamar('generate-svg-from-module', DA_JANELA, 'inexistente'))
            .toEqual({ success: false, message: 'Module JSON not found for: inexistente' });
    });
});

describe('__loadCustomSkinBlocks', () => {
    const carregar = (dir) => (prism.__loadCustomSkinBlocks ?? prism.default.__loadCustomSkinBlocks)(dir);

    it('pasta que nao existe: nenhuma skin, sem aviso', async () => {
        expect(await carregar(path.join(tmp.raiz, 'nao-existe'))).toEqual([]);
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('caminho que nao e pasta: nenhuma skin, com aviso', async () => {
        expect(await carregar(SPF)).toEqual([]);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('nao consegui ler'), expect.any(String));
    });

    it('o ultimo arquivo a definir um tipo ganha; _ e nao-.svg ficam de fora; <g> aninhado e auto-fechado', async () => {
        const dir = path.join(tmp.raiz, 'skins');
        escrever(path.join(dir, 'a.svg'), '<svg><g s:type="x"><g><rect/></g><g/></g><g s:type="y">Y</g></svg>');
        escrever(path.join(dir, 'b.svg'), '<svg><g s:type="x">X2</g></svg>');
        escrever(path.join(dir, '_modelo.svg'), '<svg><g s:type="z">Z</g></svg>');
        escrever(path.join(dir, 'leia.txt'), '<g s:type="w">W</g>');
        expect(await carregar(dir)).toEqual([
            ['x', '<g s:type="x">X2</g>'],
            ['y', '<g s:type="y">Y</g>'],
        ]);
    });

    it('sem nenhuma skin custom, o desenho sai com as formas de fabrica e um aviso', async () => {
        falsos.yosys = yosysDoEsquematico();
        c.electron.electron.app.getAppPath = () => path.resolve('.');
        await chamar('prism-compile-with-paths', DA_JANELA, { prismMode: 'tab' });
        // A Temp ja tem os JSONs; agora sem as skins do SAPHO.
        c.electron.electron.app.getAppPath = () => tmp.raiz;
        const r = await chamar('generate-svg-from-module', DA_JANELA, 'top');
        expect(r.success).toBe(true);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('nenhuma skin custom carregada'));
    });
});

describe('prism:build-digitaljs (a simulacao interativa)', () => {
    it('simula o modulo aberto com os parametros dele e arruma o circuito', async () => {
        falsos.yosys = yosysDaSimulacao();
        falsos.circuito = {
            devices: {
                relogio: { type: 'Input', net: 'clk', bits: 1, label: '$in$clk' },
                dado: { type: 'Input', net: 'a', bits: 8, label: 'a' },
                outro: { type: 'Input', label: 'clock' },
                reg: { type: 'Dff', bits: 4 },
                regx: { type: 'Dff', bits: 2, initial: 'x1' },
                regok: { type: 'Dff', bits: 2, initial: '01' },
                inst: { type: 'Subcircuit', celltype: '$paramod$abc\\mem_data', label: '$sub$1' },
                inst2: { type: 'Subcircuit', celltype: 'mem_data' },
                nulo: null,
            },
            subcircuits: {
                '$paramod$abc\\mem_data': { devices: { r: { type: 'Dff' }, n: { type: 'Not', label: '$not$1' } } },
                mem_data: { devices: { i: { type: 'Subcircuit', celltype: 'mem_data' } } },
                vazio: {},
            },
        };
        const r = await chamar('prism:build-digitaljs', DA_JANELA, {}, ' $paramod\\ula\\W=8 ');

        expect(r.ok).toBe(true);
        expect(r.topLevelModule).toBe('ula');
        const [{ bin, args, opcoes, grupo }] = falsos.filhos;
        expect([bin, grupo, opcoes.cwd]).toEqual([YOSYS, 'run', TEMP_PRISM]);
        expect(args).toEqual(['-s', path.join(TEMP_PRISM, 'digitaljs_yosys.ys')]);
        const ys = fs.readFileSync(args[1], 'utf8');
        expect(ys).toContain('hierarchy -top ula -chparam W 8');
        expect(ys).toMatch(/^write_json ".*digitaljs\.json"$/m);
        for (const f of ['lib.v', 'top.v', 'abs.v', 'tl.v', 'p1.v', 'p2.v']) expect(ys).toContain(f);
        expect(ys).not.toContain('_tb.v');
        expect(conversor.yosys2digitaljs).toHaveBeenCalledWith(
            { modules: { top: { cells: { c0: { type: '$and' }, c1: { type: '$and' } } }, vazio: null } }, {});

        const { devices, subcircuits } = r.circuit;
        expect(devices.relogio).toEqual({ type: 'Clock', net: 'clk', propagation: 50, label: '' });
        expect(devices.dado).toEqual({ type: 'Input', net: 'a', bits: 8, label: 'a' });
        expect(devices.outro).toEqual({ type: 'Clock', label: 'clock', propagation: 50 });
        expect(devices.reg.initial).toBe('0000');
        expect(devices.regx.initial).toBe('00');
        expect(devices.regok.initial).toBe('01');
        expect(devices.inst).toEqual({ type: 'Subcircuit', celltype: 'mem_data', label: '' });
        expect(devices.inst2.celltype).toBe('mem_data#2');
        expect(Object.keys(subcircuits)).toEqual(['mem_data', 'mem_data#2', 'vazio']);
        expect(subcircuits.mem_data.devices).toEqual({ r: { type: 'Dff', initial: '0' }, n: { type: 'Not', label: '' } });
        expect(subcircuits['mem_data#2'].devices.i.celltype).toBe('mem_data#2');

        const linhas = terminal();
        expect(linhas[0]).toEqual(['info', 'DigitalJS: simulating ula (W=8)…']);
        expect(linhas).toContainEqual(['info', 'DigitalJS: synthesizing with Yosys (6 files)…']);
        expect(linhas).toContainEqual(['info', 'DigitalJS: netlist 2 cells — converting…']);
        expect(linhas).toContainEqual(['tips', 'DigitalJS: 3 register(s) start at 0, as after power-on; a reset in the design still applies.']);
        expect(linhas.at(-1)[0]).toBe('success');
        expect(linhas.at(-1)[1]).toMatch(/^DigitalJS: converted to 9 devices in /);
    });

    it('sem modulo pedido, simula o topo do .spf; circuito sem registradores nem subcircuitos', async () => {
        falsos.yosys = yosysDaSimulacao();
        falsos.circuito = { devices: { e: { type: 'Input', net: 'a', bits: 1 } } };
        const r = await chamar('prism:build-digitaljs', DA_JANELA, {}, undefined);
        expect(r.ok).toBe(true);
        expect(r.topLevelModule).toBe('top');
        expect(terminal()[0]).toEqual(['info', 'DigitalJS: simulating top…']);
        expect(terminal().some(([tipo]) => tipo === 'tips')).toBe(false);
    });

    it('circuito sem devices: nada a arrumar', async () => {
        falsos.yosys = yosysDaSimulacao();
        falsos.circuito = {};
        const r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
        expect(r).toEqual({ ok: true, circuit: {}, topLevelModule: 'top' });
    });

    it('nome com hash: avisa que os parametros se perderam', async () => {
        falsos.yosys = yosysDaSimulacao();
        await chamar('prism:build-digitaljs', DA_JANELA, {}, '$paramod$0123abcd\\ula');
        expect(terminal()).toContainEqual(['warning',
            'DigitalJS: the yosys name "$paramod$0123abcd\\ula" does not carry the parameters; ula is simulated with the Verilog defaults.']);
    });

    it('netlist grande demais: recusa com os numeros', async () => {
        falsos.yosys = yosysDaSimulacao(3001);
        const r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
        expect(r).toEqual({
            ok: false,
            message: 'top is too large for interactive simulation (3001 cells, limit 3000)',
            reason: 'too-large',
            module: 'top',
            cells: 3001,
            limit: 3000,
            seconds: undefined,
        });
        expect(terminal().at(-1)).toEqual(['error', 'DigitalJS: top is too large for interactive simulation (3001 cells, limit 3000)']);
        expect(conversor.yosys2digitaljs).not.toHaveBeenCalled();
    });

    it('yosys que nao termina: mata o filho e recusa com o prazo', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            falsos.yosys = () => setImmediate(() => vi.advanceTimersByTime(45000));
            const r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
            expect(r).toEqual({
                ok: false,
                message: 'Yosys synthesis of top timed out (45s)',
                reason: 'timeout',
                module: 'top',
                cells: undefined,
                limit: undefined,
                seconds: 45,
            });
            expect(falsos.filhos[0].filho.kill).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('yosys com erro, que nem nasce, ou que fecha duas vezes', async () => {
        falsos.yosys = yosysDaSimulacao(1, 3);
        let r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
        expect(r).toMatchObject({ ok: false, message: 'yosys exited 3: erro do yosys', reason: 'error' });

        falsos.yosys = (f) => setImmediate(() => { f.emit('error', 'texto'); f.emit('close', 0); });
        r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
        expect(r).toMatchObject({ ok: false, message: 'texto', reason: 'error' });

        falsos.yosys = (f) => setImmediate(() => f.emit('close', 9));
        r = await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top');
        expect(r.message).toBe('yosys exited 9');
    });

    it('as recusas antes do yosys, e o nome que nao e identificador', async () => {
        // Nome que nao e identificador: cai no topo do .spf.
        falsos.yosys = yosysDaSimulacao();
        expect((await chamar('prism:build-digitaljs', DA_JANELA, {}, 'nao valido!')).topLevelModule).toBe('top');
        falsos.yosys = null;
        falsos.filhos.length = 0;

        falsos.permitido = { ok: false, error: 'nao' };
        expect((await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top')).message).toBe('Yosys binary refused: nao');
        falsos.permitido = { ok: true };

        fs.writeFileSync(SPF, JSON.stringify({ structure: {} }));
        expect((await chamar('prism:build-digitaljs', DA_JANELA, {}, '')).message)
            .toBe('No module to simulate: nothing is open in PRISM and the .spf has no top-level');

        fs.rmSync(tmp.raiz, { recursive: true, force: true });
        fs.mkdirSync(PROJETO, { recursive: true });
        fs.writeFileSync(SPF, '{ quebrado');
        await expect(chamar('prism:build-digitaljs', DA_JANELA, {}, 'top')).resolves.toMatchObject({ ok: false });
        fs.writeFileSync(SPF, JSON.stringify({ structure: { topLevelFile: 'top.v' } }));
        expect((await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top')).message).toBe('No Verilog files found for the simulation');

        fs.rmSync(SPF);
        expect((await chamar('prism:build-digitaljs', DA_JANELA, {}, 'top')).message).toBe('.spf not found');
        expect(falsos.filhos).toHaveLength(0);
    });

    it('sem caminhos: o proprio aviso de erro quebra, e o canal rejeita', async () => {
        await expect(chamar('prism:build-digitaljs', DA_JANELA, null, 'top')).rejects.toThrow(TypeError);
    });
});

describe('prism:export-wave', () => {
    it('grava o .vcd na Temp do projeto e pede a janela que abriu o PRISM para abrir a onda', async () => {
        state.prismDono = 1;
        falsos.minimizada = true;
        const r = await chamar('prism:export-wave', DA_PAGINA, {
            modulo: '$paramod\\ula\\W=8',
            presente: 10,
            sinais: [
                { nome: 'a', caminho: ['top', 1], bits: '4', base: 'hex', papel: 'entrada', mudancas: [[0, '0'], [5, '1']] },
                { nome: 'b' },
                { semNome: true },
                null,
            ],
        });
        const vcdPath = path.join(TEMP_PRISM, 'ula.sim.vcd');
        expect(r).toEqual({ ok: true, vcdPath });
        expect(fs.readFileSync(vcdPath, 'utf8')).toContain('$var');
        expect(janelas.mandar).toHaveBeenCalledWith({ origem: { id: 1 }, reserva: false }, 'aurora:open-wave', {
            vcdPath,
            modulo: 'ula',
            sinais: [
                { nome: 'a', caminho: ['top', '1'], bits: 4, base: 'hex', papel: 'entrada' },
                { nome: 'b', caminho: [], bits: 1, base: null, papel: null },
            ],
        });
        expect(principal.restore).toHaveBeenCalled();
        expect(principal.focus).toHaveBeenCalled();
    });

    it('sem modulo nem sinais, o nome e simulacao; sem janela dona, grava e avisa', async () => {
        const r = await chamar('prism:export-wave', DA_JANELA, null);
        expect(r).toEqual({ ok: false, vcdPath: path.join(TEMP_PRISM, 'simulacao.sim.vcd'), error: 'main window not available' });
    });

    it('sem projeto: falha', async () => {
        expect(await chamar('prism:export-wave', DA_PAGINA, {}))
            .toEqual({ ok: false, error: 'No project path available' });
    });
});

describe('prism:open-source-file', () => {
    it('abre o arquivo na janela que abriu o PRISM, com linha e coluna validas', async () => {
        state.prismDono = 1;
        const r = await chamar('prism:open-source-file', DA_PAGINA, { filePath: SPF, line: 3, column: 0 });
        expect(r).toEqual({ success: true });
        expect(janelas.mandar).toHaveBeenCalledWith({ origem: { id: 1 }, reserva: false }, 'aurora:open-file-at',
            { filePath: SPF, line: 3, column: 1 });
        expect(principal.restore).not.toHaveBeenCalled();
        expect(principal.focus).toHaveBeenCalled();
    });

    it('as recusas', async () => {
        expect(await chamar('prism:open-source-file', DA_PAGINA, null)).toEqual({ success: false, message: 'invalid payload' });
        expect(await chamar('prism:open-source-file', DA_PAGINA, { filePath: 'C:/nao/existe.v' }))
            .toEqual({ success: false, message: 'source not found: C:/nao/existe.v' });
        expect(await chamar('prism:open-source-file', DA_PAGINA, { filePath: SPF }))
            .toEqual({ success: false, message: 'main window not available' });
    });
});

describe('prism:log e prism-tab:page', () => {
    it('o log da pagina vai ao terminal PRISM de quem abriu, com tipo conhecido', async () => {
        state.prismDono = 1;
        expect(await chamar('prism:log', DA_PAGINA, 'x'.repeat(3000), 'ruim')).toEqual({ ok: true });
        expect(janelas.mandar).toHaveBeenCalledWith({ origem: { id: 1 }, reserva: false }, 'terminal-log', 'tprism',
            `PRISM: ${'x'.repeat(2000)}`, 'info');
        await chamar('prism:log', DA_PAGINA, 'y', 'warning');
        expect(janelas.mandar.mock.calls.at(-1)[4]).toBe('warning');

        falsos.mandarOk = false;
        expect(await chamar('prism:log', DA_PAGINA, 'z', 'info')).toEqual({ ok: false, error: 'main window not available' });
    });

    it('a pagina e o preload do <webview> da aba', async () => {
        const preload = new URL(`file:///${path.resolve('js', 'app', 'preload_prism.js').replace(/\\/g, '/')}`).href;
        expect(await chamar('prism-tab:page', {})).toEqual({
            ok: true, url: 'file:///dist/html/prism/prism.html?embedded=1', preload,
        });
        falsos.pagina = { ok: false, error: 'sem bundle' };
        expect(await chamar('prism-tab:page', {})).toEqual({ ok: false, error: 'sem bundle' });
    });
});

describe('prism:command', () => {
    it('sem objeto de comando, recusa', async () => {
        expect(await chamar('prism:command', DA_JANELA, 'x')).toEqual({ ok: false, error: 'prism:command requires a command object' });
    });

    it('a janela propria do PRISM recebe o comando quando a janela nao tem aba', async () => {
        const aberta = new JanelaFalsa({});
        aberta.webContents.removeListener = aberta.webContents.removeListener.bind(aberta.webContents);
        state.prismWindow = aberta;
        const promessa = chamar('prism:command', DA_JANELA, { tipo: 'simular' });
        const [{ canal, args: [id, cmd] }] = aberta.webContents.recebidos;
        expect([canal, cmd]).toEqual(['prism:command', { tipo: 'simular' }]);
        handlers.get('prism:command-result')({ sender: { id: aberta.webContents.id } }, id, { ok: true });
        await expect(promessa).resolves.toEqual({ ok: true });
    });

    it('a pagina que morre no meio encerra o comando na hora', async () => {
        const pagina = contentsFalso(7);
        state.prismTabContents.set(1, pagina);
        const promessa = chamar('prism:command', DA_JANELA, { tipo: 'x' });
        pagina.emit('destroyed');
        await expect(promessa).resolves.toEqual({ ok: false, error: 'the PRISM page was closed while the command was running' });
    });

    it('envio que falha encerra com o erro', async () => {
        const pagina = contentsFalso(7);
        pagina.send = () => { throw new Error('canal fechado'); };
        state.prismTabContents.set(2, pagina);
        // Sem aba da janela 1, a unica aba que houver.
        await expect(chamar('prism:command', DA_JANELA, { tipo: 'x' })).resolves.toEqual({ ok: false, error: 'canal fechado' });
    });

    it('pagina que nao responde: encerra no prazo', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const pagina = contentsFalso(7);
            state.prismTabContents.set(1, pagina);
            const promessa = chamar('prism:command', DA_JANELA, { tipo: 'x' });
            vi.advanceTimersByTime(120000);
            await expect(promessa).resolves.toEqual({ ok: false, error: 'the PRISM page did not answer in time' });
        } finally {
            vi.useRealTimers();
        }
    });
});
