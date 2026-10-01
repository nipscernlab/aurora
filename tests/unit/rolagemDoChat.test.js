// @vitest-environment happy-dom
//
// Caracterizacao da rolagem do chat: o painel acompanha o fim enquanto a
// pessoa esta nele, para de acompanhar quando ela sobe para ler, mostra o
// "Jump to latest" e desliza de volta ao clique. Escrito antes de a rolagem
// sair do ai_assistant_manager (TODO 13.3) e rodado no `.js` antigo.
//
// O happy-dom nao rola, entao a geometria (scrollHeight, clientHeight) e posta
// a mao, e o scrollTop e o que o codigo escreve. Os quadros e o relogio da
// animacao sao falsos e disparados pelo teste.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { easeInOutCubic, smoothScrollDuration } from '../../js/ai/chat_scroll.js';

const AIAssistantManager = aiAssistantManager.constructor;

let painel;
let quadros;
let agora;
let geo;

function quadro(t) {
  if (t !== undefined) agora = t;
  const q = quadros;
  quadros = [];
  for (const cb of q) if (cb) cb(agora);
}

/** O elemento de mensagens com altura de conteudo e de janela postas a mao. */
function geometria(el) {
  geo = { scrollHeight: 2000, clientHeight: 500 };
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => geo.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geo.clientHeight });
}

function montar() {
  document.body.innerHTML = '<div class="main-container"></div>';
  window.aiAPI = undefined;
  painel = new AIAssistantManager();
  painel.initialize();
  geometria(painel.messagesEl);
  return painel;
}

const rolar = (top) => { painel.messagesEl.scrollTop = top; painel.messagesEl.dispatchEvent(new Event('scroll')); };
const pilula = () => painel.container.querySelector('.ai-scroll-resume');

beforeEach(() => {
  quadros = [];
  agora = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb) => { quadros.push(cb); return quadros.length; });
  vi.stubGlobal('cancelAnimationFrame', (id) => { quadros[id - 1] = null; });
  vi.spyOn(performance, 'now').mockImplementation(() => agora);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('acompanhar o fim', () => {
  it('antes de montar, rolar ao fim nao faz nada', () => {
    painel = new AIAssistantManager();
    expect(() => painel.scrollToBottom(true)).not.toThrow();
  });

  it('colado no fim, cada rolagem pedida vai ao fim; descolado, so a forcada', () => {
    montar();
    painel.scrollToBottom();
    expect(painel.messagesEl.scrollTop).toBe(2000);    // o happy-dom nao recorta: fica o que foi escrito

    rolar(200);                                         // a pessoa subiu para ler
    expect(painel.stickToBottom).toBe(false);
    geo.scrollHeight = 2400;
    painel.scrollToBottom();
    expect(painel.messagesEl.scrollTop).toBe(200);
    painel.scrollToBottom(true);                        // mandou mensagem: volta a acompanhar
    expect(painel.stickToBottom).toBe(true);
    expect(painel.messagesEl.scrollTop).toBe(2400);
  });
});

describe('a dica "Jump to latest"', () => {
  it('aparece quando a pessoa sobe e some quando ela volta; mudanca do mesmo lado nao mexe', () => {
    montar();
    rolar(1500);                                        // ja no fim: nada muda
    expect(pilula()).toBeNull();
    rolar(1000);
    const p = pilula();
    expect(p).toBeTruthy();
    expect(p.tagName).toBe('BUTTON');
    expect(p.parentElement).toBe(painel.messagesEl.parentElement);
    expect(p.textContent).toBe('Jump to latest');
    expect(p.classList.contains('visible')).toBe(true);
    p.classList.remove('visible');
    rolar(900);                                         // continua longe: nao reescreve
    expect(p.classList.contains('visible')).toBe(false);
    rolar(1480);                                        // a 20 px do fim conta como fim
    expect(painel.stickToBottom).toBe(true);
    expect(p.classList.contains('visible')).toBe(false);
    rolar(100);
    expect(pilula()).toBe(p);                           // o mesmo botao, reaproveitado
    expect(p.classList.contains('visible')).toBe(true);
  });

  it('o clique desliza ate o fim com aceleracao e freio, mirando o fim que cresce, e esconde a dica', () => {
    montar();
    rolar(0);
    pilula().click();
    expect(pilula().classList.contains('visible')).toBe(false);
    expect(painel.stickToBottom).toBe(true);
    const dur = smoothScrollDuration(1500);
    quadro(1000 + dur / 2);
    expect(painel.messagesEl.scrollTop).toBeCloseTo(1500 * easeInOutCubic(0.5), 0);
    geo.scrollHeight = 2500;                            // chegou mais texto no meio
    quadro(1000 + dur);
    expect(painel.messagesEl.scrollTop).toBe(2000);
    expect(quadros).toHaveLength(0);
  });

  it('a 2 px do fim, salta direto; um clique novo cancela o deslize em curso', () => {
    montar();
    rolar(0);
    pilula().click();
    expect(quadros.filter(Boolean)).toHaveLength(1);
    rolar(0);
    pilula().click();
    expect(quadros.filter(Boolean)).toHaveLength(1);    // o primeiro foi cancelado

    quadros = [];
    montar();
    rolar(1000);
    painel.messagesEl.scrollTop = 1499;
    pilula().click();
    expect(painel.messagesEl.scrollTop).toBe(2000);
    expect(quadros).toHaveLength(0);
  });
});
