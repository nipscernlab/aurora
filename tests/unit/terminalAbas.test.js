// @vitest-environment happy-dom
//
// A troca de aba dos terminais e a rolagem que acompanha a saida
// (js/terminal/terminal.js), e o <aurora-terminal>, a casca do painel.
// O modulo liga os ouvintes ao carregar, entao cada caso monta o DOM e
// importa de novo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDS = ['tcmm', 'tasm', 'tveri', 'twave'];

function montar() {
  document.body.innerHTML = `
    <button id="cmmcomp"></button><button id="vericomp"></button>
    <button id="wavecomp"></button><button id="prismcomp"></button>
    <div class="terminal-tabs-list">
      ${IDS.map((id, i) => `<div class="tab${i === 0 ? ' active' : ''}" data-terminal="${id}"></div>`).join('')}
      <div class="tab"></div>
    </div>
    ${IDS.map((id, i) => `<div id="terminal-${id}" class="terminal-content${i ? ' hidden' : ''}"><div class="terminal-body"></div></div>`).join('')}`;
  // O happy-dom nao faz layout; o indicador le offsetLeft e offsetWidth.
  document.querySelectorAll('.tab').forEach((t, i) => {
    Object.defineProperty(t, 'offsetLeft', { value: 100 * i, configurable: true });
    Object.defineProperty(t, 'offsetWidth', { value: 80, configurable: true });
  });
}

let m;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] });
  vi.resetModules();
  montar();
  m = await import('../../js/terminal/terminal.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const indicador = () => document.querySelector('.terminal-tab-indicator');
const visivel = (id) => !document.getElementById(`terminal-${id}`).classList.contains('hidden');

describe('trocar de terminal', () => {
  it('no primeiro quadro, o indicador vai para a aba ativa', () => {
    vi.advanceTimersToNextFrame();
    expect(indicador().style.transform).toBe('translateX(6px)');
    expect(indicador().style.width).toBe('68px');
    expect(indicador().classList.contains('visible')).toBe(true);
  });

  it('mostra so o terminal pedido, marca a aba e desliza o indicador ate ela', () => {
    m.switchTerminal('terminal-tveri');
    expect(IDS.filter(visivel)).toEqual(['tveri']);
    expect(document.querySelector('.tab.active').dataset.terminal).toBe('tveri');
    expect(indicador().style.transform).toBe('translateX(206px)');
    // Um indicador so, reaproveitado.
    m.switchTerminal('terminal-tasm');
    expect(document.querySelectorAll('.terminal-tab-indicator')).toHaveLength(1);
  });

  it('terminal que nao existe nao esconde os outros', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.switchTerminal('terminal-nada');
    expect(visivel('tcmm')).toBe(true);
    expect(erro).toHaveBeenCalled();
  });

  it('terminal sem aba, ou aba fora da faixa, nao move indicador', () => {
    const extra = document.createElement('div');
    extra.id = 'terminal-extra';
    extra.className = 'terminal-content';
    document.body.appendChild(extra);
    m.switchTerminal('terminal-extra');
    expect(indicador()).toBeNull();
    const solta = document.createElement('div');
    solta.className = 'tab';
    solta.dataset.terminal = 'solta';
    document.body.appendChild(solta);
    const cont = document.createElement('div');
    cont.id = 'terminal-solta';
    document.body.appendChild(cont);
    m.switchTerminal('terminal-solta');
    expect(indicador()).toBeNull();
  });

  it('os botoes de compilar e as abas levam ao terminal de cada um', () => {
    const casos = [['cmmcomp', 'tcmm'], ['vericomp', 'tveri'], ['wavecomp', 'twave'], ['prismcomp', 'tveri']];
    for (const [botao, id] of casos) {
      document.getElementById(botao).click();
      expect(IDS.filter(visivel)).toEqual([id]);
    }
    document.querySelector('.tab[data-terminal="tasm"]').click();
    expect(IDS.filter(visivel)).toEqual(['tasm']);
    // Aba sem data-terminal nao faz nada.
    document.querySelector('.tab:not([data-terminal])').click();
    expect(IDS.filter(visivel)).toEqual(['tasm']);
  });

  it('redimensionar a janela realinha o indicador; sem aba ativa, nada', () => {
    m.switchTerminal('terminal-tasm');
    document.querySelector('.tab[data-terminal="tasm"]').style.left = '';
    Object.defineProperty(document.querySelector('.tab[data-terminal="tasm"]'), 'offsetLeft', { value: 500 });
    window.dispatchEvent(new Event('resize'));
    expect(indicador().style.transform).toBe('translateX(506px)');
    document.querySelector('.tab.active').classList.remove('active');
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
  });
});

describe('seguir a saida ate o fim', () => {
  function caixa({ altura = 1000, visivelPx = 200 } = {}) {
    const el = { scrollHeight: altura, clientHeight: visivelPx, scrollTop: 0 };
    return el;
  }

  it('acelera, desacelera e para no fundo depois de a altura ficar estavel', () => {
    const el = caixa();
    m.smoothFollowToBottom(el);
    const passos = [];
    for (let i = 0; i < 400 && el._followRAF !== 0; i++) {
      vi.advanceTimersToNextFrame();
      passos.push(el.scrollTop);
    }
    expect(el.scrollTop).toBe(800);
    expect(el._followRAF).toBe(0);
    // Nunca pula mais de 45 px por quadro.
    for (let i = 1; i < passos.length; i++) expect(passos[i] - passos[i - 1]).toBeLessThanOrEqual(45);
  });

  it('chamada com o laco rodando nao comeca outro; conteudo que cresce e seguido', () => {
    const el = caixa({ altura: 300 });
    m.smoothFollowToBottom(el);
    const raf = el._followRAF;
    m.smoothFollowToBottom(el);
    expect(el._followRAF).toBe(raf);
    for (let i = 0; i < 2; i++) vi.advanceTimersToNextFrame();
    el.scrollHeight = 600;
    for (let i = 0; i < 100 && el._followRAF !== 0; i++) vi.advanceTimersToNextFrame();
    expect(el.scrollTop).toBe(400);
  });

  it('sem elemento, nada', () => {
    expect(() => m.smoothFollowToBottom(null)).not.toThrow();
  });
});

describe('<aurora-terminal>', () => {
  it('e so uma casca: o conteudo fica no DOM de luz, pelo slot', async () => {
    const { AuroraTerminal } = await import('../../js/components/aurora-terminal.js');
    const el = document.createElement('aurora-terminal');
    el.innerHTML = '<div class="terminal-body"></div>';
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el).toBeInstanceOf(AuroraTerminal);
    expect(el.shadowRoot.querySelector('slot')).not.toBeNull();
    expect(el.querySelector('.terminal-body')).not.toBeNull();
  });
});
