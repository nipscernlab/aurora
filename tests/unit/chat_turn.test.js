import { describe, it, expect } from 'vitest';
import { buildApiMessages, buildProjectContext } from '../../js/ai/chat_turn.js';

describe('buildApiMessages', () => {
    it('drops display-only tool entries', () => {
        const out = buildApiMessages([
            { role: 'user', content: 'hi' },
            { role: 'tool', toolName: 'read_file', status: 'done' },
            { role: 'assistant', content: 'yo' },
        ]);
        expect(out).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'yo' },
        ]);
    });
    it('clones attachments so a later strip of the source cannot empty the sent copy', () => {
        const source = [
            { role: 'user', content: 'see this', attachments: [{ kind: 'image', name: 'p.png', dataUrl: 'data:KEEP' }] },
        ];
        const out = buildApiMessages(source);
        // Simulate the post-send memory-hygiene strip on the SOURCE.
        for (const a of source[0].attachments) delete a.dataUrl;
        expect(out[0].attachments[0].dataUrl).toBe('data:KEEP'); // sent copy still has the payload
        expect(out[0].attachments).not.toBe(source[0].attachments); // distinct array
    });
});

describe('buildProjectContext', () => {
    it('injects the project root (and spf when present)', () => {
        const ctx = buildProjectContext('C:/proj', 'C:/proj/app.spf');
        expect(ctx).toContain('ACTIVE AURORA PROJECT');
        expect(ctx).toContain('project_root: C:/proj');
        expect(ctx).toContain('spf_file:     C:/proj/app.spf');
    });
    it('omits the spf line when there is no spf path', () => {
        const ctx = buildProjectContext('C:/proj', null);
        expect(ctx).toContain('project_root: C:/proj');
        expect(ctx).not.toContain('spf_file:');
    });
    it('emits the no-project notice when no project is open', () => {
        const ctx = buildProjectContext(null, null);
        expect(ctx).toContain('NO PROJECT IS CURRENTLY OPEN');
        expect(ctx).not.toContain('ACTIVE AURORA PROJECT');
    });
});
