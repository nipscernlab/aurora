import { describe, it, expect } from 'vitest';
import { chatListHtml, serializeMessagesForStorage } from '../../js/ai/chat_history.js';

describe('chatListHtml', () => {
    it('shows the empty state when there are no chats', () => {
        expect(chatListHtml([], null)).toContain('No saved chats yet.');
    });
    it('marks the current chat active and renders title + token total', () => {
        const html = chatListHtml(
            [{ id: 'c1', title: 'Hello', provider: 'acme', updatedAt: 0, cumulativeTokens: 1500 }],
            'c1');
        expect(html).toContain('ai-history-item active');
        expect(html).toContain('data-chat-id="c1"');
        expect(html).toContain('Hello');
        expect(html).toContain('tok'); // token badge present when > 0
    });
    it('omits the token badge when the total is zero, and is not active when not current', () => {
        const html = chatListHtml(
            [{ id: 'c1', title: 'X', provider: 'acme', updatedAt: 0, cumulativeTokens: 0 }],
            'other');
        expect(html).not.toContain('ai-history-item active');
        expect(html).not.toContain('tok');
    });
    it('escapes the chat title (XSS guard)', () => {
        const html = chatListHtml(
            [{ id: 'c1', title: '<img src=x onerror=alert(1)>', provider: 'a', updatedAt: 0, cumulativeTokens: 0 }],
            'c1');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;img');
    });
});

describe('serializeMessagesForStorage', () => {
    it('keeps the full breadcrumb for tool entries', () => {
        const out = serializeMessagesForStorage([
            { role: 'tool', toolName: 'read_file', status: 'done', toolUseId: 't1', args: { p: 1 }, result: 'ok' },
        ]);
        expect(out[0]).toEqual({
            role: 'tool', toolName: 'read_file', status: 'done', toolUseId: 't1', args: { p: 1 }, result: 'ok',
        });
    });
    it('drops attachment payloads, keeping only lightweight metadata', () => {
        const out = serializeMessagesForStorage([
            { role: 'user', content: 'hi', attachments: [
                { kind: 'image', name: 'p.png', mime: 'image/png', size: 9, dataUrl: 'data:HUGE', clipped: false },
            ] },
        ]);
        expect(out[0].content).toBe('hi');
        expect(out[0].attachments[0]).toEqual({ kind: 'image', name: 'p.png', mime: 'image/png', size: 9 });
        expect(out[0].attachments[0].dataUrl).toBeUndefined();
    });
    it('does not mutate the input messages', () => {
        const input = [{ role: 'user', content: 'x', attachments: [{ kind: 'file', name: 'a', dataUrl: 'd' }] }];
        serializeMessagesForStorage(input);
        expect(input[0].attachments[0].dataUrl).toBe('d'); // original untouched
    });
});
