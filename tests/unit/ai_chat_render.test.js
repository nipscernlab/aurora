import { describe, it, expect } from 'vitest';
import { escapeHtml, renderMarkdown, aiPathIsText } from '../../js/ai/chat_render.js';

// The DOM-driven entry points (highlightCodeBlocks / linkifyFileRefs /
// makeFileRefSpan) need a real document and are exercised in the live app; here
// we cover the PURE string pipeline (escape + markdown + path classification),
// including the XSS-escaping guard.

describe('escapeHtml', () => {
    it('escapes the HTML-significant characters', () => {
        expect(escapeHtml('<a>&"\'')).toBe('&lt;a&gt;&amp;&quot;&#39;');
    });
});

describe('renderMarkdown', () => {
    it('renders a heading', () => {
        expect(renderMarkdown('# Hi')).toBe('<h1>Hi</h1>');
    });
    it('renders inline bold inside a paragraph', () => {
        expect(renderMarkdown('a **b** c')).toBe('<p>a <strong>b</strong> c</p>');
    });
    it('renders an unordered list', () => {
        expect(renderMarkdown('- x\n- y')).toBe('<ul><li>x</li><li>y</li></ul>');
    });
    it('renders a fenced code block with a copy header', () => {
        const html = renderMarkdown('```\ncode\n```');
        expect(html).toContain('ai-code-block');
        expect(html).toContain('<pre><code class="lang-text">code</code></pre>');
    });
    it('escapes raw HTML in prose (XSS guard)', () => {
        const html = renderMarkdown('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
    });
});

describe('aiPathIsText', () => {
    it('classifies known text-openable vs binary extensions', () => {
        expect(aiPathIsText('foo.v')).toBe(true);
        expect(aiPathIsText('a.txt')).toBe(true);
        expect(aiPathIsText('x.png')).toBe(false);
    });
});
