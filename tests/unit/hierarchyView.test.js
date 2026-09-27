// @vitest-environment happy-dom
//
// A vista hierarquica da arvore de arquivos: os modulos que o Yosys achou,
// desenhados de uma vez (recolher e expandir e so CSS), com o arquivo em foco
// destacado e o clique abrindo o fonte do modulo na linha dele.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/tabs/tab_manager.js', () => ({
    TabManager: { addTab: vi.fn() },
}));
vi.mock('../../js/editor/monaco_editor.js', () => ({
    EditorManager: { getEditorForFile: vi.fn() },
}));

import { TabManager } from '../../js/tabs/tab_manager.js';
import { EditorManager } from '../../js/editor/monaco_editor.js';
import { renderHierarchy, refreshHierarchyFocusHighlight } from '../../js/compilation/hierarchy_view.js';

const FILTRO = 'C:/proj/Hardware/filtro.v';
const SOMA = 'C:\\proj\\Hardware\\soma.v';

// Topo com duas instancias fora de ordem, uma com nome igual ao modulo, e uma
// folha sem arquivo.
const ARVORE = {
    name: 'filtro', filePath: FILTRO, lineNumber: 3,
    children: [
        {
            instanceName: 'u_soma', type: 'instance',
            moduleDefinition: {
                name: 'soma', filePath: SOMA, lineNumber: null,
                children: [{ instanceName: 'gerado', type: 'instance', moduleDefinition: { name: 'gerado', filePath: null, children: [] } }],
            },
        },
        {
            instanceName: 'a_reg', type: 'instance',
            moduleDefinition: { name: 'a_reg', filePath: null, lineNumber: null, children: [] },
        },
    ],
};

let host;
let api;
beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    window.treeView = { getContainer: vi.fn((nome) => (nome === 'hierarchy' ? host : null)) };
    window.TabManager = { getEditingFilePath: vi.fn(() => ''), getFileIcon: vi.fn((n) => `icone-${n}`) };
    api = {
        fileExists: vi.fn(async () => true),
        readFile: vi.fn(async () => 'module filtro; endmodule'),
    };
    window.electronAPI = api;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    host.remove();
    delete window.treeView;
    delete window.TabManager;
    delete window.fileTreeViewController;
    delete window.electronAPI;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

const itens = () => [...host.querySelectorAll('.hierarchy-item')];
const rotulos = () => itens().map((i) => i.querySelector('.hierarchy-label').textContent);
const clicar = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('o desenho', () => {
    it('topo aberto, filhos em ordem de instancia, rotulo com o modulo quando o nome difere', () => {
        renderHierarchy(ARVORE);

        expect(rotulos()).toEqual(['filtro', 'a_reg', 'u_soma (soma)', 'gerado']);
        const [topo, aReg, soma, gerado] = itens();
        expect(topo.getAttribute('data-type')).toBe('top-level');
        expect(aReg.getAttribute('data-type')).toBe('module');
        expect(topo.querySelector('.hierarchy-toggle').classList.contains('expanded')).toBe(true);
        expect(topo.querySelector('.hierarchy-children').className).toBe('hierarchy-children expanded');
        expect(soma.querySelector('.hierarchy-children').className).toBe('hierarchy-children collapsed');
        // Folha tem espaco no lugar do botao de abrir.
        expect(aReg.querySelector('.hierarchy-toggle')).toBeNull();
        expect(aReg.querySelector('.hierarchy-spacer')).not.toBeNull();
        // O icone e o da aba quando o modulo tem arquivo; o de reserva, quando nao.
        expect(topo.querySelector('.hierarchy-icon').innerHTML).toBe('<i class="icone-filtro.v"></i>');
        expect(soma.querySelector('.hierarchy-icon').innerHTML).toBe('<i class="icone-soma.v"></i>');
        expect(gerado.querySelector('.hierarchy-icon').innerHTML).toBe('<i class="ph ph-tree-structure"></i>');
        expect(topo.getAttribute('data-filepath')).toBe(FILTRO);
        expect(topo.getAttribute('data-linenumber')).toBe('3');
        expect(soma.hasAttribute('data-linenumber')).toBe(false);
        expect(topo.querySelector('.hierarchy-item-content').title).toBe('Click to open filtro.v');
        expect(aReg.querySelector('.hierarchy-item-content').title).toBe('');
    });

    it('sem o icone da aba, o topo usa o de reserva', () => {
        delete window.TabManager.getFileIcon;
        renderHierarchy(ARVORE);
        expect(itens()[0].querySelector('.hierarchy-icon').innerHTML).toBe('<i class="ph ph-cpu"></i>');
    });

    it('os mesmos dados de novo nao redesenham, o que preserva o que estava aberto', () => {
        renderHierarchy(ARVORE);
        const antes = host.querySelector('.hierarchy-container');
        renderHierarchy(ARVORE);
        expect(host.querySelector('.hierarchy-container')).toBe(antes);

        renderHierarchy({ ...ARVORE });
        expect(host.querySelector('.hierarchy-container')).not.toBe(antes);
    });

    it('sem dados, usa os do controlador da arvore; sem nenhum, nao desenha', () => {
        window.fileTreeViewController = { getHierarchyData: () => ARVORE };
        renderHierarchy();
        expect(rotulos()[0]).toBe('filtro');

        host.innerHTML = '';
        host.__auroraHierarchyData = undefined;
        window.fileTreeViewController = {};
        renderHierarchy(null);
        expect(host.innerHTML).toBe('');
    });

    it('sem a arvore de arquivos, nao faz nada', () => {
        window.treeView = { getContainer: () => null };
        expect(() => renderHierarchy(ARVORE)).not.toThrow();
        delete window.treeView;
        expect(() => renderHierarchy(ARVORE)).not.toThrow();
        expect(() => refreshHierarchyFocusHighlight()).not.toThrow();
    });

    it('hierarquia enorme fica registrada no console', () => {
        const filhos = Array.from({ length: 2001 }, (_, i) => ({
            instanceName: `u${i}`, type: 'instance', moduleDefinition: { name: 'm', filePath: null, children: [] },
        }));
        renderHierarchy({ name: 'grande', filePath: null, children: filhos });
        expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[aurora-tree\] large hierarchy: 2002 modules/));
    });

    it('filhos sem nome de instancia vao na frente, sem quebrar a ordem', () => {
        renderHierarchy({
            name: 't', filePath: null,
            children: [
                { instanceName: 'b', moduleDefinition: { name: 'b', children: [] } },
                { instanceName: '', moduleDefinition: { name: 'x', children: [] } },
            ],
        });
        expect(rotulos()).toEqual(['t', ' (x)', 'b']);
    });
});

describe('o destaque do arquivo em foco', () => {
    it('marca a linha do arquivo aberto, sem ligar para barra nem caixa', () => {
        renderHierarchy(ARVORE);
        window.TabManager.getEditingFilePath.mockReturnValue('c:/PROJ/hardware/SOMA.v');
        refreshHierarchyFocusHighlight();
        expect(itens().filter((i) => i.classList.contains('active')).map((i) => i.getAttribute('data-filepath')))
            .toEqual([SOMA]);

        window.TabManager.getEditingFilePath.mockReturnValue('');
        refreshHierarchyFocusHighlight();
        expect(itens().some((i) => i.classList.contains('active'))).toBe(false);
    });

    it('sem o gerenciador de abas, ninguem fica destacado', () => {
        renderHierarchy(ARVORE);
        delete window.TabManager;
        refreshHierarchyFocusHighlight();
        expect(itens().some((i) => i.classList.contains('active'))).toBe(false);
    });
});

describe('os cliques', () => {
    it('o botao de abrir alterna a subarvore sem abrir o arquivo', () => {
        renderHierarchy(ARVORE);
        const soma = itens()[2];
        const botao = soma.querySelector('.hierarchy-toggle');

        clicar(botao);
        expect(soma.querySelector('.hierarchy-children').className).toBe('hierarchy-children expanded');
        expect(botao.classList.contains('expanded')).toBe(true);
        clicar(botao);
        expect(soma.querySelector('.hierarchy-children').className).toBe('hierarchy-children collapsed');
        expect(api.fileExists).not.toHaveBeenCalled();
    });

    it('clicar no modulo abre o fonte e leva o editor a linha', async () => {
        const editor = {
            getModel: () => ({ getLineCount: () => 10, getLineMaxColumn: () => 7 }),
            setPosition: vi.fn(), revealLineInCenter: vi.fn(), focus: vi.fn(), setSelection: vi.fn(),
        };
        EditorManager.getEditorForFile.mockReturnValue(editor);
        renderHierarchy(ARVORE);

        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(100);

        expect(api.readFile).toHaveBeenCalledWith(FILTRO, { encoding: 'utf8' });
        expect(TabManager.addTab).toHaveBeenCalledWith(FILTRO, 'module filtro; endmodule');
        expect(EditorManager.getEditorForFile).toHaveBeenCalledWith(FILTRO);
        expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 1 });
        expect(editor.revealLineInCenter).toHaveBeenCalledWith(3);
        expect(editor.focus).toHaveBeenCalled();
        expect(editor.setSelection).toHaveBeenCalledWith({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 7 });
    });

    it('linha alem do fim do arquivo vai para a ultima', async () => {
        const editor = {
            getModel: () => ({ getLineCount: () => 2, getLineMaxColumn: () => 1 }),
            setPosition: vi.fn(), revealLineInCenter: vi.fn(), focus: vi.fn(), setSelection: vi.fn(),
        };
        EditorManager.getEditorForFile.mockReturnValue(editor);
        renderHierarchy(ARVORE);
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(100);
        expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 1 });
    });

    it('modulo sem linha abre o arquivo e nao mexe no editor', async () => {
        renderHierarchy(ARVORE);
        clicar(itens()[2].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(100);
        expect(TabManager.addTab).toHaveBeenCalledWith(SOMA, expect.any(String));
        expect(EditorManager.getEditorForFile).not.toHaveBeenCalled();
    });

    it('editor que nao abriu, ou sem modelo: nada acontece', async () => {
        renderHierarchy(ARVORE);
        EditorManager.getEditorForFile.mockReturnValueOnce(null);
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(100);

        const editor = { getModel: () => null, setPosition: vi.fn() };
        EditorManager.getEditorForFile.mockReturnValueOnce(editor);
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(100);
        expect(editor.setPosition).not.toHaveBeenCalled();
    });

    it('arquivo que sumiu: registra e nao abre aba', async () => {
        api.fileExists.mockResolvedValueOnce(false);
        renderHierarchy(ARVORE);
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(0);
        expect(TabManager.addTab).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(`[hierarchy] module file not found: ${FILTRO}`);
    });

    it('leitura que falha: registra e segue', async () => {
        api.readFile.mockRejectedValueOnce(new Error('EACCES'));
        renderHierarchy(ARVORE);
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(0);
        expect(console.error).toHaveBeenCalledWith('Error opening module file:', expect.any(Error));
    });

    it('modulo sem arquivo nao tem clique', async () => {
        renderHierarchy(ARVORE);
        clicar(itens()[1].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(0);
        expect(api.fileExists).not.toHaveBeenCalled();
    });

    it('o atributo de caminho apagado depois do desenho desliga o clique', async () => {
        renderHierarchy(ARVORE);
        itens()[0].removeAttribute('data-filepath');
        clicar(itens()[0].querySelector('.hierarchy-label'));
        await vi.advanceTimersByTimeAsync(0);
        expect(api.fileExists).not.toHaveBeenCalled();
    });

    it('item sem as partes do botao nao alterna', () => {
        renderHierarchy(ARVORE);
        const soma = itens()[2];
        const botao = soma.querySelector('.hierarchy-toggle');
        soma.querySelector('.hierarchy-children').remove();
        expect(() => clicar(botao)).not.toThrow();
    });
});
