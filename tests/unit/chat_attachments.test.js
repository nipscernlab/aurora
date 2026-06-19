import { describe, it, expect } from 'vitest';
import {
    formatAttachmentSize, composerChipHtml, bubbleChipHtml,
} from '../../js/ai/chat_attachments.js';

// Marker fakes so tests can prove the escaper/formatter are actually applied.
const esc = (s) => `[${s}]`;
const fmt = (n) => `<${n}>`;

describe('formatAttachmentSize', () => {
    it('returns empty for null/undefined', () => {
        expect(formatAttachmentSize(null)).toBe('');
        expect(formatAttachmentSize(undefined)).toBe('');
    });
    it('formats bytes / KB / MB at the right thresholds', () => {
        expect(formatAttachmentSize(0)).toBe('0 B');
        expect(formatAttachmentSize(512)).toBe('512 B');
        expect(formatAttachmentSize(1024)).toBe('1 KB');
        expect(formatAttachmentSize(2048)).toBe('2 KB');
        expect(formatAttachmentSize(1024 * 1024)).toBe('1.0 MB');
        expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
});

describe('composerChipHtml', () => {
    it('renders an image chip with a thumbnail and no meta', () => {
        const html = composerChipHtml(
            { id: 'a1', kind: 'image', name: 'pic.png', dataUrl: 'data:x' }, esc, fmt);
        expect(html).toContain('is-image');
        expect(html).toContain('<img class="ai-att-thumb" src="data:x"');
        expect(html).toContain('data-id="a1"');
        expect(html).not.toContain('ai-att-meta'); // images have no size meta
        expect(html).toContain('[pic.png]'); // name went through esc
    });
    it('renders a file chip with size meta (and clipped marker)', () => {
        const html = composerChipHtml(
            { id: 'a2', kind: 'file', name: 'big.txt', size: 4096, clipped: true }, esc, fmt);
        expect(html).not.toContain('is-image');
        expect(html).toContain('ph-file-text');
        expect(html).toContain('<4096>'); // size went through fmt
        expect(html).toContain(' · clipped');
        expect(html).toContain('[big.txt]');
    });
});

describe('bubbleChipHtml', () => {
    it('renders a large thumbnail when the image payload is still present', () => {
        const html = bubbleChipHtml(
            { kind: 'image', name: 'pic.png', dataUrl: 'data:y' }, esc, fmt);
        expect(html).toContain('ai-att-thumb-lg');
        expect(html).toContain('src="data:y"');
        expect(html).toContain('[pic.png]');
    });
    it('falls back to a name+icon chip when an image payload was dropped', () => {
        const html = bubbleChipHtml({ kind: 'image', name: 'gone.png' }, esc, fmt);
        expect(html).not.toContain('<img');
        expect(html).toContain('ph-image');
        expect(html).toContain('[gone.png]');
    });
    it('renders a file chip with size meta', () => {
        const html = bubbleChipHtml({ kind: 'file', name: 'a.log', size: 800 }, esc, fmt);
        expect(html).toContain('ph-file-text');
        expect(html).toContain('<800>');
        expect(html).toContain('ai-att-meta');
    });
});
