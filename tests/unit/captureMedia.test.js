import { describe, it, expect } from 'vitest';

// O capture-media e um utilitario de linha de comando, nao um modulo do app,
// e o que se verifica aqui e a parte que decide
// o que fazer antes de qualquer janela abrir. Carregar o arquivo NAO dispara
// a captura, porque main() so roda quando ele e o programa chamado.
import { tomadasPedidas } from '../../scripts/capture-media.mts';

describe('capture-media, lista de tomadas', () => {
  it('sem argumento tira so o hero, que e o uso de sempre', () => {
    expect(tomadasPedidas([])).toEqual(['hero']);
  });

  it('flags nao contam como tomada', () => {
    expect(tomadasPedidas(['--algo', '-x'])).toEqual(['hero']);
  });

  it('"tudo" traz as quatro, na ordem em que sao gravadas', () => {
    expect(tomadasPedidas(['tudo'])).toEqual(['hero', 'split-editor', 'compile', 'prism']);
  });

  it('pede-se um subconjunto, e a ordem e a que foi pedida', () => {
    expect(tomadasPedidas(['prism', 'compile'])).toEqual(['prism', 'compile']);
  });

  it('"tudo" junto de outra continua sendo tudo', () => {
    expect(tomadasPedidas(['compile', 'tudo'])).toEqual(['hero', 'split-editor', 'compile', 'prism']);
  });
});
