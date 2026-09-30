// @vitest-environment happy-dom
//
// Caracterizacao dos dois cartoes com que a assistente para e pergunta a
// pessoa no meio do chat: o de permissao (Allow/Deny antes de uma ferramenta)
// e o de pergunta (ask_user_question), com o registro que fica no lugar dele.
// Escrito antes de os cartoes sairem do ai_assistant_manager (TODO 13.3) e
// rodado no `.js` antigo.
//
// Entra pelas portas de fora: `confirmToolCall`, que o tool_runner chama antes
// de cada ferramenta, `showAskUserQuestionInline`, que o aurora_api chama, os
// botoes do cartao, o Stop, e o `loadChat` para o registro reaberto.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({
  TabManager: { addTab: vi.fn(), tabs: new Map() },
}));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { PERMISSION_STORE_KEY } from '../../js/ai/ai_metadata.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

function makeAiAPI(over = {}) {
  const api = {
    chamadas: { startChat: [], abort: [] },
    emitir: null,
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'claude-x', defaultModel: 'claude-x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-teste' })),
    onChatEvent: vi.fn((cb) => { api.emitir = cb; return () => { api.emitir = null; }; }),
    startChat: vi.fn(async (p) => { api.chamadas.startChat.push(p); return { ok: true }; }),
    abortChat: vi.fn(async (sid) => { api.chamadas.abort.push(sid); return { ok: true }; }),
    saveConversation: vi.fn(async () => ({ ok: true })),
    listConversations: vi.fn(async () => ({ chats: [] })),
    readConversation: vi.fn(async () => null),
    renameConversation: vi.fn(async () => ({ ok: true })),
    deleteConversation: vi.fn(async () => ({ ok: true })),
    setModel: vi.fn(async () => ({ ok: true })),
  };
  return Object.assign(api, over);
}

let api;
let painel;

async function abrirPainel(over) {
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
}

/** Espera a promessa sem travar o teste quando ela nao resolve. */
function estado(promessa) {
  const r = { resolvido: false, valor: undefined };
  promessa.then((v) => { r.resolvido = true; r.valor = v; });
  return r;
}

const assentar = () => new Promise((r) => setTimeout(r, 0));
const cartao = () => painel.messagesEl.querySelector('.ai-confirm:not(.done)');
const pergunta = () => painel.messagesEl.querySelector('.ai-ask-question:not(.done)');
const txt = (el, sel) => el.querySelector(sel)?.textContent.trim();

beforeEach(() => {
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  vi.useRealTimers();
  painel?._disarmStreamWatchdog?.();
  document.body.innerHTML = '';
});

describe('o cartao de permissao', () => {
  const LEITURA = { name: 'get_project_tree', access: 'read', description: 'Lista a arvore.' };
  const ESCRITA = { name: 'write_file', access: 'write', description: 'Grava um arquivo.' };

  it('o modo decide: "allow" libera sem cartao, "writes" so pergunta a escrita, "ask" pergunta tudo', async () => {
    localStorage.setItem(PERMISSION_STORE_KEY, 'allow');
    await abrirPainel();
    expect(await painel.confirmToolCall(ESCRITA, {})).toBe(true);
    expect(cartao()).toBeNull();

    localStorage.setItem(PERMISSION_STORE_KEY, 'writes');
    await abrirPainel();
    expect(await painel.confirmToolCall(LEITURA, {})).toBe(true);
    const e = estado(painel.confirmToolCall(ESCRITA, {}));
    await assentar();
    expect(cartao()).toBeTruthy();
    expect(e.resolvido).toBe(false);

    localStorage.setItem(PERMISSION_STORE_KEY, 'ask');
    await abrirPainel();
    estado(painel.confirmToolCall(LEITURA, {}));
    await assentar();
    expect(cartao()).toBeTruthy();
  });

  it('mostra o que a ferramenta faz, a prosa do modelo como texto e o resto em JSON', async () => {
    localStorage.setItem(PERMISSION_STORE_KEY, 'ask');
    await abrirPainel();
    estado(painel.confirmToolCall(ESCRITA, { path: 'C:/proj/a.v', note: '  Vou gravar <b>isto</b>  ' }));
    await assentar();
    const c = cartao();
    expect(txt(c, '.ai-confirm-head')).toBe('Aurora Intelligence wants to make a change');
    expect(txt(c, '.ai-confirm-tool')).toBe('write_file');
    expect(txt(c, '.ai-confirm-desc')).toBe('Grava um arquivo.');
    const notas = Array.from(c.querySelectorAll('.ai-confirm-note')).map((n) => [txt(n, '.ai-confirm-note-key'), txt(n, '.ai-confirm-note-text')]);
    expect(notas).toEqual([['note', 'Vou gravar <b>isto</b>']]);
    expect(c.querySelector('.ai-confirm-note-text b')).toBeNull();          // texto, nunca marcacao
    expect(c.querySelector('.ai-confirm-args').textContent).toBe(JSON.stringify({ path: 'C:/proj/a.v' }, null, 2));
  });

  it('sem prosa nem argumentos, as duas areas saem; sem def, "tool" e leitura', async () => {
    localStorage.setItem(PERMISSION_STORE_KEY, 'ask');
    await abrirPainel();
    estado(painel.confirmToolCall(null, undefined));
    await assentar();
    const c = cartao();
    expect(txt(c, '.ai-confirm-head')).toBe('Aurora Intelligence wants to read something');
    expect(txt(c, '.ai-confirm-tool')).toBe('tool');
    expect(txt(c, '.ai-confirm-desc')).toBe('');
    expect(c.querySelector('.ai-confirm-notes')).toBeNull();
    expect(c.querySelector('.ai-confirm-args')).toBeNull();

    estado(painel.confirmToolCall({ name: 'x', access: 'read' }, {}));
    await assentar();
    expect(txt(cartao(), '.ai-confirm-desc')).toBe('');
  });

  it('Allow libera, Deny recusa; so o primeiro clique conta; o cartao some depois', async () => {
    localStorage.setItem(PERMISSION_STORE_KEY, 'ask');
    await abrirPainel();
    vi.useFakeTimers();

    const sim = estado(painel.confirmToolCall(LEITURA, {}));
    await vi.advanceTimersByTimeAsync(20);
    const c1 = cartao();
    expect(c1.classList.contains('enter')).toBe(false);     // o quadro seguinte tira a entrada
    expect(painel.pendingConfirms.size).toBe(1);
    c1.querySelector('.ai-confirm-allow').click();
    c1.querySelector('.ai-confirm-deny').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sim).toEqual({ resolvido: true, valor: true });
    expect(painel.pendingConfirms.size).toBe(0);
    expect(c1.classList.contains('done')).toBe(true);
    expect(c1.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(180);
    expect(c1.isConnected).toBe(false);

    const nao = estado(painel.confirmToolCall(LEITURA, {}));
    await vi.advanceTimersByTimeAsync(20);
    cartao().querySelector('.ai-confirm-deny').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(nao).toEqual({ resolvido: true, valor: false });
  });

  it('o Stop recusa o cartao aberto, e o cao de guarda nao resgata por cima dele', async () => {
    localStorage.setItem(PERMISSION_STORE_KEY, 'ask');
    await abrirPainel();
    vi.useFakeTimers();
    await mandar('grava');
    const e = estado(painel.confirmToolCall(ESCRITA, {}));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(api.chamadas.abort).toEqual([]);
    expect(e.resolvido).toBe(false);

    await painel.stop();
    const sid = api.chamadas.startChat[0].sessionId;
    api.emitir({ sessionId: sid, type: 'aborted' });
    await vi.advanceTimersByTimeAsync(0);
    expect(e).toEqual({ resolvido: true, valor: false });
    expect(painel.pendingConfirms.size).toBe(0);
  });
});

describe('o cartao de pergunta', () => {
  const OPCOES = [
    { label: 'Ordem 8', description: 'mais barato' },
    { label: 'Ordem <16>' },
    { description: 'sem rotulo' },
  ];

  it('mostra a pergunta e as opcoes como texto; radio numa escolha, checkbox em varias', async () => {
    await abrirPainel();
    estado(painel.showAskUserQuestionInline({ question: 'Qual <i>ordem</i>?', options: OPCOES }));
    const c = pergunta();
    expect(txt(c, '.ai-askq-head')).toBe('Aurora Intelligence is asking');
    expect(txt(c, '.ai-askq-question')).toBe('Qual <i>ordem</i>?');
    expect(c.querySelector('.ai-askq-question i')).toBeNull();
    const ops = Array.from(c.querySelectorAll('.ai-askq-opt'));
    expect(ops.map((o) => txt(o, '.ai-askq-opt-label'))).toEqual(['Ordem 8', 'Ordem <16>', 'Option 3']);
    expect(ops.map((o) => txt(o, '.ai-askq-opt-desc') ?? null)).toEqual(['mais barato', null, 'sem rotulo']);
    expect(ops.every((o) => o.querySelector('input').type === 'radio')).toBe(true);
    expect(c.querySelector('.ai-askq-other-input').getAttribute('placeholder')).toBe('ai.customAnswerPlaceholder');

    estado(painel.showAskUserQuestionInline({ question: 'Quais?', options: OPCOES, multiSelect: true }));
    const cs = Array.from(painel.messagesEl.querySelectorAll('.ai-ask-question')).at(-1);
    expect(Array.from(cs.querySelectorAll('input[name="ai-askq-opt"]')).every((i) => i.type === 'checkbox')).toBe(true);

    estado(painel.showAskUserQuestionInline({ question: 'Livre', options: 'nao e lista' }));
    const cl = Array.from(painel.messagesEl.querySelectorAll('.ai-ask-question')).at(-1);
    expect(cl.querySelectorAll('.ai-askq-opt')).toHaveLength(0);

    estado(painel.showAskUserQuestionInline());
    expect(painel.pendingAskUserQuestions.size).toBe(4);
  });

  it('abre o painel se ele ainda nao foi montado', async () => {
    api = makeAiAPI();
    window.aiAPI = api;
    document.body.innerHTML = '<div class="main-container"></div>';
    painel = new AIAssistantManager();
    estado(painel.showAskUserQuestionInline({ question: 'oi?' }));
    expect(painel.container).toBeTruthy();
    expect(pergunta()).toBeTruthy();
  });

  it('enviar sem escolher nem escrever sacode o cartao e ele fica', async () => {
    await abrirPainel();
    vi.useFakeTimers();
    const e = estado(painel.showAskUserQuestionInline({ question: 'Qual?', options: OPCOES }));
    const c = pergunta();
    c.querySelector('.ai-askq-submit').click();
    expect(c.classList.contains('shake')).toBe(true);
    await vi.advanceTimersByTimeAsync(320);
    expect(c.classList.contains('shake')).toBe(false);
    expect(e.resolvido).toBe(false);
    expect(painel.pendingAskUserQuestions.size).toBe(1);
  });

  it('uma escolha: a resposta e o rotulo, e o registro fica no lugar do cartao e em messages', async () => {
    await abrirPainel();
    vi.useFakeTimers();
    const e = estado(painel.showAskUserQuestionInline({ question: 'Qual?', options: OPCOES }));
    const c = pergunta();
    c.querySelectorAll('input[name="ai-askq-opt"]')[1].checked = true;
    c.querySelector('.ai-askq-submit').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.valor).toEqual({ answer: 'Ordem <16>', selected: ['Ordem <16>'] });
    expect(painel.messages.at(-1)).toEqual({
      role: 'question', question: 'Qual?', selected: ['Ordem <16>'], custom: '', cancelled: false,
    });
    const reg = c.previousElementSibling;
    expect(reg.className).toBe('ai-askq-record');
    expect(txt(reg, '.ai-askq-record-head')).toBe('You answered');
    expect(txt(reg, '.ai-askq-record-q')).toBe('Qual?');
    expect(Array.from(reg.querySelectorAll('.ai-askq-record-chip')).map((x) => x.textContent.trim())).toEqual(['Ordem <16>']);
    expect(reg.querySelector('.ai-askq-record-custom')).toBeNull();
    expect(painel.pendingAskUserQuestions.size).toBe(0);
    await vi.advanceTimersByTimeAsync(180);
    expect(c.isConnected).toBe(false);
    expect(reg.isConnected).toBe(true);
  });

  it('varias escolhas juntam os rotulos; o texto proprio manda, com as escolhas de apoio', async () => {
    await abrirPainel();
    const multi = estado(painel.showAskUserQuestionInline({ question: 'Quais?', options: OPCOES, multiSelect: true }));
    let c = pergunta();
    const caixas = c.querySelectorAll('input[name="ai-askq-opt"]');
    caixas[0].checked = true;
    caixas[2].checked = true;
    c.querySelector('.ai-askq-submit').click();
    await assentar();
    // A opcao sem rotulo nao entra na resposta (o "Option 3" e so desenho).
    expect(multi.valor).toEqual({ answer: 'Ordem 8', selected: ['Ordem 8'] });

    const ambos = estado(painel.showAskUserQuestionInline({ question: 'Quais?', options: OPCOES, multiSelect: true }));
    c = pergunta();
    c.querySelectorAll('input[name="ai-askq-opt"]')[0].checked = true;
    c.querySelectorAll('input[name="ai-askq-opt"]')[1].checked = true;
    c.querySelector('.ai-askq-other-input').value = '  ordem 12  ';
    c.querySelector('.ai-askq-submit').click();
    await assentar();
    expect(ambos.valor).toEqual({ answer: 'ordem 12 (also selected: Ordem 8, Ordem <16>)', selected: ['Ordem 8', 'Ordem <16>'] });
    expect(painel.messages.at(-1).custom).toBe('ordem 12');
    const reg = painel.messagesEl.querySelectorAll('.ai-askq-record');
    expect(txt(reg[reg.length - 1], '.ai-askq-record-custom')).toBe('ordem 12');
  });

  it('Enter no campo envia so o texto; Shift+Enter nao envia', async () => {
    await abrirPainel();
    const e = estado(painel.showAskUserQuestionInline({ question: 'Qual?' }));
    const campo = pergunta().querySelector('.ai-askq-other-input');
    campo.value = 'a minha';
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await assentar();
    expect(e.resolvido).toBe(false);
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await assentar();
    expect(e.valor).toEqual({ answer: 'a minha', selected: [] });
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  });

  it('Cancelar responde que a pessoa cancelou e deixa o registro de dispensa', async () => {
    await abrirPainel();
    const e = estado(painel.showAskUserQuestionInline({ question: 'Qual?', options: OPCOES }));
    const c = pergunta();
    c.querySelector('.ai-askq-cancel').click();
    c.querySelector('.ai-askq-cancel').click();
    await assentar();
    expect(e.valor).toEqual({ answer: '[user cancelled the question]', selected: [] });
    expect(painel.messages.filter((m) => m.role === 'question')).toEqual([
      { role: 'question', question: 'Qual?', selected: [], custom: '', cancelled: true },
    ]);
    const reg = c.previousElementSibling;
    expect(reg.className).toBe('ai-askq-record cancelled');
    expect(txt(reg, '.ai-askq-record-head')).toBe('You dismissed a question');
    expect(reg.querySelector('.ai-askq-record-chips')).toBeNull();
  });

  it('o turno que acaba responde que abortou, sem registro', async () => {
    await abrirPainel();
    await mandar('pergunta algo');
    const e = estado(painel.showAskUserQuestionInline({ question: 'Qual?' }));
    await painel.stop();
    api.emitir({ sessionId: api.chamadas.startChat[0].sessionId, type: 'aborted' });
    await assentar();
    expect(e.valor).toEqual({ answer: '[turn aborted before user answered]', selected: [] });
    expect(painel.messages.some((m) => m.role === 'question')).toBe(false);
    expect(painel.messagesEl.querySelector('.ai-askq-record')).toBeNull();
  });
});

describe('o registro reaberto', () => {
  it('a conversa reaberta desenha o registro igual ao ao vivo', async () => {
    await abrirPainel({
      readConversation: vi.fn(async () => ({
        id: 'c-1',
        messages: [
          { role: 'question', question: 'Qual?', selected: ['A', 7], custom: 'e mais', cancelled: false },
          { role: 'question', question: 'Outra?', selected: 'nao e lista', cancelled: true },
          { role: 'question' },
        ],
      })),
    });
    await painel.loadChat('c-1');
    const [r1, r2, r3] = painel.messagesEl.querySelectorAll('.ai-askq-record');
    expect(Array.from(r1.querySelectorAll('.ai-askq-record-chip')).map((x) => x.textContent.trim())).toEqual(['A', '7']);
    expect(txt(r1, '.ai-askq-record-custom')).toBe('e mais');
    expect(r1.querySelector('.ai-askq-record-head i').className).toBe('ph ph-check-circle');
    expect(r2.className).toBe('ai-askq-record cancelled');
    expect(r2.querySelector('.ai-askq-record-head i').className).toBe('ph ph-x-circle');
    expect(r2.querySelector('.ai-askq-record-chips')).toBeNull();
    expect(txt(r3, '.ai-askq-record-q')).toBe('');
  });
});
