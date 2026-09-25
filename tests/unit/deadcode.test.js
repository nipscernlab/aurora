/**
 * scripts/deadcode.mts: a escolha dos .js que saem antes do knip. Errar para
 * mais apagaria um .js escrito a mao (versionado nao entra, porque a lista vem
 * do que o git ignora, mas um ignorado sem .ts irmao tambem nao pode sair);
 * errar para menos devolve o knip ao estado em que ele parava no .js gerado e
 * acusava o .ts como sem uso.
 */

import { describe, expect, it } from 'vitest';
import { jsGerados } from '../../scripts/deadcode.mts';

describe('jsGerados', () => {
  const existe = (rel) => new Set(['main/ipc/git.ts', 'js/utils/path_utils.ts', 'html/prism/prism.ts']).has(rel);

  it('so o .js ignorado que tem .ts irmao, em js/, main/ e html/, em ordem', () => {
    expect(jsGerados([
      'main/ipc/git.js',
      'js/utils/path_utils.js',
      'html/prism/prism.js',
      '',
    ], existe)).toEqual(['html/prism/prism.js', 'js/utils/path_utils.js', 'main/ipc/git.js']);
  });

  it('ignorado sem .ts irmao fica: pode ser escrito a mao', () => {
    expect(jsGerados(['main/ipc/sem_irmao.js', 'js/vendor/lib.js'], existe)).toEqual([]);
  });

  it('fora das tres pastas, ou que nao e .js, fica', () => {
    expect(jsGerados(['components/Scripts/x.js', 'dist/assets/git.js', 'main/ipc/git.ts', 'main/ipc/git.js.map'], existe)).toEqual([]);
  });

  it('linha com espaco sobrando do git e aparada', () => {
    expect(jsGerados(['  main/ipc/git.js  '], existe)).toEqual(['main/ipc/git.js']);
  });
});
