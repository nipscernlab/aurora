// tab_utils.js — pure filename/string helpers for the tab manager (extracted
// from tab_manager.js, A2 god-file decomposition). No TabManager state, no DOM:
// basename/extension parsing, key normalization, name sanitizers, and the C±
// (.cmm) starter template. Imported back into tab_manager.js for internal use.

const CMM_DEFAULTS = Object.freeze({
    nBits: 23,
    dataStackSize: 5,
    instructionStackSize: 5,
    inputPorts: 1,
    outputPorts: 1,
    nbMantissa: 16,
    nbExponent: 6,
    gain: 128,
});

export function basenameOf(filePath) {
    return String(filePath || '').split(/[\\/]/).pop();
}

export function withoutExtension(fileName) {
    return String(fileName || '').replace(/\.[^.\\/]+$/, '');
}

export function extensionOf(filePath) {
    const match = String(filePath || '').match(/\.([^.\\/]+)$/);
    return match ? match[1].toLowerCase() : '';
}

export function normalizeKey(filePath) {
    return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

export function sanitizeVerilogFileName(baseName) {
    const cleaned = String(baseName || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'untitled';
}

export function sanitizePythonModuleName(baseName) {
    let cleaned = String(baseName || 'test_dut')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!cleaned) cleaned = 'test_dut';
    if (!/^[a-zA-Z_]/.test(cleaned)) cleaned = `test_${cleaned}`;
    return cleaned;
}

export function sanitizeProcessorName(baseName) {
    const cleaned = String(baseName || 'processor')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '');
    return cleaned || 'processor';
}

export function createCmmTemplate(processorName = 'processor') {
    return `#PRNAME ${processorName}
#NUBITS ${CMM_DEFAULTS.nBits}
#NDSTAC ${CMM_DEFAULTS.dataStackSize}
#SDEPTH ${CMM_DEFAULTS.instructionStackSize}
#NUIOIN ${CMM_DEFAULTS.inputPorts}
#NUIOOU ${CMM_DEFAULTS.outputPorts}
#NBMANT ${CMM_DEFAULTS.nbMantissa}
#NBEXPO ${CMM_DEFAULTS.nbExponent}
#NUGAIN ${CMM_DEFAULTS.gain}

void main()
{
    // Øk. Você criou um processador em C±, mas e agora?
}
`;
}

export function ensureCmmPrname(content, processorName) {
    const source = String(content || '').trim()
        ? String(content)
        : createCmmTemplate(processorName);
    if (/^#PRNAME\s+.+$/mi.test(source)) {
        return source.replace(/^#PRNAME\s+.+$/mi, `#PRNAME ${processorName}`);
    }
    return `#PRNAME ${processorName}\n${source.replace(/^\s+/, '')}`;
}

export function typeFromExtension(filePath) {
    const ext = extensionOf(filePath);
    if (ext === 'py') return 'python';
    if (ext === 'v') return 'verilog';
    if (ext === 'cmm') return 'cmm';
    return null;
}
