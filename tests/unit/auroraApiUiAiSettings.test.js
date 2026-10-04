// @vitest-environment happy-dom
//
// Os namespaces ui, ai e settings da AuroraAPI, pela API montada, que e o
// caminho que a IA e o resto da interface chamam. Escritos contra o
// aurora_api.js antes de os tres sairem para modulos proprios: o mesmo teste
// prova que a extracao nao mudou o comportamento. Erro sai como
// { ok: false, error: { message, code } } (api_core.ts).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI: {} }));
const setTooltipsEnabled = vi.fn();
vi.mock('../../js/ui/tooltip.js', () => ({ setTooltipsEnabled }));

let API;

beforeAll(async () => {
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

beforeEach(() => {
  vi.clearAllMocks();
  delete window.showNotification;
  delete window.getLocale;
  delete window.setLocale;
  delete window.aiAssistantManager;
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('ui', () => {
  it('showNotification repassa ao sistema de avisos, e recusa sem ele', async () => {
    expect(await API.ui.showNotification('oi')).toEqual({ ok: false, error: { message: 'notification system not available', code: null } });
    window.showNotification = vi.fn();
    expect(await API.ui.showNotification(undefined, 'error', 10, 'T')).toEqual({ ok: true, data: null });
    expect(window.showNotification).toHaveBeenCalledWith('', 'error', 10, 'T');
    await API.ui.showNotification(42);
    expect(window.showNotification).toHaveBeenLastCalledWith('42', 'info', 5000, undefined);
  });

  it('openSettings clica na engrenagem da barra, e recusa sem ela', async () => {
    expect((await API.ui.openSettings()).error.message).toBe('settings button not found');
    document.body.innerHTML = '<button id="aurora-settings"></button>';
    const clique = vi.fn();
    document.getElementById('aurora-settings').addEventListener('click', clique);
    expect((await API.ui.openSettings()).ok).toBe(true);
    expect(clique).toHaveBeenCalledTimes(1);
  });

  it('getLocale e setLocale falam com o i18n, e dizem quando ele nao carregou', async () => {
    expect(await API.ui.getLocale()).toEqual({ ok: true, data: null });
    expect((await API.ui.setLocale('pt')).error.message).toBe('i18n not loaded');
    window.getLocale = () => 'en';
    window.setLocale = vi.fn(async () => {});
    expect((await API.ui.getLocale()).data).toBe('en');
    expect(await API.ui.setLocale('pt')).toEqual({ ok: true, data: { locale: 'pt' } });
    window.setLocale = vi.fn(async () => { throw new Error('sem arquivo'); });
    expect((await API.ui.setLocale('xx')).error.message).toBe('sem arquivo');
  });

  it('askUserQuestion exige a pergunta, o painel, e devolve a resposta', async () => {
    expect((await API.ui.askUserQuestion({})).error.message).toBe('question required');
    expect((await API.ui.askUserQuestion()).error.message).toBe('question required');
    expect((await API.ui.askUserQuestion({ question: 'q' })).error.message).toBe('AI panel is not available');
    const showAskUserQuestionInline = vi.fn(async () => ({ answer: 'a', selected: ['x'] }));
    window.aiAssistantManager = { showAskUserQuestionInline };
    const r = await API.ui.askUserQuestion({ question: 'q', options: 'nao e lista', multiSelect: 1 });
    expect(r).toEqual({ ok: true, data: { answer: 'a', selected: ['x'] } });
    expect(showAskUserQuestionInline).toHaveBeenCalledWith({ question: 'q', options: [], multiSelect: true });
  });
});

describe('ai', () => {
  it('open abre o painel, ou recusa sem ele', async () => {
    expect((await API.ai.open()).error.message).toBe('AI panel is not available');
    window.aiAssistantManager = { ensureOpen: vi.fn() };
    expect((await API.ai.open()).ok).toBe(true);
    expect(window.aiAssistantManager.ensureOpen).toHaveBeenCalled();
  });

  it('askAboutSelection exige codigo, repassa ao painel e traduz a excecao', async () => {
    expect((await API.ai.askAboutSelection({ code: '  ' })).error.message).toBe('code (a non-empty selection) required');
    expect((await API.ai.askAboutSelection(null)).error.message).toBe('code (a non-empty selection) required');
    expect((await API.ai.askAboutSelection({ code: 'x' })).error.message).toBe('AI panel is not available');
    const askAboutSelection = vi.fn();
    window.aiAssistantManager = { askAboutSelection };
    const p = { code: 'int a;', intent: 'explain' };
    expect((await API.ai.askAboutSelection(p)).ok).toBe(true);
    expect(askAboutSelection).toHaveBeenCalledWith(p);
    askAboutSelection.mockImplementation(() => { throw new Error('quebrou'); });
    expect((await API.ai.askAboutSelection(p)).error.message).toBe('quebrou');
  });

  it('runInBackground devolve o dado do painel, ou o erro dele', async () => {
    expect((await API.ai.runInBackground({})).error.message).toBe('AI panel is not available');
    const runInBackground = vi.fn(() => ({ ok: true, data: { id: 7 } }));
    window.aiAssistantManager = { runInBackground };
    expect(await API.ai.runInBackground(null)).toEqual({ ok: true, data: { id: 7 } });
    expect(runInBackground).toHaveBeenCalledWith({});
    runInBackground.mockReturnValue({ ok: false, error: 'ocupado' });
    expect((await API.ai.runInBackground({ task: 'compile_all' })).error.message).toBe('ocupado');
    runInBackground.mockReturnValue(undefined);
    expect((await API.ai.runInBackground({})).error.message).toBe('runInBackground failed');
  });
});

describe('settings', () => {
  it('getAll le o que esta gravado, com os padroes', async () => {
    expect((await API.settings.getAll()).data).toEqual({ locale: null, tooltipsEnabled: true, verboseMode: false });
    localStorage.setItem('aurora-settings', JSON.stringify({ tooltipsEnabled: false, verboseMode: 1 }));
    window.getLocale = () => 'pt';
    expect((await API.settings.getAll()).data).toEqual({ locale: 'pt', tooltipsEnabled: false, verboseMode: true });
    localStorage.setItem('aurora-settings', '{quebrado');
    expect((await API.settings.getAll()).data.tooltipsEnabled).toBe(true);
  });

  it('set grava, avisa a interface e liga as dicas na hora', async () => {
    const aviso = vi.fn();
    window.addEventListener('aurora-settings-updated', aviso);
    expect(await API.settings.set('tooltipsEnabled', 0)).toEqual({ ok: true, data: { key: 'tooltipsEnabled', value: false } });
    expect(JSON.parse(localStorage.getItem('aurora-settings'))).toEqual({ tooltipsEnabled: false });
    expect(setTooltipsEnabled).toHaveBeenCalledWith(false);
    expect(aviso.mock.calls[0][0].detail).toEqual({ tooltipsEnabled: false });

    expect((await API.settings.set('verboseMode', 'sim')).data).toEqual({ key: 'verboseMode', value: true });
    expect(JSON.parse(localStorage.getItem('aurora-settings'))).toEqual({ tooltipsEnabled: false, verboseMode: true });
    expect(setTooltipsEnabled).toHaveBeenCalledTimes(1);
    window.removeEventListener('aurora-settings-updated', aviso);
  });

  it('set devolve o erro quando o localStorage recusa gravar, sem avisar a interface', async () => {
    const aviso = vi.fn();
    window.addEventListener('aurora-settings-updated', aviso);
    const gravar = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('cota cheia'); });
    expect((await API.settings.set('verboseMode', true)).error.message).toBe('cota cheia');
    expect(aviso).not.toHaveBeenCalled();
    gravar.mockRestore();
    window.removeEventListener('aurora-settings-updated', aviso);
  });

  it('set do locale passa pelo i18n, e chave desconhecida e recusada', async () => {
    expect((await API.settings.set('locale', 'pt')).error.message).toBe('i18n not loaded');
    window.setLocale = vi.fn(async () => {});
    expect((await API.settings.set('locale', 'en')).data).toEqual({ key: 'locale', value: 'en' });
    expect(window.setLocale).toHaveBeenCalledWith('en');
    expect((await API.settings.set('tema', 'escuro')).error.message).toBe('unknown setting: tema');
  });
});
