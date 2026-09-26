// @vitest-environment happy-dom
//
// O popover de provedor e modelo do painel de IA (js/ui/ai_assistant_manager.js)
// e o que mora junto dele: a linha de estado da conexao, o uso da assinatura,
// o aviso antes de abrir link externo e o clique num caminho citado. Teste de
// caracterizacao, escrito antes de o grupo sair do painel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
const electronAPI = vi.hoisted(() => ({}));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';

const AIAssistantManager = aiAssistantManager.constructor;
let painel;
let api;

function makeAiAPI(over = {}) {
  return {
    listProviders: vi.fn(async () => ({ providers: [
      { name: 'anthropic', model: 'claude-x', defaultModel: 'claude-x' },
      { name: 'openai', model: '', defaultModel: 'gpt-y' },
      { name: 'google', model: 'g' },
    ] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true, openai: true } })),
    onChatEvent: vi.fn(() => () => {}),
    setModel: vi.fn(async (_p, v) => ({ ok: true, model: v })),
    getClaudeCodeStatus: vi.fn(async () => ({ status: { installed: true, authed: true, plan: 'max', version: '2.1' } })),
    getClaudeCodeUsage: vi.fn(async () => ({ usage: null })),
    getCodexStatus: vi.fn(async () => ({ status: null })),
    getCodexUsage: vi.fn(async () => ({ usage: null })),
    ...over,
  };
}

async function abrir(over) {
  api = makeAiAPI(over);
  window.aiAPI = api;
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  return painel;
}

const divisores = () => Array.from(painel.messagesEl.querySelectorAll('.ai-divider')).map((d) => d.textContent.trim());
const estado = () => painel.ccStatusEl;

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(electronAPI)) delete electronAPI[k];
  delete window.showNotification;
  delete window.TabManager;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.querySelectorAll('.ai-link-warning').forEach((e) => e.remove());
});

describe('provedores disponiveis', () => {
  it('as duas assinaturas sempre, mais os provedores de API com chave; o primeiro de API e o escolhido', async () => {
    await abrir();
    expect(painel.providersAvailable.map((p) => p.name)).toEqual(['claude-code', 'chatgpt', 'anthropic', 'openai']);
    expect(painel.currentProvider).toBe('anthropic');
    expect(painel.sendBtn.disabled).toBe(false);
    expect(painel.mpProviders.innerHTML).toContain('anthropic');
  });

  it('sem nenhuma chave, Claude Code; a ponte que falha conta como nenhuma', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await abrir({ listProviders: vi.fn(async () => { throw new Error('x'); }) });
    expect(painel.providersAvailable.map((p) => p.name)).toEqual(['claude-code', 'chatgpt']);
    expect(painel.currentProvider).toBe('claude-code');
  });

  it('respostas vazias da ponte viram lista vazia', async () => {
    await abrir({ listProviders: vi.fn(async () => null), getKeyStatus: vi.fn(async () => null) });
    expect(painel.providersAvailable.map((p) => p.name)).toEqual(['claude-code', 'chatgpt']);
  });

  it('sem a ponte de IA, o painel mostra o vazio e trava o envio', async () => {
    document.body.innerHTML = '<div class="main-container"></div>';
    delete window.aiAPI;
    painel = new AIAssistantManager();
    painel.initialize();
    await painel.refreshProviders();
    expect(painel.sendBtn.disabled).toBe(true);
    expect(painel.inputEl.disabled).toBe(true);
  });

  it('o modelo guardado da assinatura volta; o do ChatGPT que saiu da lista cai no padrao', async () => {
    localStorage.setItem('aurora-ai-claude-code-model', 'opus');
    localStorage.setItem('aurora-ai-chatgpt-model', 'gpt-5');
    await abrir();
    expect(painel.claudeCodeEntry.model).toBe('opus');
    expect(painel.chatgptEntry.model).toBe('default');
    expect(localStorage.getItem('aurora-ai-chatgpt-model')).toBeNull();
    painel.claudeCodeEntry = null;
    painel.chatgptEntry = null;
    localStorage.setItem('aurora-ai-chatgpt-model', 'gpt-5.6-sol');
    await painel.refreshProviders();
    expect(painel.chatgptEntry.model).toBe('gpt-5.6-sol');
  });

  it('a escolha atual fica quando continua valida', async () => {
    await abrir();
    painel.currentProvider = 'openai';
    await painel.refreshProviders();
    expect(painel.currentProvider).toBe('openai');
  });
});

describe('trocar de provedor e de modelo', () => {
  it('trocar de provedor marca a troca na conversa e fecha o popover; o mesmo, nada', async () => {
    await abrir();
    painel.toggleModelPopover(true);
    painel.selectProvider('anthropic');
    expect(divisores()).toEqual([]);
    painel.selectProvider('openai');
    expect(divisores()).toEqual(['Modelo: ChatGPT · y']);
    expect(painel.modelPopover.classList.contains('hidden')).toBe(true);
    expect(painel.messagesEl.querySelector('.ai-divider').classList.contains('ai-divider-wave')).toBe(true);
  });

  it('o chip mostra o modelo curto e o provedor no titulo; sem modelo, o nome do provedor', async () => {
    await abrir();
    // O nome curto tira o prefixo da familia.
    expect(painel.modelChipName.textContent).toBe('x');
    expect(painel.modelChip.title).toBe('Claude · claude-x');
    painel.selectProvider('openai');
    expect(painel.modelChipName.textContent).toBe('ChatGPT');
    expect(painel.modelChip.title).toBe('ChatGPT — switch model or provider');
  });

  it('provedor de API: campo livre; o modelo vai para o main e so marca a troca se mudou', async () => {
    await abrir();
    expect(painel.mpModelApi.classList.contains('hidden')).toBe(false);
    expect(painel.mpModelPresets.classList.contains('hidden')).toBe(true);
    await painel.commitModel('  claude-z ');
    expect(api.setModel).toHaveBeenCalledWith('anthropic', 'claude-z');
    expect(painel.modelInput.value).toBe('claude-z');
    expect(divisores()).toEqual(['Modelo: Claude · z']);
    await painel.commitModel('claude-z');
    expect(divisores()).toHaveLength(1);
  });

  it('o main que recusa ou falha deixa o modelo como estava', async () => {
    await abrir();
    api.setModel = vi.fn(async () => ({ ok: false }));
    await painel.commitModel('outro');
    api.setModel = vi.fn(async () => { throw new Error('x'); });
    await painel.commitModel('outro');
    expect(painel.providersAvailable.find((p) => p.name === 'anthropic').model).toBe('claude-x');
    expect(divisores()).toEqual([]);
  });

  it('assinatura: botoes de modelo; escolher guarda e marca a troca; vazio e o padrao', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    expect(painel.mpModelPresets.classList.contains('hidden')).toBe(false);
    expect(painel.mpModelPresets.innerHTML).toContain('opus');
    await painel.commitModel('opus');
    expect(localStorage.getItem('aurora-ai-claude-code-model')).toBe('opus');
    expect(divisores().at(-1)).toBe('Modelo: Claude Code · Opus');
    await painel.commitModel('');
    expect(painel.claudeCodeEntry.model).toBe('default');
    const n = divisores().length;
    await painel.commitModel('default');
    expect(divisores()).toHaveLength(n);
  });

  it('esforco: aparece nas assinaturas e na API da Anthropic; so aceita os valores conhecidos', async () => {
    await abrir();
    expect(painel.effortSection.classList.contains('hidden')).toBe(false);
    painel.selectProvider('openai');
    expect(painel.effortSection.classList.contains('hidden')).toBe(true);
    painel.selectProvider('claude-code');
    painel.setClaudeCodeEffort('high');
    expect(localStorage.getItem('aurora-ai-cc-effort')).toBe('high');
    expect(painel.effortSeg.querySelector('.active').dataset.effort).toBe('high');
    painel.setClaudeCodeEffort('turbo');
    expect(painel.claudeCodeEffort).toBe('high');
  });

  it('permissao: so os modos conhecidos, e guardada', async () => {
    await abrir();
    painel.setPermissionMode('nao-existe');
    const antes = painel.permissionMode;
    expect(antes).not.toBe('nao-existe');
    painel.buildPermissionOptions();
    const outro = Array.from(painel.mpPerms.querySelectorAll('[data-perm], input, button'))
      .map((e) => e.dataset.perm || e.value).find((v) => v && v !== antes);
    painel.setPermissionMode(outro);
    expect(localStorage.getItem('aurora-ai-permission')).toBe(outro);
  });

  it('abrir o popover numa assinatura atualiza o uso', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    api.getClaudeCodeUsage.mockClear();
    painel.toggleModelPopover();
    expect(painel.modelPopoverOpen).toBe(true);
    expect(api.getClaudeCodeUsage).toHaveBeenCalled();
    painel.toggleModelPopover();
    expect(painel.modelPopoverOpen).toBe(false);
  });
});

describe('linha de estado da conexao', () => {
  it('provedor de API: conectado com o modelo, ou sem chave', async () => {
    await abrir();
    expect(estado().dataset.state).toBe('on');
    expect(estado().textContent).toContain('Claude · Connected');
    expect(estado().textContent).toContain('Model: claude-x');
    painel.selectProvider('openai');
    expect(estado().textContent).toContain('Model: gpt-y');
    painel.currentProvider = 'google';
    painel.providersAvailable.push({ name: 'google' });
    painel.renderProviderStatus();
    expect(estado().dataset.state).toBe('off');
    expect(estado().textContent).toContain('Gemini · Not configured');
  });

  it('assinatura: conferindo, sem CLI, sem login, baixa no primeiro uso, pronta', async () => {
    await abrir();
    painel.currentProvider = 'claude-code';
    const ver = (s) => { painel.subStatus['claude-code'] = s; painel.renderSubStatus(); return [estado().dataset.state, estado().textContent.replace(/\s+/g, ' ').trim()]; };
    expect(ver(null)).toEqual(['off', 'Checking Claude Code…']);
    expect(ver({ installed: false })[1]).toContain('Claude Code not installed');
    const semLogin = ver({ installed: true, authed: false });
    expect(semLogin[0]).toBe('warn');
    expect(semLogin[1]).toContain('Not signed in');
    expect(semLogin[1]).toContain('claude login');
    expect(ver({ installed: false, downloadable: true, authed: true })).toEqual(['on', expect.stringContaining('Downloads on first message')]);
    expect(ver({ installed: true, authed: true, plan: 'max', version: '2.1' })[1]).toContain('2.1');
    expect(ver({ installed: true, authed: true })[1]).toMatch(/Claude Code · \S+/);
  });

  it('a sonda da assinatura guarda o estado; falha conta como sem CLI; trocar no meio nao desenha', async () => {
    await abrir();
    painel.currentProvider = 'chatgpt';
    api.getCodexStatus = vi.fn(async () => { throw new Error('x'); });
    await painel.refreshSubStatus();
    expect(painel.subStatus.chatgpt).toBeNull();
    api.getCodexStatus = vi.fn(async () => { painel.currentProvider = 'anthropic'; return { status: { installed: true, authed: true } }; });
    const antes = estado().innerHTML;
    painel.currentProvider = 'chatgpt';
    await painel.refreshSubStatus();
    expect(painel.subStatus.chatgpt).toEqual({ installed: true, authed: true });
    expect(estado().innerHTML).toBe(antes);
    painel.currentProvider = 'anthropic';
    await painel.refreshSubStatus();
    painel.renderSubStatus();
  });

  it('sem a linha no DOM, nada', async () => {
    await abrir();
    painel.ccStatusEl = null;
    expect(() => { painel.renderSubStatus(); painel.renderProviderStatus(); }).not.toThrow();
  });
});

describe('uso da assinatura', () => {
  it('sem janelas de limite, a dica diz a verdade de cada provedor', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    await painel.refreshSubUsage();
    expect(painel.mpUsage.querySelector('.ai-usage-hint').textContent).toBe('Plan limits appear here after your first message.');
    painel.selectProvider('chatgpt');
    await painel.refreshSubUsage();
    expect(painel.mpUsage.querySelectorAll('.ai-usage-hint')).toHaveLength(1);
    expect(painel.mpUsage.querySelector('.ai-usage-hint').textContent).toContain('Codex CLI reports only');
  });

  it('com janelas, as barras aparecem e a dica sai; o plano vai no titulo', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    await painel.refreshSubUsage();
    api.getClaudeCodeUsage = vi.fn(async () => ({ usage: { plan: 'max', windows: [{ key: 'five_hour', utilization: 42, resetsAt: 1900000000 }] } }));
    await painel.refreshSubUsage();
    expect(painel.mpUsage.querySelector('.ai-usage-hint')).toBeNull();
    expect(painel.usagePlan.textContent).toMatch(/plan$/);
  });

  it('a sonda que falha deixa o uso vazio; provedor de API nao tem uso; sem as barras, nada', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    api.getClaudeCodeUsage = vi.fn(async () => { throw new Error('x'); });
    await painel.refreshSubUsage();
    expect(painel.subUsage['claude-code']).toBeNull();
    painel.currentProvider = 'anthropic';
    await painel.refreshSubUsage();
    painel.usageBars = null;
    expect(() => painel.renderUsage()).not.toThrow();
  });

  it('trocar de provedor enquanto a sonda roda nao desenha o uso do outro', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    const spy = vi.spyOn(painel, 'renderUsage');
    api.getClaudeCodeUsage = vi.fn(async () => { painel.currentProvider = 'anthropic'; return { usage: null }; });
    await painel.refreshSubUsage();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('link externo', () => {
  const card = () => document.querySelector('.ai-link-warning');

  it('pergunta antes, mostra a URL como texto, e abre so no botao', async () => {
    await abrir();
    electronAPI.openExternal = vi.fn();
    painel._confirmExternalLink('https://x.com/<b>');
    expect(card().querySelector('.ai-link-warning-url').textContent).toBe('https://x.com/<b>');
    expect(card().querySelector('.ai-link-warning-url b')).toBeNull();
    card().querySelector('.ai-link-warning-open').click();
    expect(electronAPI.openExternal).toHaveBeenCalledWith('https://x.com/<b>');
    expect(card()).toBeNull();
    expect(localStorage.getItem('aurora-ai-trust-external-links')).toBeNull();
  });

  it('cancelar, Escape ou clicar fora fecham sem abrir; so um aviso por vez', async () => {
    await abrir();
    electronAPI.openExternal = vi.fn();
    painel._confirmExternalLink('https://a');
    painel._confirmExternalLink('https://b');
    expect(document.querySelectorAll('.ai-link-warning')).toHaveLength(1);
    card().querySelector('.ai-link-warning-cancel').click();
    painel._confirmExternalLink('https://a');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(card()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card()).toBeNull();
    painel._confirmExternalLink('https://a');
    card().querySelector('.ai-link-warning-card').click();
    expect(card()).not.toBeNull();
    card().click();
    expect(card()).toBeNull();
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it('armazenamento que falha conta como sem confianca, e gravar nao lanca', async () => {
    await abrir();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('x'); });
    expect(painel._getTrustExternalLinks()).toBe(false);
    expect(() => painel._setTrustExternalLinks(true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it('marcar "sempre" grava a confianca e avisa as configuracoes; depois abre direto', async () => {
    await abrir();
    electronAPI.openExternal = vi.fn();
    const ouvinte = vi.fn();
    window.addEventListener('aurora:trust-external-links-changed', ouvinte);
    painel._confirmExternalLink('https://a');
    card().querySelector('.ai-link-warning-trust-cb').checked = true;
    card().querySelector('.ai-link-warning-open').click();
    expect(ouvinte.mock.calls[0][0].detail).toEqual({ value: true });
    painel._confirmExternalLink('https://b');
    expect(card()).toBeNull();
    expect(electronAPI.openExternal).toHaveBeenLastCalledWith('https://b');
    painel._setTrustExternalLinks(false);
    expect(painel._getTrustExternalLinks()).toBe(false);
    painel._confirmExternalLink('');
    window.removeEventListener('aurora:trust-external-links-changed', ouvinte);
  });
});

describe('caminho citado na conversa', () => {
  it('pasta abre no explorador; texto abre numa aba de previa; binario, no programa do sistema', async () => {
    await abrir();
    window.TabManager = { addTab: vi.fn() };
    electronAPI.openFolder = vi.fn();
    electronAPI.readFile = vi.fn(async () => 'conteudo');
    electronAPI.getFileStats = vi.fn(async (p) => ({ isDirectory: p.endsWith('pasta') }));
    await painel._openChatPath('C:/p/pasta');
    expect(electronAPI.openFolder).toHaveBeenLastCalledWith('C:/p/pasta');
    await painel._openChatPath('C:/p/top.v');
    expect(window.TabManager.addTab).toHaveBeenCalledWith('C:/p/top.v', 'conteudo', { preview: true });
    await painel._openChatPath('C:/p/foto.png');
    expect(electronAPI.openFolder).toHaveBeenLastCalledWith('C:/p/foto.png');
  });

  it('texto que nao le abre no programa do sistema; leitura vazia vira texto vazio', async () => {
    await abrir();
    window.TabManager = { addTab: vi.fn() };
    electronAPI.openFolder = vi.fn();
    electronAPI.getFileStats = vi.fn(async () => ({ isDirectory: false }));
    electronAPI.readFile = vi.fn(async () => null);
    await painel._openChatPath('C:/p/a.v');
    expect(window.TabManager.addTab).toHaveBeenCalledWith('C:/p/a.v', '', { preview: true });
    electronAPI.readFile = vi.fn(async () => { throw new Error('x'); });
    await painel._openChatPath('C:/p/a.v');
    expect(electronAPI.openFolder).toHaveBeenCalledWith('C:/p/a.v');
  });

  it('caminho que nao existe avisa; stat que falha tambem; vazio, nada', async () => {
    await abrir();
    window.showNotification = vi.fn();
    electronAPI.getFileStats = vi.fn(async () => null);
    await painel._openChatPath('C:/sumiu');
    expect(window.showNotification).toHaveBeenCalledWith('Path not found: C:/sumiu', 'warning');
    electronAPI.getFileStats = vi.fn(async () => { throw new Error('x'); });
    await painel._openChatPath('C:/sumiu2');
    expect(window.showNotification).toHaveBeenCalledTimes(2);
    window.showNotification = () => { throw new Error('y'); };
    await expect(painel._openChatPath('C:/sumiu3')).resolves.toBeUndefined();
    await painel._openChatPath('');
  });
});

describe('versao do manual', () => {
  it('guarda a versao do manual instalado, ou vazio', async () => {
    await abrir();
    window.electronAPI = { docsStatus: vi.fn(async () => ({ version: '7.2' })) };
    await painel._lerVersaoDoManual();
    expect(painel._versaoDoManual).toBe('7.2');
    window.electronAPI = { docsStatus: vi.fn(async () => { throw new Error('x'); }) };
    await painel._lerVersaoDoManual();
    expect(painel._versaoDoManual).toBe('');
    window.electronAPI = { docsStatus: vi.fn(async () => null) };
    await painel._lerVersaoDoManual();
    expect(painel._versaoDoManual).toBe('');
  });
});
