// @vitest-environment happy-dom
/**
 * js/ui/escapar_html.ts: o texto que entra num innerHTML, entre tags ou num
 * atributo entre aspas, sai como texto (#276).
 */

import { describe, expect, it } from 'vitest';
import { escaparHtml } from '../../js/ui/escapar_html.ts';

describe('escaparHtml', () => {
  it('escapa os cinco caracteres, o & primeiro', () => {
    expect(escaparHtml(`<a href="x" title='y'>&amp;</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  });

  it('nulo e indefinido viram vazio; o resto vira texto', () => {
    expect(escaparHtml(null)).toBe('');
    expect(escaparHtml(undefined)).toBe('');
    expect(escaparHtml(42)).toBe('42');
  });

  it('dentro de um atributo, o valor volta inteiro', () => {
    const div = document.createElement('div');
    const valor = `a" onclick="x()' &lt;`;
    div.innerHTML = `<span title="${escaparHtml(valor)}">${escaparHtml(valor)}</span>`;
    const span = div.querySelector('span');
    expect(span.getAttribute('title')).toBe(valor);
    expect(span.getAttribute('onclick')).toBeNull();
    expect(span.textContent).toBe(valor);
  });
});
