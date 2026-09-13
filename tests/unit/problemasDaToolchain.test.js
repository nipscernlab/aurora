// @vitest-environment happy-dom
/**
 * Erro de compilador virando marcador no editor:
 *   js/terminal/error_locations.js (a leitura) + js/terminal/problem_store.js (o deposito).
 *
 * O compilador sempre disse onde estava o erro, e a AURORA mostrava isso so
 * como texto no terminal. Dentro do editor o arquivo ficava limpo: nenhum
 * rabisco, nada na barra de rolagem. Quem fechasse o terminal perdia o erro de
 * vista, e um erro num arquivo que ninguem abriu era invisivel do comeco ao
 * fim. O editor ja rabiscava o que o LSP achava; o que TRAVA A COMPILACAO nao
 * aparecia.
 *
 * A leitura e da saida de texto que as ferramentas ja imprimem, e nao de um
 * canal novo: mexer no yanc esta fora de escopo por ora. Por isso os testes
 * usam saida REAL das quatro ferramentas, que e o contrato de verdade deste
 * codigo. Se o Icarus mudar o formato de uma mensagem, e aqui que tem de doer.
 *
 * Tres decisoes que os testes guardam:
 *
 *   - severidade pela MARCA da ferramenta, no lugar onde ela imprime, e nao
 *     pela palavra solta no meio do texto. `%Warning-WIDTH` e aviso; uma
 *     mensagem de erro que contenha a palavra "warning" segue sendo erro. Na
 *     duvida, erro: o engano para mais se ve e se corrige, o para menos
 *     esconde o que trava a compilacao;
 *   - dono proprio, `toolchain`, separado de `verible` e `slang`. O LSP diz o
 *     que acha enquanto se digita; a toolchain diz o que houve ao compilar.
 *     Limpar um nao pode apagar o outro;
 *   - o problema sobrevive ao arquivo fechado. Marcador so existe em modelo
 *     aberto, e o erro mais facil de perder e o do arquivo que ninguem abriu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { problemasNaLinha, severidadeDaLinha } from '../../js/terminal/error_locations.js';

const CMM = 'C:/proj/MeuProc/Software/proc.cmm';

let modelos;
let marcadores;   // dono -> caminho -> lista
let aoCriarModelo;

function modeloFalso(fsPath, linhas = 40) {
  return {
    uri: { fsPath, toString: () => 'file:///' + fsPath },
    isDisposed: () => false,
    getLineCount: () => linhas,
    getLineMaxColumn: () => 80,
  };
}

function montarMonaco() {
  modelos = [];
  marcadores = {};
  aoCriarModelo = null;
  globalThis.monaco = {
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
      getModels: () => modelos,
      onDidCreateModel: (cb) => { aoCriarModelo = cb; },
      setModelMarkers: (model, dono, lista) => {
        marcadores[dono] = marcadores[dono] || {};
        marcadores[dono][model.uri.fsPath] = lista;
      },
    },
  };
}

async function deposito() {
  const mod = await import('../../js/terminal/problem_store.js?r=' + Math.random());
  return mod.problemStore;
}

const registrar = (store, texto) => store.registrarLinha(texto, { cmmPadrao: CMM, problemasNaLinha });

beforeEach(() => { montarMonaco(); });

describe('leitura: severidade pela marca da ferramenta', () => {
  it('separa erro de aviso no Verilator, que usa sufixo', () => {
    expect(severidadeDaLinha('%Error: C:/p/tb.v:5:3: syntax error')).toBe('erro');
    expect(severidadeDaLinha('%Warning-WIDTH: C:/p/tb.v:9:14: Operator ASSIGN')).toBe('aviso');
  });

  it('separa erro de aviso no estilo GCC, onde a palavra vem depois do local', () => {
    expect(severidadeDaLinha('C:/p/top.v:5: error: Invalid module item.')).toBe('erro');
    expect(severidadeDaLinha('C:/p/top.v:5: warning: implicit definition')).toBe('aviso');
  });

  it('separa erro de aviso no yanc, nas duas linguas', () => {
    expect(severidadeDaLinha('Erro na linha 2: declare a variavel y.')).toBe('erro');
    expect(severidadeDaLinha('Atencao na linha 7: isso pode dar errado.')).toBe('aviso');
    expect(severidadeDaLinha('Warning on line 7: watch out.')).toBe('aviso');
  });

  it('na duvida e erro, e nao aviso', () => {
    // Esconder o que trava a compilacao e pior do que um vermelho a mais.
    expect(severidadeDaLinha('alguma coisa aconteceu')).toBe('erro');
  });

  it('a palavra no meio do texto nao muda a severidade', () => {
    // A ferramenta disse Error; a frase contem "warning". Vale a marca dela.
    expect(severidadeDaLinha('%Error: C:/p/tb.v:5:3: ignoring warning pragma')).toBe('erro');
  });
});

describe('leitura: a mensagem, sem o local', () => {
  const um = (texto) => problemasNaLinha(texto, { cmmPadrao: CMM })[0];

  it('Icarus: caminho e linha, sem coluna', () => {
    const p = um('C:/proj/Hardware/top.v:5: error: Invalid module item.');
    expect(p).toMatchObject({ linha: 5, coluna: null, severidade: 'erro', ferramenta: 'icarus' });
    expect(p.mensagem).toBe('Invalid module item.');
  });

  it('Verilator: linha e coluna', () => {
    const p = um('%Error: C:/proj/Sim/tb.v:5:3: syntax error, unexpected assign');
    expect(p).toMatchObject({ linha: 5, coluna: 3, ferramenta: 'verilator' });
    expect(p.mensagem).toBe('syntax error, unexpected assign');
  });

  it('yanc: sem arquivo na mensagem, cai no .cmm que se mandou compilar', () => {
    const p = um('Erro na linha 2: se voce declarar a variavel y eu agradeco.');
    expect(p.arquivo).toBe(CMM);
    expect(p.linha).toBe(2);
    expect(p.mensagem).toBe('se voce declarar a variavel y eu agradeco.');
  });

  it('cocotb: o formato do Python', () => {
    const p = um('File "C:/proj/Sim/tb_soma.py", line 42, in teste');
    expect(p).toMatchObject({ linha: 42, ferramenta: 'python' });
    expect(p.arquivo).toBe('C:/proj/Sim/tb_soma.py');
  });

  it('linha que so tem o local nao vira marcador mudo', () => {
    const p = um('C:/proj/Hardware/top.v:12');
    expect(p.mensagem.length).toBeGreaterThan(0);
  });

  it('sem .cmm conhecido, a mensagem do yanc nao vira problema orfao', () => {
    const p = problemasNaLinha('Erro na linha 2: algo.', { cmmPadrao: null });
    expect(p).toEqual([]);
  });
});

describe('deposito: marcadores no editor', () => {
  it('rabisca o arquivo que esta aberto', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Hardware/top.v'));
    store.ligar();

    registrar(store, 'C:/proj/Hardware/top.v:5: error: Invalid module item.');

    const m = marcadores.toolchain['C:/proj/Hardware/top.v'];
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe(8);          // Error
    expect(m[0].startLineNumber).toBe(5);
    expect(m[0].message).toBe('Invalid module item.');
    expect(m[0].source).toBe('icarus');
  });

  it('usa o dono toolchain, que nao se mistura com o do LSP', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Hardware/top.v'));
    store.ligar();
    registrar(store, 'C:/proj/Hardware/top.v:5: error: x');

    expect(Object.keys(marcadores)).toEqual(['toolchain']);
  });

  it('sem coluna, o marcador cobre a linha inteira', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Hardware/top.v'));
    store.ligar();
    registrar(store, 'C:/proj/Hardware/top.v:5: error: x');

    const m = marcadores.toolchain['C:/proj/Hardware/top.v'][0];
    expect(m.startColumn).toBe(1);
    expect(m.endColumn).toBe(80);
  });

  it('com coluna, o marcador fica onde a ferramenta apontou', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Sim/tb.v'));
    store.ligar();
    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');

    const m = marcadores.toolchain['C:/proj/Sim/tb.v'][0];
    expect(m.startColumn).toBe(3);
  });

  it('linha alem do fim do arquivo nao estoura', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Hardware/top.v', 10));
    store.ligar();
    registrar(store, 'C:/proj/Hardware/top.v:999: error: x');

    expect(marcadores.toolchain['C:/proj/Hardware/top.v'][0].startLineNumber).toBe(10);
  });
});

describe('deposito: o arquivo que ninguem abriu', () => {
  it('guarda o problema mesmo sem modelo, e rabisca quando o arquivo abre', async () => {
    const store = await deposito();
    store.ligar();

    registrar(store, 'C:/proj/Hardware/fechado.v:7: error: nao esta aberto');
    expect(marcadores.toolchain).toBeUndefined();
    expect(store.contagem()).toEqual({ erros: 1, avisos: 0 });

    // Agora a pessoa abre o arquivo que o erro apontou.
    const model = modeloFalso('C:/proj/Hardware/fechado.v');
    modelos.push(model);
    aoCriarModelo(model);

    expect(marcadores.toolchain['C:/proj/Hardware/fechado.v']).toHaveLength(1);
  });

  it('a barra mista do Verilator casa com o caminho do modelo', async () => {
    const store = await deposito();
    // O Verilator junta o que recebeu com o que descobriu e devolve
    // `C:/proj/Sim\tb.v`. Comparar texto cru faria dois arquivos de um so.
    modelos.push(modeloFalso('C:\\proj\\Sim\\tb.v'));
    store.ligar();

    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');

    expect(marcadores.toolchain['C:\\proj\\Sim\\tb.v']).toHaveLength(1);
  });
});

describe('deposito: uma rodada de cada vez', () => {
  it('nao conta o mesmo erro duas vezes', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Sim/tb.v'));
    store.ligar();

    // O Verilator repete o local na linha de continuacao.
    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');
    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');

    expect(marcadores.toolchain['C:/proj/Sim/tb.v']).toHaveLength(1);
    expect(store.contagem()).toEqual({ erros: 1, avisos: 0 });
  });

  it('limpar apaga os rabiscos na hora, e nao quando os novos chegarem', async () => {
    const store = await deposito();
    modelos.push(modeloFalso('C:/proj/Sim/tb.v'));
    store.ligar();
    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');
    expect(marcadores.toolchain['C:/proj/Sim/tb.v']).toHaveLength(1);

    store.limpar();

    expect(marcadores.toolchain['C:/proj/Sim/tb.v']).toEqual([]);
    expect(store.contagem()).toEqual({ erros: 0, avisos: 0 });
    expect(store.listar()).toEqual([]);
  });

  it('conta erros e avisos separados, para quem for mostrar o resumo', async () => {
    const store = await deposito();
    store.ligar();
    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');
    registrar(store, '%Warning-WIDTH: C:/proj/Sim/tb.v:9:14: Operator ASSIGN');
    registrar(store, 'C:/proj/Hardware/top.v:5: error: outro');

    expect(store.contagem()).toEqual({ erros: 2, avisos: 1 });
    expect(store.listar()).toHaveLength(2);
  });

  it('avisa quem estiver ouvindo quando a lista muda', async () => {
    const store = await deposito();
    store.ligar();
    let vezes = 0;
    const parar = store.aoMudar(() => { vezes += 1; });

    registrar(store, '%Error: C:/proj/Sim/tb.v:5:3: syntax error');
    store.limpar();
    parar();
    registrar(store, '%Error: C:/proj/Sim/tb.v:6:3: outro');

    expect(vezes).toBe(2);
  });
});
