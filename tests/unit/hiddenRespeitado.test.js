/**
 * Todo elemento que o código esconde pelo atributo `hidden` precisa de uma
 * regra `[hidden] { display: none }` quando a classe dele declara `display`.
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * `display` de autor VENCE o `[hidden]` da folha do navegador. Um `.barra
 * { display: flex }` mais um `el.hidden = true` no JavaScript dá um elemento
 * que continua na tela, e o código parece certo dos dois lados: o atributo
 * está posto, a regra existe, e mesmo assim aparece.
 *
 * Aconteceu duas vezes neste repositório. A primeira com `.about-update-row`,
 * cuja regra `[hidden]` está lá até hoje como cicatriz. A segunda com a barra
 * da fila de download, que ficou na tela dizendo "0 selecionados, 0 MB no
 * total" mesmo sem nada marcado.
 *
 * E o teste de unidade que existia NÃO pegou, porque ele afirmava
 * `expect(barra.hidden).toBe(true)` — o atributo estava certo. Quem estava
 * errado era a folha de estilo, que nenhum teste de DOM enxerga, porque em
 * happy-dom não há CSS aplicado. Por isso a verificação aqui é ESTÁTICA: lê o
 * CSS e o JS como texto e cruza os dois.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();

function lerTudo(dir, ext) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(ext)) out.push(p);
    }
  })(dir);
  return out;
}

const css = lerTudo(path.join(RAIZ, 'css'), '.css').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const js = lerTudo(path.join(RAIZ, 'js'), '.js').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const html = ['index.html', ...lerTudo(path.join(RAIZ, 'html'), '.html').map((f) => path.relative(RAIZ, f))]
  .map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

/**
 * Ids que o JavaScript esconde ou revela pelo atributo.
 *
 * Duas formas, e a segunda é a que importa. A primeira versão deste teste só
 * enxergava a encadeada (`getElementById('x').hidden = ...`), e com isso NÃO
 * pegava o próprio defeito que o motivou, escrito na forma mais comum de
 * todas: guardar numa variável e mexer nela depois. Um guarda que perde o caso
 * que o originou não guarda nada, então foi conferido removendo a correção e
 * vendo o teste ficar vermelho.
 */
function idsEscondidosPeloJs() {
  const ids = new Set();

  // Forma encadeada, numa linha só.
  for (const re of [
    /getElementById\(['"]([\w-]+)['"]\)[^;\n]{0,90}\.hidden\s*=/g,
    /\$\(['"]([\w-]+)['"]\)[^;\n]{0,90}\.hidden\s*=/g,
  ]) {
    for (const m of js.matchAll(re)) ids.add(m[1]);
  }

  // Forma por variável: `const barra = document.getElementById('x')` num
  // ponto, `barra.hidden = ...` mais adiante. Basta os dois aparecerem no
  // mesmo corpo de código; um falso positivo aqui custa uma regra CSS a mais,
  // e um falso negativo custa um elemento que não some da tela.
  const ligacao = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document\.)?(?:getElementById|\$)\(\s*['"]([\w-]+)['"]\s*\)/g;
  for (const m of js.matchAll(ligacao)) {
    const [, variavel, id] = m;
    if (new RegExp(`\\b${variavel}\\.hidden\\s*=`).test(js)) ids.add(id);
  }

  return ids;
}

/** Classes cujas regras declaram um `display` que sobrepõe o do navegador. */
function classesComDisplay() {
  const set = new Set();
  const re = /(\.[a-z0-9_-]+)[^{}]*\{[^{}]*?display:\s*(flex|grid|block|inline-flex|inline-block)/gis;
  for (const m of css.matchAll(re)) set.add(m[1]);
  return set;
}

/** Seletores que já têm a regra de defesa. */
function jaProtegidos() {
  const set = new Set();
  for (const m of css.matchAll(/([.#][a-z0-9_-]+)\[hidden\]/gi)) set.add(m[1]);
  return set;
}

/** A classe de um id, lida do HTML. */
function classesDoId(id) {
  const a = html.match(new RegExp(`id="${id}"[^>]*class="([^"]+)"`));
  const b = html.match(new RegExp(`class="([^"]+)"[^>]*id="${id}"`));
  return ((a || b)?.[1] || '').split(/\s+/).filter(Boolean);
}

describe('quem o JavaScript esconde, o CSS deixa esconder', () => {
  it('nenhum elemento tem display de autor sem a regra [hidden] que o desfaz', () => {
    const comDisplay = classesComDisplay();
    const protegidos = jaProtegidos();
    const problemas = [];

    for (const id of idsEscondidosPeloJs()) {
      if (protegidos.has(`#${id}`)) continue;
      for (const cls of classesDoId(id)) {
        if (comDisplay.has(`.${cls}`) && !protegidos.has(`.${cls}`)) {
          problemas.push(`#${id} usa .${cls}, que declara display e nao tem regra [hidden]`);
        }
      }
    }

    expect(problemas).toEqual([]);
  });

  it('a barra da fila de download, que foi o caso real, esta protegida', () => {
    // Preso por nome porque foi este o defeito que o usuario viu na tela.
    expect(css).toMatch(/\.componentes-fila\[hidden\]\s*\{\s*display:\s*none/);
  });
});
