// @vitest-environment happy-dom
//
// Caracterizacao dos indicadores do turno no painel de IA: a palavra de
// "pensando" com os tres pontos, o aviso enquanto a CLI de assinatura e baixada
// no primeiro uso, e o contador de tokens com o que veio do cache. Escrito
// antes de os indicadores sairem do ai_assistant_manager (TODO 13.3) e rodado
// no `.js` antigo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

let api;
let painel;

function makeAiAPI() {
  const a = {
    chamadas: [],
    emitir: null,
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-1' })),
    onChatEvent: vi.fn((cb) => { a.emitir = cb; return () => {}; }),
    startChat: vi.fn(async (p) => { a.chamadas.push(p); return { ok: true }; }),
    abortChat: vi.fn(async () => ({ ok: true })),
    saveConversation: vi.fn(async () => ({ ok: true })),
    listConversations: vi.fn(async () => ({ chats: [] })),
    getClaudeCodeStatus: vi.fn(async () => ({ status: { installed: true, authed: true } })),
    getClaudeCodeUsage: vi.fn(async () => ({ usage: null })),
  };
  return a;
}

const assentar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

async function turno() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  painel.inputEl.value = 'oi';
  await painel.send();
  const sid = api.chamadas.at(-1).sessionId;
  return (ev) => api.emitir({ sessionId: sid, ...ev });
}

const pensando = () => painel.messagesEl.querySelectorAll('.ai-thinking-wrap:not(.ai-cli-download)');
const baixando = () => painel.messagesEl.querySelector('.ai-cli-download');

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  painel?._disarmStreamWatchdog?.();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('a palavra de pensando', () => {
  it('aparece ao despachar, uma so, com os tres pontos; o texto que chega a tira', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const emitir = await turno();
    expect(pensando()).toHaveLength(1);
    const el = pensando()[0];
    expect(el.querySelector('.ai-thinking-word').textContent).toBe('Descombobulating');
    expect(el.querySelectorAll('.ai-thinking-dots span')).toHaveLength(3);
    painel.showThinking(true);
    expect(pensando()).toHaveLength(1);
    emitir({ type: 'text-delta', delta: 'Ola, tudo bem por aqui.' });
    emitir({ type: 'finish' });
    expect(pensando()).toHaveLength(0);
    expect(painel.thinkingEl).toBeNull();
    painel.showThinking(false);                     // ja fechada: nada
    expect(pensando()).toHaveLength(0);
  });

  it('a palavra sai da lista pelo sorteio', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    await turno();
    expect(pensando()[0].querySelector('.ai-thinking-word').textContent).toBe('Greasing the pipeline');
  });
});

describe('o download da CLI no primeiro uso', () => {
  it('cada fase com o seu rotulo; a palavra de pensando sai enquanto isso', async () => {
    const emitir = await turno();
    emitir({ type: 'cli-download', phase: 'download', cli: 'Claude Code', pct: 40, received: 50e6, total: 120e6 });
    expect(pensando()).toHaveLength(0);
    expect(baixando().textContent).toBe('Downloading Claude Code (first use)… 40% · 50/120 MB');
    expect(baixando().querySelectorAll('.ai-thinking-dots span')).toHaveLength(3);
    emitir({ type: 'cli-download', phase: 'download', cli: 'Claude Code' });
    expect(baixando().textContent).toBe('Downloading Claude Code (first use)… 0%');
    emitir({ type: 'cli-download', phase: 'verify', cli: 'Claude Code' });
    expect(baixando().textContent).toBe('Verifying Claude Code…');
    emitir({ type: 'cli-download', phase: 'extract' });
    expect(baixando().textContent).toBe('Installing AI CLI…');
    expect(painel.messagesEl.querySelectorAll('.ai-cli-download')).toHaveLength(1);
  });

  it('o nome da CLI vai como texto; a linha volta se a conversa foi limpa no meio', async () => {
    const emitir = await turno();
    emitir({ type: 'cli-download', phase: 'verify', cli: '<b>x</b>' });
    expect(baixando().querySelector('b')).toBeNull();
    expect(baixando().textContent).toBe('Verifying <b>x</b>…');
    painel.messagesEl.innerHTML = '';
    emitir({ type: 'cli-download', phase: 'extract', cli: 'Codex' });
    expect(baixando().textContent).toBe('Installing Codex…');
  });

  it('terminou de baixar: a linha sai, a palavra de pensando volta e o estado da assinatura e relido', async () => {
    const emitir = await turno();
    painel.currentProvider = 'claude-code';
    const sondas = api.getClaudeCodeStatus.mock.calls.length;
    emitir({ type: 'cli-download', phase: 'download', cli: 'Claude Code', pct: 99 });
    emitir({ type: 'cli-download', phase: 'done' });
    expect(baixando()).toBeNull();
    expect(pensando()).toHaveLength(1);
    await assentar();
    expect(api.getClaudeCodeStatus.mock.calls.length).toBe(sondas + 1);
  });

  it('o fim do turno, o erro e a parada tiram a linha', async () => {
    let emitir = await turno();
    emitir({ type: 'cli-download', phase: 'download', cli: 'X' });
    emitir({ type: 'text-delta', delta: 'pronto' });
    emitir({ type: 'finish' });
    expect(baixando()).toBeNull();

    emitir = await turno();
    emitir({ type: 'cli-download', phase: 'download', cli: 'X' });
    emitir({ type: 'error', message: 'caiu' });
    expect(baixando()).toBeNull();
  });
});

describe('o contador de tokens', () => {
  it('soma o total do turno, nos tres formatos que o uso chega', async () => {
    let emitir = await turno();
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { totalTokens: 1500 } });
    expect(painel.tokenCounter.textContent).toBe('1.5k');
    expect(painel.tokenCounter.title).toBe('1,500 tokens this conversation');

    emitir = await turno();
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { inputTokens: 100, outputTokens: 20 } });
    expect(painel.cumulativeTokens).toBe(120);

    emitir = await turno();
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { promptTokens: 7, completionTokens: 3 } });
    expect(painel.cumulativeTokens).toBe(10);
  });

  it('o que veio do cache vai no titulo; uso vazio ou zerado nao mexe no contador', async () => {
    let emitir = await turno();
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { totalTokens: 2000, cacheAurora: { lidos: 1200, escritos: 300 } } });
    expect(painel.tokenCounter.title).toBe('2,000 tokens this conversation (1,200 read from the prompt cache at a tenth of the price)');
    expect([painel.cacheLidos, painel.cacheEscritos]).toEqual([1200, 300]);

    emitir = await turno();
    painel.tokenCounter.textContent = 'marca';
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { totalTokens: 0 } });
    expect(painel.tokenCounter.textContent).toBe('marca');

    emitir = await turno();
    painel.tokenCounter.textContent = 'marca';
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { cacheAurora: { escritos: 50 } } });
    expect(painel.tokenCounter.textContent).toBe('0');    // cache sozinho redesenha
    expect(painel.cacheEscritos).toBe(50);

    emitir = await turno();
    painel.tokenCounter.textContent = 'marca';
    emitir({ type: 'text-delta', delta: 'a' });
    emitir({ type: 'finish', usage: { cacheAurora: { lidos: 0, escritos: 0 } } });
    expect(painel.tokenCounter.textContent).toBe('0');
    expect([painel.cacheLidos, painel.cacheEscritos]).toEqual([undefined, undefined]);   // zerado nao conta
  });

  it('com o popover aberto numa assinatura, o contador relê o uso dela', async () => {
    await turno();
    painel.currentProvider = 'claude-code';
    painel.modelPopoverOpen = true;
    const antes = api.getClaudeCodeUsage.mock.calls.length;
    painel.updateTokenCounter();
    await assentar();
    expect(api.getClaudeCodeUsage.mock.calls.length).toBe(antes + 1);
    painel.modelPopoverOpen = false;
    painel.updateTokenCounter();
    await assentar();
    expect(api.getClaudeCodeUsage.mock.calls.length).toBe(antes + 1);
  });
});
