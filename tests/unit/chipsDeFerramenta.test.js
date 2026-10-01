// @vitest-environment happy-dom
//
// Caracterizacao dos chips de ferramenta do painel de IA: o grupo "N actions"
// que recolhe, o resumo enquanto algo roda, o casamento do resultado com o
// chip (pelo id, ou pelo nome quando nao ha id) e o que fica gravado na
// conversa. O caminho comum (uma ferramenta, prosa antes e depois) esta no
// aiTurnFlow; aqui ficam as bordas. Escrito antes de os chips sairem do
// ai_assistant_manager (TODO 13.3) e rodado no `.js` antigo.

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
  };
  return a;
}

async function turno() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  painel.inputEl.value = 'faz';
  await painel.send();
  const sid = api.chamadas.at(-1).sessionId;
  return (ev) => api.emitir({ sessionId: sid, ...ev });
}

const grupo = () => painel.messagesEl.querySelector('.ai-tool-group');
const resumo = () => grupo().querySelector('.ai-tool-group-summary').textContent;
const chips = () => Array.from(painel.messagesEl.querySelectorAll('.ai-tool-chip'));

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

describe('o grupo de ferramentas', () => {
  it('o resumo diz o que roda: o nome de uma, a contagem de varias, e o total no fim', async () => {
    const emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'get_project_tree', args: { depth: 2 }, toolUseId: 't1' });
    expect(resumo()).toBe('Running get project tree…');
    expect(chips()[0].className).toBe('ai-tool-chip running');
    expect(chips()[0].querySelector('.ai-tool-status').textContent).toBe('running…');
    expect(chips()[0].title).toContain('depth');
    emitir({ type: 'tool-call', toolName: 'read_file', toolUseId: 't2' });
    expect(resumo()).toBe('Running 2 actions…');
    expect(chips()[1].title).toBe('');
    emitir({ type: 'tool-result', toolName: 'read_file', result: { ok: true }, toolUseId: 't2' });
    expect(resumo()).toBe('Running get project tree…');
    emitir({ type: 'tool-result', toolName: 'get_project_tree', result: { ok: true }, toolUseId: 't1' });
    expect(resumo()).toBe('2 actions');
  });

  it('o cabecalho recolhe e expande, e diz isso ao leitor de tela', async () => {
    const emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'x', toolUseId: 't1' });
    const head = grupo().querySelector('.ai-tool-group-head');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    head.click();
    expect(grupo().classList.contains('collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    head.click();
    expect(grupo().classList.contains('collapsed')).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });

  it('o fim do turno fecha o grupo: check verde, ou cruz vermelha se alguma falhou', async () => {
    let emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'a', toolUseId: 't1' });
    emitir({ type: 'tool-result', toolName: 'a', result: { ok: true }, toolUseId: 't1' });
    emitir({ type: 'text-delta', delta: 'feito' });
    emitir({ type: 'finish' });
    expect(grupo().classList.contains('done')).toBe(true);
    expect(grupo().classList.contains('collapsed')).toBe(true);
    expect(grupo().classList.contains('has-failure')).toBe(false);
    expect(grupo().querySelector('.ai-tool-group-icon').className).toBe('ph ph-check-circle ai-tool-group-icon');
    expect(resumo()).toBe('1 action');

    emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'a', toolUseId: 't1' });
    emitir({ type: 'tool-result', toolName: 'a', result: { ok: false, error: 'quebrou' }, toolUseId: 't1' });
    emitir({ type: 'text-delta', delta: 'falhou' });
    emitir({ type: 'finish' });
    expect(grupo().classList.contains('has-failure')).toBe(true);
    expect(grupo().querySelector('.ai-tool-group-icon').className).toBe('ph ph-x-circle ai-tool-group-icon');
  });
});

describe('o resultado de cada ferramenta', () => {
  it('sem id, casa pelo nome; recusa vira "denied", erro vira "failed", e o erro fica gravado', async () => {
    const emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'write_file' });
    emitir({ type: 'tool-call', toolName: 'compile_all' });
    emitir({ type: 'tool-result', toolName: 'write_file', result: { ok: false, error: 'User denied the call' } });
    emitir({ type: 'tool-result', toolName: 'compile_all', result: { ok: false, error: 'erro de sintaxe' } });
    const [w, c] = chips();
    expect(w.className).toBe('ai-tool-chip denied');
    expect(w.querySelector('i').className).toBe('ph ph-prohibit');
    expect(w.querySelector('.ai-tool-status').textContent).toBe('denied');
    expect(c.className).toBe('ai-tool-chip failed');
    expect(c.querySelector('i').className).toBe('ph ph-x-circle');
    const gravadas = painel.messages.filter((m) => m.role === 'tool');
    expect(gravadas.map((m) => [m.toolName, m.status, m.error, m.toolUseId])).toEqual([
      ['write_file', 'denied', 'User denied the call', null],
      ['compile_all', 'failed', 'erro de sintaxe', null],
    ]);
  });

  it('id que nao casa cai no nome; o resultado de um id gravado vale o do chip', async () => {
    const emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'read_file', toolUseId: 't1' });
    emitir({ type: 'tool-result', toolName: 'read_file', result: { ok: true }, toolUseId: 'outro' });
    expect(chips()[0].className).toBe('ai-tool-chip done');
    expect(painel.messages.find((m) => m.role === 'tool').toolUseId).toBe('outro');
  });

  it('resultado sem chip correspondente so avisa no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitir = await turno();
    emitir({ type: 'tool-result', toolName: 'fantasma', result: { ok: true }, toolUseId: 'tx' });
    expect(warn).toHaveBeenCalledWith('[ai] tool-result with no matching running chip:', 'fantasma', 'tx');
    expect(painel.messages.some((m) => m.role === 'tool')).toBe(false);
    emitir({ type: 'tool-result', result: { ok: true } });
    expect(warn).toHaveBeenLastCalledWith('[ai] tool-result with no matching running chip:', 'tool', undefined);
  });

  it('o resultado que chega depois de o grupo fechar ainda fecha o chip', async () => {
    const emitir = await turno();
    emitir({ type: 'tool-call', toolName: 'lento', toolUseId: 't1' });
    emitir({ type: 'text-delta', delta: 'enquanto isso' });      // a prosa fecha o grupo
    emitir({ type: 'tool-result', toolName: 'lento', result: { ok: true }, toolUseId: 't1' });
    expect(chips()[0].className).toBe('ai-tool-chip done');
    expect(painel.messages.filter((m) => m.role === 'tool')).toHaveLength(1);
  });
});
