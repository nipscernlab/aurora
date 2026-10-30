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
  conferir,
  gerarRegras,
  serializar,
  tagFixada,
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

  it('cada escape do C desfaz um nivel so: \\\\n e barra e n, nao quebra de linha (#276)', () => {
    const fonte = '#define MSG_ERR_Y M("c:\\\\new \\"x\\"\\t.", "tab\\tend\\n")';
    const [m] = parseMessages(fonte);
    expect(m.pt).toBe('c:\\new "x"\t.');
    expect(m.en).toBe('tab\tend\n');
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

describe('as diretivas que sairam da linguagem (yanc v7.1)', () => {
  // O CMMComp.y do yanc v7.1 ainda lexa #PRNAME, so para dizer que ele nao
  // existe mais. A regra da gramatica e a de Compilers/CMMComp/Sources/CMMComp.y.
  const GRAMATICA = [
    'direct : PRNAME   ID   {fprintf(stderr, MSG_ERR_PRNAME_GONE, line_num+1); exit(EXIT_FAILURE);} // the name is the file\'s',
    '       | NUBITS INUM {dire_exec("#NUBITS",$2,1);}',
    '       | NUGAIN INUM {dire_exec("#NUGAIN",$2,10);}',
  ].join('\n');

  it('acha o token cuja regra so imprime um MSG_ERR_*_GONE', async () => {
    const { diretivasQueSairam } = await import('../../scripts/sync-sapho-rules.mts');
    expect([...diretivasQueSairam(GRAMATICA)]).toEqual(['PRNAME']);
    expect([...diretivasQueSairam(null)]).toEqual([]);
    expect([...diretivasQueSairam('direct : NUBITS INUM {dire_exec("#NUBITS",$2,1);}')]).toEqual([]);
  });

  it('tira a diretiva da lista pelo token, e deixa as outras', async () => {
    const { tirarAsQueSairam } = await import('../../scripts/sync-sapho-rules.mts');
    const diretivas = {
      PRNAME: { symbol: '#PRNAME', token: 'PRNAME' },
      NUBITS: { symbol: '#NUBITS', token: 'NUBITS' },
      NUGAIN: { symbol: '#NUGAIN', token: 'NUGAIN', default: 128 },
    };
    tirarAsQueSairam(diretivas, GRAMATICA);
    expect(Object.keys(diretivas)).toEqual(['NUBITS', 'NUGAIN']);
  });
});

// Issue 217: o JSON vem da tag que a AURORA empacota, e o CI confere.
describe('de que yanc vem o sapho_rules.json', () => {
  const RAIZ = path.resolve(import.meta.dirname, '..', '..');

  it('tagFixada le o YANC_TAG do fonte do download', () => {
    expect(tagFixada("const X = 1;\nconst YANC_TAG      = 'v9.1';\n")).toBe('v9.1');
    expect(() => tagFixada('const OUTRA = 1;')).toThrow('YANC_TAG not found');
  });

  it('o JSON versionado diz que veio da tag que o download-yanc fixa', () => {
    // Sem rede: pega quem sobe o YANC_TAG e esquece o rules:sync. O CI ainda
    // roda o --check, que regenera e compara o conteudo.
    const regras = JSON.parse(fs.readFileSync(path.join(RAIZ, 'resources', 'sapho_rules.json'), 'utf8'));
    const tag = tagFixada(fs.readFileSync(path.join(RAIZ, 'components', 'Scripts', 'download-yanc.cts'), 'utf8'));
    expect(regras.source.yancTag).toBe(tag);
    expect(regras.source.yancCommit).toMatch(/^[0-9a-f]{12}$/);
  });

  it('conferir: igual passa, diferente diz o que fazer', () => {
    expect(conferir('a', 'a', 'v9.1')).toBeNull();
    expect(conferir('a', 'b', 'v9.1')).toMatch(/does not match YANC v9\.1\. Run `npm run rules:sync`/);
    expect(conferir(null, 'b', null)).toMatch(/does not match this yanc checkout/);
  });

  it('gerarRegras le o checkout e nao grava data nem caminho local', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-sapho-rules-'));
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fontes = path.join(dir, 'Compilers', 'CMMComp', 'Sources');
      fs.mkdirSync(fontes, { recursive: true });
      fs.writeFileSync(path.join(fontes, 'CMMComp.l'), LEXER);
      const origem = { yancTag: 'v9.1', yancCommit: 'bf3d0da1a8a6' };
      const regras = gerarRegras(dir, origem);
      expect(regras.source).toEqual(origem);
      expect(regras.language.types).toEqual(['int']);
      expect(regras.directives.NUBITS.symbol).toBe('#NUBITS');
      expect(regras.asm).toBeNull();
      const texto = serializar(regras);
      expect(texto).not.toContain('generatedAt');
      expect(texto).not.toContain(dir.replace(/\\/g, '/'));
      expect(texto.endsWith('}\n')).toBe(true);
      // O mesmo checkout da o mesmo texto: e o que deixa o --check comparar.
      expect(serializar(gerarRegras(dir, origem))).toBe(texto);
    } finally {
      aviso.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
