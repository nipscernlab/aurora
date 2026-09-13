/**
 * Todo painel que o index carrega precisa se ligar sozinho.
 *
 * O Chrysthofer clicou nos botoes de "Problems" e "File history" e nada
 * aconteceu. A causa nao foi um bug de logica: os dois modulos EXPORTAVAM a
 * funcao que liga os ouvintes e ninguem a chamava. O `<script type="module">`
 * carregava o arquivo, o codigo avaliava, e o botao nascia mudo.
 *
 * Passou por lint, por tipos e por dois mil testes porque nenhum deles olha
 * para essa ligacao: os testes do painel chamavam `initProblemsPanel()` na mao,
 * que e exatamente o que a aplicacao nao fazia. Um teste que monta o mundo
 * sozinho nao percebe que o mundo real nao o monta.
 *
 * Este arquivo confere o que falta: para cada modulo que o index carrega como
 * script de pagina E que exporta um `init...`, esse init tem de ser chamado
 * dentro do proprio modulo. Um teste de ESTATICA, sobre o texto do arquivo,
 * porque o que se quer provar e que o codigo existe, e nao o que ele faz.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/** Os `js/...` que o index carrega como script de pagina. */
function scriptsDaPagina() {
  const achados = [];
  const re = /<script[^>]*src="\.\/(js\/[^"]+\.js)"[^>]*type="module"/g;
  for (const m of re.exec_all ? [] : [...html.matchAll(re)]) achados.push(m[1]);
  return achados;
}

describe('painel: quem o index carrega, se liga sozinho', () => {
  it('todo init exportado por um script de pagina e chamado dentro do proprio modulo', () => {
    const problemas = [];

    for (const rel of scriptsDaPagina()) {
      const arq = path.join(RAIZ, rel);
      if (!fs.existsSync(arq)) { problemas.push(`${rel}: o index carrega, mas o arquivo nao existe`); continue; }
      const fonte = fs.readFileSync(arq, 'utf8');

      // Os `export function initAlgumaCoisa()` deste modulo.
      const inits = [...fonte.matchAll(/export\s+function\s+(init[A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
      for (const nome of inits) {
        // Chamado em algum lugar do PROPRIO arquivo, fora da declaracao:
        // direto, via DOMContentLoaded, ou dentro de um if de readyState.
        const chamadas = [...fonte.matchAll(new RegExp(`\\b${nome}\\s*\\(`, 'g'))].length;
        const comoOuvinte = new RegExp(`addEventListener\\([^)]*${nome}`).test(fonte);
        if (chamadas <= 1 && !comoOuvinte) {
          problemas.push(`${rel}: exporta ${nome}() e nunca o chama, entao o painel nasce sem ouvinte`);
        }
      }
    }

    expect(problemas).toEqual([]);
  });

  it('acha os scripts de pagina que deveria achar', () => {
    // Rede contra a propria regex: se ela parar de casar, o teste acima passa
    // por nao ter o que conferir, que e a pior forma de passar.
    const achados = scriptsDaPagina();
    expect(achados.length).toBeGreaterThan(3);
    expect(achados).toContain('js/terminal/problems_panel.js');
    expect(achados).toContain('js/editor/file_history.js');
    expect(achados).toContain('js/ai/rewind.js');
  });
});
