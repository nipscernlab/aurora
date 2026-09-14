/**
 * O projeto muda de computador e o `.gtkw` continua sendo achado:
 * js/wave/wave_state_store.js.
 *
 * O RELATO. Um aluno levou um projeto de uma maquina para outra. O projeto
 * tinha um `.gtkw` escolhido, e ao compilar a AURORA foi abrir o caminho da
 * primeira maquina. O arquivo estava ali, dentro da pasta do projeto, junto com
 * todo o resto que veio no pendrive; o que nao veio foi a letra de unidade e o
 * nome do usuario.
 *
 * O arquivo `<projeto>/testbench/<tb>.json` viaja com o projeto e guardava
 * `tbPath` e o caminho de cada `.gtkw` em ABSOLUTO. Um dado que viaja nao pode
 * carregar o caminho da maquina onde foi gravado.
 *
 * Tres coisas se testam aqui, e as tres falham de formas diferentes:
 *
 *   grava relativo      , senao o proximo computador herda o problema;
 *   le contra a raiz de hoje , senao gravar relativo nao serviria de nada;
 *   resgata o absoluto velho , senao a correcao valeria so para projeto novo
 *                              e o aluno que trouxe o caso continuaria preso.
 *
 * O disco e de mentira: um Map de caminho para conteudo. O que se exercita e o
 * store de verdade, com a ponte trocada.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// A ponte e um Proxy que resolve `window.electronAPI` na hora da chamada
// (js/app/electron_api.js), entao trocar o global basta e o codigo exercitado
// continua sendo o de producao.
const disco = new Map();

vi.hoisted(() => { globalThis.window = globalThis.window || {}; });

beforeEach(() => {
  disco.clear();
  globalThis.window.electronAPI = {
    joinPath: async (...p) => p.join('/').replace(/\\/g, '/'),
    fileExists: async (p) => disco.has(String(p).replace(/\\/g, '/')),
    readFile: async (p) => disco.get(String(p).replace(/\\/g, '/')),
    writeFile: async (p, c) => { disco.set(String(p).replace(/\\/g, '/'), c); },
    mkdir: async () => {},
  };
});

const { WaveStore } = await import('../../js/wave/wave_state_store.ts');

const MAQUINA_A = 'C:/Users/joao/Desktop/proj';
const MAQUINA_B = 'D:/aulas/proj';

/** O que esta gravado no json do testbench, como texto. */
function gravado(raiz, tb) {
  return JSON.parse(disco.get(`${raiz}/.aurora/testbench/${tb}.json`));
}

describe('gravar', () => {
  it('caminho de dentro do projeto vai relativo para o disco', async () => {
    await WaveStore.update(MAQUINA_A, 'tb', (cfg) => {
      cfg.tbPath = `${MAQUINA_A}/Testbench/tb.v`;
      cfg.gtkwFiles = [{ path: `${MAQUINA_A}/Testbench/tb.gtkw`, isActive: true }];
    });
    const j = gravado(MAQUINA_A, 'tb');
    expect(j.tbPath).toBe('Testbench/tb.v');
    expect(j.gtkwFiles[0].path).toBe('Testbench/tb.gtkw');
    // E a marca de ativo nao se perde no caminho.
    expect(j.gtkwFiles[0].isActive).toBe(true);
  });

  it('caminho de FORA do projeto continua absoluto', async () => {
    // Biblioteca compartilhada e caso legitimo. Relativa a raiz do projeto ela
    // apontaria para dentro dele, onde nao esta.
    await WaveStore.update(MAQUINA_A, 'tb', (cfg) => {
      cfg.gtkwFiles = [{ path: 'C:/lib/padrao.gtkw' }];
    });
    expect(gravado(MAQUINA_A, 'tb').gtkwFiles[0].path).toBe('C:/lib/padrao.gtkw');
  });
});

describe('ler na maquina de destino', () => {
  it('O CASO DO ALUNO: o projeto muda de computador e o .gtkw e achado', async () => {
    // Gravado na maquina A.
    await WaveStore.update(MAQUINA_A, 'tb', (cfg) => {
      cfg.tbPath = `${MAQUINA_A}/Testbench/tb.v`;
      cfg.gtkwFiles = [{ path: `${MAQUINA_A}/Testbench/tb.gtkw`, isActive: true }];
    });

    // O pendrive: o json e os arquivos vao para a maquina B, em outra letra de
    // unidade e outro nome de usuario. O caminho da maquina A deixa de existir.
    const json = disco.get(`${MAQUINA_A}/.aurora/testbench/tb.json`);
    disco.clear();
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, json);
    disco.set(`${MAQUINA_B}/Testbench/tb.v`, '');
    disco.set(`${MAQUINA_B}/Testbench/tb.gtkw`, '');

    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.gtkwFiles[0].path).toBe(`${MAQUINA_B}/Testbench/tb.gtkw`);
    expect(lido.tbPath).toBe(`${MAQUINA_B}/Testbench/tb.v`);
  });

  it('caminho de fora do projeto e devolvido inteiro', async () => {
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({ gtkwFiles: [{ path: 'C:/lib/padrao.gtkw' }] }));
    disco.set('C:/lib/padrao.gtkw', '');
    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.gtkwFiles[0].path).toBe('C:/lib/padrao.gtkw');
  });
});

describe('o layout do Surfer, pelo mesmo caminho', () => {
  // O `.surf.ron` e o `.sucl` sao registrados por `AuroraAPI.wave.addSurferFile`,
  // que guarda `path: abs` (js/api/aurora_api.js). Doenca identica a do `.gtkw`,
  // e cura identica: `surferFiles` entra na mesma lista de campos de caminho do
  // store. Este caso existe porque a auditoria dos projetos reais NAO provou
  // nada sobre ele: nenhum dos quatro tinha layout do Surfer registrado, entao
  // o campo estava vazio e nao havia absoluto para encontrar. Vazio nao e
  // limpo, e o codigo dizia que o problema estava la.

  it('grava relativo e acha na outra maquina', async () => {
    await WaveStore.update(MAQUINA_A, 'tb', (cfg) => {
      cfg.surferFiles = [{ name: 'tb.surf.ron', path: `${MAQUINA_A}/.aurora/testbench/tb.surf.ron`, isActive: true }];
    });
    expect(JSON.parse(disco.get(`${MAQUINA_A}/.aurora/testbench/tb.json`)).surferFiles[0].path)
      .toBe('.aurora/testbench/tb.surf.ron');

    const json = disco.get(`${MAQUINA_A}/.aurora/testbench/tb.json`);
    disco.clear();
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, json);
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.surf.ron`, '');

    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.surferFiles[0].path).toBe(`${MAQUINA_B}/.aurora/testbench/tb.surf.ron`);
    expect(lido.surferFiles[0].isActive).toBe(true);
  });

  it('o absoluto velho tambem e resgatado', async () => {
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({
      surferFiles: [{ path: `${MAQUINA_A}/testbench/tb.surf.ron`, isActive: true }],
    }));
    disco.set(`${MAQUINA_B}/testbench/tb.surf.ron`, '');
    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.surferFiles[0].path).toBe(`${MAQUINA_B}/testbench/tb.surf.ron`);
  });
});

describe('o invariante que sustenta o resto', () => {
  // EM MEMORIA SEMPRE ABSOLUTO, EM DISCO SEMPRE RELATIVO quando esta dentro.
  //
  // Nao e detalhe de arrumacao: quem mexe no estado compara caminho por
  // igualdade. `addSurferFile` procura `f.path === abs` para nao duplicar, e
  // `removeSurferFile` filtra `f.path !== filePath` para apagar. Se o mutator
  // recebesse caminho relativo, as duas comparacoes falhariam em silencio: a
  // primeira duplicaria a entrada, a segunda nao apagaria nada.
  //
  // O invariante se mantem porque a relativizacao acontece na ESCRITA, sobre
  // uma copia, e nunca no objeto que o mutator recebe.

  it('o mutator ve caminho ABSOLUTO, mesmo lendo de um disco relativo', async () => {
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({
      gtkwFiles: [{ path: 'Testbench/tb.gtkw' }],
      surferFiles: [{ path: 'Testbench/tb.surf.ron' }],
    }));
    disco.set(`${MAQUINA_B}/Testbench/tb.gtkw`, '');
    disco.set(`${MAQUINA_B}/Testbench/tb.surf.ron`, '');

    let vistos = null;
    await WaveStore.update(MAQUINA_B, 'tb', (cfg) => {
      vistos = [cfg.gtkwFiles[0].path, cfg.surferFiles[0].path];
    });
    expect(vistos).toEqual([
      `${MAQUINA_B}/Testbench/tb.gtkw`,
      `${MAQUINA_B}/Testbench/tb.surf.ron`,
    ]);
  });

  it('e o que volta ao disco continua relativo', async () => {
    await WaveStore.update(MAQUINA_B, 'tb', (cfg) => {
      cfg.gtkwFiles = [{ path: `${MAQUINA_B}/Testbench/tb.gtkw` }];
    });
    expect(JSON.parse(disco.get(`${MAQUINA_B}/.aurora/testbench/tb.json`)).gtkwFiles[0].path)
      .toBe('Testbench/tb.gtkw');
  });
});

describe('a pasta do estado mudou de lugar', () => {
  // O estado saiu de `testbench/` para `.aurora/testbench/`, porque no Windows
  // a primeira colidia com a pasta `Testbench/` dos .v do usuario. Todo projeto
  // que existe hoje tem o estado no lugar antigo, e perde-lo seria o .gtkw
  // escolhido e a selecao do Wave Configuration voltarem ao zero sem ninguem
  // pedir.

  it('le do lugar ANTIGO quando o novo nao existe', async () => {
    disco.set(`${MAQUINA_B}/testbench/tb.json`, JSON.stringify({
      gtkwFiles: [{ path: 'Testbench/tb.gtkw', isActive: true }],
      wcInitialized: true,
    }));
    disco.set(`${MAQUINA_B}/Testbench/tb.gtkw`, '');

    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido, 'o estado do lugar antigo foi ignorado').toBeTruthy();
    expect(lido.wcInitialized).toBe(true);
    expect(lido.gtkwFiles[0].path).toBe(`${MAQUINA_B}/Testbench/tb.gtkw`);
  });

  it('o novo VENCE o antigo quando os dois existem', async () => {
    disco.set(`${MAQUINA_B}/testbench/tb.json`, JSON.stringify({ tbModule: 'antigo' }));
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({ tbModule: 'novo' }));
    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.tbModule).toBe('novo');
  });

  it('a proxima escrita grava no lugar novo, e o antigo fica intacto', async () => {
    // Migracao sem etapa de migracao: o projeto se muda sozinho e nada e
    // apagado, entao uma versao anterior da AURORA ainda acha o estado dela.
    disco.set(`${MAQUINA_B}/testbench/tb.json`, JSON.stringify({ tbModule: 'tb' }));
    await WaveStore.update(MAQUINA_B, 'tb', (cfg) => { cfg.wcCustomized = true; });

    expect(JSON.parse(disco.get(`${MAQUINA_B}/.aurora/testbench/tb.json`)).wcCustomized).toBe(true);
    expect(disco.has(`${MAQUINA_B}/testbench/tb.json`)).toBe(true);
  });

  it('testbench sem estado em lugar nenhum continua nao registrado', async () => {
    expect(await WaveStore.get(MAQUINA_B, 'inexistente')).toBeNull();
  });
});

describe('resgatar o que ja esta gravado por ai', () => {
  it('absoluto da outra maquina e resgatado pela cauda', async () => {
    // Este json e o que existe HOJE nos projetos dos alunos: absoluto, gravado
    // antes da correcao. Sem o resgate, a correcao valeria so para projeto
    // novo e quem trouxe o problema continuaria com ele.
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({
      tbPath: `${MAQUINA_A}/Testbench/tb.v`,
      gtkwFiles: [{ path: `${MAQUINA_A}/Testbench/tb.gtkw`, isActive: true }],
    }));
    disco.set(`${MAQUINA_B}/Testbench/tb.v`, '');
    disco.set(`${MAQUINA_B}/Testbench/tb.gtkw`, '');

    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.gtkwFiles[0].path).toBe(`${MAQUINA_B}/Testbench/tb.gtkw`);
  });

  it('o resgate se conserta no disco na proxima escrita', async () => {
    // Nao se regrava durante a leitura de proposito: `readRaw` roda dentro da
    // cadeia de escrita do `update`, e escrever dali seria reentrar nela.
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({
      gtkwFiles: [{ path: `${MAQUINA_A}/Testbench/tb.gtkw` }],
    }));
    disco.set(`${MAQUINA_B}/Testbench/tb.gtkw`, '');

    await WaveStore.update(MAQUINA_B, 'tb', (cfg) => { cfg.wcInitialized = true; });
    expect(gravado(MAQUINA_B, 'tb').gtkwFiles[0].path).toBe('Testbench/tb.gtkw');
  });

  it('arquivo que sumiu de verdade devolve um caminho, e nao vazio', async () => {
    // Quem for usar precisa de um caminho para poder dizer QUAL arquivo
    // faltou. Devolver vazio viraria "nao consegui" sem dizer de que.
    disco.set(`${MAQUINA_B}/.aurora/testbench/tb.json`, JSON.stringify({
      gtkwFiles: [{ path: 'Testbench/apagado.gtkw' }],
    }));
    const lido = await WaveStore.get(MAQUINA_B, 'tb');
    expect(lido.gtkwFiles[0].path).toBe(`${MAQUINA_B}/Testbench/apagado.gtkw`);
  });
});
