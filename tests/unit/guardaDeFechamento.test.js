// @vitest-environment happy-dom
//
// js/tabs/guarda_de_fechamento.ts: fechar a janela nao perde o que nao foi
// salvo.
//
// Achado em 09/10/2026: o x da janela fechava direto. O documento sem nome
// (Untitled-N) vive so na memoria, e uma edicao nao salva de arquivo com nome
// tambem; os dois sumiam sem aviso. Agora o beforeunload segura o fechamento
// quando ha algo nao salvo, pergunta (salvar tudo, descartar, cancelar), e so
// depois fecha pelo canal de sempre.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { arquivosNaoSalvos, decidirFechamento, instalarGuarda } from '../../js/tabs/guarda_de_fechamento.ts';

/** Um TabManager de mentira com o que a guarda le. */
function abas({ abertos = [], sujos = [], semNome = [], binarios = [], split = [] } = {}) {
    const sujo = new Set(sujos);
    window.SharedModelRegistry = { isDirty: (p) => sujo.has(p) };
    window.SplitEditorManager = { panes: [{ tabs: new Map(split.map((p) => [p, {}])) }, null] };
    const tm = {
        tabs: new Map(abertos.map((p) => [p, ''])),
        unsavedChanges: new Set(semNome.filter((p) => !sujo.has(p))),
        isUntitledPath: (p) => p.startsWith('untitled:'),
        isBinaryFile: (p) => binarios.includes(p),
        getDisplayName: (p) => (p.startsWith('untitled:') ? `Untitled-${p.slice(9)}` : p.split('/').pop()),
        saveFile: vi.fn(async (p) => { sujo.delete(p); tm.unsavedChanges.delete(p); return true; }),
    };
    return { tm, sujo };
}

beforeEach(() => {
    delete window.SharedModelRegistry;
    delete window.SplitEditorManager;
    delete window.t;
});

describe('arquivosNaoSalvos', () => {
    it('arquivo com nome conta se esta sujo; sem nome conta se tem texto; binario nunca', () => {
        const { tm } = abas({
            abertos: ['C:/p/a.v', 'C:/p/b.v', 'untitled:1', 'untitled:2', 'C:/p/img.png'],
            sujos: ['C:/p/a.v', 'C:/p/img.png'],
            semNome: ['untitled:2'],
            binarios: ['C:/p/img.png'],
            split: ['C:/p/so_no_split.v'],
        });
        window.SharedModelRegistry.isDirty = (p) => ['C:/p/a.v', 'C:/p/img.png', 'C:/p/so_no_split.v'].includes(p);
        expect(arquivosNaoSalvos(tm)).toEqual([
            { caminho: 'C:/p/a.v', nome: 'a.v' },
            { caminho: 'untitled:2', nome: 'Untitled-2' },
            { caminho: 'C:/p/so_no_split.v', nome: 'so_no_split.v' },
        ]);
    });

    it('sem o registro de modelos ainda, so o que o TabManager sabe; sem split, so a principal', () => {
        const { tm } = abas({ abertos: ['C:/p/a.v', 'untitled:3'], semNome: ['untitled:3'] });
        delete window.SharedModelRegistry;
        delete window.SplitEditorManager;
        expect(arquivosNaoSalvos(tm)).toEqual([{ caminho: 'untitled:3', nome: 'Untitled-3' }]);
    });
});

describe('decidirFechamento', () => {
    const dialogo = (resposta) => vi.fn(async () => resposta);

    it('nada por salvar: fecha sem perguntar', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'] });
        const d = dialogo('cancel');
        expect(await decidirFechamento(tm, d)).toBe('fechar');
        expect(d).not.toHaveBeenCalled();
    });

    it('pergunta listando os arquivos (escapados) e os tres caminhos', async () => {
        const { tm } = abas({ abertos: ['C:/p/<a>.v', 'untitled:1'], sujos: ['C:/p/<a>.v'], semNome: ['untitled:1'] });
        const d = dialogo('cancel');
        expect(await decidirFechamento(tm, d)).toBe('ficar');
        const pedido = d.mock.calls[0][0];
        expect(pedido.message).toContain('&lt;a&gt;.v');
        expect(pedido.message).toContain('Untitled-1');
        expect(pedido.buttons.map((b) => b.action)).toEqual(['cancel', 'discard', 'save-all']);
        expect(pedido.variant).toBe('warning');
    });

    it('lista longa mostra oito e conta o resto', async () => {
        const nomes = Array.from({ length: 11 }, (_, i) => `C:/p/f${i}.v`);
        const { tm } = abas({ abertos: nomes, sujos: nomes });
        const d = dialogo('cancel');
        await decidirFechamento(tm, d);
        const msg = d.mock.calls[0][0].message;
        expect(msg).toContain('f7.v');
        expect(msg).not.toContain('f8.v');
        expect(msg).toContain('+3');
    });

    it('descartar fecha; fechar o dialogo sem escolher fica', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        expect(await decidirFechamento(tm, dialogo('discard'))).toBe('fechar');
        expect(await decidirFechamento(tm, dialogo(undefined))).toBe('ficar');
    });

    it('salvar tudo salva cada um e fecha; um que nao salva (sem nome cancelado) fica', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v', 'untitled:1'], sujos: ['C:/p/a.v'], semNome: ['untitled:1'] });
        expect(await decidirFechamento(tm, dialogo('save-all'))).toBe('fechar');
        expect(tm.saveFile).toHaveBeenCalledWith('C:/p/a.v');
        expect(tm.saveFile).toHaveBeenCalledWith('untitled:1');

        const outro = abas({ abertos: ['untitled:2', 'C:/p/b.v'], semNome: ['untitled:2'], sujos: ['C:/p/b.v'] });
        outro.tm.saveFile = vi.fn(async (p) => p !== 'untitled:2');
        expect(await decidirFechamento(outro.tm, dialogo('save-all'))).toBe('ficar');
        expect(outro.tm.saveFile).toHaveBeenCalledTimes(1);
    });

    it('salvar que lanca, ou que volta sem erro mas deixa sujo: fica', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        tm.saveFile = vi.fn(async () => { throw new Error('disco cheio'); });
        expect(await decidirFechamento(tm, dialogo('save-all'))).toBe('ficar');
        tm.saveFile = vi.fn(async () => true);
        expect(await decidirFechamento(tm, dialogo('save-all'))).toBe('ficar');
    });

    it('traduz quando ha i18n', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        window.t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : `T:${k}`);
        const d = dialogo('cancel');
        await decidirFechamento(tm, d);
        expect(d.mock.calls[0][0].title).toBe('T:dialog.closeWindow.title');
        expect(d.mock.calls[0][0].buttons.map((b) => b.label)).toEqual([
            'T:dialog.common.cancel', 'T:dialog.closeWindow.discard', 'T:dialog.closeWindow.saveAll',
        ]);
    });
});

describe('instalarGuarda', () => {
    /** Dispara o beforeunload como o Chromium faz e devolve o evento. */
    const fecharJanela = () => {
        const e = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e;
    };

    it('sem nada por salvar, deixa fechar', () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'] });
        const api = { windowClose: vi.fn() };
        const tirar = instalarGuarda(tm, api, vi.fn());
        expect(fecharJanela().defaultPrevented).toBe(false);
        tirar();
    });

    it('com algo por salvar, segura, pergunta uma vez so, e fecha depois de decidir', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        const api = { windowClose: vi.fn() };
        let responder;
        const d = vi.fn(() => new Promise((r) => { responder = r; }));
        const tirar = instalarGuarda(tm, api, d);

        const e = fecharJanela();
        expect(e.defaultPrevented).toBe(true);
        expect(e.returnValue).toBe(false);
        fecharJanela(); // segundo clique no x com o dialogo aberto
        expect(d).toHaveBeenCalledTimes(1);

        responder('discard');
        await vi.waitFor(() => expect(api.windowClose).toHaveBeenCalledTimes(1));
        // A janela vai fechar de novo pelo canal; agora passa.
        expect(fecharJanela().defaultPrevented).toBe(false);
        tirar();
    });

    it('cancelar mantem a janela e a guarda armada', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        const api = { windowClose: vi.fn() };
        const d = vi.fn(async () => 'cancel');
        const tirar = instalarGuarda(tm, api, d);
        fecharJanela();
        await vi.waitFor(() => expect(d).toHaveBeenCalledTimes(1));
        await new Promise((r) => setTimeout(r, 0));
        expect(api.windowClose).not.toHaveBeenCalled();
        expect(fecharJanela().defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(d).toHaveBeenCalledTimes(2));
        tirar();
    });

    it('dialogo que falha nao prende a janela: a proxima tentativa pergunta de novo', async () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        const d = vi.fn(async () => { throw new Error('ui quebrou'); });
        const tirar = instalarGuarda(tm, { windowClose: vi.fn() }, d);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fecharJanela();
        await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
        fecharJanela();
        await vi.waitFor(() => expect(d).toHaveBeenCalledTimes(2));
        tirar();
    });

    it('a guarda tirada nao segura mais', () => {
        const { tm } = abas({ abertos: ['C:/p/a.v'], sujos: ['C:/p/a.v'] });
        instalarGuarda(tm, { windowClose: vi.fn() }, vi.fn(async () => 'cancel'))();
        expect(fecharJanela().defaultPrevented).toBe(false);
    });
});

describe('dialogoPadrao', () => {
    it('usa o dialogo do app quando ele ja carregou', async () => {
        const { dialogoPadrao } = await import('../../js/tabs/guarda_de_fechamento.ts');
        window.AuroraUI = { dialog: vi.fn(async () => 'save-all') };
        expect(await dialogoPadrao({ title: 't', message: 'm', variant: 'warning', buttons: [] })).toBe('save-all');
        delete window.AuroraUI;
    });

    it('sem ele, o confirm: aceitar descarta, recusar fica', async () => {
        const { dialogoPadrao } = await import('../../js/tabs/guarda_de_fechamento.ts');
        const confirmar = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
        window.confirm = confirmar;
        expect(await dialogoPadrao({})).toBe('discard');
        expect(await dialogoPadrao({})).toBe('cancel');
        expect(confirmar).toHaveBeenCalledWith('There are unsaved changes. Close without saving?');
    });
});
