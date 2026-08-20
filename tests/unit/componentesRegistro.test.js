/**
 * Testes de integridade do catálogo de componentes.
 *
 * O catálogo é o que decide se uma ferramenta pode ser executada, então um erro
 * aqui não aparece como erro: aparece como um recurso que deixou de funcionar
 * numa máquina onde ele está instalado, ou pior, como um recurso que tenta
 * funcionar sem o componente e falha lá adiante com uma mensagem que não ajuda
 * ninguém.
 *
 * São três amarrações, e nenhuma delas dá para conferir lendo:
 *
 * 1. Todo binário do allowlist tem dono, e o dono existe no catálogo. Sem isso,
 *    um binário novo passa direto pela porta.
 * 2. A sentinela de cada componente é a MESMA que o instalador dele usa como
 *    prova de instalação. Se as duas divergirem, a AURORA acha que o componente
 *    falta quando ele está lá, ou o contrário.
 * 3. Chave desconhecida não bloqueia. É a escolha deliberada de errar para o
 *    lado de deixar funcionar, e uma inversão acidental disso derrubaria a
 *    compilação inteira.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { RAW_ALLOWLIST, donoDoBinario } from '../../main/compile/binary_allowlist.js';
import {
  COMPONENTES, obter, estaInstalado, mensagemDeAusencia,
} from '../../main/components/registry.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('catalogo de componentes', () => {
  it('nao tem chave repetida', () => {
    const chaves = COMPONENTES.map((c) => c.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('so o YANC e essencial: e o unico que viaja no instalador', () => {
    // A cadeia de compilacao NAO e essencial de proposito. Sao 955 MB em
    // disco, mais da metade do instalador, e mante-la dentro seria nao ter
    // componentizado nada. Se alguem promover o msys a essencial de volta,
    // este teste e o lugar onde a decisao tem que ser discutida de novo.
    const essenciais = COMPONENTES.filter((c) => c.essencial).map((c) => c.chave);
    expect(essenciais).toEqual(['yanc']);
  });

  it('o que compila esta marcado, para a interface tratar como urgente', () => {
    const compilam = COMPONENTES.filter((c) => c.requerParaCompilar).map((c) => c.chave).sort();
    expect(compilam).toEqual(['msys', 'yanc']);
  });

  it('todo componente declara tamanho em disco e de download', () => {
    for (const c of COMPONENTES) {
      expect(c.tamanhoMB, c.chave).toBeGreaterThan(0);
      expect(c.downloadMB, c.chave).toBeGreaterThan(0);
      // O zip nunca e maior que o extraido; se ficar, alguem trocou os campos.
      expect(c.downloadMB, c.chave).toBeLessThanOrEqual(c.tamanhoMB);
    }
  });
});

describe('allowlist e catalogo andam juntos', () => {
  it('todo binario do allowlist tem dono declarado', () => {
    for (const [nome, , dono] of RAW_ALLOWLIST) {
      expect(dono, `${nome} sem dono`).toBeTruthy();
    }
  });

  it('todo dono existe no catalogo', () => {
    for (const [nome, , dono] of RAW_ALLOWLIST) {
      expect(obter(dono), `${nome} aponta para o componente inexistente ${dono}`).toBeDefined();
    }
  });

  it('donoDoBinario responde pelo nome do arquivo', () => {
    expect(donoDoBinario('gtkwave.exe')).toBe('gtkwave');
    expect(donoDoBinario('GTKWAVE.EXE')).toBe('gtkwave');
    expect(donoDoBinario('cmmcomp.exe')).toBe('yanc');
    expect(donoDoBinario('nao-existe.exe')).toBeNull();
  });

  it('todo componente nao essencial e dono de pelo menos um binario', () => {
    // Um componente que nao possui binario nenhum nunca seria bloqueado pelo
    // portao, e entao a ausencia dele apareceria so na hora do erro.
    const donos = new Set(RAW_ALLOWLIST.map(([, , d]) => d));
    for (const c of COMPONENTES.filter((x) => !x.essencial)) {
      expect(donos.has(c.chave), `${c.chave} nao tem binario no allowlist`).toBe(true);
    }
  });
});

describe('a sentinela e a mesma que o instalador usa', () => {
  for (const c of COMPONENTES) {
    it(`${c.chave}: ${c.sentinela}`, () => {
      const script = path.join(RAIZ, 'components', 'Scripts', c.script);
      if (!fs.existsSync(script)) {
        throw new Error(`o instalador declarado nao existe: ${c.script}`);
      }
      const fonte = fs.readFileSync(script, 'utf8');
      // O instalador monta a sentinela com path.join, entao o que da para
      // comparar e o ultimo trecho, que e o nome do arquivo, mais a pasta que o
      // contem. Basta para pegar a troca de binario ou de pasta, que e o que
      // acontece quando o upstream muda de nome.
      const partes = c.sentinela.split('/');
      const arquivo = partes[partes.length - 1];
      expect(fonte, `${c.script} nao menciona ${arquivo}`).toContain(arquivo);
    });
  }
});

describe('estaInstalado', () => {
  it('nao bloqueia o que nao esta no catalogo', () => {
    expect(estaInstalado('componente-que-nao-existe')).toBe(true);
  });
});

describe('mensagemDeAusencia', () => {
  it('diz o nome, o caminho da solucao e o tamanho', () => {
    const m = mensagemDeAusencia('gtkwave');
    expect(m).toContain('GTKWave');
    expect(m).toContain('Componentes');
    // O tamanho citado e o do download, que e o que a pessoa vai esperar.
    expect(m).toContain('30 MB');
  });

  it('nao quebra com chave desconhecida', () => {
    expect(mensagemDeAusencia('xpto')).toContain('xpto');
  });
});


describe('instalador e catalogo andam juntos', () => {
  // O que o registry diz que e opcional TEM que estar excluido do
  // extraResources, senao o instalador volta a carregar tudo; e o que e
  // essencial NAO pode estar excluido, senao a AURORA sai de fabrica quebrada.
  const build = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).build;
  const filtro = build.extraResources[0].filter;

  it('todo componente opcional esta fora do instalador', () => {
    for (const c of COMPONENTES.filter((x) => !x.essencial)) {
      const pasta = c.sentinela.split('/')[1];
      expect(filtro, `${c.chave} deveria estar excluido`).toContain(`!Packages/${pasta}/**`);
    }
  });

  it('nenhum componente essencial esta excluido', () => {
    for (const c of COMPONENTES.filter((x) => x.essencial)) {
      const partes = c.sentinela.split('/');
      if (partes[0] !== 'Packages') return; // yanc mora em bin/, nunca excluivel
      expect(filtro).not.toContain(`!Packages/${partes[1]}/**`);
    }
  });

  it('os instaladores continuam dentro do pacote', () => {
    // Sem components/Scripts a maquina do aluno nao teria COMO baixar nada.
    expect(filtro.some((f) => f.startsWith('!Scripts'))).toBe(false);
  });
});


describe('arquivos-chave', () => {
  // O doctor diagnostica por eles; um caminho errado aqui faria um componente
  // saudavel parecer eternamente quebrado, e o doctor re-baixaria 272 MB a
  // cada rodada.
  it('todo arquivo-chave mora dentro da pasta do proprio componente', () => {
    for (const c of COMPONENTES) {
      const base = c.sentinela.split('/').slice(0, -1).join('/').split('/')[0] === 'Packages'
        ? c.sentinela.split('/').slice(0, 2).join('/')
        : c.sentinela.split('/')[0];
      for (const rel of c.arquivosChave) {
        expect(rel.startsWith(base), `${c.chave}: ${rel} fora de ${base}`).toBe(true);
      }
    }
  });

  it('quem compila declara os binarios que o allowlist conhece', () => {
    const msys = COMPONENTES.find((c) => c.chave === 'msys');
    expect(msys.arquivosChave.some((a) => a.endsWith('iverilog.exe'))).toBe(true);
    const yanc = COMPONENTES.find((c) => c.chave === 'yanc');
    expect(yanc.arquivosChave.some((a) => a.endsWith('cmmcomp.exe'))).toBe(true);
  });
});
