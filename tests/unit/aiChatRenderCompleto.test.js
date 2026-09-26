// @vitest-environment happy-dom
//
// O renderizador das mensagens do painel de IA (js/ai/chat_render.js), nos
// ramos que ai_chat_render.test.js nao percorre: o realce de codigo por tipo
// de token, a matematica (com e sem KaTeX), os delimitadores \[ \] e \( \),
// links e caminhos, tabelas alinhadas, citacoes e avisos, listas aninhadas e
// de tarefas. Escrito antes da conversao para .ts.

import { describe, it, expect, afterEach } from 'vitest';

import {
  renderMarkdown, highlightCodeBlocks, linkifyFileRefs, aiPathIsText, escapeHtml, TRUST_LINKS_KEY,
} from '../../js/ai/chat_render.js';

afterEach(() => { delete window.katex; delete window.t; });

const html = (md) => renderMarkdown(md);
const dom = (md) => { const d = document.createElement('div'); d.innerHTML = html(md); return d; };

describe('realce de codigo', () => {
  it('comentario, texto, numero, chamada, palavra-chave e o resto', () => {
    const d = dom('```js\n// nota\n/* bloco */\n# diretiva\nconst x = foo("a", 0x1F, 3.5) + y;\n```');
    highlightCodeBlocks(d);
    const code = d.querySelector('code');
    expect(code.dataset.hl).toBe('1');
    const classes = (c) => Array.from(code.querySelectorAll(`.${c}`)).map((e) => e.textContent);
    expect(classes('hl-c')).toEqual(['// nota', '/* bloco */', '# diretiva']);
    expect(classes('hl-s')).toEqual(['"a"']);
    expect(classes('hl-n')).toEqual(['0x1F', '3.5']);
    expect(classes('hl-f')).toEqual(['foo']);
    expect(classes('hl-k')).toEqual(['const']);
    expect(code.textContent).toContain('+ y;');
    // Ja realcado nao e realcado de novo; sem container, nada.
    highlightCodeBlocks(d);
    highlightCodeBlocks(null);
  });

  it('bloco sem linguagem vira text; bloco aberto no fim do texto fecha sozinho', () => {
    expect(html('```\na\n```')).toContain('lang-text');
    expect(html('```py\nprint(1)')).toContain('<code class="lang-py">print(1)</code>');
  });
});

describe('matematica', () => {
  it('sem KaTeX: fracao, raizes, gregas, operadores, indices e espacos', () => {
    const s = html('$$\\frac{a}{b} + \\sqrt[3]{x} + \\sqrt{y} + \\alpha \\cdot \\beta^{2} + x_{i} + z^n + w_k\\,\\;\\foo$$');
    expect(s).toContain('<div class="ai-math ai-math-display">');
    expect(s).toContain('<span class="ai-frac"><span class="num">a</span><span class="den">b</span></span>');
    expect(s).toContain('<span class="ai-sqrt"><sup>3</sup>√<span class="rad">x</span></span>');
    expect(s).toContain('<span class="ai-sqrt">√<span class="rad">y</span></span>');
    expect(s).toContain('α · β<sup>2</sup>');
    expect(s).toContain('x<sub>i</sub>');
    expect(s).toContain('z<sup>n</sup>');
    expect(s).toContain('w<sub>k</sub>');
    expect(s).toContain('\\foo');
  });

  it('macros de texto viram texto, e a fonte e escapada antes de tudo', () => {
    const s = html('$E^{\\text{max}} = \\mathrm{V} < 3$');
    expect(s).toContain('<span class="ai-math">E<sup>max</sup> = V &lt; 3</span>');
    expect(html('$$<img src=x>$$')).toContain('&lt;img src=x&gt;');
  });

  it('delimitadores \\[ \\] e \\( \\), e $ so vira matematica com algum sinal de formula', () => {
    expect(html('veja \\[x^2\\] e \\(y_1\\)')).toContain('<div class="ai-math ai-math-display">x<sup>2</sup></div>');
    expect(html('veja \\(y_1\\)')).toContain('<span class="ai-math">y<sub>1</sub></span>');
    expect(html('custa $10 e $20')).not.toContain('ai-math');
    expect(html('a $x=1$ b')).toContain('<span class="ai-math">x=1</span>');
  });

  it('com KaTeX carregado, ele renderiza; se ele falha, volta o subconjunto', () => {
    window.katex = { renderToString: (src, o) => `<k data-d="${o.displayMode}">${src}</k>` };
    expect(html('$$x^2$$')).toContain('<div class="ai-math ai-math-display"><k data-d="true">x^2</k></div>');
    expect(html('$x^2$')).toContain('<span class="ai-math"><k data-d="false">x^2</k></span>');
    window.katex = { renderToString: () => { throw new Error('parse'); } };
    expect(html('$x^2$')).toContain('<span class="ai-math">x<sup>2</sup></span>');
  });
});

describe('texto em linha', () => {
  it('riscado, marcado, link http, link que nao e http, URL solta e caminho solto', () => {
    const s = html('~~velho~~ ==chave== [site](https://a.com/x) [local](file:///c) https://b.org/p. e C:\\p\\a.v, \\\\srv\\d\\x.txt');
    expect(s).toContain('<del>velho</del>');
    expect(s).toContain('<mark>chave</mark>');
    expect(s).toContain('<a href="#" class="ai-link" data-href="https://a.com/x">site</a>');
    expect(s).toContain(' local ');
    expect(s).toContain('<a href="#" class="ai-link" data-href="https://b.org/p">https://b.org/p</a>.');
    expect(s).toContain('<span class="ai-path" data-path="C:\\p\\a.v" title="Open">C:\\p\\a.v</span>,');
    expect(s).toContain('<span class="ai-path" data-path="\\\\srv\\d\\x.txt"');
  });

  it('caminho absoluto entre crases vira codigo clicavel; o resto, codigo simples', () => {
    expect(html('`C:\\p\\a.v`')).toContain('<code class="ai-path" data-path="C:\\p\\a.v" title="Open">C:\\p\\a.v</code>');
    expect(html('`a*b*c`')).toContain('<code>a*b*c</code>');
  });
});

describe('blocos', () => {
  it('titulos, linha horizontal e paragrafos', () => {
    expect(html('### Tres')).toBe('<h3>Tres</h3>');
    expect(html('a\n\n---\nb')).toBe('<p>a</p><hr class="ai-hr"><p>b</p>');
  });

  it('tabela com alinhamento, e barra dentro de crase nao divide a celula', () => {
    const s = html('| a | b | c | d |\n|:--|--:|:-:|---|\n| `x|y` | 2 | 3 | 4 |\nfim');
    expect(s).toContain('<th style="text-align:left">a</th><th style="text-align:right">b</th><th style="text-align:center">c</th><th>d</th>');
    expect(s).toContain('<td style="text-align:left"><code>x|y</code></td>');
    expect(s).toContain('</table></div><p>fim</p>');
    expect(html('a | b\n--|--\n1 | 2')).toContain('<th>a</th><th>b</th>');
  });

  it('citacao simples e avisos com e sem titulo, de cada tipo', () => {
    expect(html('> linha um\n> linha dois\n\ndepois')).toBe('<blockquote><p>linha um linha dois</p></blockquote><p>depois</p>');
    const aviso = (tipo, titulo = '') => dom(`> [!${tipo}] ${titulo}\n> corpo`).querySelector('.ai-callout');
    expect(aviso('NOTE').className).toBe('ai-callout ai-callout-note');
    expect(aviso('NOTE').querySelector('.ai-callout-head span').textContent).toBe('NOTE');
    expect(aviso('TIP', 'Dica boa').querySelector('.ai-callout-head').textContent).toBe('Dica boa');
    expect(aviso('WARNING').className).toContain('ai-callout-warn');
    expect(aviso('CAUTION').className).toContain('ai-callout-warn');
    expect(aviso('DANGER').className).toContain('ai-callout-danger');
    expect(aviso('IMPORTANT').className).toContain('ai-callout-danger');
    expect(aviso('IMPORTANT').querySelector('i').className).toBe('ph ph-x-octagon');
    expect(aviso('TIP').querySelector('.ai-callout-body').textContent).toBe('corpo');
    // Aviso so no comeco da citacao; depois, e texto.
    expect(html('> antes\n> [!NOTE] x')).toContain('<blockquote>');
    // Aviso sozinho no fim do texto tambem fecha.
    expect(html('> [!NOTE]')).toContain('ai-callout-note');
  });

  it('listas aninhadas, troca de tipo no mesmo nivel e tarefas', () => {
    expect(html('- a\n  - b\n- c')).toBe('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>');
    expect(html('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
    expect(html('- [ ] fazer\n- [x] feito')).toBe(
      '<ul><li class="ai-task"><i class="ph ph-square"></i><span>fazer</span></li>'
      + '<li class="ai-task done"><i class="ph ph-check-square-fill"></i><span>feito</span></li></ul>');
    expect(html('- a\ntexto')).toBe('<ul><li>a</li></ul><p>texto</p>');
  });

  it('texto vazio ou nulo nao gera nada; quebras de linha do Windows valem', () => {
    expect(html(null)).toBe('');
    expect(html('a\r\n\r\nb')).toBe('<p>a</p><p>b</p>');
  });
});

describe('referencias a arquivo', () => {
  it('codigo que e so uma referencia vira link, com a linha; codigo com markup ou que nao e arquivo, nao', () => {
    const d = document.createElement('div');
    d.innerHTML = '<p><code>my_proc.cmm:25</code> <code>obj.value</code> <code><b>x.v</b></code></p><pre><code>top.v</code></pre>';
    linkifyFileRefs(d);
    const refs = Array.from(d.querySelectorAll('.ai-file-ref'));
    expect(refs.map((r) => [r.dataset.file, r.dataset.line])).toEqual([['my_proc.cmm', '25']]);
    expect(refs[0].title).toBe('Open in editor');
    expect(d.querySelector('pre code').textContent).toBe('top.v');
  });

  it('no texto corrido: extensao conhecida, com caminho ou com linha; etc. e metodo nao', () => {
    window.t = (k) => (k === 'notification.ai.openInEditor' ? 'Abrir no editor' : k);
    const d = document.createElement('div');
    d.innerHTML = '<p>veja core.v e sim.xyz:3, etc. e obj.value <a>fora.v</a></p>';
    linkifyFileRefs(d);
    expect(Array.from(d.querySelectorAll('.ai-file-ref')).map((r) => r.textContent)).toEqual(['core.v', 'sim.xyz:3']);
    expect(d.querySelector('.ai-file-ref').title).toBe('Abrir no editor');
    expect(d.querySelector('p').textContent).toBe('veja core.v e sim.xyz:3, etc. e obj.value fora.v');
    linkifyFileRefs(null);
  });

  it('texto que so parece arquivo fica como estava', () => {
    const d = document.createElement('div');
    d.innerHTML = '<p>versao 1.2.3 de algo.desconhecido</p>';
    linkifyFileRefs(d);
    expect(d.querySelector('.ai-file-ref')).toBeNull();
  });
});

describe('utilitarios', () => {
  it('abre como texto so as extensoes de texto e codigo', () => {
    expect(aiPathIsText('C:/p/a.V')).toBe(true);
    expect(aiPathIsText('C:/p/run.log')).toBe(true);
    expect(aiPathIsText('C:/p/foto.png')).toBe(false);
    expect(aiPathIsText('C:/p/sem-extensao')).toBe(false);
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
    expect(TRUST_LINKS_KEY).toBe('aurora-ai-trust-external-links');
  });
});
