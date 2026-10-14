import { describe, it, expect } from 'vitest';

// O .spf guarda o topo duas vezes: no campo escalar (topLevelFile,
// testbenchFile) e na marca isTopLevel da lista. A compilacao ja seguia o
// escalar (compilation_helpers); a arvore lia so a marca e, no primeiro
// salvamento, reescrevia o escalar a partir dela. Um .spf com o escalar
// preenchido e a marca desligada perdia o testbench ao compilar.
import { aplicarTopoDoSpf } from '../../js/project/marcas_de_topo.js';

const minusculo = (p) => p.replace(/\\/g, '/').toLowerCase();
const arq = (path, category, isTopLevel = false) => ({ name: path.split('/').pop(), path, category, isTopLevel });

describe('aplicarTopoDoSpf', () => {
  it('o escalar marca o arquivo dele, mesmo com a marca da lista desligada', () => {
    const lista = [arq('C:/p/tb.v', 'testbench'), arq('C:/p/top.v', 'synthesizable', true)];
    aplicarTopoDoSpf(lista, 'testbench', 'c:\\p\\TB.v', minusculo);
    expect(lista.map((f) => f.isTopLevel)).toEqual([true, true]);
  });

  it('o escalar ganha de uma marca que aponta para outro arquivo da mesma categoria', () => {
    const lista = [arq('C:/p/a.v', 'synthesizable', true), arq('C:/p/b.v', 'synthesizable'), arq('C:/p/t.v', 'testbench', true)];
    aplicarTopoDoSpf(lista, 'synthesizable', 'C:/p/b.v', minusculo);
    expect(lista.map((f) => f.isTopLevel)).toEqual([false, true, true]);
  });

  it('escalar vazio, ausente ou fora da lista: as marcas ficam como estao', () => {
    for (const escalar of ['', '   ', undefined, null, 42, 'C:/p/longe.v']) {
      const lista = [arq('C:/p/a.v', 'testbench', true), arq('C:/p/b.v', 'testbench')];
      aplicarTopoDoSpf(lista, 'testbench', escalar, minusculo);
      expect(lista.map((f) => f.isTopLevel), String(escalar)).toEqual([true, false]);
    }
  });

  it('o escalar de uma categoria nao marca arquivo de outra', () => {
    const lista = [arq('C:/p/a.v', 'synthesizable')];
    aplicarTopoDoSpf(lista, 'testbench', 'C:/p/a.v', minusculo);
    expect(lista[0].isTopLevel).toBe(false);
  });
});
