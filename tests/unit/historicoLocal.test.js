/**
 * O historico local de cada arquivo: main/ipc/history.js.
 *
 * Aluno perde trabalho. Salva por cima do que funcionava, deixa a IA reescrever
 * um arquivo e se arrepende, apaga o que nao devia. O git ajuda quem faz commit,
 * e quem esta aprendendo raramente faz na hora certa.
 *
 * Como e uma rede de seguranca, os testes rodam contra arquivos DE VERDADE num
 * diretorio temporario: o que se quer provar e exatamente o que se pode perder.
 *
 * Quatro decisoes ficam fixadas aqui, porque as quatro sao invisiveis no
 * codigo do dia a dia e caras de descobrir errado:
 *
 *   - a PRIMEIRA gravacao guarda o "antes". Sem isso, a primeira edicao depois
 *     de ligar o historico perde justamente o estado de que se quer voltar;
 *   - conteudo igual ao anterior NAO vira versao. Salvar sem mudar nada e o
 *     gesto mais comum que existe, e cada um viraria uma copia identica;
 *   - a chave e um hash do caminho em minusculas, porque no Windows `Top.v` e
 *     `top.v` sao o mesmo arquivo, e duas pastas quebrariam a linha do
 *     historico no primeiro renomear de caixa;
 *   - nada da propria `.aurora` entra, senao seria o historico do historico.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// O modulo puxa `electron` so dentro de register(); o resto e fs puro.
const hist = require('../../main/ipc/history.js');

let raiz;
const arq = (rel) => path.join(raiz, rel.split('/').join(path.sep));
const escrever = (rel, texto) => {
  const p = arq(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texto, 'utf8');
  return p;
};

beforeEach(() => { raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-hist-')); });
afterEach(() => { try { fs.rmSync(raiz, { recursive: true, force: true }); } catch { /* ja foi */ } });

describe('historico: o que entra e o que fica de fora', () => {
  it('guarda uma versao e a lista com tamanho, linhas e origem', () => {
    const p = escrever('Hardware/top.v', 'module top;\nendmodule\n');
    const r = hist.gravarVersao(raiz, p, 'module top;\nendmodule\n', { origem: 'salvar' });
    expect(r.ok).toBe(true);

    const l = hist.listar(raiz, p);
    expect(l.ok).toBe(true);
    expect(l.arquivo).toBe('Hardware/top.v');
    expect(l.versoes).toHaveLength(1);
    expect(l.versoes[0]).toMatchObject({ origem: 'salvar', linhas: 3 });
    expect(l.versoes[0].bytes).toBeGreaterThan(0);
  });

  it('le de volta o conteudo exato', () => {
    const p = escrever('a.v', 'x');
    const { id } = hist.gravarVersao(raiz, p, 'conteudo com acento: ação\n');
    expect(hist.ler(raiz, p, id).conteudo).toBe('conteudo com acento: ação\n');
  });

  it('conteudo igual ao anterior NAO vira versao nova', () => {
    const p = escrever('a.v', 'igual');
    hist.gravarVersao(raiz, p, 'igual');
    hist.gravarVersao(raiz, p, 'igual');
    hist.gravarVersao(raiz, p, 'igual');

    expect(hist.listar(raiz, p).versoes).toHaveLength(1);
  });

  it('recusa arquivo fora do projeto', () => {
    const fora = path.join(os.tmpdir(), 'longe.v');
    expect(hist.gravarVersao(raiz, fora, 'x')).toMatchObject({ ok: false, motivo: 'fora' });
    expect(hist.relativoAoProjeto(raiz, fora)).toBeNull();
  });

  it('recusa o que esta dentro da propria .aurora', () => {
    const dentro = arq('.aurora/execucoes/x.json');
    expect(hist.relativoAoProjeto(raiz, dentro)).toBeNull();
    expect(hist.gravarVersao(raiz, dentro, '{}')).toMatchObject({ ok: false, motivo: 'fora' });
  });

  it('recusa binario e arquivo grande demais', () => {
    expect(hist.conteudoGuardavel(Buffer.from([65, 0, 66]))).toMatchObject({ ok: false, motivo: 'binario' });
    expect(hist.conteudoGuardavel('x'.repeat(2 * 1024 * 1024))).toMatchObject({ ok: false, motivo: 'grande' });
    expect(hist.conteudoGuardavel('module top; endmodule')).toEqual({ ok: true });
  });
});

describe('historico: a chave do arquivo', () => {
  it('ignora a caixa, porque no Windows e o mesmo arquivo', () => {
    expect(hist.chaveDe('Hardware/Top.v')).toBe(hist.chaveDe('hardware/top.v'));
  });

  it('arquivos diferentes tem chaves diferentes', () => {
    expect(hist.chaveDe('a/top.v')).not.toBe(hist.chaveDe('b/top.v'));
  });

  it('o caminho legivel fica no indice, e nao no nome da pasta', () => {
    const p = escrever('Sim/tb top.v', 'x');
    hist.gravarVersao(raiz, p, 'x');
    expect(hist.listar(raiz, p).arquivo).toBe('Sim/tb top.v');
  });
});

describe('historico: a primeira gravacao guarda o antes', () => {
  it('o conteudo que estava no disco vira a versao inicial', () => {
    const p = escrever('a.v', 'ANTES\n');
    hist.guardarAntesSePrimeira(raiz, p);
    // Agora o editor salva por cima.
    fs.writeFileSync(p, 'DEPOIS\n', 'utf8');
    hist.gravarVersao(raiz, p, 'DEPOIS\n');

    const l = hist.listar(raiz, p);
    expect(l.versoes).toHaveLength(2);
    // Mais nova primeiro.
    expect(hist.ler(raiz, p, l.versoes[0].id).conteudo).toBe('DEPOIS\n');
    expect(hist.ler(raiz, p, l.versoes[1].id).conteudo).toBe('ANTES\n');
    expect(l.versoes[1].origem).toBe('inicial');
  });

  it('nao repete o antes quando o arquivo ja tem historico', () => {
    const p = escrever('a.v', 'um\n');
    hist.guardarAntesSePrimeira(raiz, p);
    hist.guardarAntesSePrimeira(raiz, p);
    hist.guardarAntesSePrimeira(raiz, p);

    expect(hist.listar(raiz, p).versoes).toHaveLength(1);
  });

  it('arquivo que ainda nao existe no disco nao gera versao vazia', () => {
    const p = arq('novo.v');
    expect(hist.guardarAntesSePrimeira(raiz, p)).toMatchObject({ ok: true, motivo: 'novo' });
    expect(hist.listar(raiz, p).versoes).toEqual([]);
  });
});

describe('historico: apagar', () => {
  it('a ultima copia vai para o historico antes do arquivo sumir', () => {
    const p = escrever('a.v', 'o que seria perdido\n');
    hist.antesDeApagar(raiz, p);
    fs.unlinkSync(p);

    const l = hist.listar(raiz, p);
    expect(l.versoes).toHaveLength(1);
    expect(l.versoes[0].origem).toBe('apagar');
    expect(hist.ler(raiz, p, l.versoes[0].id).conteudo).toBe('o que seria perdido\n');
  });

  it('apagar uma pasta nao quebra nada', () => {
    fs.mkdirSync(arq('umapasta'), { recursive: true });
    expect(() => hist.antesDeApagar(raiz, arq('umapasta'))).not.toThrow();
  });
});

describe('historico: os limites', () => {
  it('a poda tira as mais antigas ao passar do numero de versoes', () => {
    const versoes = Array.from({ length: 53 }, (_, i) => ({ id: `v${i}`, bytes: 10 }));
    expect(hist.podarVersoes(versoes, { limiteVersoes: 50 })).toEqual(['v0', 'v1', 'v2']);
  });

  it('a poda tira as mais antigas ao passar do tamanho, e nunca esvazia', () => {
    const versoes = Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, bytes: 100 }));
    expect(hist.podarVersoes(versoes, { limiteBytes: 250 })).toEqual(['v0', 'v1']);
    // Uma versao unica maior que o teto fica: perder a unica copia seria pior.
    expect(hist.podarVersoes([{ id: 'so', bytes: 999 }], { limiteBytes: 10 })).toEqual([]);
  });

  it('o arquivo da versao podada some do disco junto com a entrada', () => {
    const p = escrever('a.v', 'v0');
    for (let i = 0; i < hist.LIMITE_VERSOES + 3; i += 1) {
      hist.gravarVersao(raiz, p, `conteudo ${i}\n`, { agora: 1_700_000_000_000 + i * 1000 });
    }
    const l = hist.listar(raiz, p);
    expect(l.versoes).toHaveLength(hist.LIMITE_VERSOES);

    const pasta = path.join(hist.pastaDoProjeto(raiz), hist.chaveDe('a.v'));
    const txts = fs.readdirSync(pasta).filter((n) => n.endsWith('.txt'));
    expect(txts).toHaveLength(hist.LIMITE_VERSOES);
  });
});

describe('historico: leitura defensiva', () => {
  it('id fora do formato nao le nada, e nao passeia pelo disco', () => {
    const p = escrever('a.v', 'x');
    hist.gravarVersao(raiz, p, 'x');
    expect(hist.ler(raiz, p, '../../../etc/passwd')).toMatchObject({ ok: false });
    expect(hist.ler(raiz, p, 'indice')).toMatchObject({ ok: false });
  });

  it('arquivo sem historico devolve lista vazia, e nao erro', () => {
    const p = escrever('nunca-salvo.v', 'x');
    expect(hist.listar(raiz, p)).toMatchObject({ ok: true, versoes: [] });
  });

  it('indice corrompido nao derruba a listagem', () => {
    const p = escrever('a.v', 'x');
    hist.gravarVersao(raiz, p, 'x');
    const pasta = path.join(hist.pastaDoProjeto(raiz), hist.chaveDe('a.v'));
    fs.writeFileSync(path.join(pasta, 'indice.json'), '{ isto nao e json', 'utf8');

    expect(hist.listar(raiz, p)).toMatchObject({ ok: true, versoes: [] });
  });
});
