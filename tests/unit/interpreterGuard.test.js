/**
 * Testes do guarda de argumentos dos interpretadores (main/compile/
 * interpreter_guard.js).
 *
 * Por que importa: a allowlist de binarios so decide QUAL executavel nasce.
 * Para perl e python o argumento e o programa, entao sem este guarda um
 * exec-spec com `python -c` executava qualquer coisa por dentro da fronteira
 * que a documentacao chamava de confianca.
 */

import { describe, it, expect } from 'vitest';

import { argumentosDeInterpretadorPermitidos, tipoDeInterpretador } from '../../main/compile/interpreter_guard.js';

const PERL = 'C:\\sapho\\components\\Packages\\msys\\mingw64\\bin\\perl.exe';
const PY = 'C:\\sapho\\components\\Packages\\msys\\mingw64\\bin\\python3.exe';

describe('tipoDeInterpretador', () => {
  it('reconhece perl e as grafias do python, com e sem .exe', () => {
    expect(tipoDeInterpretador(PERL)).toBe('perl');
    expect(tipoDeInterpretador(PY)).toBe('python');
    expect(tipoDeInterpretador('/usr/bin/python3.12')).toBe('python');
    expect(tipoDeInterpretador('py.exe')).toBe('python');
  });

  it('o resto da cadeia nao e interpretador', () => {
    for (const b of ['iverilog.exe', 'g++.exe', 'make.exe', 'yosys.exe', 'cmmcomp.exe']) {
      expect(tipoDeInterpretador(b)).toBe(null);
    }
  });
});

describe('argumentosDeInterpretadorPermitidos', () => {
  it('o que a cadeia usa passa: script e os argumentos dele', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['C:\\x\\verilator', '--cc', '-E', '-Wall', 'top.v']).ok).toBe(true);
    expect(argumentosDeInterpretadorPermitidos(PY, ['C:\\Temp\\aurora_cocotb_runner.py', '--sim', 'icarus']).ok).toBe(true);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-u', '-B', 'runner.py']).ok).toBe(true);
  });

  it('binario que nao e interpretador nunca e recusado', () => {
    expect(argumentosDeInterpretadorPermitidos('g++.exe', ['-c', 'a.cpp', '-e', 'x']).ok).toBe(true);
  });

  it('codigo inline e recusado, colado ou separado', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-e', 'system("x")']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-eprint 1']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-E', 'say 1']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-c', 'import os']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-cimport os']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-m', 'http.server']).ok).toBe(false);
  });

  it('programa por stdin e recusado', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-']).ok).toBe(false);
  });

  it('opcao com valor separado nao esconde o -e atras de um falso script', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-I', 'lib', '-e', 'x']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-X', 'utf8', '-c', 'x']).ok).toBe(false);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-W', 'ignore', '-m', 'x']).ok).toBe(false);
    // ...mas a forma legitima da mesma opcao passa.
    expect(argumentosDeInterpretadorPermitidos(PERL, ['-I', 'lib', 'script.pl']).ok).toBe(true);
    expect(argumentosDeInterpretadorPermitidos(PY, ['-X', 'utf8', 'script.py']).ok).toBe(true);
  });

  it('depois do script, -e e -c sao do script (o verilator usa -E)', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['verilator', '-E', 'a.v']).ok).toBe(true);
    expect(argumentosDeInterpretadorPermitidos(PY, ['runner.py', '-c', '5']).ok).toBe(true);
  });

  it('`--` encerra as opcoes do interpretador', () => {
    expect(argumentosDeInterpretadorPermitidos(PERL, ['--', '-e']).ok).toBe(true);
  });

  it('a recusa nomeia a opcao', () => {
    const r = argumentosDeInterpretadorPermitidos(PY, ['-c', 'x']);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"-c"');
  });
});
