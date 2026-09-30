/**
 * Os caminhos do processo principal (main/paths.js), nos tres mundos em que o
 * modulo carrega: fora do Electron (os testes), no `npm start` e na instalacao
 * empacotada. A regra de onde os componentes persistentes moram esta no
 * componentesPersistencia.test.js; aqui fica qual caminho vale em cada mundo.
 *
 * O modulo e CommonJS e le o `app` do Electron no carregamento, entao o falso
 * entra pelo cache do require nativo e o modulo e recarregado a cada caso.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATHS = req.resolve('../../main/paths.js');
const ELECTRON = req.resolve('electron');
const electronOriginal = req.cache[ELECTRON];
const localOriginal = process.env.LOCALAPPDATA;

function carregar(electron) {
  delete req.cache[PATHS];
  if (electron === undefined) delete req.cache[ELECTRON];
  else req.cache[ELECTRON] = { id: ELECTRON, filename: ELECTRON, loaded: true, children: [], paths: [], exports: electron };
  return req(PATHS);
}

afterEach(() => {
  delete req.cache[PATHS];
  if (electronOriginal) req.cache[ELECTRON] = electronOriginal; else delete req.cache[ELECTRON];
  if (localOriginal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = localOriginal;
});

describe('main/paths', () => {
  it('fora do Electron, a raiz e o repositorio e os componentes ficam nele', () => {
    const p = carregar({});
    expect(p.appRoot).toBe(RAIZ);
    expect(p.componentsPath).toBe(path.join(RAIZ, 'components'));
    expect(p.rootPath).toBe(path.join(RAIZ, '..', '..'));
    expect(p.isDev).toBe(process.env.NODE_ENV === 'development');
  });

  it('`app` sem getAppPath conta como fora do Electron', () => {
    const p = carregar({ app: { isPackaged: true } });
    expect(p.componentsPath).toBe(path.join(RAIZ, 'components'));
  });

  it('no npm start (nao empacotado), os componentes ficam na raiz do app', () => {
    const p = carregar({ app: { getAppPath: () => 'C:\\dev\\aurora', isPackaged: false, getPath: () => { throw new Error('nao deveria perguntar'); } } });
    expect(p.appRoot).toBe('C:\\dev\\aurora');
    expect(p.componentsPath).toBe(path.join('C:\\dev\\aurora', 'components'));
    expect(p.rootPath).toBe(path.join('C:\\dev\\aurora', '..', '..'));
  });

  it('empacotado, os componentes vao para o LOCALAPPDATA, fora da instalacao', () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\alguem\\AppData\\Local';
    const caminhos = { exe: 'C:\\Programas\\sapho\\sapho.exe', userData: 'C:\\Users\\alguem\\AppData\\Roaming\\sapho' };
    const p = carregar({ app: { getAppPath: () => 'C:\\Programas\\sapho\\resources\\app.asar', isPackaged: true, getPath: (k) => caminhos[k] } });
    expect(p.componentsPath).toBe(path.join('C:\\Users\\alguem\\AppData\\Local', 'SAPHO', 'components'));

    delete process.env.LOCALAPPDATA;
    const semLocal = carregar({ app: { getAppPath: () => 'C:\\x', isPackaged: true, getPath: (k) => caminhos[k] } });
    expect(semLocal.componentsPath).toBe(path.join(caminhos.userData, 'SAPHO', 'components'));
  });
});
