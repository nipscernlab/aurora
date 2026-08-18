/**
 * document_type_detector.ts: sniff a document's language (python / verilog /
 * cmm) from its first meaningful line, plus the per-type metadata used by the
 * editor and save dialogs.
 *
 * Compilado por `tsc` (npm run build:ts) num document_type_detector.js ao lado:
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

export type DocumentType = 'python' | 'verilog' | 'cmm';

interface SaveFilter {
    name: string;
    extensions: string[];
}

interface TypeMeta {
    language: string;
    extension: string;
    defaultBaseName: string;
    filter: SaveFilter;
}

const TYPE_META: Record<DocumentType, TypeMeta> = Object.freeze({
    python: {
        language: 'python',
        extension: 'py',
        defaultBaseName: 'test_dut',
        filter: { name: 'Python Files', extensions: ['py'] },
    },
    verilog: {
        language: 'verilog',
        extension: 'v',
        defaultBaseName: 'untitled',
        filter: { name: 'Verilog Files', extensions: ['v'] },
    },
    cmm: {
        language: 'cmm',
        extension: 'cmm',
        defaultBaseName: 'processor',
        filter: { name: 'CMM Files', extensions: ['cmm'] },
    },
});

/** Narrow an arbitrary string to a known TypeMeta, or undefined. */
function metaFor(type: string | null | undefined): TypeMeta | undefined {
    if (type === 'python' || type === 'verilog' || type === 'cmm') return TYPE_META[type];
    return undefined;
}

const CMM_DIRECTIVE_RE = /^#(?:PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN)\b/i;
const COMMENT_ONLY_RE = /^(?:\/\/|#(?!!)|\/\*|\*)/;

function firstMeaningfulLine(content: string): string {
    let text = String(content || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip leading BOM
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (CMM_DIRECTIVE_RE.test(line)) return line;
        if (COMMENT_ONLY_RE.test(line)) continue;
        return line;
    }
    return '';
}

export function detectDocumentType(content: string): DocumentType | null {
    const firstLine = firstMeaningfulLine(content);
    if (!firstLine) return null;

    if (firstLine === '$cmm') {
        return 'cmm';
    }

    if (/^#!.*\bpython(?:\d+(?:\.\d+)*)?\b/i.test(firstLine)) {
        return 'python';
    }

    if (CMM_DIRECTIVE_RE.test(firstLine)) {
        return 'cmm';
    }

    if (/^void\s+main\s*\(/i.test(firstLine)) {
        return 'cmm';
    }

    if (/^`(?:timescale|default_nettype|include|define|ifdef|ifndef|endif)\b/i.test(firstLine)) {
        return 'verilog';
    }

    if (/^(?:module|interface|program|package|primitive)\s+[\\A-Za-z_$][\w$]*/i.test(firstLine)) {
        return 'verilog';
    }

    if (/^(?:import\s+cocotb\b|from\s+cocotb\b|@\s*cocotb\.test\b)/i.test(firstLine)) {
        return 'python';
    }

    if (/^(?:async\s+def|def|class)\s+[A-Za-z_]\w*/.test(firstLine)) {
        return 'python';
    }

    if (/^from\s+[A-Za-z_][\w.]*\s+import\s+/.test(firstLine)) {
        return 'python';
    }

    if (/^import\s+[A-Za-z_][\w.]*\s*(?:,|$)/.test(firstLine)) {
        return 'python';
    }

    return null;
}

export function getLanguageForDocumentType(type: string | null | undefined): string {
    return metaFor(type)?.language || 'plaintext';
}

export function getExtensionForDocumentType(type: string | null | undefined): string | null {
    return metaFor(type)?.extension || null;
}

export function getDefaultBaseNameForDocumentType(type: string | null | undefined): string {
    return metaFor(type)?.defaultBaseName || 'untitled';
}

export function getSaveDialogFilters(
    type: string | null | undefined,
    { includeCmmFallback = false }: { includeCmmFallback?: boolean } = {},
): SaveFilter[] {
    if (type === 'cmm') return [TYPE_META.cmm.filter, TYPE_META.verilog.filter, TYPE_META.python.filter];
    if (type === 'python') return [TYPE_META.python.filter, TYPE_META.verilog.filter];
    if (type === 'verilog') return [TYPE_META.verilog.filter, TYPE_META.python.filter];
    const fallbackFilters = [TYPE_META.verilog.filter, TYPE_META.python.filter];
    return includeCmmFallback ? [...fallbackFilters, TYPE_META.cmm.filter] : fallbackFilters;
}
