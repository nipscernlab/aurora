// @vitest-environment happy-dom
//
// Duas pecas da arvore de arquivos sem teste na parte de execucao: o
// carregamento do manifesto de icones (js/tree/material_icons) e o controlador
// das tres vistas (js/tree/tree_view).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('material_icons em execucao', () => {
  const MANIFESTO = {
    iconDefinitions: { 'folder-test': { iconPath: './../icons/folder-test.svg' } },
    folderNames: { test: 'folder-test' },
    fileExtensions: {},
    fileNames: {},
  };

  async function carregar(resposta) {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(resposta));
    return import('../../js/tree/material_icons.js');
  }

  it('antes do manifesto, os icones padrao; depois, os do manifesto; e carrega uma vez so', async () => {
    const m = await carregar(async () => ({ ok: true, json: async () => MANIFESTO }));
    expect(m.iconUrlForFolder('test')).toMatch(/folder\.svg$/);
    expect(m.iconUrlForFolder('test', { open: true })).toMatch(/folder-open\.svg$/);
    expect(m.iconUrlForFile('a.v')).toMatch(/file\.svg$/);
    const [a, b] = await Promise.all([m.ensureManifest(), m.ready()]);
    expect(a).toBe(MANIFESTO);
    expect(b).toBe(MANIFESTO);
    expect(await m.ensureManifest()).toBe(MANIFESTO);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(m.iconUrlForFolder('test')).toMatch(/folder-test\.svg$/);
    expect(m.iconUrlForFile('a.v')).toMatch(/verilog\.svg$/);
  });

  it('manifesto que nao carrega deixa os icones padrao e so avisa', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await carregar(async () => ({ ok: false, status: 404 }));
    expect(await m.ensureManifest()).toBeNull();
    expect(m.iconUrlForFile('a.v')).toMatch(/file\.svg$/);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('tree_view', () => {
  let tv;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    ({ treeView: tv } = await import('../../js/tree/tree_view.js'));
  });

  it('sem #file-tree na pagina, nada se inicializa e as consultas voltam vazias', () => {
    expect(tv.initialize()).toBe(false);
    expect(tv.getContainer('standard')).toBeNull();
    expect(tv.getActive()).toBeNull();
    expect(() => tv.setActive('standard')).not.toThrow();
    expect(() => tv.clearAll()).not.toThrow();
  });

  it('cria as tres vistas uma vez, comeca na verilog, e troca e limpa', () => {
    document.body.innerHTML = '<div id="file-tree"></div>';
    expect(tv.getContainer('standard')).not.toBeNull();
    expect(tv.initialize()).toBe(true);
    expect(document.querySelectorAll('#file-tree > .tree-view')).toHaveLength(3);
    expect(tv.getActive()).toBe('verilog');
    tv.setActive('hierarchy');
    expect(document.getElementById('file-tree').dataset.activeView).toBe('hierarchy');
    tv.getContainer('standard').innerHTML = '<p>x</p>';
    tv.getContainer('verilog').innerHTML = '<p>y</p>';
    tv.clear('standard');
    expect(tv.getContainer('standard').innerHTML).toBe('');
    tv.clearAll();
    expect(tv.getContainer('verilog').innerHTML).toBe('');
  });

  it('a vista que ja vinha marcada fica; setActive e getActive inicializam sozinhos', async () => {
    document.body.innerHTML = '<div id="file-tree" data-active-view="standard"></div>';
    vi.resetModules();
    ({ treeView: tv } = await import('../../js/tree/tree_view.js'));
    tv.fileTree = null;
    expect(tv.getActive()).toBe('standard');
    tv.fileTree = null;
    tv.setActive('verilog');
    expect(tv.getActive()).toBe('verilog');
  });

  it('nome de vista desconhecido so avisa', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tv.getContainer('lado')).toBeNull();
    tv.setActive('lado');
    expect(aviso).toHaveBeenCalledTimes(2);
    aviso.mockRestore();
  });
});
