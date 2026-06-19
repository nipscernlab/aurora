import { describe, it, expect } from 'vitest';
import {
    isUntitled, untitledDisplayName, nextUntitledPath, UNTITLED_PREFIX,
} from '../../js/tabs/untitled_docs.js';

describe('isUntitled', () => {
    it('is true only for paths registered in the untitledDocuments map', () => {
        const docs = new Map([['Untitled-1', { detectedType: null }]]);
        expect(isUntitled(docs, 'Untitled-1')).toBe(true);
        expect(isUntitled(docs, '/real/file.v')).toBe(false);
        expect(isUntitled(new Map(), 'Untitled-1')).toBe(false);
    });
});

describe('untitledDisplayName', () => {
    it('appends the detected extension to an untitled doc once typed', () => {
        const docs = new Map([['Untitled-1', { detectedType: 'verilog' }]]);
        expect(untitledDisplayName(docs, 'Untitled-1')).toBe('Untitled-1.v');
    });
    it('maps each detected type to its extension', () => {
        const docs = new Map([
            ['Untitled-1', { detectedType: 'cmm' }],
            ['Untitled-2', { detectedType: 'python' }],
        ]);
        expect(untitledDisplayName(docs, 'Untitled-1')).toBe('Untitled-1.cmm');
        expect(untitledDisplayName(docs, 'Untitled-2')).toBe('Untitled-2.py');
    });
    it('shows the bare path while the type is still undetected', () => {
        const docs = new Map([['Untitled-1', { detectedType: null }]]);
        expect(untitledDisplayName(docs, 'Untitled-1')).toBe('Untitled-1');
    });
    it('shows the basename for a saved (non-untitled) file', () => {
        const docs = new Map();
        expect(untitledDisplayName(docs, '/a/b/core.v')).toBe('core.v');
        expect(untitledDisplayName(docs, 'a\\b\\proc.cmm')).toBe('proc.cmm');
    });
});

describe('nextUntitledPath', () => {
    it('advances the counter from its current value', () => {
        expect(nextUntitledPath(new Map(), new Map(), 0))
            .toEqual({ filePath: `${UNTITLED_PREFIX}1`, counter: 1 });
        expect(nextUntitledPath(new Map(), new Map(), 5))
            .toEqual({ filePath: `${UNTITLED_PREFIX}6`, counter: 6 });
    });
    it('skips a name already live as a tab', () => {
        const tabs = new Map([['Untitled-1', '']]);
        expect(nextUntitledPath(new Map(), tabs, 0))
            .toEqual({ filePath: 'Untitled-2', counter: 2 });
    });
    it('skips a name already live as an untitled doc', () => {
        const docs = new Map([['Untitled-1', {}], ['Untitled-2', {}]]);
        expect(nextUntitledPath(docs, new Map(), 0))
            .toEqual({ filePath: 'Untitled-3', counter: 3 });
    });
});
