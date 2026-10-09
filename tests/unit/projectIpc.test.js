/**
 * main/ipc/project: o ciclo do projeto (abrir, fechar, criar, gravar o .spf,
 * mandar para a Lixeira, renomear) e o CRUD de processadores.
 *
 * Escrito como caracterizacao antes de o modulo virar .ts, contra o .js
 * antigo. Os projetos sao pastas de verdade numa pasta temporaria; o que o
 * modulo faz fora delas fica cercado antes de ele carregar:
 *
 *   1. o execFile e o process.kill ficam travados (tests/helpers/cercado.js):
 *      a Temp do projeto e escondida por um `attrib`;
 *   2. o Electron e falso, e o shell.trashItem so anota;
 *   3. os modulos que o projeto chama tarde, pelo require (recentes, lista de
 *      atalhos, servidor de linguagem e as sessoes do TCMD, que matam
 *      processo), entram falsos no cache do require nativo;
 *   4. o main/state e um objeto so para as duas copias do modulo (a do Vite e
 *      a do require), para o que o teste semeia ser o que o modulo le.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cercar, pastaTemporaria } from '../helpers/cercado.js';

const req = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = pastaTemporaria('aurora-projeto-');

const janela = vi.hoisted(() => ({ daJanela: null, focada: null }));
const lixeira = { trashItem: vi.fn(async () => {}) };
const app = {
  getPath: () => tmp.raiz,
  getVersion: () => '9.9.9',
  addRecentDocument: vi.fn(),
};
const c = cercar({
  processos: true,
  electron: {
    userData: tmp.raiz,
    extra: {
      app,
      shell: { trashItem: (p) => lixeira.trashItem(p) },
      BrowserWindow: {
        fromWebContents: () => janela.daJanela,
        getFocusedWindow: () => janela.focada,
      },
    },
  },
});
const handlers = c.electron.handlers;

const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
vi.mock('electron-log', () => ({ default: log, ...log }));
req.cache[req.resolve('electron-log')] = { id: 'electron-log', loaded: true, exports: log };

// Um state so, para as duas copias.
const state = req('../../main/state.js');
vi.doMock(path.join(RAIZ, 'main', 'state.js'), () => ({ default: state, ...state }));

/** Falso no cache do require nativo, pelo caminho absoluto. */
function falsoNoRequire(rel, exports) {
  const abs = path.join(RAIZ, rel);
  req.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
  vi.doMock(abs, () => ({ default: exports, ...exports }));
  return exports;
}
const recents = falsoNoRequire('main/recents.js', {
  push: vi.fn(), prune: vi.fn(() => ['a.spf']), remove: vi.fn(),
});
const windows = falsoNoRequire('main/windows.js', { rebuildJumpList: vi.fn() });
const slang = falsoNoRequire('main/lsp/slang_lsp.js', { stop: vi.fn() });
const shellIpc = falsoNoRequire('main/ipc/shell.js', { matarSessoesEm: vi.fn() });

const fse = req('fs-extra');
let mod;

beforeAll(async () => {
  mod = await import('../../main/ipc/project.js');
  (mod.register ?? mod.default.register)();
  await c.provar();
});

afterAll(() => {
  vi.restoreAllMocks();
  tmp.apagar();
});

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  state.projectPathsBySender.clear();
  state.activeDirectoryWatchers.clear();
  state.activeWatchers.clear();
  state.directoryStatsCache.clear();
  state.ultimoProjetoFechado.clear();
  state.mainWindows.clear();
  state.mainWindow = null;
  state.currentOpenProjectPath = null;
  janela.daJanela = null;
  janela.focada = null;
  recents.prune.mockImplementation(() => ['a.spf']);
  windows.rebuildJumpList.mockImplementation(() => {});
  lixeira.trashItem.mockImplementation(async () => {});
  n += 1;
});

// ---- ajudantes ----

/** Um remetente de IPC: guarda o que recebe. */
function remetente(id = 1) {
  const s = {
    id,
    enviados: [],
    destruido: false,
    send: (canal, dados) => { s.enviados.push([canal, dados]); },
    isDestroyed: () => s.destruido,
    once: () => {},
  };
  return s;
}
const evento = (sender = remetente()) => ({ sender });
const chamar = (canal, ev, ...args) => handlers.get(canal)(ev, ...args);

/** Um projeto em disco: <tmp>/<nome>/<nome>.spf, com o .spf que vier. */
function projeto(nome = `proj${n}`, spf = {}) {
  const raiz = path.join(tmp.raiz, `c${n}`, nome);
  fs.mkdirSync(raiz, { recursive: true });
  const arquivo = path.join(raiz, `${nome}.spf`);
  const doc = {
    metadata: { projectName: nome, projectPath: raiz },
    structure: { basePath: raiz, processors: [], folders: [], ...spf },
  };
  fs.writeFileSync(arquivo, JSON.stringify(doc, null, 2));
  return { raiz, spf: arquivo, nome };
}
const lerSpf = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));

/** Abre o projeto na janela do evento, como o project:open faria. */
function registrar(ev, spf) {
  state.projectPathsBySender.set(ev.sender.id, spf);
  state.currentOpenProjectPath = spf;
}

/** Um processador em disco, com os artefatos que o rename move. */
function processadorEmDisco(raiz, nome, fonte = `#PRNAME ${nome}\n`) {
  for (const sub of ['Software', 'Hardware', 'Simulation']) fs.mkdirSync(path.join(raiz, nome, sub), { recursive: true });
  fs.writeFileSync(path.join(raiz, nome, 'Software', `${nome}.cmm`), fonte);
  fs.writeFileSync(path.join(raiz, nome, 'Software', `${nome}.asm`), 'asm');
  fs.writeFileSync(path.join(raiz, nome, 'Hardware', `${nome}.v`), 'module x; endmodule');
  fs.writeFileSync(path.join(raiz, nome, 'Simulation', `${nome}_tb.v`), 'tb');
}

const errno = (code) => Object.assign(new Error(code), { code });

// ---- ProjectFile ----

describe('ProjectFile', () => {
  it('nasce com a raiz, o nome da pasta e a versao do app', () => {
    const raiz = path.join(tmp.raiz, 'novo');
    const j = new mod.ProjectFile(raiz).toJSON();
    expect(j.metadata).toMatchObject({ projectName: 'novo', projectPath: raiz, appVersion: '9.9.9' });
    expect(j.structure).toEqual({
      basePath: raiz, processors: [], folders: [], topLevelFile: '', testbenchFile: '',
      synthesizableFiles: [], testbenchFiles: [],
    });
  });

  it('fora do Electron a versao e 0.0.0, quando o getVersion falta ou lanca', () => {
    const original = app.getVersion;
    try {
      app.getVersion = undefined;
      expect(new mod.ProjectFile('x').metadata.appVersion).toBe('0.0.0');
      app.getVersion = () => { throw new Error('sem app'); };
      expect(new mod.ProjectFile('x').metadata.appVersion).toBe('0.0.0');
    } finally {
      app.getVersion = original;
    }
  });
});

// ---- project:getInfo ----

describe('project:getInfo', () => {
  it('le o .spf pelo caminho do arquivo ou pela pasta', async () => {
    const p = projeto();
    expect((await chamar('project:getInfo', evento(), p.spf)).metadata.projectName).toBe(p.nome);
    expect((await chamar('project:getInfo', evento(), p.raiz)).metadata.projectName).toBe(p.nome);
  });

  it('recusa sem caminho, caminho inexistente e pasta sem .spf', async () => {
    await expect(chamar('project:getInfo', evento(), '')).rejects.toThrow('No project file path provided');
    await expect(chamar('project:getInfo', evento(), path.join(tmp.raiz, 'nada.spf'))).rejects.toThrow(/Project file not found/);
    const vazia = path.join(tmp.raiz, `vazia${n}`);
    fs.mkdirSync(vazia);
    await expect(chamar('project:getInfo', evento(), vazia)).rejects.toThrow(/No .spf project file found/);
  });
});

// ---- project:createStructure ----

describe('project:createStructure', () => {
  it('cria a pasta e o .spf, lista o conteudo e poe nos recentes', async () => {
    const raiz = path.join(tmp.raiz, `cria${n}`, 'meu');
    const spf = path.join(raiz, 'meu.spf');
    const r = await chamar('project:createStructure', evento(), raiz, spf);

    expect(r).toMatchObject({ success: true, spfPath: spf, projectPath: raiz });
    expect(r.files).toEqual([{ name: 'meu.spf', isDirectory: false, path: spf }]);
    expect(lerSpf(spf).structure.basePath).toBe(raiz);
    expect(app.addRecentDocument).toHaveBeenCalledWith(spf);
    expect(recents.push).toHaveBeenCalledWith(spf);
    expect(windows.rebuildJumpList).toHaveBeenCalled();
  });

  it('falha da lista de atalhos nao derruba a criacao', async () => {
    windows.rebuildJumpList.mockImplementation(() => { throw new Error('jumplist'); });
    const raiz = path.join(tmp.raiz, `cria${n}`, 'meu');
    const r = await chamar('project:createStructure', evento(), raiz, path.join(raiz, 'meu.spf'));
    expect(r.success).toBe(true);
    expect(log.warn).toHaveBeenCalledWith('jumplist refresh (createStructure) failed:', expect.any(Error));
  });

  it('pasta ou .spf que nao aparece depois de gravar: lanca', async () => {
    vi.spyOn(fse, 'pathExists').mockResolvedValueOnce(false);
    const raiz = path.join(tmp.raiz, `cria${n}`, 'meu');
    await expect(chamar('project:createStructure', evento(), raiz, path.join(raiz, 'meu.spf')))
      .rejects.toThrow('Failed to create project structure or .spf file');
    expect(log.error).toHaveBeenCalled();
  });
});

// ---- escrita atomica do .spf (pelo project:write-spf) ----

describe('project:write-spf', () => {
  it('grava o .spf desta janela, com a raiz de agora', async () => {
    const p = projeto();
    const ev = evento();
    registrar(ev, p.spf);
    const doc = { metadata: { projectPath: 'C:/velho' }, structure: { basePath: 'C:/velho', processors: [{ name: 'a' }] } };

    expect(await chamar('project:write-spf', ev, p.spf, doc)).toEqual({ success: true });
    const lido = lerSpf(p.spf);
    expect(lido.metadata.projectPath).toBe(p.raiz);
    expect(lido.structure).toEqual({ basePath: p.raiz, processors: [{ name: 'a' }] });
    expect(fs.existsSync(`${p.spf}.tmp`)).toBe(false);
  });

  it('lista de processadores que so cresce: um processor:created por nome novo', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    const ev = evento();
    registrar(ev, p.spf);
    const doc = (procs) => ({ structure: { processors: procs } });

    await chamar('project:write-spf', ev, p.spf, doc([{ name: 'cpu' }, { name: 'dsp' }, 'mac', { semNome: 1 }]));
    expect(ev.sender.enviados).toEqual([
      ['processor:created', { processorName: 'dsp', projectPath: p.raiz }],
      ['processor:created', { processorName: 'mac', projectPath: p.raiz }],
    ]);

    // Mesma lista: nada a avisar (gravar a arvore nao mexe nos processadores).
    ev.sender.enviados.length = 0;
    await chamar('project:write-spf', ev, p.spf, doc(['cpu', 'dsp', 'mac']));
    expect(ev.sender.enviados).toEqual([]);
  });

  it('nome que sai ou troca: project:processors com a lista inteira', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }, { name: 'dsp' }] });
    const ev = evento();
    registrar(ev, p.spf);
    await chamar('project:write-spf', ev, p.spf, { structure: { processors: [{ name: 'alu' }, { name: 'dsp' }] } });
    await chamar('project:write-spf', ev, p.spf, { structure: { processors: [{ name: 'dsp' }] } });
    expect(ev.sender.enviados).toEqual([
      ['project:processors', { processors: ['alu', 'dsp'], projectPath: p.raiz }],
      ['project:processors', { processors: ['dsp'], projectPath: p.raiz }],
    ]);
  });

  it('.spf ilegivel antes conta como lista vazia; janela destruida nao recebe aviso', async () => {
    const p = projeto();
    fs.writeFileSync(p.spf, '{ quebrado');
    const ev = evento();
    registrar(ev, p.spf);
    await chamar('project:write-spf', ev, p.spf, { structure: { processors: ['cpu'] } });
    expect(ev.sender.enviados).toEqual([['processor:created', { processorName: 'cpu', projectPath: p.raiz }]]);

    ev.sender.enviados.length = 0;
    ev.sender.destruido = true;
    await chamar('project:write-spf', ev, p.spf, { structure: { processors: [] } });
    expect(ev.sender.enviados).toEqual([]);
  });

  it('documento sem metadata nem structure e gravado como veio', async () => {
    const p = projeto();
    const ev = evento();
    registrar(ev, p.spf);
    await chamar('project:write-spf', ev, p.spf, { outro: 1 });
    expect(lerSpf(p.spf)).toEqual({ outro: 1 });
  });

  it('o rename atomico falhando cai para a escrita direta e recolhe o .tmp', async () => {
    const p = projeto();
    const ev = evento();
    registrar(ev, p.spf);
    vi.spyOn(fse, 'rename').mockRejectedValueOnce(errno('EPERM'));
    vi.spyOn(fse, 'remove').mockRejectedValueOnce(new Error('preso'));

    expect(await chamar('project:write-spf', ev, p.spf, { structure: {} })).toEqual({ success: true });
    expect(lerSpf(p.spf)).toEqual({ structure: { basePath: p.raiz } });
    expect(log.warn).toHaveBeenCalledWith('[spf] escrita atomica falhou, gravando direto:', 'EPERM');
  });

  it('recusa outro .spf, documento que nao e objeto, e devolve a falha da escrita', async () => {
    const p = projeto();
    const ev = evento();
    expect(await chamar('project:write-spf', ev, p.spf, {}))
      .toEqual({ success: false, message: 'spf path is not the project open in this window' });
    registrar(ev, p.spf);
    expect(await chamar('project:write-spf', ev, 42, {}))
      .toEqual({ success: false, message: 'spf path is not the project open in this window' });
    expect(await chamar('project:write-spf', ev, p.spf.toUpperCase(), 'texto'))
      .toEqual({ success: false, message: 'spf document must be an object' });

    vi.spyOn(fse, 'writeFile').mockRejectedValue(new Error('disco cheio'));
    vi.spyOn(fse, 'rename').mockRejectedValue('nao e Error');
    expect(await chamar('project:write-spf', ev, p.spf, {}))
      .toEqual({ success: false, message: 'disco cheio' });
    expect(log.warn).toHaveBeenCalledWith('[spf] escrita atomica falhou, gravando direto:', 'disco cheio');

    fse.writeFile.mockRejectedValue('texto puro');
    expect(await chamar('project:write-spf', ev, p.spf, {}))
      .toEqual({ success: false, message: 'texto puro' });
  });
});

// ---- project:open ----

describe('project:open', () => {
  it('abre, registra a janela, marca os processadores e avisa a janela que pediu', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }, { name: 'some' }] });
    fs.mkdirSync(path.join(p.raiz, 'cpu'));
    fs.mkdirSync(path.join(p.raiz, '.aurora', 'Temp'), { recursive: true });
    const ev = evento();
    janela.daJanela = { isDestroyed: () => false, webContents: ev.sender };

    const r = await chamar('project:open', ev, p.spf);

    expect(state.projectPathsBySender.get(1)).toBe(p.spf);
    expect(r.spfPath).toBe(p.spf);
    expect(r.projectData.structure.processors).toEqual([
      { name: 'cpu', exists: true }, { name: 'some', exists: false },
    ]);
    // Abrir nao carimba data no .spf: ninguem lia o lastOpened, e a data
    // mudava o arquivo (e o git do repositorio do projeto) a cada abertura.
    expect(r.projectData.metadata).not.toHaveProperty('lastOpened');
    // A pasta escondida da AURORA nao aparece na arvore.
    expect(r.files.map((f) => f.name).sort()).toEqual(['cpu', `${p.nome}.spf`]);
    expect(ev.sender.enviados).toEqual([
      ['project:processorHubState', { enabled: true }],
      ['project:processors', { processors: ['cpu', 'some'], projectPath: p.raiz }],
    ]);
    expect(recents.push).toHaveBeenCalledWith(p.spf);
    expect(lerSpf(p.spf).metadata).not.toHaveProperty('lastOpened');
  });

  it('um lastOpened que o .spf ja traga fica como estava', async () => {
    const p = projeto();
    const doc = lerSpf(p.spf);
    doc.metadata.lastOpened = '2026-07-18T15:05:34.982Z';
    fs.writeFileSync(p.spf, JSON.stringify(doc, null, 2));
    await chamar('project:open', evento(), p.spf);
    expect(lerSpf(p.spf).metadata.lastOpened).toBe('2026-07-18T15:05:34.982Z');
  });

  it('caminho antigo <raiz>/<nome>.spf e corrigido para <raiz>/<nome>/<nome>.spf', async () => {
    const p = projeto();
    const antigo = path.join(path.dirname(p.raiz), `${p.nome}.spf`);
    const r = await chamar('project:open', evento(), antigo);
    expect(r.spfPath).toBe(p.spf);
  });

  it('projeto copiado de outra raiz: realoca os caminhos e completa o que falta', async () => {
    const p = projeto();
    const velha = path.join(tmp.raiz, 'outra', 'lugar');
    fs.writeFileSync(p.spf, JSON.stringify({
      structure: {
        basePath: velha,
        commandOverrides: { cwd: path.join(velha, 'sim') },
      },
    }));
    const ev = evento();
    janela.focada = { isDestroyed: () => false, webContents: ev.sender };

    const r = await chamar('project:open', ev, p.spf);

    expect(r.projectData.metadata.projectPath).toBe(p.raiz);
    expect(r.projectData.structure).toMatchObject({
      basePath: p.raiz, processors: [], folders: [],
      commandOverrides: { cwd: path.join(p.raiz, 'sim') },
    });
  });

  it('raiz gravada relativa nao e realocada, so trocada', async () => {
    const p = projeto(undefined, { basePath: 'relativa', processors: undefined, folders: undefined });
    const r = await chamar('project:open', evento(), p.spf);
    expect(r.projectData.structure.basePath).toBe(p.raiz);
  });

  it('sem janela para avisar, registra no log e devolve o projeto assim mesmo', async () => {
    const p = projeto();
    janela.daJanela = { isDestroyed: () => true, webContents: null };
    const r = await chamar('project:open', evento(), p.spf);
    expect(r.spfPath).toBe(p.spf);
    expect(log.warn).toHaveBeenCalledWith('open-spf-project: no window to send IPC events to');
  });

  it('falha da lista de atalhos nao impede a abertura', async () => {
    const p = projeto();
    windows.rebuildJumpList.mockImplementation(() => { throw new Error('jumplist'); });
    const r = await chamar('project:open', evento(), p.spf);
    expect(r.spfPath).toBe(p.spf);
    expect(log.warn).toHaveBeenCalledWith('jumplist refresh failed:', expect.any(Error));
  });

  it('caminho vazio ou que nao e texto: recusa sem lancar', async () => {
    for (const ruim of ['', '   ', null, 7]) {
      expect(await chamar('project:open', evento(), ruim))
        .toEqual({ success: false, message: 'No project path provided.' });
    }
  });

  it('arquivo que nao existe, ou que nao e um .spf: lanca e a janela fica sem projeto', async () => {
    const ev = evento();
    state.projectPathsBySender.set(1, 'antes.spf');
    await expect(chamar('project:open', ev, path.join(tmp.raiz, 'x', 'nada.spf')))
      .rejects.toThrow('SPF file not found at both original and corrected paths.');
    expect(state.projectPathsBySender.has(1)).toBe(false);

    const falso = path.join(tmp.raiz, `pkg${n}.json`);
    fs.writeFileSync(falso, '{"name":"x"}');
    await expect(chamar('project:open', ev, falso)).rejects.toThrow('Not a SAPHO project file');
    expect(state.projectPathsBySender.has(1)).toBe(false);
    expect(log.error).toHaveBeenCalledWith('Error opening project file:', expect.any(Error));
  });
});

// ---- project:close e project:trash ----

describe('project:close', () => {
  it('sem projeto na janela: nada a fechar', async () => {
    expect(await chamar('project:close', evento())).toEqual({ success: true, message: 'No project to close' });
  });

  it('fecha, lembra o que fechou e limpa a janela que pediu', async () => {
    const ev = evento();
    registrar(ev, 'C:/p/p.spf');
    expect(await chamar('project:close', ev)).toEqual({ success: true });
    expect(state.projectPathsBySender.has(1)).toBe(false);
    expect(state.ultimoProjetoFechado.get(1)).toBe('C:/p/p.spf');
    expect(ev.sender.enviados.map(([canal]) => canal)).toEqual([
      'project:processorHubState', 'project:processors', 'project:fileTree', 'project:closed',
    ]);
  });

  it('janela destruida: fecha sem mandar nada', async () => {
    const ev = evento();
    registrar(ev, 'C:/p/p.spf');
    ev.sender.destruido = true;
    expect(await chamar('project:close', ev)).toEqual({ success: true });
    expect(ev.sender.enviados).toEqual([]);
  });

  it('erro no meio vira resposta, nao excecao', async () => {
    const ev = evento();
    registrar(ev, 'C:/p/p.spf');
    ev.sender.isDestroyed = () => { throw new Error('morreu'); };
    expect(await chamar('project:close', ev)).toEqual({ success: false, error: 'morreu' });
    registrar(ev, 'C:/p/p.spf');
    ev.sender.isDestroyed = () => { throw 'texto'; };
    expect(await chamar('project:close', ev)).toEqual({ success: false, error: 'texto' });
  });
});

describe('project:trash', () => {
  it('so o projeto que esta janela acabou de fechar', async () => {
    const r = await chamar('project:trash', evento(), 'C:/qualquer/q.spf');
    expect(r.success).toBe(false);
    expect(lixeira.trashItem).not.toHaveBeenCalled();
  });

  it('pasta que ja nao existe: recusa', async () => {
    const spf = path.join(tmp.raiz, 'sumiu', 's.spf');
    state.ultimoProjetoFechado.set(1, spf);
    expect(await chamar('project:trash', evento(), spf))
      .toEqual({ success: false, message: 'project folder not found on disk' });
  });

  it('solta vigias, servidor de linguagem e TCMD da pasta e manda para a Lixeira', async () => {
    const p = projeto();
    state.ultimoProjetoFechado.set(1, p.spf);
    const fechar = () => vi.fn();
    const dentro = { watcher: { close: fechar() } };
    const fora = { watcher: { close: fechar() } };
    const quebrado = { watcher: { close: () => { throw new Error('ja caiu'); } } };
    state.activeDirectoryWatchers.set(p.raiz, dentro);
    state.activeDirectoryWatchers.set(path.join(p.raiz, 'sub'), quebrado);
    state.activeDirectoryWatchers.set(path.join(tmp.raiz, 'longe'), fora);
    const arquivoSoVigia = { close: fechar() };
    const arquivoQuebrado = { watcher: { close: () => { throw new Error('x'); } } };
    state.activeWatchers.set(path.join(p.raiz, 'a.v'), arquivoSoVigia);
    state.activeWatchers.set(path.join(p.raiz, 'b.v'), arquivoQuebrado);
    state.activeWatchers.set(path.join(tmp.raiz, 'longe.v'), { watcher: { close: fechar() } });

    expect(await chamar('project:trash', evento(), p.spf)).toEqual({ success: true, message: undefined });

    expect(lixeira.trashItem).toHaveBeenCalledWith(p.raiz);
    expect(dentro.watcher.close).toHaveBeenCalled();
    expect(fora.watcher.close).not.toHaveBeenCalled();
    expect(arquivoSoVigia.close).toHaveBeenCalled();
    expect([...state.activeDirectoryWatchers.keys()]).toEqual([path.join(tmp.raiz, 'longe')]);
    expect([...state.activeWatchers.keys()]).toEqual([path.join(tmp.raiz, 'longe.v')]);
    expect(slang.stop).toHaveBeenCalledWith(false);
    expect(shellIpc.matarSessoesEm).toHaveBeenCalledWith(p.raiz);
    expect(recents.remove).toHaveBeenCalledWith(p.spf);
    expect(windows.rebuildJumpList).toHaveBeenCalled();
  });

  it('servidor de linguagem, TCMD e recentes que falham nao impedem', async () => {
    const p = projeto();
    state.ultimoProjetoFechado.set(1, p.spf);
    slang.stop.mockImplementationOnce(() => { throw new Error('slang'); });
    shellIpc.matarSessoesEm.mockImplementationOnce(() => { throw 'shell'; });
    recents.remove.mockImplementationOnce(() => { throw new Error('recentes'); });

    expect((await chamar('project:trash', evento(), p.spf)).success).toBe(true);
    expect(log.debug).toHaveBeenCalledWith('[project:trash] slang stop:', 'slang');
    expect(log.debug).toHaveBeenCalledWith('[project:trash] shell:', 'shell');
    expect(log.warn).toHaveBeenCalledWith('[project:trash] recentes:', expect.any(Error));
  });

  it('a Lixeira recusando ate o fim: devolve a falha', async () => {
    const p = projeto();
    state.ultimoProjetoFechado.set(1, p.spf);
    lixeira.trashItem.mockRejectedValue(new Error('em uso'));
    expect(await chamar('project:trash', evento(), p.spf)).toEqual({ success: false, message: 'em uso' });
    expect(recents.remove).not.toHaveBeenCalled();
  }, 10_000);
});

// ---- get-current-project e list-recent-projects ----

describe('get-current-project', () => {
  it('sem projeto, com projeto e com .spf ilegivel', async () => {
    const ev = evento();
    expect(await chamar('get-current-project', ev)).toEqual({ projectOpen: false });

    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    registrar(ev, p.spf);
    expect(await chamar('get-current-project', ev))
      .toEqual({ projectOpen: true, projectPath: p.raiz, spfPath: p.spf, processors: ['cpu'] });

    fs.writeFileSync(p.spf, '{}');
    expect(await chamar('get-current-project', ev)).toEqual({ projectOpen: false });
  });
});

describe('list-recent-projects', () => {
  it('devolve os recentes podados, e lista vazia se a poda falhar', async () => {
    expect(await chamar('list-recent-projects', evento())).toEqual(['a.spf']);
    recents.prune.mockImplementation(() => { throw new Error('x'); });
    expect(await chamar('list-recent-projects', evento())).toEqual([]);
    recents.prune.mockImplementation(() => { throw 'y'; });
    expect(await chamar('list-recent-projects', evento())).toEqual([]);
  });
});

// ---- create-processor-project ----

describe('create-processor-project', () => {
  const form = (p, extra = {}) => ({
    projectLocation: p.raiz, processorName: 'cpu', nBits: 32, nbManti: 23, nbExpoe: 8,
    dataStackSize: 10, instructionStackSize: 10, inputPorts: 1, outputPorts: 1, gain: 1,
    ...extra,
  });

  it('cria as tres pastas e o fonte C+-, e devolve a entrada sem tocar no .spf', async () => {
    const p = projeto();
    const antes = fs.readFileSync(p.spf, 'utf8');
    const ev = evento();

    expect(await chamar('create-processor-project', ev, form(p))).toEqual({
      success: true, path: path.join(p.raiz, 'cpu'), spfPath: p.spf, entrada: { name: 'cpu' },
    });

    for (const sub of ['Software', 'Hardware', 'Simulation']) {
      expect(fs.existsSync(path.join(p.raiz, 'cpu', sub))).toBe(true);
    }
    expect(fs.readFileSync(path.join(p.raiz, 'cpu', 'Software', 'cpu.cmm'), 'utf8')).toMatch(/#PRNAME cpu/);
    // O .spf e do renderer (js/project/processadores_do_spf.ts); o aviso sai
    // do project:write-spf quando a gravacao dele chega.
    expect(fs.readFileSync(p.spf, 'utf8')).toBe(antes);
    expect(ev.sender.enviados).toEqual([]);
  });

  it('C++ grava o .cpp, e a entrada leva a linguagem', async () => {
    const p = projeto();
    const r = await chamar('create-processor-project', evento(), form(p, { language: 'CPP' }));
    expect(fs.existsSync(path.join(p.raiz, 'cpu', 'Software', 'cpu.cpp'))).toBe(true);
    expect(r.entrada).toEqual({ name: 'cpu', language: 'cpp' });
  });

  it('recusa sem local, nome que sai da pasta e processador que ja existe', async () => {
    const p = projeto();
    await expect(chamar('create-processor-project', evento(), { processorName: 'cpu' }))
      .rejects.toThrow('Project location is required');
    await expect(chamar('create-processor-project', evento(), form(p, { processorName: '..\\..' })))
      .rejects.toThrow(/Invalid processor name/);
    await expect(chamar('create-processor-project', evento(), form(p, { processorName: undefined })))
      .rejects.toThrow(/Invalid processor name/);
    fs.mkdirSync(path.join(p.raiz, 'cpu'));
    await expect(chamar('create-processor-project', evento(), form(p)))
      .rejects.toThrow('A processor with name "cpu" already exists');
    expect(log.error).toHaveBeenCalledWith('Error in create-processor-project:', expect.any(Error));
  });
});

// ---- get-available-processors ----

describe('get-available-processors', () => {
  it('do projeto aberto: tempo de cada um e as diretivas do fonte', async () => {
    const p = projeto(undefined, {
      processors: ['cpu', { name: 'dsp', clk: 50, numClocks: 3 }, { name: 'cc', language: 'cpp' }],
    });
    processadorEmDisco(p.raiz, 'cpu', '#PRNAME cpu\n#NUBITS 16\n');
    const ev = evento();
    registrar(ev, p.spf);

    const r = await chamar('get-available-processors', ev);

    expect(r.map((x) => x.name)).toEqual(['cpu', 'dsp', 'cc']);
    expect(r[0].header).toEqual({ PRNAME: 'cpu', NUBITS: '16' });
    expect(r[1]).toMatchObject({ clk: 50, numClocks: 3, header: {} });
    expect(r[2].header).toEqual({});
  });

  it('sem projeto aberto: pela pasta ou pelo .spf que vier', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    expect((await chamar('get-available-processors', evento(), p.raiz)).map((x) => x.name)).toEqual(['cpu']);
    expect((await chamar('get-available-processors', evento(), p.spf)).map((x) => x.name)).toEqual(['cpu']);
  });

  it('nada para ler: lista vazia', async () => {
    const p = projeto();
    const semLista = projeto(`s${n}`, { processors: undefined });
    const ev = evento();
    registrar(ev, semLista.spf);
    expect(await chamar('get-available-processors', ev, semLista.raiz)).toEqual([]);
    expect(await chamar('get-available-processors', evento())).toEqual([]);
    const vazia = path.join(tmp.raiz, `v${n}`);
    fs.mkdirSync(vazia);
    expect(await chamar('get-available-processors', evento(), vazia)).toEqual([]);
    const txt = path.join(p.raiz, 'nota.txt');
    fs.writeFileSync(txt, '');
    expect(await chamar('get-available-processors', evento(), txt)).toEqual([]);
    expect(await chamar('get-available-processors', evento(), path.join(tmp.raiz, 'nao.spf'))).toEqual([]);
    expect(log.error).toHaveBeenCalledWith('Error getting available processors:', expect.any(Error));
  });
});

// ---- delete-processor ----

describe('delete-processor', () => {
  it('apaga a pasta e devolve o nome e o .spf, sem tocar nele', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }, { name: 'dsp' }] });
    processadorEmDisco(p.raiz, 'cpu');
    const antes = fs.readFileSync(p.spf, 'utf8');
    const ev = evento();
    registrar(ev, p.spf);

    expect(await chamar('delete-processor', ev, ' cpu ')).toEqual({ success: true, spfPath: p.spf, name: 'cpu' });

    expect(fs.existsSync(path.join(p.raiz, 'cpu'))).toBe(false);
    expect(fs.readFileSync(p.spf, 'utf8')).toBe(antes);
    expect(ev.sender.enviados).toEqual([]);
  });

  it('pasta que ja nao existe: nada a apagar, e responde igual', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    const ev = evento();
    registrar(ev, p.spf);
    expect(await chamar('delete-processor', ev, 'cpu')).toEqual({ success: true, spfPath: p.spf, name: 'cpu' });
  });

  it('recusa sem projeto e nome que sai da pasta', async () => {
    await expect(chamar('delete-processor', evento(), 'cpu')).rejects.toThrow('No open project');
    const p = projeto();
    const ev = evento();
    registrar(ev, p.spf);
    await expect(chamar('delete-processor', ev, '..')).rejects.toThrow(/letters, numbers/);
    await expect(chamar('delete-processor', ev, undefined)).rejects.toThrow(/letters, numbers/);
    expect(log.error).toHaveBeenCalledWith('Error deleting processor:', expect.any(Error));
  });
});

// ---- rename-processor ----

describe('rename-processor', () => {
  it('move a pasta e os artefatos e reescreve a diretiva; o .spf fica para o renderer', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu', clk: 50 }, 'dsp'] });
    const antes = fs.readFileSync(p.spf, 'utf8');
    processadorEmDisco(p.raiz, 'cpu', '// meu cpu\n#PRNAME cpu\n');
    const ev = evento();
    registrar(ev, p.spf);
    const dir = { watcher: { close: vi.fn() } };
    state.activeDirectoryWatchers.set(p.raiz, dir);
    state.activeWatchers.set('chave', { watcher: { close: vi.fn() }, filePath: path.join(p.raiz, 'cpu', 'Software', 'cpu.cmm') });
    state.activeWatchers.set(path.join(tmp.raiz, 'longe.v'), { watcher: { close: vi.fn() } });

    const r = await chamar('rename-processor', ev, 'CPU', 'alu');

    const novo = path.join(p.raiz, 'alu');
    expect(r).toEqual({
      success: true, oldName: 'cpu', newName: 'alu', oldDir: path.join(p.raiz, 'cpu'), newDir: novo,
      spfPath: p.spf, projectDir: p.raiz,
    });
    expect(fs.existsSync(path.join(p.raiz, 'cpu'))).toBe(false);
    expect(fs.readFileSync(path.join(novo, 'Software', 'alu.cmm'), 'utf8')).toBe('// meu cpu\n#PRNAME alu\n');
    for (const f of [['Software', 'alu.asm'], ['Hardware', 'alu.v'], ['Simulation', 'alu_tb.v']]) {
      expect(fs.existsSync(path.join(novo, ...f))).toBe(true);
    }
    expect(fs.readFileSync(p.spf, 'utf8')).toBe(antes);
    expect(dir.watcher.close).toHaveBeenCalled();
    expect(state.activeDirectoryWatchers.size).toBe(0);
    expect([...state.activeWatchers.keys()]).toEqual([path.join(tmp.raiz, 'longe.v')]);
    expect(ev.sender.enviados).toEqual([
      ['processor:renamed', { oldName: 'cpu', newName: 'alu', projectPath: p.raiz, oldDir: path.join(p.raiz, 'cpu'), newDir: novo }],
    ]);
  });

  it('so a caixa muda: passa por uma pasta temporaria; janela destruida nao recebe aviso', async () => {
    const p = projeto(undefined, { processors: ['cpu'] });
    const doc = lerSpf(p.spf);
    delete doc.metadata;
    fs.writeFileSync(p.spf, JSON.stringify(doc));
    processadorEmDisco(p.raiz, 'cpu', 'sem diretiva\n');
    const ev = evento();
    registrar(ev, p.spf);
    ev.sender.destruido = true;

    const r = await chamar('rename-processor', ev, 'cpu', 'CPU');

    expect(r.newName).toBe('CPU');
    expect(fs.readdirSync(p.raiz)).toContain('CPU');
    expect(fs.readFileSync(path.join(p.raiz, 'CPU', 'Software', 'CPU.cmm'), 'utf8')).toBe('sem diretiva\n');
    expect(ev.sender.enviados).toEqual([]);
  });

  it('vigia que nao fecha nao segura o rename alem do limite', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    processadorEmDisco(p.raiz, 'cpu');
    const ev = evento();
    registrar(ev, p.spf);
    state.activeDirectoryWatchers.set(p.raiz, { watcher: { close: () => new Promise(() => {}) } });
    state.activeWatchers.set(path.join(p.raiz, 'x.v'), { watcher: { close: () => Promise.reject(new Error('x')) } });

    expect((await chamar('rename-processor', ev, 'cpu', 'alu')).success).toBe(true);
    expect(state.activeWatchers.size).toBe(0);
  });

  it('pasta presa por um instante: tenta de novo; erro que nao e de trava lanca', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }, { name: 'dsp' }] });
    processadorEmDisco(p.raiz, 'cpu');
    processadorEmDisco(p.raiz, 'dsp');
    const ev = evento();
    registrar(ev, p.spf);
    const mover = vi.spyOn(fse, 'move');
    mover.mockRejectedValueOnce(errno('EBUSY')).mockRejectedValueOnce(errno('ENOTEMPTY'));
    expect((await chamar('rename-processor', ev, 'cpu', 'alu')).success).toBe(true);

    mover.mockRejectedValueOnce(errno('EACCES'));
    await expect(chamar('rename-processor', ev, 'dsp', 'mac')).rejects.toThrow('EACCES');
    mover.mockRejectedValueOnce(null);
    await expect(chamar('rename-processor', ev, 'dsp', 'mac')).rejects.toBeNull();
  });

  it('trava que nao solta em cinco tentativas: lanca a ultima', async () => {
    const p = projeto(undefined, { processors: [{ name: 'cpu' }] });
    processadorEmDisco(p.raiz, 'cpu');
    const ev = evento();
    registrar(ev, p.spf);
    vi.spyOn(fse, 'move').mockRejectedValue(errno('EPERM'));
    await expect(chamar('rename-processor', ev, 'cpu', 'alu')).rejects.toThrow('EPERM');
    expect(fse.move).toHaveBeenCalledTimes(5);
  });

  it('recusas', async () => {
    await expect(chamar('rename-processor', evento(), 'a', 'b')).rejects.toThrow('No open project');
    const p = projeto(undefined, { processors: [{ name: 'cpu' }, { name: 'dsp' }, { name: '../fora' }, { name: 'semPasta' }] });
    processadorEmDisco(p.raiz, 'cpu');
    fs.mkdirSync(path.join(p.raiz, 'ocupada'));
    const ev = evento();
    registrar(ev, p.spf);
    const casos = [
      [undefined, 'b', 'Current processor name is required'],
      ['cpu', ' ', 'New processor name is required'],
      ['cpu', 'a b', /letters, numbers/],
      ['nada', 'b', 'Processor "nada" not found in this project'],
      ['../fora', 'b', 'Processor "../fora" has a folder name the project cannot handle'],
      ['cpu', 'DSP', 'A processor named "DSP" already exists'],
      ['semPasta', 'b', /Processor folder not found/],
      ['cpu', 'ocupada', 'A folder named "ocupada" already exists in the project'],
    ];
    for (const [velho, novo, erro] of casos) {
      await expect(chamar('rename-processor', ev, velho, novo)).rejects.toThrow(erro);
    }
    const semLista = projeto(`s${n}`, { processors: undefined });
    registrar(ev, semLista.spf);
    await expect(chamar('rename-processor', ev, 'cpu', 'b')).rejects.toThrow('not found');
    expect(log.error).toHaveBeenCalledWith('Error renaming processor:', expect.any(Error));
  });
});

// ---- rename-project ----

describe('rename-project', () => {
  it('move a pasta, renomeia o .spf, realoca os caminhos e passa a janela para o novo', async () => {
    const p = projeto('velho');
    const doc = lerSpf(p.spf);
    doc.structure.topLevelFile = path.join(p.raiz, 'top.v');
    fs.writeFileSync(p.spf, JSON.stringify(doc));
    const ev = evento();
    registrar(ev, p.spf);

    const r = await chamar('rename-project', ev, ' novo ');

    const raiz = path.join(path.dirname(p.raiz), 'novo');
    const spf = path.join(raiz, 'novo.spf');
    expect(r).toMatchObject({
      success: true, oldName: 'velho', newName: 'novo', oldRoot: p.raiz, newRoot: raiz,
      oldSpfPath: p.spf, newSpfPath: spf,
    });
    expect(r.steps.map((s) => s.step)).toEqual(['validate', 'release-watchers', 'move-folder', 'rename-spf', 'rewrite-spf', 'resync']);
    const lido = lerSpf(spf);
    expect(lido.metadata).toMatchObject({ projectName: 'novo', projectPath: raiz });
    expect(lido.structure).toMatchObject({ basePath: raiz, topLevelFile: path.join(raiz, 'top.v') });
    expect(state.projectPathsBySender.get(1)).toBe(spf);
    expect(recents.push).toHaveBeenCalledWith(spf);
    expect(recents.prune).toHaveBeenCalled();
  });

  it('so a caixa da pasta muda, e o .spf sem metadata leva o nome do arquivo', async () => {
    const p = projeto('caixa');
    fs.writeFileSync(p.spf, JSON.stringify({}));
    const ev = evento();
    registrar(ev, p.spf);
    windows.rebuildJumpList.mockImplementation(() => { throw new Error('jumplist'); });

    const r = await chamar('rename-project', ev, 'CAIXA');

    expect(r).toMatchObject({ success: true, oldName: 'caixa', newName: 'CAIXA' });
    expect(fs.readdirSync(path.dirname(p.raiz))).toContain('CAIXA');
    expect(fs.readdirSync(r.newRoot)).toContain('CAIXA.spf');
    expect(log.warn).toHaveBeenCalledWith('jumplist refresh (rename-project) failed:', expect.any(Error));
  });

  it('pasta com o nome certo e .spf com outro: so o .spf muda', async () => {
    const raiz = path.join(tmp.raiz, `c${n}`, 'certo');
    fs.mkdirSync(raiz, { recursive: true });
    const spf = path.join(raiz, 'outro.spf');
    fs.writeFileSync(spf, JSON.stringify({ metadata: { projectName: 'outro' }, structure: { basePath: raiz } }));
    const ev = evento();
    registrar(ev, spf);
    const r = await chamar('rename-project', ev, 'certo');
    expect(r.newSpfPath).toBe(path.join(raiz, 'certo.spf'));
    expect(fs.readdirSync(raiz)).toEqual(['certo.spf']);
  });

  it('pasta com o nome certo e .spf com outra caixa: o .spf passa por um temporario', async () => {
    const raiz = path.join(tmp.raiz, `c${n}`, 'certo');
    fs.mkdirSync(raiz, { recursive: true });
    const spf = path.join(raiz, 'CERTO.spf');
    fs.writeFileSync(spf, JSON.stringify({ structure: { basePath: raiz } }));
    const ev = evento();
    registrar(ev, spf);
    const r = await chamar('rename-project', ev, 'certo');
    expect(r.success).toBe(true);
    expect(fs.readdirSync(raiz)).toEqual(['certo.spf']);
  });

  it('nome e caixa iguais: so reescreve o .spf', async () => {
    const p = projeto('igual');
    const ev = evento();
    registrar(ev, p.spf);
    const r = await chamar('rename-project', ev, 'igual');
    expect(r).toMatchObject({ success: true, newRoot: p.raiz, newSpfPath: p.spf });
  });

  it('.spf que sumiu da raiz depois de lido: a renomeacao do arquivo e pulada', async () => {
    const p = projeto('velho');
    const ev = evento();
    registrar(ev, p.spf);
    const existe = fse.pathExists.bind(fse);
    vi.spyOn(fse, 'pathExists').mockImplementation(async (alvo) => (String(alvo).endsWith('velho.spf') ? false : existe(alvo)));
    const r = await chamar('rename-project', ev, 'outro');
    expect(r.success).toBe(true);
    expect(fs.readdirSync(r.newRoot).sort()).toEqual(['outro.spf', 'velho.spf']);
  });

  it('falha devolve o passo em que parou, sem lancar', async () => {
    expect(await chamar('rename-project', evento(), 'x'))
      .toEqual({ success: false, failedStep: 'validate', error: 'No open project', steps: [] });

    const p = projeto('velho');
    fs.mkdirSync(path.join(path.dirname(p.raiz), 'ocupado'));
    const ev = evento();
    registrar(ev, p.spf);
    for (const [nome, erro] of [['', 'New project name is required'], ['a/b', /letters, numbers/], ['ocupado', /already exists/]]) {
      const r = await chamar('rename-project', ev, nome);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(erro);
    }
    expect((await chamar('rename-project', ev, undefined)).error).toBe('New project name is required');

    vi.spyOn(fse, 'move').mockRejectedValue(errno('EACCES'));
    const r = await chamar('rename-project', ev, 'livre');
    expect(r).toMatchObject({ success: false, failedStep: 'move-folder', error: 'EACCES' });
    expect(r.steps.map((s) => s.step)).toEqual(['validate', 'release-watchers']);

    fse.move.mockRejectedValue('texto');
    expect((await chamar('rename-project', ev, 'livre')).error).toBe('texto');
    expect(log.error).toHaveBeenCalledWith('Error renaming project:', 'texto');
  });
});
