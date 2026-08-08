/**
 * Testes do esquema `aurora-preview://`, que serve a previa de HTML renderizado
 * do editor.
 *
 * O `isPreviewUrl` merece teste por um motivo especifico: o main.js o usa para
 * ISENTAR uma resposta da politica de seguranca do aplicativo. A previa manda a
 * propria politica, mais permissiva, porque precisa carregar biblioteca de CDN
 * como o Plotly; se o main carimbasse a politica do app por cima, o grafico
 * voltaria a nascer em branco. A consequencia e que uma resposta falso-positiva
 * aqui sai sem a politica do app.
 */

import { describe, it, expect } from 'vitest';

import { isPreviewUrl, mimeFor, SCHEME, PREVIEW_CSP } from '../../main/ipc/preview.js';

describe('isPreviewUrl', () => {
  it('reconhece o proprio esquema', () => {
    expect(isPreviewUrl(`${SCHEME}://abc123/index.html`)).toBe(true);
    expect(isPreviewUrl(`${SCHEME}://abc123/`)).toBe(true);
  });

  it('recusa os esquemas do aplicativo, que precisam da politica dele', () => {
    for (const u of [
      'file:///C:/app/index.html',
      'https://nipscern.com',
      'http://localhost:5273',
      'devtools://devtools/bundled/inspector.html',
      'blob:file:///abc',
      'data:text/html,<b>x</b>',
    ]) {
      expect(isPreviewUrl(u)).toBe(false);
    }
  });

  it('so casa no comeco, entao mencionar o esquema no meio nao isenta nada', () => {
    // Este e o caso que a isencao de CSP nao pode errar.
    expect(isPreviewUrl(`https://evil.example/?next=${SCHEME}://x/`)).toBe(false);
    expect(isPreviewUrl(`https://evil.example/${SCHEME}://x/`)).toBe(false);
    expect(isPreviewUrl(` ${SCHEME}://x/`)).toBe(false);
  });

  it('exige as duas barras, entao nome parecido nao passa', () => {
    expect(isPreviewUrl(`${SCHEME}:/x`)).toBe(false);
    expect(isPreviewUrl(`${SCHEME}x://y`)).toBe(false);
    expect(isPreviewUrl(SCHEME)).toBe(false);
  });

  it('nao quebra com entrada que nao e string', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(isPreviewUrl(v)).toBe(false);
  });

  it('a politica da previa nao restringe frame-ancestors, e isso e proposital', () => {
    // frame-ancestors nunca cai para default-src, e qualquer valor seria checado
    // contra a origem da PREVIA, rejeitando o frame do aplicativo que a embute.
    expect(PREVIEW_CSP).not.toContain('frame-ancestors');
    // E o que ela fecha continua fechado.
    expect(PREVIEW_CSP).toContain("object-src 'none'");
    expect(PREVIEW_CSP).toContain("base-uri 'none'");
    expect(PREVIEW_CSP).toContain("form-action 'none'");
  });
});

describe('mimeFor', () => {
  it('acerta o que uma pagina exportada carrega de verdade', () => {
    expect(mimeFor('a/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeFor('a/app.js')).toBe('text/javascript; charset=utf-8');
    expect(mimeFor('a/estilo.css')).toBe('text/css; charset=utf-8');
    expect(mimeFor('a/dados.json')).toBe('application/json; charset=utf-8');
    expect(mimeFor('a/dados.csv')).toBe('text/csv; charset=utf-8');
    expect(mimeFor('a/fig.svg')).toBe('image/svg+xml');
    expect(mimeFor('a/f.woff2')).toBe('font/woff2');
  });

  it('nao diferencia caixa na extensao', () => {
    expect(mimeFor('A/INDEX.HTML')).toBe('text/html; charset=utf-8');
    expect(mimeFor('a/FIG.PNG')).toBe('image/png');
  });

  it('cai para octet-stream no desconhecido, em vez de chutar', () => {
    expect(mimeFor('a/proc.v')).toBe('application/octet-stream');
    expect(mimeFor('a/design.spf')).toBe('application/octet-stream');
    expect(mimeFor('a/sem_extensao')).toBe('application/octet-stream');
    expect(mimeFor('a/.gitignore')).toBe('application/octet-stream');
  });

  it('usa a ultima extensao, que e o que o caminho realmente termina', () => {
    expect(mimeFor('a/relatorio.html.txt')).toBe('text/plain; charset=utf-8');
  });

  it('serve texto como texto e nao como HTML, para nao virar execucao', () => {
    // Um .txt precisa continuar texto: servido como text/html ele seria
    // interpretado pelo navegador dentro do iframe da previa.
    expect(mimeFor('a/leia.txt')).toBe('text/plain; charset=utf-8');
    expect(mimeFor('a/leia.txt')).not.toContain('html');
  });
});
