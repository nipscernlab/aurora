/**
 * O que o slang enxerga do projeto (main/lsp/slang_lsp.js).
 *
 * O indice do slang e o que decide se uma instanciacao resolve ou vira
 * `unknown module` no editor. Ele varre a raiz do projeto, e so ela: um .v
 * importado de outro lugar do disco fica de fora, porque importar guarda o
 * caminho e nao copia o arquivo. O testbench que instancia esse modulo passa a
 * mostrar erro num projeto que compila.
 *
 * Aqui se prova as duas pecas que corrigem isso. `extraSourceDirs` decide quais
 * pastas de fora precisam entrar, lendo o .spf; `syncSlangConfig` escreve (ou
 * apaga) o `.slang/local/server.json` que as declara. A regra que mais importa e
 * a ultima: o arquivo e do slang, e um `server.json` escrito pelo usuario nao
 * pode ser sobrescrito por nos.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const state = require('../../main/state.js');
const { extraSourceDirs, syncSlangConfig } = require('../../main/lsp/slang_lsp.js');

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
