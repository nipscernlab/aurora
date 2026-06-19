import { describe, it, expect } from 'vitest';
import {
    basenameOf, withoutExtension, extensionOf, normalizeKey,
    sanitizeVerilogFileName, sanitizePythonModuleName, sanitizeProcessorName,
    createCmmTemplate, ensureCmmPrname, typeFromExtension,
} from '../../js/tabs/tab_utils.js';

describe('path helpers', () => {
    it('basenameOf strips dirs (both separators) and tolerates empty', () => {
        expect(basenameOf('/a/b/c.v')).toBe('c.v');
        expect(basenameOf('a\\b\\c.v')).toBe('c.v');
        expect(basenameOf('')).toBe('');
    });
    it('withoutExtension drops the last extension only', () => {
        expect(withoutExtension('c.v')).toBe('c');
        expect(withoutExtension('a.b.c')).toBe('a.b');
        expect(withoutExtension('noext')).toBe('noext');
    });
    it('extensionOf lowercases and returns empty when none', () => {
        expect(extensionOf('c.V')).toBe('v');
        expect(extensionOf('A/B/c.CMM')).toBe('cmm');
        expect(extensionOf('noext')).toBe('');
    });
    it('normalizeKey forward-slashes and lowercases', () => {
        expect(normalizeKey('A\\B\\C.V')).toBe('a/b/c.v');
    });
});

describe('name sanitizers', () => {
    it('verilog: collapses junk, strips accents, falls back to untitled', () => {
        expect(sanitizeVerilogFileName('my proc!!')).toBe('my_proc');
        expect(sanitizeVerilogFileName('ção')).toBe('cao');
        expect(sanitizeVerilogFileName('')).toBe('untitled');
    });
    it('python: ensures a valid module id (prefix when starting with a digit)', () => {
        expect(sanitizePythonModuleName('123abc')).toBe('test_123abc');
        expect(sanitizePythonModuleName('My Mod')).toBe('My_Mod');
        expect(sanitizePythonModuleName('')).toBe('test_dut');
    });
    it('processor: keeps hyphen/underscore, falls back to processor', () => {
        expect(sanitizeProcessorName('Proc X')).toBe('Proc_X');
        expect(sanitizeProcessorName('a-b_c')).toBe('a-b_c');
        expect(sanitizeProcessorName('')).toBe('processor');
    });
});

describe('typeFromExtension', () => {
    it('maps the SAPHO source extensions, null otherwise', () => {
        expect(typeFromExtension('x.py')).toBe('python');
        expect(typeFromExtension('x.v')).toBe('verilog');
        expect(typeFromExtension('x.cmm')).toBe('cmm');
        expect(typeFromExtension('x.txt')).toBeNull();
    });
});

describe('cmm template', () => {
    it('createCmmTemplate stamps the name + default header', () => {
        const t = createCmmTemplate('Foo');
        expect(t).toContain('#PRNAME Foo');
        expect(t).toContain('#NUBITS 23');
        expect(t).toContain('void main()');
    });
    it('ensureCmmPrname rewrites an existing #PRNAME', () => {
        expect(ensureCmmPrname('#PRNAME Old\nvoid main(){}', 'New'))
            .toContain('#PRNAME New');
    });
    it('ensureCmmPrname prepends #PRNAME when missing', () => {
        const out = ensureCmmPrname('void main(){}', 'New');
        expect(out.startsWith('#PRNAME New')).toBe(true);
    });
    it('ensureCmmPrname uses the template for empty content', () => {
        const out = ensureCmmPrname('   ', 'Empty');
        expect(out).toContain('#PRNAME Empty');
        expect(out).toContain('#NUBITS 23');
    });
});
