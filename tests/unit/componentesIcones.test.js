/**
 * Todo componente do painel precisa de um icone, e o icone precisa existir.
 *
 * Sao duas regressoes diferentes e as duas silenciosas. Um componente novo sem
 * icone nasce com o quadro vazio no meio de uma lista alinhada, e so quem
 * abrir o painel descobre. Um `icone` apontando para arquivo que nao existe da
 * na mesma coisa, com o agravante de que a falha e um 404 no console que
 * ninguem le.
 *
 * O icone e um arquivo em assets/icons, e so. Existiu um `glifo` alternativo
 * (classe do Phosphor) e uma reserva no painel, para o caso de um componente
 * sem marca; nenhum componente os usou, e em 22/08/2026 os dois sairam. Um
 * componente sem marca e um componente mal cadastrado, e e este teste que
 * acusa, antes de chegar ao painel.
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
  it('todo componente declara um icone', () => {
    for (const c of TODOS) {
      expect(typeof c.icone === 'string' && c.icone.length > 0, `${c.chave} nao declara icone`).toBe(true);
    }
  });

  it('todo arquivo de icone declarado existe no disco', () => {
    for (const c of TODOS) {
      const alvo = path.join(ICONES, c.icone);
      expect(fs.existsSync(alvo), `${c.chave}: assets/icons/${c.icone} nao existe`).toBe(true);
    }
  });

  it('o conteudo de cada arquivo bate com a extensao', () => {
    // Um .svg que na verdade e outra coisa renderiza como quadro quebrado, e o
    // painel nao tem como saber. Vetor e o padrao; PNG so entra quando o
    // projeto nao publica vetor nenhum, como o slang, que so tem o favicon.
    for (const c of TODOS) {
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
    for (const c of TODOS) {
      expect(c.icone, c.chave).toMatch(/\.(svg|png)$/);
    }
  });

  it('o campo glifo nao existe mais; quem precisar de marca poe o arquivo', () => {
    for (const c of TODOS) {
      expect('glifo' in c, `${c.chave} declara glifo, que foi removido`).toBe(false);
    }
  });
});
