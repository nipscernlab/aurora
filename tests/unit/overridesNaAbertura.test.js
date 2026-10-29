// @vitest-environment happy-dom
//
// Os overrides gravados no .spf so valem depois de aceitos nesta maquina
// (js/compilation/overrides_aprovados.ts), e a abertura do projeto pergunta
// pelos que ainda nao foram decididos (js/project/overrides_na_abertura.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dialogos = vi.hoisted(() => ({ pedidos: [], respostas: [] }));
vi.mock('../../js/ui/dialog_manager.js', () => ({
  showDialog: vi.fn(async (o) => { dialogos.pedidos.push(o); return dialogos.respostas.shift() ?? 'cancel'; }),
}));
const spf = vi.hoisted(() => ({ estrutura: {}, falha: null }));
vi.mock('../../js/project/spf_store.js', () => ({
  SpfStore: {
    read: vi.fn(async () => { if (spf.falha) throw spf.falha; return spf.estrutura; }),
    update: vi.fn(),
  },
}));
const avisos = vi.hoisted(() => []);
vi.mock('../../js/ui/notification.js', () => ({
  showCardNotification: vi.fn((m, tipo) => { avisos.push([m, tipo]); }),
}));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI: {} }));

import {
  CHAVE_DAS_DECISOES, aceitos, assinatura, decidir, decisaoDe, pendentes,
} from '../../js/compilation/overrides_aprovados.ts';
import { linhaDoOverride, perguntarSobreOverrides } from '../../js/project/overrides_na_abertura.ts';

const VPI = { appendArgs: ['-m', 'C:/de/fora/vpi'], scope: 'persisted' };
const AVISO = { prependArgs: ['-Wall'], note: 'avisos <b>todos</b>' };

beforeEach(() => {
  localStorage.clear();
  dialogos.pedidos.length = 0;
  dialogos.respostas.length = 0;
  avisos.length = 0;
  spf.estrutura = { commandOverrides: { 'vvp-run': VPI, 'iverilog-build:P': AVISO } };
  spf.falha = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('overrides_aprovados', () => {
  it('a assinatura ignora a ordem das chaves, o scope e a raiz do projeto', () => {
    const a = assinatura('cocotb-run', { envSet: { A: 'C:\\p\\dados', B: '1' }, scope: 'persisted' }, 'C:\\p\\');
    const b = assinatura('cocotb-run', { envSet: { B: '1', A: 'D:/q/dados' } }, 'D:/q');
    expect(a).toBe(b);
    expect(a).toBe('cocotb-run\n{"envSet":{"A":"<projeto>/dados","B":"1"}}');
    // A propria raiz, e nao so o que esta dentro dela; sem raiz, nada se troca.
    expect(assinatura('x', { appendArgs: ['C:/p'] }, 'c:/P')).toBe('x\n{"appendArgs":["<projeto>"]}');
    expect(assinatura('x', { appendArgs: ['C:/p'] }, null)).toBe('x\n{"appendArgs":["C:/p"]}');
    // Pasta com o mesmo comeco nao e a raiz.
    expect(assinatura('x', { appendArgs: ['C:/pasta'] }, 'C:/p')).toBe('x\n{"appendArgs":["C:/pasta"]}');
  });

  it('nada decidido: tudo pendente, nada aceito', () => {
    expect(pendentes(spf.estrutura.commandOverrides, 'C:/p').map(([k]) => k)).toEqual(['vvp-run', 'iverilog-build:P']);
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual({});
    expect(decisaoDe('vvp-run', VPI, 'C:/p')).toBeNull();
  });

  it('aceitar um e ignorar outro: so o aceito se aplica, e nenhum fica pendente', () => {
    decidir([['vvp-run', VPI]], 'aplicar', 'C:/p');
    decidir([['iverilog-build:P', AVISO]], 'ignorar', 'C:/p');
    decidir([], 'aplicar', 'C:/p');
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual({ 'vvp-run': VPI });
    expect(pendentes(spf.estrutura.commandOverrides, 'C:/p')).toEqual([]);
    expect(decisaoDe('iverilog-build:P', AVISO, 'C:/p')).toBe('ignorar');
    // O mesmo passo com outro conteudo e outra pergunta.
    expect(decisaoDe('vvp-run', { appendArgs: ['-m', 'C:/outro'] }, 'C:/p')).toBeNull();
  });

  it('decisao estragada no localStorage nao vale, e o que nao e objeto e esquecido', () => {
    localStorage.setItem(CHAVE_DAS_DECISOES, JSON.stringify({ [assinatura('vvp-run', VPI, 'C:/p')]: 'talvez' }));
    expect(decisaoDe('vvp-run', VPI, 'C:/p')).toBeNull();
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual({});
    for (const bruto of ['[1]', 'null', '{nao e json']) {
      localStorage.setItem(CHAVE_DAS_DECISOES, bruto);
      expect(pendentes(spf.estrutura.commandOverrides, 'C:/p')).toHaveLength(2);
    }
  });

  it('localStorage que falha ao gravar so avisa: nada passa a valer', () => {
    const original = globalThis.localStorage;
    const quebrado = { getItem: (k) => original.getItem(k), setItem: () => { throw new Error('cheio'); } };
    vi.stubGlobal('localStorage', quebrado);
    try {
      decidir([['vvp-run', VPI]], 'aplicar', 'C:/p');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(console.warn).toHaveBeenCalledWith('[overrides] nao gravei a decisao:', expect.any(Error));
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual({});
  });
});

describe('perguntarSobreOverrides', () => {
  it('mostra cada override pendente, escapado, e Aplicar aceita todos', async () => {
    dialogos.respostas.push('aplicar');
    expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBe('aplicar');
    const [pedido] = dialogos.pedidos;
    expect(pedido.title).toBe('dialog.overridesDoSpf.title');
    expect(pedido.fecharPorFora).toBe(false);
    expect(pedido.buttons.map((b) => b.action)).toEqual(['ignorar', 'aplicar']);
    expect(pedido.message).toContain('<li>vvp-run: {&quot;appendArgs&quot;:[&quot;-m&quot;,&quot;C:/de/fora/vpi&quot;]}</li>');
    expect(pedido.message).toContain('&lt;b&gt;todos&lt;/b&gt;');
    expect(pedido.message).not.toContain('<b>');
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual(spf.estrutura.commandOverrides);
    // Decidido, nao pergunta de novo.
    expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBeNull();
    expect(dialogos.pedidos).toHaveLength(1);
  });

  it('so pergunta pelo que ainda nao foi decidido', async () => {
    decidir([['vvp-run', VPI]], 'aplicar', 'C:/p');
    dialogos.respostas.push('ignorar');
    expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBe('ignorar');
    expect(dialogos.pedidos[0].message).not.toContain('vvp-run');
    expect(aceitos(spf.estrutura.commandOverrides, 'C:/p')).toEqual({ 'vvp-run': VPI });
    expect(avisos).toEqual([]);
  });

  it('Esc nao decide: avisa que ficaram de fora e pergunta na proxima abertura', async () => {
    expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBeNull();
    expect(avisos).toEqual([['dialog.overridesDoSpf.adiada', 'warning']]);
    expect(pendentes(spf.estrutura.commandOverrides, 'C:/p')).toHaveLength(2);
  });

  it('sem override, ou com o campo estragado, nem pergunta', async () => {
    for (const estrutura of [{}, { commandOverrides: [] }, { commandOverrides: 'x' }, { commandOverrides: {} }]) {
      spf.estrutura = estrutura;
      expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBeNull();
    }
    expect(dialogos.pedidos).toEqual([]);
  });

  it('.spf que nao le: nao lanca, nao pergunta e nada se aplica', async () => {
    spf.falha = new Error('ilegivel');
    expect(await perguntarSobreOverrides('C:/p/p.spf', 'C:/p')).toBeNull();
    expect(dialogos.pedidos).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('[overrides] a pergunta da abertura nao terminou:', spf.falha);
  });

  it('a linha da lista tira o scope e mostra o conteudo exato', () => {
    expect(linhaDoOverride('vvp-run', VPI)).toBe('vvp-run: {"appendArgs":["-m","C:/de/fora/vpi"]}');
    expect(linhaDoOverride('x', null)).toBe('x: {}');
  });
});
