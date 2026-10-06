// @vitest-environment happy-dom
//
// js/tabs/tab_watchers.js: o vigia dos arquivos abertos em aba. Mudanca no
// disco feita por fora sincroniza o editor quando nao ha edicao local, e pede
// uma decisao quando ha.
//
// Caracterizacao escrita antes de o modulo virar .ts, contra o .js antigo. O
// mixin roda sobre um objeto com o estado que o TabManager daria; a ponte, o
// editor e o dialogo sao falsos.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => {
    const api = {};
    globalThis.window.electronAPI = api;
    return api;
});
const editores = vi.hoisted(() => ({ porArquivo: new Map() }));
vi.mock('../../js/editor/monaco_editor.js', () => ({
    EditorManager: { getEditorForFile: (p) => editores.porArquivo.get(p) ?? null },
}));
const dialogo = vi.hoisted(() => ({ resposta: 'cancel', chamadas: [] }));
vi.mock('../../js/ui/dialog_manager.js', () => ({
    showDialog: async (opcoes) => { dialogo.chamadas.push(opcoes); return dialogo.resposta; },
}));

import { tabWatchers } from '../../js/tabs/tab_watchers.js';

const A = 'C:/p/a.v';

function abas(extra = {}) {
    return Object.assign(Object.create(tabWatchers), {
        tabs: new Map(),
        fileWatchers: new Map(),
        lastModifiedTimes: new Map(),
        externalChangeQueue: new Set(),
        unsavedChanges: new Set(),
        periodicCheckInterval: null,
        isCheckingFiles: false,
        markFileAsSaved: vi.fn(),
        saveFile: vi.fn(async () => {}),
        ...extra,
    });
}

/** Um editor de mentira com o modelo que o vigia usa. */
function editor(texto, { linha = 2, coluna = 9 } = {}) {
    const e = {
        texto,
        posicao: { lineNumber: linha, column: coluna },
        rolagem: 40,
        edicoes: [],
        getValue: () => e.texto,
        getPosition: () => e.posicao,
        getScrollTop: () => e.rolagem,
        setPosition: vi.fn((p) => { e.posicao = p; }),
        setScrollTop: vi.fn((v) => { e.rolagem = v; }),
        getModel: () => ({
            getFullModelRange: () => 'tudo',
            pushEditOperations: (_s, ops, cursores) => { e.edicoes.push(ops); e.texto = ops[0].text; cursores(); },
            getLineCount: () => e.texto.split('\n').length,
            getLineMaxColumn: (n) => e.texto.split('\n')[n - 1].length + 1,
        }),
    };
    return e;
}

beforeEach(() => {
    for (const k of Object.keys(api)) delete api[k];
    editores.porArquivo.clear();
    dialogo.resposta = 'cancel';
    dialogo.chamadas = [];
    delete window.t;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('ronda periodica', () => {
    it('roda so com a janela em foco, a cada 4 s; foco e volta da aba fazem uma ronda na hora', async () => {
        vi.useFakeTimers();
        const t = abas();
        t.tabs.set(A, 'x');
        t.checkAllOpenFilesForChanges = vi.fn(async () => {});
        const foco = vi.spyOn(document, 'hasFocus').mockReturnValue(false);

        t.startPeriodicFileCheck();
        await vi.advanceTimersByTimeAsync(4000);
        expect(t.checkAllOpenFilesForChanges).not.toHaveBeenCalled();

        foco.mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(4000);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(2);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(3);

        // Religar troca o intervalo e nao liga os ouvintes de novo.
        t.startPeriodicFileCheck();
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(4);

        t.stopPeriodicFileCheck();
        expect(t.periodicCheckInterval).toBeNull();
        t.stopPeriodicFileCheck();
        await vi.advanceTimersByTimeAsync(8000);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(4);
    });

    it('nao sobrepoe rondas, pula sem abas, e erro da ronda nao trava a proxima', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const t = abas();
        t.checkAllOpenFilesForChanges = vi.fn(async () => { throw new Error('disco'); });
        t.startPeriodicFileCheck();
        await vi.advanceTimersByTimeAsync(4000);
        expect(t.checkAllOpenFilesForChanges).not.toHaveBeenCalled();

        t.tabs.set(A, 'x');
        await vi.advanceTimersByTimeAsync(4000);
        expect(console.error).toHaveBeenCalledWith('Error in periodic file check:', expect.any(Error));
        expect(t.isCheckingFiles).toBe(false);

        t.isCheckingFiles = true;
        await vi.advanceTimersByTimeAsync(4000);
        expect(t.checkAllOpenFilesForChanges).toHaveBeenCalledTimes(1);
        t.stopPeriodicFileCheck();
    });

    it('a aba escondida nao faz ronda', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const escondida = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        const t = abas({ _fileCheckFocusBound: true });
        t.tabs.set(A, 'x');
        t.checkAllOpenFilesForChanges = vi.fn(async () => {});
        t.startPeriodicFileCheck();
        await vi.advanceTimersByTimeAsync(4000);
        expect(t.checkAllOpenFilesForChanges).not.toHaveBeenCalled();
        escondida.mockReturnValue(false);
        t.stopPeriodicFileCheck();
    });

    it('confere de 3 em 3, com uma pausa entre os lotes', async () => {
        vi.useFakeTimers();
        const t = abas();
        for (const n of [1, 2, 3, 4]) t.tabs.set(`f${n}`, '');
        t.checkSingleFileForChanges = vi.fn(async () => {});
        const p = t.checkAllOpenFilesForChanges();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.checkSingleFileForChanges).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(100);
        await p;
        expect(t.checkSingleFileForChanges.mock.calls.map((c) => c[0])).toEqual(['f1', 'f2', 'f3', 'f4']);
    });
});

describe('checkSingleFileForChanges', () => {
    it('arquivo mais novo que o conhecido, ou desconhecido, vai para o tratamento', async () => {
        const t = abas();
        t.tabs.set(A, '');
        t.handleExternalFileChange = vi.fn(async () => {});
        api.getFileStats = async () => ({ mtime: 5000 });
        await t.checkSingleFileForChanges(A);
        t.lastModifiedTimes.set(A, 5000);
        await t.checkSingleFileForChanges(A);
        t.lastModifiedTimes.set(A, 4000);
        await t.checkSingleFileForChanges(A);
        expect(t.handleExternalFileChange).toHaveBeenCalledTimes(2);
    });

    it('sem aba, sem nome, ou aba que nao e arquivo: nem consulta o disco', async () => {
        const t = abas({ isUntitledPath: (p) => p === 'U', isEmbeddedView: (p) => p === 'prism://PRISM' });
        api.getFileStats = vi.fn();
        t.tabs.set('U', '');
        t.tabs.set('prism://PRISM', '');
        for (const p of [A, 'U', 'prism://PRISM']) await t.checkSingleFileForChanges(p);
        expect(api.getFileStats).not.toHaveBeenCalled();
    });

    it('arquivo apagado para de ser vigiado; outro erro so vai para o log', async () => {
        const t = abas();
        t.tabs.set(A, '');
        t.stopWatchingFile = vi.fn();
        for (const msg of ['ENOENT: x', 'no such file or directory']) {
            api.getFileStats = async () => { throw new Error(msg); };
            await t.checkSingleFileForChanges(A);
        }
        expect(t.stopWatchingFile).toHaveBeenCalledTimes(2);
        api.getFileStats = async () => { throw new Error('EACCES'); };
        await t.checkSingleFileForChanges(A);
        expect(console.error).toHaveBeenCalledWith(`Error checking file ${A}:`, expect.any(Error));
    });
});

describe('vigia do main', () => {
    it('mudanca avisada vai para o tratamento; erro do vigia o religa depois de 2 s', async () => {
        vi.useFakeTimers();
        const t = abas();
        let aoMudar;
        let aoErrar;
        api.onFileChanged = (cb) => { aoMudar = cb; };
        api.onFileWatcherError = (cb) => { aoErrar = cb; };
        t.handleExternalFileChange = vi.fn();
        t.restartFileWatcher = vi.fn();
        t.initFileChangeListeners();
        aoMudar(A);
        expect(t.handleExternalFileChange).toHaveBeenCalledWith(A);
        aoErrar(A, 'caiu');
        expect(console.error).toHaveBeenCalledWith(`File watcher error for ${A}:`, 'caiu');
        await vi.advanceTimersByTimeAsync(2000);
        expect(t.restartFileWatcher).toHaveBeenCalledWith(A);
    });

    it('religar para e liga de novo; sem aba ou sem nome nao faz nada; falha vai para o log', async () => {
        const t = abas({ isUntitledPath: (p) => p === 'U' });
        t.stopWatchingFile = vi.fn(async () => {});
        t.startWatchingFile = vi.fn(async () => {});
        await t.restartFileWatcher(A);
        t.tabs.set('U', '');
        await t.restartFileWatcher('U');
        expect(t.startWatchingFile).not.toHaveBeenCalled();
        t.tabs.set(A, '');
        await t.restartFileWatcher(A);
        expect(t.stopWatchingFile).toHaveBeenCalledWith(A);
        expect(t.startWatchingFile).toHaveBeenCalledWith(A);
        t.startWatchingFile = async () => { throw new Error('x'); };
        await t.restartFileWatcher(A);
        expect(console.error).toHaveBeenCalledWith(`Failed to restart watcher for ${A}:`, expect.any(Error));
    });

    it('vigiar guarda a data e o id; nao repete; pula o que nao e arquivo; falha vai para o log', async () => {
        const t = abas({ isUntitledPath: (p) => p === 'U', isEmbeddedView: (p) => p === 'E' });
        api.getFileStats = async () => ({ mtime: 7 });
        api.watchFile = vi.fn(async () => 'w1');
        await t.startWatchingFile(A);
        await t.startWatchingFile(A);
        await t.startWatchingFile('U');
        await t.startWatchingFile('E');
        expect(api.watchFile).toHaveBeenCalledTimes(1);
        expect(t.fileWatchers.get(A)).toBe('w1');
        expect(t.lastModifiedTimes.get(A)).toBe(7);

        api.getFileStats = async () => { throw new Error('x'); };
        await t.startWatchingFile('C:/p/b.v');
        expect(console.error).toHaveBeenCalledWith('Error starting file watcher for C:/p/b.v:', expect.any(Error));
    });

    it('parar limpa o estado antes do main responder, e engole a falha dele', async () => {
        const t = abas();
        t.fileWatchers.set(A, 'w1');
        t.lastModifiedTimes.set(A, 1);
        api.stopWatchingFile = vi.fn(async () => { throw new Error('ja foi'); });
        await t.stopWatchingFile(A);
        await t.stopWatchingFile(A);
        expect(api.stopWatchingFile).toHaveBeenCalledTimes(1);
        expect(t.fileWatchers.size + t.lastModifiedTimes.size).toBe(0);
    });

    it('parar todos para cada vigia e a ronda', () => {
        const t = abas();
        t.fileWatchers.set(A, 'w1').set('b', 'w2');
        t.stopWatchingFile = vi.fn();
        t.stopPeriodicFileCheck = vi.fn();
        t.stopAllWatchers();
        expect(t.stopWatchingFile.mock.calls.map((c) => c[0])).toEqual([A, 'b']);
        expect(t.stopPeriodicFileCheck).toHaveBeenCalled();
    });
});

describe('handleExternalFileChange', () => {
    const preparar = ({ aba = 'velho', noEditor = 'velho', noDisco = 'novo', mtime = 9000, conhecido } = {}) => {
        const t = abas();
        t.tabs.set(A, aba);
        if (conhecido !== undefined) t.lastModifiedTimes.set(A, conhecido);
        const e = editor(noEditor);
        editores.porArquivo.set(A, e);
        api.getFileStats = async () => ({ mtime });
        api.readFile = vi.fn(async () => noDisco);
        return { t, e };
    };

    it('sem edicao local: troca o texto pelo do disco', async () => {
        const { t, e } = preparar();
        t.updateTabWithExternalContent = vi.fn(async () => {});
        await t.handleExternalFileChange(A);
        expect(t.updateTabWithExternalContent).toHaveBeenCalledWith(A, 'novo', e);
        expect(t.lastModifiedTimes.get(A)).toBe(9000);
        expect(t.externalChangeQueue.size).toBe(0);
    });

    it('o editor ja igual ao disco (o proprio salvar voltando): so guarda', async () => {
        const { t } = preparar({ noEditor: 'novo' });
        await t.handleExternalFileChange(A);
        expect(t.tabs.get(A)).toBe('novo');
        expect(t.markFileAsSaved).toHaveBeenCalledWith(A);
    });

    it('com edicao local, ou nao salva: pergunta e aplica a decisao', async () => {
        for (const caso of [{ noEditor: 'meu' }, { noEditor: 'velho', sujo: true }]) {
            const { t } = preparar({ noEditor: caso.noEditor });
            if (caso.sujo) t.unsavedChanges.add(A);
            t.showFileConflictDialog = vi.fn(async () => 'use-disk');
            t.handleConflictResolution = vi.fn(async () => {});
            await t.handleExternalFileChange(A);
            expect(t.handleConflictResolution).toHaveBeenCalledWith(A, 'use-disk', 'novo', caso.noEditor);
        }
    });

    it('mudanca dentro de 1 s da conhecida, aba fechada, sem editor, ou repetida: nada', async () => {
        const { t } = preparar({ conhecido: 8500 });
        await t.handleExternalFileChange(A);
        expect(api.readFile).not.toHaveBeenCalled();

        t.lastModifiedTimes.clear();
        t.tabs.clear();
        await t.handleExternalFileChange(A);
        t.tabs.set(A, 'x');
        editores.porArquivo.clear();
        await t.handleExternalFileChange(A);
        t.externalChangeQueue.add(A);
        await t.handleExternalFileChange(A);
        expect(api.readFile).not.toHaveBeenCalled();
    });

    it('erro no meio vai para o log e solta a fila', async () => {
        const { t } = preparar();
        api.readFile = async () => { throw new Error('x'); };
        await t.handleExternalFileChange(A);
        expect(console.error).toHaveBeenCalledWith(`Error handling external change for ${A}:`, expect.any(Error));
        expect(t.externalChangeQueue.size).toBe(0);
    });
});

describe('updateTabWithExternalContent', () => {
    it('troca pelo modelo (desfazivel), guarda o cursor e a rolagem, e marca salvo', async () => {
        const t = abas();
        const e = editor('a\nbbbbbbbbbbbb\nc', { linha: 2, coluna: 12 });
        await t.updateTabWithExternalContent(A, 'x\nyy\nz', e);
        expect(e.edicoes).toEqual([[{ range: 'tudo', text: 'x\nyy\nz', forceMoveMarkers: true }]]);
        expect(e.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 3 });
        expect(e.setScrollTop).toHaveBeenCalledWith(40);
        expect(t.tabs.get(A)).toBe('x\nyy\nz');
        expect(t.markFileAsSaved).toHaveBeenCalledWith(A);
        expect(console.log).toHaveBeenCalledWith('a.v was updated with external changes');
    });

    it('cursor alem do fim fica onde esta; erro ao repor o cursor volta ao inicio', async () => {
        const t = abas();
        const e = editor('a\nb\nc\nd\ne', { linha: 5, coluna: 1 });
        await t.updateTabWithExternalContent(A, 'so uma', e);
        expect(e.setPosition).not.toHaveBeenCalled();

        const quebrado = editor('a', { linha: 1, coluna: 1 });
        const modelo = quebrado.getModel();
        quebrado.getModel = () => ({ ...modelo, getLineCount: () => { throw new Error('x'); } });
        await t.updateTabWithExternalContent(A, 'b', quebrado);
        expect(quebrado.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 });
    });

    it('texto igual: so guarda, sem tocar no modelo', async () => {
        const t = abas();
        const e = editor('igual');
        await t.updateTabWithExternalContent(A, 'igual', e);
        expect(e.edicoes).toEqual([]);
        expect(t.markFileAsSaved).toHaveBeenCalledWith(A);
    });
});

describe('conflito', () => {
    it('o dialogo oferece as tres saidas, e Esc fica com a versao do editor', async () => {
        const t = abas();
        window.t = (k, p) => (p ? `${k}:${p.name}` : k);
        expect(await t.showFileConflictDialog('C:\\p\\a.v')).toBe('keep-editor');
        expect(dialogo.chamadas[0].message).toBe('dialog.fileConflict.message:a.v');
        expect(dialogo.chamadas[0].buttons.map((b) => b.action)).toEqual(['keep-editor', 'use-disk', 'save-and-reload']);
        dialogo.resposta = 'use-disk';
        expect(await t.showFileConflictDialog(A)).toBe('use-disk');
    });

    it('cada decisao', async () => {
        const t = abas();
        const e = editor('meu');
        editores.porArquivo.set(A, e);
        t.updateTabWithExternalContent = vi.fn(async () => {});
        api.readFile = async () => 'gravado';

        await t.handleConflictResolution(A, 'keep-editor', 'disco');
        expect(t.saveFile).toHaveBeenCalledWith(A);
        expect(console.log).toHaveBeenCalledWith('Kept your version of a.v');

        await t.handleConflictResolution(A, 'use-disk', 'disco');
        expect(t.updateTabWithExternalContent).toHaveBeenLastCalledWith(A, 'disco', e);

        await t.handleConflictResolution(A, 'save-and-reload', 'disco');
        expect(t.updateTabWithExternalContent).toHaveBeenLastCalledWith(A, 'gravado', e);
        expect(console.log).toHaveBeenCalledWith('Saved and reloaded a.v');

        await t.handleConflictResolution(A, 'outra', 'disco');
        editores.porArquivo.clear();
        await t.handleConflictResolution(A, 'use-disk', 'disco');
        expect(t.updateTabWithExternalContent).toHaveBeenCalledTimes(2);
    });

    it('aviso de acao desconhecida sai vazio', () => {
        abas().showExternalChangeNotification(A, 'outra');
        expect(console.log).toHaveBeenCalledWith('');
    });
});
