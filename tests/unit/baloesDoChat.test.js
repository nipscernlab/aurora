// @vitest-environment happy-dom
//
// Caracterizacao dos baloes do painel de IA e do "perguntar sobre a selecao":
// o rotulo que nao se repete numa sequencia da assistente, o botao de voltar o
// codigo ao instante da mensagem, o divisor, e o trecho do editor que entra no
// composer. O turno comum esta no aiTurnFlow; aqui ficam as bordas. Escrito
// antes de os baloes sairem do ai_assistant_manager (TODO 13.3) e rodado no
// `.js` antigo. O rewind e falso: o que ele faz no disco tem teste proprio.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));
vi.mock('../../js/ai/rewind.js', () => ({
  marcarPonto: vi.fn(async () => null),
  rotuloDoPedido: vi.fn(() => ''),
  voltarAoPonto: vi.fn(async () => ({ ok: true })),
  listarPontos: vi.fn(async () => []),
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { listarPontos, voltarAoPonto } from '../../js/ai/rewind.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

let painel;

async function abrir() {
  document.body.innerHTML = '<div class="main-container"></div>';
  window.aiAPI = {
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    onChatEvent: vi.fn(() => () => {}),
    listConversations: vi.fn(async () => ({ chats: [] })),
  };
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  return painel;
}

const assentar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
  window.t = undefined;
  window.showNotification = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  ProjectStore.clearProject();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.t = undefined;
});

describe('os baloes', () => {
  it('o rotulo aparece uma vez por sequencia da assistente; divisor e mensagem da pessoa a reiniciam', async () => {
    await abrir();
    painel.appendBubble('assistant', 'um');
    painel.appendBubble('assistant', 'dois');
    painel.appendDivider('Modelo: X');
    painel.appendBubble('assistant', 'tres');
    painel.appendBubble('user', 'pergunta');
    painel.appendBubble('assistant', 'quatro', { error: true });
    const rotulos = Array.from(painel.messagesEl.querySelectorAll('.ai-message')).map((b) => b.querySelector('.ai-msg-role')?.textContent ?? null);
    expect(rotulos).toEqual(['Aurora Intelligence', null, 'Aurora Intelligence', 'You', 'Aurora Intelligence']);
    expect(painel.messagesEl.querySelector('.ai-message.error').textContent).toContain('quatro');
    expect(painel.messagesEl.querySelector('.ai-divider').getAttribute('role')).toBe('separator');
  });

  it('a mensagem da pessoa tem o botao de voltar, com a dica traduzida quando ha traducao', async () => {
    await abrir();
    const b1 = painel.appendBubble('user', 'a');
    expect(b1.querySelector('.ai-msg-rewind').title).toBe('Rewind code to here');
    expect(b1.querySelector('.ai-msg-rewind').getAttribute('aria-label')).toBe('Rewind code to here');
    window.t = (k) => (k === 'rewind.toHere' ? 'Voltar o codigo ate aqui' : k);
    const b2 = painel.appendBubble('user', 'b');
    expect(b2.querySelector('.ai-msg-rewind').title).toBe('Voltar o codigo ate aqui');
    window.t = (k) => k;                          // sem traducao: a chave volta igual
    expect(painel.appendBubble('user', 'c').querySelector('.ai-msg-rewind').title).toBe('Rewind code to here');
    expect(painel.appendBubble('assistant', 'd').querySelector('.ai-msg-rewind')).toBeNull();
  });

  it('o botao volta ao ponto da mensagem; sem ponto, avisa em vez de fingir', async () => {
    await abrir();
    listarPontos.mockResolvedValue([{ id: 'p-9', mensagemId: 'm-1' }]);
    const com = painel.appendBubble('user', 'a');
    com.setAttribute('data-ponto', 'm-1');
    com.querySelector('.ai-msg-rewind').click();
    await assentar();
    expect(voltarAoPonto).toHaveBeenCalledWith('p-9');

    const outra = painel.appendBubble('user', 'b');
    outra.setAttribute('data-ponto', 'm-2');
    outra.querySelector('.ai-msg-rewind').click();
    await assentar();
    expect(window.showNotification).toHaveBeenLastCalledWith('No restore point for this message.', 'info', 4000, 'rewind');

    window.t = (k) => (k === 'rewind.noPoint' ? 'Sem ponto de retorno' : k);
    painel.appendBubble('user', 'c').querySelector('.ai-msg-rewind').click();   // sem data-ponto
    await assentar();
    expect(window.showNotification).toHaveBeenLastCalledWith('Sem ponto de retorno', 'info', 4000, 'rewind');
    expect(voltarAoPonto).toHaveBeenCalledTimes(1);

    window.showNotification = vi.fn(() => { throw new Error('sem notificacao'); });
    painel.appendBubble('user', 'd').querySelector('.ai-msg-rewind').click();
    await assentar();
    window.showNotification = undefined;
    painel.appendBubble('user', 'e').querySelector('.ai-msg-rewind').click();
    await assentar();
  });

  it('o divisor antes de montar nao faz nada', () => {
    painel = new AIAssistantManager();
    expect(painel.appendDivider('x')).toBeNull();
  });
});

describe('perguntar sobre a selecao', () => {
  it('trecho vazio nao abre nada', async () => {
    painel = new AIAssistantManager();
    painel.askAboutSelection({ code: '   \n' });
    painel.askAboutSelection();
    expect(painel.container).toBeNull();
  });

  it('sem intencao, o trecho entra citado e o cursor fica no comeco para a pergunta', async () => {
    await abrir();
    painel.askAboutSelection({ code: 'x = 1;  \n', language: 'cmm', filePath: 'C:/proj/a/main.cmm', lineStart: 3, lineEnd: 5 });
    expect(painel.inputEl.value).toBe('from `main.cmm` (lines 3–5):\n\n```cmm\nx = 1;\n```\n');
    expect(painel.inputEl.selectionStart).toBe(0);
    expect(painel.container.classList.contains('open')).toBe(true);
  });

  it('o lugar: uma linha so, so as linhas, ou "a selecao"; o que ja estava escrito fica em cima', async () => {
    await abrir();
    painel.askAboutSelection({ code: 'a', filePath: 'b.v', lineStart: 7, lineEnd: 7 });
    expect(painel.inputEl.value).toContain('from `b.v` (line 7):');
    painel.inputEl.value = 'minha duvida   ';
    painel.askAboutSelection({ code: 'c', lineStart: 1, lineEnd: 2 });
    expect(painel.inputEl.value).toBe('minha duvida\n\nfrom lines 1–2:\n\n```\nc\n```\n');
    painel.inputEl.value = '';
    painel.askAboutSelection({ code: 'd' });
    expect(painel.inputEl.value).toBe('from the selection:\n\n```\nd\n```\n');
  });

  it('o campo que nao aceita cursor nao quebra', async () => {
    await abrir();
    painel.inputEl.setSelectionRange = () => { throw new Error('sem foco'); };
    expect(() => painel.askAboutSelection({ code: 'x' })).not.toThrow();
  });

  it('com intencao e sem enviar, o pedido vem pronto e nada e despachado', async () => {
    await abrir();
    const send = vi.spyOn(painel, 'send');
    painel.askAboutSelection({ code: 'x', intent: 'explain' });
    expect(painel.inputEl.value).toBe('Explain what this code does from the selection:\n\n```\nx\n```\n');
    expect(send).not.toHaveBeenCalled();
  });
});
