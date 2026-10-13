// @vitest-environment happy-dom
//
// O marcador de override nos botoes da barra (js/compilation/override_badges.ts).
// Teste de caracterizacao, escrito na conversao do .js para .ts: o botao ganha
// a marca quando um passo dele tem override ativo, a dica lista o override, e
// o clique direito no canto da marca limpa.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const overrides = vi.hoisted(() => ({ lista: [], limpos: [] }));

vi.mock('../../js/compilation/command_overrides.js', () => ({
  listOverrides: vi.fn(async () => overrides.lista),
  clearOverride: vi.fn(async (q) => {
    overrides.limpos.push(q);
    overrides.lista = [];
  }),
}));

import { initOverrideBadges } from '../../js/compilation/override_badges.ts';

const espera = () => new Promise((r) => setTimeout(r, 0));

// O init pendura um ouvinte de contextmenu no document a cada chamada; o app
// chama uma vez. Aqui tambem: os testes repintam pelo aurora:spf-changed.
async function repintar() {
  window.dispatchEvent(new Event('aurora:spf-changed'));
  await espera();
}

function botoes() {
  document.body.innerHTML = ['cmmcomp', 'vericomp', 'wavecomp', 'prismcomp']
    .map((id) => `<button id="${id}" class="toolbar-button"></button>`).join('');
}

describe('override_badges', () => {
  beforeAll(async () => {
    botoes();
    initOverrideBadges();
    await espera();
  });

  beforeEach(() => {
    overrides.lista = [];
    overrides.limpos = [];
    botoes();
  });

  it('sem override, nenhum botao marcado e o estilo e injetado', async () => {
    await repintar();
    expect(document.querySelectorAll('.has-ai-override')).toHaveLength(0);
    expect(document.getElementById('aurora-override-badge-style')).not.toBeNull();
  });

  it('um override no passo asm marca o botao do C±, com a dica do override', async () => {
    overrides.lista = [{
      key: 'asm:filtro', step: 'asm', processorName: 'filtro', scope: 'ephemeral',
      override: { appendArgs: ['-c', '50'], removeArgs: ['-c', '10'], envSet: { A: '1' }, envUnset: ['B'], note: 'teste' },
    }];
    await repintar();
    const btn = document.getElementById('cmmcomp');
    expect(btn.classList.contains('has-ai-override')).toBe(true);
    expect(btn.title).toContain('[ephemeral] asm:filtro: +-c 50; --c 10; env: A=1, unset B — teste');
    expect(btn.dataset.aiOverrideKeys).toBe('asm:filtro|ephemeral');
    expect(document.getElementById('wavecomp').classList.contains('has-ai-override')).toBe(false);
  });

  it('um override no vvp-run marca o Wave, e sem argumentos diz no-op', async () => {
    overrides.lista = [{ key: 'vvp-run', step: 'vvp-run', processorName: null, scope: 'persisted', override: {} }];
    await repintar();
    expect(document.getElementById('wavecomp').title).toContain('[persisted] vvp-run: (no-op)');
  });

  it('o clique direito no canto da marca limpa o override e desmarca', async () => {
    overrides.lista = [{ key: 'asm:filtro', step: 'asm', processorName: 'filtro', scope: 'ephemeral', override: {} }];
    await repintar();
    const btn = document.getElementById('cmmcomp');
    btn.getBoundingClientRect = () => ({ right: 100, top: 0, left: 0, bottom: 30, width: 100, height: 30 });
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 95, clientY: 5 }));
    await espera();
    await espera();
    expect(overrides.limpos).toEqual([{ step: 'asm', processorName: 'filtro', scope: 'ephemeral' }]);
    expect(btn.classList.contains('has-ai-override')).toBe(false);
    expect(btn.dataset.aiOverrideKeys).toBeUndefined();
  });

  it('o clique direito longe da marca nao limpa nada', async () => {
    overrides.lista = [{ key: 'asm:filtro', step: 'asm', processorName: 'filtro', scope: 'ephemeral', override: {} }];
    await repintar();
    const btn = document.getElementById('cmmcomp');
    btn.getBoundingClientRect = () => ({ right: 100, top: 0, left: 0, bottom: 30, width: 100, height: 30 });
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 25 }));
    await espera();
    expect(overrides.limpos).toEqual([]);
  });

  it('a lista que falha conta como nenhum override', async () => {
    const { listOverrides } = await import('../../js/compilation/command_overrides.js');
    listOverrides.mockRejectedValueOnce(new Error('sem projeto'));
    await repintar();
    expect(document.querySelectorAll('.has-ai-override')).toHaveLength(0);
  });
});
