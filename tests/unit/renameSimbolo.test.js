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
let acoesDe;
let metaDasAcoes;
let realcesDe;
let realceDoVerible;
let realceDoSlang;
let quemFoiPerguntado;
let slangLigado;
let abertos;
let ativados;
let respostaDoLsp;
let respostaDasAcoes;
let pedidosDeAcao;
let arquivosLegiveis;
let publicarDiagnosticos;

/**
 * `scheme: 'file'` e `getLanguageId` importam: sem eles o modulo nao considera
 * o modelo seu (isLspModel), nao o acompanha, e o teste de fechar arquivo
 * passaria por nao fazer nada, em vez de por funcionar.
 */
function modeloFalso(uri) {
  const aoDescartar = [];
  return {
    uri: { toString: () => uri, fsPath: uri.slice(PREFIXO.length), scheme: 'file' },
    isDisposed: () => false,
    getLanguageId: () => 'verilog',
    getValue: () => '',
    onDidChangeContent: () => ({ dispose() {} }),
    onWillDispose: (cb) => { aoDescartar.push(cb); return { dispose() {} }; },
    _descartar: () => { for (const cb of aoDescartar.splice(0)) cb(); },
  };
}

/** Fecha o arquivo como o Monaco faz: dispara o onWillDispose do modelo. */
function descartar(uri) {
  const m = modelos.get(uri);
  if (m) m._descartar();
}

function montarMonaco() {
  providers = {};
  acoesDe = {};
  metaDasAcoes = null;
  realcesDe = {};
  globalThis.monaco = {
    Range: class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } },
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
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
      registerCodeActionProvider: (lang, p, meta) => {
        acoesDe[lang] = p;
        metaDasAcoes = meta;
      },
      registerDocumentHighlightProvider: (lang, p) => { realcesDe[lang] = p; },
    },
  };
}

async function carregar() {
  const mod = await import('../../js/editor/lsp_integration.js?r=' + Math.random());
  mod.initVerilogLSP();
  return mod;
}

async function provider() {
  await carregar();
  return providers.verilog;
}

/** O provider da lampada, ja com os diagnosticos entregues como o servidor os manda. */
async function lampada(diagnosticos) {
  await carregar();
  publicarDiagnosticos(uriDe(ARQ_A), diagnosticos);
  return acoesDe.verilog;
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

  respostaDasAcoes = [];
  pedidosDeAcao = [];
  realceDoVerible = [];
  realceDoSlang = [];
  quemFoiPerguntado = [];
  slangLigado = true;

  globalThis.window = globalThis.window || {};
  window.lspAPI = {
    // O modulo assina uma vez; guardamos o callback para poder publicar
    // diagnosticos no meio do teste, como o servidor faz.
    onDiagnostics: (cb) => { publicarDiagnosticos = (uri, ds) => cb({ uri, diagnostics: ds }); },
    didOpen: () => {},
    didChange: () => {},
    didClose: () => {},
    rename: async () => respostaDoLsp,
    codeAction: async (uri, range, diagnostics) => {
      pedidosDeAcao.push({ uri, range, diagnostics });
      return respostaDasAcoes;
    },
    documentHighlight: async () => {
      quemFoiPerguntado.push('verible');
      return realceDoVerible;
    },
  };
  window.slangAPI = {
    documentHighlight: async () => {
      quemFoiPerguntado.push('slang');
      if (realceDoSlang instanceof Error) throw realceDoSlang;
      return realceDoSlang;
    },
  };
  window.AuroraSlang = { isEnabled: () => slangLigado };
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

/**
 * A lampada (quick fix). O Verible so oferece acao PRESA A DIAGNOSTICO, e cada
 * uma ja vem com a edicao pronta. Medido contra o binario: num arquivo limpo a
 * resposta e lista vazia, e os tres fixes que ele sabe fazer sao renomear o
 * modulo para casar com o arquivo, tirar espaco no fim da linha e acrescentar
 * a quebra final.
 *
 * Por isso o provider so pergunta quando ha diagnostico no trecho: o Monaco o
 * chama a cada movimento de cursor, e perguntar sempre seria uma viagem de IPC
 * por tecla apertada para receber nada.
 */
describe('quick fix: a lampada', () => {
  const FAIXA = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 };
  const diagnostico = (linha, de, ate, msg) => ({
    range: { start: { line: linha, character: de }, end: { line: linha, character: ate } },
    message: msg,
    severity: 2,
    source: 'verible',
  });
  const acaoDoVerible = (titulo, texto) => ({
    title: titulo,
    kind: 'quickfix',
    edit: { changes: { [uriDe(ARQ_A)]: [edicao(0, 22, 25, texto)] } },
  });

  it('anuncia que fornece quickfix, senao o Monaco nem chama', async () => {
    await carregar();
    expect(metaDasAcoes).toEqual({ providedCodeActionKinds: ['quickfix'] });
  });

  it('nao pergunta ao servidor quando nao ha diagnostico no trecho', async () => {
    const p = await lampada([diagnostico(8, 0, 1, 'la longe')]);
    const r = await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA);

    expect(pedidosDeAcao).toEqual([]);
    expect(r.actions).toEqual([]);
  });

  it('devolve o diagnostico ORIGINAL do servidor, nao o marker traduzido', async () => {
    const d = diagnostico(0, 22, 25, 'Remove trailing spaces. [Style: trailing-spaces]');
    respostaDasAcoes = [acaoDoVerible('Remove trailing space', '')];
    const p = await lampada([d]);
    await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA);

    expect(pedidosDeAcao).toHaveLength(1);
    expect(pedidosDeAcao[0].diagnostics).toEqual([d]);
  });

  it('converte a acao do Verible em acao do Monaco, com a edicao junto', async () => {
    respostaDasAcoes = [acaoDoVerible('Remove trailing space', '')];
    const p = await lampada([diagnostico(0, 22, 25, 'Remove trailing spaces.')]);
    const r = await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA);

    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].title).toBe('Remove trailing space');
    expect(r.actions[0].kind).toBe('quickfix');
    expect(r.actions[0].edit.edits).toHaveLength(1);
    expect(r.actions[0].edit.edits[0].versionId).toBeUndefined();
  });

  it('nao oferece fix que alcanca arquivo fechado, em vez de estourar no clique', async () => {
    respostaDasAcoes = [{
      title: 'mexe em arquivo que nao esta aberto',
      kind: 'quickfix',
      edit: { changes: { [uriDe(ARQ_B)]: [edicao(0, 0, 1, 'x')] } },
    }];
    const p = await lampada([diagnostico(0, 22, 25, 'Remove trailing spaces.')]);
    const r = await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA);

    expect(r.actions).toEqual([]);
    expect(abertos).toEqual([]);
  });

  it('esquece os diagnosticos quando o arquivo e fechado', async () => {
    respostaDasAcoes = [acaoDoVerible('Remove trailing space', '')];
    const p = await lampada([diagnostico(0, 22, 25, 'Remove trailing spaces.')]);
    expect((await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA)).actions).toHaveLength(1);

    descartar(uriDe(ARQ_A));
    expect((await p.provideCodeActions(modelos.get(uriDe(ARQ_A)), FAIXA)).actions).toEqual([]);
  });
});

/**
 * Realcar as ocorrencias do simbolo sob o cursor.
 *
 * Os dois servidores respondem, e o Verible responde ERRADO de um jeito que
 * importa num editor de ensino: ele casa por texto, entao com o cursor no
 * `reset` de quem instancia ele realca tambem o `.reset(` da instanciacao, que
 * e a porta do modulo de dentro, outro simbolo com o mesmo nome. Confundir os
 * dois e exatamente o engano que o aluno ja comete sozinho.
 *
 * Por isso o slang vem primeiro e o Verible fica de reserva, para quando o
 * slang estiver desligado pelo toggle do O11 ou nao instalado. Realce um pouco
 * largo e melhor do que realce nenhum, mas nao e o primeiro a ser escolhido.
 */
describe('realce de ocorrencias: quem responde', () => {
  const POS = { lineNumber: 3, column: 15 };
  const realce = (linha, de, ate) => ({
    range: { start: { line: linha, character: de }, end: { line: linha, character: ate } },
  });

  async function realcador() {
    await carregar();
    return realcesDe.verilog;
  }

  it('pergunta ao slang primeiro e nem consulta o Verible quando ele responde', async () => {
    realceDoSlang = [realce(2, 13, 18)];
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(quemFoiPerguntado).toEqual(['slang']);
    expect(r).toHaveLength(1);
  });

  it('cai no Verible quando o slang esta desligado', async () => {
    slangLigado = false;
    realceDoVerible = [realce(2, 13, 18), realce(7, 4, 9)];
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(quemFoiPerguntado).toEqual(['verible']);
    expect(r).toHaveLength(2);
  });

  it('cai no Verible quando o slang nao acha nada', async () => {
    realceDoSlang = [];
    realceDoVerible = [realce(2, 13, 18)];
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(quemFoiPerguntado).toEqual(['slang', 'verible']);
    expect(r).toHaveLength(1);
  });

  it('cai no Verible quando o slang estoura, em vez de derrubar o realce', async () => {
    realceDoSlang = new Error('slang morreu no meio');
    realceDoVerible = [realce(2, 13, 18)];
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(quemFoiPerguntado).toEqual(['slang', 'verible']);
    expect(r).toHaveLength(1);
  });

  it('traduz o kind, que conta de 1 no LSP e de 0 no Monaco', async () => {
    realceDoSlang = [
      { ...realce(2, 13, 18), kind: 2 },
      { ...realce(7, 4, 9), kind: 3 },
      realce(9, 0, 3),
    ];
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(r[0].kind).toBe(1);
    expect(r[1].kind).toBe(2);
    // Sem kind o Monaco usa o realce neutro, que e o que os dois servidores
    // produzem hoje: nenhum manda kind.
    expect(r[2].kind).toBeUndefined();
  });

  it('aguenta resposta que nao e lista', async () => {
    realceDoSlang = null;
    realceDoVerible = null;
    const r = await (await realcador()).provideDocumentHighlights(modelos.get(uriDe(ARQ_A)), POS);

    expect(r).toEqual([]);
  });
});
