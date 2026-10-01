// @vitest-environment happy-dom
//
// Caracterizacao do layout do painel de IA: abrir e fechar, a largura de
// abertura, o limite que a janela impoe, o divisor de largura e o canto que
// redimensiona painel e terminal juntos. Escrito antes de o layout sair do
// ai_assistant_manager (TODO 13.3) e rodado no `.js` antigo.
//
// O happy-dom nao faz layout, entao as medidas que a regra le sao postas a mao:
// a largura da faixa (`.main-container`), da arvore, do trilho, e os retangulos
// do canto. Os quadros (`requestAnimationFrame`) e o ResizeObserver sao falsos
// e disparados pelo teste, para cada passo ser deterministico.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { constrainTerminalHeight } from '../../js/utils/resize.js';

const AIAssistantManager = aiAssistantManager.constructor;

let painel;
let quadros;
let observadores;
let eventosDeLayout;

/** Roda os quadros pendentes (os que forem pedidos durante, no proximo). */
function quadro() {
  const agora = quadros;
  quadros = [];
  for (const cb of agora) if (cb) cb(0);
}

class ObservadorFalso {
  constructor(cb) { this.cb = cb; this.alvos = []; observadores.push(this); }
  observe(el) { this.alvos.push(el); }
  disconnect() {}
}

function medir(el, props) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, get: typeof v === 'function' ? v : () => v });
}

/** Faixa de 1600 px, arvore de 250, trilho de 10: o teto do painel e 1600-10-250-320 = 1020. */
function montarDom({ comTerminal = true } = {}) {
  document.body.innerHTML = `<div class="main-container">
    <div class="edge-rail edge-rail-left"></div>
    <div class="file-tree-container"></div>
    <div class="editor-terminal-container">${comTerminal ? '<div class="terminal-container"></div>' : ''}</div>
    <div class="edge-rail edge-rail-right"></div>
  </div>`;
  medir(document.querySelector('.main-container'), { clientWidth: 1600 });
  medir(document.querySelector('.file-tree-container'), { offsetWidth: 250 });
  medir(document.querySelector('.edge-rail-left'), { offsetWidth: 0 });
  medir(document.querySelector('.edge-rail-right'), { offsetWidth: 10 });
}

function api() {
  return {
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    onChatEvent: vi.fn(() => () => {}),
    listConversations: vi.fn(async () => ({ chats: [] })),
  };
}

function novoPainel() {
  painel = new AIAssistantManager();
  return painel;
}

const largura = () => painel.container.style.width;
const mouse = (alvo, tipo, x = 0, y = 0) => alvo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y }));
const assentar = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  quadros = [];
  observadores = [];
  eventosDeLayout = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { quadros.push(cb); return quadros.length; });
  vi.stubGlobal('cancelAnimationFrame', (id) => { quadros[id - 1] = null; });
  vi.stubGlobal('ResizeObserver', ObservadorFalso);
  localStorage.clear();
  window.aiAPI = api();
  window.addEventListener('aurora:layout-changed', guardarEvento);
  montarDom();
});

function guardarEvento(e) { eventosDeLayout.push(e.detail); }

afterEach(() => {
  window.removeEventListener('aurora:layout-changed', guardarEvento);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('abrir e fechar', () => {
  it('nasce fechado: largura zero, inert, e o trilho da direita aceso', () => {
    novoPainel().initialize();
    const c = painel.container;
    expect(c.parentElement).toBe(document.querySelector('.main-container'));
    expect(c.nextElementSibling).toBe(document.querySelector('.edge-rail-right'));
    expect(largura()).toBe('0px');
    expect(c.hasAttribute('inert')).toBe(true);
    expect(c.classList.contains('is-collapsed')).toBe(true);
    expect(c.classList.contains('open')).toBe(false);
    expect(document.body.classList.contains('ai-collapsed')).toBe(true);
    expect(localStorage.getItem('aurora-ai-panel-open')).toBe('0');
    expect(eventosDeLayout.at(-1)).toEqual({ origem: 'painel-ia', largura: 0 });
  });

  it('o toggle abre em 480, relê provedores e conversas, e foca o campo; de novo, fecha', async () => {
    novoPainel().initialize();
    painel.toggle();
    const c = painel.container;
    expect(largura()).toBe('480px');
    expect(c.classList.contains('open')).toBe(true);
    expect(c.classList.contains('is-collapsed')).toBe(false);
    expect(c.hasAttribute('inert')).toBe(false);
    expect(document.body.classList.contains('ai-assistant-open')).toBe(true);
    expect(document.body.classList.contains('ai-collapsed')).toBe(false);
    expect(localStorage.getItem('aurora-ai-panel-open')).toBe('1');
    expect(eventosDeLayout.at(-1)).toEqual({ origem: 'painel-ia', largura: 480 });
    await assentar();
    expect(window.aiAPI.listProviders).toHaveBeenCalledTimes(1);
    expect(window.aiAPI.listConversations).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(painel.inputEl);

    painel.toggle();
    expect(largura()).toBe('0px');
    expect(c.hasAttribute('inert')).toBe(true);
    await assentar();
    expect(window.aiAPI.listProviders).toHaveBeenCalledTimes(1);
  });

  it('o botao de fechar do cabecalho e o toggle', () => {
    novoPainel().initialize();
    painel.toggle();
    painel.container.querySelector('.ai-hbtn-close').click();
    expect(largura()).toBe('0px');
  });

  it('o sentido sai da largura, nao da classe: fechado pelo arrasto, o toggle abre', () => {
    novoPainel().initialize();
    painel.toggle();
    painel.container.style.width = '0px';           // o arrasto fechou, a classe ficou
    painel.toggle();
    expect(largura()).toBe('480px');
  });

  it('toggle e ensureOpen montam o painel se ainda nao existe', () => {
    novoPainel().toggle();
    expect(painel.container.isConnected).toBe(true);
    expect(largura()).toBe('480px');

    montarDom();
    novoPainel().ensureOpen();
    expect(largura()).toBe('480px');
  });

  it('ensureOpen nao mexe no painel ja aberto', async () => {
    novoPainel().initialize();
    painel.ensureOpen();
    await assentar();
    painel.container.style.width = '700px';
    painel.ensureOpen();
    await assentar();
    expect(largura()).toBe('700px');
    expect(window.aiAPI.listProviders).toHaveBeenCalledTimes(1);
  });

  it('sem container, aplicar largura nao faz nada', () => {
    novoPainel();
    painel._aplicarLargura(500);
    painel._applyOpenWidth(true);
    expect(painel.container).toBeNull();
  });
});

describe('a largura de abertura', () => {
  const abrirCom = (salva) => {
    montarDom();
    localStorage.removeItem('aurora-ai-panel-open');
    if (salva !== undefined) localStorage.setItem('aurora-ai-panel-width', salva);
    novoPainel().initialize();
    painel.toggle();
    return largura();
  };

  it('a salva vale se for de pelo menos 320; acima do teto, o teto', () => {
    expect(abrirCom('700')).toBe('700px');
    expect(abrirCom('320')).toBe('320px');
    expect(abrirCom('319')).toBe('480px');
    expect(abrirCom('lixo')).toBe('480px');
    expect(abrirCom('5000')).toBe('1020px');
  });

  it('armazenamento que falha cai no padrao', () => {
    novoPainel().initialize();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('privado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('privado'); });
    painel.toggle();
    expect(largura()).toBe('480px');
  });

  it('o teto desconta a arvore e o minimo do editor, e nunca fica abaixo do piso', () => {
    novoPainel().initialize();
    expect(painel._larguraPermitida(99999)).toBe(1020);
    expect(painel._larguraPermitida(100)).toBe(0);            // abaixo do limiar, colapsa
    expect(painel._larguraPermitida(200)).toBe(320);          // entre o limiar e o piso, o piso
    medir(document.querySelector('.main-container'), { clientWidth: 700 });
    expect(painel._larguraPermitida(99999)).toBe(320);        // sem espaco, o piso
    document.querySelector('.file-tree-container').remove();
    expect(painel._larguraPermitida(99999)).toBe(370);        // sem arvore: 700-10-320
  });

  it('aberto na sessao anterior, reabre sozinho, sem animar', async () => {
    localStorage.setItem('aurora-ai-panel-open', '1');
    localStorage.setItem('aurora-ai-panel-width', '600');
    novoPainel().initialize();
    expect(largura()).toBe('600px');
    expect(painel.container.style.transition).toBe('');
    await assentar();
    expect(window.aiAPI.listProviders).toHaveBeenCalledTimes(1);
    expect(window.aiAPI.listConversations).toHaveBeenCalledTimes(1);
  });
});

describe('o limite reavaliado quando a janela muda', () => {
  it('encolher a janela traz a largura para dentro do teto, no quadro seguinte', () => {
    novoPainel().initialize();
    painel.toggle();
    painel._aplicarLargura(1000);
    medir(document.querySelector('.main-container'), { clientWidth: 1000 });
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));       // o segundo cancela o primeiro
    expect(largura()).toBe('1000px');
    quadro();
    expect(largura()).toBe('420px');                  // 1000-10-250-320
  });

  it('fechado, sem largura legivel, ou ja dentro do teto: nada', () => {
    novoPainel().initialize();
    const n = eventosDeLayout.length;
    painel.reclampWidth();
    painel.toggle();
    const depois = eventosDeLayout.length;
    painel.reclampWidth();                            // 480 ja cabe
    expect(eventosDeLayout.length).toBe(depois);
    painel.container.style.width = 'auto';
    painel.reclampWidth();
    expect(eventosDeLayout.length).toBe(depois);
    expect(depois).toBe(n + 1);
  });
});

describe('o divisor de largura', () => {
  it('arrastar para a esquerda alarga no quadro seguinte; soltar grava a largura', () => {
    novoPainel().initialize();
    painel.toggle();
    const alca = painel.container.querySelector('.ai-resize-handle');
    mouse(alca, 'mousedown', 1000);
    expect(document.body.classList.contains('resizing-vertical')).toBe(true);
    mouse(document, 'mousemove', 950);
    mouse(document, 'mousemove', 900);                // cancela o quadro do anterior
    quadro();
    expect(largura()).toBe('580px');
    mouse(document, 'mouseup');
    expect(document.body.classList.contains('resizing-vertical')).toBe(false);
    expect(localStorage.getItem('aurora-ai-panel-width')).toBe('580');

    mouse(document, 'mousemove', 100);                // ja solto: nada
    quadro();
    expect(largura()).toBe('580px');
  });

  it('arrastar alem do limiar fecha, e o fechamento nao e gravado como largura', () => {
    novoPainel().initialize();
    painel.toggle();
    const alca = painel.container.querySelector('.ai-resize-handle');
    mouse(alca, 'mousedown', 1000);
    mouse(document, 'mousemove', 1400);
    mouse(document, 'mouseup');                       // solta antes do quadro: ele e cancelado
    expect(largura()).toBe('480px');
    mouse(alca, 'mousedown', 1000);
    mouse(document, 'mousemove', 1400);
    quadro();
    expect(largura()).toBe('0px');
    expect(painel.container.hasAttribute('inert')).toBe(true);
    mouse(document, 'mouseup');
    // Fica o 480 que o primeiro arrasto gravou ao soltar; o fechamento nao o apaga.
    expect(localStorage.getItem('aurora-ai-panel-width')).toBe('480');
  });

  it('gravar que falha ao soltar nao quebra o arrasto', () => {
    novoPainel().initialize();
    painel.toggle();
    const alca = painel.container.querySelector('.ai-resize-handle');
    mouse(alca, 'mousedown', 1000);
    mouse(document, 'mousemove', 900);
    quadro();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cheio'); });
    expect(() => mouse(document, 'mouseup')).not.toThrow();
    expect(document.body.classList.contains('resizing-vertical')).toBe(false);
  });
});

describe('o canto entre o painel e o terminal', () => {
  const canto = () => document.getElementById('ai-terminal-corner-handle');
  const terminal = () => document.querySelector('.terminal-container');

  function abrirComMedidas() {
    novoPainel().initialize();
    medir(painel.container, { getBoundingClientRect: () => () => ({ left: 1100 }), offsetWidth: 480 });
    medir(terminal(), { getBoundingClientRect: () => () => ({ top: 600 }), offsetHeight: 200 });
    painel.toggle();
    observadores[0].cb();
    quadro();
  }

  it('nasce escondido, observa o painel e o terminal, e cola na juncao quando o painel abre', () => {
    novoPainel().initialize();
    expect(canto().style.display).toBe('none');
    expect(canto().style.position).toBe('fixed');
    expect(observadores[0].alvos).toEqual([painel.container, terminal()]);

    medir(painel.container, { getBoundingClientRect: () => () => ({ left: 1100 }) });
    medir(terminal(), { getBoundingClientRect: () => () => ({ top: 600 }) });
    painel.toggle();
    observadores[0].cb();
    observadores[0].cb();                              // um quadro so
    expect(quadros.filter(Boolean)).toHaveLength(1);
    quadro();
    expect(canto().style.display).toBe('block');
    expect(canto().style.left).toBe('1089px');
    expect(canto().style.top).toBe('589px');

    canto().style.left = '5px';
    window.dispatchEvent(new Event('resize'));         // mesma posicao: nao reescreve
    quadro();
    expect(canto().style.left).toBe('5px');

    painel.toggle();
    window.dispatchEvent(new Event('resize'));
    quadro();
    expect(canto().style.display).toBe('none');
  });

  it('o hover acende os dois divisores so com o painel aberto', () => {
    novoPainel().initialize();
    mouse(canto(), 'mouseenter');
    expect(document.body.classList.contains('ai-corner-hovering')).toBe(false);
    painel.toggle();
    mouse(canto(), 'mouseenter');
    expect(document.body.classList.contains('ai-corner-hovering')).toBe(true);
    mouse(canto(), 'mouseleave');
    expect(document.body.classList.contains('ai-corner-hovering')).toBe(false);
  });

  it('arrastar muda a largura do painel e a altura do terminal juntos, e soltar grava as duas', () => {
    abrirComMedidas();
    mouse(canto(), 'mousedown', 1100, 600);
    expect(document.body.classList.contains('resizing-ai-corner')).toBe(true);
    mouse(document, 'mousemove', 1050, 580);
    mouse(document, 'mousemove', 1000, 550);           // cancela o quadro do anterior
    quadro();
    expect(largura()).toBe('580px');
    expect(terminal().style.height).toBe(`${constrainTerminalHeight(250)}px`);
    mouse(document, 'mouseup');
    expect(document.body.classList.contains('resizing-ai-corner')).toBe(false);
    expect(localStorage.getItem('aurora-ai-panel-width')).toBe('580');
    expect(localStorage.getItem('terminalHeight')).toBe('200');

    mouse(document, 'mouseup');                         // ja solto: nada
    mouse(document, 'mousemove', 0, 0);
    quadro();
    expect(largura()).toBe('580px');
  });

  it('fechado, o canto nao arrasta; o colapso nao e gravado como largura; gravar que falha nao quebra', () => {
    novoPainel().initialize();
    mouse(canto(), 'mousedown', 1100, 600);
    expect(document.body.classList.contains('resizing-ai-corner')).toBe(false);

    montarDom();
    abrirComMedidas();
    mouse(canto(), 'mousedown', 1100, 600);
    mouse(document, 'mousemove', 1500, 600);
    mouse(document, 'mouseup');                         // antes do quadro
    mouse(canto(), 'mousedown', 1100, 600);
    mouse(document, 'mousemove', 1500, 600);
    quadro();
    expect(largura()).toBe('0px');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cheio'); });
    expect(() => mouse(document, 'mouseup')).not.toThrow();
    expect(localStorage.getItem('aurora-ai-panel-width')).toBe('480');   // o do primeiro arrasto
  });

  it('sem terminal na pagina, nao ha canto', () => {
    montarDom({ comTerminal: false });
    novoPainel().initialize();
    expect(canto()).toBeNull();
    expect(observadores).toHaveLength(0);
  });
});
