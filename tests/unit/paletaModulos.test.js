// @vitest-environment happy-dom
/**
 * Ir a qualquer modulo do projeto: o modo `#` da paleta (js/ui/command_palette.js).
 *
 * O valor do recurso esta inteiro numa palavra: PROJETO. Achar o que ja esta
 * aberto se faz pelas abas; o que vale a pena e achar o modulo num arquivo que
 * ninguem abriu. Quem sabe isso e o slang, que indexa a raiz do projeto. O
 * Verible nao implementa `workspace/symbol`, responde "method not found"
 * (-32601), entao este recurso so existe com o slang ligado.
 *
 * Duas coisas medidas contra o binario moldam a interface:
 *
 *   - o slang indexa MODULO, e nao sinal. Procurar pelo nome de um sinal volta
 *     vazio. A lista diz isso com todas as letras, senao a pessoa conclui que
 *     digitou errado e tenta de novo, e de novo;
 *   - o slang filtra do lado dele, entao a consulta vai junto no pedido, e cada
 *     tecla e uma viagem. Por isso cada busca carrega um numero e a resposta
 *     que volta com numero velho e jogada fora: sem isso a lista pisca o
 *     resultado de uma consulta que a pessoa ja abandonou.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandPalette } from '../../js/ui/command_palette.js';

const ARQ = 'C:/proj/somador.v';
const uriDe = (p) => 'file:///' + p;

let paleta;
let tela;
let respostaDoSlang;
let consultasFeitas;
let slangLigado;
let slangAlternado;
let abertos;
let editoresProntos;
let foiPara;

/** A casca do componente; o controlador so escreve nela. */
function telaFalsa() {
  return { offsetWidth: 0, open: false, items: [], selected: 0, textoInicial: '' };
}

const simbolo = (nome, arquivo, linha) => ({
  name: nome,
  kind: 2,
  location: { uri: uriDe(arquivo), range: { start: { line: linha, character: 0 }, end: { line: linha, character: 9 } } },
});

/** Deixa as promessas pendentes resolverem. */
const assentar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  respostaDoSlang = [];
  consultasFeitas = [];
  slangLigado = true;
  slangAlternado = 0;
  abertos = [];
  editoresProntos = true;
  foiPara = [];

  globalThis.window = globalThis.window || {};
  window.monaco = {
    Uri: { parse: (s) => ({ fsPath: s.slice('file:///'.length) }) },
  };
  window.slangAPI = {
    workspaceSymbol: async (q) => {
      consultasFeitas.push(q);
      if (respostaDoSlang instanceof Error) throw respostaDoSlang;
      return typeof respostaDoSlang === 'function' ? respostaDoSlang(q) : respostaDoSlang;
    },
  };
  window.AuroraSlang = {
    isEnabled: () => slangLigado,
    toggle: () => { slangAlternado += 1; },
  };
  window.electronAPI = { readFile: async () => 'module somador_fechado; endmodule' };
  window.TabManager = { addTab: (p) => abertos.push(p) };
  window.EditorManager = {
    getEditorForFile: (p) => (editoresProntos ? {
      setPosition: ({ lineNumber }) => foiPara.push([p, lineNumber]),
      revealLineInCenter: () => {},
      focus: () => {},
    } : null),
  };

  paleta = new CommandPalette();
  // Injetar a casca faz o _build() sair cedo, entao o teste exercita o
  // controlador sem depender do componente Lit.
  tela = telaFalsa();
  paleta._el = tela;
});

describe('paleta: o prefixo # troca de modo', () => {
  it('sem o prefixo continua listando comandos', async () => {
    paleta.open();
    await assentar();

    expect(consultasFeitas).toEqual([]);
    expect(tela.items.length).toBeGreaterThan(5);
    expect(tela.items.some((i) => i.group === 'Compile')).toBe(true);
  });

  it('Ctrl+T abre ja no modo simbolo', async () => {
    paleta.open('#');
    await assentar();

    expect(tela.textoInicial).toBe('#');
    expect(consultasFeitas).toEqual(['']);
  });

  it('manda ao slang so o que vem depois do #', async () => {
    paleta.open('#');
    paleta._refilter('#  som ');
    await assentar();

    expect(consultasFeitas).toEqual(['', 'som']);
  });

  it('voltar a digitar comando sai do modo simbolo', async () => {
    paleta.open('#');
    await assentar();
    paleta._refilter('compile');
    await assentar();

    expect(tela.items.some((i) => i.group === 'Compile')).toBe(true);
    expect(tela.items.some((i) => i.group === 'Modules')).toBe(false);
  });
});

describe('paleta: os modulos viram linhas', () => {
  it('mostra o nome do modulo e o arquivo onde ele mora', async () => {
    respostaDoSlang = [simbolo('somador_fechado', ARQ, 0)];
    paleta.open('#');
    await assentar();

    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toBe('somador_fechado');
    expect(tela.items[0].detalhe).toBe('somador.v');
    expect(tela.items[0].group).toBe('Modules');
  });

  it('abre o arquivo e leva o cursor ate a linha do modulo', async () => {
    respostaDoSlang = [simbolo('somador_fechado', ARQ, 4)];
    paleta.open('#');
    await assentar();

    paleta._run(0);
    await assentar();
    await assentar();

    expect(abertos).toEqual([ARQ]);
    // A linha do LSP conta de 0 e a do editor conta de 1.
    expect(foiPara).toEqual([[ARQ, 5]]);
  });

  it('descarta simbolo sem nome ou sem lugar', async () => {
    respostaDoSlang = [
      simbolo('bom', ARQ, 0),
      { name: 'sem lugar' },
      { location: { uri: uriDe(ARQ), range: { start: { line: 0, character: 0 } } } },
    ];
    paleta.open('#');
    await assentar();

    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toBe('bom');
  });
});

describe('paleta: quando nao ha o que mostrar', () => {
  it('sem slang, oferece ligar o slang ali mesmo', async () => {
    slangLigado = false;
    paleta.open('#');
    await assentar();

    expect(consultasFeitas).toEqual([]);
    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toMatch(/needs slang/i);

    paleta._run(0);
    expect(slangAlternado).toBe(1);
  });

  it('diz que so modulo e indexado, para quem procurou um sinal', async () => {
    respostaDoSlang = [];
    paleta.open('#');
    paleta._refilter('#valor');
    await assentar();

    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toMatch(/only modules are indexed/i);
  });

  it('nao quebra quando o slang estoura', async () => {
    respostaDoSlang = new Error('slang caiu');
    paleta.open('#');
    await assentar();

    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toMatch(/no module/i);
  });
});

describe('paleta: digitar rapido', () => {
  it('ignora a resposta de uma consulta que a pessoa ja abandonou', async () => {
    // A primeira consulta demora e volta DEPOIS da segunda. Sem o numero de
    // ordem, ela sobrescreveria o resultado certo.
    const atrasos = { som: 40, somador: 0 };
    respostaDoSlang = (q) => new Promise((r) => setTimeout(
      () => r([simbolo(q === 'som' ? 'LENTA' : 'RAPIDA', ARQ, 0)]), atrasos[q] ?? 0));

    paleta.open('#');
    paleta._refilter('#som');
    paleta._refilter('#somador');
    await new Promise((r) => setTimeout(r, 80));

    expect(tela.items).toHaveLength(1);
    expect(tela.items[0].title).toBe('RAPIDA');
  });

  it('nao escreve na lista depois que a paleta fecha', async () => {
    respostaDoSlang = (q) => new Promise((r) => setTimeout(() => r([simbolo(q, ARQ, 0)]), 30));
    paleta.open('#');
    paleta._refilter('#som');
    paleta.close();
    tela.items = ['marcador'];
    await new Promise((r) => setTimeout(r, 60));

    expect(tela.items).toEqual(['marcador']);
  });
});
