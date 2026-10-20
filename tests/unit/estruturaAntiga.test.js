/**
 * A conversao de um projeto da estrutura de pastas de antes do yanc v7.1
 * (js/project/estrutura_antiga.ts): Software/, Hardware/ e Simulation/ dentro
 * de cada processador viram a pasta do processador (o que a pessoa escreve) e
 * a pasta de saida <proc>/<proc>/ (o que o yanc gera).
 *
 * O que fica travado: nada e apagado, nada e sobrescrito, o que e da pessoa
 * vai para a pasta do processador, o gerado vai para a de saida, a linha do
 * nome sai do fonte, e o .spf passa a apontar para onde os arquivos foram.
 */

import { describe, expect, it } from 'vitest';

import {
  chaveDoCaminho, converter, ehGeradoPeloYanc, inspecionar, mapaDosMovidos,
  planoDeConversao, remapearEstrutura, renomesSugeridos, tirarDasListas, tirarPrname,
} from '../../js/project/estrutura_antiga.ts';

describe('ehGeradoPeloYanc', () => {
  it('o que o yanc gera pelo nome do processador, e as tabelas e saidas', () => {
    for (const n of ['fir.asm', 'FIR.V', 'fir_tb.v', 'fir_inst.mif', 'fir_data.mif', 'pc_fir_mem.txt',
      'fir_tb.vcd', 'fir_tb.fst', 'fir_tb.vvp', 'cmm_log.txt', 'trad_cmm.txt', 'trad_opcode.txt',
      'app_log.txt', 'prog_log.txt', 'src_lines.txt', 'output_0.txt', 'toma_3.txt']) {
      expect(ehGeradoPeloYanc(n, ['fir']), n).toBe(true);
    }
  });

  it('o que e da pessoa: o fonte, os dados, um .v dela', () => {
    for (const n of ['fir.cmm', 'fir.cpp', 'coefs.hpp', 'input_0.txt', 'cade_1.txt', 'lut.txt', 'somador.v', 'fir2.v']) {
      expect(ehGeradoPeloYanc(n, ['fir']), n).toBe(false);
    }
  });

  it('a base do fonte tambem nomeia o gerado', () => {
    expect(ehGeradoPeloYanc('v2.asm', ['fir', 'v2'])).toBe(true);
    expect(ehGeradoPeloYanc('v2.asm', ['fir'])).toBe(false);
  });
});

describe('planoDeConversao', () => {
  it('cada entrada vai para a pasta do processador ou para a de saida', () => {
    const plano = planoDeConversao([{
      nome: 'fir',
      subpastas: {
        Software: [{ nome: 'fir.cmm', pasta: false }, { nome: 'fir.asm', pasta: false }, { nome: 'lut.txt', pasta: false },
          { nome: '_aurora_opt', pasta: true }],
        Hardware: [{ nome: 'fir.v', pasta: false }, { nome: 'somador.v', pasta: false }],
        Simulation: [{ nome: 'fir_tb.v', pasta: false }, { nome: 'input_0.txt', pasta: false }, { nome: 'output_0.txt', pasta: false }],
      },
    }]);
    expect(plano.map((m) => [m.de.join('/'), m.para.join('/'), m.gerado])).toEqual([
      ['fir/Software/fir.cmm', 'fir/fir.cmm', false],
      ['fir/Software/fir.asm', 'fir/fir/fir.asm', true],
      ['fir/Software/lut.txt', 'fir/lut.txt', false],
      ['fir/Software/_aurora_opt', 'fir/_aurora_opt', false],
      ['fir/Hardware/fir.v', 'fir/fir/fir.v', true],
      ['fir/Hardware/somador.v', 'fir/somador.v', false],
      ['fir/Simulation/fir_tb.v', 'fir/fir/fir_tb.v', true],
      ['fir/Simulation/input_0.txt', 'fir/input_0.txt', false],
      ['fir/Simulation/output_0.txt', 'fir/fir/output_0.txt', true],
    ]);
  });

  it('o .asm de um fonte com outro nome tambem e gerado', () => {
    const plano = planoDeConversao([{ nome: 'p', subpastas: { Software: [{ nome: 'q.cmm', pasta: false }, { nome: 'q.asm', pasta: false }] } }]);
    expect(plano[1]).toMatchObject({ para: ['p', 'p', 'q.asm'], gerado: true });
  });
});

describe('tirarPrname', () => {
  it('tira a linha do nome e diz qual nome ela dava', () => {
    expect(tirarPrname('#PRNAME fir\n#NUBITS 16\nvoid main(){}\n'))
      .toEqual({ texto: '#NUBITS 16\nvoid main(){}\n', nomeAntigo: 'fir' });
    expect(tirarPrname('#pragma yanc prname filtro\r\nvoid main(void){}'))
      .toEqual({ texto: 'void main(void){}', nomeAntigo: 'filtro' });
  });

  it('sem a linha, nada muda; com duas, as duas saem e vale a primeira', () => {
    expect(tirarPrname('#NUBITS 16\n')).toEqual({ texto: '#NUBITS 16\n', nomeAntigo: null });
    expect(tirarPrname('#PRNAME a\n#PRNAME b\nx')).toEqual({ texto: 'x', nomeAntigo: 'a' });
  });
});

describe('remapearEstrutura', () => {
  const mapa = new Map([
    [chaveDoCaminho('C:\\p\\fir\\Hardware\\fir.v'), 'C:\\p\\fir\\fir\\fir.v'],
    [chaveDoCaminho('C:\\p\\fir\\Simulation\\fir_tb.v'), 'C:\\p\\fir\\fir\\fir_tb.v'],
    [chaveDoCaminho('C:\\p\\fir\\Software\\_aurora_opt'), 'C:\\p\\fir\\_aurora_opt'],
  ]);

  it('troca os caminhos das listas e dos ponteiros, e o que esta dentro de uma pasta movida', () => {
    const e = {
      topLevelFile: 'C:\\p\\top.v',
      testbenchFile: 'c:/p/fir/simulation/fir_tb.v',
      synthesizableFiles: [{ name: 'fir.v', path: 'C:\\p\\fir\\Hardware\\fir.v' }, 'C:\\p\\top.v', null],
      testbenchFiles: [{ name: 'fir_tb.v', path: 'C:\\p\\fir\\Simulation\\fir_tb.v', isTopLevel: true }],
      unclassifiedFiles: [{ name: 'x.v', path: 'C:\\p\\fir\\Software\\_aurora_opt\\x.v' }],
    };
    remapearEstrutura(e, mapa);
    expect(e.topLevelFile).toBe('C:\\p\\top.v');
    expect(e.testbenchFile).toBe('C:\\p\\fir\\fir\\fir_tb.v');
    expect(e.synthesizableFiles).toEqual([{ name: 'fir.v', path: 'C:\\p\\fir\\fir\\fir.v' }, 'C:\\p\\top.v', null]);
    expect(e.testbenchFiles).toEqual([{ name: 'fir_tb.v', path: 'C:\\p\\fir\\fir\\fir_tb.v', isTopLevel: true }]);
    expect(e.unclassifiedFiles[0]).toEqual({ name: 'x.v', path: 'C:\\p\\fir\\_aurora_opt\\x.v' });
  });

  it('as entradas de processador perdem os campos de pasta e o caminho do fonte', () => {
    const e = {
      processors: ['a', null, { name: 'fir', clk: 50, cmmFile: 'C:\\p\\fir\\Software\\fir.cmm', softwarePath: 'x', hardwarePath: 'y', simulationPath: 'z' },
        { name: 'b', sourceFile: 'b.cpp' }],
    };
    remapearEstrutura(e, new Map());
    expect(e.processors).toEqual(['a', null, { name: 'fir', clk: 50, cmmFile: 'fir.cmm' }, { name: 'b', sourceFile: 'b.cpp' }]);
  });

  it('listas que nao sao lista ficam como estao', () => {
    const e = { synthesizableFiles: 'x', processors: undefined };
    remapearEstrutura(e, mapa);
    expect(e).toEqual({ synthesizableFiles: 'x', processors: undefined, topLevelFile: undefined, testbenchFile: undefined });
  });
});

/** Um disco em memoria: arquivos e pastas por caminho com barra normal. */
function discoFalso(inicial) {
  const arquivos = new Map(Object.entries(inicial.arquivos || {}));
  const pastas = new Set(inicial.pastas || []);
  const pai = (p) => p.split('/').slice(0, -1).join('/');
  for (const a of arquivos.keys()) for (let d = pai(a); d; d = pai(d)) pastas.add(d);
  const filhos = (dir) => {
    const nomes = new Map();
    for (const a of arquivos.keys()) if (pai(a) === dir) nomes.set(a, false);
    for (const d of pastas) if (pai(d) === dir) nomes.set(d, true);
    return [...nomes].map(([p, ehPasta]) => ({ name: p.split('/').pop(), path: p, isDirectory: ehPasta }));
  };
  const lixeira = [];
  const lixeiraDeVerdade = async (a) => {
    if (!arquivos.has(a)) return { success: false, error: 'nao existe' };
    arquivos.delete(a); lixeira.push(a); return { success: true };
  };
  return {
    arquivos, pastas, lixeira, lixeiraDeVerdade,
    trashPath: lixeiraDeVerdade,
    joinPath: async (...p) => p.join('/'),
    getFolderFiles: async (dir) => (pastas.has(dir) ? filhos(dir) : (() => { throw new Error('ENOENT'); })()),
    renamePath: async (de, para) => {
      if (arquivos.has(para) || pastas.has(para)) return { success: false, code: 'EEXIST' };
      if (arquivos.has(de)) { arquivos.set(para, arquivos.get(de)); arquivos.delete(de); return { success: true }; }
      if (pastas.has(de)) {
        for (const [a, t] of [...arquivos]) if (a.startsWith(`${de}/`)) { arquivos.delete(a); arquivos.set(para + a.slice(de.length), t); }
        for (const d of [...pastas]) if (d === de || d.startsWith(`${de}/`)) { pastas.delete(d); pastas.add(para + d.slice(de.length)); }
        return { success: true };
      }
      return { success: false, code: 'ENOENT', error: 'nao existe' };
    },
    mkdir: async (d) => { for (let x = d; x; x = pai(x)) pastas.add(x); },
    readFile: async (a) => { if (!arquivos.has(a)) throw new Error('ENOENT'); return arquivos.get(a); },
    writeFile: async (a, t) => { arquivos.set(a, t); },
    deleteFileOrDirectory: async (d) => {
      if (filhos(d).length) throw new Error('nao vazia');
      pastas.delete(d);
    },
  };
}

// #211: o gerado que foi para a Lixeira so volta na proxima compilacao. Nas
// listas do .spf ele apareceria como "sumido", e o aviso oferece remover a
// referencia; a arvore o descobre de novo na pasta de saida depois de compilar.
describe('tirarDasListas', () => {
  it('tira das tres listas, por caminho, e deixa os ponteiros e o resto', () => {
    const e = {
      topLevelFile: 'P/top.v',
      testbenchFile: 'P/fir/fir/fir_tb.v',
      synthesizableFiles: [{ name: 'fir.v', path: 'P/fir/fir/fir.v' }, { name: 'top.v', path: 'P/top.v' }, 'P/FIR/fir/fir.v', null],
      testbenchFiles: [{ name: 'fir_tb.v', path: 'P\\fir\\fir\\fir_tb.v', isTopLevel: true }],
      unclassifiedFiles: 'nao e lista',
    };
    tirarDasListas(e, ['P/fir/fir/fir.v', 'P/fir/fir/fir_tb.v']);
    expect(e.synthesizableFiles).toEqual([{ name: 'top.v', path: 'P/top.v' }, null]);
    expect(e.testbenchFiles).toEqual([]);
    expect(e.unclassifiedFiles).toBe('nao e lista');
    expect(e.testbenchFile).toBe('P/fir/fir/fir_tb.v');
    expect(e.topLevelFile).toBe('P/top.v');
  });

  it('sem caminho a tirar, nada muda', () => {
    const e = { synthesizableFiles: [{ path: 'a' }] };
    tirarDasListas(e, []);
    expect(e.synthesizableFiles).toEqual([{ path: 'a' }]);
  });
});

describe('inspecionar e converter, no disco', () => {
  const PROJETO_ANTIGO = {
    arquivos: {
      'P/fir/Software/fir.cmm': '#PRNAME fir_velho\n#NUBITS 16\nvoid main(){}\n',
      'P/fir/Software/fir.asm': 'asm',
      'P/fir/Software/lut.txt': '1\n2\n',
      'P/fir/Hardware/fir.v': 'module fir_velho; endmodule',
      'P/fir/Simulation/fir_tb.v': 'tb',
      'P/fir/Simulation/input_0.txt': '5\n',
      'P/fir/Simulation/output_0.txt': '9\n',
      'P/novo/novo.cmm': '#NUBITS 16\n',
      'P/top.v': 'module top; endmodule',
    },
  };

  // #218: num projeto ja convertido as tres pastas antigas nao existem, que e o
  // caso normal. Lista-las fazia o main registrar tres ENOENT no terminal a
  // cada abertura. Agora a existencia e conferida antes, sem listar.
  it('projeto ja convertido: nao tenta listar pasta antiga que nao existe', async () => {
    const d = discoFalso({ arquivos: { 'P/fir/fir.cmm': 'x', 'P/fir/fir/fir.v': 'v' } });
    const listadas = [];
    const listar = d.getFolderFiles;
    d.getFolderFiles = async (dir) => { listadas.push(dir); return listar(dir); };
    d.fileExists = async (p) => d.pastas.has(p) || d.arquivos.has(p);
    expect(await inspecionar('P', ['fir'], d)).toEqual([]);
    expect(listadas).toEqual([]);
    // A pergunta que falha conta como pasta ausente, como a listagem que falha.
    d.fileExists = async () => { throw new Error('canal caiu'); };
    expect(await inspecionar('P', ['fir'], d)).toEqual([]);
    expect(listadas).toEqual([]);
  });

  it('acha so os processadores que ainda tem subpasta antiga', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    const achados = await inspecionar('P', ['fir', 'novo', 'sumido'], d);
    expect(achados.map((a) => a.nome)).toEqual(['fir']);
    expect(Object.keys(achados[0].subpastas)).toEqual(['Software', 'Hardware', 'Simulation']);
    expect(achados[0].subpastas.Software.map((e) => e.nome).sort()).toEqual(['fir.asm', 'fir.cmm', 'lut.txt']);
  });

  // #211: o que o yanc antigo gerou ia para a pasta de saida como se valesse.
  // O .v apontava para os .mif na Hardware/, que a conversao apaga, e fora
  // da AURORA (Quartus, Vivado) virava processador de memorias vazias. E foi
  // montado por outro asmcomp, que nao casa com o SAPHO/ novo. Agora vai para
  // a Lixeira, e a proxima compilacao gera tudo de novo.
  it('o que e da pessoa vai para a pasta do processador; o gerado pelo yanc antigo, para a Lixeira', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    const r = await converter('P', await inspecionar('P', ['fir'], d), d);

    expect([...d.arquivos.keys()].filter((a) => a.startsWith('P/fir/')).sort()).toEqual([
      'P/fir/fir.cmm', 'P/fir/input_0.txt', 'P/fir/lut.txt',
    ]);
    expect(d.lixeira.sort()).toEqual([
      'P/fir/Hardware/fir.v', 'P/fir/Simulation/fir_tb.v', 'P/fir/Simulation/output_0.txt', 'P/fir/Software/fir.asm',
    ]);
    expect(d.pastas.has('P/fir/fir')).toBe(true);
    expect(d.arquivos.get('P/fir/fir.cmm')).toBe('#NUBITS 16\nvoid main(){}\n');
    expect(r.semPrname).toEqual([{ processador: 'fir', arquivo: 'P/fir/fir.cmm', nomeAntigo: 'fir_velho' }]);
    expect(r.pulados).toEqual([]);
    expect(r.pastasQueFicaram).toEqual([]);
    for (const sub of ['Software', 'Hardware', 'Simulation']) expect(d.pastas.has(`P/fir/${sub}`)).toBe(false);
    expect(r.movidos).toHaveLength(3);
    expect(r.descartados).toHaveLength(4);
    // O .spf aponta o gerado para onde a proxima compilacao o recria.
    expect(mapaDosMovidos(r).get('p/fir/hardware/fir.v')).toBe('P/fir/fir/fir.v');
    expect(mapaDosMovidos(r).get('p/fir/fir.cmm')).toBeUndefined();
    expect(mapaDosMovidos(r).get('p/fir/software/fir.cmm')).toBe('P/fir/fir.cmm');
  });

  it('gerado que a Lixeira recusa fica onde estava, e a pasta antiga tambem', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    d.trashPath = async (a) => (a.endsWith('fir.v') ? { success: false, error: 'sem lixeira' } : d.lixeiraDeVerdade(a));
    const r = await converter('P', await inspecionar('P', ['fir'], d), d);
    expect(d.arquivos.has('P/fir/Hardware/fir.v')).toBe(true);
    expect(r.pulados).toEqual([{ de: 'P/fir/Hardware/fir.v', para: 'P/fir/fir/fir.v', motivo: 'sem lixeira' }]);
    expect(r.pastasQueFicaram).toEqual(['P/fir/Hardware']);
    const d2 = discoFalso(PROJETO_ANTIGO);
    d2.trashPath = async () => { throw new Error('EPERM'); };
    const r2 = await converter('P', await inspecionar('P', ['fir'], d2), d2);
    expect(r2.pulados.map((p) => p.motivo)).toEqual(['EPERM', 'EPERM', 'EPERM', 'EPERM']);
  });

  it('destino que ja existe nao e sobrescrito: o arquivo fica e a pasta antiga tambem', async () => {
    const d = discoFalso({ arquivos: { ...PROJETO_ANTIGO.arquivos, 'P/fir/input_0.txt': 'meu\n' } });
    const r = await converter('P', await inspecionar('P', ['fir'], d), d);
    expect(d.arquivos.get('P/fir/input_0.txt')).toBe('meu\n');
    expect(d.arquivos.get('P/fir/Simulation/input_0.txt')).toBe('5\n');
    expect(r.pulados).toEqual([{ de: 'P/fir/Simulation/input_0.txt', para: 'P/fir/input_0.txt', motivo: 'EEXIST' }]);
    expect(r.pastasQueFicaram).toEqual(['P/fir/Simulation']);
  });

  it('nome que nao serve mais de modulo Verilog entra no relatorio', async () => {
    const d = discoFalso({ arquivos: { 'P/my-cpu/Software/my-cpu.cmm': '#NUBITS 16\n' } });
    const r = await converter('P', await inspecionar('P', ['my-cpu'], d), d);
    expect(r.nomesInvalidos).toEqual(['my-cpu']);
    expect(d.arquivos.has('P/my-cpu/my-cpu.cmm')).toBe(true);
    expect(r.semPrname).toEqual([]);
  });

  it('erro ao mover e pasta que nao apaga viram relatorio, sem lancar', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    const renomear = d.renamePath;
    d.renamePath = async (de, para) => {
      if (de.endsWith('lut.txt')) throw new Error('EBUSY');
      if (de.endsWith('input_0.txt')) return null;
      return renomear(de, para);
    };
    const lixeira = d.trashPath;
    d.trashPath = async (a) => (a.endsWith('fir_tb.v') ? null : lixeira(a));
    d.deleteFileOrDirectory = async () => { throw new Error('EPERM'); };
    const r = await converter('P', await inspecionar('P', ['fir'], d), d);
    expect(r.pulados.map((p) => [p.de, p.motivo])).toEqual([
      ['P/fir/Software/lut.txt', 'EBUSY'],
      ['P/fir/Simulation/fir_tb.v', '?'],
      ['P/fir/Simulation/input_0.txt', '?'],
    ]);
    expect(r.pastasQueFicaram).toEqual(['P/fir/Software', 'P/fir/Hardware', 'P/fir/Simulation']);
  });

  it('fonte que nao se le fica como esta', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    d.readFile = async () => { throw new Error('EACCES'); };
    const r = await converter('P', await inspecionar('P', ['fir'], d), d);
    expect(r.semPrname).toEqual([]);
    expect(d.arquivos.get('P/fir/fir.cmm')).toContain('#PRNAME');
  });

  it('listagem que nao e lista conta como pasta ausente', async () => {
    const d = discoFalso(PROJETO_ANTIGO);
    d.getFolderFiles = async () => null;
    expect(await inspecionar('P', ['fir'], d)).toEqual([]);
  });
});

describe('renomesSugeridos', () => {
  const sem = (processador, arquivo, nomeAntigo) => ({ processador, arquivo, nomeAntigo });

  it('volta ao nome que o #PRNAME dava ao modulo, que e o que o top-level instancia', () => {
    expect(renomesSugeridos({ semPrname: [sem('fir', 'P/fir/fir.cmm', 'filtro')] }, ['fir']))
      .toEqual([{ de: 'fir', para: 'filtro', motivo: 'modulo' }]);
  });

  it('nome da pasta que nao serve: o #PRNAME valido, senao o nome parecido que serve', () => {
    expect(renomesSugeridos({ semPrname: [sem('my-cpu', 'P/my-cpu/my-cpu.cmm', 'mycpu')] }, ['my-cpu']))
      .toEqual([{ de: 'my-cpu', para: 'mycpu', motivo: 'modulo' }]);
    expect(renomesSugeridos({ semPrname: [sem('my-cpu', 'P/my-cpu/my-cpu.cmm', 'my-cpu')] }, ['my-cpu']))
      .toEqual([{ de: 'my-cpu', para: 'my_cpu', motivo: 'nome' }]);
    expect(renomesSugeridos({ semPrname: [] }, ['média']))
      .toEqual([{ de: 'média', para: 'media', motivo: 'nome' }]);
  });

  it('nada a sugerir: o #PRNAME igual ao nome, invalido, de outro fonte, ou nenhum', () => {
    expect(renomesSugeridos({ semPrname: [sem('fir', 'P/fir/fir.cmm', 'fir')] }, ['fir'])).toEqual([]);
    expect(renomesSugeridos({ semPrname: [sem('fir', 'P/fir/fir.cmm', 'wire')] }, ['fir'])).toEqual([]);
    expect(renomesSugeridos({ semPrname: [sem('fir', 'P/fir/aux.cmm', 'outro')] }, ['fir'])).toEqual([]);
    expect(renomesSugeridos({ semPrname: [] }, ['fir'])).toEqual([]);
  });

  it('nao sugere um nome que outro processador ja usa, nem o mesmo duas vezes', () => {
    expect(renomesSugeridos({ semPrname: [sem('a', 'P/a/a.cmm', 'b')] }, ['a', 'B'])).toEqual([]);
    expect(renomesSugeridos({ semPrname: [sem('a', 'P/a/a.cmm', 'x'), sem('c', 'P/c/c.cmm', 'x')] }, ['a', 'c']))
      .toEqual([{ de: 'a', para: 'x', motivo: 'modulo' }]);
  });

  it('troca so de caixa nao colide com o proprio processador', () => {
    expect(renomesSugeridos({ semPrname: [sem('fir', 'P/fir/fir.cmm', 'FIR')] }, ['fir']))
      .toEqual([{ de: 'fir', para: 'FIR', motivo: 'modulo' }]);
  });
});
