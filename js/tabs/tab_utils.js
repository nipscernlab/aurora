// tab_utils.js: pure filename/string helpers for the tab manager (extracted
// from tab_manager.js, A2 god-file decomposition). No TabManager state, no DOM:
// basename/extension parsing, key normalization, name sanitizers, the C±
// (.cmm) starter template, file-type/icon detection, and save-name
// validation. Imported back into tab_manager.js for internal use.

import { getExtensionForDocumentType } from '../editor/document_type_detector.js';

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

// ---------------------------------------------------------------------------
// File-type detection + icon mapping, extracted from TabManager (these were
// static methods + the imageExtensions/pdfExtensions sets). Pure: no
// TabManager state, no DOM. TabManager keeps thin static delegators
// (getFileIcon has external callers; isImageFile/isPdfFile/isBinaryFile are
// called internally as this.X).

// Image and PDF extensions
export const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']);
export const pdfExtensions = new Set(['pdf']);

// Utility method to check if file is an image
export function isImageFile(filePath) {
    const extension = filePath.split('.')
        .pop()
        .toLowerCase();
    return imageExtensions.has(extension);
}

// Utility method to check if file is a PDF
export function isPdfFile(filePath) {
    const extension = filePath.split('.')
        .pop()
        .toLowerCase();
    return pdfExtensions.has(extension);
}

// Utility method to check if file is binary (image or PDF)
export function isBinaryFile(filePath) {
    return isImageFile(filePath) || isPdfFile(filePath);
}

// getFileIcon, returns Phosphor classes (no FA dependency)
export function getFileIcon(filename) {
    const extension = filename.split('.').pop().toLowerCase();

    // Images
    if (imageExtensions.has(extension)) {
        return extension === 'svg' ? 'ph ph-file-svg' : 'ph ph-file-image';
    }

    if (extension === 'pdf') return 'ph ph-file-pdf';

    const iconMap = {
        // SAPHO/AURORA file types, distinctive icons per family so the
        // hardware toolchain reads at a glance (Verilog = a chip, C± = a
        // custom C±-lettered document, assembly = binary, waves = waveform).
        'cmm':       'aurora-icon-cmm',
        'asm':       'ph ph-binary',
        'v':         'ph ph-cpu',
        'vh':        'ph ph-cpu',
        'sv':        'ph ph-cpu',
        'gtkw':      'ph ph-waveform',
        'vcd':       'ph ph-waveform',
        'fst':       'ph ph-waveform',
        'mif':       'ph ph-database',
        'spf':       'ph ph-package',

        // JS/TS
        'js':   'ph ph-file-js',
        'jsx':  'ph ph-file-jsx',
        'ts':   'ph ph-file-ts',
        'tsx':  'ph ph-file-tsx',
        'mjs':  'ph ph-file-js',
        'vue':  'ph ph-file-vue',

        // Web
        'html': 'ph ph-file-html',
        'htm':  'ph ph-file-html',
        'css':  'ph ph-file-css',
        'scss': 'ph ph-file-css',
        'sass': 'ph ph-file-css',
        'less': 'ph ph-file-css',

        // Data
        'json': 'ph ph-brackets-curly',
        'xml':  'ph ph-file-code',
        'yaml': 'ph ph-file-code',
        'yml':  'ph ph-file-code',
        'toml': 'ph ph-file-code',

        // Docs
        'md':       'ph ph-file-md',
        'markdown': 'ph ph-file-md',
        'txt':      'ph ph-file-text',
        'rtf':      'ph ph-file-text',

        // Other languages
        'py':    'ph ph-file-py',
        'm':     'ph ph-function',   // MATLAB / Octave
        'java':  'ph ph-file-code',
        'c':     'ph ph-file-c',
        'cpp':   'ph ph-file-cpp',
        'cc':    'ph ph-file-cpp',
        'cxx':   'ph ph-file-cpp',
        // Phosphor has no ph-file-h, headers borrow the C/C++ document.
        'h':     'ph ph-file-c',
        'hpp':   'ph ph-file-cpp',
        'hh':    'ph ph-file-cpp',
        'hxx':   'ph ph-file-cpp',
        'cs':    'ph ph-file-c-sharp',
        'php':   'ph ph-file-code',
        'rb':    'ph ph-file-code',
        'go':    'ph ph-file-code',
        'rs':    'ph ph-file-rs',
        'swift': 'ph ph-file-code',
        'kt':    'ph ph-file-code',
        'scala': 'ph ph-file-code',

        // Shell
        'sh':   'ph ph-terminal',
        'bash': 'ph ph-terminal',
        'zsh':  'ph ph-terminal',
        'fish': 'ph ph-terminal',
        'ps1':  'ph ph-terminal',
        'bat':  'ph ph-terminal',
        'cmd':  'ph ph-terminal',

        // Config
        'ini':    'ph ph-gear',
        'conf':   'ph ph-gear',
        'config': 'ph ph-gear',
        'env':    'ph ph-gear',

        // Archive
        'zip': 'ph ph-file-zip',
        'rar': 'ph ph-file-zip',
        '7z':  'ph ph-file-zip',
        'tar': 'ph ph-file-zip',
        'gz':  'ph ph-file-zip',

        // Audio
        'mp3':  'ph ph-file-audio',
        'wav':  'ph ph-file-audio',
        'flac': 'ph ph-file-audio',
        'ogg':  'ph ph-file-audio',

        // Video
        'mp4': 'ph ph-file-video',
        'avi': 'ph ph-file-video',
        'mkv': 'ph ph-file-video',
        'mov': 'ph ph-file-video',

        // Office
        'doc':  'ph ph-file-doc',
        'docx': 'ph ph-file-doc',
        'xls':  'ph ph-file-xls',
        'xlsx': 'ph ph-file-xls',
        'ppt':  'ph ph-file-ppt',
        'pptx': 'ph ph-file-ppt'
    };

    return iconMap[extension] || 'ph ph-file';
}

// ---------------------------------------------------------------------------
// Save-name validation, extracted from TabManager (static, pure). Maps a
// requested path to a default extension and validates the base name per
// language (verilog/python/processor). No state, no DOM.

const VALID_VERILOG_FILENAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_PYTHON_MODULE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_PROCESSOR_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function appendDefaultExtension(filePath, documentType) {
    if (/\.(?:py|v|cmm)$/i.test(filePath)) return filePath;
    const extension = getExtensionForDocumentType(documentType) || 'v';
    return `${filePath}.${extension}`;
}

export function validateSaveName(filePath) {
    const ext = extensionOf(filePath);
    const baseName = withoutExtension(basenameOf(filePath));
    if (ext === 'py' && !VALID_PYTHON_MODULE_RE.test(baseName)) {
        return {
            ok: false,
            suggestion: `${sanitizePythonModuleName(baseName)}.py`,
        };
    }
    if (ext === 'v' && !VALID_VERILOG_FILENAME_RE.test(baseName)) {
        return {
            ok: false,
            suggestion: `${sanitizeVerilogFileName(baseName)}.v`,
        };
    }
    if (ext === 'cmm' && !VALID_PROCESSOR_NAME_RE.test(baseName)) {
        return {
            ok: false,
            suggestion: `${sanitizeProcessorName(baseName)}.cmm`,
        };
    }
    return { ok: true };
}
