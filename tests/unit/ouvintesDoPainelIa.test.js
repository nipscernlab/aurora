// @vitest-environment happy-dom
//
// Caracterizacao dos ouvintes que o painel de IA liga na montagem: o popover de
// provedor e modelo, o composer (enviar, anexar, arrastar, colar, Enter), os
// cliques na conversa (link externo, caminho, copiar codigo) e o resto do
// painel. Cada caso dispara o evento pelo DOM e confere o efeito. Escrito
// antes de os ouvintes sairem do ai_assistant_manager (TODO 13.3) e rodado no
// `.js` antigo.
//
// O que cada ponta faz depois (o aviso de link externo, abrir o caminho, a
// ajuda) tem teste proprio; aqui elas sao falsas e so se confere a ligacao.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));
vi.mock('../../js/ui/help_link.js', () => ({ abrirAjudaDe: vi.fn() }));
vi.mock('../../js/ai/link_externo.js', () => ({
  confiaEmLinksExternos: vi.fn(() => false),
  definirConfiancaEmLinks: vi.fn(),
  confirmarLinkExterno: vi.fn(),
}));
vi.mock('../../js/ai/abrir_referencia.js', () => ({
  abrirReferencia: vi.fn(async () => {}),
  abrirCaminhoDoChat: vi.fn(async () => {}),
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { abrirAjudaDe } from '../../js/ui/help_link.js';
import { confirmarLinkExterno } from '../../js/ai/link_externo.js';
import { abrirCaminhoDoChat, abrirReferencia } from '../../js/ai/abrir_referencia.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

let api;
let painel;

function makeAiAPI() {
  const a = {
    chamadas: [],
    emitir: null,
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'claude-x', defaultModel: 'claude-padrao' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-1' })),
    onChatEvent: vi.fn((cb) => { a.emitir = cb; return () => {}; }),
    startChat: vi.fn(async (p) => { a.chamadas.push(p); return { ok: true }; }),
    abortChat: vi.fn(async () => ({ ok: true })),
    saveConversation: vi.fn(async () => ({ ok: true })),
    listConversations: vi.fn(async () => ({ chats: [] })),
    setModel: vi.fn(async (_p, v) => ({ ok: true, model: v })),
    getClaudeCodeStatus: vi.fn(async () => ({ status: { installed: true, authed: true } })),
    getClaudeCodeUsage: vi.fn(async () => ({ usage: null })),
  };
  return a;
}

const assentar = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const clicar = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const tecla = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const mudar = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

async function abrir() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  return painel;
}

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  ProjectStore.clearProject();
  painel?._disarmStreamWatchdog?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('o resto do painel', () => {
  it('montar de novo nao cria um segundo painel', async () => {
    await abrir();
    const primeiro = painel.container;
    painel.initialize();
    expect(painel.container).toBe(primeiro);
    expect(document.querySelectorAll('.ai-assistant-container')).toHaveLength(1);
  });

  it('o botao de ajuda abre o capitulo do painel', async () => {
    await abrir();
    clicar(painel.container.querySelector('#ai-help-btn'));
    expect(abrirAjudaDe).toHaveBeenCalledWith('aiPanelHelp');
  });

  it('as configuracoes de IA mudaram: relê os provedores', async () => {
    await abrir();
    const antes = api.listProviders.mock.calls.length;
    window.dispatchEvent(new Event('aurora-ai-settings-changed'));
    await assentar();
    // Os paineis dos casos anteriores tambem ouvem a window; este e um deles.
    expect(api.listProviders.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe('o popover de provedor e modelo', () => {
  it('o chip abre e fecha; clicar dentro nao fecha; clicar fora fecha', async () => {
    await abrir();
    clicar(painel.modelChip);
    expect(painel.modelPopover.classList.contains('hidden')).toBe(false);
    clicar(painel.modelPopover);
    expect(painel.modelPopover.classList.contains('hidden')).toBe(false);
    clicar(document.body);
    expect(painel.modelPopover.classList.contains('hidden')).toBe(true);
    clicar(painel.modelChip);
    clicar(painel.modelChip);
    expect(painel.modelPopover.classList.contains('hidden')).toBe(true);
  });

  it('o radio de provedor troca o provedor; o de permissao troca o modo; mudanca fora deles, nada', async () => {
    await abrir();
    const radio = painel.mpProviders.querySelector('input[name="ai-provider"][value="claude-code"]');
    radio.checked = true;
    mudar(radio);
    expect(painel.currentProvider).toBe('claude-code');
    const perm = painel.mpPerms.querySelector('input[name="ai-perm"][value="allow"]');
    mudar(perm);
    expect(painel.permissionMode).toBe('allow');
    mudar(painel.mpProviders);
    mudar(painel.mpPerms);
    expect(painel.currentProvider).toBe('claude-code');
    expect(painel.permissionMode).toBe('allow');
  });

  it('o campo de modelo grava no change; Enter tira o foco; o botao de padrao grava o modelo padrao', async () => {
    await abrir();
    painel.container.removeAttribute('inert');      // fechado, o painel e inert e nada recebe foco
    const campo = painel.modelInput;
    campo.focus();
    tecla(campo, 'a');
    expect(document.activeElement).toBe(campo);
    tecla(campo, 'Enter');
    expect(document.activeElement).not.toBe(campo);
    campo.value = 'claude-novo';
    mudar(campo);
    await assentar();
    expect(api.setModel).toHaveBeenLastCalledWith('anthropic', 'claude-novo');
    clicar(painel.modelResetBtn);
    await assentar();
    expect(api.setModel).toHaveBeenLastCalledWith('anthropic', 'claude-padrao');

    painel.providersAvailable = painel.providersAvailable.filter((e) => e.name !== 'anthropic');
    clicar(painel.modelResetBtn);
    await assentar();
    expect(api.setModel).toHaveBeenLastCalledWith('anthropic', '');
  });

  it('assinatura: o botao de modelo grava, o de esforco troca, e o "conferir de novo" sonda a CLI', async () => {
    await abrir();
    painel.selectProvider('claude-code');
    const preset = painel.mpModelPresets.querySelector('button[data-model]:not([data-model="default"])');
    clicar(preset);
    await assentar();
    expect(painel.providersAvailable.find((e) => e.name === 'claude-code').model).toBe(preset.dataset.model);
    clicar(painel.mpModelPresets);                     // fora de um botao: nada
    const esforco = painel.effortSeg.querySelector('button[data-effort]:not(.active)');
    clicar(esforco);
    expect(painel.claudeCodeEffort).toBe(esforco.dataset.effort);
    clicar(painel.effortSeg);

    const sondas = api.getClaudeCodeStatus.mock.calls.length;
    painel.ccStatusEl.innerHTML = '<button data-cc-recheck>de novo</button>';
    clicar(painel.ccStatusEl.querySelector('[data-cc-recheck]'));
    clicar(painel.ccStatusEl);
    await assentar();
    expect(api.getClaudeCodeStatus.mock.calls.length).toBe(sondas + 1);
  });

  it('"gerenciar chaves" fecha o popover e abre as configuracoes no painel de IA', async () => {
    await abrir();
    vi.useFakeTimers();
    const cfg = document.createElement('button');
    cfg.id = 'aurora-settings';
    const abriuCfg = vi.fn();
    cfg.addEventListener('click', abriuCfg);
    const aba = document.createElement('div');
    aba.className = 'settings-nav-item';
    aba.dataset.pane = 'ai';
    const abriuAba = vi.fn();
    aba.addEventListener('click', abriuAba);
    document.body.append(cfg, aba);

    painel.toggleModelPopover(true);
    clicar(painel.container.querySelector('#ai-mp-managekeys'));
    expect(painel.modelPopover.classList.contains('hidden')).toBe(true);
    expect(abriuCfg).toHaveBeenCalledTimes(1);
    expect(abriuAba).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(abriuAba).toHaveBeenCalledTimes(1);

    cfg.remove(); aba.remove();
    clicar(painel.container.querySelector('#ai-mp-managekeys'));
    expect(() => vi.advanceTimersByTime(60)).not.toThrow();
  });
});

describe('o composer', () => {
  const arquivo = (nome, texto = 'conteudo') => new File([texto], nome, { type: 'text/plain' });

  it('o botao de enviar e o Enter mandam; Shift+Enter nao; com o envio travado, Enter nao manda', async () => {
    await abrir();
    painel.inputEl.value = 'pelo botao';
    clicar(painel.sendBtn);
    await assentar();
    expect(api.startChat).toHaveBeenCalledTimes(1);

    const sid = api.chamadas[0].sessionId;
    api.emitir({ sessionId: sid, type: 'text-delta', delta: 'ok' });
    api.emitir({ sessionId: sid, type: 'finish' });

    painel.inputEl.value = 'com shift';
    tecla(painel.inputEl, 'Enter', { shiftKey: true });
    await assentar();
    expect(api.startChat).toHaveBeenCalledTimes(1);
    tecla(painel.inputEl, 'Enter');
    await assentar();
    expect(api.startChat).toHaveBeenCalledTimes(2);

    painel.sendBtn.disabled = true;
    painel.inputEl.value = 'travado';
    tecla(painel.inputEl, 'Enter');
    await assentar();
    expect(api.startChat).toHaveBeenCalledTimes(2);
  });

  it('o botao de parar aborta o turno', async () => {
    await abrir();
    painel.inputEl.value = 'longo';
    await painel.send();
    clicar(painel.stopBtn);
    await assentar();
    expect(api.abortChat).toHaveBeenCalledWith(api.chamadas[0].sessionId);
  });

  it('digitar ajusta a altura do campo', async () => {
    await abrir();
    Object.defineProperty(painel.inputEl, 'scrollHeight', { configurable: true, value: 60 });
    painel.inputEl.value = 'linha 1\nlinha 2';
    painel.inputEl.dispatchEvent(new Event('input'));
    expect(painel.inputEl.style.height).toBe('60px');
  });

  it('o clipe abre o seletor; os arquivos escolhidos viram anexo e o seletor e limpo', async () => {
    await abrir();
    const abriu = vi.fn();
    painel.attachInput.addEventListener('click', abriu);
    clicar(painel.attachBtn);
    expect(abriu).toHaveBeenCalled();
    Object.defineProperty(painel.attachInput, 'files', { configurable: true, value: [arquivo('a.txt')] });
    mudar(painel.attachInput);
    await assentar();
    expect(painel.pendingAttachments.map((a) => a.name)).toEqual(['a.txt']);
    expect(painel.attachInput.value).toBe('');
  });

  it('arrastar arquivo acende o composer e soltar anexa; arrastar outra coisa nao', async () => {
    await abrir();
    const c = painel.composerEl;
    const evento = (tipo, dataTransfer) => {
      const e = new Event(tipo, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
      c.dispatchEvent(e);
      return e;
    };
    expect(evento('dragenter', { types: ['text/plain'] }).defaultPrevented).toBe(false);
    expect(c.classList.contains('drag-over')).toBe(false);
    expect(evento('dragover', { types: ['Files'] }).defaultPrevented).toBe(true);
    expect(c.classList.contains('drag-over')).toBe(true);
    evento('dragleave', {});
    expect(c.classList.contains('drag-over')).toBe(false);
    evento('dragenter', { types: ['Files'] });
    evento('dragend', {});
    expect(c.classList.contains('drag-over')).toBe(false);
    evento('drop', { files: [arquivo('b.v', 'module b;')] });
    evento('drop', { files: [] });
    evento('drop', undefined);
    await assentar();
    expect(painel.pendingAttachments.map((a) => a.name)).toEqual(['b.v']);
  });

  it('colar arquivo anexa e nao cola o texto; colar so texto segue normal', async () => {
    await abrir();
    const colar = (items) => {
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: items === undefined ? undefined : { items } });
      painel.inputEl.dispatchEvent(e);
      return e;
    };
    expect(colar(undefined).defaultPrevented).toBe(false);
    expect(colar([{ kind: 'string', getAsFile: () => null }]).defaultPrevented).toBe(false);
    expect(colar([{ kind: 'file', getAsFile: () => null }]).defaultPrevented).toBe(false);
    expect(colar([{ kind: 'file', getAsFile: () => arquivo('c.txt') }]).defaultPrevented).toBe(true);
    await assentar();
    expect(painel.pendingAttachments.map((a) => a.name)).toEqual(['c.txt']);
  });
});

describe('os cliques na conversa', () => {
  async function comHtml(html) {
    await abrir();
    const el = document.createElement('div');
    el.innerHTML = html;
    painel.messagesEl.appendChild(el);
    return el;
  }

  it('link externo passa pelo aviso, e o clique nao navega', async () => {
    const el = await comHtml('<a href="#" class="ai-link" data-href="https://exemplo.org"><b>site</b></a>');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector('b').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(confirmarLinkExterno).toHaveBeenCalledWith('https://exemplo.org');
  });

  it('caminho clicado abre pelo caminho do chat', async () => {
    const el = await comHtml('<span class="ai-path" data-path="C:/proj/a.v">C:/proj/a.v</span>');
    clicar(el.querySelector('.ai-path'));
    expect(abrirCaminhoDoChat).toHaveBeenCalledWith('C:/proj/a.v');
  });

  it('referencia a arquivo abre o arquivo, na linha quando ela veio', async () => {
    const el = await comHtml('<span class="ai-file-ref" data-file="top.v" data-line="12">top.v:12</span><span class="ai-file-ref" data-file="a.cmm">a.cmm</span>');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.querySelector('[data-line]').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(abrirReferencia).toHaveBeenLastCalledWith('top.v', 12);
    clicar(el.querySelectorAll('.ai-file-ref')[1]);
    expect(abrirReferencia).toHaveBeenLastCalledWith('a.cmm', null);
  });

  it('a imagem anexada abre em tamanho cheio', async () => {
    const el = await comHtml('<img class="ai-att-thumb-lg" src="data:image/png;base64,AA" alt="foto">');
    clicar(el.querySelector('img'));
    const caixa = document.querySelector('.ai-lightbox');
    expect(caixa).toBeTruthy();
  });

  it('clique em texto comum nao faz nada', async () => {
    const el = await comHtml('<p>texto</p>');
    clicar(el.querySelector('p'));
    expect(confirmarLinkExterno).not.toHaveBeenCalled();
    expect(abrirCaminhoDoChat).not.toHaveBeenCalled();
  });

  it('copiar codigo poe o texto na area de transferencia e mostra o check por 2 s', async () => {
    const escrever = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: escrever } });
    const el = await comHtml('<div class="ai-code-block"><pre><code>x = 1</code></pre><button class="ai-code-copy"><i class="ph ph-copy"></i></button></div>');
    const code = el.querySelector('code');
    Object.defineProperty(code, 'innerText', { value: 'x = 1' });
    vi.useFakeTimers();
    clicar(el.querySelector('.ai-code-copy i'));
    await vi.advanceTimersByTimeAsync(0);
    expect(escrever).toHaveBeenCalledWith('x = 1');
    const btn = el.querySelector('.ai-code-copy');
    expect(btn.innerHTML).toBe('<i class="ph ph-check"></i>');
    await vi.advanceTimersByTimeAsync(2000);
    expect(btn.innerHTML).toBe('<i class="ph ph-copy"></i>');
  });

  it('copiar sem bloco de codigo nao faz nada; a area que recusa nao quebra', async () => {
    const escrever = vi.fn(async () => { throw new Error('negado'); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: escrever } });
    const el = await comHtml('<button class="ai-code-copy">solto</button><div class="ai-code-block"><code>y</code><button class="ai-code-copy" id="b2"></button></div>');
    clicar(el.querySelector('.ai-code-copy'));
    expect(escrever).not.toHaveBeenCalled();
    clicar(el.querySelector('#b2'));
    await assentar();
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(el.querySelector('#b2').innerHTML).toBe('');
  });
});
