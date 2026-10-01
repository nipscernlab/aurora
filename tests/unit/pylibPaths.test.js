/**
 * Onde as bibliotecas Python instaladas moram (main/python/pylib_paths).
 *
 * A raiz propria (components/PyLibs) e as duas valvulas de ambiente, e a busca
 * do site-packages do interpretador embarcado, que e onde o .pth que liga o
 * PyLibs ao Python e gravado. O fs e espionado so na pasta lib do bundle.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pylibRoot, pylibSite, manifestFile, stagingDir, ensureDirs, bundleSitePackages, sitePthFile,
} from '../../main/python/pylib_paths.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(RAIZ, 'components', 'Packages', 'msys', 'mingw64', 'lib');
const envOriginal = { root: process.env.AURORA_PYLIBS_ROOT, site: process.env.AURORA_BUNDLE_SITE };

function restaurar(nome, valor) {
  if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
}

afterEach(() => {
  vi.restoreAllMocks();
  restaurar('AURORA_PYLIBS_ROOT', envOriginal.root);
  restaurar('AURORA_BUNDLE_SITE', envOriginal.site);
});

/** A pasta lib do bundle com estas entradas; `comSite` diz quais tem site-packages. */
function bundleCom(entradas, comSite = []) {
  const readdir = fs.readdirSync.bind(fs);
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'readdirSync').mockImplementation((p, ...r) => {
    if (p === LIB) {
      if (entradas instanceof Error) throw entradas;
      return entradas;
    }
    return readdir(p, ...r);
  });
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    if (typeof p === 'string' && p.startsWith(LIB)) return comSite.some((n) => p === path.join(LIB, n, 'site-packages'));
    return exists(p);
  });
}

describe('a raiz do PyLibs', () => {
  it('sem valvula, fica em components/PyLibs, com site, manifesto e staging dentro', () => {
    delete process.env.AURORA_PYLIBS_ROOT;
    const raiz = path.join(RAIZ, 'components', 'PyLibs');
    expect(pylibRoot()).toBe(raiz);
    expect(pylibSite()).toBe(path.join(raiz, 'site'));
    expect(manifestFile()).toBe(path.join(raiz, 'installed.json'));
    expect(stagingDir()).toBe(path.join(raiz, '.staging'));
  });

  it('AURORA_PYLIBS_ROOT redireciona a arvore inteira, e ensureDirs a cria', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pylibs-'));
    try {
      process.env.AURORA_PYLIBS_ROOT = path.join(tmp, 'raiz');
      expect(ensureDirs()).toEqual({ root: path.join(tmp, 'raiz'), site: path.join(tmp, 'raiz', 'site') });
      expect(fs.statSync(path.join(tmp, 'raiz', 'site')).isDirectory()).toBe(true);
      expect(ensureDirs().site).toBe(path.join(tmp, 'raiz', 'site'));      // idempotente
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('o site-packages do bundle', () => {
  it('AURORA_BUNDLE_SITE vale so se existir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-site-'));
    try {
      process.env.AURORA_BUNDLE_SITE = tmp;
      expect(bundleSitePackages()).toBe(tmp);
      expect(sitePthFile()).toBe(path.join(tmp, 'aurora-pylibs.pth'));
      process.env.AURORA_BUNDLE_SITE = path.join(tmp, 'nao-existe');
      expect(bundleSitePackages()).toBe('');
      expect(sitePthFile()).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('acha o primeiro python3.* com site-packages, sem fixar a versao menor', () => {
    delete process.env.AURORA_BUNDLE_SITE;
    bundleCom(['pkgconfig', 'Python3.11', 'python3.12', 'python3.13'], ['python3.12', 'python3.13']);
    expect(bundleSitePackages()).toBe(path.join(LIB, 'python3.12', 'site-packages'));
    expect(sitePthFile()).toBe(path.join(LIB, 'python3.12', 'site-packages', 'aurora-pylibs.pth'));
  });

  it('bundle ausente, ou sem python com site-packages: vazio', () => {
    delete process.env.AURORA_BUNDLE_SITE;
    bundleCom(new Error('ENOENT'));
    expect(bundleSitePackages()).toBe('');
    vi.restoreAllMocks();
    bundleCom(['python3.12', 'tcl8.6'], []);
    expect(bundleSitePackages()).toBe('');
    expect(sitePthFile()).toBe('');
  });
});
