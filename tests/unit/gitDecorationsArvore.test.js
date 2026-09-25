// @vitest-environment happy-dom
//
// A classe GitDecorations (js/tree/git_decorations): pinta na arvore o estado
// do git do projeto que o ProjectStore diz estar aberto. As funcoes puras ja
// tem o gitDecorations.test.js; aqui e a parte com DOM, gitAPI e relogio.

import { describe, it, expect, afterEach, vi } from 'vitest';

function montarArvore() {
  document.body.innerHTML = `
    <div id="file-tree">
      <div class="file-tree-item" data-path="C:/p/src">
        <div class="file-item"><span class="file-item-name">src</span></div>
        <div class="folder-content"></div>
      </div>
      <div class="file-tree-item" data-path="C:/p/src/a.v">
        <div class="file-item"><span class="file-item-name">a.v</span></div>
      </div>
      <div class="file-tree-item" data-path="C:/p/b.v">
        <div class="file-item"><span class="file-item-name">b.v</span></div>
      </div>
      <div class="file-tree-item" data-path="C:/p/build/x.o">
        <div class="file-item"><span class="file-item-name">x.o</span></div>
      </div>
      <div class="file-tree-item" data-path="C:/p/limpo.v">
        <div class="file-item"><span class="file-item-name">limpo.v</span></div>
      </div>
      <div class="file-tree-item" data-path="C:/p/semlinha"></div>
      <div class="verilog-file-item" data-file-path="C:/p/src/a.v">
        <div class="verilog-file-content"><span class="verilog-file-name">a.v</span></div>
      </div>
    </div>`;
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

async function carregar({ projeto = 'C:/p', gitAPI, t } = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  montarArvore();
  for (const k of ['gitAPI', 'gitDecorations', 't', 'ProjectStore', 'currentProjectPath', 'currentSpfPath']) delete window[k];
  if (gitAPI) window.gitAPI = gitAPI;
  if (t) window.t = t;
  const { ProjectStore } = await import('../../js/project/project_store.js');
  if (projeto) ProjectStore.setProject(`${projeto}/p.spf`, projeto);
  // Cada caso carrega uma instancia nova; os ouvintes das anteriores saem no
  // afterEach, senao elas tambem respondem ao evento e contam em dobro.
  for (const alvo of [window, document]) {
    const orig = alvo.addEventListener.bind(alvo);
    vi.spyOn(alvo, 'addEventListener').mockImplementation((tipo, fn, o) => {
      ouvintes.push([alvo, tipo, fn]);
      return orig(tipo, fn, o);
    });
  }
  await import('../../js/tree/git_decorations.js');
  await flush();
  return { deco: window.gitDecorations, ProjectStore };
}

const linha = (p) => document.querySelector(`.file-tree-item[data-path="${p}"] > .file-item`);
const selo = (p) => linha(p)?.querySelector(':scope > .git-deco');

function gitComMudancas(extra = {}) {
  return {
    status: vi.fn(async () => ({
      ok: true,
      isRepo: true,
      files: [
        { path: 'src/a.v', working: 'M', index: ' ' },
        { path: 'b.v', working: 'D', index: ' ' },
      ],
    })),
    ignored: vi.fn(async () => ({ ok: true, isRepo: true, paths: ['build/'] })),
    ...extra,
  };
}

const ouvintes = [];

afterEach(() => {
  for (const [alvo, tipo, fn] of ouvintes.splice(0)) alvo.removeEventListener(tipo, fn);
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('GitDecorations na arvore', () => {
  it('pinta letra no arquivo, ponto na pasta e apaga o ignorado, nas duas vistas', async () => {
    await carregar({ gitAPI: gitComMudancas() });
    expect(selo('C:/p/src/a.v').textContent).toBe('M');
    expect(selo('C:/p/src/a.v').title).toBe('modificado');
    expect(linha('C:/p/src/a.v').querySelector('.file-item-name').classList.contains('git-st-modified')).toBe(true);
    expect(selo('C:/p/src').textContent).toBe('•');
    expect(selo('C:/p/src').hasAttribute('title')).toBe(false);
    expect(linha('C:/p/b.v').querySelector('.file-item-name').classList.contains('git-st-deleted')).toBe(true);
    expect(linha('C:/p/build/x.o').classList.contains('git-ignored-muted')).toBe(true);
    expect(selo('C:/p/limpo.v')).toBeNull();
    const verilog = document.querySelector('.verilog-file-content > .git-deco');
    expect(verilog.textContent).toBe('M');
  });

  it('o titulo do selo vem da traducao quando ela existe', async () => {
    await carregar({ gitAPI: gitComMudancas(), t: (k) => (k === 'git.status.modified' ? 'modified' : k) });
    expect(selo('C:/p/src/a.v').title).toBe('modified');
    expect(selo('C:/p/b.v').title).toBe('deletado');
  });

  it('sem projeto aberto nao pergunta ao git e nao pinta', async () => {
    const git = gitComMudancas();
    await carregar({ projeto: null, gitAPI: git });
    expect(git.status).not.toHaveBeenCalled();
    expect(document.querySelector('.git-deco')).toBeNull();
  });

  it('sem gitAPI nao pinta', async () => {
    await carregar({ gitAPI: undefined });
    expect(document.querySelector('.git-deco')).toBeNull();
  });

  it('projeto que nao e repositorio limpa o que estava pintado', async () => {
    const git = gitComMudancas();
    const { deco } = await carregar({ gitAPI: git });
    expect(selo('C:/p/src/a.v')).not.toBeNull();
    git.status.mockResolvedValue({ ok: true, isRepo: false, files: [] });
    await deco.refresh();
    expect(document.querySelector('.git-deco')).toBeNull();
    expect(linha('C:/p/build/x.o').classList.contains('git-ignored-muted')).toBe(false);
  });

  it('status que lanca conta como sem repositorio', async () => {
    await carregar({ gitAPI: gitComMudancas({ status: vi.fn(async () => { throw new Error('x'); }) }) });
    expect(document.querySelector('.git-deco')).toBeNull();
  });

  it('ignored que falha so deixa de apagar', async () => {
    await carregar({ gitAPI: gitComMudancas({ ignored: vi.fn(async () => { throw new Error('x'); }) }) });
    expect(selo('C:/p/src/a.v').textContent).toBe('M');
    expect(linha('C:/p/build/x.o').classList.contains('git-ignored-muted')).toBe(false);
  });

  it('preload sem o canal ignored tambem so deixa de apagar', async () => {
    await carregar({ gitAPI: gitComMudancas({ ignored: undefined }) });
    expect(selo('C:/p/src/a.v').textContent).toBe('M');
    expect(linha('C:/p/build/x.o').classList.contains('git-ignored-muted')).toBe(false);
  });

  it('salvar arquivo agenda um refresh, e o relogio lento tambem refaz', async () => {
    const git = gitComMudancas();
    await carregar({ gitAPI: git });
    const antes = git.status.mock.calls.length;
    window.dispatchEvent(new Event('aurora:file-saved'));
    await vi.advanceTimersByTimeAsync(400);
    expect(git.status.mock.calls.length).toBe(antes + 1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(git.status.mock.calls.length).toBeGreaterThan(antes + 1);
  });

  it('a arvore redesenhada volta a ganhar os selos sem perguntar ao git', async () => {
    const git = gitComMudancas();
    await carregar({ gitAPI: git });
    const chamadas = git.status.mock.calls.length;
    const nova = document.createElement('div');
    nova.className = 'file-tree-item';
    nova.setAttribute('data-path', 'C:/p/src/a.v');
    nova.innerHTML = '<div class="file-item"><span class="file-item-name">a.v</span></div>';
    document.getElementById('file-tree').appendChild(nova);
    await vi.advanceTimersByTimeAsync(100);
    expect(nova.querySelector('.git-deco')?.textContent).toBe('M');
    expect(git.status.mock.calls.length).toBe(chamadas);
  });

  it('start e idempotente e apply sem arvore nao quebra', async () => {
    const git = gitComMudancas();
    const { deco } = await carregar({ gitAPI: git });
    const chamadas = git.status.mock.calls.length;
    deco.start();
    expect(git.status.mock.calls.length).toBe(chamadas);
    document.body.innerHTML = '';
    expect(() => deco.apply()).not.toThrow();
  });

  it('limpar sem nada pintado so reaplica', async () => {
    const { deco } = await carregar({ projeto: null, gitAPI: gitComMudancas() });
    const spy = vi.spyOn(deco, 'apply');
    await deco.refresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
