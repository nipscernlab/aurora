// @vitest-environment happy-dom
//
// Caracterizacao das citacoes do manual no painel de IA: o evento `citation`
// do stream, o carimbo da versao do manual, o bloco embaixo da resposta, o
// clique que abre a pagina e a explicacao quando o clique nao chega ao ponto.
// A colheita pela ferramenta cite_manual tem caso proprio no aiTurnFlow; esta e
// a outra metade. Escrito antes de as citacoes sairem do ai_assistant_manager
// (TODO 13.3) e rodado no `.js` antigo.

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

const assentar = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
function quadro() { const q = quadros; quadros = []; for (const cb of q) cb(0); }

const A = { pagina: 'guia/filtros.md', titulo: 'Filtros', trecho: 'A media movel suaviza o sinal.' };
const B = { pagina: 'guia/ula.md', titulo: '', trecho: '' };

/** Abre o painel, manda uma pergunta e devolve quem emite na sessao dela. */
async function turno() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  await assentar();                                   // a versao do manual chega
  painel.inputEl.value = 'o que e media movel?';
  await painel.send();
  const sid = api.chamadas.at(-1).sessionId;
  return (ev) => api.emitir({ sessionId: sid, ...ev });
}

const blocos = () => painel.messagesEl.querySelectorAll('.ai-citacoes');
const itens = () => Array.from(painel.messagesEl.querySelectorAll('.ai-citacao'));

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  quadros = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { quadros.push(cb); return quadros.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = {
    componentesListar: vi.fn(async () => ({ componentes: [] })),
    docsStatus: vi.fn(async () => ({ version: '6.4.2' })),
    docsOpenHelp: vi.fn(async () => ({ ok: true })),
    docsRealceDesfecho: vi.fn(async () => ({ achou: true })),
  };
  window.i18nApplyDOM = undefined;
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

describe('o evento citation do stream', () => {
  it('junta no turno, uma linha por frase, e desenha embaixo do texto no fim, com a versao do manual', async () => {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Ela suaviza.' });
    emitir({ type: 'citation', citacao: { ...A } });
    emitir({ type: 'citation', citacao: { ...A } });           // a mesma frase de novo
    emitir({ type: 'citation', citacao: { ...B } });
    emitir({ type: 'citation' });                              // sem citacao: nada
    expect(blocos()).toHaveLength(0);                          // so no fim do turno
    emitir({ type: 'finish' });

    expect(blocos()).toHaveLength(1);
    const bloco = blocos()[0];
    expect(bloco.previousElementSibling.classList.contains('ai-message')).toBe(true);
    expect(bloco.querySelector('.ai-citacoes-head').textContent).toBe('From the manual');
    expect(bloco.querySelector('.ai-citacoes-head').getAttribute('data-i18n')).toBe('ai.citations.head');
    const [a, b] = itens();
    expect(a.querySelector('.ai-citacao-pagina').textContent).toBe('Filtros');
    expect(a.querySelector('.ai-citacao-pagina').title).toBe('guia/filtros.md');
    expect(a.querySelector('.ai-citacao-trecho').textContent).toBe(A.trecho);
    expect(b.querySelector('.ai-citacao-pagina').textContent).toBe('guia/ula.md');   // sem titulo, a pagina
    expect(b.querySelector('.ai-citacao-trecho').textContent).toBe('');

    expect(painel.messages.at(-1)).toEqual({
      role: 'citation',
      citacoes: [{ ...A, versao: '6.4.2' }, { ...B, versao: '6.4.2' }],
    });
    expect(api.saveConversation.mock.calls.at(-1)[0].messages.at(-1).citacoes[0].versao).toBe('6.4.2');
  });

  it('turno sem citacao nao desenha bloco; sem versao do manual, nao carimba', async () => {
    window.electronAPI.docsStatus = vi.fn(async () => { throw new Error('sem manual'); });
    let emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Nada a citar.' });
    emitir({ type: 'finish' });
    expect(blocos()).toHaveLength(0);
    expect(painel.messages.some((m) => m.role === 'citation')).toBe(false);

    emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Agora sim.' });
    emitir({ type: 'citation', citacao: { ...A } });
    emitir({ type: 'finish' });
    expect(painel.messages.at(-1).citacoes[0]).not.toHaveProperty('versao');
  });

  it('a versao e relida quando a janela volta ao foco', async () => {
    await turno();
    window.electronAPI.docsStatus.mockResolvedValue({ version: '6.5.0' });
    window.dispatchEvent(new Event('focus'));
    await assentar();
    expect(painel._versaoDoManual).toBe('6.5.0');
  });
});

describe('o bloco embaixo da resposta', () => {
  async function comBloco(citacoes = [A]) {
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Resposta.' });
    for (const c of citacoes) emitir({ type: 'citation', citacao: { ...c } });
    emitir({ type: 'finish' });
    return itens();
  }

  it('o botao de expandir so aparece quando a frase nao coube, e alterna o texto', async () => {
    const [item] = await comBloco();
    const mais = item.querySelector('.ai-citacao-mais');
    expect(mais.classList.contains('hidden')).toBe(true);
    const trecho = item.querySelector('.ai-citacao-trecho');
    Object.defineProperty(trecho, 'scrollHeight', { value: 60 });
    Object.defineProperty(trecho, 'clientHeight', { value: 40 });
    quadro();
    expect(mais.classList.contains('hidden')).toBe(false);

    window.i18nApplyDOM = vi.fn();
    mais.click();
    expect(item.classList.contains('aberta')).toBe(true);
    expect(mais.textContent).toBe('Collapse');
    expect(mais.getAttribute('data-i18n')).toBe('ai.citations.collapse');
    expect(window.i18nApplyDOM).toHaveBeenCalledWith(mais);
    mais.click();
    expect(mais.textContent).toBe('Expand');
    expect(mais.getAttribute('data-i18n')).toBe('ai.citations.expand');
  });

  it('a frase que cabe (com um pixel de folga) nao ganha botao', async () => {
    const [item] = await comBloco();
    const trecho = item.querySelector('.ai-citacao-trecho');
    Object.defineProperty(trecho, 'scrollHeight', { value: 41 });
    Object.defineProperty(trecho, 'clientHeight', { value: 40 });
    quadro();
    expect(item.querySelector('.ai-citacao-mais').classList.contains('hidden')).toBe(true);
  });

  it('o bloco e traduzido na hora de mostrar', async () => {
    window.i18nApplyDOM = vi.fn();
    await comBloco();
    expect(window.i18nApplyDOM).toHaveBeenCalledWith(blocos()[0]);
  });
});

describe('o clique na pagina', () => {
  async function clicar(resposta, desfecho) {
    window.electronAPI.docsOpenHelp = vi.fn(async () => resposta);
    if (desfecho !== undefined) window.electronAPI.docsRealceDesfecho = vi.fn(async () => desfecho);
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Resposta.' });
    emitir({ type: 'citation', citacao: { ...A } });
    emitir({ type: 'finish' });
    const [item] = itens();
    item.querySelector('.ai-citacao-pagina').click();
    await assentar();
    return item;
  }
  const nota = (item) => item.querySelector('.ai-citacao-nota');

  it('abre o manual na pagina com o trecho para realcar; achou a frase, nao diz nada', async () => {
    const item = await clicar({ ok: true }, { achou: true });
    expect(window.electronAPI.docsOpenHelp).toHaveBeenCalledWith('guia/filtros.md', { trecho: A.trecho });
    expect(nota(item)).toBeNull();
  });

  it('a pagina abriu e a frase nao esta mais la: diz, com a versao da citacao', async () => {
    const item = await clicar({ ok: true, versao: '6.4.2' }, { achou: false, motivo: 'trecho-ausente' });
    expect(nota(item).getAttribute('data-i18n')).toBe('ai.citations.textGone');
    expect(nota(item).textContent).toBe('ai.citations.textGone (6.4.2)');
  });

  it('nao achou por outro motivo, ou o desfecho nao respondeu: nada', async () => {
    let item = await clicar({ ok: true }, { achou: false, motivo: 'outro' });
    expect(nota(item)).toBeNull();
    window.electronAPI.docsRealceDesfecho = vi.fn(async () => { throw new Error('mudo'); });
    item.querySelector('.ai-citacao-pagina').click();
    await assentar();
    expect(nota(item)).toBeNull();
    delete window.electronAPI.docsRealceDesfecho;
    item = await clicar({ ok: true });
    expect(nota(item)).toBeNull();
  });

  it('manual ausente ou pagina que sumiu: cada um com a sua explicacao, traduzida', async () => {
    let item = await clicar({ ok: false, motivo: 'manual-ausente' });
    expect(nota(item).textContent).toBe('ai.citations.manualMissing');

    window.i18nApplyDOM = vi.fn((el) => { if (el.classList?.contains('ai-citacao-nota')) el.textContent = 'Pagina sumiu'; });
    item = await clicar({ ok: false, motivo: 'pagina-ausente', versao: '6.1' });
    expect(nota(item).getAttribute('data-i18n')).toBe('ai.citations.pageGone');
    expect(nota(item).textContent).toBe('Pagina sumiu (6.1)');
  });

  it('um clique novo troca a nota velha; resposta vazia conta como aberta', async () => {
    const item = await clicar({ ok: false, motivo: 'manual-ausente' });
    expect(item.querySelectorAll('.ai-citacao-nota')).toHaveLength(1);
    window.electronAPI.docsOpenHelp.mockResolvedValue(undefined);
    item.querySelector('.ai-citacao-pagina').click();
    await assentar();
    expect(nota(item)).toBeNull();
  });

  it('o manual que nao abre so avisa no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.electronAPI.docsOpenHelp = vi.fn(async () => { throw new Error('janela fechada'); });
    const emitir = await turno();
    emitir({ type: 'text-delta', delta: 'Resposta.' });
    emitir({ type: 'citation', citacao: { ...A } });
    emitir({ type: 'finish' });
    itens()[0].querySelector('.ai-citacao-pagina').click();
    await assentar();
    expect(warn).toHaveBeenCalledWith('[ai] nao consegui abrir o manual:', expect.any(Error));
  });
});
