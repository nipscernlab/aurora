/**
 * O contrato da ponte entre o renderer e o processo principal.
 *
 * A ponte tem tres pontas que ninguem conferia juntas: o preload
 * (js/app/preload*.js) expoe metodos e chama canais de IPC; o main
 * (main.js e main/) atende os canais; o renderer (js/, html/, index.html)
 * chama os metodos. Cada ponta podia divergir sem erro nenhum: um metodo
 * chamado que o preload nao expoe e `undefined` so na hora do clique (foi o
 * caso do `getSystemInfo` do relato por e-mail e do `homePath` da lista de
 * recentes), e um canal sem handler deixa o `invoke` pendurado.
 *
 * Aqui o preload RODA, com um `electron` falso, e cada metodo exposto e chamado
 * uma vez para registrar os canais que ele usa. O main e o renderer sao lidos
 * como texto. O tipo AuroraElectronAPI (js/types/aurora-globals.d.ts) e lido
 * pela arvore sintatica do TypeScript.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import ts from 'typescript-5';
import { describe, expect, it } from 'vitest';

const PRELOADS = [
  'js/app/preload.js',
  'js/app/preload_prism.js',
  'js/app/preload_docs.js',
  'js/app/preload_splash.js',
  'js/app/preload_update.js',
];

/** Roda um preload e devolve o que ele expos e os canais que os metodos usaram. */
function carregar(arquivo) {
  const expostos = {};
  const canais = { invoke: new Set(), send: new Set(), on: new Set() };
  const ipcRenderer = {
    invoke: (c) => { canais.invoke.add(c); return Promise.resolve(); },
    send: (c) => { canais.send.add(c); },
    sendSync: (c) => { canais.send.add(c); },
    on: (c) => { canais.on.add(c); },
    once: (c) => { canais.on.add(c); },
    removeListener() {},
    removeAllListeners() {},
  };
  const electron = {
    contextBridge: { exposeInMainWorld: (nome, api) => { expostos[nome] = api; } },
    ipcRenderer,
    webUtils: { getPathForFile: () => '' },
  };
  const contexto = {
    require: () => electron,
    window: { postMessage() {}, addEventListener() {} },
    document: { addEventListener() {} },
    console,
    process: { platform: 'win32', versions: {}, env: {} },
    setTimeout,
    clearTimeout,
    module: {},
    exports: {},
  };
  vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), contexto, { filename: arquivo });
  // Cada metodo uma vez, com argumentos de formas diferentes: o que interessa
  // e o canal, nao o resultado.
  for (const api of Object.values(expostos)) {
    for (const f of Object.values(api)) {
      if (typeof f !== 'function') continue;
      for (const args of [['a', 'b', 'c', 'd'], [{}, {}, {}], [() => {}]]) {
        try {
          const r = f(...args);
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch (_) { /* o metodo pode exigir outra forma de argumento */ }
      }
    }
  }
  return { expostos, canais };
}

const pontes = Object.fromEntries(PRELOADS.filter((p) => fs.existsSync(p)).map((p) => [p, carregar(p)]));

function arquivosRastreados(prefixos, extensoes) {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter((f) => prefixos.some((p) => f === p || f.startsWith(p)))
    .filter((f) => extensoes.test(f) && !f.endsWith('.d.ts'))
    .filter((f) => fs.existsSync(f));
}

/** O texto sem comentarios, para um exemplo num comentario nao contar como uso. */
function semComentarios(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('preload e main', () => {
  const main = arquivosRastreados(['main.js', 'main/'], /\.(js|ts|cjs)$/)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  it('todo invoke tem um ipcMain.handle', () => {
    const faltam = [];
    for (const [arquivo, { canais }] of Object.entries(pontes)) {
      for (const c of canais.invoke) {
        if (!new RegExp(`\\.handle\\(\\s*['"\`]${escapar(c)}['"\`]`).test(main)) faltam.push(`${arquivo}: ${c}`);
      }
    }
    expect(faltam).toEqual([]);
  });

  it('todo send tem um ipcMain.on ou once', () => {
    const faltam = [];
    for (const [arquivo, { canais }] of Object.entries(pontes)) {
      for (const c of canais.send) {
        if (!new RegExp(`\\.(on|once)\\(\\s*['"\`]${escapar(c)}['"\`]`).test(main)) faltam.push(`${arquivo}: ${c}`);
      }
    }
    expect(faltam).toEqual([]);
  });

  it('todo canal que o preload escuta aparece no main', () => {
    const faltam = [];
    for (const [arquivo, { canais }] of Object.entries(pontes)) {
      for (const c of canais.on) {
        if (!new RegExp(`['"\`]${escapar(c)}['"\`]`).test(main)) faltam.push(`${arquivo}: ${c}`);
      }
    }
    expect(faltam).toEqual([]);
  });
});

describe('renderer e preload', () => {
  const API_DO_RENDERER = [
    'electronAPI', 'aiAPI', 'gitAPI', 'lspAPI', 'slangAPI', 'treeSitterAPI',
    'pyLibsAPI', 'clangFormatAPI', 'pythonFormatAPI', 'terminalAPI',
  ];

  it('todo metodo que o renderer chama na ponte existe em algum preload', () => {
    const expostoEmAlgum = (api, nome) => Object.values(pontes).some(({ expostos }) => expostos[api] && nome in expostos[api]);
    // Um `${` logo depois do ponto e texto de mensagem montado, nao chamada.
    const re = new RegExp(`\\b(${API_DO_RENDERER.join('|')})\\??\\.(?!\\$\\{)([A-Za-z_$][\\w$]*)`, 'g');
    const orfaos = [];
    for (const f of arquivosRastreados(['js/', 'html/', 'index.html'], /\.(js|ts|html)$/)) {
      if (PRELOADS.includes(f)) continue;
      const texto = semComentarios(fs.readFileSync(f, 'utf8'));
      for (const m of texto.matchAll(re)) {
        if (!expostoEmAlgum(m[1], m[2])) orfaos.push(`${f}: ${m[1]}.${m[2]}`);
      }
    }
    expect([...new Set(orfaos)]).toEqual([]);
  });

  it('o git_ns chama a ponte por nome, e todo nome que ele passa existe', () => {
    const gitApi = pontes['js/app/preload.js'].expostos.gitAPI;
    const nomes = [...fs.readFileSync('js/api/git_ns.js', 'utf8').matchAll(/gitCall\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(nomes.length).toBeGreaterThan(5);
    expect(nomes.filter((n) => !(n in gitApi))).toEqual([]);
  });

  it('todo membro dos tipos da ponte existe no preload que o expoe', () => {
    const arquivo = 'js/types/aurora-globals.d.ts';
    const sf = ts.createSourceFile(arquivo, fs.readFileSync(arquivo, 'utf8'), ts.ScriptTarget.ES2022, true);
    const membros = {};
    const visitar = (n) => {
      if (ts.isInterfaceDeclaration(n)) membros[n.name.text] = n.members.map((m) => m.name && m.name.getText(sf)).filter(Boolean);
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    const tipoParaApi = { AuroraElectronAPI: 'electronAPI', AuroraGitAPI: 'gitAPI' };
    const faltam = [];
    for (const [tipo, api] of Object.entries(tipoParaApi)) {
      expect(membros[tipo], `o tipo ${tipo} sumiu do aurora-globals.d.ts`).toBeTruthy();
      for (const m of membros[tipo]) {
        const existe = Object.values(pontes).some(({ expostos }) => expostos[api] && m in expostos[api]);
        if (!existe) faltam.push(`${tipo}.${m}`);
      }
    }
    expect(faltam).toEqual([]);
  });

  it('o preload principal expoe as APIs que o renderer espera', () => {
    const principal = pontes['js/app/preload.js'].expostos;
    expect(Object.keys(principal).sort()).toEqual([...API_DO_RENDERER].sort());
    expect(Object.keys(principal.electronAPI).length).toBeGreaterThan(100);
  });
});

describe('o teste enxerga o que diz enxergar', () => {
  it('registra canais de verdade e acusa um metodo inexistente', () => {
    const { canais } = pontes['js/app/preload.js'];
    expect(canais.invoke.size).toBeGreaterThan(100);
    expect(canais.invoke.has('undo:stage')).toBe(true);
    expect(semComentarios('a /* electronAPI.x */ b // electronAPI.y\nhttps://z')).toBe('a  b \nhttps://z');
    const re = /\b(electronAPI)\??\.([A-Za-z_$][\w$]*)/g;
    const achados = [...'window.electronAPI?.naoExiste()'.matchAll(re)].map((m) => m[2]);
    expect(achados).toEqual(['naoExiste']);
    expect(path.basename('js/app/preload.js')).toBe('preload.js');
  });
});
