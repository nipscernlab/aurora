// @vitest-environment happy-dom
/**
 * O `include clicavel: js/editor/slang_integration.js.
 *
 * O que faz o recurso valer nao e sublinhar o texto, e o slang RESOLVER o
 * caminho: ele devolve a uri do arquivo de verdade, e nao o que esta escrito
 * entre aspas. O caminho escrito e relativo, e descobrir relativo a que e
 * exatamente o trabalho chato que se quer poupar.
 *
 * A parte que precisa de rede e o clique. Sem interceptar, o Monaco trata
 * `file://` como endereco de navegacao e o melhor caso e nao acontecer nada; o
 * pior e a janela sair do lugar. O opener abre a aba, como qualquer outro jeito
 * de abrir arquivo aqui.
 *
 * E ele tem de ser um mau cidadao so na medida certa: o opener e GLOBAL, vale
 * para todo link de todo editor. Devolver true para um http de comentario
 * sequestraria o clique e o link nunca abriria. Por isso so `file:` e tratado,
 * e todo o resto devolve false para o Monaco seguir com o tratamento dele.
 */

import { describe, it, expect, beforeEach } from 'vitest';

let providers;
let opener;
let resposta;
let abertos;
let lidos;

function montarMonaco() {
  providers = {};
  opener = null;
  globalThis.monaco = {
    Range: class {
      constructor(a, b, c, d) {
        Object.assign(this, { startLineNumber: a, startColumn: b, endLineNumber: c, endColumn: d });
      }
    },
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    languages: {
      InlayHintKind: { Type: 1, Parameter: 2 },
      registerCompletionItemProvider: () => {},
      registerInlayHintsProvider: () => {},
      registerLinkProvider: (lang, p) => { providers[lang] = p; },
    },
    editor: {
      getModels: () => [],
      onDidCreateModel: () => {},
      onDidChangeModelLanguage: () => {},
      setModelMarkers: () => {},
      registerLinkOpener: (o) => { opener = o; },
    },
  };
}

const modelo = { uri: { toString: () => 'file:///C:/proj/cominc.sv' } };
const ALVO = 'file:///C:/proj/defs.vh';

async function provider() {
  const mod = await import('../../js/editor/slang_integration.js?r=' + Math.random());
  mod.initSlang();
  return providers.verilog || providers.systemverilog;
}

beforeEach(() => {
  resposta = [];
  abertos = [];
  lidos = [];
  montarMonaco();

  globalThis.window = globalThis.window || {};
  // O localStorage do happy-dom so tem getter (o vitest 5 repassa a atribuicao
  // ao window de verdade), entao grava-se a chave que o slang_integration le.
  window.localStorage.setItem('slangEnabled', 'true');
  window.slangAPI = {
    setEnabled: () => {},
    onDiagnostics: () => {},
    didOpen: () => {},
    didChange: () => {},
    didClose: () => {},
    completion: async () => null,
    inlayHint: async () => null,
    documentLink: async () => {
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  window.electronAPI = {
    readFile: async (p) => { lidos.push(p); return 'localparam LARGURA = 8;'; },
  };
  window.TabManager = { addTab: (p) => abertos.push(p) };
});

describe('include clicavel: o link', () => {
  it('converte a faixa de 0-based para 1-based e guarda o alvo resolvido', async () => {
    // Como o slang responde: `include "defs.vh" com o caminho ja resolvido.
    resposta = [{
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 18 } },
      target: ALVO,
    }];
    const r = await (await provider()).provideLinks(modelo);

    expect(r.links).toHaveLength(1);
    expect(r.links[0].range).toMatchObject({
      startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 19,
    });
    expect(r.links[0].url).toBe(ALVO);
  });

  it('descarta link sem alvo, que nao levaria a lugar nenhum', async () => {
    resposta = [
      { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 18 } }, target: ALVO },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
    ];
    const r = await (await provider()).provideLinks(modelo);

    expect(r.links).toHaveLength(1);
  });

  it('nao pergunta nada com o slang desligado', async () => {
    window.localStorage.setItem('slangEnabled', 'false');
    resposta = [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 18 } }, target: ALVO }];
    const r = await (await provider()).provideLinks(modelo);

    expect(r.links).toEqual([]);
  });

  it('nao deixa o erro do slang subir para o editor', async () => {
    resposta = new Error('slang caiu');
    const r = await (await provider()).provideLinks(modelo);

    expect(r.links).toEqual([]);
  });
});

describe('include clicavel: o clique', () => {
  it('abre o arquivo numa aba em vez de navegar', async () => {
    await provider();
    expect(opener).toBeTruthy();

    const tratou = opener.open({ scheme: 'file', fsPath: 'C:/proj/defs.vh' });
    expect(tratou).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(lidos).toEqual(['C:/proj/defs.vh']);
    expect(abertos).toEqual(['C:/proj/defs.vh']);
  });

  it('nao sequestra link que nao e de arquivo', async () => {
    await provider();

    expect(opener.open({ scheme: 'https', fsPath: '' })).toBe(false);
    expect(opener.open(null)).toBe(false);
    expect(abertos).toEqual([]);
  });
});
