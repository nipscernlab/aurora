import { describe, expect, it } from 'vitest';
import {
    detectDocumentType,
    getExtensionForDocumentType,
    getLanguageForDocumentType,
    getSaveDialogFilters,
} from '../../js/editor/document_type_detector.ts';

describe('document type detector', () => {
    it('detects cocotb Python files from the first import', () => {
        expect(detectDocumentType('import cocotb\nfrom cocotb.triggers import Timer\n'))
            .toBe('python');
    });

    it('detects Verilog modules from the first declaration', () => {
        expect(detectDocumentType('module counter(input clk, output q);\nendmodule\n'))
            .toBe('verilog');
    });

    it('detects CMM snippets and directive blocks', () => {
        expect(detectDocumentType('$cmm')).toBe('cmm');
        expect(detectDocumentType('#PRNAME my_proc\n#NUBITS 23\n')).toBe('cmm');
    });

    it('skips leading comments before detecting the source type', () => {
        expect(detectDocumentType('// draft\n\nmodule top;\nendmodule\n')).toBe('verilog');
        expect(detectDocumentType('# draft\n\nfrom cocotb.triggers import Timer\n')).toBe('python');
    });

    it('leaves unknown content unresolved', () => {
        expect(detectDocumentType('this is not enough yet')).toBeNull();
    });

    it('maps detected types to Monaco languages and save extensions', () => {
        expect(getLanguageForDocumentType('python')).toBe('python');
        expect(getLanguageForDocumentType('cmm')).toBe('cmm');
        expect(getExtensionForDocumentType('verilog')).toBe('v');
        expect(getExtensionForDocumentType('cmm')).toBe('cmm');
        expect(getSaveDialogFilters(null).map((filter) => filter.extensions[0]))
            .toEqual(['v', 'py']);
        expect(getSaveDialogFilters(null, { includeCmmFallback: true }).map((filter) => filter.extensions[0]))
            .toEqual(['v', 'py', 'cmm']);
    });
});
