/**
 * Testes do leitor de quadros Content-Length das pontes de LSP.
 *
 * Por que importa: o leitor esta entre o servidor de linguagem e tudo o que o
 * editor mostra (diagnosticos, completar, formatar). Um quadro cortado no
 * lugar errado vira JSON invalido em silencio e o editor para de receber
 * diagnostico sem erro nenhum na tela. E ele substitui um Buffer.concat por
 * pedaco que era quadratico em resposta grande.
 */

import { describe, it, expect } from 'vitest';

import { criarLeitorDeQuadros } from '../../main/lsp/frame_reader.js';

const quadro = (obj) => {
  const corpo = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${corpo.length}\r\n\r\n`, 'ascii'), corpo]);
};

function leitor() {
  const msgs = [];
  const erros = [];
  const l = criarLeitorDeQuadros((m) => msgs.push(m), (e) => erros.push(e));
  return { l, msgs, erros };
}

describe('criarLeitorDeQuadros', () => {
  it('um quadro num pedaco so', () => {
    const { l, msgs } = leitor();
    l.push(quadro({ id: 1, result: 'ok' }));
    expect(msgs).toEqual([{ id: 1, result: 'ok' }]);
    expect(l.pendente).toBe(0);
  });

  it('dois quadros no mesmo pedaco saem os dois, na ordem', () => {
    const { l, msgs } = leitor();
    l.push(Buffer.concat([quadro({ a: 1 }), quadro({ b: 2 })]));
    expect(msgs).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('corpo grande picado em muitos pedacos vira UM quadro (o caso do custo quadratico)', () => {
    const { l, msgs } = leitor();
    const grande = { method: 'textDocument/publishDiagnostics', params: { diagnostics: Array.from({ length: 5000 }, (_, i) => ({ i, message: `erro ${i}` })) } };
    const bytes = quadro(grande);
    // Pedacos pequenos de proposito: cada push acumula sem consolidar.
    for (let i = 0; i < bytes.length; i += 97) l.push(bytes.subarray(i, i + 97));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].params.diagnostics).toHaveLength(5000);
    expect(l.pendente).toBe(0);
  });

  it('separador do cabecalho cortado entre pedacos', () => {
    const { l, msgs } = leitor();
    const bytes = quadro({ x: 'y' });
    const corte = bytes.indexOf('\r\n\r\n') + 2; // no meio do \r\n\r\n
    l.push(bytes.subarray(0, corte));
    expect(msgs).toHaveLength(0);
    l.push(bytes.subarray(corte));
    expect(msgs).toEqual([{ x: 'y' }]);
  });

  it('quadro que termina junto com o comeco do proximo', () => {
    const { l, msgs } = leitor();
    const a = quadro({ n: 1 });
    const b = quadro({ n: 2 });
    const tudo = Buffer.concat([a, b]);
    l.push(tudo.subarray(0, a.length + 5));
    l.push(tudo.subarray(a.length + 5));
    expect(msgs).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('cabecalho sem Content-Length e descartado e o leitor segue', () => {
    const { l, msgs } = leitor();
    l.push(Buffer.concat([Buffer.from('X-Coisa: 1\r\n\r\n', 'ascii'), quadro({ ok: true })]));
    expect(msgs).toEqual([{ ok: true }]);
  });

  it('JSON invalido e reportado e nao derruba o proximo quadro', () => {
    const { l, msgs, erros } = leitor();
    const ruim = Buffer.from('{nao json', 'utf8');
    l.push(Buffer.concat([
      Buffer.from(`Content-Length: ${ruim.length}\r\n\r\n`, 'ascii'), ruim,
      quadro({ depois: true }),
    ]));
    expect(erros).toHaveLength(1);
    expect(msgs).toEqual([{ depois: true }]);
  });

  it('UTF-8 multibyte conta em bytes, nao em caracteres', () => {
    const { l, msgs } = leitor();
    l.push(quadro({ msg: 'módulo não declarado — ação' }));
    expect(msgs[0].msg).toBe('módulo não declarado — ação');
  });

  it('reset esquece o que estava acumulado', () => {
    const { l, msgs } = leitor();
    const bytes = quadro({ a: 1 });
    l.push(bytes.subarray(0, 10));
    expect(l.pendente).toBe(10);
    l.reset();
    expect(l.pendente).toBe(0);
    l.push(quadro({ b: 2 }));
    expect(msgs).toEqual([{ b: 2 }]);
  });
});
