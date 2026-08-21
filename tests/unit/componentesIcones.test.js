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

  it('o conteudo de cada arquivo bate com a extensao', () => {
    // Um .svg que na verdade e outra coisa renderiza como quadro quebrado, e o
    // painel nao tem como saber. Vetor e o padrao; PNG so entra quando o
    // projeto nao publica vetor nenhum, como o slang, que so tem o favicon.
    for (const c of TODOS.filter((x) => x.icone)) {
      const alvo = path.join(ICONES, c.icone);
      if (c.icone.endsWith('.svg')) {
        const texto = fs.readFileSync(alvo, 'utf8').slice(0, 600);
        expect(texto, `${c.chave}: ${c.icone} nao parece SVG`).toMatch(/<svg[\s>]/i);
      } else {
        const bytes = fs.readFileSync(alvo).subarray(0, 8);
        expect(
          bytes.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
          `${c.chave}: ${c.icone} nao parece PNG`,
        ).toBe(true);
      }
    }
  });

  it('so aceita svg e png, que e o que o painel sabe desenhar', () => {
    for (const c of TODOS.filter((x) => x.icone)) {
      expect(c.icone, c.chave).toMatch(/\.(svg|png)$/);
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
