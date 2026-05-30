const TYPE_META = Object.freeze({
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

const CMM_DIRECTIVE_RE = /^#(?:PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN)\b/i;
const COMMENT_ONLY_RE = /^(?:\/\/|#(?!!)|\/\*|\*)/;

function firstMeaningfulLine(content) {
    const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (CMM_DIRECTIVE_RE.test(line)) return line;
        if (COMMENT_ONLY_RE.test(line)) continue;
        return line;
    }
    return '';
}

export function detectDocumentType(content) {
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

export function getLanguageForDocumentType(type) {
    return TYPE_META[type]?.language || 'plaintext';
}

export function getExtensionForDocumentType(type) {
    return TYPE_META[type]?.extension || null;
}

export function getDefaultBaseNameForDocumentType(type) {
    return TYPE_META[type]?.defaultBaseName || 'untitled';
}

export function getSaveDialogFilters(type, { includeCmmFallback = false } = {}) {
    if (type === 'cmm') return [TYPE_META.cmm.filter, TYPE_META.verilog.filter, TYPE_META.python.filter];
    if (type === 'python') return [TYPE_META.python.filter, TYPE_META.verilog.filter];
    if (type === 'verilog') return [TYPE_META.verilog.filter, TYPE_META.python.filter];
    const fallbackFilters = [TYPE_META.verilog.filter, TYPE_META.python.filter];
    return includeCmmFallback ? [...fallbackFilters, TYPE_META.cmm.filter] : fallbackFilters;
}
