// @vitest-environment happy-dom
//
// js/editor/monaco_editor: o boot do Monaco (initMonaco). Carrega o
// editor.main pelo carregador AMD que o loader.js instala no window, registra
// as linguagens e os temas da casa (linguagens_do_editor.ts) e liga as
// integracoes: LSP do Verilog, marcadores da toolchain, formatadores, slang e
// tree-sitter. E idempotente, e a falha do carregador rejeita com o motivo em
// vez de deixar o editor esperando para sempre.
//
// O carregador e o `monaco` global sao falsos; as integracoes viram espioes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const integracoes = vi.hoisted(() => ({
    initVerilogLSP: vi.fn(), ligar: vi.fn(), initClangFormat: vi.fn(),
    initPythonFormat: vi.fn(), initSlang: vi.fn(), initTreeSitter: vi.fn(),
}));
const linguagens = vi.hoisted(() => ({
    setupCMMLanguage: vi.fn(), setupASMLanguage: vi.fn(),
    setupMatlabLanguage: vi.fn(), definirTemasDaAurora: vi.fn(),
}));
vi.mock('../../js/components/aurora-editor.js', () => ({}));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/editor/ai_selection_widget.js', () => ({ attachAiSelectionWidget: () => {} }));
vi.mock('../../js/editor/lsp_integration.js', () => ({ initVerilogLSP: integracoes.initVerilogLSP }));
vi.mock('../../js/terminal/problem_store.js', () => ({ problemStore: { ligar: integracoes.ligar } }));
vi.mock('../../js/editor/clang_format_integration.js', () => ({ initClangFormat: integracoes.initClangFormat }));
vi.mock('../../js/editor/python_format_integration.js', () => ({ initPythonFormat: integracoes.initPythonFormat }));
vi.mock('../../js/editor/slang_integration.js', () => ({ initSlang: integracoes.initSlang }));
vi.mock('../../js/editor/treesitter_highlight.js', () => ({ initTreeSitter: integracoes.initTreeSitter }));
vi.mock('../../js/editor/empty_placeholder.js', () => ({ installEmptyPlaceholder: () => {} }));
vi.mock('../../js/editor/linguagens_do_editor.js', () => linguagens);

/** Carrega o modulo do zero com o carregador AMD que responde como mandado. */
async function carregar(responder = (ok) => ok()) {
    vi.resetModules();
    const mon = { editor: {}, languages: {} };
    globalThis.monaco = mon;
    window.monaco = mon;
    window.require = (deps, ok, falha) => responder(ok, falha, deps);
    const modulo = await import('../../js/editor/monaco_editor.js');
    return { ...modulo, mon };
}

beforeEach(() => {
    Object.values(integracoes).forEach((f) => f.mockClear());
    Object.values(linguagens).forEach((f) => f.mockClear());
});
afterEach(() => {
    delete window.require;
    delete globalThis.monaco;
    delete window.monaco;
});

describe('initMonaco', () => {
    it('carrega o editor.main, registra linguagens e temas no monaco carregado e liga as integracoes', async () => {
        let pedido;
        const { initMonaco, mon } = await carregar((ok, _f, deps) => { pedido = deps; ok(); });
        await initMonaco();
        expect(pedido).toEqual(['vs/editor/editor.main']);
        for (const f of Object.values(linguagens)) expect(f).toHaveBeenCalledWith(mon);
        for (const f of Object.values(integracoes)) expect(f).toHaveBeenCalledTimes(1);
    });

    it('chamado de novo, nao carrega nem registra outra vez', async () => {
        let cargas = 0;
        const { initMonaco } = await carregar((ok) => { cargas += 1; ok(); });
        const p1 = initMonaco();
        const p2 = initMonaco();
        expect(p1).toBe(p2);
        await p1;
        expect(cargas).toBe(1);
        expect(linguagens.setupCMMLanguage).toHaveBeenCalledTimes(1);
    });

    it('o carregador AMD falhando rejeita com o motivo, e nao trava', async () => {
        let { initMonaco } = await carregar((_ok, falha) => falha(new Error('vs ausente')));
        await expect(initMonaco()).rejects.toThrow('vs ausente');

        ({ initMonaco } = await carregar((_ok, falha) => falha({ message: 'quebrado' })));
        await expect(initMonaco()).rejects.toThrow('Monaco AMD load failed: quebrado');

        ({ initMonaco } = await carregar((_ok, falha) => falha('texto')));
        await expect(initMonaco()).rejects.toThrow('Monaco AMD load failed: texto');
        expect(linguagens.setupCMMLanguage).not.toHaveBeenCalled();
    });
});
