/**
 * Testes da parte pura do main/ipc/git.js.
 *
 * O painel Git tinha 25 testes antes disto, e todos do lado do renderer. O lado
 * do processo principal, que e quem le a saida do git de verdade, nao tinha
 * nenhum: tudo vivia dentro de handlers de `ipcMain` e de closures dentro
 * deles.
 *
 * Dois blocos doem quando erram e nao aparecem em teste manual. O `limitarDiff`
 * corta texto que pode ter megabytes, e cortar no lugar errado deixa o painel
 * com um diff sintaticamente invalido. O `cabecalhoDeToken` monta o cabecalho
 * de autenticacao, que nunca pode acabar escrito na configuracao do
 * repositorio.
 */

import { describe, it, expect } from 'vitest';

import {
  MAX_DIFF_BYTES,
  limitarDiff,
  acumularNumstat,
  separarCaminhosNUL,
  envelopeOk,
  envelopeErro,
  linhaDeArquivo,
  cabecalhoDeToken,
  normalizarArquivos,
} from '../../main/ipc/git_parse.js';

describe('limitarDiff', () => {
  it('deixa passar inteiro o que cabe', () => {
    const d = '@@ -1,2 +1,2 @@\n-a\n+b\n';
    expect(limitarDiff(d)).toEqual({ diff: d, truncated: false });
  });

  it('corta numa quebra de linha, nunca no meio de uma linha', () => {
    // Cortar no meio produz uma linha de diff invalida, e o destacador do
    // painel colore errado dali para a frente.
    const texto = `${'x'.repeat(50)}\n`.repeat(10);
    const r = limitarDiff(texto, 120);
    expect(r.truncated).toBe(true);
    expect(r.diff.length).toBeLessThanOrEqual(120);
    // O corte cai EM cima de uma quebra, e a quebra fica de fora: o que sobra
    // sao linhas inteiras do original, e a ultima nao esta pela metade.
    expect(texto[r.diff.length]).toBe('\n');
    expect(r.diff.split('\n').every((l) => l === 'x'.repeat(50))).toBe(true);
  });

  it('corta no teto quando nao ha quebra nenhuma antes dele', () => {
    // Arquivo de uma linha so, gigante: nao ha ponto melhor que o proprio teto.
    const r = limitarDiff('y'.repeat(500), 100);
    expect(r.truncated).toBe(true);
    expect(r.diff.length).toBe(100);
  });

  it('vazio e ausente viram diff vazio, e nao a palavra null', () => {
    expect(limitarDiff(null)).toEqual({ diff: '', truncated: false });
    expect(limitarDiff(undefined)).toEqual({ diff: '', truncated: false });
    expect(limitarDiff('')).toEqual({ diff: '', truncated: false });
  });

  it('o teto padrao e o que o painel aguenta renderizar de uma vez', () => {
    expect(MAX_DIFF_BYTES).toBe(600 * 1024);
    expect(limitarDiff('z'.repeat(MAX_DIFF_BYTES)).truncated).toBe(false);
    expect(limitarDiff('z'.repeat(MAX_DIFF_BYTES + 1)).truncated).toBe(true);
  });
});

describe('acumularNumstat', () => {
  it('le a linha de numstat', () => {
    const m = acumularNumstat({}, '3\t1\tsrc/main.v\n');
    expect(m['src/main.v']).toEqual({ additions: 3, deletions: 1, binary: false });
  });

  it('SOMA as duas passadas em vez de a segunda apagar a primeira', () => {
    // O painel chama duas vezes, indice e arvore de trabalho, e o que a lista
    // de mudancas mostra e a soma. Substituir mostraria so a segunda.
    const m = {};
    acumularNumstat(m, '2\t0\ta.v\n');
    acumularNumstat(m, '5\t3\ta.v\n');
    expect(m['a.v']).toEqual({ additions: 7, deletions: 3, binary: false });
  });

  it('marca binario, que vem com hifen nas duas colunas', () => {
    const m = acumularNumstat({}, '-\t-\tdocs/logo.png\n');
    expect(m['docs/logo.png']).toEqual({ additions: 0, deletions: 0, binary: true });
  });

  it('binario numa passada nao apaga a contagem da outra', () => {
    const m = {};
    acumularNumstat(m, '4\t2\tx.dat\n');
    acumularNumstat(m, '-\t-\tx.dat\n');
    expect(m['x.dat']).toEqual({ additions: 4, deletions: 2, binary: true });
  });

  it('aguenta o retorno de carro que o autocrlf do Windows deixa', () => {
    const m = acumularNumstat({}, '1\t1\ta.v\r\n2\t2\tb.v\r\n');
    expect(Object.keys(m)).toEqual(['a.v', 'b.v']);
    expect(m['b.v'].additions).toBe(2);
  });

  it('caminho com espaco fica inteiro', () => {
    const m = acumularNumstat({}, '1\t0\tHardware/meu modulo.v\n');
    expect(m['Hardware/meu modulo.v']).toBeTruthy();
  });

  it('ignora linha que nao e numstat em vez de estourar', () => {
    const m = acumularNumstat({}, 'ruido\n\n1\t0\tok.v\nmais ruido\n');
    expect(Object.keys(m)).toEqual(['ok.v']);
  });

  it('entrada vazia devolve o mapa como estava', () => {
    expect(acumularNumstat({}, '')).toEqual({});
    expect(acumularNumstat({}, null)).toEqual({});
    expect(acumularNumstat({}, undefined)).toEqual({});
  });
});

describe('separarCaminhosNUL', () => {
  it('separa por NUL', () => {
    expect(separarCaminhosNUL('a.v\0Hardware/\0b.v\0')).toEqual(['a.v', 'Hardware/', 'b.v']);
  });

  it('caminho com quebra de linha no nome nao parte em dois', () => {
    // E exatamente por isto que a chamada usa `-z`: separar por `\n` traria de
    // volta o defeito que o `-z` existe para evitar.
    expect(separarCaminhosNUL('nome\ncom\nquebra.v\0outro.v\0'))
      .toEqual(['nome\ncom\nquebra.v', 'outro.v']);
  });

  it('nao devolve entrada vazia no fim', () => {
    expect(separarCaminhosNUL('a\0')).toEqual(['a']);
    expect(separarCaminhosNUL('')).toEqual([]);
    expect(separarCaminhosNUL(null)).toEqual([]);
  });
});

describe('envelopeOk e envelopeErro', () => {
  it('espalha o objeto no envelope', () => {
    expect(envelopeOk({ isRepo: true, branch: 'main' }))
      .toEqual({ ok: true, isRepo: true, branch: 'main' });
  });

  it('o que nao e objeto entra como value', () => {
    expect(envelopeOk('abc123')).toEqual({ ok: true, value: 'abc123' });
    expect(envelopeOk(42)).toEqual({ ok: true, value: 42 });
    expect(envelopeOk(null)).toEqual({ ok: true, value: null });
  });

  it('vetor conta como objeto, e espalha por indice', () => {
    // Registrado porque e surpreendente: quem devolver vetor de um handler vai
    // ver `{ok: true, 0: ..., 1: ...}` do outro lado, e nao uma lista.
    expect(envelopeOk(['a', 'b'])).toEqual({ ok: true, 0: 'a', 1: 'b' });
  });

  it('erro vira mensagem de texto, nunca um Error cru', () => {
    // Error nao sobrevive a serializacao do IPC: do outro lado chegaria `{}`.
    expect(envelopeErro(new Error('nao e repositorio')))
      .toEqual({ ok: false, error: 'nao e repositorio' });
    expect(envelopeErro('texto solto')).toEqual({ ok: false, error: 'texto solto' });
    expect(envelopeErro(null)).toEqual({ ok: false, error: 'null' });
  });
});

describe('linhaDeArquivo', () => {
  const arquivo = { path: 'a.v', index: 'M', working_dir: ' ' };

  it('junta o estado do git com a contagem do numstat', () => {
    expect(linhaDeArquivo(arquivo, { additions: 3, deletions: 1, binary: false }))
      .toEqual({ path: 'a.v', index: 'M', working: ' ', additions: 3, deletions: 1, binary: false });
  });

  it('sem numstat as contagens sao zero, e nao indefinidas', () => {
    // O painel soma essas colunas; `undefined` viraria NaN na barra de resumo.
    const l = linhaDeArquivo(arquivo, undefined);
    expect(l.additions).toBe(0);
    expect(l.deletions).toBe(0);
    expect(l.binary).toBe(false);
  });

  it('renomeia working_dir para working, que e o nome que o painel usa', () => {
    expect(linhaDeArquivo(arquivo, null)).not.toHaveProperty('working_dir');
    expect(linhaDeArquivo(arquivo, null).working).toBe(' ');
  });
});

describe('cabecalhoDeToken', () => {
  it('monta o Basic com o usuario que o GitHub espera', () => {
    const c = cabecalhoDeToken('ghp_exemplo');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatch(/^http\.extraHeader=Authorization: Basic /);
    const b64 = c[0].split('Basic ')[1];
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:ghp_exemplo');
  });

  it('sem token nao manda cabecalho, e o git cai no gerenciador do sistema', () => {
    for (const v of [null, undefined, '', 0, false, {}, []]) {
      expect(cabecalhoDeToken(v), String(v)).toEqual([]);
    }
  });

  it('o token vai como configuracao de uma so vez, nunca como escrita', () => {
    // A forma `http.extraHeader=...` e o que o simple-git passa por `-c`. Se um
    // dia isto virar `--add` ou `config`, o token do usuario acaba dentro do
    // .git/config de uma pasta que pode ser compartilhada.
    const c = cabecalhoDeToken('t');
    expect(c[0].startsWith('http.extraHeader=')).toBe(true);
    expect(c[0]).not.toContain('--add');
  });
});

describe('normalizarArquivos', () => {
  it('aceita caminho solto e lista, porque o painel manda os dois', () => {
    expect(normalizarArquivos('a.v')).toEqual(['a.v']);
    expect(normalizarArquivos(['a.v', 'b.v'])).toEqual(['a.v', 'b.v']);
  });

  it('descarta string vazia, que o git leria como o diretorio inteiro', () => {
    // Sem isto, um `unstage` com caminho vazio virava `git reset HEAD -- ''`.
    expect(normalizarArquivos('')).toEqual([]);
    expect(normalizarArquivos(['a.v', '', 'b.v'])).toEqual(['a.v', 'b.v']);
  });

  it('descarta o que nao e string', () => {
    expect(normalizarArquivos([null, 'a.v', undefined, 42, {}])).toEqual(['a.v']);
    expect(normalizarArquivos(null)).toEqual([]);
    expect(normalizarArquivos(undefined)).toEqual([]);
  });
});
