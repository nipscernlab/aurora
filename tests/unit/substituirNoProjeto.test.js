/**
 * Substituir em todos os arquivos: main/ipc/search.js.
 *
 * Este e o recurso que mais pode estragar o projeto de alguem, entao os testes
 * rodam contra arquivos DE VERDADE num diretorio temporario, e nao contra um
 * sistema de arquivos de mentira. O que se quer provar e o que se pode
 * perder: conteudo.
 *
 * Tres decisoes de desenho aparecem aqui.
 *
 * A varredura e REFEITA na hora de substituir, e nao herdada da lista que o
 * usuario esta vendo. Entre o Enter da busca e o clique em substituir o
 * projeto pode ter mudado, e o que vale e o disco agora. Como e a mesma funcao
 * da busca, o conjunto substituido e exatamente o listado.
 *
 * Resultado truncado recusa o pedido inteiro. A varredura para em 2000
 * ocorrencias ou 500 arquivos, e substituir "o que coube" deixaria o projeto
 * pela metade, num estado que ninguem pediu e que a lista nao mostrou.
 *
 * E o `$` do texto de substituicao: `String.replace` sempre interpreta `$&` e
 * `$1`, mesmo quando a busca foi literal. Quem procurou `preco` e mandou
 * trocar por `R$ 5` receberia `Rpreco`, silenciosamente. Em modo literal cada
 * `$` e escapado; em modo regex nao, porque ali o `$1` e o recurso.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { substituirNoProjeto } from '../../main/ipc/search.js';

let raiz;

const escrever = (nome, texto) => {
  const p = path.join(raiz, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texto, 'utf8');
  return p;
};
const ler = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8');

const pedido = (o) => ({
  caseSensitive: false, wholeWord: false, regex: false, replacement: '', ...o,
});

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-replace-'));
});

afterEach(() => {
  try { fs.rmSync(raiz, { recursive: true, force: true }); } catch { /* ja foi */ }
});

describe('substituir: o basico', () => {
  it('troca em varios arquivos e conta o que fez', async () => {
    escrever('a.v', 'wire clk_lento;\nassign clk_lento = 1;\n');
    escrever('b.v', 'wire clk_lento;\n');
    escrever('c.v', 'nada aqui\n');

    const r = await substituirNoProjeto(raiz, pedido({ query: 'clk_lento', replacement: 'clk_rapido' }));

    expect(r.ok).toBe(true);
    expect(r.arquivos).toBe(2);
    expect(r.ocorrencias).toBe(3);
    expect(ler('a.v')).toBe('wire clk_rapido;\nassign clk_rapido = 1;\n');
    expect(ler('b.v')).toBe('wire clk_rapido;\n');
    expect(ler('c.v')).toBe('nada aqui\n');
  });

  it('alcanca subpasta', async () => {
    escrever('hdl/dentro.v', 'wire alvo;\n');

    const r = await substituirNoProjeto(raiz, pedido({ query: 'alvo', replacement: 'novo' }));

    expect(r.arquivos).toBe(1);
    expect(ler('hdl/dentro.v')).toBe('wire novo;\n');
  });

  it('nao mexe em nada quando nao ha ocorrencia', async () => {
    escrever('a.v', 'wire clk;\n');

    const r = await substituirNoProjeto(raiz, pedido({ query: 'inexistente', replacement: 'x' }));

    expect(r.arquivos).toBe(0);
    expect(r.ocorrencias).toBe(0);
    expect(ler('a.v')).toBe('wire clk;\n');
  });
});

describe('substituir: o cifrao, que morde calado', () => {
  it('em modo literal, $ e $ e nao referencia de grupo', async () => {
    escrever('a.v', '// o preco aqui\n');

    await substituirNoProjeto(raiz, pedido({ query: 'preco', replacement: 'R$ 5' }));

    expect(ler('a.v')).toBe('// o R$ 5 aqui\n');
  });

  it('em modo literal, $& nao vira o texto casado', async () => {
    escrever('a.v', 'wire alvo;\n');

    await substituirNoProjeto(raiz, pedido({ query: 'alvo', replacement: '$&x' }));

    expect(ler('a.v')).toBe('wire $&x;\n');
  });

  it('em modo regex, $1 continua sendo o grupo', async () => {
    escrever('a.v', 'wire sinal_velho;\n');

    await substituirNoProjeto(raiz, pedido({
      query: '(sinal)_velho', replacement: '$1_novo', regex: true,
    }));

    expect(ler('a.v')).toBe('wire sinal_novo;\n');
  });
});

describe('substituir: respeita as alternancias da busca', () => {
  it('palavra inteira nao pega o nome maior que contem o menor', async () => {
    escrever('a.v', 'wire clk;\nwire clk_div;\n');

    const r = await substituirNoProjeto(raiz, pedido({
      query: 'clk', replacement: 'relogio', wholeWord: true,
    }));

    expect(r.ocorrencias).toBe(1);
    expect(ler('a.v')).toBe('wire relogio;\nwire clk_div;\n');
  });

  it('sensivel a caixa so troca a grafia pedida', async () => {
    escrever('a.v', 'wire Alvo;\nwire alvo;\n');

    const r = await substituirNoProjeto(raiz, pedido({
      query: 'alvo', replacement: 'novo', caseSensitive: true,
    }));

    expect(r.ocorrencias).toBe(1);
    expect(ler('a.v')).toBe('wire Alvo;\nwire novo;\n');
  });

  it('sem sensibilidade a caixa, troca as duas grafias', async () => {
    escrever('a.v', 'wire Alvo;\nwire alvo;\n');

    const r = await substituirNoProjeto(raiz, pedido({ query: 'alvo', replacement: 'novo' }));

    expect(r.ocorrencias).toBe(2);
    expect(ler('a.v')).toBe('wire novo;\nwire novo;\n');
  });
});

describe('substituir: recusa em vez de deixar pela metade', () => {
  // Prazo proprio: este teste escreve e varre 520 arquivos, porque so passando
  // do teto de 500 do search_core ele prova a recusa. Leva cerca de 1 s, mas no
  // runner Windows a escrita em massa numa pasta temporaria ja levou 45 e 51 s
  // (CI da main e PR de release 6.21.0, 24/09/2026) e estourou os 20 s padrao
  // duas vezes no mesmo dia. 120 s ainda pegam uma varredura travada de verdade.
  it('recusa o pedido inteiro quando a varredura truncou', { timeout: 120_000 }, async () => {
    // O teto da varredura e 500 arquivos; 520 passam dele com folga.
    for (let i = 0; i < 520; i += 1) escrever(`m${i}.v`, 'wire alvo;\n');

    const r = await substituirNoProjeto(raiz, pedido({ query: 'alvo', replacement: 'novo' }));

    expect(r.ok).toBe(false);
    expect(r.error).toBe('too-many');
    // E, o que mais importa: NENHUM arquivo mudou.
    expect(ler('m0.v')).toBe('wire alvo;\n');
    expect(ler('m519.v')).toBe('wire alvo;\n');
  });
});

describe('substituir: nao deixa lixo para tras', () => {
  it('nao sobra arquivo temporario depois da gravacao', async () => {
    escrever('a.v', 'wire alvo;\n');

    await substituirNoProjeto(raiz, pedido({ query: 'alvo', replacement: 'novo' }));

    const sobrou = fs.readdirSync(raiz).filter((f) => f.includes('aurora-tmp'));
    expect(sobrou).toEqual([]);
  });
});
