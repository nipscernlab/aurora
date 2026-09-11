/**
 * Testes da leitura do .spf e da reescrita de caminhos no rename.
 *
 * Por que estes importam mais que a media: renomear um projeto move a pasta
 * inteira e reescreve TODO caminho absoluto guardado no .spf, incluindo listas
 * de arquivo e o cwd e o env dos command overrides. Um erro aqui nao da erro
 * visivel, deixa o projeto de alguem apontando para caminho que nao existe
 * mais. Ate 08/08/2026 estas quatro funcoes viviam dentro de main/ipc/
 * project.js e nenhum teste as alcancava.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeEach, describe, it, expect } from 'vitest';

import {
  parseSpfTolerant,
  remapProcessorPath,
  remapRootPath,
  deepRemapPaths,
} from '../../main/ipc/project_paths.js';

// O state pelo require nativo: e a instancia que project_paths.js usa por
// dentro. O import ESM do vitest devolve outra copia do modulo, e limpar o
// mapa dela nao limpa o mapa que as funcoes leem.
const state = createRequire(import.meta.url)('../../main/state.js');

const S = path.sep;
const j = (...p) => p.join(S);

describe('parseSpfTolerant', () => {
  it('le um .spf normal', () => {
    expect(parseSpfTolerant('{"a":1}')).toEqual({ a: 1 });
  });

  it('sobrevive a virgula sobrando, que edicao a mao produz', () => {
    expect(parseSpfTolerant('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('sobrevive a comentario de linha e de bloco', () => {
    expect(parseSpfTolerant('{\n// nota\n"a":1 /* outra */ }')).toEqual({ a: 1 });
  });

  it('NAO confunde // dentro de string com comentario', () => {
    // O caso real: todo .spf guarda caminho, e caminho tem barra.
    const spf = '{"basePath":"C://Users//x//proj", "url":"https://nipscern.com"}';
    expect(parseSpfTolerant(spf)).toEqual({
      basePath: 'C://Users//x//proj',
      url: 'https://nipscern.com',
    });
  });

  it('preserva aspas escapadas dentro de string', () => {
    expect(parseSpfTolerant('{"n":"diz \\"oi\\""}')).toEqual({ n: 'diz "oi"' });
  });

  it('ainda lanca quando o arquivo esta de fato quebrado', () => {
    expect(() => parseSpfTolerant('{isto nao e json')).toThrow();
  });
});

describe('remapProcessorPath', () => {
  const dir = j('C:', 'proj');

  it('reescreve a pasta e troca o nome dos artefatos do SAPHO', () => {
    for (const ext of ['.cmm', '.asm', '.v', '.sv']) {
      expect(remapProcessorPath(j(dir, 'velho', `velho${ext}`), dir, 'velho', 'novo'))
        .toBe(j(dir, 'novo', `novo${ext}`));
    }
  });

  it('troca tambem o testbench nomeado pelo processador', () => {
    expect(remapProcessorPath(j(dir, 'velho', 'velho_tb.v'), dir, 'velho', 'novo'))
      .toBe(j(dir, 'novo', 'novo_tb.v'));
  });

  it('arquivo nomeado pelo usuario acompanha a pasta mas mantem o nome', () => {
    expect(remapProcessorPath(j(dir, 'velho', 'Hardware', 'somador.v'), dir, 'velho', 'novo'))
      .toBe(j(dir, 'novo', 'Hardware', 'somador.v'));
  });

  it('nao toca em caminho fora da pasta do processador', () => {
    const fora = j(dir, 'outro', 'outro.v');
    expect(remapProcessorPath(fora, dir, 'velho', 'novo')).toBe(fora);
  });

  it('nao confunde prefixo parecido', () => {
    // `velho2` comeca com `velho`, mas e outra pasta.
    const outro = j(dir, 'velho2', 'velho2.v');
    expect(remapProcessorPath(outro, dir, 'velho', 'novo')).toBe(outro);
  });

  it('casa sem diferenciar maiuscula, porque Windows', () => {
    expect(remapProcessorPath(j(dir, 'VELHO', 'VELHO.v'), dir, 'velho', 'novo'))
      .toBe(j(dir, 'novo', 'novo.v'));
  });

  it('nome com caractere especial de regex nao explode', () => {
    // Sem o escape no construtor do RegExp, `a.b` casaria `axb`.
    const p = j(dir, 'a.b', 'a.b.v');
    expect(remapProcessorPath(p, dir, 'a.b', 'novo')).toBe(j(dir, 'novo', 'novo.v'));
    const naoDeveCasar = j(dir, 'axb', 'axb.v');
    expect(remapProcessorPath(naoDeveCasar, dir, 'a.b', 'novo')).toBe(naoDeveCasar);
  });

  it('devolve entrada nao-string intocada', () => {
    expect(remapProcessorPath(null, dir, 'v', 'n')).toBeNull();
    expect(remapProcessorPath(42, dir, 'v', 'n')).toBe(42);
  });
});

describe('remapRootPath', () => {
  const velho = j('C:', 'Users', 'x', 'ProjVelho');
  const novo = j('C:', 'Users', 'x', 'ProjNovo');

  it('a propria raiz vira a raiz nova', () => {
    expect(remapRootPath(velho, velho, novo)).toBe(novo);
  });

  it('caminho de dentro segue para a raiz nova', () => {
    expect(remapRootPath(j(velho, 'proc', 'a.v'), velho, novo)).toBe(j(novo, 'proc', 'a.v'));
  });

  it('caminho de fora volta intocado', () => {
    const fora = j('D:', 'outra', 'coisa.v');
    expect(remapRootPath(fora, velho, novo)).toBe(fora);
  });

  it('nao casa raiz que e so prefixo textual', () => {
    const vizinho = j('C:', 'Users', 'x', 'ProjVelho2', 'a.v');
    expect(remapRootPath(vizinho, velho, novo)).toBe(vizinho);
  });

  it('aceita barra normal na entrada e devolve separador nativo', () => {
    expect(remapRootPath('C:/Users/x/ProjVelho/proc/a.v', velho, novo))
      .toBe(j(novo, 'proc', 'a.v'));
  });
});

describe('deepRemapPaths', () => {
  const velho = j('C:', 'p', 'Velho');
  const novo = j('C:', 'p', 'Novo');

  it('alcanca string em objeto aninhado, em array e dentro de array de objeto', () => {
    const spf = {
      structure: {
        basePath: velho,
        synthesizableFiles: [j(velho, 'a.v'), j(velho, 'b.v')],
        processors: [{ name: 'p1', cmmFile: j(velho, 'p1', 'p1.cmm') }],
      },
      overrides: { cwd: j(velho, 'build'), env: { EXTRA: j(velho, 'lib') } },
      naoTocar: 'texto qualquer',
    };

    deepRemapPaths(spf, velho, novo);

    expect(spf.structure.basePath).toBe(novo);
    expect(spf.structure.synthesizableFiles).toEqual([j(novo, 'a.v'), j(novo, 'b.v')]);
    expect(spf.structure.processors[0].cmmFile).toBe(j(novo, 'p1', 'p1.cmm'));
    expect(spf.overrides.cwd).toBe(j(novo, 'build'));
    expect(spf.overrides.env.EXTRA).toBe(j(novo, 'lib'));
    expect(spf.naoTocar).toBe('texto qualquer');
  });

  it('muta no lugar e nao devolve copia', () => {
    const obj = { p: j(velho, 'a.v') };
    const ref = obj;
    deepRemapPaths(obj, velho, novo);
    expect(ref.p).toBe(j(novo, 'a.v'));
  });

  it('nao quebra com null nem com valor nao-objeto', () => {
    expect(() => deepRemapPaths(null, velho, novo)).not.toThrow();
    expect(() => deepRemapPaths('texto', velho, novo)).not.toThrow();
    expect(() => deepRemapPaths({ n: 1, b: true, z: null }, velho, novo)).not.toThrow();
  });
});

// ── Projeto por janela ──────────────────────────────────────────────────────
// O estado tinha um so currentOpenProjectPath e cada janela abre o proprio
// projeto: apagar um processador na janela A podia remover a pasta do projeto
// da janela B. Estes testes travam a regra de resolucao por event.sender.id,
// atravessando so a API publica (o objeto de estado interno e detalhe).

import { spfDaJanela, registrarSpfDaJanela } from '../../main/ipc/project_paths.js';

function fakeSender(id) {
  const listeners = {};
  return {
    id,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    once(ev, fn) { listeners[ev] = fn; },
    destruir() { this.destroyed = true; listeners.destroyed?.(); },
  };
}

describe('spfDaJanela / registrarSpfDaJanela', () => {
  // Sem reset externo: cada teste fecha o que abriu via registrar(_, null),
  // e os ids de sender nao se repetem entre testes.
  it('cada janela ve o proprio projeto, nao o ultimo aberto', () => {
    const a = fakeSender(1);
    const b = fakeSender(2);
    registrarSpfDaJanela({ sender: a }, '/proj/A/A.spf');
    registrarSpfDaJanela({ sender: b }, '/proj/B/B.spf');
    expect(spfDaJanela({ sender: a })).toBe('/proj/A/A.spf');
    expect(spfDaJanela({ sender: b })).toBe('/proj/B/B.spf');
    // Sem janela no contexto, vale o global, que e o mais recente. Uma JANELA
    // fora do mapa, nao: ela nao abriu nada, e herdar o projeto da vizinha
    // era o que fazia uma janela compilar com o testbench da outra.
    expect(spfDaJanela(null)).toBe('/proj/B/B.spf');
    expect(spfDaJanela({ sender: fakeSender(90) })).toBe(null);
    registrarSpfDaJanela({ sender: a }, null);
    registrarSpfDaJanela({ sender: b }, null);
  });

  it('fechar o projeto tira a entrada da janela e zera o global', () => {
    const a = fakeSender(3);
    registrarSpfDaJanela({ sender: a }, '/proj/A/A.spf');
    registrarSpfDaJanela({ sender: a }, null);
    expect(spfDaJanela({ sender: a })).toBe(null);
    expect(spfDaJanela(null)).toBe(null);
  });

  it('a entrada morre junto com o webContents', () => {
    const a = fakeSender(4);
    const b = fakeSender(5);
    registrarSpfDaJanela({ sender: a }, '/proj/A/A.spf');
    registrarSpfDaJanela({ sender: b }, '/proj/B/B.spf');
    a.destruir();
    // Sem entrada propria, a janela morta nao tem projeto; ela nao herda o
    // da vizinha que continua viva.
    expect(spfDaJanela({ sender: a })).toBe(null);
    registrarSpfDaJanela({ sender: b }, null);
  });

  it('reabrir na mesma janela troca o caminho', () => {
    const a = fakeSender(6);
    registrarSpfDaJanela({ sender: a }, '/proj/A/A.spf');
    registrarSpfDaJanela({ sender: a }, '/proj/C/C.spf');
    expect(spfDaJanela({ sender: a })).toBe('/proj/C/C.spf');
    registrarSpfDaJanela({ sender: a }, null);
  });
});

// O `.spf` de cada janela. A reserva antiga caia no "ultimo aberto em qualquer
// lugar" sempre que a janela nao estava no mapa, e com duas janelas isso
// entregava para a B o projeto da A: a compilacao de B lia o testbench de A.
describe('spfDaJanela', () => {
  const evento = (id) => ({ sender: { id, once() {} } });

  beforeEach(() => {
    state.currentOpenProjectPath = null;
    state.projectPathsBySender.clear();
  });

  it('sem janela no contexto (LSP, IA), vale o ultimo aberto', () => {
    registrarSpfDaJanela(evento(1), 'A.spf');
    expect(spfDaJanela(null)).toBe('A.spf');
    expect(spfDaJanela({})).toBe('A.spf');
  });

  it('cada janela recebe o que ela mesma abriu', () => {
    registrarSpfDaJanela(evento(1), 'A.spf');
    registrarSpfDaJanela(evento(2), 'B.spf');
    expect(spfDaJanela(evento(1))).toBe('A.spf');
    expect(spfDaJanela(evento(2))).toBe('B.spf');
  });

  it('janela sem projeto NAO herda o projeto da vizinha', () => {
    registrarSpfDaJanela(evento(1), 'A.spf');
    expect(spfDaJanela(evento(2))).toBeNull();
  });

  it('no arranque de uma janela so, antes de registrar, vale o global', () => {
    state.currentOpenProjectPath = 'A.spf';
    expect(spfDaJanela(evento(7))).toBe('A.spf');
  });

  it('fechar o projeto tira a janela do mapa e ela volta a nao ter nada', () => {
    registrarSpfDaJanela(evento(1), 'A.spf');
    registrarSpfDaJanela(evento(2), 'B.spf');
    registrarSpfDaJanela(evento(2), null);
    expect(spfDaJanela(evento(2))).toBeNull();
    expect(spfDaJanela(evento(1))).toBe('A.spf');
  });
});
