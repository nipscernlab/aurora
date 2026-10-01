// @vitest-environment happy-dom
//
// Caracterizacao das bordas do turno do painel de IA que o aiTurnFlow nao
// alcanca: o esforco guardado, o teto de mensagens em memoria, o startChat que
// recusa ou lanca, o turno autonomo sem conversa, a rede de seguranca do Stop,
// o cao de guarda diante de um chip que nao termina, o uso relido no fim de um
// turno de assinatura e a chamada de ferramenta recusada. Escrito antes de o
// turno sair do ai_assistant_manager (TODO 13.3) e rodado no `.js` antigo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { STREAM_STALL_MS, STREAM_STALL_HARD_MS } from '../../js/ai/ai_metadata.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

let api;
let painel;

function makeAiAPI(over = {}) {
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
  return Object.assign(a, over);
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

async function mandar(texto) {
  painel.inputEl.value = texto;
  await painel.send();
  const sid = api.chamadas.at(-1)?.sessionId;
  return (ev) => api.emitir({ sessionId: sid, ...ev });
}

const assentar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const ultimaBolha = () => Array.from(painel.messagesEl.querySelectorAll('.ai-message')).at(-1);

beforeEach(() => {
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  painel?._disarmStreamWatchdog?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.initializeGlobalTerminalManager = undefined;
});

describe('o estado inicial', () => {
  it('o esforco guardado volta, se for um valor conhecido', () => {
    localStorage.setItem('aurora-ai-cc-effort', 'high');
    expect(new AIAssistantManager().claudeCodeEffort).toBe('high');
    localStorage.setItem('aurora-ai-cc-effort', 'absurdo');
    expect(new AIAssistantManager().claudeCodeEffort).not.toBe('absurdo');
  });
});

describe('o despacho', () => {
  it('a conversa em memoria guarda no maximo as 400 mensagens mais recentes', async () => {
    await abrir();
    painel.messages = Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    await mandar('a ultima');
    expect(painel.messages).toHaveLength(400);
    expect(painel.messages[0].content).toBe('m1');
    expect(painel.messages.at(-1).content).toBe('a ultima');
  });

  it('o startChat que recusa vira erro com o motivo; o que lanca, com a mensagem', async () => {
    await abrir({ startChat: vi.fn(async () => ({ ok: false, error: 'sem credito' })) });
    await mandar('oi');
    expect(ultimaBolha().classList.contains('error')).toBe(true);
    expect(ultimaBolha().textContent).toContain('Failed to start chat: sem credito');
    expect(painel._isStreaming).toBe(false);

    await abrir({ startChat: vi.fn(async () => { throw new Error('ipc caiu'); }) });
    await mandar('oi');
    expect(ultimaBolha().textContent).toContain('ipc caiu');
  });
});

describe('o turno autonomo', () => {
  it('sem conteudo, sem provedor ou sem conversa, nao comeca', async () => {
    await abrir();
    painel.autoContinue('x');                       // sem conversa ainda
    painel.currentChatId = 'c-1';
    painel.autoContinue('');
    painel.currentProvider = null;
    painel.autoContinue('x');
    expect(api.startChat).not.toHaveBeenCalled();
  });
});

describe('parar', () => {
  it('sem sessao aberta, nada', async () => {
    await abrir();
    await painel.stop();
    expect(api.abortChat).not.toHaveBeenCalled();
  });

  it('se o backend nunca confirma, o painel volta ao repouso sozinho em 2 s', async () => {
    await abrir();
    await mandar('longo');
    vi.useFakeTimers();
    await painel.stop();
    expect(painel._isStreaming).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(painel._isStreaming).toBe(false);
    expect(painel.thinkingEl).toBeNull();
    expect(painel.stopBtn.classList.contains('hidden')).toBe(true);
  });

  it('a rede de seguranca nao mexe num turno que a pessoa recomecou', async () => {
    await abrir();
    await mandar('primeiro');
    vi.useFakeTimers();
    await painel.stop();
    painel.currentSessionId = 'outro-turno';
    await vi.advanceTimersByTimeAsync(2000);
    expect(painel._isStreaming).toBe(true);
  });
});

describe('o cao de guarda', () => {
  it('um chip rodando segura o resgate ate o teto duro, e nao alem dele', async () => {
    vi.useFakeTimers();
    await abrir();
    const emitir = await mandar('compila');
    emitir({ type: 'tool-call', toolName: 'compile_all', toolUseId: 't1' });
    await vi.advanceTimersByTimeAsync(STREAM_STALL_MS + 60000);
    expect(api.abortChat).not.toHaveBeenCalled();     // ferramenta de verdade pode demorar
    await vi.advanceTimersByTimeAsync(STREAM_STALL_HARD_MS);
    expect(api.abortChat).toHaveBeenCalled();
    expect(painel._isStreaming).toBe(false);
  });
});

describe('o fim do turno de assinatura', () => {
  it('relê o uso da CLI no fim do turno e no abortado', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    await assentar();
    let emitir = await mandar('oi');
    const antes = api.getClaudeCodeUsage.mock.calls.length;
    emitir({ type: 'text-delta', delta: 'ola' });
    emitir({ type: 'finish' });
    await assentar();
    expect(api.getClaudeCodeUsage.mock.calls.length).toBe(antes + 1);

    emitir = await mandar('de novo');
    emitir({ type: 'aborted' });
    await assentar();
    expect(api.getClaudeCodeUsage.mock.calls.length).toBe(antes + 2);
  });
});

describe('a chamada de ferramenta recusada', () => {
  it('vai para o TCMD como aviso; o terminal que falha so avisa no console', async () => {
    await abrir();
    const append = vi.fn();
    window.initializeGlobalTerminalManager = () => ({ appendToTerminal: append });
    const emitir = await mandar('faz');
    emitir({ type: 'tool-rejected', message: 'chamada malformada' });
    expect(append).toHaveBeenCalledWith('tcmd', 'chamada malformada', 'warning');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.initializeGlobalTerminalManager = () => { throw new Error('sem terminal'); };
    emitir({ type: 'tool-rejected', message: 'outra' });
    expect(warn).toHaveBeenCalledWith('[ai] nao consegui escrever a recusa no terminal:', expect.any(Error));
    window.initializeGlobalTerminalManager = undefined;
    expect(() => emitir({ type: 'tool-rejected', message: 'sem nada' })).not.toThrow();
  });
});
