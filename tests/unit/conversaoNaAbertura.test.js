// @vitest-environment happy-dom
//
// A conversa da conversao da estrutura antiga na abertura do projeto
// (js/project/conversao_na_abertura.ts): pergunta uma vez por abertura, converte
// so com o sim, grava o .spf com os caminhos novos e mostra o que mudou.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dialogos = vi.hoisted(() => ({ pedidos: [], respostas: [] }));
vi.mock('../../js/ui/dialog_manager.js', () => ({
  showDialog: vi.fn(async (o) => { dialogos.pedidos.push(o); return dialogos.respostas.shift() ?? 'ok'; }),
}));
const spf = vi.hoisted(() => ({ estrutura: null, escritas: 0 }));
vi.mock('../../js/project/spf_store.js', () => ({
  SpfStore: {
    update: vi.fn(async (_p, fn) => { spf.escritas++; fn(spf.estrutura); }),
    read: vi.fn(async () => spf.estrutura),
  },
}));
const lista = vi.hoisted(() => ({ semeada: null }));
vi.mock('../../js/project/processor_list.js', () => ({
  setAvailableProcessors: vi.fn((l) => { lista.semeada = l; }),
}));
vi.mock('../../js/project/processadores_do_spf.js', () => ({ renomearProcessador: vi.fn() }));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI: {} }));
const avisos = vi.hoisted(() => []);
vi.mock('../../js/ui/notification.js', () => ({
  showCardNotification: vi.fn((m, tipo) => { avisos.push([m, tipo]); }),
}));

import {
  linhasDoRelatorio, mensagemComLista, oferecerConversao,
} from '../../js/project/conversao_na_abertura.ts';

/** Um disco minimo: so Software/ do processador fir, com o fonte. */
function disco(arquivos) {
  const mapa = new Map(Object.entries(arquivos));
  const pastas = new Set();
  const pai = (p) => p.split('/').slice(0, -1).join('/');
  for (const a of mapa.keys()) for (let d = pai(a); d; d = pai(d)) pastas.add(d);
  const filhos = (dir) => [
    ...[...mapa.keys()].filter((a) => pai(a) === dir).map((a) => ({ name: a.split('/').pop(), isDirectory: false })),
    ...[...pastas].filter((d) => pai(d) === dir).map((d) => ({ name: d.split('/').pop(), isDirectory: true })),
  ];
  return {
    mapa, pastas,
    joinPath: async (...p) => p.join('/'),
    getFolderFiles: async (dir) => { if (!pastas.has(dir)) throw new Error('ENOENT'); return filhos(dir); },
    renamePath: async (de, para) => { mapa.set(para, mapa.get(de)); mapa.delete(de); return { success: true }; },
    mkdir: async (d) => { pastas.add(d); },
    readFile: async (a) => mapa.get(a),
    writeFile: async (a, t) => { mapa.set(a, t); },
    deleteFileOrDirectory: async (d) => { pastas.delete(d); },
  };
}

beforeEach(() => {
  dialogos.pedidos.length = 0;
  dialogos.respostas.length = 0;
  spf.estrutura = { synthesizableFiles: [{ name: 'fir.v', path: 'P/fir/Software/fir.cmm' }], processors: [{ name: 'fir' }] };
  spf.escritas = 0;
  lista.semeada = null;
  delete window.t;
});

describe('oferecerConversao', () => {
  it('projeto ja na estrutura nova: nao pergunta nada', async () => {
    const d = disco({ 'P/fir/fir.cmm': '#NUBITS 16\n' });
    expect(await oferecerConversao('P/p.spf', 'P', [{ name: 'fir' }], d)).toBeNull();
    expect(dialogos.pedidos).toEqual([]);
  });

  it('com o sim: converte, grava o .spf e mostra o relatorio', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': '#PRNAME fir\n#NUBITS 16\n' });
    dialogos.respostas.push('converter');
    const r = await oferecerConversao('P/p.spf', 'P', ['fir'], d);
    expect(r.movidos).toEqual([{ de: 'P/fir/Software/fir.cmm', para: 'P/fir/fir.cmm' }]);
    expect(d.mapa.get('P/fir/fir.cmm')).toBe('#NUBITS 16\n');
    expect(spf.estrutura.synthesizableFiles[0].path).toBe('P/fir/fir.cmm');
    expect(dialogos.pedidos).toHaveLength(2);
    expect(dialogos.pedidos[0]).toMatchObject({ title: 'dialog.estruturaAntiga.title', variant: 'warning' });
    expect(dialogos.pedidos[0].message).toContain('<li>fir</li>');
    expect(dialogos.pedidos[1]).toMatchObject({ title: 'dialog.estruturaAntiga.feitoTitle', variant: 'success' });
    expect(dialogos.pedidos[1].message).toContain('fir/Software/fir.cmm → fir/fir.cmm');
  });

  // #209: a pergunta fechava num clique fora e contava como "Agora nao", sem
  // aviso, e a recusa valia ate fechar a AURORA: reabrir o projeto nao
  // perguntava de novo, e o projeto seguia sem compilar.
  it('a pergunta nao fecha por clique fora', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': '#NUBITS 16\n' });
    dialogos.respostas.push('depois');
    await oferecerConversao('P/p.spf', 'P', ['fir'], d);
    expect(dialogos.pedidos[0].fecharPorFora).toBe(false);
  });

  it('com o nao (ou o Esc): nada muda, avisa que o projeto nao compila, e reabrir pergunta de novo', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': '#NUBITS 16\n' });
    for (const resposta of ['depois', 'cancel']) {
      avisos.length = 0;
      dialogos.respostas.push(resposta);
      expect(await oferecerConversao('P/p.spf', 'P', ['fir'], d)).toBeNull();
      expect(avisos).toEqual([['dialog.estruturaAntiga.adiada', 'warning']]);
    }
    expect(d.mapa.has('P/fir/Software/fir.cmm')).toBe(true);
    expect(spf.escritas).toBe(0);
    expect(dialogos.pedidos).toHaveLength(2);
  });

  it('nada movido: nao grava o .spf; aviso no relatorio quando o nome nao serve', async () => {
    const d = disco({ 'P/my-cpu/Software/x.txt': '1' });
    d.renamePath = async () => ({ success: false, code: 'EEXIST' });
    dialogos.respostas.push('converter');
    const r = await oferecerConversao('P/p.spf', 'P', ['my-cpu'], d);
    expect(r.movidos).toEqual([]);
    expect(spf.escritas).toBe(0);
    expect(dialogos.pedidos[1].variant).toBe('warning');
  });

  it('o #PRNAME antigo diferente do nome: oferece o rename, e com o sim renomeia e semeia a lista', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': '#PRNAME filtro\n#NUBITS 16\n' });
    dialogos.respostas.push('converter', 'renomear');
    const renomear = vi.fn(async (de, para) => {
      spf.estrutura.processors = [{ name: para }];
      return { success: true, de };
    });
    const r = await oferecerConversao('P/p.spf', 'P', ['fir'], d, renomear);
    expect(renomear).toHaveBeenCalledWith('fir', 'filtro');
    expect(r.renomeados).toEqual([{ de: 'fir', para: 'filtro', motivo: 'modulo' }]);
    expect(lista.semeada).toEqual([{ name: 'filtro' }]);
    expect(dialogos.pedidos[1].message).toContain('<li>fir → filtro</li>');
    expect(dialogos.pedidos[1].buttons.map((b) => b.action)).toEqual(['manter', 'renomear']);
  });

  it('manter os nomes nao renomeia; rename que falha ou lanca fica de fora', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': '#PRNAME filtro\n', 'P/a-b/Software/a-b.cmm': 'x' });
    dialogos.respostas.push('converter', 'manter');
    const renomear = vi.fn();
    expect((await oferecerConversao('P/p.spf', 'P', ['fir', 'a-b'], d, renomear)).renomeados).toEqual([]);
    expect(renomear).not.toHaveBeenCalled();

    const d2 = disco({ 'P/fir/Software/fir.cmm': '#PRNAME filtro\n', 'P/a-b/Software/a-b.cmm': 'x' });
    dialogos.respostas.push('converter', 'renomear');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const falha = vi.fn(async (de) => { if (de === 'fir') return { success: false }; throw new Error('EPERM'); });
    const r = await oferecerConversao('P/p.spf', 'P', ['fir', 'a-b'], d2, falha);
    expect(falha.mock.calls).toEqual([['fir', 'filtro'], ['a-b', 'a_b']]);
    expect(r.renomeados).toEqual([]);
    expect(lista.semeada).toBeNull();
    aviso.mockRestore();
  });

  it('uma falha no meio nao impede o projeto de abrir', async () => {
    const d = disco({ 'P/fir/Software/fir.cmm': 'x' });
    d.mkdir = async () => { throw new Error('EPERM'); };
    dialogos.respostas.push('converter');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await oferecerConversao('P/p.spf', 'P', ['fir'], d)).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('o texto do dialogo', () => {
  it('a mensagem escapa o HTML, porque o dialogo a poe por innerHTML', () => {
    expect(mensagemComLista('em <proc>/ & "x"', ['a<b>'])).toBe(
      '<p>em &lt;proc&gt;/ &amp; &quot;x&quot;</p><ul class="estrutura-antiga-lista"><li>a&lt;b&gt;</li></ul>');
    expect(mensagemComLista('so texto', [])).toBe('<p>so texto</p>');
  });

  it('o relatorio lista o movido, o pulado, a linha do nome, o nome invalido e a pasta que ficou', () => {
    window.t = (k, p) => `${k} ${JSON.stringify(p || {})}`;
    const linhas = linhasDoRelatorio('C:\\proj', {
      movidos: [{ de: 'C:\\proj\\fir\\Software\\fir.cmm', para: 'C:\\proj\\fir\\fir.cmm' }],
      pulados: [{ de: 'C:\\proj\\fir\\Simulation\\input_0.txt', para: 'x', motivo: 'EEXIST' }],
      semPrname: [{ arquivo: 'C:\\proj\\fir\\fir.cmm', nomeAntigo: 'velho' }],
      nomesInvalidos: ['my-cpu'],
      pastasQueFicaram: ['D:\\fora\\Software'],
    });
    expect(linhas).toEqual([
      'fir/Software/fir.cmm → fir/fir.cmm',
      'dialog.estruturaAntiga.pulado {"arquivo":"fir/Simulation/input_0.txt","motivo":"EEXIST"}',
      'dialog.estruturaAntiga.semPrname {"arquivo":"fir/fir.cmm","nome":"velho"}',
      'dialog.estruturaAntiga.nomeInvalido {"nome":"my-cpu"}',
      'dialog.estruturaAntiga.pastaFicou {"pasta":"D:/fora/Software"}',
    ]);
  });

  // #211: o gerado pelo yanc antigo vai para a Lixeira, e o relatorio diz
  // quantos e que a compilacao os refaz, sem listar arquivo por arquivo.
  it('o relatorio resume o que foi para a Lixeira, numa linha so', () => {
    window.t = (k, p) => `${k} ${JSON.stringify(p || {})}`;
    const base = { movidos: [], pulados: [], semPrname: [], nomesInvalidos: [], pastasQueFicaram: [] };
    expect(linhasDoRelatorio('C:\\proj', {
      ...base,
      descartados: [{ de: 'C:\\proj\\fir\\Hardware\\fir.v', para: 'x' }, { de: 'C:\\proj\\fir\\Software\\fir.asm', para: 'y' }],
    })).toEqual(['dialog.estruturaAntiga.descartados {"n":2}']);
    expect(linhasDoRelatorio('C:\\proj', { ...base, descartados: [] })).toEqual([]);
  });
});
