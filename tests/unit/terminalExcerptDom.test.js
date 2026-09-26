// @vitest-environment happy-dom
//
// O recorte do terminal lido da tela (js/terminal/terminal_excerpt.js,
// recorteEmTexto): de cada terminal com saida, as linhas com o tipo, e o
// cabecalho diz quando houve corte. A regra de o que fica (recortar) tem o
// teste dela em terminalExcerpt.test.js.

import { describe, it, expect, beforeEach } from 'vitest';

import { recorteEmTexto } from '../../js/terminal/terminal_excerpt.js';

function terminal(id, html) {
  const c = document.createElement('div');
  c.id = `terminal-${id}`;
  c.innerHTML = `<div class="terminal-body">${html}</div>`;
  document.body.appendChild(c);
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('recorte lido da tela', () => {
  it('cada terminal com saida vira uma secao, com o tipo de cada linha', () => {
    terminal('tcmm', `
      <div class="log-entry success"><span class="timestamp">[1]</span><div class="message-content">Sucesso   total</div></div>
      <div class="log-entry tips"><div class="grouped-message">dica um</div><div class="grouped-message"> </div><div class="grouped-message">dica dois</div></div>`);
    terminal('tasm', '');
    terminal('tveri', `
      <div class="log-entry info"><span class="timestamp">[2]</span>nota solta</div>
      <div class="log-entry">sem tipo nem hora</div>
      <div class="log-entry warning"></div>`);
    expect(recorteEmTexto()).toBe(
      '===== TCMM =====\n[OK] Sucesso total\n[DICA] dica um\n[DICA] dica dois\n\n'
      + '===== TVERI =====\n[INFO] nota solta\nsem tipo nem hora');
  });

  it('quando corta, o cabecalho diz quantas linhas ficaram de quantas', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => `<div class="log-entry info"><div class="message-content">linha ${i}</div></div>`).join('');
    terminal('thtest', muitas);
    const texto = recorteEmTexto();
    expect(texto.split('\n')[0]).toBe('===== THTEST (25 de 40 linhas) =====');
    expect(texto).toContain('[INFO] linha 39');
    expect(texto).not.toContain('linha 14\n');
  });

  it('sem terminal nenhum, texto vazio', () => {
    expect(recorteEmTexto()).toBe('');
  });
});
