/**
 * O sync-sapho-rules le o ASMComp.l do yanc e monta a tabela de opcodes que a
 * Aurora Intelligence consulta (list_opcodes, get_opcode). O numero do segundo
 * argumento de eval_opcode e o estado do lexer para o operando; o gerador o
 * traduz para um nome, e um estado que ele nao conhece sai como `code_N`, o
 * que o modelo nao sabe interpretar.
 */
import { describe, expect, it } from 'vitest';

import { classifyMnemonic, parseAsmLexer } from '../../scripts/sync-sapho-rules.mts';

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
