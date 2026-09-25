// A catraca de globais (scripts/check-window-globals.mts): o que conta como
// global cruzada e como a comparacao com a linha de base decide.

import { describe, expect, it } from 'vitest';
import { globaisCruzadas, comparar } from '../../scripts/check-window-globals.mts';

describe('globaisCruzadas', () => {
  it('conta o nome posto em window num arquivo e lido como window.X em outro', () => {
    const g = globaisCruzadas([
      { rel: 'js/a.js', src: 'window.foo = 1;\nwindow.bar = 2;' },
      { rel: 'js/b.js', src: 'use(window.foo);' },
    ]);
    expect(g).toEqual({ foo: { definidaEm: ['js/a.js'], lidaEm: ['js/b.js'] } });
  });

  it('lida so no arquivo que define nao conta', () => {
    expect(globaisCruzadas([{ rel: 'js/a.js', src: 'window.x = 1; f(window.x);' }])).toEqual({});
  });

  it('comparacao (== e ===) nao e atribuicao', () => {
    const g = globaisCruzadas([
      { rel: 'js/a.js', src: 'if (window.x == 1 || window.x === 2) {}' },
      { rel: 'js/b.js', src: 'window.x;' },
    ]);
    expect(g).toEqual({});
  });

  it('varios definidores e leitores saem em ordem, sem repetir', () => {
    const g = globaisCruzadas([
      { rel: 'js/z.js', src: 'window.m = 1; window.m = 2;' },
      { rel: 'js/a.js', src: 'window.m = 3;' },
      { rel: 'js/c.js', src: 'window.m; window.m;' },
      { rel: 'js/b.js', src: 'window.m.x()' },
    ]);
    expect(g).toEqual({ m: { definidaEm: ['js/a.js', 'js/z.js'], lidaEm: ['js/b.js', 'js/c.js'] } });
  });

  it('o cast do TypeScript nao esconde a global', () => {
    const g = globaisCruzadas([
      { rel: 'js/a.ts', src: '(window as unknown as { k: number }).k = 1;' },
      { rel: 'js/b.ts', src: 'use((window as any).k);' },
    ]);
    expect(g).toEqual({ k: { definidaEm: ['js/a.ts'], lidaEm: ['js/b.ts'] } });
  });

  it('o cast com tipo de funcao, que tem parenteses, tambem nao esconde', () => {
    const g = globaisCruzadas([
      { rel: 'js/a.ts', src: '(window as unknown as { f?: () => void }).f = g;' },
      { rel: 'js/b.js', src: 'window.f?.();' },
    ]);
    expect(Object.keys(g)).toEqual(['f']);
  });

  it('nome com $ e _ entra; window[\'x\'] nao e contado', () => {
    const g = globaisCruzadas([
      { rel: 'js/a.js', src: 'window._$y = 1; window["k"] = 2;' },
      { rel: 'js/b.js', src: 'window._$y; window.k;' },
    ]);
    expect(Object.keys(g)).toEqual(['_$y']);
  });
});

describe('comparar', () => {
  it('nome novo piora; nome que sumiu melhora', () => {
    expect(comparar(['a', 'c'], ['a', 'b'])).toEqual({ novas: ['c'], sumiram: ['b'] });
  });

  it('igual a base nao acusa nada', () => {
    expect(comparar(['b', 'a'], ['a', 'b'])).toEqual({ novas: [], sumiram: [] });
  });
});
