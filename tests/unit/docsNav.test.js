import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dentroDaRaiz, caminhoDeUrl, decidirNavegacao } = require('../../main/ipc/docs_nav.js');
const { joinAppPath } = require('../../main/utils.js');

// A fronteira da janela do manual (main/ipc/docs_nav.js). Sem ela o
// WebContentsView que carrega o manual navegaria para qualquer lugar, e a
// janela viraria um navegador irrestrito com a barra da AURORA em volta — pior
// que um navegador, porque parece nosso.
//
// Os caminhos sao montados com path.join para o teste dizer a mesma coisa nos
// dois separadores; o produto so roda em Windows, mas um teste que depende do
// separador esconde o que esta afirmando.

const RAIZ = path.resolve(path.join('C:', 'aurora', 'docs'));

describe('dentroDaRaiz', () => {
  it('aceita a propria raiz e o que esta abaixo dela', () => {
    expect(dentroDaRaiz(RAIZ, RAIZ)).toBe(true);
    expect(dentroDaRaiz(RAIZ, path.join(RAIZ, 'index.html'))).toBe(true);
    expect(dentroDaRaiz(RAIZ, path.join(RAIZ, 'cap', '3', 'p.html'))).toBe(true);
  });

  it('recusa a subida por .., inclusive quando ela volta para dentro', () => {
    expect(dentroDaRaiz(RAIZ, path.join(RAIZ, '..', 'segredo.txt'))).toBe(false);
    // Volta para dentro depois de subir: resolvido, continua dentro, e passar
    // esta e o comportamento certo — o que importa e onde o caminho ATERRISSA.
    expect(dentroDaRaiz(RAIZ, path.join(RAIZ, '..', 'docs', 'index.html'))).toBe(true);
  });

  it('recusa irmao com prefixo parecido, que e o erro classico de comparar texto', () => {
    // 'C:/aurora/docs-privado' comeca com 'C:/aurora/docs'. Comparar por
    // startsWith deixaria passar; comparar caminho relativo nao deixa.
    expect(dentroDaRaiz(RAIZ, path.resolve(path.join('C:', 'aurora', 'docs-privado', 'x.html')))).toBe(false);
  });

  it('recusa quando falta raiz ou alvo', () => {
    expect(dentroDaRaiz('', path.join(RAIZ, 'i.html'))).toBe(false);
    expect(dentroDaRaiz(RAIZ, '')).toBe(false);
  });
});

describe('caminhoDeUrl', () => {
  it('tira a barra da frente da letra de unidade do Windows', () => {
    // O pathname de file:///C:/x e '/C:/x', com uma barra que o Windows nao usa.
    expect(caminhoDeUrl('file:///C:/aurora/docs/index.html')).toBe('C:/aurora/docs/index.html');
  });

  it('decodifica percent-encoding, porque a pasta do manual tem acento', () => {
    expect(caminhoDeUrl('file:///C:/aurora/docs/cap%C3%ADtulo%201.html'))
      .toBe('C:/aurora/docs/capítulo 1.html');
  });

  it('devolve vazio para o que nao e file:', () => {
    expect(caminhoDeUrl('https://nipscern.com')).toBe('');
    expect(caminhoDeUrl('javascript:alert(1)')).toBe('');
    expect(caminhoDeUrl('data:text/html,<b>x</b>')).toBe('');
  });

  it('devolve vazio em vez de lancar quando a URL nao e analisavel', () => {
    expect(caminhoDeUrl('nao é url')).toBe('');
    expect(caminhoDeUrl('')).toBe('');
    expect(caminhoDeUrl(undefined)).toBe('');
  });
});

describe('decidirNavegacao', () => {
  it('segue o que esta dentro do manual', () => {
    expect(decidirNavegacao(RAIZ, 'file:///C:/aurora/docs/cap1.html').acao).toBe('seguir');
  });

  it('barra o file: que aponta para fora, em vez de abrir no navegador', () => {
    // Abrir no navegador seria pior que barrar: transformaria a tentativa de
    // escapar num visualizador de arquivo local funcionando.
    const r = decidirNavegacao(RAIZ, 'file:///C:/Windows/System32/drivers/etc/hosts');
    expect(r.acao).toBe('bloquear');
  });

  it('barra a subida escrita em percent-encoding', () => {
    // %2e%2e vira '..' na decodificacao, que acontece ANTES da comparacao de
    // contencao de proposito: sem decodificar, o '..' passaria sem normalizar.
    expect(decidirNavegacao(RAIZ, 'file:///C:/aurora/docs/%2e%2e/%2e%2e/segredo.txt').acao)
      .toBe('bloquear');
  });

  it('manda http e https para o navegador do sistema', () => {
    expect(decidirNavegacao(RAIZ, 'https://www.nipscern.com').acao).toBe('externa');
    expect(decidirNavegacao(RAIZ, 'http://localhost:8080/x').acao).toBe('externa');
  });

  it('barra em silencio o que nao esta na lista de permitidos', () => {
    // A lista e fechada de proposito: esquema novo cai no bloqueio em vez de
    // passar por nao ter sido previsto.
    for (const u of ['javascript:alert(1)', 'data:text/html,<script>1</script>',
      'about:blank', 'ms-settings:', 'vbscript:x', '', 'lixo']) {
      expect(decidirNavegacao(RAIZ, u).acao, u).toBe('bloquear');
    }
  });
});

describe('joinAppPath — a regra do canal join-path', () => {
  it('junta como um path.join comum', () => {
    expect(joinAppPath('C:\\App', ['a', 'b', 'c.txt'])).toBe(path.join('a', 'b', 'c.txt'));
  });

  it('poe o diretorio de instalacao na frente quando o primeiro pedaco e components', () => {
    // E a unica arvore que o renderer referencia por nome relativo e que nao
    // fica ao lado dele: em build empacotada ela vive fora do asar, e um join
    // cru resolveria contra o diretorio de trabalho do processo.
    expect(joinAppPath('C:\\App', ['components', 'bin', 'cmmcomp.exe']))
      .toBe(path.join('C:\\App', 'components', 'bin', 'cmmcomp.exe'));
  });

  it('so trata components no PRIMEIRO pedaco', () => {
    expect(joinAppPath('C:\\App', ['x', 'components', 'y'])).toBe(path.join('x', 'components', 'y'));
  });

  it('recusa argumento que nao seja string, em vez de deixar o path.join lancar sozinho', () => {
    expect(() => joinAppPath('C:\\App', ['a', 42])).toThrow(TypeError);
    expect(() => joinAppPath('C:\\App', ['a', null])).toThrow(TypeError);
  });

  it('devolve vazio sem lancar quando nao vem pedaco nenhum', () => {
    // path.join() sem argumento devolve '.', que como caminho e uma mentira
    // util para ninguem.
    expect(joinAppPath('C:\\App', [])).toBe('');
    expect(joinAppPath('C:\\App', undefined)).toBe('');
  });
});
