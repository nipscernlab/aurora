/**
 * scripts/check-diff-coverage.mts: a catraca que exige teste para toda linha
 * alterada. Um erro aqui falha de dois jeitos ruins: deixa passar linha sem
 * teste, que e o que ela existe para impedir, ou acusa linha coberta e ensina
 * todo mundo a cercar codigo com as marcas de ignore so para calar a CI.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  avaliar,
  faixas,
  lerLcov,
  linhasDeCodigo,
  linhasDoDiff,
  linhasIgnoradas,
  noEscopo,
  relatar,
  resolverBase,
  verificar,
} from '../../scripts/check-diff-coverage.mts';

// As marcas montadas em tempo de execucao: escritas por extenso, o proprio
// vitest as leria neste arquivo.
const IG = (qual) => `/* v8 ${'ignore'} ${qual} */`;

describe('noEscopo', () => {
  it('cobre o codigo da aplicacao e os scripts', () => {
    for (const f of ['js/a.ts', 'js/ui/b.js', 'main/c.ts', 'main.js', 'html/prism/p.ts', 'scripts/x.mts']) {
      expect(noEscopo(f), f).toBe(true);
    }
  });

  it('deixa de fora teste, declaracao de tipo, config e o que nao e codigo', () => {
    for (const f of ['tests/unit/a.test.js', 'js/types.d.ts', 'vitest.config.ts', 'js/a.css', 'main.json', 'mainX.js']) {
      expect(noEscopo(f), f).toBe(false);
    }
  });
});

describe('linhasDoDiff', () => {
  it('le as linhas novas de cada hunk, inclusive o hunk de uma linha so', () => {
    const diff = [
      'diff --git a/js/a.ts b/js/a.ts',
      '--- a/js/a.ts',
      '+++ b/js/a.ts',
      '@@ -3,0 +4,2 @@ ctx',
      '+x',
      '+y',
      '@@ -10 +12 @@',
      '-old',
      '+new',
    ].join('\n');
    expect([...linhasDoDiff(diff).get('js/a.ts')]).toEqual([4, 5, 12]);
  });

  it('hunk so de remocao nao marca linha nenhuma', () => {
    const diff = ['+++ b/js/a.ts', '@@ -5,3 +4,0 @@'].join('\n');
    expect(linhasDoDiff(diff).get('js/a.ts').size).toBe(0);
  });

  it('arquivo apagado nao entra', () => {
    const diff = ['--- a/js/a.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@'].join('\n');
    expect(linhasDoDiff(diff).size).toBe(0);
  });
});

describe('lerLcov', () => {
  it('normaliza o caminho do Windows para relativo com barra', () => {
    const raiz = path.resolve('/repo');
    const lcov = [`SF:${path.join(raiz, 'js', 'a.ts')}`, 'DA:3,0', 'DA:4,7', 'end_of_record', 'SF:main\\b.js', 'DA:1,1', 'end_of_record'].join('\r\n');
    const mapa = lerLcov(lcov, raiz);
    expect([...mapa.get('js/a.ts')]).toEqual([[3, 0], [4, 7]]);
    expect(mapa.get('main/b.js').get(1)).toBe(1);
  });
});

describe('linhasIgnoradas', () => {
  it('o par start e stop cerca o trecho, marcas incluidas', () => {
    const fonte = ['a', IG('start'), 'b', 'c', IG('stop'), 'd'].join('\n');
    expect([...linhasIgnoradas(fonte)]).toEqual([2, 3, 4, 5]);
  });

  it('next pula brancos e vale para a proxima linha de verdade, ou para N', () => {
    expect([...linhasIgnoradas([IG('next'), '', 'x', 'y'].join('\n'))]).toEqual([1, 3]);
    expect([...linhasIgnoradas([IG('next 2'), 'x', 'y', 'z'].join('\n'))]).toEqual([1, 2, 3]);
  });

  it('start e stop na mesma linha nao abrem trecho', () => {
    expect([...linhasIgnoradas([`${IG('start')} ${IG('stop')}`, 'x'].join('\n'))]).toEqual([1]);
  });

  it('texto que so fala da marca nao e marca', () => {
    expect(linhasIgnoradas('// use v8 ignore start em volta\nx').size).toBe(0);
  });
});

describe('linhasDeCodigo', () => {
  it('pula branco, comentario de linha e bloco de varias linhas', () => {
    const fonte = ['/**', ' * doc', ' */', 'const a = 1;', '', '// nota', '/* x */ call();', 'b(); // fim'].join('\n');
    expect([...linhasDeCodigo(fonte)]).toEqual([4, 7, 8]);
  });

  it('codigo depois do fim de um bloco na mesma linha conta', () => {
    expect([...linhasDeCodigo(['/* a', 'b */ run();'].join('\n'))]).toEqual([2]);
  });
});

describe('avaliar', () => {
  const fontes = {
    'js/a.ts': 'l1\nl2\nl3\nl4\n',
    'js/solto.ts': '// cabecalho\nconst x = 1;\n\nexport { x };\n',
  };
  const ler = (f) => fontes[f] ?? null;

  it('arquivo carregado: so conta linha que o lcov lista com zero', () => {
    const alteradas = new Map([['js/a.ts', new Set([1, 2, 3])]]);
    const cobertura = new Map([['js/a.ts', new Map([[1, 5], [2, 0]])]]);
    expect(avaliar(alteradas, cobertura, ler)).toEqual([{ arquivo: 'js/a.ts', carregado: true, linhas: [2] }]);
  });

  it('arquivo que nenhum teste carrega: conta toda linha de codigo alterada', () => {
    const alteradas = new Map([['js/solto.ts', new Set([1, 2, 3, 4])]]);
    expect(avaliar(alteradas, new Map(), ler)).toEqual([{ arquivo: 'js/solto.ts', carregado: false, linhas: [2, 4] }]);
  });

  it('fora do escopo, apagado ou tudo coberto: nada a acusar', () => {
    const alteradas = new Map([
      ['tests/unit/x.test.js', new Set([1])],
      ['js/sumiu.ts', new Set([1])],
      ['js/a.ts', new Set([1])],
    ]);
    const cobertura = new Map([['js/a.ts', new Map([[1, 1]])]]);
    expect(avaliar(alteradas, cobertura, ler)).toEqual([]);
  });
});

describe('faixas e relatar', () => {
  it('junta linhas seguidas em faixas', () => {
    expect(faixas([3, 4, 5, 9, 11, 12])).toBe('3-5, 9, 11-12');
    expect(faixas([])).toBe('');
  });

  it('o relatorio nomeia arquivo, linhas e o arquivo que nenhum teste carrega', () => {
    const texto = relatar({
      base: 'abcdef1234567890',
      descobertos: [
        { arquivo: 'js/a.ts', carregado: true, linhas: [2, 3] },
        { arquivo: 'js/b.ts', carregado: false, linhas: [7] },
      ],
    });
    expect(texto).toContain('3 linha(s) alterada(s) desde abcdef12');
    expect(texto).toContain('js/a.ts\n    linhas 2-3');
    expect(texto).toContain('js/b.ts (nenhum teste carrega este arquivo)');
    expect(relatar({ base: 'HEAD', descobertos: [] })).toContain('OK');
  });
});

// O caminho inteiro contra repositorios git de verdade, em pastas temporarias:
// base, diff com renomeacao, arquivo novo fora do git e o lcov.
//
// Os repositorios sao montados uma vez, no beforeAll, e a identidade do autor
// vai por variavel de ambiente e nao por `git config`. Cada processo git custa
// caro no runner Windows: montando o repositorio dentro de cada teste eram uns
// dez por teste, e num runner lento dois deles estouraram os 20 s na PR de
// release 6.21.0 (passaram na tentativa seguinte, com 2,7 s para os 20). Aqui
// cada teste so paga as chamadas que o proprio verificar faz.
//
// E o prazo do bloco sobe para 60 s. Os 20 s do vitest.config.mts servem para
// codigo que roda em memoria; aqui cada chamada abre um processo, e naquele
// runner lento cada uma custou uns 2 s, o que so o beforeAll ja somaria. Um git
// travado de verdade ainda para em 60 s.
const PRAZO_GIT = 60_000;

describe('verificar', { timeout: PRAZO_GIT }, () => {
  const ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  };
  const git = (dir, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', env: ENV });
  const escrever = (dir, f, texto) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), texto);
  };
  const VELHO = 'export function f(a) {\n  return a + 1;\n}\n\nexport const g = 2;\n';

  // `comHistoria`: a base com o velho.js, depois o commit que o renomeia para
  // .ts mexendo so na linha 1, e origin/main apontando para a base.
  // `semRemoto`: um commit so, sem origin/main.
  let raiz;
  let comHistoria;
  let semRemoto;
  let base;

  beforeAll(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'diffcov-'));
    comHistoria = path.join(raiz, 'historia');
    semRemoto = path.join(raiz, 'sem-remoto');
    for (const dir of [comHistoria, semRemoto]) {
      fs.mkdirSync(dir);
      git(dir, 'init', '-q');
      escrever(dir, 'js/velho.js', VELHO);
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'base');
    }
    base = git(comHistoria, 'rev-parse', 'HEAD').trim();
    git(comHistoria, 'update-ref', 'refs/remotes/origin/main', base);
    git(comHistoria, 'mv', 'js/velho.js', 'js/velho.ts');
    escrever(comHistoria, 'js/velho.ts', VELHO.replace('f(a)', 'f(a: number)'));
    git(comHistoria, 'commit', '-q', '-am', 'ts');
  }, PRAZO_GIT);

  afterAll(() => {
    if (raiz) fs.rmSync(raiz, { recursive: true, force: true });
  });

  // O que cada teste escreve fora do git sai no fim, para o seguinte achar o
  // repositorio como o beforeAll o deixou.
  const soltos = [];
  const escreverSolto = (dir, f, texto) => {
    escrever(dir, f, texto);
    soltos.push(path.join(dir, f));
  };
  afterEach(() => {
    for (const f of soltos.splice(0)) fs.rmSync(f, { force: true });
  });

  it('renomear para .ts conta so as linhas que mudaram, e arquivo novo entra inteiro', () => {
    escreverSolto(comHistoria, 'js/novo.ts', '// novo\nexport const h = 3;\n');
    escreverSolto(comHistoria, 'coverage/lcov.info', ['SF:js/velho.ts', 'DA:1,0', 'DA:2,0', 'DA:5,1', 'end_of_record'].join('\n'));

    const r = verificar({ cwd: comHistoria, base, lcov: path.join(comHistoria, 'coverage', 'lcov.info') });
    expect(r.base).toBe(base);
    expect(r.descobertos).toEqual([
      { arquivo: 'js/novo.ts', carregado: false, linhas: [2] },
      { arquivo: 'js/velho.ts', carregado: true, linhas: [1] },
    ]);
  });

  it('com origin/main, a base e o merge-base', () => {
    expect(resolverBase(comHistoria, undefined)).toBe(base);
  });

  it('sem base pedida e sem origin/main, compara com o HEAD: so o que nao foi comitado', () => {
    expect(resolverBase(semRemoto, undefined)).toBe('HEAD');
    expect(resolverBase(semRemoto, '0000000000000000000000000000000000000000')).toBe('HEAD');
    expect(resolverBase(semRemoto, 'naoexiste')).toBe('HEAD');
    escreverSolto(semRemoto, 'coverage/lcov.info', '');
    expect(verificar({ cwd: semRemoto, lcov: path.join(semRemoto, 'coverage', 'lcov.info') }).descobertos).toEqual([]);
  });
});
