/**
 * Todo componente do painel precisa de um icone, e o icone precisa existir.
 *
 * Sao duas regressoes diferentes e as duas silenciosas. Um componente novo sem
 * icone nasce com o quadro vazio no meio de uma lista alinhada, e so quem
 * abrir o painel descobre. Um `icone` apontando para arquivo que nao existe da
 * na mesma coisa, com o agravante de que a falha e um 404 no console que
 * ninguem le.
 *
 * A escolha entre marca e glifo e deliberada: logotipo de verdade onde existe,
 * glifo do Phosphor onde nao existe. Inventar um logotipo seria pior do que
 * nao ter, entao o teste aceita as duas formas e exige apenas que uma delas
 * esteja preenchida.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { COMPONENTES } from '../../main/components/registry.js';
import { CATALOGO as CATALOGO_IA } from '../../main/components/ia.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICONES = path.join(RAIZ, 'assets', 'icons');

const TODOS = [...COMPONENTES, ...CATALOGO_IA];

describe('icones dos componentes', () => {
  it('nenhum componente fica sem icone', () => {
    for (const c of TODOS) {
      expect(
        Boolean(c.icone || c.glifo),
        `${c.chave} nao declara nem icone nem glifo`,
      ).toBe(true);
    }
  });

  it('todo arquivo de icone declarado existe no disco', () => {
    for (const c of TODOS.filter((x) => x.icone)) {
      const alvo = path.join(ICONES, c.icone);
      expect(fs.existsSync(alvo), `${c.chave}: assets/icons/${c.icone} nao existe`).toBe(true);
    }
  });

  it('os arquivos declarados sao SVG de verdade', () => {
    // Um .svg que na verdade e outra coisa renderiza como quadro quebrado, e o
    // painel nao tem como saber.
    for (const c of TODOS.filter((x) => x.icone)) {
      const conteudo = fs.readFileSync(path.join(ICONES, c.icone), 'utf8').slice(0, 400);
      expect(conteudo, `${c.chave}: ${c.icone} nao parece SVG`).toMatch(/<svg[\s>]/i);
    }
  });

  it('os glifos usam o prefixo do Phosphor, que e a fonte que o app carrega', () => {
    for (const c of TODOS.filter((x) => x.glifo)) {
      expect(c.glifo, `${c.chave}: ${c.glifo}`).toMatch(/^ph-[a-z0-9-]+$/);
    }
  });

  it('nenhum componente declara os dois ao mesmo tempo', () => {
    // Declarar os dois esconde qual deles a interface usa, e a resposta so
    // apareceria lendo o cartao.
    for (const c of TODOS) {
      expect(
        Boolean(c.icone && c.glifo),
        `${c.chave} declara icone E glifo`,
      ).toBe(false);
    }
  });
});
