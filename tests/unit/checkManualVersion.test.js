/**
 * A trava do manual: na PR de release, o manual publicado tem de documentar a
 * versao que sai. O quarto segmento e a revisao propria do manual e nao entra
 * na comparacao.
 */
import { describe, expect, it } from 'vitest';

import { baseDoManual, conferirManual, ehPrDeRelease } from '../../scripts/check-manual-version.mts';

describe('ehPrDeRelease', () => {
  it('reconhece a branch do release-please', () => {
    expect(ehPrDeRelease('release-please--branches--main--components--aurora-ide')).toBe(true);
  });

  it('outra branch, ou push sem branch de PR, nao e release', () => {
    expect(ehPrDeRelease('lucianomaf/trava-do-manual')).toBe(false);
    expect(ehPrDeRelease('')).toBe(false);
    expect(ehPrDeRelease(undefined)).toBe(false);
  });
});

describe('baseDoManual', () => {
  it('tira a revisao do manual', () => {
    expect(baseDoManual('7.0.0.1')).toBe('7.0.0');
  });

  it('versao de tres segmentos fica como esta', () => {
    expect(baseDoManual('7.1.0')).toBe('7.1.0');
  });
});

describe('conferirManual', () => {
  it('manual da mesma versao passa, com ou sem revisao', () => {
    expect(conferirManual('7.1.0', '7.1.0.2')).toBeNull();
    expect(conferirManual('7.1.0', '7.1.0')).toBeNull();
  });

  it('manual atrasado reprova e diz as duas versoes', () => {
    const erro = conferirManual('7.1.0', '7.0.0.1');
    expect(erro).toContain('7.1.0');
    expect(erro).toContain('7.0.0');
  });

  it('manual de outra versao, mesmo mais nova, reprova', () => {
    expect(conferirManual('7.1.0', '7.2.0.0')).not.toBeNull();
  });

  it('sem versao do manual reprova: trava que nao confere nao trava', () => {
    expect(conferirManual('7.1.0', null)).toContain('Could not read');
  });
});
