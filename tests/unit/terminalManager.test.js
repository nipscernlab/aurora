// @vitest-environment happy-dom
//
// O TerminalManager (js/terminal/terminal_module.js): os terminais de saida da
// compilacao (TCMM, TASM, TVERI, TWAVE, THTEST, TPRISM). Teste de caracterizacao,
// escrito antes de dividir o arquivo: contadores, filtros, cartoes agrupados,
// linhas repetidas, a barra de progresso do teste de hardware, o tamanho do
// dump, exportar o log e limpar. O que se afirma aqui e o comportamento que ja
// existia.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({}));
vi.hoisted(() => {
  globalThis.window.electronAPI = new Proxy(api, {
    get: (alvo, k) => (k in alvo ? alvo[k] : () => {}),
  });
});
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { tabs: new Map(), addTab: () => {}, activateTab: () => {} } }));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
const showCardNotification = vi.hoisted(() => vi.fn());
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
const term = vi.hoisted(() => ({ switchTerminal: vi.fn(), smoothFollowToBottom: vi.fn() }));
vi.mock('../../js/terminal/terminal.js', () => term);

import { TerminalManager } from '../../js/terminal/terminal_module.js';
import { problemStore } from '../../js/terminal/problem_store.js';

const IDS = ['tcmm', 'tasm', 'tveri', 'twave', 'thtest', 'tprism', 'tcmd'];

function montarDOM({ ativo = 'tcmm', filtros = true } = {}) {
  document.body.innerHTML = `
    <div class="terminal-tabs">
      ${IDS.map((id) => `<div class="tab${id === ativo ? ' active' : ''}" data-terminal="${id}"></div>`).join('')}
    </div>
    ${filtros ? `
      <button id="filter-error" data-tooltip-initialized="1"></button>
      <button id="filter-warning"></button>
      <button id="filter-success"></button>
      <button id="filter-tip"></button>` : ''}
    <input type="checkbox" id="verbose-toggle">
    <button id="clear-terminal"><i class="ph ph-trash"></i></button>
    <button id="export-log"></button>
    ${IDS.map((id) => `<div id="terminal-${id}" class="terminal-content${id === ativo ? '' : ' hidden'}"><div class="terminal-body" id="body-${id}"></div></div>`).join('')}`;
}

/** Um TerminalManager novo, com as ligacoes unicas da classe zeradas. */
function novo(opts) {
  montarDOM(opts);
  for (const k of ['terminalTabsInitialized', 'autoScrollInitialized', 'terminalLogListenerInitialized',
    'clearButtonInitialized', 'exportLogButtonInitialized']) TerminalManager[k] = false;
  return new TerminalManager();
}

const corpo = (id) => document.querySelector(`#terminal-${id} .terminal-body`);
const badge = (id) => document.getElementById(id).querySelector('.message-counter');
const entradas = (id) => Array.from(corpo(id).querySelectorAll('.log-entry'));

let tm;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(api)) delete api[k];
  localStorage.clear();
  problemStore.limpar();
  delete window.t;
  delete window.isCompilationCanceled;
  delete window.shellTerminal;
  delete window.abrirTerminal;
  delete window.standardTreeRenderer;
  tm = novo();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const falsos = () => vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
});

// ───────────────────────────────────────────────────── montagem e contadores
describe('montagem e contadores', () => {
  it('cria o contador de cada filtro, uma vez so', () => {
    for (const id of ['filter-error', 'filter-warning', 'filter-success', 'filter-tip']) {
      expect(document.getElementById(id).querySelectorAll('.message-counter')).toHaveLength(1);
    }
    tm.createCounterBadges();
    expect(document.getElementById('filter-error').querySelectorAll('.message-counter')).toHaveLength(1);
  });

  it('o modo detalhado nasce desligado, e quem ja escolheu mantem', () => {
    expect(tm.verboseMode).toBe(false);
    localStorage.setItem('terminal-verbose-mode', 'true');
    expect(novo().verboseMode).toBe(true);
    expect(document.getElementById('verbose-toggle').checked).toBe(true);
  });

  it('trocar o modo detalhado grava e refiltra', () => {
    const refiltra = vi.spyOn(tm, 'applyFilterToAllTerminals');
    const chk = document.getElementById('verbose-toggle');
    chk.checked = true;
    chk.dispatchEvent(new Event('change'));
    expect(tm.verboseMode).toBe(true);
    expect(localStorage.getItem('terminal-verbose-mode')).toBe('true');
    expect(refiltra).toHaveBeenCalled();
  });

  it('o contador mostra a aba ativa, pulsa quando sobe e some no zero', () => {
    falsos();
    tm.incrementMessageCount('tcmm', 'error');
    expect(badge('filter-error').textContent).toBe('1');
    expect(badge('filter-error').style.display).toBe('flex');
    expect(badge('filter-error').classList.contains('pulse')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(badge('filter-error').classList.contains('pulse')).toBe(false);
    expect(badge('filter-warning').style.display).toBe('none');
    tm.incrementMessageCount('tcmm', 'nada');
    tm.incrementMessageCount('outro', 'error');
    tm.resetMessageCounts('tcmm');
    tm.resetMessageCounts('outro');
    expect(badge('filter-error').style.display).toBe('none');
  });

  it('sem aba ativa, terminal desconhecido, botao ou contador ausente: nada quebra', () => {
    document.querySelector('.tab.active').setAttribute('data-terminal', 'xyz');
    expect(() => tm.updateCounterDisplay()).not.toThrow();
    badge('filter-error').remove();
    document.getElementById('filter-tip').remove();
    expect(() => tm.updateCounterDisplay()).not.toThrow();
    document.querySelector('.tab.active').classList.remove('active');
    expect(() => tm.updateCounterDisplay()).not.toThrow();
  });

  it('a contagem sai do DOM: cartao agrupado conta cada linha, info conta como dica, plain nao conta', () => {
    corpo('tcmm').innerHTML = `
      <div class="log-entry error"><div class="grouped-message"></div><div class="grouped-message"></div></div>
      <div class="log-entry warning"></div><div class="log-entry success"></div>
      <div class="log-entry info"></div><div class="log-entry tips"></div><div class="log-entry plain"></div>`;
    tm.recountMessages('tcmm');
    expect(tm.messageCounts.tcmm).toEqual({ error: 2, warning: 1, success: 1, tips: 2 });
    tm.recountMessages('nao-existe');
  });

  it('o corpo do terminal e reconsultado quando a referencia guardada saiu do DOM', () => {
    const velho = corpo('tasm');
    velho.remove();
    const novoCorpo = document.createElement('div');
    novoCorpo.className = 'terminal-body';
    document.getElementById('terminal-tasm').appendChild(novoCorpo);
    expect(tm._resolveTerminal('tasm')).toBe(novoCorpo);
    novoCorpo.remove();
    expect(tm._resolveTerminal('tasm')).toBeNull();
  });

  it('a saida puxa a aba do terminal que recebe, se ela nao esta na frente', () => {
    tm.revealActiveOutputTerminal('tcmm');
    expect(term.switchTerminal).not.toHaveBeenCalled();
    tm.revealActiveOutputTerminal('tasm');
    expect(term.switchTerminal).toHaveBeenCalledWith('terminal-tasm');
    tm.revealActiveOutputTerminal('xyz');
    expect(term.switchTerminal).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────── classificacao e entrada
describe('classificar e escrever', () => {
  it('reconhece a severidade pela marca da ferramenta e pelas palavras do yanc', () => {
    const d = (t) => tm.detectMessageType(t);
    expect(d('top.v:3: error: x')).toBe('error');
    expect(d('a.v:1: warning: y')).toBe('warning');
    expect(d('Atenção: variavel')).toBe('warning');
    expect(d('ERROR total')).toBe('error');
    expect(d('Sucesso!')).toBe('success');
    expect(d('Tip: use')).toBe('tips');
    expect(d('a variavel x não está sendo usada')).toBe('tips');
    expect(d('erro de sintaxe na linha')).toBe('error');
    expect(d('texto qualquer')).toBe('plain');
    expect(d({ stdout: 'Success', stderr: null })).toBe('success');
    expect(d({})).toBe('plain');
  });

  it('saida de executavel: cada linha com marca vai para o cartao do seu tipo; plain so no detalhado', () => {
    falsos();
    tm.processExecutableOutput('tasm', { stdout: 'Erro: um\nlinha solta\n\nErro: dois\n', stderr: 'Atenção: tres' });
    expect(term.switchTerminal).toHaveBeenCalledWith('terminal-tasm');
    const cards = entradas('tasm');
    expect(cards.map((c) => c.className)).toEqual(['log-entry error animating-in', 'log-entry warning animating-in']);
    expect(cards[0].querySelectorAll('.grouped-message')).toHaveLength(2);
    expect(cards[0].querySelector('.grouped-message').innerHTML).toContain('<strong style="font-weight:700">Erro</strong>:');
    tm.verboseMode = true;
    tm.processExecutableOutput('tasm', { stdout: 'linha solta' });
    expect(entradas('tasm').at(-1).classList.contains('plain')).toBe(true);
    // O fim do lote reconta pelo DOM.
    vi.advanceTimersByTime(200);
    expect(tm.messageCounts.tasm).toEqual({ error: 2, warning: 1, success: 0, tips: 0 });
  });

  it('saida vazia, so espacos ou terminal que nao existe nao escreve nada', () => {
    tm.processExecutableOutput('tasm', {});
    tm.processExecutableOutput('tasm', { stdout: '\n  \n' });
    tm.processExecutableOutput('xyz', { stdout: 'Erro' });
    expect(entradas('tasm')).toHaveLength(0);
  });

  it('linha streamada: mesma regra, uma por vez', () => {
    tm.processStreamedLine('tveri', 'Erro na linha 3: x');
    tm.processStreamedLine('tveri', 'plain');
    tm.processStreamedLine('tveri', '');
    tm.processStreamedLine('xyz', 'Erro');
    expect(entradas('tveri')).toHaveLength(1);
    tm.verboseMode = true;
    tm.processStreamedLine('tveri', 'plain');
    expect(entradas('tveri')).toHaveLength(2);
  });

  it('stdout e stderr sao juntados sem quebra: a ultima linha de um gruda na primeira do outro', () => {
    tm.processExecutableOutput('tasm', { stdout: 'Erro: fim', stderr: 'Atenção: comeco' });
    expect(entradas('tasm').map((e) => e.className)).toEqual(['log-entry warning animating-in']);
    expect(entradas('tasm')[0].textContent).toContain('Erro: fimAtenção: comeco');
  });

  it('a nova sessao de um executavel comeca cartoes novos', () => {
    tm.processStreamedLine('tveri', 'Erro: a');
    tm.processExecutableOutput('tveri', { stdout: 'Erro: b' });
    expect(entradas('tveri')).toHaveLength(2);
    tm.resetSessionCards('xyz');
  });

  it('mensagem da AURORA: a marca no texto vence o tipo pedido; sem marca, vale o tipo', () => {
    tm.appendToTerminal('tcmm', 'Sucesso ao compilar', 'error');
    tm.appendToTerminal('tcmm', 'texto sem marca', 'warning');
    tm.appendToTerminal('tcmm', { stdout: 'saida', stderr: ' crua' }, 'raw');
    tm.appendToTerminal('tcmm', 'padrao');
    expect(entradas('tcmm').map((e) => e.className)).toEqual([
      'log-entry success', 'log-entry warning', 'log-entry raw', 'log-entry info']);
    expect(entradas('tcmm')[0].querySelector('.message-content').innerHTML).toBe('<strong>Sucesso</strong> ao compilar');
  });

  it('nota interna so aparece no detalhado; tipo vazio vira plain; texto vazio nao escreve', () => {
    tm.appendToTerminal('tcmm', 'nota de fase', 'info', { internal: true });
    tm.appendToTerminal('tcmm', 'sem tipo', '');
    tm.appendToTerminal('tcmm', '   ');
    tm.appendToTerminal('xyz', 'Erro');
    expect(entradas('tcmm')).toHaveLength(0);
    tm.verboseMode = true;
    tm.appendToTerminal('tcmm', 'nota de fase', 'info', { internal: true });
    expect(entradas('tcmm')[0].classList.contains('plain')).toBe(true);
  });

  it('a mesma linha repetida logo em seguida vira um contador, e intercalada nao', () => {
    tm.appendToTerminal('tcmm', 'Erro: fopen falhou');
    tm.appendToTerminal('tcmm', 'Erro: fopen falhou');
    tm.appendToTerminal('tcmm', 'Erro: fopen falhou');
    expect(entradas('tcmm')).toHaveLength(1);
    expect(entradas('tcmm')[0].querySelector('.repeat-count').textContent).toBe('x3');
    tm.appendToTerminal('tcmm', 'Erro: outro');
    tm.appendToTerminal('tcmm', 'Erro: fopen falhou');
    expect(entradas('tcmm')).toHaveLength(3);
  });

  it('terminal apagado depois de limpar reaparece no proximo quadro, ja rolado', () => {
    falsos();
    corpo('tcmm').classList.add('faded-out');
    corpo('tcmm').id = 'terminal-tcmm';
    tm.appendToTerminal('tcmm', 'Info: volta');
    vi.advanceTimersByTime(50);
    expect(corpo('tcmm').classList.contains('faded-out')).toBe(false);
    expect(term.smoothFollowToBottom).toHaveBeenCalled();
  });

  it('o cartao agrupado tem teto de linhas', () => {
    const card = tm.createGroupedCard(corpo('tcmm'), 'error', 'agora');
    const caixa = card.querySelector('.messages-container');
    for (let i = 0; i < 5000; i++) caixa.appendChild(document.createElement('div'));
    tm.addMessageToCard(card, 'Erro: mais uma', 'error');
    expect(caixa.childElementCount).toBe(5000);
    expect(caixa.lastElementChild.classList.contains('grouped-message')).toBe(true);
    const semCaixa = document.createElement('div');
    expect(() => tm.addMessageToCard(semCaixa, 'x', 'error')).not.toThrow();
    tm.addToSessionCard('xyz', 'x', 'error');
  });

  it('o terminal tem teto de entradas: as mais antigas saem', () => {
    const c = corpo('tcmm');
    for (let i = 0; i < 5002; i++) c.appendChild(document.createElement('div'));
    const terceira = c.children[2];
    tm.trimTerminal(c);
    expect(c.childElementCount).toBe(5000);
    expect(c.firstElementChild).toBe(terceira);
    tm.trimTerminal(null);
  });

  it('o log que chega pelo IPC vai para o terminal pedido, com um ouvinte so', () => {
    let ouvinte;
    api.onTerminalLog = vi.fn((cb) => { ouvinte = cb; });
    tm = novo();
    new TerminalManager();
    expect(api.onTerminalLog).toHaveBeenCalledTimes(1);
    ouvinte(null, 'tprism', 'Sucesso: sintetizado');
    ouvinte(null, 'tprism', 'Atenção: x', 'warning');
    expect(entradas('tprism')).toHaveLength(2);
  });

  it('a saida do GTKWave perde o ruido de inicializacao', () => {
    const r = tm.filterGtkWaveOutput({ code: 0, stdout: 'GTKWave Analyzer v3\nsinal ok\n  FSTLOAD | x', stderr: 'WM Destroy\nerro real' });
    expect(r).toEqual({ code: 0, stdout: 'sinal ok', stderr: 'erro real' });
    expect(tm.filterGtkWaveOutput({}).stdout).toBe('');
  });

  it('formatOutput preserva o recuo em HTML', () => {
    expect(tm.formatOutput('a\n  b')).toBe('a<br>&nbsp;&nbsp;b');
  });
});

// ──────────────────────────────────────────────────────────── filtros
describe('filtros', () => {
  beforeEach(() => {
    corpo('tcmm').innerHTML = `
      <div class="log-entry error" id="e"></div><div class="log-entry warning" id="w"></div>
      <div class="log-entry info" id="i"></div><div class="log-entry tips" id="t"></div>
      <div class="log-entry success" id="s"></div>
      <div class="log-entry plain" id="p"></div><div class="log-entry plain" id="pl"><span class="line-link"></span></div>`;
  });
  const visiveis = () => ['e', 'w', 'i', 't', 's', 'p', 'pl'].filter((id) => document.getElementById(id).style.display !== 'none');

  it('sem filtro, tudo aparece menos o plain sem link, que so o detalhado mostra', () => {
    tm.applyFilter('tcmm');
    expect(visiveis()).toEqual(['e', 'w', 'i', 't', 's', 'pl']);
    tm.verboseMode = true;
    tm.applyFilter('tcmm');
    expect(visiveis()).toEqual(['e', 'w', 'i', 't', 's', 'p', 'pl']);
    tm.applyFilter('xyz');
  });

  it('o botao liga e desliga o filtro; dica inclui info; os quatro juntos e o mesmo que nenhum', () => {
    document.getElementById('filter-tip').click();
    expect(document.getElementById('filter-tip').classList.contains('active')).toBe(true);
    expect(visiveis()).toEqual(['i', 't', 'pl']);
    document.getElementById('filter-error').click();
    expect(visiveis()).toEqual(['e', 'i', 't', 'pl']);
    document.getElementById('filter-warning').click();
    document.getElementById('filter-success').click();
    expect(visiveis()).toEqual(['e', 'w', 'i', 't', 's', 'pl']);
    document.getElementById('filter-tip').click();
    expect(document.getElementById('filter-tip').classList.contains('active')).toBe(false);
    expect(visiveis()).toEqual(['e', 'w', 's', 'pl']);
  });

  it('os botoes sao trocados por copias sem a marca do balao, para ele religar', () => {
    expect(document.getElementById('filter-error').hasAttribute('data-tooltip-initialized')).toBe(false);
  });

  it('sem os quatro botoes, nao liga filtro nenhum', () => {
    const t2 = novo({ filtros: false });
    expect(t2.activeFilters.size).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────── abas
describe('abas', () => {
  it('clicar numa aba reabre o painel, troca a ativa e mostra o terminal dela', () => {
    window.abrirTerminal = vi.fn();
    const tab = document.querySelector('.tab[data-terminal="tasm"]');
    tab.click();
    expect(window.abrirTerminal).toHaveBeenCalled();
    expect(tab.classList.contains('active')).toBe(true);
    expect(document.querySelectorAll('.tab.active')).toHaveLength(1);
    expect(document.getElementById('terminal-tasm').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('terminal-tcmm').classList.contains('hidden')).toBe(true);
    expect(term.smoothFollowToBottom).toHaveBeenCalledWith(corpo('tasm'));
  });

  it('outro TerminalManager nao liga o clique de novo', () => {
    const spy = vi.spyOn(TerminalManager.prototype, 'updateCounterDisplay');
    new TerminalManager();
    spy.mockClear();
    document.querySelector('.tab[data-terminal="tasm"]').click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('mudanca no corpo do terminal rola para o fim', async () => {
    corpo('tveri').appendChild(document.createElement('div'));
    await vi.waitFor(() => expect(term.smoothFollowToBottom).toHaveBeenCalledWith(corpo('tveri')));
  });
});

// ─────────────────────────────────────────────────── tamanho do dump
describe('tamanho do dump', () => {
  it('um pill so, atualizado no lugar, com o caminho no balao', () => {
    tm.renderDumpSize('twave', { name: 'top.vcd', path: 'C:/p/top.vcd', bytes: 1536 });
    tm.renderDumpSize('twave', { name: 'top.vcd', bytes: 3 * 1024 * 1024 });
    const pills = corpo('twave').querySelectorAll('.dump-size');
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('top.vcd · 3.0 MB');
    expect(pills[0].dataset.tooltip).toBe('C:/p/top.vcd');
  });

  it('cada faixa de tamanho tem a sua unidade', () => {
    const txt = (bytes) => { tm.renderDumpSize('twave', { name: 'x', bytes }); return corpo('twave').querySelector('.dump-size').textContent; };
    expect(txt(-1)).toBe('x · 0 B');
    expect(txt(NaN)).toBe('x · 0 B');
    expect(txt(500)).toBe('x · 500 B');
    expect(txt(2048)).toBe('x · 2.0 KB');
    expect(txt(5 * 1024 ** 3)).toBe('x · 5.00 GB');
  });

  it('fica colado embaixo enquanto roda; terminado, congela e fica onde esta', () => {
    tm.renderDumpSize('twave', { name: 'x', bytes: 1 });
    corpo('twave').appendChild(document.createElement('p'));
    tm.renderDumpSize('twave', { name: 'x', bytes: 2 });
    expect(corpo('twave').lastElementChild.classList.contains('dump-size')).toBe(true);
    corpo('twave').appendChild(document.createElement('p'));
    tm.renderDumpSize('twave', { name: 'x', bytes: 3, done: true });
    expect(corpo('twave').lastElementChild.tagName).toBe('P');
    expect(corpo('twave').querySelector('.dump-size').classList.contains('done')).toBe(true);
  });

  it('pill que saiu do DOM e recriado; terminal que nao existe nao recebe nada', () => {
    tm.renderDumpSize('twave', { name: 'x', bytes: 1 });
    corpo('twave').innerHTML = '';
    tm.renderDumpSize('twave', { name: 'x', bytes: 1 });
    expect(corpo('twave').querySelectorAll('.dump-size')).toHaveLength(1);
    tm.renderDumpSize('xyz', { name: 'x', bytes: 1 });
  });
});

// ────────────────────────────────────── barra de progresso do hardware
describe('barra de progresso do teste de hardware', () => {
  const barra = () => corpo('thtest').querySelector('.hw-progress');

  it('uma barra so, com rotulo, porcentagem animada, ciclos e leituras', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'Simulando', cyc: 50, total: 200, reads: 4 });
    expect(term.switchTerminal).toHaveBeenCalledWith('terminal-thtest');
    expect(barra().querySelector('.hw-progress-label').textContent).toBe('Simulando');
    expect(barra().querySelector('.hw-progress-meta').textContent).toBe('50/200 · 4 reads');
    vi.advanceTimersByTime(1000);
    expect(barra().querySelector('.hw-progress-pct').textContent).toBe('25%');
    expect(barra().querySelector('.hw-progress-fill').style.transform).toBe('scaleX(0.25)');
    tm.renderHardwareProgress('thtest', { label: 'Simulando', pct: 30 });
    expect(corpo('thtest').querySelectorAll('.hw-progress')).toHaveLength(1);
  });

  it('com a taxa medida, estima o tempo que falta; o rotulo de leituras e traduzido', () => {
    falsos();
    window.t = () => 'leituras';
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 10, total: 1000, reads: 1 });
    vi.advanceTimersByTime(1000);
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 20, total: 1000, reads: 2 });
    expect(barra().querySelector('.hw-progress-meta').textContent).toBe('20/1000 · 2 leituras · ~1m 38s left');
    vi.advanceTimersByTime(1000);
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 520, total: 1000 });
    expect(barra().querySelector('.hw-progress-meta').textContent).toBe('520/1000 · ~2s left');
  });

  it('terminado: fica verde, diz done e sai sozinho depois de alguns segundos', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 100, total: 100, done: true });
    expect(barra().classList.contains('done')).toBe(true);
    expect(barra().querySelector('.hw-progress-meta').textContent).toBe('100/100 · done');
    vi.advanceTimersByTime(3200);
    expect(barra().classList.contains('hiding')).toBe(true);
    vi.advanceTimersByTime(420);
    expect(barra()).toBeNull();
    expect(tm.updatableCards.thtest.hwProgress).toBeNull();
  });

  it('uma corrida nova sobre a barra que ainda nao saiu recomeca do zero', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 100, total: 100, done: true });
    vi.advanceTimersByTime(1000);
    tm.renderHardwareProgress('thtest', { label: 'y', cyc: 5, total: 100 });
    expect(barra().classList.contains('done')).toBe(false);
    expect(barra().classList.contains('hiding')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(barra()).not.toBeNull();
    expect(barra().querySelector('.hw-progress-pct').textContent).toBe('5%');
  });

  it('a barra nunca anda para tras dentro de uma corrida', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 50, total: 100 });
    vi.advanceTimersByTime(2000);
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 48, total: 100 });
    vi.advanceTimersByTime(2000);
    expect(barra().querySelector('.hw-progress-pct').textContent).toBe('50%');
  });

  it('depois do Cancelar, os pedacos atrasados nao remontam a barra', () => {
    window.isCompilationCanceled = () => true;
    tm.renderHardwareProgress('thtest', { label: 'x', pct: 10 });
    expect(barra()).toBeNull();
    delete window.isCompilationCanceled;
    tm.renderHardwareProgress('xyz', { label: 'x', pct: 10 });
  });

  it('o Cancelar derruba toda barra da tela, ate a de outra instancia', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 100, total: 100, done: true });
    const alheia = document.createElement('div');
    alheia.className = 'hw-progress';
    corpo('tcmm').appendChild(alheia);
    tm.updatableCards.tcmm = null;
    tm.clearHardwareProgress();
    expect(document.querySelectorAll('.hw-progress')).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    tm.clearHardwareProgress();
  });

  it('o Cancelar no meio da animacao para o quadro pendente', () => {
    falsos();
    tm.renderHardwareProgress('thtest', { label: 'x', cyc: 10, total: 100 });
    expect(tm.updatableCards.thtest.hwProgress._raf).toBeTruthy();
    tm.clearHardwareProgress();
    expect(barra()).toBeNull();
  });

  it('tempo que falta em segundos, minutos, ou minutos e segundos', () => {
    expect(tm._fmtEta(-5)).toBe('0s');
    expect(tm._fmtEta(59000)).toBe('59s');
    expect(tm._fmtEta(120000)).toBe('2m');
    expect(tm._fmtEta(125000)).toBe('2m 5s');
  });
});

// ────────────────────────────────────────────────────────── link de pasta
describe('link de pasta', () => {
  it('o trecho da pasta vira link que revela a pasta na arvore', () => {
    window.standardTreeRenderer = { revealFolder: vi.fn() };
    tm.appendFolderLink('thtest', 'Resultado em C:/p/out, veja', 'C:/p/out');
    const e = entradas('thtest')[0];
    expect(e.className).toBe('log-entry success');
    const link = e.querySelector('.folder-link');
    expect(link.textContent).toBe('C:/p/out');
    expect(link.title).toBe('Open in folder view');
    expect(e.querySelector('.message-content').textContent).toBe('Resultado em C:/p/out, veja');
    link.click();
    expect(window.standardTreeRenderer.revealFolder).toHaveBeenCalledWith('C:/p/out');
    expect(tm.messageCounts.thtest.success).toBe(1);
  });

  it('sem a pasta no texto, e texto simples; o balao e traduzido; terminal ausente, nada', () => {
    window.t = () => 'Abrir na visao de pastas';
    tm.appendFolderLink('thtest', 'sem pasta', 'C:/x', 'info');
    expect(entradas('thtest')[0].querySelector('.folder-link')).toBeNull();
    tm.appendFolderLink('thtest', 'em C:/x', 'C:/x');
    expect(entradas('thtest')[1].querySelector('.folder-link').title).toBe('Abrir na visao de pastas');
    tm.appendFolderLink('xyz', 'x', 'x');
  });
});

// ──────────────────────────────────────────────────────────── exportar log
describe('exportar o log', () => {
  beforeEach(() => {
    corpo('tcmm').innerHTML = `
      <div class="log-entry error"><span class="timestamp">[t1]</span>
        <div class="message-content"><div class="grouped-message">Erro:  um</div><div class="grouped-message">dois</div></div></div>
      <div class="log-entry warning"><span class="timestamp">[t2]</span><div class="message-content">aviso</div></div>`;
    corpo('tasm').innerHTML = `
      <div class="log-entry success">ok sem conteudo</div>
      <div class="log-entry info"><span class="timestamp">[t3]</span>info solta</div>
      <div class="log-entry tips"><div class="message-content">dica</div></div>
      <div class="log-entry plain"><div class="message-content">cru</div></div>`;
  });

  it('o botao exporta todos os terminais num arquivo, com cabecalho e uma secao por terminal', async () => {
    api.showSaveDialog = vi.fn(async () => ({ filePath: 'C:\\logs\\saida.txt' }));
    api.writeFile = vi.fn(async () => true);
    document.getElementById('export-log').click();
    await vi.waitFor(() => expect(api.writeFile).toHaveBeenCalled());
    const [caminho, texto] = api.writeFile.mock.calls[0];
    expect(caminho).toBe('C:\\logs\\saida.txt');
    expect(api.showSaveDialog.mock.calls[0][0].defaultPath).toMatch(/^aurora-log-all-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.txt$/);
    expect(texto).toContain('# Terminals with content: tcmm, tasm\n# Total entries: 6');
    expect(texto).toContain('===== TCMM =====\n[t1] [ERROR] Erro: um\n[t1] [ERROR] dois\n[t2] [WARN ] aviso\n');
    expect(texto).toContain('===== TASM =====\n [OK   ] ok sem conteudo\n[t3] [INFO ] info solta\n [TIP  ] dica\n [     ] cru\n');
    expect(texto).toContain('===== TVERI =====\n(empty)\n');
    expect(showCardNotification).toHaveBeenCalledWith('Exported 6 entries from 2 terminal(s) to saida.txt.', 'success', 4500, 'Export complete');
  });

  it('gravar que devolve {success} ou nada tambem e sucesso; o titulo e traduzido', async () => {
    window.t = (k) => (k === 'terminal.exportAllTitle' ? 'Exportar' : k);
    api.showSaveDialog = vi.fn(async () => ({ filePath: '/l/a.log' }));
    api.writeFile = vi.fn(async () => ({ success: true }));
    await tm.exportCurrentLog();
    expect(api.showSaveDialog.mock.calls[0][0].title).toBe('Exportar');
    api.writeFile = vi.fn(async () => undefined);
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenCalledTimes(2);
  });

  it('tudo vazio avisa e nao abre dialogo; terminal ausente e ignorado', async () => {
    for (const id of IDS) corpo(id).innerHTML = '';
    tm.terminals.tcmd = null;
    api.showSaveDialog = vi.fn();
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenCalledWith('All terminals are empty — nothing to export.', 'info', 3500);
    expect(api.showSaveDialog).not.toHaveBeenCalled();
  });

  it('sem a ponte de salvar, cancelado, falha ao gravar ou erro: cada um com o seu aviso', async () => {
    api.showSaveDialog = undefined;
    api.writeFile = undefined;
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Export not available in this build.', 'error', 4000);
    api.showSaveDialog = vi.fn(async () => ({ canceled: true }));
    api.writeFile = vi.fn();
    await tm.exportCurrentLog();
    expect(api.writeFile).not.toHaveBeenCalled();
    api.showSaveDialog = vi.fn(async () => ({ filePath: 'a.txt' }));
    api.writeFile = vi.fn(async () => ({ success: false, error: 'disco cheio' }));
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not export the log: disco cheio', 'error', 5000);
    api.writeFile = vi.fn(async () => ({ message: 'negado' }));
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not export the log: negado', 'error', 5000);
    api.writeFile = vi.fn(async () => false);
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not export the log: Write failed.', 'error', 5000);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.writeFile = vi.fn(async () => { throw new Error('ipc'); });
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not export the log: ipc', 'error', 5000);
    api.writeFile = vi.fn(async () => { throw 'cru'; });
    await tm.exportCurrentLog();
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not export the log: cru', 'error', 5000);
  });
});

// ─────────────────────────────────────────────────────────────── limpar
describe('limpar', () => {
  it('limpar some com as entradas, repoe as boas-vindas e zera o estado', async () => {
    falsos();
    tm.appendToTerminal('tcmm', 'Erro: x');
    tm.renderDumpSize('tcmm', { name: 'x', bytes: 1 });
    const p = tm.clearTerminal('tcmm');
    expect(corpo('tcmm').classList.contains('clearing')).toBe(true);
    vi.advanceTimersByTime(200);
    await p;
    expect(corpo('tcmm').classList.contains('clearing')).toBe(false);
    expect(corpo('tcmm').children).toHaveLength(1);
    expect(corpo('tcmm').firstElementChild.textContent).toBe('Welcome to the terminal TCMM!');
    expect(corpo('tcmm').firstElementChild.getAttribute('data-i18n')).toBe('terminalWelcome.tcmm');
    expect(tm.updatableCards.tcmm).toEqual({});
    expect(tm.messageCounts.tcmm).toEqual({ error: 0, warning: 0, success: 0, tips: 0 });
  });

  it('o que chega durante a limpeza espera e aparece depois dela', async () => {
    falsos();
    tm.appendToTerminal('tcmm', 'Erro: velho');
    const p = tm.clearTerminal('tcmm');
    tm.appendToTerminal('tcmm', 'Erro: novo');
    // Uma segunda limpeza no meio da primeira nao faz nada.
    await tm.clearTerminal('tcmm');
    vi.advanceTimersByTime(200);
    await p;
    expect(entradas('tcmm').map((e) => e.textContent)).toEqual([expect.stringContaining('Erro: novo')]);
  });

  it('terminal sem saida, ou que nao existe, nao anima; o TCMD limpa como um shell', async () => {
    window.shellTerminal = { limpar: vi.fn() };
    await tm.clearTerminal('tcmm');
    expect(corpo('tcmm').classList.contains('clearing')).toBe(false);
    await tm.clearTerminal('xyz');
    await tm.clearTerminal('tcmd');
    tm.clearTerminalImmediate('tcmd');
    expect(window.shellTerminal.limpar).toHaveBeenCalledTimes(2);
  });

  it('a boas-vindas traduzida, e nao repetida', () => {
    window.t = (k) => (k === 'terminalWelcome.tasm' ? 'Bem-vindo ao TASM' : k);
    tm.clearTerminalImmediate('tasm');
    tm._porBoasVindas(corpo('tasm'), 'tasm');
    expect(corpo('tasm').querySelectorAll('.terminal-welcome')).toHaveLength(1);
    expect(corpo('tasm').textContent).toBe('Bem-vindo ao TASM');
  });

  it('limpar na hora nao anima, tira o apagado e zera o estado; todos de uma vez', () => {
    tm.appendToTerminal('tasm', 'Erro: x');
    corpo('tasm').classList.add('faded-out');
    tm.clearTerminalImmediate('tasm');
    expect(corpo('tasm').classList.contains('faded-out')).toBe(false);
    expect(entradas('tasm')).toHaveLength(0);
    tm.appendToTerminal('tveri', 'Erro: y');
    tm.clearAllTerminalsImmediate();
    expect(entradas('tveri')).toHaveLength(0);
    tm.clearTerminalImmediate('xyz');
  });

  it('o botao limpa a aba ativa e mostra a pilula de confirmacao', async () => {
    falsos();
    tm.appendToTerminal('tcmm', 'Erro: x');
    document.getElementById('clear-terminal').dispatchEvent(new MouseEvent('click', { button: 0 }));
    vi.advanceTimersByTime(200);
    await vi.waitFor(() => expect(document.querySelector('#terminal-tcmm > .terminal-cleared-pill')).not.toBeNull());
    const pill = document.querySelector('#terminal-tcmm > .terminal-cleared-pill');
    expect(pill.textContent).toBe('Terminal cleared');
    vi.advanceTimersByTime(20);
    expect(pill.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1100 + 250);
    expect(pill.isConnected).toBe(false);
  });

  it('botao direito alterna entre limpar a aba e limpar todos, com icone e balao', async () => {
    const btn = document.getElementById('clear-terminal');
    const clear = vi.spyOn(tm, 'clearTerminal');
    btn.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
    expect(btn.querySelector('i').className).toBe('ph ph-broom');
    expect(btn.getAttribute('data-tooltip')).toBe('Clear all terminals (right-click: current only)');
    btn.dispatchEvent(new MouseEvent('click', { button: 0 }));
    await vi.waitFor(() => expect(document.querySelectorAll('.terminal-cleared-pill').length).toBe(IDS.length));
    expect(clear).toHaveBeenCalledTimes(IDS.length);
    expect(document.querySelector('.terminal-cleared-pill').textContent).toBe('Terminals cleared');
    btn.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
    expect(btn.querySelector('i').className).toBe('ph ph-trash');
    expect(btn.getAttribute('data-tooltip')).toBe('Clear current terminal tab (right-click: all)');
    btn.querySelector('i').remove();
    tm.changeClearIcon(btn);
    expect(tm.clearMode).toBe('all');
  });

  it('outro botao do mouse nao limpa; sem aba ativa, limpa o primeiro terminal; pilula traduzida', async () => {
    const clear = vi.spyOn(tm, 'clearTerminal');
    const btn = document.getElementById('clear-terminal');
    btn.dispatchEvent(new MouseEvent('click', { button: 1 }));
    expect(clear).not.toHaveBeenCalled();
    document.querySelector('.tab.active').classList.remove('active');
    window.t = (k) => (k === 'terminal.cleared' ? 'Terminal limpo' : k);
    btn.dispatchEvent(new MouseEvent('click', { button: 0 }));
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith('tcmm'));
    await vi.waitFor(() => expect(document.querySelector('#terminal-tcmm > .terminal-cleared-pill')?.textContent).toBe('Terminal limpo'));
  });

  it('a pilula troca a anterior; sem o conteiner, nao aparece', () => {
    tm._flashCleared('tasm');
    tm._flashCleared('tasm', 'de novo');
    expect(document.querySelectorAll('#terminal-tasm > .terminal-cleared-pill')).toHaveLength(1);
    tm._flashCleared('xyz');
  });

  it('sem os botoes de limpar e exportar, a montagem segue', () => {
    document.getElementById('clear-terminal').remove();
    document.getElementById('export-log').remove();
    TerminalManager.clearButtonInitialized = false;
    TerminalManager.exportLogButtonInitialized = false;
    expect(() => new TerminalManager()).not.toThrow();
  });
});
