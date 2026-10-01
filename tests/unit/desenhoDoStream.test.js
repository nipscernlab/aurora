// @vitest-environment happy-dom
//
// Caracterizacao do desenho do texto que chega em stream no painel de IA: a
// maquina de escrever que solta um bloco grande aos poucos, o trecho recem
// chegado com o realce de entrada, o artefato de chamada de ferramenta que
// some da tela e a limpeza de balao vazio. O caminho comum (texto que chega e
// fecha o turno) esta no aiTurnFlow; aqui ficam as bordas. Escrito antes de o
// desenho sair do ai_assistant_manager (TODO 13.3) e rodado no `.js` antigo.
//
// Os quadros sao falsos e disparados pelo teste; o temporizador de 40 ms que
// corre junto e cancelado pelo quadro que dispara primeiro.

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
let quadros;

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

/** Um quadro: roda os pedidos pendentes (os pedidos durante ficam para o proximo). */
function quadro() {
  const q = quadros;
  quadros = [];
  for (const cb of q) if (cb) cb(0);
  return q.filter(Boolean).length;
}
/** Quadros ate a maquina de escrever alcancar o texto. */
function escoar() { for (let i = 0; i < 200 && quadro(); i++); }

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

const baloes = () => Array.from(painel.messagesEl.querySelectorAll('.ai-msg-assistant'));
const conteudo = () => baloes().at(-1)?.querySelector('.ai-msg-content');

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  quadros = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { quadros.push(cb); return quadros.length; });
  vi.stubGlobal('cancelAnimationFrame', (id) => { quadros[id - 1] = null; });
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  painel?._disarmStreamWatchdog?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('a maquina de escrever', () => {
  it('um bloco grande entra aos poucos, com o trecho novo realcado, ate o fim', async () => {
    const emitir = await turno();
    const texto = 'abcdefghij'.repeat(10);       // 100 caracteres de uma vez
    emitir({ type: 'text-delta', delta: texto });
    expect(baloes()).toHaveLength(0);            // nada antes do quadro
    quadro();
    expect(conteudo().textContent).toBe(texto.slice(0, 16));   // 16% da distancia
    expect(painel.thinkingEl).toBeNull();
    quadro();
    // o que ja estava na tela fica sem realce; o trecho novo vem num span
    expect(conteudo().querySelector('.ai-fade-reveal').textContent).toBe(texto.slice(16, 30));
    escoar();
    expect(conteudo().textContent).toBe(texto);
    expect(quadros).toHaveLength(0);
  });

  it('alcancado o texto, um pedaco que so acrescenta espaco redesenha o mesmo texto, sem o realce', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Ola.' });
    escoar();
    expect(conteudo().querySelector('.ai-fade-reveal')).toBeTruthy();   // o ultimo trecho
    emitir({ type: 'text-delta', delta: '   ' });
    escoar();
    expect(conteudo().innerHTML).toBe('<p>Ola.</p>');
  });

  it('pedaco vazio nao pede quadro', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: '' });
    emitir({ type: 'text-delta' });
    expect(quadros).toHaveLength(0);
  });

  it('com a cerca de codigo aberta no meio, desenha sem realce para nao quebrar o bloco', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Veja:\n```js\nconst a = 1;' });
    escoar();
    emitir({ type: 'text-delta', delta: '\nconst b = 2;\n```' });
    quadro();
    expect(conteudo().querySelector('.ai-fade-reveal')).toBeNull();
    expect(conteudo().textContent).toContain('const a = 1;');
  });
});

describe('o artefato de chamada de ferramenta', () => {
  const ABRE = '<tool_call>';
  const RESTO = '{"name": "compile_all", "arguments": {}}</tool_call>';

  it('o que aparecia e vira so artefato some, e o balao vazio sai junto', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: ABRE });
    escoar();
    expect(baloes()).toHaveLength(1);              // a abertura ainda nao casa: aparece
    emitir({ type: 'text-delta', delta: RESTO });
    escoar();
    expect(baloes()).toHaveLength(0);
    expect(painel.currentAssistantContentEl).toBeNull();
  });

  it('a chamada de ferramenta que chega antes do quadro tambem tira o balao do artefato', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: ABRE });
    escoar();
    emitir({ type: 'text-delta', delta: RESTO });
    emitir({ type: 'tool-call', toolName: 'compile_all', toolUseId: 't1' });
    expect(baloes()).toHaveLength(0);
    expect(painel.messages.filter((m) => m.role === 'assistant')).toEqual([]);
  });

  it('JSON de chamada sendo escrito token a token nao pisca na tela', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: '{"name": "x", "arguments": {}}' });
    escoar();
    expect(baloes()).toHaveLength(0);
  });
});

describe('o fecho do segmento', () => {
  it('o texto que chegou inteiro de uma vez entra em cascata; o que ja estava na tela, nao', async () => {
    let emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Um.\n\nDois.' });
    emitir({ type: 'finish' });                      // sem quadro: nada estava na tela
    const blocos = Array.from(conteudo().children);
    expect(blocos.map((b) => b.classList.contains('ai-reveal-block'))).toEqual([true, true]);
    expect(blocos.map((b) => b.style.animationDelay)).toEqual(['0ms', '45ms']);

    emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Um.\n\nDois.' });
    escoar();
    emitir({ type: 'finish' });
    expect(conteudo().querySelector('.ai-reveal-block')).toBeNull();
  });

  it('balao de assistente vazio que sobrar e removido no fecho; o que tem elemento fica', async () => {
    const emitir = await turno();
    painel.appendBubble('assistant', '');
    const comImagem = painel.appendBubble('assistant', '');
    comImagem.querySelector('.ai-msg-content').appendChild(document.createElement('img'));
    emitir({ type: 'text-delta', delta: 'fim' });
    emitir({ type: 'finish' });
    expect(baloes().map((b) => b.querySelector('.ai-msg-content').textContent.trim())).toEqual(['', 'fim']);
    expect(baloes()[0].querySelector('img')).toBeTruthy();
  });
});
