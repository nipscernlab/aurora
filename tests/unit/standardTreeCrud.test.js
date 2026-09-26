// @vitest-environment happy-dom
//
// As operacoes da visao de pastas (js/tree/standard_tree_crud.js): selecao,
// atalhos, arrastar, menu, criar, renomear, apagar, copiar e colar, desfazer, e
// o .spf acompanhando cada uma. Teste de caracterizacao, escrito antes de
// dividir o arquivo: o que se afirma aqui e o comportamento que ja existia.
//
// O disco e a ponte sao simulados; a pilha de desfazer (tree_history), as
// regras de nome (fs_name_utils), a selecao (tree_selection) e as regras do
// .spf (spf_paths) sao as de verdade, porque tem teste proprio e o que interessa
// aqui e o fio entre elas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({}));
vi.hoisted(() => {
    document.body.innerHTML = '<div id="file-tree"><div id="std"></div></div>';
    globalThis.window.electronAPI = new Proxy(api, {
        get: (alvo, k) => (k in alvo ? alvo[k] : () => Promise.resolve()),
    });
});

const TabManager = vi.hoisted(() => ({}));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));
const renderer = vi.hoisted(() => ({}));
vi.mock('../../js/tree/standard_tree_render.js', () => ({ standardTreeRenderer: renderer }));
vi.mock('../../js/tree/tree_view.js', () => ({
    treeView: { getContainer: () => document.getElementById('std') },
}));
const switchTerminal = vi.hoisted(() => vi.fn());
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal }));
const showCardNotification = vi.hoisted(() => vi.fn());
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
const EditorManager = vi.hoisted(() => ({}));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager }));
const spf = vi.hoisted(() => ({ cfg: {}, falhar: false, lerFalha: false }));
vi.mock('../../js/project/spf_store.js', () => ({
    SpfStore: {
        update: vi.fn(async (_p, fn) => { if (spf.falhar) throw new Error('spf travado'); fn(spf.cfg); }),
        read: vi.fn(async () => { if (spf.lerFalha) throw new Error('x'); return spf.cfg; }),
    },
}));

import { standardTreeCrud as crud } from '../../js/tree/standard_tree_crud.js';
import { ProjectStore } from '../../js/project/project_store.js';
import { SpfStore } from '../../js/project/spf_store.js';

const R = 'C:\\p';
const P = (rel) => `${R}\\${rel}`;
const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A arvore na tela: linhas planas, cada uma com o caminho, se e pasta e a profundidade. */
function arvore(linhas) {
    const std = document.getElementById('std');
    std.innerHTML = linhas.map(([rel, dir, depth = 0]) => `
        <div class="file-tree-item" data-path="${P(rel)}" data-is-dir="${dir ? '1' : '0'}" style="--depth: ${depth}">
            <div class="file-item"></div>${dir ? '<div class="folder-content"></div>' : ''}
        </div>`).join('');
}
const linha = (rel) => document.querySelector(`.file-tree-item[data-path="${window.CSS.escape(P(rel))}"]`);
const temClasse = (rel, c) => linha(rel).querySelector(':scope > .file-item').classList.contains(c);

function teclar(key, extra = {}) {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    document.getElementById('file-tree').dispatchEvent(e);
    return e;
}

/** Resposta do dialogo, em ordem. */
let respostas;
const dialog = vi.fn(async () => respostas.shift());

beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(api)) delete api[k];
    Object.assign(api, {
        renamePath: vi.fn(async () => ({ success: true })),
        undoStage: vi.fn(async (c) => ({ success: true, token: `tok:${c}` })),
        undoRestore: vi.fn(async () => ({ success: true })),
        undoDiscard: vi.fn(async () => {}),
        getFileStats: vi.fn(async () => ({ isDirectory: false })),
        getFolderFiles: vi.fn(async () => []),
        fileExists: vi.fn(async () => true),
        createDirectory: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => 'conteudo'),
        deleteFileOrDirectory: vi.fn(async () => {}),
        copyAnyPath: vi.fn(async () => ({ success: true })),
        openFolder: vi.fn(),
    });
    Object.assign(TabManager, {
        tabs: new Map(),
        unsavedChanges: new Set(),
        activeTab: null,
        closeTab: vi.fn(async (p) => { TabManager.tabs.delete(p); }),
        addTab: vi.fn((p) => { TabManager.tabs.set(p, {}); }),
        activateTab: vi.fn(),
        saveFile: vi.fn(async () => true),
    });
    Object.assign(renderer, {
        _expanded: new Set(),
        render: vi.fn(async () => {}),
        isExpanded: vi.fn((d) => renderer._expanded.has(d)),
        collapseAll: vi.fn(),
    });
    Object.assign(EditorManager, { getEditorForFile: vi.fn(() => null) });
    spf.cfg = {};
    spf.falhar = false;
    spf.lerFalha = false;
    respostas = [];
    window.AuroraUI = { dialog };
    window.fileTreeViewController = { getActiveView: () => 'standard' };
    delete window.t;
    delete window.projectTreeManager;
    delete window.shellTerminal;
    document.body.innerHTML = '<div id="file-tree"><div id="std"></div></div>';
    ProjectStore.setProject(`${R}\\p.spf`, R);
    crud._closeMenu();
    crud._cancelInline();
    crud.history.limpar();
    crud._spfRetirado.clear();
    crud.clipboard = null;
    crud.selectedPath = null;
    crud._wireContainer();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    ProjectStore.clearProject();
});

// ─────────────────────────────────────────────────────────────── utilitarios
describe('utilitarios', () => {
    it('a raiz e a pasta do projeto aberto; o separador vem dela', () => {
        expect(crud._root()).toBe(R);
        expect(crud._sep()).toBe('\\');
        expect(crud._join(`${R}\\`, 'a/b\\c.v')).toBe(`${R}\\a\\b\\c.v`);
        ProjectStore.setProject('/q/q.spf', '/q');
        expect(crud._sep()).toBe('/');
        ProjectStore.clearProject();
        expect(crud._root()).toBeNull();
        expect(crud._sep()).toBe('/');
    });

    it('a raiz vem do ProjectStore, nao de uma global sobrescrita', () => {
        window.currentProjectPath = 'D:\\outra-janela';
        expect(crud._root()).toBe(R);
    });

    it('nomes da pasta: a lista da ponte, ou vazia quando ela falha ou nao responde lista', async () => {
        api.getFolderFiles.mockResolvedValueOnce([{ name: 'a.v' }, { name: 'b' }]);
        expect(await crud._siblingNames(R)).toEqual(['a.v', 'b']);
        api.getFolderFiles.mockResolvedValueOnce(null);
        expect(await crud._siblingNames(R)).toEqual([]);
        api.getFolderFiles.mockRejectedValueOnce(new Error('x'));
        expect(await crud._siblingNames(R)).toEqual([]);
    });

    it('e pasta? pela linha na tela, senao pelo disco, e nao quando o disco falha', async () => {
        arvore([['src', true], ['a.v', false]]);
        expect(await crud._ehPasta(P('src'))).toBe(true);
        expect(await crud._ehPasta(P('a.v'))).toBe(false);
        api.getFileStats.mockResolvedValueOnce({ isDirectory: true });
        expect(await crud._ehPasta(P('fora'))).toBe(true);
        api.getFileStats.mockResolvedValueOnce({ isDir: true });
        expect(await crud._ehPasta(P('fora'))).toBe(true);
        api.getFileStats.mockRejectedValueOnce(new Error('x'));
        expect(await crud._ehPasta(P('fora'))).toBe(false);
    });

    it('abas afetadas: o proprio arquivo, ou tudo embaixo da pasta', () => {
        TabManager.tabs = new Map([[P('a.v'), {}], [P('src\\b.v'), {}], [P('srcx.v'), {}]]);
        expect(crud._affectedTabs(P('a.v'), false)).toEqual([P('a.v')]);
        expect(crud._affectedTabs(P('src'), true)).toEqual([P('src\\b.v')]);
        TabManager.tabs = { keys: () => { throw new Error('x'); } };
        expect(crud._openTabPaths()).toEqual([]);
    });

    it('dialogo: o da AURORA, ou confirm() no botao principal', async () => {
        respostas = ['ok'];
        expect(await crud._dialog({ title: 't', message: 'm', buttons: [] })).toBe('ok');
        delete window.AuroraUI;
        window.confirm = vi.fn(() => true);
        expect(await crud._dialog({ title: 't', message: 'm', buttons: [{ action: 'a' }, { action: 'b' }] })).toBe('b');
        expect(await crud._dialog({ title: 't', message: 'm' })).toBe('ok');
        window.confirm = vi.fn(() => false);
        expect(await crud._dialog({ title: 't', message: 'm', buttons: [{ action: 'b' }] })).toBe('cancel');
    });

    it('com traducao carregada, o texto vem dela; sem, o ingles com os campos preenchidos', async () => {
        window.t = (k, p) => (k === 'fileTree.crud.nothingToUndo' ? 'Nada para desfazer' : k + (p ? '' : ''));
        await crud.desfazer();
        expect(showCardNotification).toHaveBeenLastCalledWith('Nada para desfazer', 'info', 1800);
    });
});

// ───────────────────────────────────────────────────────────────── o .spf
describe('o .spf acompanha a arvore', () => {
    it('renomear reescreve topo e listas; sem .spf, nada; falha fica no console', async () => {
        spf.cfg = { topLevelFile: P('a.v'), synthesizableFiles: [{ path: P('a.v'), name: 'a.v' }] };
        await crud._spfRenomeou(P('a.v'), P('b.v'));
        expect(spf.cfg.topLevelFile).toBe(P('b.v'));
        expect(spf.cfg.synthesizableFiles[0]).toEqual({ path: P('b.v'), name: 'b.v' });
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        spf.falhar = true;
        await crud._spfRenomeou(P('b.v'), P('c.v'));
        expect(erro).toHaveBeenCalled();
        ProjectStore.clearProject();
        SpfStore.update.mockClear();
        await crud._spfRenomeou(P('b.v'), P('c.v'));
        expect(SpfStore.update).not.toHaveBeenCalled();
    });

    it('apagar tira a referencia e guarda o que tirou; o Ctrl+Z devolve', async () => {
        spf.cfg = { topLevelFile: P('a.v') };
        await crud._spfRemoveu([P('a.v'), P('nada.v')]);
        expect(spf.cfg.topLevelFile).toBe('');
        expect(crud._spfRetirado.size).toBe(1);
        await crud._spfRepos(P('A.V'));
        expect(spf.cfg.topLevelFile).toBe(P('a.v'));
        expect(crud._spfRetirado.size).toBe(0);
        SpfStore.update.mockClear();
        await crud._spfRepos(P('a.v'));
        await crud._spfRemoveu([]);
        expect(SpfStore.update).not.toHaveBeenCalled();
    });

    it('falha ao tirar ou repor fica no console', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        spf.cfg = { topLevelFile: P('a.v') };
        await crud._spfRemoveu([P('a.v')]);
        spf.falhar = true;
        await crud._spfRemoveu([P('b.v')]);
        await crud._spfRepos(P('a.v'));
        expect(erro).toHaveBeenCalledTimes(2);
    });

    it('pasta de processador e reconhecida e barrada com aviso', async () => {
        spf.cfg = { processors: [{ name: 'proc' }] };
        expect(await crud._processadorEm(P('proc'))).toBe('proc');
        expect(await crud._processadorEm(P('outra'))).toBeNull();
        respostas = ['ok'];
        expect(await crud._barradoPorSerProcessador(P('proc'), 'Rename')).toBe(true);
        expect(dialog.mock.calls[0][0].message).toContain('"proc" is a processor folder');
        expect(await crud._barradoPorSerProcessador(P('outra'), 'Rename')).toBe(false);
        spf.lerFalha = true;
        expect(await crud._processadorEm(P('proc'))).toBeNull();
        ProjectStore.clearProject();
        expect(await crud._processadorEm(P('proc'))).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────── selecao
describe('selecao e decoracao', () => {
    beforeEach(() => arvore([['src', true], ['src\\b.v', false, 1], ['a.v', false], ['c.v', false]]));

    it('selectedPath e o ultimo; atribuir troca a selecao e a ancora', () => {
        expect(crud.selectedPath).toBeNull();
        crud.selectMany([P('a.v'), null, P('c.v')]);
        expect(crud.selectedPath).toBe(P('c.v'));
        expect(crud._anchor).toBe(P('c.v'));
        crud.selectMany(null);
        expect(crud.selectedPaths).toEqual([]);
        expect(crud._anchor).toBeNull();
    });

    it('marca os selecionados e os recortados, com o conteudo da pasta recortada', () => {
        crud.select(P('a.v'));
        expect(temClasse('a.v', 'selected')).toBe(true);
        expect(temClasse('c.v', 'selected')).toBe(false);
        crud.copy([P('src')], true);
        expect(temClasse('src', 'cut-pending')).toBe(true);
        expect(temClasse('src\\b.v', 'cut-pending')).toBe(true);
        expect(temClasse('a.v', 'cut-pending')).toBe(false);
    });

    it('um redesenho que tirou a linha tira ela da selecao', () => {
        crud.selectMany([P('a.v'), P('c.v')]);
        arvore([['a.v', false]]);
        document.dispatchEvent(new Event('aurora:standard-tree-rendered'));
        expect(crud.selectedPaths).toEqual([P('a.v')]);
    });

    it('acao em lote nao repete o filho de pasta tambem marcada; sem container, nada quebra', () => {
        crud.selectMany([P('src'), P('src\\b.v'), P('a.v')]);
        expect(crud._actionPaths()).toEqual([P('src'), P('a.v')]);
        document.getElementById('std').remove();
        expect(crud._visiblePaths()).toEqual([]);
        expect(() => crud._refreshDecorations()).not.toThrow();
        expect(crud._rowFor(P('a.v'))).toBeNull();
    });

    it('linha sem .file-item e ignorada na decoracao', () => {
        linha('a.v').innerHTML = '';
        expect(() => crud.select(P('a.v'))).not.toThrow();
    });

    it('trocar de projeto zera a pilha, as anotacoes do .spf e a selecao', () => {
        crud.select(P('a.v'));
        crud.history.registrar({ kind: 'move', de: 'x', para: 'y' });
        crud._spfRetirado.set('k', {});
        ProjectStore.setProject('D:\\q\\q.spf', 'D:\\q');
        expect(crud.history.podeDesfazer()).toBe(false);
        expect(crud._spfRetirado.size).toBe(0);
        expect(crud.selectedPaths).toEqual([]);
        // O mesmo projeto de novo nao zera nada.
        crud.select(P('a.v'));
        ProjectStore.setProject('D:\\q\\outro.spf', 'D:\\q');
        expect(crud.selectedPaths).toEqual([P('a.v')]);
    });
});

// ───────────────────────────────────────────────────────── clique e teclado
describe('clique e atalhos', () => {
    beforeEach(() => arvore([['src', true], ['a.v', false], ['c.v', false]]));

    it('clique seleciona; Ctrl soma; Shift pega o intervalo; fora da visao de pastas, nada', () => {
        linha('a.v').click();
        expect(crud.selectedPaths).toEqual([P('a.v')]);
        linha('src').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        expect(crud.selectedPaths).toEqual([P('a.v'), P('src')]);
        linha('a.v').click();
        linha('c.v').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        expect(crud.selectedPaths).toEqual([P('a.v'), P('c.v')]);
        document.getElementById('std').click();
        expect(crud.selectedPaths).toEqual([P('a.v'), P('c.v')]);
        window.fileTreeViewController = { getActiveView: () => 'verilog' };
        linha('src').click();
        expect(crud.selectedPaths).toEqual([P('a.v'), P('c.v')]);
    });

    it('ligar duas vezes nao duplica ouvinte; sem a arvore, nao liga', () => {
        crud._wireContainer();
        linha('src').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        expect(crud.selectedPaths).toEqual([P('src')]);
        document.body.innerHTML = '';
        expect(() => crud._wireContainer()).not.toThrow();
    });

    it('cada atalho chama a sua acao', () => {
        const s = {};
        for (const m of ['startRename', 'deleteEntries', 'copy', 'paste', 'refazer', 'desfazer']) {
            s[m] = vi.spyOn(crud, m).mockResolvedValue(undefined);
        }
        teclar('a', { ctrlKey: true });
        expect(crud.selectedPaths).toEqual([P('src'), P('a.v'), P('c.v')]);
        crud.select(P('a.v'));
        teclar('F2');
        expect(s.startRename).toHaveBeenCalledWith(P('a.v'));
        teclar('Delete', { shiftKey: true });
        expect(s.deleteEntries).toHaveBeenCalledWith([P('a.v')], { permanent: true });
        teclar('c', { ctrlKey: true });
        expect(s.copy).toHaveBeenLastCalledWith([P('a.v')], false);
        teclar('X', { metaKey: true });
        expect(s.copy).toHaveBeenLastCalledWith([P('a.v')], true);
        teclar('v', { ctrlKey: true });
        expect(s.paste).toHaveBeenCalledWith('C:/p');
        teclar('Z', { ctrlKey: true, shiftKey: true });
        expect(s.refazer).toHaveBeenCalledTimes(1);
        teclar('z', { ctrlKey: true });
        expect(s.desfazer).toHaveBeenCalledTimes(1);
        teclar('y', { ctrlKey: true });
        expect(s.refazer).toHaveBeenCalledTimes(2);
        expect(teclar('q').defaultPrevented).toBe(false);
    });

    it('com a edicao em linha aberta, ou fora da visao, o teclado nao e da arvore', () => {
        const ren = vi.spyOn(crud, 'startRename').mockResolvedValue(undefined);
        crud.select(P('a.v'));
        crud._inlineCleanup = () => {};
        teclar('F2');
        crud._inlineCleanup = null;
        window.fileTreeViewController = {};
        teclar('F2');
        expect(ren).not.toHaveBeenCalled();
    });

    it('destino do colar: a pasta selecionada, a pasta do arquivo, ou a raiz', () => {
        expect(crud._pasteTargetDir()).toBe(R);
        crud.select(P('src'));
        expect(crud._pasteTargetDir()).toBe(P('src'));
        crud.select(P('a.v'));
        expect(crud._pasteTargetDir()).toBe('C:/p');
        crud.select(P('sumiu.v'));
        expect(crud._pasteTargetDir()).toBe(R);
    });
});

// ─────────────────────────────────────────────────────────────── arrastar
describe('arrastar e soltar', () => {
    const dt = () => {
        const dados = {};
        return {
            dados,
            types: [],
            setData(t, v) { dados[t] = v; this.types.push(t); },
            getData: (t) => dados[t] || '',
        };
    };
    const evento = (tipo, alvo, dataTransfer, extra = {}) => {
        const e = new Event(tipo, { bubbles: true, cancelable: true });
        Object.assign(e, { dataTransfer, ...extra });
        alvo.dispatchEvent(e);
        return e;
    };

    beforeEach(() => arvore([['src', true], ['a.v', false], ['c.v', false]]));

    it('arrastar leva a selecao se a linha esta nela, senao troca a selecao pela linha', () => {
        crud.selectMany([P('a.v'), P('c.v')]);
        const d1 = dt();
        evento('dragstart', linha('a.v'), d1);
        expect(JSON.parse(d1.dados['application/x-aurora-tree-path'])).toEqual([P('a.v'), P('c.v')]);
        expect(d1.effectAllowed).toBe('copyMove');
        const d2 = dt();
        evento('dragstart', linha('src'), d2);
        expect(JSON.parse(d2.dados['application/x-aurora-tree-path'])).toEqual([P('src')]);
        const d3 = dt();
        evento('dragstart', document.getElementById('std'), d3);
        expect(d3.types).toEqual([]);
    });

    it('passar por cima de pasta realca; de arquivo, nao; carga de fora e ignorada', () => {
        const d = dt();
        d.setData('application/x-aurora-tree-path', '[]');
        const e = evento('dragover', linha('src'), d, { ctrlKey: true });
        expect(e.defaultPrevented).toBe(true);
        expect(d.dropEffect).toBe('copy');
        expect(linha('src').classList.contains('drop-target')).toBe(true);
        evento('dragover', linha('src'), d);
        evento('dragover', linha('a.v'), d);
        expect(d.dropEffect).toBe('move');
        expect(linha('src').classList.contains('drop-target')).toBe(false);
        evento('dragover', linha('src'), d);
        evento('dragleave', linha('src'), d, { relatedTarget: document.body });
        expect(linha('src').classList.contains('drop-target')).toBe(false);
        evento('dragover', linha('src'), d);
        evento('dragleave', linha('src'), d, { relatedTarget: linha('a.v') });
        expect(linha('src').classList.contains('drop-target')).toBe(true);
        evento('dragend', linha('src'), d);
        expect(linha('src').classList.contains('drop-target')).toBe(false);
        expect(evento('dragover', linha('src'), dt()).defaultPrevented).toBe(false);
    });

    it('soltar le a lista, um caminho solto ou texto cru, e resolve o destino', async () => {
        const drop = vi.spyOn(crud, 'dropOnto').mockResolvedValue(undefined);
        const solta = async (carga, alvo, extra = {}) => {
            const d = dt();
            if (carga !== null) d.setData('application/x-aurora-tree-path', carga);
            evento('drop', alvo, d, { ctrlKey: false, metaKey: false, ...extra });
            await esperar();
        };
        await solta(JSON.stringify([P('a.v')]), linha('src'), { ctrlKey: true });
        expect(drop).toHaveBeenLastCalledWith([P('a.v')], P('src'), { copy: true });
        await solta(JSON.stringify(P('a.v')), linha('c.v'));
        expect(drop).toHaveBeenLastCalledWith([P('a.v')], 'C:/p', { copy: false });
        await solta('nao json', document.getElementById('std'));
        expect(drop).toHaveBeenLastCalledWith(['nao json'], R, { copy: false });
        drop.mockClear();
        await solta('[]', linha('src'));
        await solta(null, linha('src'));
        ProjectStore.clearProject();
        await solta(JSON.stringify([P('a.v')]), document.getElementById('std'));
        window.fileTreeViewController = {};
        await solta(JSON.stringify([P('a.v')]), linha('src'));
        evento('dragstart', linha('a.v'), dt());
        evento('dragover', linha('a.v'), dt());
        expect(drop).not.toHaveBeenCalled();
    });

    it('soltar move pelo colar, sem mexer no clipboard do usuario; soltar no lugar nao faz nada', async () => {
        const paste = vi.spyOn(crud, 'paste').mockResolvedValue(undefined);
        crud.clipboard = { items: [{ path: P('c.v') }], cut: true };
        await crud.dropOnto(P('a.v'), P('src'), { copy: true });
        expect(paste).toHaveBeenCalledWith(P('src'));
        expect(crud.clipboard).toEqual({ items: [{ path: P('c.v') }], cut: true });
        paste.mockClear();
        await crud.dropOnto([P('a.v'), null], R);
        expect(paste).not.toHaveBeenCalled();
        let visto;
        paste.mockImplementation(async () => { visto = crud.clipboard; });
        await crud.dropOnto(P('src'), P('c.v'));
        expect(visto).toEqual({ items: [{ path: P('src'), name: 'src', isDir: true }], cut: true });
    });
});

// ─────────────────────────────────────────────────────────────────── menu
describe('menu de botao direito', () => {
    const rotulos = () => Array.from(document.querySelectorAll('#standard-tree-context-menu .context-menu-item span'))
        .map((s) => s.textContent);
    const item = (texto) => Array.from(document.querySelectorAll('#standard-tree-context-menu .context-menu-item'))
        .find((el) => el.textContent === texto);
    const abrir = (alvo) => crud.showMenu({ target: alvo, pageX: 10, pageY: 20 });

    beforeEach(() => arvore([['src', true], ['a.v', false], ['c.v', false]]));

    it('sem projeto, nao abre', () => {
        ProjectStore.clearProject();
        abrir(linha('a.v'));
        expect(rotulos()).toEqual([]);
    });

    it('em arquivo: sem criar, com cortar/copiar/apagar e o numero de marcados', () => {
        crud.selectMany([P('a.v'), P('c.v')]);
        abrir(linha('a.v'));
        expect(crud.selectedPaths).toEqual([P('a.v'), P('c.v')]);
        expect(rotulos()).toEqual([
            'Cut (2)', 'Copy (2)', 'Paste', 'Copy Path', 'Copy Relative Path',
            'Rename...', 'Delete (2)', 'Open in Integrated Terminal', 'Reveal in File Explorer',
        ]);
        expect(item('Paste').classList.contains('disabled')).toBe(true);
        expect(item('Delete (2)').classList.contains('delete-item')).toBe(true);
    });

    it('fora da selecao troca a selecao; em pasta, oferece criar dentro dela', () => {
        crud.select(P('a.v'));
        abrir(linha('src'));
        expect(crud.selectedPaths).toEqual([P('src')]);
        expect(rotulos().slice(0, 3)).toEqual(['New File...', 'New Folder...', 'Cut']);
    });

    it('cada item de linha chama a sua acao', async () => {
        const s = {};
        for (const m of ['startCreate', 'copy', 'paste', '_copyText', '_copyRelPath', 'startRename', 'deleteEntries', 'openTerminalHere']) {
            s[m] = vi.spyOn(crud, m).mockResolvedValue(undefined);
        }
        crud.clipboard = { items: [], cut: false };
        const clicar = (alvo, texto) => { abrir(linha(alvo)); item(texto).click(); };
        clicar('src', 'New File...'); expect(s.startCreate).toHaveBeenLastCalledWith(P('src'), 'file');
        clicar('src', 'New Folder...'); expect(s.startCreate).toHaveBeenLastCalledWith(P('src'), 'folder');
        clicar('src', 'Cut'); expect(s.copy).toHaveBeenLastCalledWith([P('src')], true);
        clicar('src', 'Copy'); expect(s.copy).toHaveBeenLastCalledWith([P('src')], false);
        clicar('src', 'Paste'); expect(s.paste).toHaveBeenLastCalledWith(P('src'));
        clicar('a.v', 'Paste'); expect(s.paste).toHaveBeenLastCalledWith('C:/p');
        clicar('a.v', 'Copy Path'); expect(s._copyText).toHaveBeenLastCalledWith(P('a.v'));
        clicar('a.v', 'Copy Relative Path'); expect(s._copyRelPath).toHaveBeenLastCalledWith(P('a.v'));
        clicar('a.v', 'Rename...'); expect(s.startRename).toHaveBeenLastCalledWith(P('a.v'));
        clicar('a.v', 'Delete'); expect(s.deleteEntries).toHaveBeenLastCalledWith([P('a.v')]);
        clicar('a.v', 'Open in Integrated Terminal'); expect(s.openTerminalHere).toHaveBeenLastCalledWith('C:/p');
        clicar('src', 'Open in Integrated Terminal'); expect(s.openTerminalHere).toHaveBeenLastCalledWith(P('src'));
        clicar('a.v', 'Reveal in File Explorer'); expect(api.openFolder).toHaveBeenLastCalledWith('C:/p');
        clicar('src', 'Reveal in File Explorer'); expect(api.openFolder).toHaveBeenLastCalledWith(P('src'));
    });

    it('na area vazia: criar, os atalhos antigos, colar, terminal, explorador, atualizar e recolher', () => {
        const s = {};
        for (const m of ['startCreate', 'paste', 'openTerminalHere']) s[m] = vi.spyOn(crud, m).mockResolvedValue(undefined);
        window.projectTreeManager = { createNewCocotbFile: vi.fn(), createGitignore: vi.fn() };
        crud.clipboard = { items: [], cut: false };
        const clicar = (texto) => { abrir(document.getElementById('std')); item(texto).click(); };
        abrir(document.getElementById('std'));
        expect(rotulos()).toEqual([
            'New File...', 'New Folder...', 'New cocotb Testbench (.py)', 'New .gitignore', 'Paste',
            'Open in Integrated Terminal', 'Reveal in File Explorer', 'Refresh', 'Collapse All',
        ]);
        clicar('New File...'); expect(s.startCreate).toHaveBeenLastCalledWith(R, 'file');
        clicar('New Folder...'); expect(s.startCreate).toHaveBeenLastCalledWith(R, 'folder');
        clicar('New cocotb Testbench (.py)'); expect(window.projectTreeManager.createNewCocotbFile).toHaveBeenCalled();
        clicar('New .gitignore'); expect(window.projectTreeManager.createGitignore).toHaveBeenCalled();
        clicar('Paste'); expect(s.paste).toHaveBeenLastCalledWith(R);
        clicar('Open in Integrated Terminal'); expect(s.openTerminalHere).toHaveBeenLastCalledWith(R);
        clicar('Reveal in File Explorer'); expect(api.openFolder).toHaveBeenLastCalledWith(R);
        clicar('Refresh'); expect(renderer.render).toHaveBeenCalled();
        clicar('Collapse All'); expect(renderer.collapseAll).toHaveBeenCalled();
    });

    it('acao que falha vira aviso; item desabilitado nao responde', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(crud, 'startRename').mockRejectedValue(new Error('travou'));
        abrir(linha('a.v'));
        item('Rename...').click();
        await esperar();
        expect(showCardNotification).toHaveBeenCalledWith('travou', 'error', 4000);
        expect(erro).toHaveBeenCalled();
        vi.spyOn(crud, 'startRename').mockRejectedValue('texto');
        abrir(linha('a.v'));
        item('Rename...').click();
        await esperar();
        expect(showCardNotification).toHaveBeenLastCalledWith('texto', 'error', 4000);
        const paste = vi.spyOn(crud, 'paste');
        abrir(linha('a.v'));
        item('Paste').click();
        expect(paste).not.toHaveBeenCalled();
    });

    it('o card aparece no proximo quadro e muda de lado quando passaria da borda', async () => {
        window.innerWidth = 5;
        window.innerHeight = 5;
        abrir(linha('a.v'));
        const menu = document.getElementById('standard-tree-context-menu');
        await new Promise((r) => window.requestAnimationFrame(r));
        await esperar();
        expect(menu.classList.contains('show')).toBe(true);
        crud._closeMenu();
        await new Promise((r) => window.requestAnimationFrame(r));
    });
});

// ───────────────────────────────────────────── terminal e copiar caminho
describe('terminal e caminhos', () => {
    it('abrir o terminal numa pasta troca para o TCMD e manda o cd', () => {
        window.shellTerminal = { openAt: vi.fn() };
        crud.openTerminalHere('');
        expect(switchTerminal).not.toHaveBeenCalled();
        crud.openTerminalHere(P('src'));
        expect(switchTerminal).toHaveBeenCalledWith('terminal-tcmd');
        expect(window.shellTerminal.openAt).toHaveBeenCalledWith(P('src'));
    });

    it('copiar caminho relativo tira a raiz; fora dela copia inteiro; negado nao lanca', async () => {
        navigator.clipboard.writeText = vi.fn(async () => {});
        await crud._copyRelPath(P('src\\a.v'));
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('src\\a.v');
        await crud._copyRelPath('D:\\x.v');
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('D:\\x.v');
        // Sem projeto a raiz e vazia, e a barra do comeco sai junto.
        ProjectStore.clearProject();
        await crud._copyRelPath('/x.v');
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('x.v');
        navigator.clipboard.writeText = vi.fn(async () => { throw new Error('negado'); });
        await expect(crud._copyText('x')).resolves.toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────── edicao em linha
describe('edicao em linha', () => {
    function montar(extra = {}) {
        const mountEl = document.getElementById('std');
        const commit = vi.fn(async () => {});
        const onClose = vi.fn();
        const input = crud._mountInline({
            mountEl, before: null, depth: 2, kind: 'file', initial: 'a.v',
            validate: (v) => (v === 'ruim' ? { ok: false, error: 'invalidChars' } : v === 'x?' ? { ok: false, error: 'novo' } : { ok: true }),
            commit, onClose, ...extra,
        });
        return { input, commit, onClose, wrap: input.closest('.tree-inline-edit') };
    }
    const digitar = (input, v) => { input.value = v; input.dispatchEvent(new Event('input')); };
    const tecla = (input, key) => input.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));

    it('nasce com o nome, a profundidade e o texto selecionado', () => {
        const { input, wrap } = montar({ selectRange: [0, 1] });
        expect(input.value).toBe('a.v');
        expect(wrap.style.getPropertyValue('--depth')).toBe('2');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    });

    it('digitar mostra o erro na hora; Enter com erro nao grava', () => {
        const { input, commit, wrap } = montar();
        digitar(input, 'ruim');
        const erro = wrap.querySelector('.tree-inline-error');
        expect(erro.textContent).toContain('characters that are not allowed');
        expect(input.classList.contains('invalid')).toBe(true);
        digitar(input, 'x?');
        expect(erro.textContent).toBe('novo');
        tecla(input, 'Enter');
        expect(commit).not.toHaveBeenCalled();
        digitar(input, 'b.v');
        expect(erro.classList.contains('hidden')).toBe(true);
    });

    it('Enter grava e fecha; Escape so fecha', async () => {
        let m = montar();
        digitar(m.input, 'b.v');
        tecla(m.input, 'Enter');
        await esperar();
        expect(m.commit).toHaveBeenCalledWith('b.v');
        expect(m.onClose).toHaveBeenCalled();
        expect(document.querySelector('.tree-inline-edit')).toBeNull();
        m = montar();
        tecla(m.input, 'Escape');
        tecla(m.input, 'a');
        expect(m.commit).not.toHaveBeenCalled();
        expect(crud._inlineCleanup).toBeNull();
    });

    it('sair do campo grava se valido, e cancela se vazio ou invalido', async () => {
        let m = montar();
        m.input.dispatchEvent(new Event('blur'));
        await esperar();
        expect(m.commit).toHaveBeenCalledWith('a.v');
        m = montar();
        digitar(m.input, '  ');
        m.input.dispatchEvent(new Event('blur'));
        expect(m.commit).not.toHaveBeenCalled();
        m.input.dispatchEvent(new Event('blur'));
        m = montar();
        digitar(m.input, 'ruim');
        m.input.dispatchEvent(new Event('blur'));
        expect(m.commit).not.toHaveBeenCalled();
    });

    it('abrir outro fecha o anterior; antes de uma linha, entra antes dela', () => {
        arvore([['a.v', false]]);
        const primeiro = montar();
        const antes = linha('a.v');
        crud._mountInline({ mountEl: document.getElementById('std'), before: antes, depth: 0, kind: 'folder', initial: '', validate: () => ({ ok: true }), commit: vi.fn() });
        expect(primeiro.onClose).toHaveBeenCalled();
        expect(antes.previousElementSibling.classList.contains('tree-inline-edit')).toBe(true);
    });

    it('o icone acompanha o que se digita: pasta, fonte de processador, arquivo', () => {
        const pasta = crud._mountInline({ mountEl: document.getElementById('std'), depth: 0, kind: 'folder', initial: '', validate: () => ({ ok: true }), commit: vi.fn() });
        const icone = () => document.querySelector('.tree-inline-edit .file-item-icon');
        expect(icone().style.backgroundImage).toContain('url(');
        const arq = crud._mountInline({ mountEl: document.getElementById('std'), depth: 0, kind: 'file', initial: '', validate: () => ({ ok: true }), commit: vi.fn() });
        digitar(arq, 'proc.cmm');
        expect(icone().style.backgroundImage).toBe('');
        digitar(arq, 'top.v');
        expect(icone().style.backgroundImage).toContain('url(');
        expect(pasta.isConnected).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────── criar
describe('criar', () => {
    const criar = async (dir, kind, nome) => {
        await crud.startCreate(dir, kind);
        const input = document.querySelector('.tree-inline-input');
        input.value = nome;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await vi.waitFor(() => expect(document.querySelector('.tree-inline-input')).toBeNull());
        await esperar();
    };

    it('arquivo na raiz: grava, entra na pilha, seleciona, abre, avisa quem classifica e notifica', async () => {
        const ouvinte = vi.fn();
        window.addEventListener('aurora:file-created', ouvinte);
        api.fileExists.mockResolvedValue(false);
        const sel = vi.spyOn(crud, 'select');
        await criar(R, 'file', 'novo.v');
        expect(api.writeFile).toHaveBeenCalledWith(P('novo.v'), '');
        expect(crud.history.podeDesfazer()).toBe(true);
        expect(renderer.render).toHaveBeenCalled();
        expect(sel).toHaveBeenCalledWith(P('novo.v'));
        expect(TabManager.addTab).toHaveBeenCalledWith(P('novo.v'), '');
        expect(ouvinte.mock.calls[0][0].detail).toEqual({ path: P('novo.v'), kind: 'file' });
        expect(showCardNotification).toHaveBeenCalledWith('Created "novo.v"', 'success', 2000);
        window.removeEventListener('aurora:file-created', ouvinte);
    });

    it('pasta com caminho aninhado: cria e deixa aberta cada pasta do meio e a nova', async () => {
        api.fileExists.mockResolvedValue(false);
        await criar(R, 'folder', 'a/b');
        expect(api.createDirectory).toHaveBeenCalledWith(P('a\\b'));
        expect([...renderer._expanded]).toEqual([P('a'), P('a\\b')]);
        expect(TabManager.addTab).not.toHaveBeenCalled();
    });

    it('dentro de uma pasta fechada: abre a pasta e poe o campo dentro dela, um nivel abaixo', async () => {
        arvore([['src', true, 1]]);
        await crud.startCreate(P('src'), 'file');
        expect(renderer._expanded.has(P('src'))).toBe(true);
        const edit = linha('src').querySelector('.folder-content > .tree-inline-edit');
        expect(edit.style.getPropertyValue('--depth')).toBe('2');
    });

    it('pasta ja aberta nao redesenha; sem a caixa dos filhos, desiste; sem container ou pasta, nada', async () => {
        arvore([['src', true], ['a.v', false]]);
        renderer._expanded.add(P('src'));
        await crud.startCreate(P('src'), 'file');
        expect(renderer.render).not.toHaveBeenCalled();
        crud._cancelInline();
        await crud.startCreate(P('a.v'), 'file');
        await crud.startCreate(P('sumiu'), 'file');
        await crud.startCreate('', 'file');
        document.getElementById('std').remove();
        await crud.startCreate(R, 'file');
        expect(document.querySelector('.tree-inline-edit')).toBeNull();
    });

    it('nome que ja existe no disco avisa e nao grava; falha ao gravar vira erro', async () => {
        await criar(R, 'file', 'x.v');
        expect(showCardNotification).toHaveBeenCalledWith('A file or folder with this name already exists here.', 'warning', 3000);
        expect(api.writeFile).not.toHaveBeenCalled();
        api.fileExists.mockResolvedValue(false);
        api.writeFile.mockRejectedValueOnce(new Error('disco cheio'));
        await criar(R, 'file', 'y.v');
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not create: disco cheio', 'error', 4000);
        api.writeFile.mockRejectedValueOnce('cru');
        await criar(R, 'file', 'z.v');
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not create: cru', 'error', 4000);
    });

    it('nome igual a um irmao e barrado no campo', async () => {
        api.getFolderFiles.mockResolvedValue([{ name: 'a.v' }]);
        await crud.startCreate(R, 'file');
        const input = document.querySelector('.tree-inline-input');
        input.value = 'a.v';
        input.dispatchEvent(new Event('input'));
        expect(document.querySelector('.tree-inline-error').textContent).toContain('already exists');
    });

    it('cada regra de nome tem a sua mensagem', async () => {
        arvore([['a.v', false]]);
        await crud.startRename(P('a.v'));
        const input = document.querySelector('.tree-inline-input');
        const erro = (v) => {
            input.value = v;
            input.dispatchEvent(new Event('input'));
            return document.querySelector('.tree-inline-error').textContent;
        };
        expect(erro('')).toBe('A file or folder name must be provided.');
        expect(erro(' a')).toBe('Leading or trailing whitespace detected in the name.');
        expect(erro('a/b')).toBe('The name contains invalid path separators.');
        expect(erro('con')).toBe('This name is reserved by the operating system.');
        expect(erro('..')).toBe('"." and ".." are not valid names.');
        expect(erro('a.')).toBe('Names cannot end with a dot or a space.');
    });

    it('o evento de criado que falha nao derruba o resto', async () => {
        api.fileExists.mockResolvedValue(false);
        vi.stubGlobal('CustomEvent', function () { throw new Error('x'); });
        try { await criar(R, 'file', 'w.v'); } finally { vi.unstubAllGlobals(); }
        expect(showCardNotification).toHaveBeenLastCalledWith('Created "w.v"', 'success', 2000);
    });
});

// ─────────────────────────────────────────────────────────────── renomear
describe('renomear', () => {
    beforeEach(() => arvore([['src', true, 1], ['src\\b.v', false, 2], ['a.v', false, 1]]));

    it('abre o campo na propria linha, com o nome sem a extensao selecionado', async () => {
        await crud.startRename(P('a.v'));
        const input = document.querySelector('.tree-inline-input');
        expect(input.value).toBe('a.v');
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
        expect(linha('a.v').classList.contains('hidden-during-rename')).toBe(true);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(linha('a.v').classList.contains('hidden-during-rename')).toBe(false);
    });

    it('pasta seleciona o nome inteiro; pasta de processador e recusada; linha que sumiu, nada', async () => {
        await crud.startRename(P('src'));
        const input = document.querySelector('.tree-inline-input');
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
        crud._cancelInline();
        spf.cfg = { processors: [{ name: 'src' }] };
        respostas = ['ok'];
        await crud.startRename(P('src'));
        expect(document.querySelector('.tree-inline-input')).toBeNull();
        await crud.startRename(P('sumiu.v'));
        expect(document.querySelector('.tree-inline-input')).toBeNull();
    });

    it('confirmar com o mesmo nome nao faz nada; com outro, renomeia', async () => {
        const perf = vi.spyOn(crud, '_performRename').mockResolvedValue(undefined);
        await crud.startRename(P('a.v'));
        let input = document.querySelector('.tree-inline-input');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await esperar();
        expect(perf).not.toHaveBeenCalled();
        await crud.startRename(P('a.v'));
        input = document.querySelector('.tree-inline-input');
        input.value = 'z.v';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await esperar();
        expect(perf).toHaveBeenCalledWith({ path: P('a.v'), isDir: false, name: 'a.v' }, 'C:/p\\z.v');
    });

    it('renomear migra as abas com o lugar do cursor, a expansao, o .spf, a pilha e a selecao', async () => {
        TabManager.tabs = new Map([[P('src\\b.v'), {}]]);
        TabManager.activeTab = P('src\\b.v');
        const vista = { cursor: 7 };
        EditorManager.getEditorForFile = vi.fn(() => ({ saveViewState: () => vista }));
        renderer._expanded = new Set([P('src'), P('src\\in'), P('outra')]);
        spf.cfg = { topLevelFile: P('src\\b.v') };
        crud.clipboard = { items: [{ path: P('src') }], cut: true };
        const sel = vi.spyOn(crud, 'select');
        await crud._performRename({ path: P('src'), isDir: true, name: 'src' }, P('rtl'));
        expect(api.renamePath).toHaveBeenCalledWith(P('src'), P('rtl'));
        expect(TabManager.addTab).toHaveBeenCalledWith(P('rtl\\b.v'), 'conteudo', { viewState: vista });
        expect(TabManager.activateTab).toHaveBeenCalledWith(P('rtl\\b.v'));
        expect([...renderer._expanded].sort()).toEqual([P('outra'), P('rtl'), P('rtl\\in')]);
        expect(spf.cfg.topLevelFile).toBe(P('rtl\\b.v'));
        expect(crud.history.feito).toEqual([{ kind: 'move', de: P('src'), para: P('rtl') }]);
        expect(crud.clipboard).toBeNull();
        expect(sel).toHaveBeenCalledWith(P('rtl'));
    });

    it('aba que nao reabre fica no console; sem estado de vista, abre sem ele', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        TabManager.tabs = new Map([[P('a.v'), {}]]);
        api.readFile.mockRejectedValueOnce(new Error('x'));
        await crud._performRename({ path: P('a.v'), isDir: false, name: 'a.v' }, P('b.v'));
        expect(erro).toHaveBeenCalled();
        TabManager.tabs = new Map([[P('b.v'), {}]]);
        await crud._performRename({ path: P('b.v'), isDir: false, name: 'b.v' }, P('c.v'));
        expect(TabManager.addTab).toHaveBeenLastCalledWith(P('c.v'), 'conteudo', {});
        expect(TabManager.activateTab).not.toHaveBeenCalled();
    });

    it('aba suja pergunta: cancelar para; salvar e renomear salva antes; falha ao salvar para', async () => {
        TabManager.tabs = new Map([[P('a.v'), {}]]);
        TabManager.unsavedChanges = new Set([P('a.v')]);
        const entrada = { path: P('a.v'), isDir: false, name: 'a.v' };
        respostas = ['cancel'];
        await crud._performRename(entrada, P('b.v'));
        expect(dialog.mock.calls[0][0].message).toBe('1 open file(s) have unsaved changes. They will be saved before renaming.');
        respostas = ['go'];
        TabManager.saveFile.mockResolvedValueOnce(false);
        await crud._performRename(entrada, P('b.v'));
        expect(api.renamePath).not.toHaveBeenCalled();
        respostas = ['go'];
        await crud._performRename(entrada, P('b.v'));
        expect(TabManager.saveFile).toHaveBeenLastCalledWith(P('a.v'));
        expect(api.renamePath).toHaveBeenCalled();
    });

    it('nome ocupado pergunta se substitui; falha avisa com o motivo', async () => {
        const entrada = { path: P('a.v'), isDir: false, name: 'a.v' };
        api.renamePath.mockResolvedValueOnce({ success: false, code: 'EEXIST' });
        respostas = ['cancel'];
        await crud._performRename(entrada, P('b.v'));
        expect(api.renamePath).toHaveBeenCalledTimes(1);
        api.renamePath.mockResolvedValueOnce({ success: false, code: 'EEXIST' });
        respostas = ['replace'];
        await crud._performRename(entrada, P('b.v'));
        expect(api.renamePath).toHaveBeenLastCalledWith(P('a.v'), P('b.v'), { overwrite: true });
        api.renamePath.mockResolvedValueOnce({ success: false, error: 'travado' });
        await crud._performRename(entrada, P('b.v'));
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not rename: travado', 'error', 4000);
        // Sem motivo na resposta, a mensagem diz isso, em vez de um "unknown" solto.
        api.renamePath.mockResolvedValueOnce({ success: false });
        await crud._performRename(entrada, P('b.v'));
        expect(showCardNotification.mock.lastCall[0]).toMatch(/^Could not rename: a API respondeu sem dizer o erro/);
    });
});

// ────────────────────────────────────────────────────────────────── apagar
describe('apagar', () => {
    beforeEach(() => arvore([['src', true], ['src\\b.v', false], ['a.v', false], ['c.v', false]]));

    it('um arquivo: pergunta, guarda na espera, entra na pilha, tira do .spf e da tela', async () => {
        spf.cfg = { topLevelFile: P('a.v') };
        crud.selectMany([P('a.v'), P('c.v')]);
        crud._anchor = P('a.v');
        crud.clipboard = { items: [{ path: P('a.v') }], cut: false };
        respostas = ['delete'];
        await crud.deleteEntry(P('a.v'));
        const pedido = dialog.mock.calls[0][0];
        expect(pedido.title).toBe('Delete');
        expect(pedido.message).toBe('Delete "a.v"?\nCtrl+Z undoes this. Afterwards it goes to the Recycle Bin.');
        expect(api.undoStage).toHaveBeenCalledWith(P('a.v'));
        expect(crud.history.feito).toEqual([{ kind: 'existence', caminho: P('a.v'), presente: false, token: `tok:${P('a.v')}` }]);
        expect(spf.cfg.topLevelFile).toBe('');
        expect(crud.selectedPaths).toEqual([P('c.v')]);
        expect(crud._anchor).toBeNull();
        expect(crud.clipboard).toBeNull();
        expect(showCardNotification).toHaveBeenLastCalledWith('Deleted "a.v"', 'success', 2000);
    });

    it('varios: uma pergunta so, com abas abertas e sujas, um grupo na pilha, e a expansao limpa', async () => {
        TabManager.tabs = new Map([[P('src\\b.v'), {}], [P('a.v'), {}]]);
        TabManager.unsavedChanges = new Set([P('a.v')]);
        renderer._expanded = new Set([P('src'), P('src\\x'), P('outra')]);
        respostas = ['delete'];
        await crud.deleteEntries([P('src'), P('src\\b.v'), P('a.v'), null]);
        expect(dialog.mock.calls[0][0].message).toBe(
            'Delete these 2 items and everything inside them?\n2 open editor(s) will be closed.\n'
            + 'Unsaved changes in 1 file(s) will be LOST.\nCtrl+Z undoes this. Afterwards it goes to the Recycle Bin.');
        expect(TabManager.closeTab).toHaveBeenCalledTimes(2);
        expect(TabManager.unsavedChanges.size).toBe(0);
        expect(crud.history.feito).toHaveLength(1);
        expect(crud.history.feito[0].kind).toBe('grupo');
        expect([...renderer._expanded]).toEqual([P('outra')]);
        expect(showCardNotification).toHaveBeenLastCalledWith('Deleted 2 items', 'success', 2000);
    });

    it('pasta: a mensagem diz que leva o conteudo; permanente nao passa pela espera nem pela pilha', async () => {
        respostas = ['delete'];
        await crud.deleteEntries([P('src')], { permanent: true });
        const pedido = dialog.mock.calls[0][0];
        expect(pedido.title).toBe('Delete Permanently');
        expect(pedido.message).toBe('Delete "src" and all its contents?');
        expect(pedido.buttons[1].label).toBe('Delete Permanently');
        expect(api.deleteFileOrDirectory).toHaveBeenCalledWith(P('src'));
        expect(api.undoStage).not.toHaveBeenCalled();
        expect(crud.history.podeDesfazer()).toBe(false);
    });

    it('caminho fora da tela vira arquivo pelo nome; cancelar nao apaga; nada, nada', async () => {
        respostas = ['cancel'];
        await crud.deleteEntries([P('fora.v')]);
        expect(dialog.mock.calls[0][0].message).toContain('Delete "fora.v"?');
        expect(api.undoStage).not.toHaveBeenCalled();
        await crud.deleteEntries([]);
        await crud.deleteEntries(null);
        expect(dialog).toHaveBeenCalledTimes(1);
    });

    it('pasta de processador e recusada antes de perguntar', async () => {
        spf.cfg = { processors: [{ name: 'src' }] };
        respostas = ['ok'];
        await crud.deleteEntries([P('src')]);
        expect(dialog).toHaveBeenCalledTimes(1);
        expect(api.undoStage).not.toHaveBeenCalled();
    });

    it('permanente que falha avisa e nao conta como apagado', async () => {
        api.deleteFileOrDirectory.mockRejectedValueOnce(new Error('em uso'));
        respostas = ['delete'];
        await crud.deleteEntries([P('a.v')], { permanent: true });
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not delete: em uso', 'error', 4000);
        expect(renderer.render).not.toHaveBeenCalled();
    });

    it('sem a espera: oferece apagar de vez; aceitar apaga, e falhar avisa', async () => {
        api.undoStage.mockResolvedValue({ success: false, error: 'rede' });
        respostas = ['delete', 'perm'];
        await crud.deleteEntries([P('a.v')]);
        expect(dialog.mock.calls[1][0].message).toBe('Could not stage the deletion (rede). Delete permanently instead?');
        expect(api.deleteFileOrDirectory).toHaveBeenCalledWith(P('a.v'));
        expect(crud.history.podeDesfazer()).toBe(false);
        api.deleteFileOrDirectory.mockRejectedValueOnce(new Error('negado'));
        respostas = ['delete', 'perm'];
        await crud.deleteEntries([P('c.v')]);
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not delete: negado', 'error', 4000);
    });

    it('sem a espera, recusar apagar de vez desiste do gesto inteiro', async () => {
        api.undoStage.mockResolvedValueOnce({ success: false });
        respostas = ['delete', 'cancel'];
        await crud.deleteEntries([P('a.v'), P('c.v')]);
        expect(api.undoStage).toHaveBeenCalledTimes(1);
        expect(renderer.render).not.toHaveBeenCalled();
    });
});

// ──────────────────────────────────────────────────────────── copiar e colar
describe('copiar e colar', () => {
    beforeEach(() => arvore([['src', true], ['src\\b.v', false], ['a.v', false], ['dst', true]]));

    it('copiar guarda os itens da selecao, com o tipo da linha, e marca o recorte', () => {
        crud.copy([P('src'), P('fora.v'), null], true);
        expect(crud.clipboard).toEqual({
            items: [{ path: P('src'), isDir: true, name: 'src' }, { path: P('fora.v'), isDir: false, name: 'fora.v' }],
            cut: true,
        });
        crud.copy([], false);
        expect(crud.clipboard.cut).toBe(true);
        crud.copy(P('a.v'));
        expect(crud.clipboard).toEqual({ items: [{ path: P('a.v'), isDir: false, name: 'a.v' }], cut: false });
    });

    it('colar sem clipboard, sem destino ou sem projeto nao faz nada', async () => {
        await crud.paste(R);
        crud.copy(P('a.v'), false);
        await crud.paste('');
        ProjectStore.clearProject();
        await crud.paste(R);
        expect(api.copyAnyPath).not.toHaveBeenCalled();
    });

    it('copiar para outra pasta: copia, entra na pilha como criado, seleciona o novo', async () => {
        crud.copy([P('a.v'), P('src')], false);
        const sel = vi.spyOn(crud, 'selectMany');
        await crud.paste(P('dst'));
        expect(api.copyAnyPath).toHaveBeenCalledWith(P('a.v'), P('dst\\a.v'), { overwrite: false });
        expect(api.copyAnyPath).toHaveBeenCalledWith(P('src'), P('dst\\src'), { overwrite: false });
        expect(renderer._expanded.has(P('dst\\src'))).toBe(true);
        expect(crud.history.feito[0]).toEqual({ kind: 'grupo', ops: [
            { kind: 'existence', caminho: P('dst\\a.v'), presente: true, token: null },
            { kind: 'existence', caminho: P('dst\\src'), presente: true, token: null },
        ] });
        expect(sel).toHaveBeenCalledWith([P('dst\\a.v'), P('dst\\src')]);
        expect(crud.clipboard).not.toBeNull();
    });

    it('colar na mesma pasta duplica com o sufixo, e o segundo ve o nome do primeiro', async () => {
        api.getFolderFiles.mockResolvedValue([{ name: 'a.v' }]);
        crud.copy([P('a.v')], false);
        await crud.paste(R);
        await crud.paste(R);
        expect(api.copyAnyPath.mock.calls.map((c) => c[1])).toEqual([P('a copy.v'), P('a copy.v')]);
    });

    it('recortar: salva o que esta sujo, move, migra abas, anota o .spf, e esvazia o clipboard', async () => {
        TabManager.tabs = new Map([[P('a.v'), {}]]);
        TabManager.unsavedChanges = new Set([P('a.v')]);
        spf.cfg = { topLevelFile: P('a.v') };
        crud.copy([P('a.v')], true);
        await crud.paste(P('dst'));
        expect(TabManager.saveFile).toHaveBeenCalledWith(P('a.v'));
        expect(api.renamePath).toHaveBeenCalledWith(P('a.v'), P('dst\\a.v'), { overwrite: false });
        expect(TabManager.addTab).toHaveBeenCalledWith(P('dst\\a.v'), 'conteudo', {});
        expect(spf.cfg.topLevelFile).toBe(P('dst\\a.v'));
        expect(crud.history.feito[0]).toEqual({ kind: 'move', de: P('a.v'), para: P('dst\\a.v') });
        expect(crud.clipboard).toBeNull();
    });

    it('recortar para a propria pasta nao faz nada; salvar que falha desiste', async () => {
        api.getFolderFiles.mockResolvedValue([{ name: 'a.v' }]);
        crud.copy([P('a.v')], true);
        await crud.paste(R);
        expect(api.renamePath).not.toHaveBeenCalled();
        api.getFolderFiles.mockResolvedValue([]);
        TabManager.tabs = new Map([[P('a.v'), {}]]);
        TabManager.unsavedChanges = new Set([P('a.v')]);
        TabManager.saveFile.mockResolvedValueOnce(false);
        crud.copy([P('a.v')], true);
        await crud.paste(P('dst'));
        expect(api.renamePath).not.toHaveBeenCalled();
    });

    it('pasta nao entra em si mesma nem na propria subarvore', async () => {
        crud.copy([P('src')], false);
        await crud.paste(P('src'));
        await crud.paste(P('src\\in'));
        expect(showCardNotification).toHaveBeenCalledWith('Cannot paste a folder into itself.', 'warning', 3000);
        expect(api.copyAnyPath).not.toHaveBeenCalled();
    });

    it('origem que sumiu avisa uma vez no fim', async () => {
        api.fileExists.mockResolvedValue(false);
        crud.copy([P('a.v')], false);
        await crud.paste(P('dst'));
        expect(showCardNotification).toHaveBeenCalledWith('The copied item no longer exists.', 'warning', 3000);
    });

    it('conflito em outra pasta pergunta: manter os dois, substituir, ou cancelar tudo', async () => {
        api.getFolderFiles.mockResolvedValue([{ name: 'A.V' }]);
        crud.copy([P('a.v')], false);
        respostas = ['keep'];
        await crud.paste(P('dst'));
        expect(dialog.mock.calls[0][0].buttons.map((b) => b.action)).toEqual(['cancel', 'keep', 'replace']);
        expect(api.copyAnyPath).toHaveBeenLastCalledWith(P('a.v'), P('dst\\a copy.v'), { overwrite: false });
        respostas = ['replace'];
        await crud.paste(P('dst'));
        expect(api.copyAnyPath).toHaveBeenLastCalledWith(P('a.v'), P('dst\\a.v'), { overwrite: true });
        // Substituir nao se desfaz: o que estava ali ja se foi.
        expect(crud.history.feito).toHaveLength(1);
        api.copyAnyPath.mockClear();
        crud.copy([P('a.v'), P('src')], false);
        respostas = ['cancel'];
        await crud.paste(P('dst'));
        expect(api.copyAnyPath).not.toHaveBeenCalled();
    });

    it('conflito ao recortar nao oferece manter os dois', async () => {
        api.getFolderFiles.mockResolvedValue([{ name: 'a.v' }]);
        crud.copy([P('a.v')], true);
        respostas = ['replace'];
        await crud.paste(P('dst'));
        expect(dialog.mock.calls[0][0].buttons.map((b) => b.action)).toEqual(['cancel', 'replace']);
        expect(api.renamePath).toHaveBeenCalledWith(P('a.v'), P('dst\\a.v'), { overwrite: true });
    });

    it('mover ou copiar que falha avisa com o motivo', async () => {
        api.renamePath.mockResolvedValueOnce({ success: false, error: 'travado' });
        crud.copy([P('a.v')], true);
        await crud.paste(P('dst'));
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not move: travado', 'error', 4000);
        api.copyAnyPath.mockResolvedValueOnce({ success: false, error: 'cheio' });
        crud.copy([P('a.v')], false);
        await crud.paste(P('dst'));
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not copy: cheio', 'error', 4000);
        expect(crud.history.podeDesfazer()).toBe(false);
    });
});

// ──────────────────────────────────────────────────────── desfazer e refazer
describe('desfazer e refazer', () => {
    beforeEach(() => arvore([['a.v', false], ['b.v', false]]));

    it('sem nada na pilha, avisa', async () => {
        await crud.desfazer();
        expect(showCardNotification).toHaveBeenLastCalledWith('Nothing to undo.', 'info', 1800);
        await crud.refazer();
        expect(showCardNotification).toHaveBeenLastCalledWith('Nothing to redo.', 'info', 1800);
    });

    it('desfazer um renomear move de volta, redesenha e seleciona; refazer move de novo', async () => {
        crud.history.registrar({ kind: 'move', de: P('a.v'), para: P('z.v') });
        await crud.desfazer();
        expect(api.renamePath).toHaveBeenLastCalledWith(P('z.v'), P('a.v'));
        expect(renderer.render).toHaveBeenCalled();
        expect(crud.selectedPath).toBe(P('a.v'));
        await crud.refazer();
        expect(api.renamePath).toHaveBeenLastCalledWith(P('a.v'), P('z.v'));
    });

    it('o que deixou de existir nao fica selecionado', async () => {
        crud.select(P('b.v'));
        crud.history.registrar({ kind: 'move', de: P('a.v'), para: P('z.v') });
        api.fileExists.mockResolvedValue(false);
        await crud.desfazer();
        expect(crud.selectedPath).toBeNull();
    });

    it('falha ao desfazer avisa com o motivo', async () => {
        crud.history.registrar({ kind: 'move', de: P('a.v'), para: P('z.v') });
        api.renamePath.mockResolvedValue({ success: false });
        await crud.desfazer();
        expect(showCardNotification).toHaveBeenLastCalledWith('Could not undo: nao foi possivel mover de volta', 'error', 4000);
    });

    it('desfazer um apagar restaura da espera e devolve ao .spf o que ele tinha', async () => {
        spf.cfg = { topLevelFile: P('a.v') };
        respostas = ['delete'];
        await crud.deleteEntries([P('a.v')]);
        expect(spf.cfg.topLevelFile).toBe('');
        await crud.desfazer();
        expect(api.undoRestore).toHaveBeenCalledWith(`tok:${P('a.v')}`, P('a.v'));
        expect(spf.cfg.topLevelFile).toBe(P('a.v'));
    });

    it('refazer um apagar fecha as abas e guarda de novo; falha ao guardar nao anota o .spf', async () => {
        TabManager.tabs = new Map([[P('a.v'), {}]]);
        TabManager.unsavedChanges = new Set([P('a.v')]);
        expect(await crud.history.exec.guardar(P('a.v'))).toBe(`tok:${P('a.v')}`);
        expect(TabManager.closeTab).toHaveBeenCalledWith(P('a.v'));
        api.undoStage.mockResolvedValueOnce({ success: false });
        SpfStore.update.mockClear();
        expect(await crud.history.exec.guardar(P('a.v'))).toBeNull();
        expect(SpfStore.update).not.toHaveBeenCalled();
    });

    it('restaurar que falha nao repoe o .spf; descartar vai para a ponte', async () => {
        api.undoRestore.mockResolvedValueOnce({ success: false });
        expect(await crud.history.exec.restaurar('t', P('a.v'))).toBe(false);
        await crud.history.exec.descartar('t9');
        expect(api.undoDiscard).toHaveBeenCalledWith('t9');
    });
});
