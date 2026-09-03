import { describe, it, expect } from 'vitest';
import {
  buildPrismYosysScript,
  validarIdentificadorVerilog,
  caminhoParaScript,
} from '../../main/ipc/prism_yosys_script.js';

// O script do Yosys e texto interpretado linha a linha, e uma linha comecada
// por `!` e comando de shell. O nome do top level vem do .spf, que pode ter
// sido clonado de qualquer lugar, e os caminhos de read_verilog vem da mesma
// fonte: nada disso passava por validacao antes de virar script. Aqui se prova
// que so identificador puro e caminho sem aspas e quebra de linha entram, e
// que a recusa vem com mensagem que nomeia o culpado, porque um nome com
// espaco so quebrava a sintese com erro obscuro do Yosys.

describe('validarIdentificadorVerilog', () => {
  it('aceita o que o Verilog aceita como nome simples', () => {
    for (const ok of ['top_mediamovel', '_x', 'ula_fdiv', 'A1']) {
      expect(validarIdentificadorVerilog(ok, 'module')).toBe(ok);
    }
  });

  it('recusa quebra de linha, ponto e virgula, espaco e digito na frente, dizendo o nome', () => {
    for (const ruim of ['a;b', 'x\n!calc.exe', 'top level', '1abc', 'a$b']) {
      expect(() => validarIdentificadorVerilog(ruim, 'top-level module')).toThrow(/top-level module name is not a plain Verilog identifier/);
    }
  });

  it('nome vazio recebe a dica do .spf, e nao um erro do Yosys', () => {
    expect(() => validarIdentificadorVerilog('', 'top-level module')).toThrow(/is the top-level set in the .spf/);
    expect(() => validarIdentificadorVerilog(undefined, 'module')).toThrow(/missing/);
  });
});

describe('caminhoParaScript', () => {
  it('deixa passar espaco, acento e barra de qualquer lado', () => {
    const p = 'C:\\Users\\Ana Maria\\Área\\proj/TopLevel/top.v';
    expect(caminhoParaScript(p)).toBe(p);
  });

  it('recusa aspas duplas e quebra de linha, que sairiam do argumento', () => {
    for (const ruim of ['C:\\x\\a"b.v', 'C:\\x\\a\nwrite_json "y"\\b.v', 'a\rb.v', '']) {
      expect(() => caminhoParaScript(ruim)).toThrow(/cannot be written into the Yosys script/);
    }
  });
});

describe('buildPrismYosysScript', () => {
  it('escreve um read_verilog por arquivo e o hierarchy -top validado', () => {
    const s = buildPrismYosysScript(['C:\\p\\a.v', 'C:\\p\\b c.v'], 'top', 'C:\\t\\h.json');
    expect(s).toContain('read_verilog -setattr src "C:\\p\\a.v"');
    expect(s).toContain('read_verilog -setattr src "C:\\p\\b c.v"');
    expect(s).toContain('hierarchy -top top\n');
    expect(s).toContain('write_json "C:\\t\\h.json"');
  });

  it('nao gera script nenhum com top level forjado ou caminho com aspas', () => {
    expect(() => buildPrismYosysScript(['C:\\p\\a.v'], 'top\n!calc.exe', 'h.json')).toThrow(/not a plain Verilog identifier/);
    expect(() => buildPrismYosysScript(['C:\\p\\a".v'], 'top', 'h.json')).toThrow(/cannot be written/);
  });
});
