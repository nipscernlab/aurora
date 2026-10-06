/**
 * linguagens_do_editor.ts: o que a AURORA ensina ao Monaco. As linguagens que
 * o pacote do Monaco nao traz (C+-, o assembly do SAPHO e MATLAB/Octave), com
 * os tokenizadores Monarch, e os temas da casa (cmm-dark, cmm-light, asm-dark,
 * asm-light).
 *
 * Saiu do monaco_editor.js em 06/10/2026, sem mudar nenhuma regra. Cada
 * funcao recebe o objeto do Monaco em vez de ler o global, o que deixa o
 * registro testavel com um Monaco de mentira.
 */

import type * as Monaco from 'monaco-editor';
import { registrarSnippetsDirac } from './dirac_snippets.js';

type Monaco_ = typeof Monaco;

export function setupASMLanguage(monaco: Monaco_) {
    monaco.languages.register({ id: 'asm' });

    monaco.languages.setMonarchTokensProvider('asm', {
        defaultToken: '',
        tokenPostfix: '.asm',

        directives: [
            'PRNAME', 'NUBITS', 'NBMANT', 'NBEXPO', 'NDSTAC', 'SDEPTH',
            'NUIOIN', 'NUIOOU', 'NUGAIN', 'FROUND', 'FFTSIZ', 'array', 'arrays', 'ITRAD', 'TOAQUI'
        ],

        instructions: [
            'LOD', 'P_LOD', 'LDI', 'ILI', 'SET', 'SET_P', 'SRF', 'IRF', 'PSH', 'POP', 
            'P_LOD_V', 'MLT_V', 'F_MLT_V', 'INN', 'OUT', 'STI', 'ISI', 'PST', 'PST_M', 
            'ADD', 'S_ADD', 'F_ADD', 'SF_ADD', 'P_PST_M', 'MLT', 'S_MLT', 'F_MLT', 
            'SF_MLT', 'F_PST', 'DIV', 'S_DIV', 'F_DIV', 'SF_DIV', 'F_PST_M', 'MOD', 
            'S_MOD', 'PF_PST_M', 'ADD_V', 'SGN', 'S_SGN', 'F_SGN', 'SF_SGN', 'F_ADD_V', 
            'NEG', 'NEG_M', 'P_NEG_M', 'F_NEG', 'F_NEG_M', 'PF_NEG_M', 'ABS', 'ABS_M', 
            'P_ABS_M', 'F_ABS', 'F_ABS_M', 'PF_ABS_M', 'NRM', 'NRM_M', 'P_NRM_M', 'P_INN', 
            'NOP', 'I2F', 'I2F_M', 'P_I2F_M', 'F2I', 'F2I_M', 'P_F2I_M', 'AND', 'S_AND', 
            'ORR', 'S_ORR', 'XOR', 'S_XOR', 'INV', 'INV_M', 'P_INV_M', 'LAN', 'S_LAN', 
            'LOR', 'S_LOR', 'LOD_V', 'CAL', 'RET', 'SET_V', 'LIN', 'LIN_M', 'P_LIN_M', 
            'LES', 'S_LES', 'F_LES', 'SF_LES', 'GRE', 'S_GRE', 'F_GRE', 'SF_GRE', 'EQU', 
            'S_EQU', 'SHL', 'S_SHL', 'SHR', 'S_SHR', 'SRS', 'S_SRS', 'F_INN', 'PF_INN', 
            'JMP', 'JIZ', 'F_ROT', 'F_SU1', 'F_SU2', 'SF_SU1', 'SF_SU2'
        ],

        jumpInstructions: ['JMP', 'JIZ'],

        symbols: /[=><!~?:&|+*/%^-]+/,

        tokenizer: {
            root: [
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FROUND|FFTSIZ|array|arrays|ITRAD|TOAQUI)\b/, 'keyword.directive'],
                [/\/\/.*$/, 'comment'],
                [/;.*$/, 'comment'],
                [/^\s*[a-zA-Z_]\w*:/, 'type.identifier'],
                [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
                [/\b[0-9]+\b/, 'number'],
                [/\b[01]+b\b/, 'number.binary'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                [/\b(JMP|JIZ)\b/, 'keyword.jumpInstruction'],
                [/\b([A-Z][A-Z0-9_]*)\b/, {
                    cases: {
                        '@instructions': 'keyword.instruction',
                        '@directives': 'keyword.directive',
                        '@default': 'identifier'
                    }
                }],
                [/[a-zA-Z_]\w*/, 'identifier'],
                { include: '@whitespace' },
                [/[(),]/, 'delimiter'],
                [/[=<>!+\-*/]/, 'operator'],
                [/@\w+/, 'annotation.asm']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white']
            ]
        }
    });

    // Aurora ASM Dark, same surfaces as cmm-dark for visual consistency.
    monaco.editor.defineTheme('asm-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword.instruction',     foreground: '8E83E8', fontStyle: 'bold' },
            { token: 'keyword.jumpInstruction', foreground: 'E8B86C', fontStyle: 'bold' },
            { token: 'keyword.directive',       foreground: 'B98AE0', fontStyle: 'bold' },
            { token: 'type.identifier',         foreground: '5FE0B0' },
            { token: 'comment',                 foreground: '6A6F7C', fontStyle: 'italic' },
            { token: 'number',                  foreground: '5FE0B0' },
            { token: 'number.hex',              foreground: '5BB8E8' },
            { token: 'number.binary',           foreground: '4FD3C2' },
            { token: 'string',                  foreground: 'E68FB8' },
            { token: 'operator',                foreground: '9CA1AE' },
            { token: 'delimiter',               foreground: '9CA1AE' },
            { token: 'annotation.asm',          foreground: 'A89EF0', fontStyle: 'italic' }
        ],
        colors: {
            'editor.background':                  '#0A0D14',
            'editor.foreground':                  '#E8ECF3',
            'editorGutter.background':            '#0A0D14',
            'minimap.background':                 '#0A0D14',
            'editorLineNumber.foreground':        '#3F434E',
            'editorLineNumber.activeForeground':  '#A89EF0',
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.lineHighlightBackground':     '#0F131C',
            'editor.lineHighlightBorder':         '#0F131C',
            'editorCursor.foreground':            '#8E83E8',
            'editorWhitespace.foreground':        '#1F2532',
            'editorIndentGuide.background1':      '#161A23',
            'editorIndentGuide.activeBackground1':'#8E83E8',
            'editor.findMatchBackground':         '#8E83E866',
            'editor.findMatchHighlightBackground':'#8E83E833',
            'editorBracketMatch.background':      '#8E83E833',
            'editorBracketMatch.border':          '#8E83E8',
            'scrollbar.shadow':                   '#00000000',
            'scrollbarSlider.background':         '#1F253260',
            'scrollbarSlider.hoverBackground':    '#2A3040A0',
            'scrollbarSlider.activeBackground':   '#8E83E866'
        }
    });

    // Aurora ASM Light, same surfaces as cmm-light for visual consistency.
    monaco.editor.defineTheme('asm-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'keyword.instruction',     foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'keyword.jumpInstruction', foreground: 'C49344', fontStyle: 'bold' },
            { token: 'keyword.directive',       foreground: '8B5CB8', fontStyle: 'bold' },
            { token: 'type.identifier',         foreground: '3A9D6E' },
            { token: 'comment',                 foreground: '7B7F8B', fontStyle: 'italic' },
            { token: 'number',                  foreground: '3A9D6E' },
            { token: 'number.hex',              foreground: '2A7AB0' },
            { token: 'number.binary',           foreground: '3FB0A0' },
            { token: 'string',                  foreground: 'B8568C' },
            { token: 'operator',                foreground: '545A6B' },
            { token: 'delimiter',               foreground: '545A6B' },
            { token: 'annotation.asm',          foreground: '6E63C8', fontStyle: 'italic' }
        ],
        colors: {
            'editor.background':                  '#FAFAFC',
            'editor.foreground':                  '#2A2D38',
            'editorGutter.background':            '#FAFAFC',
            'minimap.background':                 '#FAFAFC',
            'editorLineNumber.foreground':        '#B5B8C2',
            'editorLineNumber.activeForeground':  '#6E63C8',
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.lineHighlightBackground':     '#F1F1F5',
            'editor.lineHighlightBorder':         '#F1F1F5',
            'editorCursor.foreground':            '#6E63C8',
            'editorWhitespace.foreground':        '#DDDDE3',
            'editorIndentGuide.background1':      '#EAEAEF',
            'editorIndentGuide.activeBackground1':'#6E63C8'
        }
    });
}

// MATLAB / Octave (.m). Not shipped by the vendored Monaco build (see the
// basic-languages folder, matlab is absent), so we register it ourselves with
// a Monarch tokenizer, exactly like CMM and ASM above. Tokens are deliberately
// generic (keyword/string/number/comment/operator/delimiter + constant.language)
// so the cmm-dark/cmm-light Aurora themes colour them with zero extra rules:
// keeping the single canonical theme.
//
// The one MATLAB-specific subtlety is the apostrophe: `'` is BOTH the char-array
// delimiter ('text') AND the (conjugate-)transpose operator (A'). We disambiguate
// with a two-mode tokenizer: in `root` an apostrophe opens a string; right after
// a value (identifier / number / closing bracket / another transpose) we sit in
// the tiny `@transpose` state where a run of apostrophes is an operator instead.
// Lookbehind is avoided on purpose, Monarch anchors each rule at the current
// offset, so `(?<=…)` can't see the preceding character reliably.
export function setupMatlabLanguage(monaco: Monaco_) {
    monaco.languages.register({
        id: 'matlab',
        extensions: ['.m'],
        aliases: ['MATLAB', 'matlab', 'Octave', 'octave']
    });

    monaco.languages.setLanguageConfiguration('matlab', {
        comments: { lineComment: '%', blockComment: ['%{', '%}'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"', notIn: ['string'] },
            { open: "'", close: "'", notIn: ['string', 'comment'] }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(if|elseif|else|for|parfor|while|switch|case|otherwise|function|classdef|methods|properties|events|enumeration|try|catch|do|unwind_protect|spmd)\b.*$/,
            decreaseIndentPattern: /^\s*(end|endif|endwhile|endfor|endfunction|endswitch|endclassdef|endmethods|endproperties|endevents|endenumeration|endparfor|else|elseif|case|otherwise|catch|until|unwind_protect_cleanup)\b.*$/
        }
    });

    monaco.languages.setMonarchTokensProvider('matlab', {
        defaultToken: '',
        tokenPostfix: '.matlab',

        // Control flow + declarations. Octave `end*`/`unwind_protect` variants are
        // included so plain-Octave .m files highlight too.
        keywords: [
            'break', 'case', 'catch', 'classdef', 'continue', 'do', 'else',
            'elseif', 'end', 'end_try_catch', 'end_unwind_protect', 'endclassdef',
            'endenumeration', 'endevents', 'endfor', 'endfunction', 'endif',
            'endmethods', 'endparfor', 'endproperties', 'endswitch', 'endwhile',
            'enumeration', 'events', 'for', 'function', 'global', 'if', 'methods',
            'otherwise', 'parfor', 'persistent', 'properties', 'return', 'spmd',
            'switch', 'try', 'until', 'unwind_protect', 'unwind_protect_cleanup',
            'while'
        ],

        // Built-in constants / special values.
        constants: [
            'true', 'false', 'pi', 'eps', 'Inf', 'inf', 'NaN', 'nan', 'NA',
            'ans', 'nargin', 'nargout', 'varargin', 'varargout', 'realmax',
            'realmin'
        ],

        operators: [
            '+', '-', '*', '/', '\\', '^', '.\'', '.^', '.*', './', '.\\',
            '==', '~=', '!=', '<', '>', '<=', '>=', '&', '|', '~', '!', '&&',
            '||', '=', '+=', '-=', '*=', '/=', '^=', '++', '--', ':', '@'
        ],

        symbols: /[=><~&|+\-*/^%@:!.\\]+/,

        tokenizer: {
            root: [
                // Block comment `%{ … %}` / Octave `#{ … #}`, only when the
                // opener is alone on its line (MATLAB rule). Mid-line `%{` falls
                // through to the line-comment rule below.
                [/^\s*%\{[ \t]*$/, { token: 'comment', next: '@blockcomment' }],
                [/^\s*#\{[ \t]*$/, { token: 'comment', next: '@blockcomment' }],

                // Line comments (`%` MATLAB, `#` Octave) and `...` continuation
                // (the tail after `...` is a comment).
                [/%.*$/, 'comment'],
                [/#.*$/, 'comment'],
                [/\.\.\..*$/, 'comment'],

                // Non-conjugate transpose `.'`, a value-position apostrophe run
                // is handled by @transpose instead (see below).
                [/\.'/, 'operator'],

                // Identifiers / keywords / constants. Landing on a value flips us
                // into @transpose so a following `'` reads as transpose.
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@keywords':  { token: 'keyword',           next: '@transpose' },
                        '@constants': { token: 'constant.language', next: '@transpose' },
                        '@default':   { token: 'identifier',        next: '@transpose' }
                    }
                }],

                // Function handle: @name
                [/@[a-zA-Z_]\w*/, 'identifier'],

                { include: '@whitespace' },

                // Numbers (optional imaginary suffix i/j). Also value → @transpose.
                [/\d*\.\d+([eE][-+]?\d+)?[ij]?/, { token: 'number.float', next: '@transpose' }],
                [/0[xX][0-9a-fA-F]+/,            { token: 'number.hex',   next: '@transpose' }],
                [/\d+([eE][-+]?\d+)?[ij]?/,      { token: 'number',       next: '@transpose' }],

                // Brackets. A closing bracket is a value, so it also enters
                // @transpose (handles `A(1:end)'`, `[1 2]'`).
                [/[([{]/, '@brackets'],
                [/[)\]}]/, { token: '@brackets', next: '@transpose' }],

                // Strings, apostrophe here (NOT after a value) opens a char array.
                [/"/, { token: 'string.quote', bracket: '@open', next: '@dqstring' }],
                [/'/, { token: 'string.quote', bracket: '@open', next: '@sqstring' }],

                // Operators / delimiters.
                [/@symbols/, { cases: { '@operators': 'operator', '@default': 'delimiter' } }],
                [/[;,]/, 'delimiter']
            ],

            // Entered right after a value: a run of apostrophes is (c)transpose;
            // anything else re-tokenizes in root. Empty on end-of-line, so the
            // state self-heals on the next line's first character.
            transpose: [
                [/'+/, 'operator'],
                [/./, { token: '@rematch', next: '@pop' }]
            ],

            blockcomment: [
                [/^\s*%\}[ \t]*$/, { token: 'comment', next: '@pop' }],
                [/^\s*#\}[ \t]*$/, { token: 'comment', next: '@pop' }],
                [/.*$/, 'comment']
            ],

            dqstring: [
                [/[^"]+/, 'string'],
                [/""/, 'string'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            sqstring: [
                [/[^']+/, 'string'],
                [/''/, 'string'],
                [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white']
            ]
        }
    });
}

// Names captured from `#define NAME ...` lines across the open .cmm models.
// Baked into the Monarch tokenizer (the `defineConstants` attribute below) and
// refreshed whenever a #define is added/removed, so every later use of NAME
// lights up like a constant. We lean on Monarch for the hard part, this set is
// ONLY consulted by the identifier rule inside `root`, so it never fires inside
// a comment/string (those run in their own states) and reserved words / types /
// stdlib functions are matched first, so a name can never override them.
let cmmDefineConstants: string[] = [];

function buildCMMTokenizer(defineConstants: string[]): Monaco.languages.IMonarchLanguage {
    return {
        defaultToken: '',
        tokenPostfix: '.cmm',

        // Live set of object-like #define names, consulted by the identifier
        // rule's `@defineConstants` case (see root below).
        defineConstants,

        keywords: [
            'if', 'else', 'for', 'while', 'do', 'struct', 'return', 'break', 'continue', 
            'switch', 'case', 'default', 'goto', 'sizeof', 'volatile', 'typedef', 'enum', 
            'union', 'register', 'extern', 'inline', 'void', 'int', 'comp', 'char', 'float', 
            'double', 'bool', 'long', 'short', 'signed', 'unsigned', 'const', 'static', 
            'auto', 'Jussara', 'Anon', 'Chrysthofer'
        ],

        typeKeywords: [
            'bool', 'int', 'long', 'float', 'double', 'char', 'void', 'unsigned', 
            'signed', 'short'
        ],

        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', 
            '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', 
            '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
        ],

        symbols: /[=><!~?:&|+*/%^-]+/,

        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        tokenizer: {
            root: [
                [/#(PRNAME|NUBITS|NBMANT|NBEXPO|NDSTAC|SDEPTH|NUIOIN|NUIOOU|NUGAIN|FROUND|FFTSIZ|PRACA|TOAQUI)/, 'keyword.directive.cmm'],

                // Object-like macro: `#define NAME body`. The directive + the
                // name being defined are coloured here; every later use of NAME
                // is picked up by the identifier rule's @defineConstants case.
                [/(#define)(\s+)([a-zA-Z_]\w*)/, ['keyword.directive.cmm', 'white', 'constant.define.cmm']],
                [/#define\b/, 'keyword.directive.cmm'],

                [/\b(in|fin|out|fout|norm|sign|pset|abs|copy|sqrt|atan|sin|cos|tan|exp|log|pow|real|imag|fase|mod2|complex|vtv)\b(?=\s*\()/, 'keyword.function.stdlib.cmm'],
                
                // Dirac notation patterns. Os grupos que podem ficar vazios sao
                // `(...*)`, nunca `(...+)?`: numa regra com acao por grupos o
                // Monarch soma o comprimento de CADA grupo capturado, e um grupo
                // opcional que nao participa chega como undefined e derruba o
                // tokenizer inteiro ("Cannot read properties of undefined
                // (reading 'length')") na primeira linha que case sem ele.
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩]*)(\s*)(\|)([^⟨|⟩\s]+)(\|)(\s*)([^⟨|⟩\s]*)(\s*)(⟩)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'identifier', 'dirac.bar', 'white', 'identifier', 'white', 'dirac.bracket']],
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩]*)(\s*)(\|)([BI])(\|)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'keyword.special.dirac', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)([^⟨|⟩\s]+)(\|)(\s*)(-)(\s*)(\|)([^⟨|⟩\s]+)(⟩⟨)([^⟨|⟩\s]+)(\|)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bar', 'white', 'operator', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\w+)(\s*)(#)(\s*)(\|)(0)(⟩)/, ['identifier', 'white', 'operator', 'white', 'dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],
                [/(\w+)(\s*)(#)(\s*)([^⟨|⟩\s]+)(\s*)(\|)(in\([^)]+\))(⟩)/, ['identifier', 'white', 'operator', 'white', 'identifier', 'white', 'dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],
                [/(out)(\s*)(\()(\s*)([^,]+)(\s*)(,)(\s*)([^⟨|⟩\s]*)(\s*)(\|)([^⟨|⟩\s]+)(⟩)(\s*)(\))/, ['keyword.function.stdlib.cmm', 'white', 'delimiter.parenthesis', 'white', 'identifier', 'white', 'delimiter', 'white', 'identifier', 'white', 'dirac.bar', 'identifier', 'dirac.bracket', 'white', 'delimiter.parenthesis']],
                [/(⟨)([^⟨⟩|]+)(\|)([^⟨⟩|]+)(⟩)/, ['dirac.bracket', 'identifier', 'dirac.bar', 'identifier', 'dirac.bracket']],
                [/(\|)([^⟨⟩|\s]+)(⟩)/, ['dirac.bar', 'identifier', 'dirac.bracket']],
                [/(⟨)([^⟨⟩|]+)(\|)/, ['dirac.bracket', 'identifier', 'dirac.bar']],
                [/(\|)([IB])(\|)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bar']],
                [/(\|)(0)(⟩)/, ['dirac.bar', 'keyword.special.dirac', 'dirac.bracket']],
                [/(\|)(in\([^)]+\))(⟩)/, ['dirac.bar', 'keyword.function.stdlib.cmm', 'dirac.bracket']],
                [/[⟨⟩]/, 'dirac.bracket'],
                [/\|/, 'dirac.bar'],

                // Array-from-file: nome[TAM] "arquivo.txt". O TAM precisa
                // sair com cor de numero (igual a `[112]` numa declaracao
                // comum), englobar `[7168]` inteiro como delimiter deixava
                // o tamanho cinza/"sem cor", visivel nos blocos de pesos.
                [/(\[\s*)(\d+)(\s*\])(\s*)("[^"]*")/, ['delimiter.square', 'number', 'delimiter.square', 'white', 'string']],
                [/\[\s*\w+\s*\)/, 'delimiter.square.inverted'],

                // Numeros complexos, sufixo imaginario `im`. A parte
                // imaginaria e <magnitude>im: aceita inteiro (8im), decimal
                // (9.234im) ou a parte imaginaria sozinha (4im em `9 + 4im`).
                // A magnitude fica com cor de numero; o `im` recebe o roxo
                // dedicado (number.complex.imaginary.cmm). O \b final impede
                // casar `im` colado num identificador maior (4import).
                // `im8` NAO casa (exige digitos ANTES do `im`), entao cai como
                // identificador comum, comportamento pedido por enquanto.
                [/(\d*\.?\d+)(im)\b/, ['number', 'number.complex.imaginary.cmm']],

                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword.type',
                        '@keywords': 'keyword',
                        '@defineConstants': 'constant.define.cmm',
                        '@default': 'identifier'
                    }
                }],

                { include: '@whitespace' },

                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid'],
                [/>>>/, 'operator.shift.arithmetic'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }]
            ],

            comment: [
                [/[^/*]+/, 'comment'],
                [/\/\*/, 'comment', '@push'],
                [/\*\//, 'comment', '@pop'],
                [/[/*]/, 'comment']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape.invalid'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment']
            ]
        }
    };
}

// Scan every open .cmm model for object-like `#define NAME …` declarations and
// return the unique set of NAMEs. The anchored regex only matches a #define at
// the start of a line (leading whitespace allowed), so a `#define` written
// inside a string or after code never registers a phantom constant.
function collectCMMDefineNames(monaco: Monaco_) {
    const names = new Set<string>();
    const re = /^[ \t]*#define[ \t]+([a-zA-Z_]\w*)/gm;
    for (const model of monaco.editor.getModels()) {
        if (model.getLanguageId() !== 'cmm') continue;
        const text = model.getValue();
        let m;
        while ((m = re.exec(text))) names.add(m[1]);
    }
    return [...names];
}

// Re-bake the Monarch tokenizer only when the #define name set actually changed
// (re-registering re-tokenizes every cmm model, so we avoid doing it on every
// keystroke, it fires at most when a #define line is edited).
function refreshCMMDefines(monaco: Monaco_) {
    const names = collectCMMDefineNames(monaco);
    const changed = names.length !== cmmDefineConstants.length
        || names.some(n => !cmmDefineConstants.includes(n));
    if (!changed) return;
    cmmDefineConstants = names;
    monaco.languages.setMonarchTokensProvider('cmm', buildCMMTokenizer(cmmDefineConstants));
}

export function setupCMMLanguage(monaco: Monaco_) {
    monaco.languages.register({ id: 'cmm' });
    monaco.languages.setMonarchTokensProvider('cmm', buildCMMTokenizer(cmmDefineConstants));

    // Os simbolos da notacao de Dirac nao estao no teclado, e o compilador so
    // aceita eles: digitar `ket` e aceitar a sugestao e o caminho. Ver
    // js/editor/dirac_snippets.js.
    registrarSnippetsDirac(monaco);

    // Keep the dynamic #define set in sync with the open .cmm buffers. A short
    // debounce coalesces bursts of keystrokes; refreshCMMDefines() itself is a
    // no-op unless the set of names changed.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => refreshCMMDefines(monaco), 300);
    };

    const watched = new WeakSet();
    const watch = (model: Monaco.editor.ITextModel | null | undefined) => {
        if (!model || watched.has(model) || model.getLanguageId() !== 'cmm') return;
        watched.add(model);
        model.onDidChangeContent(scheduleRefresh);
        scheduleRefresh();
    };

    monaco.editor.getModels().forEach(watch);
    monaco.editor.onDidCreateModel(watch);
    // A buffer can be created as plaintext and only later flipped to cmm.
    monaco.editor.onDidChangeModelLanguage(({ model }) => watch(model));
}

/** Os dois temas da casa, cmm-dark e cmm-light, que valem para todo arquivo. */
export function definirTemasDaAurora(monaco: Monaco_) {
    // Aurora dark theme, colors mirror theme_variables.css so the
    // editor surface blends with the rest of the IDE chrome.
    // Surfaces: --bg #0A0D14, --bg-elev #0F131C, --border #1F2532
    // Accent:   --accent #8E83E8, --accent-hover #A89EF0
    // Aurora syntax palette, calmer than VS Code defaults, tuned for
    // long-session legibility on the night-sky background.
    monaco.editor.defineTheme('cmm-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'comment',                          foreground: '6A6F7C', fontStyle: 'italic' },
            { token: 'keyword',                          foreground: '8E83E8', fontStyle: 'bold' },
            { token: 'keyword.directive.cmm',            foreground: 'B98AE0' },
            { token: 'keyword.function.stdlib.cmm',      foreground: '5BB8E8', fontStyle: 'bold' },
            { token: 'constant.define.cmm',              foreground: 'E8B86C', fontStyle: 'bold' },
            { token: 'constant.language',                foreground: 'E8B86C', fontStyle: 'bold' },
            { token: 'string',                           foreground: 'E68FB8' },
            { token: 'number',                           foreground: '5FE0B0' },
            { token: 'number.complex.imaginary.cmm',     foreground: 'BD93F9', fontStyle: 'bold' },
            { token: 'operator',                         foreground: '9CA1AE' },
            { token: 'operator.shift.arithmetic',        foreground: 'A89EF0', fontStyle: 'bold' },
            { token: 'delimiter',                        foreground: '9CA1AE' },
            { token: 'delimiter.square.inverted',        foreground: 'E68FB8' },
            { token: 'dirac.bracket',                    foreground: 'A89EF0', fontStyle: 'bold' },
            { token: 'dirac.bar',                        foreground: 'A89EF0', fontStyle: 'bold' },
            { token: 'keyword.special.dirac',            foreground: 'B98AE0', fontStyle: 'bold' }
        ],
        colors: {
            // Surface, match the IDE canvas so the editor disappears into the chrome
            'editor.background':                  '#0A0D14',
            'editor.foreground':                  '#E8ECF3',
            'editorGutter.background':            '#0A0D14',
            'minimap.background':                 '#0A0D14',
            // Line numbers
            'editorLineNumber.foreground':        '#3F434E',
            'editorLineNumber.activeForeground':  '#A89EF0',
            // Selection (uses --accent-strong rgba)
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.inactiveSelectionBackground': '#8E83E820',
            // Current line, matches --bg-elev
            'editor.lineHighlightBackground':     '#0F131C',
            'editor.lineHighlightBorder':         '#0F131C',
            // Cursor
            'editorCursor.foreground':            '#8E83E8',
            // Whitespace + indent guides
            'editorWhitespace.foreground':        '#1F2532',
            'editorIndentGuide.background1':      '#161A23',
            'editorIndentGuide.activeBackground1':'#8E83E8',
            // Find / search
            'editor.findMatchBackground':         '#8E83E866',
            'editor.findMatchHighlightBackground':'#8E83E833',
            'editor.findMatchBorder':             '#A89EF0',
            // Bracket matching
            'editorBracketMatch.background':      '#8E83E833',
            'editorBracketMatch.border':          '#8E83E8',
            // Bracket pair colorization (Aurora ribbon, calmer)
            'editorBracketHighlight.foreground1': '#5FE0B0',
            'editorBracketHighlight.foreground2': '#5BB8E8',
            'editorBracketHighlight.foreground3': '#8E83E8',
            'editorBracketHighlight.foreground4': '#B98AE0',
            'editorBracketHighlight.foreground5': '#E68FB8',
            'editorBracketHighlight.foreground6': '#4FD3C2',
            'editorBracketHighlight.unexpectedBracket.foreground': '#E26C6C',
            // Scrollbar
            'scrollbar.shadow':                   '#00000000',
            'scrollbarSlider.background':         '#1F253260',
            'scrollbarSlider.hoverBackground':    '#2A3040A0',
            'scrollbarSlider.activeBackground':   '#8E83E866',
            // Minimap selection echoes accent
            'minimap.selectionHighlight':         '#8E83E844',
            'minimap.findMatchHighlight':         '#8E83E866',
            // Status / errors / warnings
            'editorError.foreground':             '#E26C6C',
            'editorWarning.foreground':           '#E8B86C',
            'editorInfo.foreground':              '#5BB8E8'
        }
    });

    // Aurora light theme, same Aurora hue family but inverted for
    // a soft daytime surface. Accent stays the same violet.
    monaco.editor.defineTheme('cmm-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment',                          foreground: '7B7F8B', fontStyle: 'italic' },
            { token: 'keyword',                          foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'keyword.directive.cmm',            foreground: '8B5CB8' },
            { token: 'keyword.function.stdlib.cmm',      foreground: '2A7AB0', fontStyle: 'bold' },
            { token: 'constant.define.cmm',              foreground: 'B5791F', fontStyle: 'bold' },
            { token: 'constant.language',                foreground: 'B5791F', fontStyle: 'bold' },
            { token: 'string',                           foreground: 'B8568C' },
            { token: 'number',                           foreground: '3A9D6E' },
            { token: 'number.complex.imaginary.cmm',     foreground: '7C3AED', fontStyle: 'bold' },
            { token: 'operator',                         foreground: '545A6B' },
            { token: 'operator.shift.arithmetic',        foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'delimiter',                        foreground: '545A6B' },
            { token: 'delimiter.square.inverted',        foreground: 'B8568C' },
            { token: 'dirac.bracket',                    foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'dirac.bar',                        foreground: '6E63C8', fontStyle: 'bold' },
            { token: 'keyword.special.dirac',            foreground: '8B5CB8', fontStyle: 'bold' }
        ],
        colors: {
            'editor.background':                  '#FAFAFC',
            'editor.foreground':                  '#2A2D38',
            'editorGutter.background':            '#FAFAFC',
            'minimap.background':                 '#FAFAFC',
            'editorLineNumber.foreground':        '#B5B8C2',
            'editorLineNumber.activeForeground':  '#6E63C8',
            'editor.selectionBackground':         '#8E83E830',
            'editor.selectionHighlightBackground':'#8E83E81C',
            'editor.lineHighlightBackground':     '#F1F1F5',
            'editor.lineHighlightBorder':         '#F1F1F5',
            'editorCursor.foreground':            '#6E63C8',
            'editorWhitespace.foreground':        '#DDDDE3',
            'editorIndentGuide.background1':      '#EAEAEF',
            'editorIndentGuide.activeBackground1':'#6E63C8',
            'editor.findMatchBackground':         '#8E83E866',
            'editor.findMatchHighlightBackground':'#8E83E833',
            'editorBracketMatch.background':      '#8E83E833',
            'editorBracketMatch.border':          '#6E63C8',
            'editorBracketHighlight.foreground1': '#3A9D6E',
            'editorBracketHighlight.foreground2': '#2A7AB0',
            'editorBracketHighlight.foreground3': '#6E63C8',
            'editorBracketHighlight.foreground4': '#8B5CB8',
            'editorBracketHighlight.foreground5': '#B8568C',
            'editorBracketHighlight.foreground6': '#3FB0A0',
            'editorBracketHighlight.unexpectedBracket.foreground': '#C5453F',
            'scrollbar.shadow':                   '#00000000',
            'scrollbarSlider.background':         '#0000001A',
            'scrollbarSlider.hoverBackground':    '#00000033',
            'scrollbarSlider.activeBackground':   '#6E63C866',
            'editorError.foreground':             '#C5453F',
            'editorWarning.foreground':           '#C49344',
            'editorInfo.foreground':              '#2A7AB0'
        }
    });
}
