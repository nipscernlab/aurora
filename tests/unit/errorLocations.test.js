import { describe, it, expect } from 'vitest';
import { localizacoesNaLinha } from '../../js/terminal/error_locations.js';

// As cadeias abaixo NAO foram inventadas: sairam das ferramentas de verdade,
// rodadas em 29/08/2026 contra um arquivo quebrado de proposito, e as formas
// das mensagens do yanc foram conferidas na arvore do compilador (as seis
// variantes, nas duas linguas). E o unico jeito de esta funcao valer alguma
// coisa: um padrao escrito de memoria acerta o exemplo do commit e erra a
// saida real, que e onde ele precisa acertar.

const um = (texto) => {
  const r = localizacoesNaLinha(texto);
  return r.length === 1 ? r[0] : r;
};

describe('Icarus Verilog', () => {
  it('caminho e linha, sem coluna', () => {
    const linha = 'C:/Users/chrys/proj/Hardware/quebrado.v:5: syntax error';
    expect(um(linha)).toMatchObject({
      arquivo: 'C:/Users/chrys/proj/Hardware/quebrado.v',
      linha: 5,
      coluna: null,
      ferramenta: 'icarus',
    });
  });

  it('a forma com severidade tambem', () => {
    const linha = 'C:/proj/Hardware/quebrado.v:5: error: Invalid module item.';
    expect(um(linha)).toMatchObject({ linha: 5, coluna: null });
  });

  it('a letra de unidade nao corta o caminho no primeiro dois-pontos', () => {
    // O erro classico: `([^:]+):(\d+)` casa "C" como arquivo e para ali.
    expect(um('C:/proj/a.v:9: error: x').arquivo).toBe('C:/proj/a.v');
  });
});

describe('Verilator', () => {
  it('linha E coluna, com o prefixo dele', () => {
    const linha = "%Error: C:/proj/Sim/quebrado.v:5:3: syntax error, unexpected assign, expecting ',' or ';'";
    expect(um(linha)).toMatchObject({
      arquivo: 'C:/proj/Sim/quebrado.v',
      linha: 5,
      coluna: 3,
      ferramenta: 'verilator',
    });
  });

  it('barras misturadas, que e como ele imprime', () => {
    // Ele junta o diretorio que recebeu com o nome que descobriu, e sai um
    // caminho com as duas barras. Medido.
    const linha = '%Error: C:/proj/erros\\quebrado.v:5:3: syntax error';
    expect(um(linha).arquivo).toBe('C:/proj/erros\\quebrado.v');
  });

  it('o aviso com sufixo de regra', () => {
    const linha = '%Warning-WIDTHEXPAND: C:/proj/a.v:12:7: Operator ASSIGN expects 8 bits';
    expect(um(linha)).toMatchObject({ linha: 12, coluna: 7, ferramenta: 'verilator' });
  });
});

describe('yanc, os compiladores do SAPHO', () => {
  it('erro semantico em portugues', () => {
    const linha = "Erro na linha 2: se você declarar a variável 'y' eu agradeço.";
    expect(um(linha)).toMatchObject({ arquivo: null, linha: 2, ferramenta: 'yanc' });
  });

  it('erro de sintaxe, portugues e ingles', () => {
    expect(um('Erro de sintaxe na linha 3. Você é uma pessoa confusa!')).toMatchObject({ linha: 3 });
    expect(um("Syntax error on line 3. You're a confused soul!")).toMatchObject({ linha: 3 });
  });

  it('aviso, que tambem leva ao codigo', () => {
    const linha = 'Atenção na linha 7: convertendo float para int no parâmetro 1 da função \'f\'.';
    expect(um(linha)).toMatchObject({ linha: 7, arquivo: null });
  });

  it('so vira link quando ha severidade antes', () => {
    // "linha 12" aparece em texto corrido da propria interface, e um link que
    // nao leva a lugar nenhum e pior do que nenhum link.
    expect(localizacoesNaLinha('O dump tem 3 linhas 12 sinais')).toEqual([]);
    expect(localizacoesNaLinha('Compilando na linha de comando')).toEqual([]);
  });
});

describe('cocotb e Python', () => {
  it('o traceback, com o caminho entre aspas', () => {
    const linha = '  File "C:/proj/Sim/tb_soma.py", line 42, in teste_soma';
    expect(um(linha)).toMatchObject({
      arquivo: 'C:/proj/Sim/tb_soma.py',
      linha: 42,
      ferramenta: 'python',
    });
  });
});

describe('as duas armadilhas de caminho no Windows', () => {
  it('espaco no caminho, quando ele abre a linha', () => {
    const linha = 'C:/Users/chrys/Meus Projetos/top.v:9: error: x';
    expect(um(linha).arquivo).toBe('C:/Users/chrys/Meus Projetos/top.v');
  });

  it('no meio da frase, o caminho sem espaco ainda e achado', () => {
    const linha = 'iverilog: C:/proj/a.v:7:2: warning: algo';
    expect(um(linha)).toMatchObject({ arquivo: 'C:/proj/a.v', linha: 7, coluna: 2 });
  });

  it('frase com ponto e extensao no meio nao vira caminho', () => {
    // Sem numero de linha depois, nao ha o que abrir.
    expect(localizacoesNaLinha('nao consegui abrir o arquivo top.v')).toEqual([]);
  });
});

describe('o recorte do link', () => {
  it('cobre exatamente o caminho e o numero, e nada da mensagem', () => {
    const linha = 'C:/proj/a.v:5: error: Invalid module item.';
    const r = um(linha);
    expect(linha.slice(r.inicio, r.fim)).toBe('C:/proj/a.v:5');
  });

  it('no yanc cobre so o "linha N"', () => {
    const linha = 'Erro na linha 2: declare a variável.';
    const r = um(linha);
    expect(linha.slice(r.inicio, r.fim)).toBe('linha 2');
  });

  it('duas referencias na mesma linha saem em ordem, sem sobreposicao', () => {
    const linha = 'C:/proj/a.v:5: incluido de C:/proj/b.v:9:2:';
    const r = localizacoesNaLinha(linha);
    expect(r.map((x) => [x.arquivo, x.linha])).toEqual([
      ['C:/proj/a.v', 5], ['C:/proj/b.v', 9],
    ]);
  });
});

describe('a marcacao que vai para o terminal', () => {
  it('poe data-file, data-line e data-col quando a ferramenta deu os tres', async () => {
    const { comLinks } = await import('../../js/terminal/error_locations.js');
    const html = comLinks('%Error: C:/proj/a.v:5:3: syntax error');
    expect(html).toContain('data-file="C:/proj/a.v"');
    expect(html).toContain('data-line="5"');
    expect(html).toContain('data-col="3"');
  });

  it('sem coluna, nao inventa uma', async () => {
    const { comLinks } = await import('../../js/terminal/error_locations.js');
    expect(comLinks('C:/proj/a.v:5: error: x')).not.toContain('data-col');
  });

  it('escapa o que NAO e link', async () => {
    // A saida vem de arquivo do usuario e termina num innerHTML. Antes disto o
    // texto ia cru, e bastava um nome de sinal com < para injetar marcacao.
    const { comLinks } = await import('../../js/terminal/error_locations.js');
    const html = comLinks('C:/proj/a.v:5: error: <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
