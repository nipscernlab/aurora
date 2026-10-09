// @vitest-environment happy-dom
//
// js/project/project_tree_actions.js: a camada de interacao da arvore de
// processadores (arrastar arquivos, criar, apagar, tirar da arvore, os menus
// de botao direito e o apagar processador).
//
// Caracterizacao escrita antes de o modulo virar .ts, rodada contra o .js
// antigo. O mixin entra num objeto com o estado que o ProjectTreeManager
// daria; a ponte (electronAPI), as abas, o projeto aberto e o .spf sao falsos,
// e o .spf e um objeto vivo que os mutators alteram no lugar.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => {
    const api = {};
    globalThis.window.electronAPI = api;
    return api;
});

const disco = vi.hoisted(() => ({ spf: null, escritas: 0, spfPath: 'C:/p/p.spf', projeto: 'C:/p' }));
vi.mock('../../js/project/spf_store.js', () => ({
    SpfStore: {
        update: async (_p, mutator) => { disco.escritas += 1; mutator(disco.spf); return disco.spf; },
    },
}));
vi.mock('../../js/project/project_store.js', () => ({
    ProjectStore: { getSpfPath: () => disco.spfPath, getProjectPath: () => disco.projeto },
}));
const abas = vi.hoisted(() => ({ TabManager: null }));
vi.mock('../../js/tabs/tab_manager.js', () => abas);
const cards = vi.hoisted(() => ({ showCardNotification: null }));
vi.mock('../../js/ui/notification.js', () => cards);

import { ActionsMixin } from '../../js/project/project_tree_actions.js';

const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();

function contexto(extra = {}) {
    const fileTree = document.createElement('div');
    document.body.appendChild(fileTree);
    const ctx = Object.assign(Object.create(ActionsMixin), {
        isTreeActive: true,
        elements: { fileTree },
        verilogFiles: [],
        missingFiles: [],
        ALLOWED_EXTENSIONS: ['.v', '.sv', '.py'],
        getFileExtension: (n) => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i).toLowerCase(); },
        _normalizePath: norm,
        showNotification: vi.fn(),
        refreshTree: vi.fn(async () => {}),
        renderTree: vi.fn(),
        ...extra,
    });
    return ctx;
}

/** Chaves das notificacoes, na ordem. */
const avisos = (ctx) => ctx.showNotification.mock.calls.map((c) => [c[0], c[1]]);

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    for (const k of Object.keys(api)) delete api[k];
    disco.spf = { synthesizableFiles: [], testbenchFiles: [], topLevelFile: '', testbenchFile: '' };
    disco.escritas = 0;
    disco.spfPath = 'C:/p/p.spf';
    disco.projeto = 'C:/p';
    abas.TabManager = {
        addTab: vi.fn(),
        closeTab: vi.fn(),
        tabs: new Map(),
        createNewFileFromDialog: vi.fn(async () => {}),
    };
    cards.showCardNotification = vi.fn();
    delete window.t;
    delete window.AuroraUI;
    delete window.AuroraAPI;
    delete window.projectTreeManager;
    delete window.fileTreeViewController;
    delete window.standardTreeCrud;
    window.confirm = vi.fn(() => true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    // Os menus ligam um fechar-no-clique-fora `once` no document, que nao e
    // trocado entre os casos: um clique aqui os consome antes do proximo.
    document.body.click();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ---- arrastar ----

describe('arrastar', () => {
    it('preventDefaults cancela o evento', () => {
        const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        contexto().preventDefaults(e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
    });

    it('entrar marca a arvore; sair so desmarca fora do retangulo; arvore inativa ignora', () => {
        const ctx = contexto();
        const lista = ctx.elements.fileTree.classList;
        ctx.elements.fileTree.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100 });
        ctx.handleDragEnter();
        expect(lista.contains('verilog-dragover')).toBe(true);
        ctx.handleDragLeave({ clientX: 50, clientY: 50 });
        expect(lista.contains('verilog-dragover')).toBe(true);
        for (const [x, y] of [[-1, 50], [100, 50], [50, -1], [50, 100]]) {
            lista.add('verilog-dragover');
            ctx.handleDragLeave({ clientX: x, clientY: y });
            expect(lista.contains('verilog-dragover')).toBe(false);
        }
        ctx.isTreeActive = false;
        ctx.handleDragEnter();
        ctx.handleDragLeave({ clientX: -1, clientY: 0 });
        expect(lista.contains('verilog-dragover')).toBe(false);
    });

    it('soltar valida caminho, extensao e existencia, e importa o que sobrou', async () => {
        const ctx = contexto();
        ctx.importFiles = vi.fn(async () => {});
        api.getPathForFile = (f) => f.caminho;
        api.fileExists = vi.fn(async (p) => {
            if (p.includes('erro')) throw new Error('x');
            return !p.includes('sumiu');
        });
        window.t = (k, p) => `${k}${p ? JSON.stringify(p) : ''}`;
        const files = [
            { name: 'sem.v', caminho: '' },
            { name: 'w.gtkw', caminho: 'C:/a/w.gtkw' },
            { name: 'x.txt', caminho: 'C:/a/x.txt' },
            { name: 'sumiu.v', caminho: 'C:/a/sumiu.v' },
            { name: 'erro.v', caminho: 'C:/a/erro.v' },
            { name: 'bom.v', caminho: 'C:/a/bom.v' },
        ];
        await ctx.handleDrop({ dataTransfer: { files } });

        expect(ctx.importFiles).toHaveBeenCalledWith([
            { name: 'bom.v', path: expect.stringMatching(/bom\.v$/), isTopLevel: false },
        ]);
        expect(avisos(ctx).map(([k]) => k.split('{')[0])).toEqual([
            'notification.tree.cannotGetPath',
            'notification.tree.rejectedExt',
            'notification.tree.rejectedExt',
            'notification.tree.fileNotExist',
            'notification.tree.errorValidating',
        ]);
        expect(avisos(ctx)[1][0]).toContain('notification.tree.gtkwHint');
    });

    it('soltar nada avisa; nada valido nao importa; arvore inativa nao faz nada', async () => {
        const ctx = contexto();
        ctx.importFiles = vi.fn();
        await ctx.handleDrop({ dataTransfer: { files: [] } });
        await ctx.handleDrop({ dataTransfer: { files: null } });
        expect(avisos(ctx)).toEqual([
            ['notification.tree.noFilesDropped', 'warning'],
            ['notification.tree.noFilesDropped', 'warning'],
        ]);
        api.getPathForFile = () => null;
        await ctx.handleDrop({ dataTransfer: { files: [{ name: 'a.v' }] } });
        expect(ctx.importFiles).not.toHaveBeenCalled();

        ctx.isTreeActive = false;
        ctx.elements.fileTree.classList.add('verilog-dragover');
        await ctx.handleDrop({ dataTransfer: { files: [] } });
        expect(ctx.elements.fileTree.classList.contains('verilog-dragover')).toBe(false);
        expect(ctx.showNotification).toHaveBeenCalledTimes(3);
    });
});

// ---- importar ----

describe('importFiles', () => {
    it('classifica pelo conteudo e grava em cada lista sem duplicar', async () => {
        const ctx = contexto({ verilogFiles: [{ path: 'C:/p/ja.v' }] });
        disco.spf = { synthesizableFiles: [{ path: 'C:/P/DUP.v' }], testbenchFiles: [{ name: 'velho_tb.v', path: 'C:/p/velho_tb.v' }] };
        api.readFile = vi.fn(async (p) => {
            if (p.includes('ilegivel')) throw new Error('x');
            return p.includes('tb') ? 'module tb; initial begin $dumpvars; $finish; end endmodule' : 'module m(input a); endmodule';
        });

        await ctx.importFiles([
            { name: 'sem.v', path: '' },
            { name: 'x.txt', path: 'C:/p/x.txt' },
            { name: 'ja.v', path: 'C:/p/ja.v' },
            { name: 'm.v', path: 'C:/p/m.v' },
            { name: 'meu_tb.v', path: 'C:/p/meu_tb.v' },
            { name: 'teste.py', path: 'C:/p/teste.py' },
            { name: 'ilegivel.v', path: 'C:/p/ilegivel.v' },
            { name: 'dup.v', path: 'C:/p/dup.v' },
        ]);

        expect(disco.spf.synthesizableFiles.map((f) => f.name ?? f.path)).toEqual(['C:/P/DUP.v', 'm.v', 'ilegivel.v']);
        expect(disco.spf.testbenchFiles.map((f) => f.name)).toEqual(['velho_tb.v', 'meu_tb.v', 'teste.py']);
        expect(avisos(ctx)).toEqual([
            ['notification.tree.noPath', 'warning'],
            ['notification.tree.unsupportedExt', 'warning'],
            ['notification.tree.alreadyExists', 'warning'],
            ['notification.tree.added', 'success'],
        ]);
        expect(ctx.refreshTree).toHaveBeenCalled();
    });

    it('lista do .spf ausente vira lista', async () => {
        disco.spf = {};
        api.readFile = async () => 'module m(input a); endmodule';
        await contexto().importFiles([{ name: 'm.v', path: 'C:/p/m.v' }]);
        expect(disco.spf).toEqual({
            synthesizableFiles: [{ name: 'm.v', path: 'C:/p/m.v', isTopLevel: false }],
            testbenchFiles: [],
        });
    });

    it('sem projeto, ou sem nada valido: so avisa', async () => {
        const ctx = contexto();
        disco.spfPath = null;
        await ctx.importFiles([{ name: 'm.v', path: 'C:/p/m.v' }]);
        disco.spfPath = 'C:/p/p.spf';
        await ctx.importFiles([]);
        await ctx.importFiles([{ name: 'x.txt', path: 'C:/x.txt' }]);
        expect(avisos(ctx)).toEqual([
            ['notification.tree.noValidFiles', 'warning'],
            ['notification.tree.noValidFiles', 'warning'],
            ['notification.tree.unsupportedExt', 'warning'],
        ]);
        expect(disco.escritas).toBe(0);
    });
});

// ---- .gitignore ----

describe('createGitignore', () => {
    it('cria com o padrao, abre e pede refresh', async () => {
        const ctx = contexto();
        api.joinPath = async (a, b) => `${a}/${b}`;
        api.fileExists = async () => false;
        api.writeFile = vi.fn(async () => {});
        api.readFile = async () => 'conteudo';
        api.triggerFileTreeRefresh = vi.fn(async () => {});
        window.projectTreeManager = { refreshTree: vi.fn() };

        await ctx.createGitignore();

        expect(api.writeFile).toHaveBeenCalledWith('C:/p/.gitignore', expect.stringContaining('.aurora/Temp/'));
        expect(abas.TabManager.addTab).toHaveBeenCalledWith('C:/p/.gitignore', 'conteudo');
        expect(window.projectTreeManager.refreshTree).toHaveBeenCalled();
        expect(api.triggerFileTreeRefresh).toHaveBeenCalled();
        expect(avisos(ctx)).toEqual([['notification.tree.created', 'success']]);
    });

    it('ja existe: so abre; falhas secundarias sao engolidas', async () => {
        const ctx = contexto();
        api.joinPath = async (a, b) => `${a}/${b}`;
        api.fileExists = async () => { throw new Error('x'); };
        api.writeFile = vi.fn(async () => {});
        api.readFile = async () => { throw new Error('x'); };
        window.projectTreeManager = { refreshTree: () => { throw new Error('x'); } };
        api.triggerFileTreeRefresh = async () => { throw new Error('x'); };
        await ctx.createGitignore();
        // fileExists que lanca conta como "nao existe".
        expect(api.writeFile).toHaveBeenCalled();

        api.fileExists = async () => true;
        api.writeFile.mockClear();
        delete api.triggerFileTreeRefresh;
        await ctx.createGitignore();
        expect(api.writeFile).not.toHaveBeenCalled();
    });

    it('sem projeto, ou erro ao montar o caminho: avisa erro', async () => {
        const ctx = contexto();
        disco.projeto = null;
        await ctx.createGitignore();
        disco.projeto = 'C:/p';
        api.joinPath = async () => { throw new Error('x'); };
        await ctx.createGitignore();
        expect(avisos(ctx)).toEqual([
            ['notification.tree.errorCreating', 'error'],
            ['notification.tree.errorCreating', 'error'],
        ]);
    });
});

// ---- criar .v e .py ----

describe.each([
    ['createNewFile', '.v', 'untitled', 'synthesizableFiles', 'a b', 'a_b'],
    ['createNewCocotbFile', '.py', 'test_dut', 'testbenchFiles', '1x', 'test_1x'],
])('%s', (metodo, ext, sugestao, lista, invalido, saneado) => {
    it('pede o nome, corrige o invalido, grava, poe no .spf e abre', async () => {
        const ctx = contexto();
        api.joinPath = async (a, b) => `${a}/${b}`;
        const respostas = [{ filePath: `C:/p/${invalido}` }, { filePath: `C:/p/bom${ext}` }];
        api.showSaveDialog = vi.fn(async () => respostas.shift());
        api.writeFile = vi.fn(async () => {});
        api.readFile = async () => 'texto';
        if (ext === '.py') disco.spf.synthesizableFiles = [{ path: `C:/p/bom${ext}` }];

        await ctx[metodo]();

        expect(api.showSaveDialog.mock.calls[0][0].defaultPath).toBe(`C:/p/${sugestao}${ext}`);
        expect(api.showSaveDialog.mock.calls[1][0].defaultPath).toBe(`C:/p/${saneado}${ext}`);
        expect(api.writeFile).toHaveBeenCalledWith(`C:/p/bom${ext}`, expect.any(String));
        expect(disco.spf[lista]).toEqual([{ name: `bom${ext}`, path: `C:/p/bom${ext}`, isTopLevel: false }]);
        if (ext === '.py') expect(disco.spf.synthesizableFiles).toEqual([]);
        expect(abas.TabManager.addTab).toHaveBeenCalledWith(`C:/p/bom${ext}`, 'texto');
        expect(avisos(ctx)).toEqual([
            ['notification.tree.invalidName', 'warning'],
            ['notification.tree.created', 'success'],
        ]);
    });

    it('nome que ja tem a extensao, arquivo ja listado, e abrir que falha', async () => {
        const ctx = contexto();
        disco.projeto = null;
        disco.spf = {};
        api.showSaveDialog = vi.fn(async () => ({ filePath: `C:/p/ok${ext}` }));
        api.writeFile = async () => {};
        api.readFile = async () => { throw new Error('x'); };
        await ctx[metodo]();
        expect(api.showSaveDialog.mock.calls[0][0].defaultPath).toBe(`${sugestao}${ext}`);
        expect(disco.spf[lista]).toHaveLength(1);
        await ctx[metodo]();
        expect(disco.spf[lista]).toHaveLength(1);
        expect(console.error).toHaveBeenCalled();
    });

    it('cancelar, sem projeto e erro ao gravar', async () => {
        const ctx = contexto();
        api.joinPath = async (a, b) => `${a}/${b}`;
        api.showSaveDialog = async () => ({ canceled: true });
        await ctx[metodo]();
        api.showSaveDialog = async () => ({ canceled: false, filePath: '' });
        await ctx[metodo]();
        expect(ctx.showNotification).not.toHaveBeenCalled();

        disco.spfPath = null;
        await ctx[metodo]();
        disco.spfPath = 'C:/p/p.spf';
        api.showSaveDialog = async () => ({ filePath: 'C:/p/ok' });
        api.writeFile = async () => { throw new Error('disco'); };
        await ctx[metodo]();
        expect(avisos(ctx)).toEqual([
            ['notification.tree.errorCreating', 'error'],
            ['notification.tree.errorCreating', 'error'],
        ]);
    });
});

// ---- apagar e tirar ----

describe('deleteFile', () => {
    const ARQ = 'C:/p/a.v';
    const comArquivo = () => {
        disco.spf = {
            synthesizableFiles: [{ path: ARQ }], testbenchFiles: [{ path: 'C:/p/b.v' }],
            topLevelFile: ARQ, testbenchFile: ARQ,
        };
        return contexto({ verilogFiles: [{ path: ARQ, name: 'a.v' }] });
    };

    it('confirma pelo dialogo, apaga, tira do .spf e fecha a aba', async () => {
        const ctx = comArquivo();
        window.AuroraUI = { dialog: vi.fn(async () => 'delete') };
        abas.TabManager.tabs.set(ARQ, {});
        api.deleteFile = vi.fn(async () => {});

        await ctx.deleteFile(0);

        expect(window.AuroraUI.dialog.mock.calls[0][0].title).toBe('dialog.deleteFile.title');
        expect(api.deleteFile).toHaveBeenCalledWith(ARQ);
        expect(disco.spf).toEqual({ synthesizableFiles: [], testbenchFiles: [{ path: 'C:/p/b.v' }], topLevelFile: '', testbenchFile: '' });
        expect(abas.TabManager.closeTab).toHaveBeenCalledWith(ARQ);
        expect(avisos(ctx)).toEqual([['notification.tree.deleted', 'success']]);
    });

    it('sem dialogo, cai no confirm; sem aba aberta nao fecha nada', async () => {
        const ctx = comArquivo();
        api.deleteFile = async () => {};
        abas.TabManager.tabs = null;
        await ctx.deleteFile(0);
        expect(window.confirm).toHaveBeenCalledWith('dialog.deleteFile.fallbackPrompt');
        expect(abas.TabManager.closeTab).not.toHaveBeenCalled();
    });

    it('arquivo que ja sumiu limpa o .spf; outro erro so avisa', async () => {
        const ctx = comArquivo();
        api.deleteFile = async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); };
        await ctx.deleteFile(0);
        expect(disco.spf.synthesizableFiles).toEqual([]);
        api.deleteFile = async () => { throw new Error('preso'); };
        await ctx.deleteFile(0);
        expect(avisos(ctx)).toEqual([
            ['notification.tree.alreadyDeleted', 'info'],
            ['notification.tree.errorDeleting', 'error'],
        ]);
    });

    it('nao confirma, indice vazio ou sem projeto: nada', async () => {
        const ctx = comArquivo();
        api.deleteFile = vi.fn();
        window.AuroraUI = { dialog: async () => 'cancel' };
        await ctx.deleteFile(0);
        await ctx.deleteFile(5);
        disco.spfPath = null;
        await ctx.deleteFile(0);
        expect(api.deleteFile).not.toHaveBeenCalled();
    });
});

describe('removeFile', () => {
    it('anima a linha, espera e tira do .spf', async () => {
        disco.spf = { synthesizableFiles: [{ path: 'C:/p/a.v' }] };
        const ctx = contexto({ verilogFiles: [{ path: 'C:/p/a.v', name: 'a.v' }] });
        const linha = document.createElement('div');
        linha.className = 'verilog-file-item';
        linha.dataset.fileIndex = '0';
        document.body.appendChild(linha);

        const p = ctx.removeFile(0);
        expect(linha.classList.contains('verilog-file-animate-out')).toBe(true);
        await vi.advanceTimersByTimeAsync(300);
        await p;
        expect(disco.spf.synthesizableFiles).toEqual([]);
        expect(avisos(ctx)).toEqual([['notification.tree.removed', 'success']]);
    });

    it('falha na escrita devolve a linha e avisa; sem linha, sem projeto ou indice vazio', async () => {
        const ctx = contexto({ verilogFiles: [{ path: 'C:/p/a.v', name: 'a.v' }] });
        ctx._dropFileFromSpf = async () => { throw new Error('travado'); };
        await ctx.removeFile(0);
        ctx._dropFileFromSpf = async () => { throw 'texto'; };
        await ctx.removeFile(0);
        expect(avisos(ctx)).toEqual([
            ['notification.tree.removeFailed', 'error'],
            ['notification.tree.removeFailed', 'error'],
        ]);
        await ctx.removeFile(3);
        disco.spfPath = null;
        await ctx.removeFile(0);
        expect(ctx.showNotification).toHaveBeenCalledTimes(2);

        disco.spfPath = 'C:/p/p.spf';
        const linha = document.createElement('div');
        linha.className = 'verilog-file-item verilog-file-animate-out';
        linha.dataset.fileIndex = '0';
        document.body.appendChild(linha);
        ctx._dropFileFromSpf = async () => { throw new Error('x'); };
        const p = ctx.removeFile(0);
        await vi.advanceTimersByTimeAsync(300);
        await p;
        expect(linha.classList.contains('verilog-file-animate-out')).toBe(false);
    });
});

describe('_removeFileByPath', () => {
    it('tira, oferece desfazer, e o desfazer vale uma vez', async () => {
        const ARQ = 'C:/p/a.v';
        disco.spf = { synthesizableFiles: [{ path: ARQ, name: 'a.v', isTopLevel: true }], testbenchFiles: [], topLevelFile: ARQ };
        const ctx = contexto({ verilogFiles: [{ path: ARQ, name: 'a.v' }] });

        await ctx._removeFileByPath(ARQ);
        expect(disco.spf.synthesizableFiles).toEqual([]);
        const [, , ms, , opcoes] = cards.showCardNotification.mock.calls[0];
        expect(ms).toBe(6000);
        await opcoes.action.run();
        expect(disco.spf.synthesizableFiles).toEqual([{ path: ARQ, name: 'a.v', isTopLevel: true }]);
        expect(cards.showCardNotification.mock.calls[1][0]).toBe('notification.tree.restored');
        const antes = disco.escritas;
        await opcoes.action.run();
        expect(disco.escritas).toBe(antes);
    });

    it('arquivo fora da lista ou sem projeto: nada', async () => {
        const ctx = contexto();
        await ctx._removeFileByPath('C:/p/x.v');
        disco.spfPath = null;
        await ctx._removeFileByPath('C:/p/x.v');
        expect(disco.escritas).toBe(0);
    });
});

// ---- arquivos que faltam ----

describe('arquivos que faltam no disco', () => {
    it('dismissMissingFiles poda listas e ponteiros e redesenha', async () => {
        disco.spf = {
            synthesizableFiles: [{ path: 'C:/p/sumiu.v' }, { path: 'C:/p/fica.v' }],
            topLevelFile: 'C:/p/sumiu.v', testbenchFile: 'C:/p/sumiu_tb.v',
        };
        const ctx = contexto({ missingFiles: [{ path: 'C:/p/sumiu.v' }, { path: 'C:/p/sumiu_tb.v' }] });
        expect(await ctx.dismissMissingFiles()).toBe(2);
        expect(disco.spf).toEqual({
            synthesizableFiles: [{ path: 'C:/p/fica.v' }], testbenchFiles: [],
            topLevelFile: '', testbenchFile: '',
        });
        expect(ctx.missingFiles).toEqual([]);
        expect(ctx.renderTree).toHaveBeenCalled();
    });

    it('nada faltando, sem projeto, ou ponteiros que nao sao texto', async () => {
        const ctx = contexto({ missingFiles: null });
        expect(await ctx.dismissMissingFiles()).toBe(0);
        ctx.missingFiles = [{ path: 'x' }];
        disco.spfPath = null;
        expect(await ctx.dismissMissingFiles()).toBe(0);
        disco.spfPath = 'C:/p/p.spf';
        disco.spf = { topLevelFile: 3, testbenchFile: 'C:/p/fica.v' };
        ctx.renderTree = undefined;
        expect(await ctx.dismissMissingFiles()).toBe(1);
        expect(disco.spf.topLevelFile).toBe(3);
        expect(disco.spf.testbenchFile).toBe('C:/p/fica.v');
    });

    it('confirmAndDismissMissingFiles pergunta antes, pelo dialogo ou pelo confirm', async () => {
        const ctx = contexto({ missingFiles: [{ path: 'C:/p/a.v' }] });
        window.AuroraUI = { dialog: vi.fn(async () => 'cancel') };
        await ctx.confirmAndDismissMissingFiles();
        expect(window.AuroraUI.dialog.mock.calls[0][0].title).toBe('dialog.dismissMissing.title');
        expect(disco.escritas).toBe(0);

        window.AuroraUI.dialog = async () => 'dismiss';
        await ctx.confirmAndDismissMissingFiles();
        expect(avisos(ctx)).toEqual([['notification.tree.missingDismissed', 'success']]);

        delete window.AuroraUI;
        ctx.missingFiles = [{ path: 'C:/p/b.v' }];
        window.confirm = vi.fn(() => false);
        await ctx.confirmAndDismissMissingFiles();
        expect(window.confirm).toHaveBeenCalledWith('dialog.dismissMissing.fallbackPrompt');

        ctx.missingFiles = 'nada';
        await ctx.confirmAndDismissMissingFiles();
        expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    });
});

// ---- menus ----

const clicar = async (seletor) => {
    document.querySelector(seletor).click();
    await vi.advanceTimersByTimeAsync(0);
};

describe('menu do processador', () => {
    it('abre, se reposiciona na borda, e apagar pede confirmacao e chama o main', async () => {
        const ctx = contexto();
        api.deleteProcessor = vi.fn(async () => {});
        window.AuroraUI = { dialog: vi.fn(async () => 'delete') };
        Object.defineProperty(window, 'innerWidth', { value: 50, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 50, configurable: true });
        ctx.showProcessorContextMenu({ pageX: 40, pageY: 40 }, 'cpu');
        const menu = document.getElementById('verilog-context-menu');
        menu.getBoundingClientRect = () => ({ right: 90, bottom: 90, width: 50, height: 50 });
        await vi.advanceTimersByTimeAsync(10);
        expect(menu.classList.contains('show')).toBe(true);
        expect(menu.style.left).toBe('-10px');

        menu.click();
        await clicar('[data-action="delete-processor"]');

        expect(window.AuroraUI.dialog.mock.calls[0][0].message).toContain('"cpu"');
        expect(api.deleteProcessor).toHaveBeenCalledWith('cpu');
        expect(document.getElementById('verilog-context-menu')).toBeNull();
    });

    it('sem dialogo cai no confirm; recusar nao apaga; erro do main avisa', async () => {
        const ctx = contexto();
        api.deleteProcessor = vi.fn(async () => { throw new Error('preso'); });
        window.confirm = vi.fn(() => false);
        await ctx._deleteProcessorByName('cpu');
        expect(api.deleteProcessor).not.toHaveBeenCalled();
        window.confirm = vi.fn(() => true);
        await ctx._deleteProcessorByName('cpu');
        expect(avisos(ctx)).toEqual([['Error deleting processor: preso', 'error']]);

        ctx.showProcessorContextMenu({ pageX: 1, pageY: 1 }, 'cpu');
        const menu = document.getElementById('verilog-context-menu');
        menu.querySelector('.context-menu-item').dataset.action = 'outra';
        await clicar('.context-menu-item');
        expect(api.deleteProcessor).toHaveBeenCalledTimes(1);
    });

    it('clique fora fecha o menu', async () => {
        contexto().showProcessorContextMenu({ pageX: 1, pageY: 1 }, 'cpu');
        await vi.advanceTimersByTimeAsync(100);
        document.body.click();
        expect(document.getElementById('verilog-context-menu')).toBeNull();
        await vi.advanceTimersByTimeAsync(200);
        expect(document.querySelector('.verilog-context-menu')).toBeNull();
    });
});

describe('menu da linha', () => {
    const itens = () => Array.from(document.querySelectorAll('#verilog-context-menu .context-menu-item'))
        .map((i) => i.dataset.action);

    it('.v sintetizavel, topo de sintese, testbench topo, .py e outro tipo', () => {
        const ctx = contexto();
        ctx.showContextMenu({ pageX: 0, pageY: 0 }, { name: 'a.v' }, 0);
        expect(itens()).toEqual(['mark-testbench', 'set-top-level', 'delete']);
        ctx.showContextMenu({ pageX: 0, pageY: 0 }, { name: 'a.sv', isTopLevel: true }, 0);
        expect(itens()).toEqual(['mark-testbench', 'remove-top-level', 'delete']);
        ctx.showContextMenu({ pageX: 0, pageY: 0 }, { name: 'a.v', category: 'testbench', isTopLevel: true }, 0);
        expect(itens()).toEqual(['mark-synth', 'remove-testbench', 'delete']);
        ctx.showContextMenu({ pageX: 0, pageY: 0 }, { name: 't.py' }, 0);
        expect(itens()).toEqual(['set-testbench', 'delete']);
        ctx.showContextMenu({ pageX: 0, pageY: 0 }, {}, 0);
        expect(itens()).toEqual(['delete']);
    });

    it('clique numa opcao executa e fecha; desabilitada ou fora de item nao', async () => {
        const ctx = contexto();
        ctx.handleContextMenuAction = vi.fn(async () => {});
        Object.defineProperty(window, 'innerWidth', { value: 50, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 50, configurable: true });
        ctx.showContextMenu({ pageX: 40, pageY: 40 }, { name: 'a.v' }, 3);
        const menu = document.getElementById('verilog-context-menu');
        menu.getBoundingClientRect = () => ({ right: 90, bottom: 90, width: 50, height: 50 });
        await vi.advanceTimersByTimeAsync(10);
        expect(menu.style.top).toBe('-10px');

        menu.click();
        menu.querySelector('[data-action="delete"]').classList.add('disabled');
        await clicar('#verilog-context-menu [data-action="delete"]');
        expect(ctx.handleContextMenuAction).not.toHaveBeenCalled();

        ctx.showContextMenu({ pageX: 0, pageY: 0 }, { name: 'a.v' }, 3);
        await clicar('#verilog-context-menu [data-action="set-top-level"]');
        expect(ctx.handleContextMenuAction).toHaveBeenCalledWith('set-top-level', { name: 'a.v' }, 3);
        expect(document.getElementById('verilog-context-menu')).toBeNull();
    });
});

describe('handleTreeContextMenu', () => {
    const ev = (alvo) => ({
        target: alvo, pageX: 5, pageY: 6, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });

    it('visao de pastas entrega ao CRUD dela', async () => {
        const ctx = contexto();
        window.fileTreeViewController = { getActiveView: () => 'standard' };
        window.standardTreeCrud = { showMenu: vi.fn() };
        const e = ev(document.body);
        await ctx.handleTreeContextMenu(e);
        expect(window.standardTreeCrud.showMenu).toHaveBeenCalledWith(e);
        delete window.standardTreeCrud;
        await ctx.handleTreeContextMenu(ev(document.body));
    });

    it('linha abre o menu da linha; linha desconhecida nao', async () => {
        const ctx = contexto({ verilogFiles: [{ path: 'C:/p/a.v', name: 'a.v' }] });
        ctx.showContextMenu = vi.fn();
        const linha = document.createElement('div');
        linha.className = 'verilog-file-item';
        linha.dataset.filePath = 'C:/p/a.v';
        const filho = document.createElement('span');
        linha.appendChild(filho);
        await ctx.handleTreeContextMenu(ev(filho));
        expect(ctx.showContextMenu).toHaveBeenCalledWith(expect.anything(), ctx.verilogFiles[0], 0);
        linha.dataset.filePath = 'C:/p/outro.v';
        await ctx.handleTreeContextMenu(ev(filho));
        expect(ctx.showContextMenu).toHaveBeenCalledTimes(1);
    });

    it('separador de processador abre o menu dele, menos o dos importados', async () => {
        const ctx = contexto();
        ctx.showProcessorContextMenu = vi.fn();
        const sep = document.createElement('div');
        sep.className = 'verilog-processor-separator';
        sep.dataset.processorName = 'cpu';
        await ctx.handleTreeContextMenu(ev(sep));
        sep.dataset.processorName = '__imported__';
        await ctx.handleTreeContextMenu(ev(sep));
        delete sep.dataset.processorName;
        await ctx.handleTreeContextMenu(ev(sep));
        expect(ctx.showProcessorContextMenu).toHaveBeenCalledTimes(1);
        expect(ctx.showProcessorContextMenu).toHaveBeenCalledWith(expect.anything(), 'cpu');
    });

    it('area vazia abre o menu de criar; botao e arvore inativa nao', async () => {
        const ctx = contexto();
        ctx.showCreateMenu = vi.fn();
        await ctx.handleTreeContextMenu(ev(document.body));
        expect(ctx.showCreateMenu).toHaveBeenCalledWith(5, 6);
        const botao = document.createElement('button');
        await ctx.handleTreeContextMenu(ev(botao));
        ctx.isTreeActive = false;
        await ctx.handleTreeContextMenu(ev(document.body));
        expect(ctx.showCreateMenu).toHaveBeenCalledTimes(1);
    });
});

describe('menu de criar', () => {
    it('cada opcao chama o seu criador e fecha', async () => {
        const ctx = contexto();
        ctx.createNewCocotbFile = vi.fn(async () => {});
        ctx.createGitignore = vi.fn(async () => {});
        for (const acao of ['create-file', 'create-cocotb', 'create-gitignore', 'outra']) {
            ctx.showCreateMenu(0, 0);
            const item = document.querySelector('#verilog-create-menu [data-action="create-file"]');
            item.dataset.action = acao;
            await clicar('#verilog-create-menu .create-menu-item');
            expect(document.getElementById('verilog-create-menu')).toBeNull();
        }
        expect(abas.TabManager.createNewFileFromDialog).toHaveBeenCalledTimes(1);
        expect(ctx.createNewCocotbFile).toHaveBeenCalledTimes(1);
        expect(ctx.createGitignore).toHaveBeenCalledTimes(1);
    });

    it('reposiciona na borda; clique fora fecha, dentro nao; clique fora de item ignora', async () => {
        const ctx = contexto();
        Object.defineProperty(window, 'innerWidth', { value: 50, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 50, configurable: true });
        ctx.showCreateMenu(40, 40);
        const menu = document.getElementById('verilog-create-menu');
        menu.getBoundingClientRect = () => ({ right: 90, bottom: 90, width: 50, height: 50 });
        await vi.advanceTimersByTimeAsync(100);
        expect([menu.style.left, menu.style.top]).toEqual(['-10px', '-10px']);

        menu.click();
        expect(document.getElementById('verilog-create-menu')).toBe(menu);
        document.body.click();
        expect(document.getElementById('verilog-create-menu')).toBeNull();
    });

    it('menu substituido antes dos 100 ms nao liga o fechar do antigo', async () => {
        const ctx = contexto();
        ctx.showCreateMenu(0, 0);
        ctx.showCreateMenu(0, 0);
        await vi.advanceTimersByTimeAsync(100);
        const vivo = document.getElementById('verilog-create-menu');
        expect(vivo).not.toBeNull();
        ctx.closeAllTreeMenus();
        expect(document.getElementById('verilog-create-menu')).toBeNull();
    });
});

// ---- acoes do menu da linha ----

describe('handleContextMenuAction', () => {
    const A = 'C:/p/a.v';
    const B = 'C:/p/b.v';

    it('remove e delete delegam', async () => {
        const ctx = contexto();
        ctx._removeFileByPath = vi.fn();
        ctx.deleteFile = vi.fn();
        await ctx.handleContextMenuAction('remove', { path: A }, 0);
        await ctx.handleContextMenuAction('delete', { path: A }, 2);
        expect(ctx._removeFileByPath).toHaveBeenCalledWith(A);
        expect(ctx.deleteFile).toHaveBeenCalledWith(2);
    });

    it('marcar topo e testbench vai pela AuroraAPI; desmarcar mexe no .spf', async () => {
        const ctx = contexto();
        window.AuroraAPI = { project: { setTopLevel: vi.fn(), setTestbenchTop: vi.fn() } };
        disco.spf = {
            synthesizableFiles: [{ path: A, isTopLevel: true }, { path: B, isTopLevel: false }],
            testbenchFiles: [{ path: B, isTopLevel: true }],
            topLevelFile: A, testbenchFile: B,
        };
        await ctx.handleContextMenuAction('set-top-level', { path: A, name: 'a.v' }, 0);
        await ctx.handleContextMenuAction('set-testbench', { path: B, name: 'b.v' }, 0);
        expect(window.AuroraAPI.project.setTopLevel).toHaveBeenCalledWith(A);
        expect(window.AuroraAPI.project.setTestbenchTop).toHaveBeenCalledWith(B);

        await ctx.handleContextMenuAction('remove-top-level', { path: A, name: 'a.v' }, 0);
        await ctx.handleContextMenuAction('remove-testbench', { path: B, name: 'b.v' }, 0);
        expect(disco.spf).toEqual({
            synthesizableFiles: [{ path: A, isTopLevel: false }, { path: B, isTopLevel: false }],
            testbenchFiles: [{ path: B, isTopLevel: false }],
            topLevelFile: '', testbenchFile: '',
        });
        expect(avisos(ctx).map(([k]) => k)).toEqual([
            'notification.tree.setAsTop', 'notification.tree.markedTb',
            'notification.tree.topRemoved', 'notification.tree.tbUnmarked',
        ]);
    });

    it('marcar como sintese ou testbench muda o arquivo de lista no .spf (TODO 13b)', async () => {
        const ctx = contexto();
        disco.spf = {
            synthesizableFiles: [{ name: 'a.v', path: A, isTopLevel: true }],
            unclassifiedFiles: [{ name: 'b.v', path: B }],
            topLevelFile: A,
        };
        await ctx.handleContextMenuAction('mark-testbench', { path: A, name: 'a.v' }, 0);
        await ctx.handleContextMenuAction('mark-synth', { path: B, name: 'b.v' }, 0);
        expect(disco.spf).toEqual({
            synthesizableFiles: [{ name: 'b.v', path: B, isTopLevel: false }],
            testbenchFiles: [{ name: 'a.v', path: A, isTopLevel: false }],
            unclassifiedFiles: [],
            topLevelFile: '',
        });
        expect(avisos(ctx).map(([k]) => k)).toEqual(['notification.tree.roleTestbench', 'notification.tree.roleSynth']);
        // Ja no papel pedido: nao grava nem avisa.
        const escritas = disco.escritas;
        await ctx.handleContextMenuAction('mark-synth', { path: B, name: 'b.v' }, 0);
        expect(avisos(ctx)).toHaveLength(2);
        expect(disco.escritas).toBe(escritas + 1);
    });

    it('acao desconhecida, sem projeto, e sem AuroraAPI', async () => {
        const ctx = contexto();
        await ctx.handleContextMenuAction('outra', { path: A }, 0);
        await ctx.handleContextMenuAction('set-top-level', { path: A, name: 'a.v' }, 0);
        disco.spfPath = null;
        await ctx.handleContextMenuAction('remove-top-level', { path: A }, 0);
        expect(avisos(ctx)).toEqual([['notification.tree.setAsTop', 'success']]);
        expect(disco.escritas).toBe(0);
    });
});

describe('_mutateTopFlag', () => {
    it('setar e exclusivo na categoria; alvo fora da lista nao mexe em nada', async () => {
        const A = 'C:/p/a.v';
        const B = 'C:/p/b.v';
        disco.spf = { synthesizableFiles: [{ path: A, isTopLevel: false }, { path: B, isTopLevel: true }], topLevelFile: B };
        const ctx = contexto();
        await ctx._mutateTopFlag('C:/p/p.spf', norm(A), 'synth', true);
        expect(disco.spf).toEqual({
            synthesizableFiles: [{ path: A, isTopLevel: true }, { path: B, isTopLevel: false }],
            topLevelFile: A,
        });
        await ctx._mutateTopFlag('C:/p/p.spf', norm('C:/p/x.v'), 'synth', true);
        expect(disco.spf.topLevelFile).toBe(A);
        await ctx._mutateTopFlag('C:/p/p.spf', norm(A), 'tb', true);
        expect(disco.spf.testbenchFiles).toBeUndefined();
    });
});
