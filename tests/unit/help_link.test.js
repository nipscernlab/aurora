/**
 * A tabela de ajuda dos modais, conferida contra o manual que vai no pacote.
 *
 * O botao de ajuda so vale alguma coisa enquanto o destino existe. Um botao que
 * abre uma pagina removida e PIOR que nenhum botao: a pessoa clica achando que
 * vai aprender e recebe um erro, e no proximo problema ela ja nao clica. O
 * manual e escrito noutro repositorio e entra aqui como pacote, entao um
 * capitulo pode ser renomeado sem que nada nesta arvore mude; nenhuma revisao
 * de codigo pega isso, e por isso a conferencia e um teste.
 *
 * Cada entrada e conferida em duas alturas: a PAGINA precisa existir dentro de
 * resources/docs, e a ANCORA precisa existir dentro daquele HTML. A segunda e a
 * que envelhece calada: apagar um capitulo quebra o link de um jeito visivel,
 * mas renomear um titulo so faz a pagina abrir no topo, e o botao volta a
 * despejar a pessoa num capitulo grande para procurar o assunto sozinha, que e
 * exatamente o que estas ancoras existem para evitar.
 *
 * SEM O MANUAL NA ARVORE, ESTE ARQUIVO NAO FALHA, ELE SE ABSTEM. A pasta
 * resources/docs e gitignorada e vem do bootstrap, entao numa arvore recem
 * clonada ela simplesmente nao existe, e transformar isso em suite vermelha
 * seria acusar de defeito o que e so falta de download. O que ele nao pode e
 * passar em silencio fingindo ter conferido, e por isso o primeiro caso diz em
 * voz alta o que aconteceu. Na CI o manual e baixado antes dos testes
 * (.github/workflows/ci.yml), que e onde esta conferencia importa de verdade.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AJUDAS, ESTATICOS } from '../../js/ui/help_link.js';

const raizDoRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raizDoManual = path.join(raizDoRepo, 'resources', 'docs');
const temManual = fs.existsSync(path.join(raizDoManual, 'index.html'));

const entradas = Object.entries(AJUDAS);
const comAncora = entradas.filter(([, destino]) => destino.includes('#'));

/** O manual gerado pelo Sphinx marca cada secao com um `id` no elemento. */
function temAncora(html, ancora) {
  return html.includes(`id="${ancora}"`)
    || html.includes(`id='${ancora}'`)
    || html.includes(`name="${ancora}"`);
}

describe('tabela de ajuda (js/ui/help_link.js)', () => {
  it('a tabela nao esta vazia, e diz se o manual esta na arvore', () => {
    expect(entradas.length).toBeGreaterThan(0);
    if (!temManual) {
      console.warn(
        '[help_link] resources/docs ausente: as %d paginas e %d ancoras NAO foram conferidas. '
        + 'Rode `node components/Scripts/download-docs.js` para conferir localmente.',
        entradas.length, comAncora.length,
      );
    }
  });

  describe.skipIf(!temManual)('contra a copia do manual em resources/docs', () => {
    it.each(entradas)('%s: a pagina existe no manual', (_chave, destino) => {
      const rel = destino.split('#')[0];
      // Caminho relativo e para baixo: um `..` aqui passaria pelo guarda do main
      // (main/ipc/docs.js) mas nao deveria nascer nesta tabela.
      expect(rel).not.toMatch(/^[/\\]|(^|[/\\])\.\.([/\\]|$)/);
      expect(rel).toMatch(/\.html$/);
      expect(fs.existsSync(path.join(raizDoManual, rel))).toBe(true);
    });

    it.each(comAncora)('%s: a ancora existe dentro da pagina', (_chave, destino) => {
      const [rel, ancora] = destino.split('#');
      const html = fs.readFileSync(path.join(raizDoManual, rel), 'utf8');
      expect(temAncora(html, ancora)).toBe(true);
    });
  });

  it('cada chave marcada como estatica tem mesmo um botao no index.html', () => {
    const html = fs.readFileSync(path.join(raizDoRepo, 'index.html'), 'utf8');
    for (const id of ESTATICOS) {
      expect(AJUDAS[id], `${id} esta em ESTATICOS mas nao em AJUDAS`).toBeTruthy();
      expect(html.includes(`id="${id}"`), `sem botao #${id} no index.html`).toBe(true);
    }
  });

  it('as chaves nao estaticas nao tem botao no index.html', () => {
    // Se alguem criar o botao e esquecer de listar a chave em ESTATICOS, ele
    // fica no HTML sem ninguem ligar o clique, e o "?" vira enfeite.
    const html = fs.readFileSync(path.join(raizDoRepo, 'index.html'), 'utf8');
    for (const chave of Object.keys(AJUDAS)) {
      if (ESTATICOS.includes(chave)) continue;
      expect(html.includes(`id="${chave}"`), `#${chave} existe no index.html mas nao esta em ESTATICOS`).toBe(false);
    }
  });
});
