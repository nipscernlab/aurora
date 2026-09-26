/**
 * O sync-sapho-rules le o ASMComp.l do yanc e monta a tabela de opcodes que a
 * Aurora Intelligence consulta (list_opcodes, get_opcode). O numero do segundo
 * argumento de eval_opcode e o estado do lexer para o operando; o gerador o
 * traduz para um nome, e um estado que ele nao conhece sai como `code_N`, o
 * que o modelo nao sabe interpretar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildDirectives,
  classifyMnemonic,
  parseAsmLexer,
  parseGrammar,
  parseLexer,
  parseMessages,
  readSafe,
} from '../../scripts/sync-sapho-rules.mts';

describe('readSafe', () => {
  it('arquivo ausente devolve null e avisa', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readSafe(path.join(os.tmpdir(), 'nao-existe-sync-sapho-rules.l'))).toBeNull();
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });

  it('outro erro de leitura sobe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-sapho-rules-'));
    try {
      expect(() => readSafe(dir)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Trechos no formato do CMMComp.l, diretivas.c/.h, messages.h e CMMComp.y.
const LEXER = [
  '"#NUBITS"   return NUBITS;',
  '"#PRACA"    return PRACA;',
  '"int"       return TYPE;',
  '"while"     return WHILE;',
  '"in"        return INN;',
  '"sqrt"      {yylval = 1; return SQRT;}',
  '"<="        return LEQ;',
  '"|I|"       return IDENT;',
  '"#define"   BEGIN(DEFNAME);',
].join('\n');

describe('parseLexer', () => {
  it('separa diretivas, tipos, palavras, funcoes, operadores e o resto', () => {
    const lex = parseLexer(LEXER);
    expect(lex.hwDirectives).toEqual([{ symbol: '#NUBITS', token: 'NUBITS' }]);
    expect(lex.macroDirectives.map((d) => d.symbol)).toEqual(['#PRACA', '#define']);
    expect(lex.types).toEqual(['int']);
    expect(lex.keywords).toEqual(['while']);
    expect(lex.ioKeywords).toEqual(['in']);
    expect(lex.stdlibFunctions).toEqual(['sqrt']);
    expect(lex.operators).toEqual([{ symbol: '<=', token: 'LEQ' }]);
    expect(lex.diracTokens).toEqual([{ symbol: '|I|', token: 'IDENT' }]);
  });

  it('sem fonte, sem resultado', () => {
    expect(parseLexer(null)).toBeNull();
  });
});

describe('buildDirectives', () => {
  it('junta padrao e descricao das fontes, a primeira descricao vence', () => {
    const lex = parseLexer(LEXER);
    const c = 'int nubits = 16; // data width (bits)\n';
    const h = 'extern int nubits; // outra descricao\nint nubits = 32;\n';
    expect(buildDirectives(lex, c, h, null)).toEqual({
      NUBITS: { symbol: '#NUBITS', token: 'NUBITS', default: 16, description: 'data width (bits)' },
    });
  });

  it('sem lexer, sem diretivas', () => {
    expect(buildDirectives(null, 'int nubits = 16;')).toEqual({});
  });
});

describe('parseMessages', () => {
  const MSGS = [
    '// declaration errors ----------------------------',
    '#define MSG_ERR_X \\',
    '    M("Erro (linha %d)", "Error (line %d)")',
    '// command-line interface ------------------------',
    '#define MSG_CLI_HELP M("uso: cmmcomp (YANC)\\n", "usage: " "cmmcomp (YANC)\\n")',
    '#define MSG_SEM_M 3',
  ].join('\n');

  it('le codigo, severidade, secao e os dois idiomas', () => {
    expect(parseMessages(MSGS)).toEqual([
      { code: 'MSG_ERR_X', severity: 'error', category: 'declaration errors', pt: 'Erro (linha %d)', en: 'Error (line %d)' },
      { code: 'MSG_CLI_HELP', severity: 'cli', category: 'command-line interface', pt: 'uso: cmmcomp (YANC)\n', en: 'usage: cmmcomp (YANC)\n' },
    ]);
  });

  it('sem fonte, sem mensagens', () => {
    expect(parseMessages(null)).toEqual([]);
  });
});

describe('parseGrammar', () => {
  it('le os %token e as cabecas de producao depois do primeiro %%', () => {
    const y = [
      '%{ int prologo: 1; %}',
      '%token <ival> INUM FNUM',
      '%token WHILE if_minusculo',
      '%%',
      'programa : lista ;',
      'lista',
      '  : WHILE ;',
      '%%',
    ].join('\n');
    expect(parseGrammar(y)).toEqual({ tokens: ['FNUM', 'INUM', 'WHILE'], productions: ['lista', 'programa'] });
  });

  it('sem fonte, gramatica vazia', () => {
    expect(parseGrammar(null)).toEqual({ tokens: [], productions: [] });
  });
});

// Linhas no formato do ASMComp.l do yanc v5.5.
const ASMCOMP = [
  '   "LOD"   eval_opcode(  1,18, yytext,    "LOD"  ); // loads data from memory',
  '   "LDI"   eval_opcode(  3,28, yytext,    "LDI"  ); // LOD with indirect addressing (index in acc); a number as operand is the raw base (LDI 0 = mem[acc])',
  '   "STI"   eval_opcode(  7,28, yytext,    "STI"  ); // SET with indirect addressing (index on stack)',
  '   "JMP"   eval_opcode( 16,19, yytext,    ""     ); // unconditional jump',
  '   "NOP"   eval_opcode(  0, 0, yytext,    ""     ); // no operation',
].join('\n');

describe('parseAsmLexer', () => {
  const ops = parseAsmLexer(ASMCOMP);

  it('le numero, operando, nome no HDL e descricao, em ordem de opcode', () => {
    expect(ops.map((o) => [o.mnemonic, o.opcode])).toEqual([
      ['NOP', 0], ['LOD', 1], ['LDI', 3], ['STI', 7], ['JMP', 16],
    ]);
    const lod = ops.find((o) => o.mnemonic === 'LOD');
    expect(lod).toMatchObject({ operandKind: 'memory', operandCode: 18, hdlName: 'LOD', family: 'memory' });
    expect(lod.description).toBe('loads data from memory');
  });

  it('o estado 28 do v5.5 (LDI/STI com array ou base numerica) tem nome', () => {
    for (const m of ['LDI', 'STI']) {
      const op = ops.find((o) => o.mnemonic === m);
      expect(op.operandCode).toBe(28);
      expect(op.operandKind).toBe('base_or_array');
    }
  });

  it('estado desconhecido sai como code_N', () => {
    const [op] = parseAsmLexer('   "XYZ"   eval_opcode( 99,77, yytext,    "XYZ"  );');
    expect(op.operandKind).toBe('code_77');
  });

  it('sem fonte, sem tabela', () => {
    expect(parseAsmLexer(null)).toBeNull();
  });
});

describe('classifyMnemonic', () => {
  it('LDI, STI, ILI e ISI sao da familia memory', () => {
    for (const m of ['LDI', 'STI', 'ILI', 'ISI', 'P_LDI']) expect(classifyMnemonic(m)).toBe('memory');
  });

  it('LDA e STA, que sairam do ISA no v5.5, nao tem familia propria', () => {
    expect(classifyMnemonic('LDA')).not.toBe('indirect');
    expect(classifyMnemonic('STA')).not.toBe('indirect');
  });
});
