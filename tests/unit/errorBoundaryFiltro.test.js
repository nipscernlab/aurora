// @vitest-environment happy-dom
/**
 * As regras de filtragem do error_boundary (js/app/error_boundary.js).
 *
 * Elas decidem o que o usuario ve. Uma regra larga demais esconde defeito
 * nosso atras de um "isso e do Monaco"; estreita demais devolve o balao de
 * "algo deu errado" para quem so estava apagando uma linha. Por isso os testes
 * cobrem os dois lados de cada regra, e principalmente o que NAO deve ser
 * filtrado.
 */

import { describe, expect, it } from 'vitest';

// O modulo se arma no import, prendendo ouvintes em window, entao o teste roda
// sob happy-dom (ver a primeira linha). O que se exercita sao as duas funcoes
// puras que decidem o filtro; os ouvintes ficam ali, inofensivos.
import { isBenignCancellation, isStickyScrollLineNumber } from '../../js/app/error_boundary.js';

/** Um erro com a pilha que o Monaco produz no caminho do sticky scroll. */
function erroStickyScroll() {
  const e = new Error('Illegal value for lineNumber');
  e.stack = [
    'Error: Illegal value for lineNumber',
    '    at H.getLineMaxColumn (file:///.../vendor/vs/editor/editor.main.js:683:144)',
    '    at W.getBottomForLineNumber (file:///.../editor.main.js:695:2184)',
    '    at v.findScrollWidgetState (file:///.../editor.main.js:722:159383)',
    '    at v._updateState (file:///.../editor.main.js:722:158371)',
    '    at async v._renderStickyScroll (file:///.../editor.main.js:722:157326)',
  ].join('\n');
  return e;
}

describe('sticky scroll do Monaco', () => {
  it('reconhece a rejeicao que o widget produz quando o arquivo encolhe', () => {
    expect(isStickyScrollLineNumber(erroStickyScroll())).toBe(true);
  });

  it('exige a pilha, e nao so a mensagem', () => {
    // O MESMO texto vindo do nosso codigo tem que continuar aparecendo: e um
    // numero de linha que a AURORA calculou errado, e isso e defeito nosso.
    const nosso = new Error('Illegal value for lineNumber');
    nosso.stack = [
      'Error: Illegal value for lineNumber',
      '    at EditorManager.navigateToSearchResult (file:///.../js/editor/monaco_editor.js:582:20)',
      '    at SearchPanel.abrir (file:///.../js/search/search_panel.js:120:5)',
    ].join('\n');
    expect(isStickyScrollLineNumber(nosso)).toBe(false);
  });

  it('exige a mensagem, e nao so a pilha', () => {
    const outro = new Error('Cannot read properties of undefined');
    outro.stack = 'Error\n    at v._renderStickyScroll (editor.main.js)';
    expect(isStickyScrollLineNumber(outro)).toBe(false);
  });

  it('nao confunde com mensagem parecida', () => {
    const parecido = new Error('Illegal value for lineNumber 42');
    parecido.stack = 'at v._renderStickyScroll';
    expect(isStickyScrollLineNumber(parecido)).toBe(false);
  });

  it('aguenta erro sem pilha, texto solto, nulo e indefinido', () => {
    expect(isStickyScrollLineNumber(new Error('Illegal value for lineNumber'))).toBe(false);
    expect(isStickyScrollLineNumber('Illegal value for lineNumber')).toBe(false);
    expect(isStickyScrollLineNumber(null)).toBe(false);
    expect(isStickyScrollLineNumber(undefined)).toBe(false);
    expect(isStickyScrollLineNumber({})).toBe(false);
  });
});

describe('cancelamento benigno', () => {
  it('reconhece as quatro formas que o Monaco usa ao descartar trabalho', () => {
    const porNome = new Error('qualquer'); porNome.name = 'Canceled';
    const porNome2 = new Error('qualquer'); porNome2.name = 'CancellationError';
    expect(isBenignCancellation(porNome)).toBe(true);
    expect(isBenignCancellation(porNome2)).toBe(true);
    expect(isBenignCancellation(new Error('Canceled'))).toBe(true);
    expect(isBenignCancellation('Cancelled')).toBe(true);
  });

  it('nao engole erro de verdade', () => {
    expect(isBenignCancellation(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isBenignCancellation(null)).toBe(false);
  });
});
