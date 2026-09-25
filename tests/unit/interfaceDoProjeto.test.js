// @vitest-environment happy-dom
//
// O que a janela mostra do projeto aberto (js/project/interface_do_projeto):
// o nome na arvore, o indicador da barra, os botoes e o dialogo.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const barra = { cmm: vi.fn(), toolbar: vi.fn(async () => {}) };
vi.mock('../../js/compilation/botoes_da_barra.js', () => ({
  syncCmmcompEnabled: () => barra.cmm(),
  syncToolbarEnabledState: () => barra.toolbar(),
}));

let ui;
let ProjectStore;
const $ = (id) => document.getElementById(id);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  delete window.t;
  document.body.innerHTML = `
    <span id="current-spf-name" data-i18n="fileTree.noProject">No project open</span>
    <div id="ready" class="fading"><i class="ph ph-plugs"></i><span id="status-text" data-i18n="statusBar.notReady">x</span></div>
    <button id="openProjectBtn"></button>
    ${['allcomp', 'fractalcomp', 'backupFolderBtn', 'projectInfo'].map((id) => `<button id="${id}" disabled></button>`).join('')}`;
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ui = await import('../../js/project/interface_do_projeto.js');
});

describe('nome do projeto na arvore', () => {
  it('o do .spf, senao o nome do arquivo, e sem projeto a etiqueta traduzida', () => {
    ui.mostrarNomeDoProjeto({ metadata: { projectName: 'Filtro' } }, 'C:\\p\\p.spf');
    expect($('current-spf-name').textContent).toBe('Filtro.spf');
    expect($('current-spf-name').hasAttribute('data-i18n')).toBe(false);
    ui.mostrarNomeDoProjeto({}, 'C:\\p\\outro.spf');
    expect($('current-spf-name').textContent).toBe('outro.spf');
    ui.mostrarNomeDoProjeto(null, 'C:\\p\\semext');
    expect($('current-spf-name').textContent).toBe('semext.spf');
    window.t = (k) => (k === 'fileTree.noProject' ? 'Nenhum projeto' : k);
    ui.mostrarNomeDoProjeto(null, '  ');
    expect($('current-spf-name').textContent).toBe('Nenhum projeto');
    expect($('current-spf-name').getAttribute('data-i18n')).toBe('fileTree.noProject');
    delete window.t;
    ui.mostrarNomeDoProjeto(null, null);
    expect($('current-spf-name').textContent).toBe('No project open');
  });

  it('sem o elemento na pagina, nada', () => {
    document.body.innerHTML = '';
    expect(() => ui.mostrarNomeDoProjeto(null, 'a.spf')).not.toThrow();
  });
});

describe('botoes e indicador', () => {
  it('liga os botoes, re-sincroniza a barra e o indicador mostra o projeto em verde', () => {
    ProjectStore.setProject('C:\\p\\Filtro.spf', 'C:\\p');
    ui.habilitarBotoesDoProjeto();
    for (const id of ['allcomp', 'fractalcomp', 'backupFolderBtn', 'projectInfo']) expect($(id).disabled).toBe(false);
    expect(barra.cmm).toHaveBeenCalled();
    expect(barra.toolbar).toHaveBeenCalled();
    expect($('ready').classList.contains('is-ready')).toBe(true);
    expect($('ready').classList.contains('fading')).toBe(false);
    expect($('ready').querySelector('i').className).toBe('ph ph-plugs-connected');
    expect($('status-text').textContent).toBe('Filtro');
    expect($('ready').getAttribute('data-tooltip')).toBe('C:\\p\\Filtro.spf');
  });

  it('sem .spf, o rotulo cai no texto de sem projeto e o balao sai', () => {
    $('ready').setAttribute('data-tooltip', 'velho');
    ui.habilitarBotoesDoProjeto();
    expect($('status-text').textContent).toBe('No project');
    expect($('ready').hasAttribute('data-tooltip')).toBe(false);
    window.t = (k) => (k === 'statusBar.notReady' ? 'Sem projeto' : k);
    ui.habilitarBotoesDoProjeto();
    expect($('status-text').textContent).toBe('Sem projeto');
  });

  it('sem indicador, sem icone ou sem texto na pagina, liga o que houver', () => {
    $('ready').querySelector('i').remove();
    $('status-text').remove();
    expect(() => ui.habilitarBotoesDoProjeto()).not.toThrow();
    $('ready').remove();
    $('allcomp').remove();
    expect(() => ui.habilitarBotoesDoProjeto()).not.toThrow();
  });

  it('clicar no indicador sem projeto abre o seletor; com projeto, nao', () => {
    const abrir = vi.fn();
    $('openProjectBtn').addEventListener('click', abrir);
    ui.ligarIndicadorDeProjeto();
    expect($('ready').style.cursor).toBe('pointer');
    $('ready').click();
    expect(abrir).toHaveBeenCalledTimes(1);
    $('ready').classList.add('is-ready');
    $('ready').click();
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it('sem indicador ou sem o botao de abrir, nao liga nada', () => {
    $('openProjectBtn').remove();
    ui.ligarIndicadorDeProjeto();
    expect($('ready').style.cursor).toBe('');
  });
});

describe('dialogo de informacoes', () => {
  it('mostra o que o .spf diz, escapado, e fecha pelo X ou pelo fundo', () => {
    ui.mostrarInformacaoDoProjeto({ metadata: { projectName: '<b>x</b>', computerName: 'LAB-1', appVersion: '1.2', createdAt: 0 } });
    const corpo = document.querySelector('.aurora-modal-body');
    expect(corpo.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(corpo.querySelector('b')).toBeNull();
    expect(corpo.textContent).toContain('LAB-1');
    document.querySelector('.aurora-modal-close').click();
    expect(document.querySelector('.aurora-modal-container')).toBeNull();
    ui.mostrarInformacaoDoProjeto({});
    document.querySelector('.aurora-modal-backdrop').click();
    expect(document.querySelector('.aurora-modal-backdrop')).toBeNull();
  });
});
