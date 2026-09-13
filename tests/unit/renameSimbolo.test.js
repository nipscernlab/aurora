/**
 * Renomear simbolo (F2) em Verilog/SystemVerilog: js/editor/lsp_integration.js.
 *
 * O Verible responde um WorkspaceEdit que quase sempre CRUZA ARQUIVOS, porque
 * renomear a porta de um modulo reescreve a instanciacao dele em outro lugar.
 * Isso esbarra numa regra dura do Monaco: o bulk edit recusa a edicao INTEIRA
 * se algum arquivo alvo nao tiver modelo ("bad edit - model not found"), e ele
 * confere antes de aplicar qualquer coisa.
 *
 * Essa recusa e sorte nossa, porque a alternativa seria renomear pela metade e
 * deixar o projeto sem compilar. Mas ela tambem tornaria inutil um rename que
 * alcance arquivo fechado, que e o caso comum. Por isso o provider ABRE os
 * arquivos que faltam antes de devolver a edicao: abrir e o que cria o modelo,
 * e e tambem o que deixa a mudanca visivel, suja, desfazivel com Ctrl+Z e
 * salvavel com Ctrl+S. Gravar no disco por baixo do pano faria o contrario.
 *
 * O que se prova aqui:
 *   - as duas formas de WorkspaceEdit (changes e documentChanges) chegam no
 *     mesmo lugar, e operacao de ARQUIVO (criar/renomear/apagar) e ignorada em
 *     vez de virar palpite;
 *   - arquivo fechado e aberto antes, e o foco volta para onde o usuario estava;
 *   - se algum arquivo NAO abrir, nada e alterado e o usuario recebe um motivo,
 *     em vez do "bad edit" cru do Monaco;
 *   - as edicoes vao sem versionId, senao o Monaco aborta com "model changed in
 *     the meantime" justamente nos arquivos que acabamos de abrir.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const ARQ_A = 'C:/proj/contador.v';
const ARQ_B = 'C:/proj/topo.v';
const PREFIXO = 'file:///';
const uriDe = (p) => PREFIXO + p;

let modelos;
let providers;
let abertos;
let ativados;
let respostaDoLsp;
let arquivosLegiveis;

function modeloFalso(uri) {
  return {
    uri: { toString: () => uri, fsPath: uri.slice(PREFIXO.length) },
    isDisposed: () => false,
    getLanguageId: () => 'verilog',
    getValue: () => '',
    onDidChangeContent: () => ({ dispose() {} }),
    onWillDispose: () => ({ dispose() {} }),
  };
}

function montarMonaco() {
  providers = {};
  globalThis.monaco = {
    Range: class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } },
    Uri: {
      parse: (s) => ({ toString: () => s, fsPath: s.slice(PREFIXO.length) }),
      file: (p) => ({ toString: () => uriDe(p), fsPath: p }),
    },
    editor: {
      getModel: (uri) => modelos.get(String(uri)) || null,
      getModels: () => [...modelos.values()],
      setModelMarkers: () => {},
      onDidCreateModel: () => {},
      onDidChangeModelLanguage: () => {},
    },
    languages: {
      registerDocumentFormattingEditProvider: () => {},
      registerDocumentSymbolProvider: () => {},
      registerHoverProvider: () => {},
      registerDefinitionProvider: () => {},
      registerReferenceProvider: () => {},
      registerRenameProvider: (lang, p) => { providers[lang] = p; },
    },
  };
}

async function provider() {
  const mod = await import('../../js/editor/lsp_integration.js?r=' + Math.random());
  mod.initVerilogLSP();
  return providers.verilog;
}

const edicao = (linha, de, ate, texto) => ({
  range: { start: { line: linha, character: de }, end: { line: linha, character: ate } },
  newText: texto,
});

beforeEach(() => {
  modelos = new Map();
  abertos = [];
  ativados = [];
  respostaDoLsp = null;
  arquivosLegiveis = new Set([ARQ_A, ARQ_B]);
  modelos.set(uriDe(ARQ_A), modeloFalso(uriDe(ARQ_A)));
  montarMonaco();

  globalThis.window = globalThis.window || {};
  window.lspAPI = { onDiagnostics: () => {}, rename: async () => respostaDoLsp };
  window.electronAPI = {
    readFile: async (p) => {
      if (!arquivosLegiveis.has(p)) throw new Error('sumiu');
      return 'module x; endmodule';
    },
  };
  window.TabManager = {
    getEditingFilePath: () => ARQ_A,
    addTab: (p) => {
      abertos.push(p);
      // O de verdade cria o modelo dentro de um IIFE assincrono; aqui basta
      // que ele passe a existir, que e o que o provider espera.
      modelos.set(uriDe(p), modeloFalso(uriDe(p)));
    },
    activateTab: (p) => { ativados.push(p); },
  };
  window.t = null;
});

describe('rename: as duas formas de WorkspaceEdit', () => {
  it('aceita changes e converte para edicao do Monaco', async () => {
    respostaDoLsp = { changes: { [uriDe(ARQ_A)]: [edicao(1, 14, 17, 'relogio')] } };
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 2, column: 15 }, 'relogio');

    expect(r.rejectReason).toBeUndefined();
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].textEdit.text).toBe('relogio');
  });

  it('aceita documentChanges e ignora operacao de ARQUIVO', async () => {
    respostaDoLsp = {
      documentChanges: [
        { textDocument: { uri: uriDe(ARQ_A), version: 3 }, edits: [edicao(0, 0, 3, 'novo')] },
        { kind: 'create', uri: uriDe('C:/proj/inventado.v') },
      ],
    };
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 1, column: 1 }, 'novo');

    expect(r.edits).toHaveLength(1);
    expect(abertos).toEqual([]);
  });
});

describe('rename: arquivo que o usuario nao abriu', () => {
  it('abre o que falta e devolve o foco para onde o usuario estava', async () => {
    respostaDoLsp = {
      changes: {
        [uriDe(ARQ_A)]: [edicao(1, 14, 17, 'relogio')],
        [uriDe(ARQ_B)]: [edicao(6, 5, 8, 'relogio')],
      },
    };
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 2, column: 15 }, 'relogio');

    expect(abertos).toEqual([ARQ_B]);
    expect(ativados).toEqual([ARQ_A]);
    expect(r.edits).toHaveLength(2);
  });

  it('nao altera NADA quando um dos arquivos nao abre, e diz por que', async () => {
    arquivosLegiveis.delete(ARQ_B);
    respostaDoLsp = {
      changes: {
        [uriDe(ARQ_A)]: [edicao(1, 14, 17, 'relogio')],
        [uriDe(ARQ_B)]: [edicao(6, 5, 8, 'relogio')],
      },
    };
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 2, column: 15 }, 'relogio');

    expect(r.edits).toEqual([]);
    expect(r.rejectReason).toMatch(/could not be opened/i);
  });
});

describe('rename: recusas e o que o Monaco cobra', () => {
  it('recusa com motivo quando o servidor nao devolve edicao', async () => {
    respostaDoLsp = null;
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 1, column: 1 }, 'x');

    expect(r.edits).toEqual([]);
    expect(r.rejectReason).toMatch(/cannot be renamed/i);
  });

  it('manda versionId indefinido, senao o Monaco aborta no arquivo recem-aberto', async () => {
    respostaDoLsp = {
      documentChanges: [
        { textDocument: { uri: uriDe(ARQ_A), version: 7 }, edits: [edicao(0, 0, 1, 'z')] },
      ],
    };
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 1, column: 1 }, 'z');

    expect(r.edits[0].versionId).toBeUndefined();
  });

  it('usa a traducao quando ela existe', async () => {
    window.t = (k) => (k === 'editor.renameNoSymbol' ? 'traduzido' : null);
    respostaDoLsp = {};
    const p = await provider();
    const r = await p.provideRenameEdits(
      modelos.get(uriDe(ARQ_A)), { lineNumber: 1, column: 1 }, 'x');

    expect(r.rejectReason).toBe('traduzido');
  });
});
