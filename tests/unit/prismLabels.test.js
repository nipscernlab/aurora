// O rotulo que o PRISM escreve numa celula: o nome do usuario quando foi ele
// que deu, e a descricao do tipo quando o nome e rastro de fabrica do Yosys.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isAutoName, cellLabel } = require('../../main/ipc/prism_labels.js');

describe('prism_labels', () => {
  it('nome do usuario fica como esta', () => {
    expect(isAutoName('addr_rd')).toBe(false);
    expect(cellLabel('addr_rd', '$memrd')).toBe('addr_rd');
    expect(cellLabel('mem_data', 'mem_data')).toBe('mem_data');
  });

  it('porta de leitura de memoria vira "mem read", mesmo com caminho absoluto no nome', () => {
    const nome = 'memrd$\\mem$C:\\Users\\chrys\\Documents\\GitHub\\aurora\\components\\HDL\\processor.v:77$272';
    expect(isAutoName(nome)).toBe(true);
    expect(cellLabel(nome, '$memrd')).toBe('mem read');
    expect(cellLabel(nome, '$memrd_v2')).toBe('mem read');
  });

  it('porta de escrita com nome auto$ vira "mem write"', () => {
    expect(cellLabel('auto$proc_memwr.cc:45:proc_memwr$1163', '$memwr')).toBe('mem write');
    expect(cellLabel('auto$proc_memwr.cc:45:proc_memwr$1163', '$memwr_v2')).toBe('mem write');
  });

  it('tipo sem apelido usa o proprio tipo, sem $ nem sufixo de versao', () => {
    expect(cellLabel('$auto$opt.cc:12:foo$9', '$shiftx')).toBe('shiftx');
    expect(cellLabel('$auto$x$1', '$macc_v2')).toBe('macc');
  });

  it('sem tipo, nome automatico vira vazio em vez de lixo', () => {
    expect(cellLabel('$auto$x$1', undefined)).toBe('');
  });
});
