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

    // The block is rebuilt every turn, so an empty one would be paid for on
    // every turn of every project, it has to cost nothing on the common path.
    describe('project memory', () => {
        const mem = (n) => Array.from({ length: n }, (_, i) => ({ name: `m${i}`, content: `fact ${i}` }));

        it('says nothing at all when there are no memories', () => {
            for (const empty of [undefined, null, []]) {
                expect(buildProjectContext('C:/proj', null, empty)).not.toContain('PROJECT MEMORY');
            }
        });
        it('injects each memory with its name and content', () => {
            const ctx = buildProjectContext('C:/proj', null, [
                { name: 'porta-adc-q20', content: 'fin() converte int→float; tudo no barramento é Q20.' },
            ]);
            expect(ctx).toContain('PROJECT MEMORY');
            expect(ctx).toContain('[porta-adc-q20]');
            expect(ctx).toContain('tudo no barramento é Q20.');
        });
        it('tells the model the code wins when a memory goes stale', () => {
            const ctx = buildProjectContext('C:/proj', null, mem(1));
            expect(ctx).toContain('the code wins');
        });
        it('never silently truncates — it says how many it dropped', () => {
            const big = Array.from({ length: 40 }, (_, i) => ({ name: `m${i}`, content: 'x'.repeat(400) }));
            const ctx = buildProjectContext('C:/proj', null, big);
            expect(ctx).toMatch(/\(\+\d+ more memory\/memories not shown/);
            expect(ctx.length).toBeLessThan(8000);
        });
        it('does not add the dropped notice when everything fits', () => {
            const ctx = buildProjectContext('C:/proj', null, mem(3));
            expect(ctx).not.toContain('not shown');
            expect(ctx).toContain('[m2]');
        });
    });
});
