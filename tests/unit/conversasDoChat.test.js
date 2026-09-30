// @vitest-environment happy-dom
//
// Caracterizacao do ciclo da conversa no painel de IA: comecar uma nova, abrir
// uma do historico, gravar, renomear, apagar e o tutorial guiado. Escrito
// antes de o ciclo sair do ai_assistant_manager (TODO 13.3) e rodado no `.js`
// antigo.
//
// Tudo entra por onde a pessoa entra: o botao do historico, a linha da lista,
// os botoes de renomear e apagar, o "+" e o botao do tutorial. Nenhum caso
// falsifica metodo da instancia, porque falso de metodo nao sobrevive a
// extracao (licao do compilation_module). O mundo e o `window.aiAPI`, com a
// FORMA dos canais de main/ipc/ai.js: `listConversations` devolve `{ chats }`,
// `readConversation` devolve a conversa ou `null`.

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
import { showConfirm } from '../../js/ui/dialog_manager.js';
import { showCardNotification } from '../../js/ui/notification.js';
import { montarBlocoTutorial, aberturaDoTutorial } from '../../js/ai/api_tutorial.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

const SALVAS = [
  { id: 'c-1', title: 'Filtro FIR', provider: 'anthropic', updatedAt: Date.now(), cumulativeTokens: 1200 },
  { id: 'c-2', title: 'Divisor', provider: 'openai', updatedAt: Date.now(), cumulativeTokens: 0 },
];

function makeAiAPI(over = {}) {
  const api = {
    chamadas: { startChat: [], salvos: [] },
    emitir: null,
    listProviders: vi.fn(async () => ({ providers: [
      { name: 'anthropic', model: 'claude-x', defaultModel: 'claude-x' },
      { name: 'openai', model: 'gpt-y', defaultModel: 'gpt-y' },
      { name: 'google', model: 'g' },
    ] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true, openai: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-nova' })),
    onChatEvent: vi.fn((cb) => { api.emitir = cb; return () => { api.emitir = null; }; }),
    startChat: vi.fn(async (p) => { api.chamadas.startChat.push(p); return { ok: true }; }),
    abortChat: vi.fn(async () => ({ ok: true })),
    saveConversation: vi.fn(async (c) => { api.chamadas.salvos.push(c); return { ok: true, chat: c }; }),
    listConversations: vi.fn(async () => ({ chats: SALVAS.map((c) => ({ ...c })) })),
    readConversation: vi.fn(async () => null),
    renameConversation: vi.fn(async (id, title) => ({ ok: true, chat: { id, title } })),
    deleteConversation: vi.fn(async () => ({ ok: true })),
    setModel: vi.fn(async () => ({ ok: true })),
  };
  return Object.assign(api, over);
}

let api;
let painel;

/** Deixa as promessas encadeadas dos handlers de clique assentarem. */
async function assentar(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

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

/** Fecha o turno corrente com uma resposta. */
function responder(texto, usage) {
  const sid = api.chamadas.startChat.at(-1).sessionId;
  api.emitir({ sessionId: sid, type: 'text-delta', delta: texto });
  api.emitir({ sessionId: sid, type: 'finish', usage });
}

const clicar = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const botaoHistorico = () => painel.container.querySelector('#ai-history-btn');
const popover = () => painel.container.querySelector('#ai-history-popover');
const linhas = () => Array.from(painel.container.querySelectorAll('.ai-history-item'));
const linha = (id) => linhas().find((l) => l.dataset.chatId === id);
const titulos = () => linhas().map((l) => l.querySelector('.ai-history-item-title, .ai-history-item-rename')?.textContent ?? l.querySelector('input')?.value);
const vazioDaLista = () => painel.container.querySelector('#ai-history-list .ai-history-empty');

function bolhas() {
  return Array.from(painel.messagesEl.querySelectorAll('.ai-message')).map((el) => ({
    quem: el.classList.contains('ai-msg-user') ? 'user' : 'assistant',
    texto: semAnexos(el.querySelector('.ai-msg-content')).textContent.trim(),
  }));
}

/** O conteudo do balao sem a faixa de anexos, que mora dentro dele. */
function semAnexos(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.ai-msg-attachments').forEach((a) => a.remove());
  return c;
}

beforeEach(() => {
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
  showConfirm.mockReset().mockResolvedValue(true);
  showCardNotification.mockReset();
});

afterEach(() => {
  ProjectStore.clearProject();
  vi.useRealTimers();
  painel?._disarmStreamWatchdog?.();
  document.body.innerHTML = '';
});

describe('a lista do historico', () => {
  it('o botao abre a lista lida do main, com a conversa aberta marcada; clicar fora fecha', async () => {
    await abrirPainel();
    await mandar('oi');
    responder('ola');
    api.listConversations.mockResolvedValue({ chats: [...SALVAS, { id: 'c-nova', title: 'oi', provider: 'anthropic', updatedAt: Date.now() }] });

    clicar(botaoHistorico());
    await assentar();
    expect(popover().classList.contains('hidden')).toBe(false);
    expect(botaoHistorico().classList.contains('active')).toBe(true);
    expect(titulos()).toEqual(['Filtro FIR', 'Divisor', 'oi']);
    expect(linha('c-nova').classList.contains('active')).toBe(true);
    expect(linha('c-1').classList.contains('active')).toBe(false);

    // Clique dentro do popover nao fecha; fora, fecha.
    clicar(popover());
    expect(popover().classList.contains('hidden')).toBe(false);
    clicar(document.body);
    expect(popover().classList.contains('hidden')).toBe(true);
    expect(botaoHistorico().classList.contains('active')).toBe(false);

    // O botao alterna.
    clicar(botaoHistorico());
    clicar(botaoHistorico());
    expect(popover().classList.contains('hidden')).toBe(true);
  });

  it('a leitura que falha vira lista vazia; sem o canal, fica o que ja havia', async () => {
    await abrirPainel({ listConversations: vi.fn(async () => { throw new Error('disco'); }) });
    clicar(botaoHistorico());
    await assentar();
    expect(vazioDaLista()?.textContent).toBe('No saved chats yet.');

    await abrirPainel();
    clicar(botaoHistorico());
    await assentar();
    expect(titulos()).toEqual(['Filtro FIR', 'Divisor']);
    delete api.listConversations;
    clicar(botaoHistorico());
    clicar(botaoHistorico());
    await assentar();
    expect(titulos()).toEqual(['Filtro FIR', 'Divisor']);
  });
});

describe('abrir uma conversa do historico', () => {
  const GRAVADA = {
    id: 'c-1',
    title: 'Filtro FIR',
    provider: 'anthropic',
    createdAt: 1000,
    cumulativeTokens: 1234,
    messages: [
      { role: 'user', content: 'monta o filtro', attachments: [{ name: 'coef.txt', kind: 'file' }] },
      { role: 'assistant', content: 'Vou olhar.' },
      { role: 'tool', toolName: 'get_project_tree', status: 'done', args: { depth: 2 }, result: { ok: true } },
      { role: 'tool', toolName: 'write_file', status: 'failed', error: 'sem permissao' },
      { role: 'citation', citacoes: [{ titulo: 'Filtros', caminho: 'guia/filtros.md', trecho: 'x' }] },
      { role: 'assistant', content: 'Pronto.' },
      { role: 'tool', toolName: 'compile', status: 'denied' },
      { role: 'question', question: 'Qual ordem?', options: [], answer: '8' },
      null,
      { content: 'sem papel' },
      { role: 'assistant', content: { nao: 'string' } },
    ],
  };

  it('reproduz a conversa gravada: baloes, grupos de ferramentas, citacao, pergunta e anexos', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => structuredClone(GRAVADA)) });
    clicar(botaoHistorico());
    await assentar();
    clicar(linha('c-1'));
    await assentar();

    expect(api.readConversation).toHaveBeenCalledWith('c-1');
    expect(popover().classList.contains('hidden')).toBe(true);
    expect(painel.currentChatId).toBe('c-1');
    expect(painel.currentChatTitle).toBe('Filtro FIR');
    expect(painel.messages).toHaveLength(GRAVADA.messages.length);
    expect(painel.tokenCounter.textContent).toBe('1.2k');

    expect(bolhas()).toEqual([
      { quem: 'user', texto: 'monta o filtro' },
      { quem: 'assistant', texto: 'Vou olhar.' },
      { quem: 'assistant', texto: 'Pronto.' },
    ]);
    // A ordem de tudo na tela, que e a da conversa gravada.
    const ordem = Array.from(painel.messagesEl.children)
      .filter((el) => !el.classList.contains('ai-chat-empty-hint') && !el.classList.contains('ai-empty-hint'))
      .map((el) => el.className.split(' ')[0]);
    expect(ordem.filter((c) => c !== painel.chatEmptyHint?.className.split(' ')[0])).toEqual([
      'ai-message', 'ai-message', 'ai-tool-group', 'ai-citacoes', 'ai-message', 'ai-tool-group', 'ai-askq-record',
    ]);

    // Ferramentas seguidas viram UM grupo fechado, com o resultado de cada uma.
    const [g1, g2] = painel.messagesEl.querySelectorAll('.ai-tool-group');
    expect(g1.querySelector('.ai-tool-group-summary').textContent).toBe('2 actions');
    expect(g1.classList.contains('collapsed')).toBe(true);
    expect(g1.classList.contains('has-failure')).toBe(true);
    expect(Array.from(g1.querySelectorAll('.ai-tool-chip')).map((c) => c.className)).toEqual([
      'ai-tool-chip done', 'ai-tool-chip failed',
    ]);
    expect(g1.querySelectorAll('.ai-tool-chip')[1].title).toBe('error: sem permissao');
    expect(g2.querySelector('.ai-tool-group-summary').textContent).toBe('1 action');
    expect(g2.querySelector('.ai-tool-chip').className).toBe('ai-tool-chip denied');

    // Anexo gravado volta como ficha no balao.
    const user = painel.messagesEl.querySelector('.ai-msg-user');
    expect(user.querySelector('.ai-msg-attachments')?.textContent).toContain('coef.txt');
    // Com mensagens, a dica de conversa vazia some.
    if (painel.chatEmptyHint) expect(painel.chatEmptyHint.classList.contains('hidden')).toBe(true);
  });

  it('grava a conversa corrente antes de trocar', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => structuredClone(GRAVADA)) });
    await mandar('primeira');
    responder('resposta', { totalTokens: 10 });
    const antes = api.chamadas.salvos.length;

    clicar(botaoHistorico());
    await assentar();
    clicar(linha('c-1'));
    await assentar();

    expect(api.chamadas.salvos.length).toBe(antes + 1);
    expect(api.chamadas.salvos.at(-1)).toMatchObject({ id: 'c-nova', title: 'primeira' });
    expect(api.saveConversation.mock.invocationCallOrder.at(-1))
      .toBeLessThan(api.readConversation.mock.invocationCallOrder[0]);
    expect(painel.currentChatId).toBe('c-1');
  });

  it('troca para o provedor da conversa so se ele ainda estiver configurado', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => ({ ...structuredClone(GRAVADA), provider: 'openai' })) });
    expect(painel.currentProvider).toBe('anthropic');
    await painel.loadChat('c-1');
    expect(painel.currentProvider).toBe('openai');
    expect(painel.container.querySelector('input[name="ai-provider"][value="openai"]').checked).toBe(true);

    await abrirPainel({ readConversation: vi.fn(async () => ({ ...structuredClone(GRAVADA), provider: 'google' })) });
    await painel.loadChat('c-1');
    expect(painel.currentProvider).toBe('anthropic');
    expect(painel.currentChatId).toBe('c-1');
  });

  it('campos que faltam na conversa gravada tem padrao', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => ({ id: 'c-9' })) });
    const antes = Date.now();
    await painel.loadChat('c-9');
    expect(painel.currentChatTitle).toBe('Untitled');
    expect(painel.currentChatCreatedAt).toBeGreaterThanOrEqual(antes);
    expect(painel.messages).toEqual([]);
    expect(painel.tokenCounter.textContent).toBe('0');
    if (painel.chatEmptyHint) expect(painel.chatEmptyHint.classList.contains('hidden')).toBe(false);
  });

  it('nao abre: conversa que nao existe, leitura que falha, a mesma que ja esta, ou turno no meio', async () => {
    // A conversa gravada aqui nao tem o `null` da GRAVADA: um item nulo fica
    // em `messages` e o proximo envio quebra no buildApiMessages. O main nunca
    // grava isso (serializeMessagesForStorage), so um arquivo estragado.
    const LIMPA = { ...structuredClone(GRAVADA), messages: GRAVADA.messages.filter(Boolean) };
    await abrirPainel();
    await painel.loadChat('c-x');                        // readConversation -> null
    expect(painel.currentChatId).toBeNull();

    api.readConversation.mockRejectedValueOnce(new Error('disco'));
    await painel.loadChat('c-x');
    expect(painel.currentChatId).toBeNull();

    api.readConversation.mockResolvedValue(LIMPA);
    await painel.loadChat('c-1');
    expect(api.readConversation).toHaveBeenCalledTimes(3);
    await painel.loadChat('c-1');                        // a mesma
    expect(api.readConversation).toHaveBeenCalledTimes(3);

    await mandar('mais uma');                            // turno aberto
    await painel.loadChat('c-2');
    expect(api.readConversation).toHaveBeenCalledTimes(3);
    expect(painel.currentChatId).toBe('c-1');
  });
});

describe('gravar a conversa', () => {
  it('grava o que o main precisa, com o modelo do provedor e as mensagens serializadas', async () => {
    await abrirPainel();
    await mandar('compila');
    responder('ok', { totalTokens: 77 });

    const s = api.chamadas.salvos.at(-1);
    expect(s).toMatchObject({
      id: 'c-nova', title: 'compila', provider: 'anthropic', model: 'claude-x', cumulativeTokens: 77,
    });
    expect(typeof s.createdAt).toBe('number');
    expect(s.messages).toEqual([
      { role: 'user', content: 'compila' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('o total gravado ja inclui o uso do turno, tambem no finish que continua a sessao', async () => {
    // Gravava antes de somar, e o total no disco ficava um turno atras: a
    // conversa reaberta mostrava menos tokens do que tinha gasto.
    await abrirPainel();
    await mandar('compila');
    const sid = api.chamadas.startChat.at(-1).sessionId;
    api.emitir({ sessionId: sid, type: 'text-delta', delta: 'parte um' });
    api.emitir({ sessionId: sid, type: 'finish', more: true, usage: { totalTokens: 30 } });
    expect(api.chamadas.salvos.at(-1).cumulativeTokens).toBe(30);
    api.emitir({ sessionId: sid, type: 'text-delta', delta: 'parte dois' });
    api.emitir({ sessionId: sid, type: 'finish', usage: { totalTokens: 12 } });
    expect(api.chamadas.salvos.at(-1).cumulativeTokens).toBe(42);
  });

  it('sem mensagens ou sem canal, nao grava; a gravacao que falha so avisa', async () => {
    await abrirPainel();
    clicar(painel.container.querySelector('#ai-clear-btn'));
    await assentar();
    expect(api.saveConversation).not.toHaveBeenCalled();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.saveConversation.mockRejectedValueOnce(new Error('cheio'));
    await mandar('a');
    responder('b');
    await assentar();
    expect(warn).toHaveBeenCalledWith('[ai-panel] persist failed:', expect.any(Error));
    warn.mockRestore();

    delete api.saveConversation;
    clicar(painel.container.querySelector('#ai-clear-btn'));
    await assentar();
    expect(painel.messages).toEqual([]);
  });

  it('provedor sem entrada na lista grava modelo nulo e titulo padrao', async () => {
    await abrirPainel();
    await mandar('x');
    responder('y');
    painel.providersAvailable = [];
    painel.currentChatTitle = '';
    clicar(painel.container.querySelector('#ai-clear-btn'));
    await assentar();
    expect(api.chamadas.salvos.at(-1)).toMatchObject({ model: null, title: 'Untitled' });
  });
});

describe('conversa nova', () => {
  it('o "+" grava a corrente e zera tudo', async () => {
    await abrirPainel();
    await mandar('um');
    responder('dois', { totalTokens: 50 });
    const antes = api.chamadas.salvos.length;

    clicar(painel.container.querySelector('#ai-clear-btn'));
    await assentar();

    expect(api.chamadas.salvos.length).toBe(antes + 1);
    expect(painel.messages).toEqual([]);
    expect(bolhas()).toEqual([]);
    expect(painel.currentChatId).toBeNull();
    expect(painel.currentChatTitle).toBe('');
    expect(painel.cumulativeTokens).toBe(0);
    expect(painel.tokenCounter.textContent).toBe('0');
    if (painel.chatEmptyHint) {
      expect(painel.messagesEl.contains(painel.chatEmptyHint)).toBe(true);
      expect(painel.chatEmptyHint.classList.contains('hidden')).toBe(false);
    }

    // A proxima mensagem abre outra conversa.
    api.newConversationId.mockResolvedValue({ id: 'c-outra' });
    await mandar('tres');
    expect(api.chamadas.startChat.at(-1).conversationId).toBe('c-outra');
    expect(api.chamadas.startChat.at(-1).messages).toEqual([{ role: 'user', content: 'tres' }]);
  });

  it('o "Novo" do historico fecha a lista e comeca outra', async () => {
    await abrirPainel();
    await mandar('um');
    responder('dois');
    clicar(botaoHistorico());
    await assentar();
    clicar(painel.container.querySelector('#ai-history-new'));
    await assentar();
    expect(popover().classList.contains('hidden')).toBe(true);
    expect(painel.messages).toEqual([]);
    expect(painel.currentChatId).toBeNull();
  });

  it('com turno no meio, nao faz nada', async () => {
    await abrirPainel();
    await mandar('um');
    // O botao fica desabilitado durante o turno; a guarda de dentro e a que
    // vale para quem chama sem passar por ele (o "Novo" do historico, o tutorial).
    expect(painel.clearBtn.disabled).toBe(true);
    await painel.newChat();
    expect(painel.messages).toHaveLength(1);
    expect(painel.currentChatId).toBe('c-nova');
  });
});

describe('renomear pela lista', () => {
  async function abrirLista() {
    await abrirPainel();
    clicar(botaoHistorico());
    await assentar();
  }
  const renomear = (id) => clicar(linha(id).querySelector('[data-action="rename"]'));
  const campo = (id) => linha(id).querySelector('input.ai-history-item-rename');
  const tecla = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('Enter grava o nome novo e relê a lista, sem abrir a conversa nem fechar a lista', async () => {
    await abrirLista();
    renomear('c-1');
    const input = campo('c-1');
    expect(input.value).toBe('Filtro FIR');
    input.value = '  FIR de 8 taps ';
    const lidas = api.listConversations.mock.calls.length;
    tecla(input, 'Enter');
    await assentar();
    expect(api.renameConversation).toHaveBeenCalledWith('c-1', 'FIR de 8 taps');
    expect(api.listConversations.mock.calls.length).toBe(lidas + 1);
    expect(api.readConversation).not.toHaveBeenCalled();
    expect(popover().classList.contains('hidden')).toBe(false);
  });

  it('renomear a conversa aberta troca o titulo que ela grava', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => ({ id: 'c-1', title: 'Filtro FIR', messages: [{ role: 'user', content: 'a' }] })) });
    await painel.loadChat('c-1');
    clicar(botaoHistorico());
    await assentar();
    renomear('c-1');
    campo('c-1').value = 'Outro';
    tecla(campo('c-1'), 'Enter');
    await assentar();
    expect(painel.currentChatTitle).toBe('Outro');
  });

  it('Escape, nome vazio ou o mesmo nome nao gravam; o titulo volta', async () => {
    await abrirLista();
    renomear('c-1');
    campo('c-1').value = 'descartado';
    tecla(campo('c-1'), 'Escape');
    await assentar();
    expect(linha('c-1').querySelector('.ai-history-item-title').textContent).toBe('Filtro FIR');
    expect(api.renameConversation).not.toHaveBeenCalled();

    renomear('c-2');
    campo('c-2').value = '   ';
    tecla(campo('c-2'), 'Enter');
    await assentar();
    expect(linha('c-2').querySelector('.ai-history-item-title').textContent).toBe('Divisor');

    renomear('c-2');
    tecla(campo('c-2'), 'Enter');
    await assentar();
    expect(api.renameConversation).not.toHaveBeenCalled();
  });

  it('o campo fecha uma vez so: o blur que chega depois do Enter ou do Escape nao faz nada', async () => {
    // O campo sai do DOM com o foco nele, e o navegador pode disparar `blur`
    // nessa hora. Sem a trava, o blur depois do Escape gravava o nome que a
    // pessoa acabou de descartar.
    await abrirLista();
    renomear('c-1');
    const esc = campo('c-1');
    esc.value = 'descartado';
    tecla(esc, 'Escape');
    esc.dispatchEvent(new Event('blur'));
    await assentar();
    expect(api.renameConversation).not.toHaveBeenCalled();

    renomear('c-2');
    const ent = campo('c-2');
    ent.value = 'Divisor 2';
    tecla(ent, 'Enter');
    ent.dispatchEvent(new Event('blur'));
    await assentar();
    expect(api.renameConversation).toHaveBeenCalledTimes(1);
  });

  it('perder o foco grava; a gravacao que falha ainda relê a lista', async () => {
    await abrirLista();
    api.renameConversation.mockRejectedValueOnce(new Error('disco'));
    renomear('c-2');
    const input = campo('c-2');
    input.value = 'Divisor novo';
    const lidas = api.listConversations.mock.calls.length;
    input.dispatchEvent(new Event('blur'));
    await assentar();
    expect(api.renameConversation).toHaveBeenCalledWith('c-2', 'Divisor novo');
    expect(api.listConversations.mock.calls.length).toBe(lidas + 1);
  });
});

describe('apagar pela lista', () => {
  async function abrirLista(over) {
    await abrirPainel(over);
    clicar(botaoHistorico());
    await assentar();
  }
  const apagar = (id) => clicar(linha(id).querySelector('[data-action="delete"]'));

  it('pergunta antes; recusar nao apaga', async () => {
    await abrirLista();
    showConfirm.mockResolvedValueOnce(false);
    apagar('c-1');
    await assentar();
    expect(showConfirm).toHaveBeenCalledWith('Delete chat?', 'This conversation will be deleted permanently.', {
      variant: 'warning', confirmLabel: 'Delete', danger: true,
    });
    expect(api.deleteConversation).not.toHaveBeenCalled();
    expect(linha('c-1')).toBeTruthy();
    expect(api.readConversation).not.toHaveBeenCalled();
  });

  it('confirmar apaga no main e tira a linha animando, sem reler a lista', async () => {
    await abrirLista();
    const card = linha('c-1');
    const lidas = api.listConversations.mock.calls.length;
    apagar('c-1');
    await assentar();
    expect(api.deleteConversation).toHaveBeenCalledWith('c-1');
    expect(card.classList.contains('removing')).toBe(true);
    expect(card.isConnected).toBe(true);

    // Transicao de outra propriedade nao conta; a de altura tira a linha.
    card.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    expect(card.isConnected).toBe(true);
    card.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'height' }));
    expect(card.isConnected).toBe(false);
    expect(titulos()).toEqual(['Divisor']);
    expect(api.listConversations.mock.calls.length).toBe(lidas);
  });

  it('sem transitionend, a linha sai pelo prazo; apagar a ultima mostra a lista vazia', async () => {
    await abrirLista({ listConversations: vi.fn(async () => ({ chats: [{ ...SALVAS[0] }] })) });
    vi.useFakeTimers();
    const card = linha('c-1');
    apagar('c-1');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(card.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(450);
    expect(card.isConnected).toBe(false);
    expect(vazioDaLista()?.textContent).toBe('No saved chats yet.');
    // A transicao que chega depois do prazo nao roda o fim duas vezes.
    card.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' }));
    expect(vazioDaLista()).toBeTruthy();
  });

  it('apagar a conversa aberta zera o painel; o main que falha nao trava', async () => {
    await abrirPainel({ readConversation: vi.fn(async () => ({ id: 'c-1', title: 'Filtro FIR', cumulativeTokens: 900, messages: [{ role: 'user', content: 'a' }] })) });
    await painel.loadChat('c-1');
    api.deleteConversation.mockRejectedValueOnce(new Error('disco'));
    clicar(botaoHistorico());
    await assentar();
    apagar('c-1');
    await assentar();
    expect(painel.currentChatId).toBeNull();
    expect(painel.currentChatTitle).toBe('');
    expect(painel.messages).toEqual([]);
    expect(bolhas()).toEqual([]);
    expect(painel.tokenCounter.textContent).toBe('0');
    if (painel.chatEmptyHint) expect(painel.chatEmptyHint.classList.contains('hidden')).toBe(false);
  });

  it('a linha que nao esta na tela sai direto da lista em memoria', async () => {
    await abrirLista();
    painel.historyList.innerHTML = '';
    await painel.deleteChat('c-2');
    expect(painel.chatList.map((c) => c.id)).toEqual(['c-1']);
    expect(api.deleteConversation).toHaveBeenCalledWith('c-2');
  });

  it('clique na lista fora de uma linha nao faz nada', async () => {
    await abrirLista();
    clicar(painel.historyList);
    await assentar();
    expect(api.readConversation).not.toHaveBeenCalled();
    expect(popover().classList.contains('hidden')).toBe(false);
  });
});

describe('o tutorial guiado', () => {
  const botaoTutorial = () => painel.container.querySelector('#ai-tutorial-btn');

  it('comeca uma conversa nova com o bloco no system prompt e a abertura ja enviada', async () => {
    await abrirPainel();
    await mandar('antes');
    responder('ok');
    const salvosAntes = api.chamadas.salvos.length;

    clicar(botaoTutorial());
    await assentar(10);

    expect(api.chamadas.salvos.length).toBe(salvosAntes + 1);
    const p = api.chamadas.startChat.at(-1);
    const manual = { paginas: [], motivo: 'a busca no manual nao esta disponivel nesta janela' };
    expect(p.systemFixo).toBe(montarBlocoTutorial('pt', manual));
    expect(p.messages).toEqual([{ role: 'user', content: aberturaDoTutorial('pt') }]);

    // O bloco morre com a conversa.
    responder('vamos la');
    clicar(painel.container.querySelector('#ai-clear-btn'));
    await assentar();
    await mandar('outra coisa');
    expect(api.chamadas.startChat.at(-1).systemFixo).toBeUndefined();
  });

  it('em ingles quando o idioma escolhido e ingles', async () => {
    await abrirPainel();
    localStorage.setItem('aurora-locale', 'en');
    clicar(botaoTutorial());
    await assentar(10);
    const p = api.chamadas.startChat.at(-1);
    expect(p.messages[0].content).toBe(aberturaDoTutorial('en'));
    expect(p.systemFixo).toBe(montarBlocoTutorial('en', { paginas: [], motivo: 'a busca no manual nao esta disponivel nesta janela' }));
  });

  it('recusa com aviso: turno no meio, ou sem provedor', async () => {
    await abrirPainel();
    await mandar('um');
    clicar(botaoTutorial());
    await assentar();
    expect(showCardNotification).toHaveBeenCalledWith('ai.tutorial.busy', 'warning', 4000, 'Aurora Intelligence');
    expect(api.chamadas.startChat).toHaveLength(1);

    await abrirPainel();
    painel.currentProvider = null;
    clicar(botaoTutorial());
    await assentar();
    expect(showCardNotification).toHaveBeenCalledWith('ai.tutorial.noProvider', 'warning', 5000, 'Aurora Intelligence');
    expect(api.startChat).not.toHaveBeenCalled();
  });
});
