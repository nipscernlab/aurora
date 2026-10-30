/**
 * formatSpec (js/compilation/command_spec.ts): a linha de comando que o
 * terminal mostra antes de cada passo. Ela nunca vai para um shell, mas quem a
 * copia do terminal para o cmd tem que obter os mesmos argumentos. Por isso as
 * aspas seguem a regra do Windows (CommandLineToArgvW), e um caminho continua
 * com barra simples (#276).
 */

import { describe, expect, it } from 'vitest';
import { formatSpec } from '../../js/compilation/command_spec.ts';

const linha = (...args) => formatSpec({ binary: 'bin.exe', args });

describe('formatSpec', () => {
  it('sem spec, vazio; argumento vazio vira ""', () => {
    expect(formatSpec(null)).toBe('');
    expect(linha('', 'a')).toBe('bin.exe "" a');
  });

  it('sem espaco nem aspas, o token sai como e, barras incluidas', () => {
    expect(linha('C:\\p\\a.v', '-o')).toBe('bin.exe C:\\p\\a.v -o');
  });

  it('com espaco, entre aspas, e a barra do meio continua simples', () => {
    expect(linha('C:\\Meus Projetos\\a.v')).toBe('bin.exe "C:\\Meus Projetos\\a.v"');
  });

  it('a aspa de dentro escapa, e as barras logo antes dela dobram', () => {
    expect(linha('a"b')).toBe('bin.exe "a\\"b"');
    expect(linha('a\\"b')).toBe('bin.exe "a\\\\\\"b"');
  });

  it('as barras que fecham o token dobram, para nao escapar a aspa final', () => {
    expect(linha('C:\\Meus Projetos\\')).toBe('bin.exe "C:\\Meus Projetos\\\\"');
  });
});
