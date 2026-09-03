/**
 * O que o slang enxerga do projeto (main/lsp/slang_lsp.js).
 *
 * O indice do slang e o que decide se uma instanciacao resolve ou vira
 * `unknown module` no editor. Ele varre a raiz do projeto, e so ela: um .v
 * importado de outro lugar do disco fica de fora, porque importar guarda o
 * caminho e nao copia o arquivo. O testbench que instancia esse modulo passa a
 * mostrar erro num projeto que compila.
 *
 * O mesmo vale, e com mais frequencia, para a biblioteca do proprio SAPHO: o
 * `processor` mora em components/HDL, pasta que nao e copiada para o projeto, e
 * era ela que fazia o editor sublinhar a instanciacao do processador no top
 * level de um projeto que compila.
 *
 * Aqui se prova as tres pecas que corrigem isso. `extraSourceDirs` decide quais
 * pastas de fora precisam entrar, lendo o .spf; `indexExtraDirs` junta a
 * biblioteca a essa leitura; `syncSlangConfig` escreve (ou apaga) o
 * `.slang/local/server.json` que as declara. A regra que mais importa e a
 * ultima: o arquivo e do slang, e um `server.json` escrito pelo usuario nao
 * pode ser sobrescrito por nos.
 *
 * E ha um `unknown module` que nenhuma pasta resolve: o do processador que o
 * .spf declara e o C± ainda nao compilou, porque o Hardware/<nome>.v so existe
 * depois da primeira compilacao. `processadoresSemHardware` acha esses e
 * `suavizarProcessadorNaoCompilado` troca o erro por uma informacao que diz o
 * passo que falta, sem tocar em nenhum outro diagnostico.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const state = require('../../main/state.js');
const {
  extraSourceDirs,
  indexExtraDirs,
  syncSlangConfig,
  processadoresSemHardware,
  suavizarProcessadorNaoCompilado,
} = require('../../main/lsp/slang_lsp.js');

let raiz;
let projeto;

/** Escreve um .spf com as listas dadas e aponta o estado do main para ele. */
function escreverSpf(listas) {
  const spf = path.join(projeto, 'proj.spf');
  fs.writeFileSync(spf, JSON.stringify({
    metadata: { projectName: 'proj' },
    structure: {
      basePath: projeto,
      synthesizableFiles: [],
      testbenchFiles: [],
      ...listas,
    },
  }));
  state.currentOpenProjectPath = spf;
  return spf;
}

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-slang-'));
  projeto = path.join(raiz, 'projeto');
  fs.mkdirSync(projeto, { recursive: true });
});

afterEach(() => {
  state.currentOpenProjectPath = null;
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe('quais pastas o indice precisa alem da raiz', () => {
  it('nao pede nenhuma quando tudo mora dentro do projeto', () => {
    escreverSpf({
      synthesizableFiles: [{ path: 'somador.v' }, { path: 'proc/Hardware/proc.v' }],
      testbenchFiles: [{ path: 'somador_tb.v' }],
    });
    expect(extraSourceDirs(projeto)).toEqual([]);
  });

  it('nao se confunde com .spf antigo, que grava caminho absoluto ate para quem esta dentro', () => {
    escreverSpf({
      synthesizableFiles: [{ path: path.join(projeto, 'somador.v') }],
    });
    expect(extraSourceDirs(projeto)).toEqual([]);
  });

  it('devolve a pasta do arquivo importado de fora', () => {
    const fora = path.join(raiz, 'biblioteca');
    escreverSpf({
      synthesizableFiles: [{ path: 'somador.v' }, { path: path.join(fora, 'fifo.v') }],
    });
    expect(extraSourceDirs(projeto)).toEqual([fora]);
  });

  it('junta as duas listas, sem repetir pasta', () => {
    const fora = path.join(raiz, 'biblioteca');
    const outra = path.join(raiz, 'ip');
    escreverSpf({
      synthesizableFiles: [{ path: path.join(fora, 'fifo.v') }, { path: path.join(fora, 'ram.v') }],
      testbenchFiles: [{ path: path.join(outra, 'fifo_tb.v') }],
    });
    expect(extraSourceDirs(projeto)).toEqual([fora, outra].sort());
  });

  it('nao quebra com .spf ausente ou meio escrito', () => {
    const spf = path.join(projeto, 'proj.spf');
    fs.writeFileSync(spf, '{"structure": {"synthesiz');
    state.currentOpenProjectPath = spf;
    expect(extraSourceDirs(projeto)).toEqual([]);

    state.currentOpenProjectPath = path.join(projeto, 'nao-existe.spf');
    expect(extraSourceDirs(projeto)).toEqual([]);
  });
});

describe('a biblioteca HDL do SAPHO', () => {
  // A biblioteca de verdade mora em components/HDL, que vem com a toolchain
  // BAIXADA: o runner do CI nao a tem, e um teste que dependesse dela estar
  // no disco passaria numa maquina e quebraria na outra (quebrou). Cada teste
  // cria a sua em pasta temporaria e a injeta pelo parametro.
  let hdl;
  beforeEach(() => {
    hdl = path.join(raiz, 'toolchain', 'HDL');
    fs.mkdirSync(hdl, { recursive: true });
  });

  it('entra no indice mesmo quando o projeto nao importa nada de fora', () => {
    escreverSpf({
      synthesizableFiles: [{ path: 'mediamovel.v' }],
      testbenchFiles: [{ path: 'mediamovel_tb.v' }],
    });
    // Sem ela, instanciar `processor` no top level vira `unknown module`.
    expect(indexExtraDirs(projeto, hdl)).toEqual([hdl]);
  });

  it('vem junto com as pastas que o .spf importa de fora', () => {
    const fora = path.join(raiz, 'biblioteca');
    escreverSpf({
      synthesizableFiles: [{ path: path.join(fora, 'fifo.v') }],
    });
    expect(indexExtraDirs(projeto, hdl)).toEqual([hdl, fora]);
  });

  it('nao aparece duas vezes quando o .spf ja importa um .v de dentro dela', () => {
    escreverSpf({
      synthesizableFiles: [{ path: path.join(hdl, 'myFIFO.v') }],
    });
    expect(indexExtraDirs(projeto, hdl)).toEqual([hdl]);
  });

  it('e ignorada quando a toolchain nao foi baixada', () => {
    // O caso do runner do CI: a pasta nao existe, o indice segue so com o
    // que o .spf importa, e nada quebra.
    const fora = path.join(raiz, 'biblioteca');
    escreverSpf({
      synthesizableFiles: [{ path: path.join(fora, 'fifo.v') }],
    });
    expect(indexExtraDirs(projeto, path.join(raiz, 'nao-existe', 'HDL'))).toEqual([fora]);
  });
});

describe('a config que declara essas pastas', () => {
  const configDe = (p) => path.join(p, '.slang', 'local', 'server.json');
  const marcaDe = (p) => path.join(p, '.slang', 'local', '.aurora');

  it('escreve a raiz junto com as pastas de fora', () => {
    const fora = path.join(raiz, 'biblioteca');
    syncSlangConfig(projeto, [fora]);

    const cfg = JSON.parse(fs.readFileSync(configDe(projeto), 'utf8'));
    // A raiz precisa estar na lista: `index` substitui o default de varrer o
    // workspace, entao sem ela o proprio projeto sairia do indice.
    expect(cfg.index[0].dirs).toEqual([projeto, fora]);
    expect(fs.existsSync(marcaDe(projeto))).toBe(true);
  });

  it('some quando nao ha mais pasta de fora', () => {
    const fora = path.join(raiz, 'biblioteca');
    syncSlangConfig(projeto, [fora]);
    syncSlangConfig(projeto, []);

    expect(fs.existsSync(configDe(projeto))).toBe(false);
    expect(fs.existsSync(marcaDe(projeto))).toBe(false);
  });

  it('nao cria nada quando nunca houve pasta de fora', () => {
    syncSlangConfig(projeto, []);
    expect(fs.existsSync(path.join(projeto, '.slang'))).toBe(false);
  });

  it('nao encosta num server.json escrito pelo usuario', () => {
    const alvo = configDe(projeto);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, '{"flags": "--minha-config"}');

    syncSlangConfig(projeto, [path.join(raiz, 'biblioteca')]);

    expect(fs.readFileSync(alvo, 'utf8')).toBe('{"flags": "--minha-config"}');
    expect(fs.existsSync(marcaDe(projeto))).toBe(false);
  });

  it('atualiza o que e nosso quando a lista muda', () => {
    const um = path.join(raiz, 'um');
    const dois = path.join(raiz, 'dois');
    syncSlangConfig(projeto, [um]);
    syncSlangConfig(projeto, [um, dois]);

    const cfg = JSON.parse(fs.readFileSync(configDe(projeto), 'utf8'));
    expect(cfg.index[0].dirs).toEqual([projeto, um, dois]);
  });
});

describe('o processador declarado e ainda nao compilado', () => {
  const diag = (message, extra = {}) => ({
    range: { start: { line: 9, character: 2 }, end: { line: 9, character: 12 } },
    severity: 1,
    message,
    ...extra,
  });

  it('lista so os processadores cujo Hardware/<nome>.v nao existe', () => {
    escreverSpf({
      processors: [
        { name: 'mediamovel', hardwarePath: path.join(projeto, 'mediamovel', 'Hardware') },
        { name: 'filtro', hardwarePath: path.join(projeto, 'filtro', 'Hardware') },
      ],
    });
    fs.mkdirSync(path.join(projeto, 'filtro', 'Hardware'), { recursive: true });
    fs.writeFileSync(path.join(projeto, 'filtro', 'Hardware', 'filtro.v'), 'module filtro; endmodule\n');
    const faltam = processadoresSemHardware(projeto);
    expect([...faltam.keys()]).toEqual(['mediamovel']);
    expect(faltam.get('mediamovel')).toBe(path.join(projeto, 'mediamovel', 'Hardware', 'mediamovel.v'));
  });

  it('aceita hardwarePath relativo e assume <nome>/Hardware quando ele falta', () => {
    escreverSpf({ processors: [{ name: 'a', hardwarePath: path.join('a', 'Hardware') }, { name: 'b' }] });
    const faltam = processadoresSemHardware(projeto);
    expect(faltam.get('a')).toBe(path.join(projeto, 'a', 'Hardware', 'a.v'));
    expect(faltam.get('b')).toBe(path.join(projeto, 'b', 'Hardware', 'b.v'));
  });

  it('nao quebra sem projeto aberto nem com .spf meio escrito', () => {
    expect(processadoresSemHardware(null).size).toBe(0);
    const spf = path.join(projeto, 'proj.spf');
    fs.writeFileSync(spf, '{"structure": {"processors": [');
    state.currentOpenProjectPath = spf;
    expect(processadoresSemHardware(projeto).size).toBe(0);
  });

  it('rebaixa o unknown module do processador para informacao e diz o passo que falta', () => {
    const alvo = path.join(projeto, 'mediamovel', 'Hardware', 'mediamovel.v');
    const saida = suavizarProcessadorNaoCompilado(
      [diag("unknown module 'mediamovel'", { code: 'UnknownModule' })],
      new Map([['mediamovel', alvo]]),
    );
    expect(saida).toHaveLength(1);
    expect(saida[0].severity).toBe(3);
    expect(saida[0].message).toContain("'mediamovel'");
    expect(saida[0].message).toContain(alvo);
    expect(saida[0].range).toEqual(diag('').range);
  });

  it('deixa como esta o unknown module de um nome que o .spf nao declara, e todo o resto', () => {
    const outros = [
      diag("unknown module 'fifo'"),
      diag('undriven net', { severity: 2 }),
    ];
    const saida = suavizarProcessadorNaoCompilado(outros, new Map([['mediamovel', 'x']]));
    expect(saida).toEqual(outros);
  });

  it('nao toca em nada quando todos os processadores ja tem Verilog', () => {
    const d = [diag("unknown module 'mediamovel'")];
    expect(suavizarProcessadorNaoCompilado(d, new Map())).toBe(d);
  });
});
