// @vitest-environment happy-dom
//
// A tela do historico de execucoes (js/compilation/run_history): lista e
// detalhe do projeto que o ProjectStore diz estar aberto. A tabela de rotulos
// tem o runHistorySteps.test.js; aqui e a tela, com o main simulado.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const electronAPI = {
  runLogListar: vi.fn(),
  runLogLer: vi.fn(),
};
const execucoesAbertas = vi.fn(() => []);
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
vi.mock('../../js/compilation/compilation_flow.js', () => ({ execucoesAbertas }));

let tela;
let ProjectStore;

const $ = (id) => document.getElementById(id);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const gravada = (id, extra = {}) => ({ id, pedido: 'all', inicio: 0, ms: 1500, passos: 3, ok: true, ...extra });

beforeAll(async () => {
  document.body.innerHTML = `
    <button id="run-history"></button>
    <div id="runHistoryModal" aria-hidden="true">
      <div id="run-history-list"></div>
      <div id="run-history-detail" hidden></div>
    </div>`;
  delete window.t;
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  tela = await import('../../js/compilation/run_history.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

beforeEach(() => {
  electronAPI.runLogListar.mockReset();
  electronAPI.runLogLer.mockReset();
  execucoesAbertas.mockReset().mockReturnValue([]);
  ProjectStore.setProject('C:/p/p.spf', 'C:/p');
});

afterEach(() => {
  tela.fechar();
  vi.useRealTimers();
  delete window.t;
});

describe('lista', () => {
  it('sem projeto aberto, diz isso e nao le o disco', async () => {
    ProjectStore.clearProject();
    await tela.desenharLista();
    expect($('run-history-list').textContent).toContain('runHistory.noProject');
    expect(electronAPI.runLogListar).not.toHaveBeenCalled();
  });

  it('le as execucoes do projeto aberto; a viva vem na frente, como linha que nao abre', async () => {
    execucoesAbertas.mockReturnValue([{ id: 'v', pedido: 'all', inicio: 0, passos: 1, andando: true }]);
    electronAPI.runLogListar.mockResolvedValue({
      execucoes: [gravada('v'), gravada('a'), gravada('b', { ok: false }), gravada('c', { ok: false, cancelada: true })],
    });
    await tela.desenharLista();
    expect(electronAPI.runLogListar).toHaveBeenCalledWith('C:/p');
    const itens = [...$('run-history-list').querySelectorAll('.run-history-item')];
    expect(itens.map((i) => i.tagName)).toEqual(['DIV', 'BUTTON', 'BUTTON', 'BUTTON']);
    expect(itens.map((i) => i.querySelector('.run-history-desfecho').className.split(' ').pop()))
      .toEqual(['andando', 'ok', 'erro', 'cancelada']);
    expect(itens[1].getAttribute('data-id')).toBe('a');
  });

  it('o pedido sai com o nome traduzido quando a traducao existe', async () => {
    window.t = (k) => (k === 'compilation.type.all' ? 'Tudo' : k);
    electronAPI.runLogListar.mockResolvedValue({ execucoes: [gravada('a'), gravada('b', { pedido: 'raro' })] });
    await tela.desenharLista();
    const pedidos = [...$('run-history-list').querySelectorAll('.run-history-pedido')].map((e) => e.textContent);
    expect(pedidos).toEqual(['Tudo', 'raro']);
  });

  it('nenhuma execucao, diz que esta vazio', async () => {
    electronAPI.runLogListar.mockResolvedValue({});
    await tela.desenharLista();
    expect($('run-history-list').textContent).toContain('runHistory.empty');
  });

  it('leitura que falha aparece na lista', async () => {
    electronAPI.runLogListar.mockRejectedValue(new Error('disco'));
    await tela.desenharLista();
    expect($('run-history-list').textContent).toContain('runHistory.readFailed');
  });

  it('pedido no meio de uma leitura nao se perde: refaz ao terminar', async () => {
    let soltar;
    electronAPI.runLogListar
      .mockImplementationOnce(() => new Promise((r) => { soltar = r; }))
      .mockResolvedValue({ execucoes: [gravada('novo')] });
    const primeira = tela.desenharLista();
    await tela.desenharLista();
    soltar({ execucoes: [gravada('velho')] });
    await primeira;
    await flush();
    expect(electronAPI.runLogListar).toHaveBeenCalledTimes(2);
    expect($('run-history-list').querySelector('[data-id]').getAttribute('data-id')).toBe('novo');
  });
});

describe('detalhe', () => {
  const execucao = {
    id: 'a', pedido: 'all', inicio: 0, ms: 125_000, ok: false, erro: 'falhou com codigo 1',
    estado: { topoSintese: 'C:/p/top.v', simulador: 'iverilog', processadores: ['P'], fontes: ['C:/p/a.v'] },
    problemas: [
      { arquivo: 'C:/p/P/Software/P.cmm', linha: 3, coluna: 2, mensagem: 'x', severidade: 'erro', ferramenta: 'cmmcomp' },
      { arquivo: 'C:/p/a.v', linha: 7, mensagem: 'y', severidade: 'aviso' },
      { arquivo: 'C:/p/b.v', mensagem: 'z' },
    ],
    passos: [
      { step: 'cmm', ferramenta: 'cmmcomp.exe', args: ['-a'], ms: 20, code: 0 },
      { step: 'asm', ferramenta: 'asmcomp.exe', ms: 900, code: 1 },
      { step: 'iverilog-build', ms: 5, concorrente: true },
    ],
  };

  it('clicar numa linha le a execucao do projeto aberto e mostra retrato, problemas e cadeia', async () => {
    electronAPI.runLogListar.mockResolvedValue({ execucoes: [gravada('a')] });
    electronAPI.runLogLer.mockResolvedValue({ ok: true, execucao });
    tela.abrir();
    await flush();
    $('run-history-list').querySelector('[data-id="a"]').click();
    await flush();
    expect(electronAPI.runLogLer).toHaveBeenCalledWith('C:/p', 'a');
    const painel = $('run-history-detail');
    expect(painel.hidden).toBe(false);
    expect($('run-history-list').hidden).toBe(true);
    expect(painel.querySelector('.run-history-erro').textContent).toBe('falhou com codigo 1');
    const lugares = [...painel.querySelectorAll('.run-history-problema-lugar')].map((e) => e.textContent);
    expect(lugares).toEqual(['P.cmm:3:2', 'a.v:7', 'b.v']);
    expect(painel.querySelector('.run-history-problema.aviso')).not.toBeNull();
    expect(painel.querySelector('.run-history-retrato').textContent).toContain('top.v');
    expect(painel.querySelector('.run-history-retrato').textContent).toContain('runHistory.none');
    const passos = [...painel.querySelectorAll('.run-history-passo')];
    expect(passos.map((p) => p.className.replace(/\s+/g, ' ').trim()))
      .toEqual(['run-history-passo', 'run-history-passo falhou', 'run-history-passo concorrente']);
    expect(painel.querySelector('.run-history-cabeca .run-history-duracao').textContent).toBe('2 min 5 s');

    painel.querySelector('#run-history-back').click();
    expect(painel.hidden).toBe(true);
    expect($('run-history-list').hidden).toBe(false);
  });

  it('execucao sem estado, sem passos e sem problemas mostra o vazio de cada parte', async () => {
    electronAPI.runLogLer.mockResolvedValue({ ok: true, execucao: { id: 'z', pedido: 'all', inicio: 0, ok: true } });
    await tela.mostrarDetalhe('z');
    const painel = $('run-history-detail');
    expect(painel.textContent).toContain('runHistory.noSteps');
    expect(painel.querySelector('.run-history-problemas')).toBeNull();
    expect(painel.querySelector('.run-history-erro')).toBeNull();
  });

  it('leitura que nao da certo nao mexe na tela', async () => {
    electronAPI.runLogLer.mockResolvedValue({ ok: false });
    $('run-history-detail').innerHTML = '<p>antes</p>';
    await tela.mostrarDetalhe('x');
    expect($('run-history-detail').innerHTML).toBe('<p>antes</p>');
  });
});

describe('abrir, fechar e os avisos do compilation_flow', () => {
  it('o botao abre o modal; o fechar do modal fecha', async () => {
    electronAPI.runLogListar.mockResolvedValue({ execucoes: [] });
    $('run-history').click();
    expect($('runHistoryModal').classList.contains('show')).toBe(true);
    expect($('runHistoryModal').getAttribute('aria-hidden')).toBe('false');
    $('runHistoryModal').dispatchEvent(new Event('aurora-modal-close'));
    expect($('runHistoryModal').classList.contains('show')).toBe(false);
  });

  it('aviso com a lista fechada nao le o disco', async () => {
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    await flush();
    expect(electronAPI.runLogListar).not.toHaveBeenCalled();
  });

  it('o primeiro aviso pinta na hora; a rajada vira uma leitura a mais no fim da janela', async () => {
    vi.useFakeTimers();
    electronAPI.runLogListar.mockResolvedValue({ execucoes: [] });
    tela.abrir();
    await flush();
    const aoAbrir = electronAPI.runLogListar.mock.calls.length;
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    await flush();
    expect(electronAPI.runLogListar.mock.calls.length).toBe(aoAbrir + 1);
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    await flush();
    expect(electronAPI.runLogListar.mock.calls.length).toBe(aoAbrir + 1);
    await vi.advanceTimersByTimeAsync(260);
    expect(electronAPI.runLogListar.mock.calls.length).toBe(aoAbrir + 2);
    await vi.advanceTimersByTimeAsync(260);
  });

  it('fechar no meio da janela cancela a leitura pendente', async () => {
    vi.useFakeTimers();
    electronAPI.runLogListar.mockResolvedValue({ execucoes: [] });
    tela.abrir();
    await flush();
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    window.dispatchEvent(new Event('aurora:run-log-changed'));
    await flush();
    const antes = electronAPI.runLogListar.mock.calls.length;
    tela.fechar();
    await vi.advanceTimersByTimeAsync(600);
    expect(electronAPI.runLogListar.mock.calls.length).toBe(antes);
  });
});

describe('duracao', () => {
  it('ms, segundos e minutos; valor que nao e numero some', () => {
    expect(tela.duracao(12.4)).toBe('12 ms');
    expect(tela.duracao(1500)).toBe('1.5 s');
    expect(tela.duracao(61_000)).toBe('1 min 1 s');
    expect(tela.duracao(undefined)).toBe('');
    expect(tela.duracao(Infinity)).toBe('');
  });
});
