import { describe, it, expect } from 'vitest';
import {
  basenameOfPath, moduleStemFromPath, isPythonFile,
  parseCocotbToplevelDirective, insertChegueiToaqui, decideCocotbDut,
  isVerilogLikeFile, assertPythonModuleName, safeNamePart,
} from '../../js/compilation/compilation_helpers.ts';

describe('basenameOfPath / moduleStemFromPath', () => {
  it('handles both slash styles', () => {
    expect(basenameOfPath('C:\\a\\b\\top.v')).toBe('top.v');
    expect(basenameOfPath('/a/b/top.v')).toBe('top.v');
  });
  it('strips the extension for the stem', () => {
    expect(moduleStemFromPath('C:\\a\\top_level.v')).toBe('top_level');
    expect(moduleStemFromPath('tb.sv')).toBe('tb');
  });
  it('is null/undefined safe', () => {
    expect(basenameOfPath(null)).toBe('');
    expect(moduleStemFromPath(undefined)).toBe('');
  });
});

describe('isPythonFile / isVerilogLikeFile', () => {
  it('matches python testbenches case-insensitively', () => {
    expect(isPythonFile('test_dut.py')).toBe(true);
    expect(isPythonFile('test_dut.PY')).toBe(true);
    expect(isPythonFile('top.v')).toBe(false);
  });
  it('matches .v/.sv/.vh', () => {
    expect(isVerilogLikeFile('a.v')).toBe(true);
    expect(isVerilogLikeFile('a.sv')).toBe(true);
    expect(isVerilogLikeFile('a.vh')).toBe(true);
    expect(isVerilogLikeFile('a.py')).toBe(false);
  });
});

describe('parseCocotbToplevelDirective', () => {
  it('reads the directive with ":" or "="', () => {
    expect(parseCocotbToplevelDirective('# aurora-toplevel: my_dut\nimport cocotb')).toBe('my_dut');
    expect(parseCocotbToplevelDirective('#aurora-toplevel=My_DUT2')).toBe('My_DUT2');
  });
  it('is case-insensitive on the key and tolerant of spacing', () => {
    expect(parseCocotbToplevelDirective('#   AURORA-TOPLEVEL   :   dut')).toBe('dut');
  });
  it('returns null when absent or the value is not an identifier', () => {
    expect(parseCocotbToplevelDirective('import cocotb')).toBeNull();
    expect(parseCocotbToplevelDirective('# aurora-toplevel: 9bad')).toBeNull();
    expect(parseCocotbToplevelDirective(null)).toBeNull();
  });
});

describe('assertPythonModuleName', () => {
  it('returns the stem for a valid python module name', () => {
    expect(assertPythonModuleName('C:\\x\\test_dut.py')).toBe('test_dut');
  });
  it('throws when the file stem is not a valid python identifier', () => {
    expect(() => assertPythonModuleName('123-test.py')).toThrow();
    expect(() => assertPythonModuleName('my test.py')).toThrow();
  });
});

describe('safeNamePart', () => {
  it('sanitizes to [A-Za-z0-9_-] and trims leading/trailing underscores', () => {
    expect(safeNamePart('my proc!')).toBe('my_proc');
    expect(safeNamePart('_a.b_')).toBe('a_b');
    // hyphens are allowed and are NOT trimmed from the ends
    expect(safeNamePart('--a.b--')).toBe('--a_b--');
  });
  it('falls back to "cocotb" when empty', () => {
    expect(safeNamePart('')).toBe('cocotb');
    expect(safeNamePart('!!!')).toBe('cocotb');
    expect(safeNamePart(null)).toBe('cocotb');
  });
});

describe('insertChegueiToaqui', () => {
  it('inserts #TOAQUI before the closing brace of main()', () => {
    const src = 'void main() {\n  int x = 1;\n}';
    const out = insertChegueiToaqui(src);
    expect(out).toContain('#TOAQUI');
    // must sit before the final closing brace
    expect(out.indexOf('#TOAQUI')).toBeLessThan(out.lastIndexOf('}'));
    expect(out).toContain('int x = 1;');
  });
  it('matches the correct brace past nested blocks and comments', () => {
    const src = [
      'int main() {',
      '  if (a) { // } not the end',
      '    b = 1; /* } still not */',
      '  }',
      '}',
    ].join('\n');
    const out = insertChegueiToaqui(src);
    // exactly one insertion, before the outermost closing brace
    expect(out.match(/#TOAQUI/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });
  it('returns the source unchanged when there is no main()', () => {
    const src = 'void helper() {\n  return;\n}';
    expect(insertChegueiToaqui(src)).toBe(src);
  });
  it('returns the source unchanged when braces are unbalanced', () => {
    const src = 'int main() {\n  if (a) {\n';
    expect(insertChegueiToaqui(src)).toBe(src);
  });
  it('is null-safe', () => {
    expect(insertChegueiToaqui(null)).toBe('');
  });
});

// Quem e o DUT de uma corrida cocotb. A regra morava dentro de um metodo
// async do compilation_module, entre uma leitura de disco e uma mensagem
// traduzida, e por isso nenhum teste a alcancava.
describe('decideCocotbDut', () => {
  it('a diretiva do proprio .py escolhe o alvo, sem remarcar o topo do .spf', () => {
    const r = decideCocotbDut(
      { testbenchFile: 'C:/p/tb_soma.py', topLevelFile: 'C:/p/topo.v' },
      '# aurora-toplevel: somador\nimport cocotb',
    );
    expect(r).toEqual({
      ok: true,
      hdlTopModule: 'somador',
      hdlTopFile: 'C:/p/topo.v',
      toplevelSource: 'directive',
    });
  });

  it('com diretiva, o arquivo de topo e opcional', () => {
    const r = decideCocotbDut({ testbenchFile: 'tb.py' }, '# aurora-toplevel = alu');
    expect(r.ok && r.hdlTopFile).toBe('');
    expect(r.ok && r.hdlTopModule).toBe('alu');
  });

  it('sem diretiva, o DUT e o topo do .spf', () => {
    const r = decideCocotbDut({ testbenchFile: 'tb.py', topLevelFile: 'C:/p/processor.v' }, '');
    expect(r).toEqual({
      ok: true,
      hdlTopModule: 'processor',
      hdlTopFile: 'C:/p/processor.v',
      toplevelSource: 'spf',
    });
  });

  it('testbench que nao e Python nao e corrida cocotb', () => {
    expect(decideCocotbDut({ testbenchFile: 'tb.v', topLevelFile: 't.v' }, ''))
      .toEqual({ ok: false, motivo: 'cocotbRequiresPythonTb' });
    expect(decideCocotbDut({ topLevelFile: 't.v' }, ''))
      .toEqual({ ok: false, motivo: 'cocotbRequiresPythonTb' });
  });

  it('sem diretiva e sem topo Verilog, diz o motivo em vez de adivinhar', () => {
    expect(decideCocotbDut({ testbenchFile: 'tb.py' }, ''))
      .toEqual({ ok: false, motivo: 'cocotbRequiresTop' });
    expect(decideCocotbDut({ testbenchFile: 'tb.py', topLevelFile: 'topo.cmm' }, ''))
      .toEqual({ ok: false, motivo: 'cocotbRequiresTop' });
  });

  it('aceita .sv como topo', () => {
    const r = decideCocotbDut({ testbenchFile: 'tb.py', topLevelFile: 'C:/p/topo.sv' }, '');
    expect(r.ok && r.hdlTopModule).toBe('topo');
  });

  it('fonte ilegivel vira ausencia de diretiva, nao erro', () => {
    const r = decideCocotbDut({ testbenchFile: 'tb.py', topLevelFile: 'C:/p/topo.v' }, '');
    expect(r.ok && r.toplevelSource).toBe('spf');
  });
});
