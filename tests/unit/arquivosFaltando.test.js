// O relatorio dos arquivos que sumiram do disco (js/project/arquivos_faltando):
// o texto, abrir como previa, e apagar quando nao falta mais nada.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const disco = new Map();
const electronAPI = {
  joinPath: vi.fn(async (...p) => p.join('\\')),
  writeFile: vi.fn(async (p, c) => { disco.set(p, c); }),
  fileExists: vi.fn(async (p) => disco.has(p)),
  deleteFile: vi.fn(async (p) => { disco.delete(p); }),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const TabManager = { tabs: new Map(), addTab: vi.fn(), closeTab: vi.fn(async () => {}) };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));

const m = await import('../../js/project/arquivos_faltando.js');
const LOG = 'C:\\p\\.aurora-missing-files.log';

beforeEach(() => {
  vi.clearAllMocks();
  disco.clear();
  TabManager.tabs = new Map();
});

const faltando = [
  { name: 'a.v', path: 'C:\\p\\a.v', category: 'synthesizable' },
  { name: 'tb.v', path: 'C:\\p\\tb.v', category: 'testbench' },
  { name: 'b.v', path: 'C:\\p\\b.v', category: 'synthesizable' },
  { name: 'x', path: 'C:\\p\\x' },
];

describe('relatorioDeFaltantes', () => {
  it('cabecalho com o projeto e a raiz, e a lista agrupada por categoria', () => {
    const t = m.relatorioDeFaltantes(faltando, 'C:\\p\\p.spf', 'C:\\p', '25/09 10:00');
    expect(t).toContain('Gerado em: 25/09 10:00');
    expect(t).toContain('Projeto:   p.spf');
    expect(t).toContain('Base path: C:\\p');
    const lista = t.slice(t.indexOf('[synthesizable]'));
    expect(lista).toBe([
      '[synthesizable] (2)', '  - a.v', '      C:\\p\\a.v', '  - b.v', '      C:\\p\\b.v', '',
      '[testbench] (1)', '  - tb.v', '      C:\\p\\tb.v', '',
      '[unknown] (1)', '  - x', '      C:\\p\\x', '',
    ].join('\n'));
  });

  it('sem .spf, o projeto sai como desconhecido', () => {
    expect(m.relatorioDeFaltantes([], null, 'C:\\p', 'agora')).toContain('Projeto:   (unknown)');
  });
});

describe('abrir e apagar', () => {
  it('abrir escreve na raiz e abre como aba de previa', async () => {
    await m.abrirRelatorioDeFaltantes(faltando, 'C:\\p\\p.spf', 'C:\\p');
    expect(disco.get(LOG)).toContain('[testbench] (1)');
    expect(TabManager.addTab).toHaveBeenCalledWith(LOG, disco.get(LOG), { preview: true });
  });

  it('abrir sem faltantes ou sem raiz nao faz nada', async () => {
    await m.abrirRelatorioDeFaltantes([], 'x', 'C:\\p');
    await m.abrirRelatorioDeFaltantes(null, 'x', 'C:\\p');
    await m.abrirRelatorioDeFaltantes(faltando, 'x', null);
    expect(electronAPI.writeFile).not.toHaveBeenCalled();
  });

  it('apagar fecha a aba e tira do disco; sem o arquivo, ou sem raiz, nao faz nada', async () => {
    disco.set(LOG, 'velho');
    TabManager.tabs.set(LOG, {});
    await m.apagarRelatorioDeFaltantes('C:\\p');
    expect(TabManager.closeTab).toHaveBeenCalledWith(LOG);
    expect(disco.has(LOG)).toBe(false);
    await m.apagarRelatorioDeFaltantes('C:\\p');
    await m.apagarRelatorioDeFaltantes(null);
    expect(electronAPI.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('apagar segue mesmo se fechar a aba falhar, e sem o canal de apagar so fecha', async () => {
    disco.set(LOG, 'velho');
    TabManager.tabs.set(LOG, {});
    TabManager.closeTab.mockRejectedValueOnce(new Error('x'));
    await m.apagarRelatorioDeFaltantes('C:\\p');
    expect(disco.has(LOG)).toBe(false);
    disco.set(LOG, 'velho');
    const canal = electronAPI.deleteFile;
    delete electronAPI.deleteFile;
    await m.apagarRelatorioDeFaltantes('C:\\p');
    expect(disco.has(LOG)).toBe(true);
    electronAPI.deleteFile = canal;
  });
});
