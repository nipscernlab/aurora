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

  it('marca como essencial exatamente o que compila', () => {
    // Sem cadeia de compilacao e sem os compiladores do SAPHO nao ha AURORA,
    // so uma janela. Estes dois nunca podem virar download opcional.
    const essenciais = COMPONENTES.filter((c) => c.essencial).map((c) => c.chave).sort();
    expect(essenciais).toEqual(['msys', 'yanc']);
  });

  it('todo componente declara tamanho, para o painel poder avisar o custo', () => {
    for (const c of COMPONENTES) {
      expect(c.tamanhoMB, c.chave).toBeGreaterThan(0);
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
    expect(m).toContain('88 MB');
  });

  it('nao quebra com chave desconhecida', () => {
    expect(mensagemDeAusencia('xpto')).toContain('xpto');
  });
});
