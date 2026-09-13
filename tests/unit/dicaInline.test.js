// @vitest-environment happy-dom
/**
 * Dica inline com o nome da porta: js/editor/slang_integration.js.
 *
 * O problema que ela resolve tem nome: conexao por POSICAO. Escrever
 * `contador u1 (clk, reset, saida)` nao diz qual porta e qual, e trocar duas
 * de lugar compila, sintetiza e roda errado. E dos enganos mais caros de achar
 * num projeto de aluno, porque nada acusa: nao ha erro de compilacao, so um
 * circuito que se comporta de um jeito que ninguem explica.
 *
 * Medido contra o binario: o slang so produz dica onde ela resolve alguma
 * coisa. Conexao nomeada (`.clk(clk)`), que ja se explica sozinha, nao ganha
 * nada. E vem pronta, sem segunda viagem, porque ele anuncia
 * `resolveProvider: false`.
 *
 * O que se prova aqui e a traducao entre os dois mundos, que e onde mora o
 * erro silencioso: linha e coluna contam de 0 no LSP e de 1 no Monaco, e uma
 * dica um caractere fora de lugar nao parece um bug, parece um descuido de
 * quem escreveu o codigo.
 */

import { describe, it, expect, beforeEach } from 'vitest';

let providers;
let resposta;
let pedidos;

function montarMonaco() {
  providers = {};
  globalThis.monaco = {
    languages: {
      InlayHintKind: { Type: 1, Parameter: 2 },
      registerCompletionItemProvider: () => {},
      registerInlayHintsProvider: (lang, p) => { providers[lang] = p; },
    },
    editor: {
      getModels: () => [],
      onDidCreateModel: () => {},
      onDidChangeModelLanguage: () => {},
      setModelMarkers: () => {},
    },
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
  };
}

const modelo = { uri: { toString: () => 'file:///C:/proj/topo2.v' } };
const FAIXA = { startLineNumber: 1, startColumn: 1, endLineNumber: 20, endColumn: 1 };

/** Como o slang responde de verdade: rotulo pronto, posicao 0-based. */
const dicaDoSlang = (linha, coluna, rotulo) => ({
  position: { line: linha, character: coluna },
  label: rotulo,
  kind: 2,
  paddingRight: true,
});

async function provider() {
  const mod = await import('../../js/editor/slang_integration.js?r=' + Math.random());
  mod.initSlang();
  return providers.verilog || providers.systemverilog;
}

beforeEach(() => {
  resposta = [];
  pedidos = [];
  montarMonaco();

  globalThis.window = globalThis.window || {};
  window.localStorage = { getItem: () => 'true', setItem: () => {} };
  window.slangAPI = {
    setEnabled: () => {},
    onDiagnostics: () => {},
    didOpen: () => {},
    didChange: () => {},
    didClose: () => {},
    completion: async () => null,
    inlayHint: async (uri, range) => {
      pedidos.push({ uri, range });
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
});

describe('dica inline: a traducao de coordenadas', () => {
  it('pede a faixa em 0-based e devolve a dica em 1-based', async () => {
    resposta = [dicaDoSlang(9, 15, 'clk:')];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    // A faixa pedida ao servidor conta de 0.
    expect(pedidos[0].range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 19, character: 0 },
    });
    // A dica devolvida ao editor conta de 1.
    expect(r.hints[0].position).toEqual({ lineNumber: 10, column: 16 });
  });

  it('mantem o rotulo e os espacos que o servidor pediu', async () => {
    resposta = [dicaDoSlang(9, 15, 'clk:')];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints[0].label).toBe('clk:');
    expect(r.hints[0].paddingRight).toBe(true);
    expect(r.hints[0].paddingLeft).toBe(false);
  });

  it('traduz as tres portas de uma conexao por posicao', async () => {
    resposta = [
      dicaDoSlang(9, 15, 'clk:'),
      dicaDoSlang(9, 20, 'reset:'),
      dicaDoSlang(9, 27, 'valor:'),
    ];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints.map((h) => h.label)).toEqual(['clk:', 'reset:', 'valor:']);
    expect(r.hints.map((h) => h.position.column)).toEqual([16, 21, 28]);
  });
});

describe('dica inline: rotulo em pedacos e kind', () => {
  it('junta o rotulo quando ele vem partido', async () => {
    resposta = [{
      position: { line: 2, character: 4 },
      label: [{ value: 'val' }, { value: 'or:' }],
      kind: 2,
    }];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints[0].label).toBe('valor:');
  });

  it('kind 1 e tipo, qualquer outro e parametro', async () => {
    resposta = [
      { position: { line: 0, character: 0 }, label: 'logic', kind: 1 },
      { position: { line: 1, character: 0 }, label: 'clk:', kind: 2 },
      { position: { line: 2, character: 0 }, label: 'x:' },
    ];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints.map((h) => h.kind)).toEqual([1, 2, 2]);
  });

  it('descarta dica sem posicao ou sem rotulo', async () => {
    resposta = [
      dicaDoSlang(1, 1, 'boa:'),
      { label: 'sem posicao' },
      { position: { line: 3, character: 0 }, label: '' },
    ];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints).toHaveLength(1);
    expect(r.hints[0].label).toBe('boa:');
  });
});

describe('dica inline: quando nao ha nada a mostrar', () => {
  it('devolve lista vazia quando o slang nao acha nada', async () => {
    resposta = [];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints).toEqual([]);
    expect(typeof r.dispose).toBe('function');
  });

  it('nao deixa o erro do slang subir para o editor', async () => {
    resposta = new Error('slang caiu');
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(r.hints).toEqual([]);
  });

  it('nao pergunta nada com o slang desligado', async () => {
    window.localStorage = { getItem: () => 'false', setItem: () => {} };
    resposta = [dicaDoSlang(1, 1, 'clk:')];
    const r = await (await provider()).provideInlayHints(modelo, FAIXA);

    expect(pedidos).toEqual([]);
    expect(r.hints).toEqual([]);
  });
});
