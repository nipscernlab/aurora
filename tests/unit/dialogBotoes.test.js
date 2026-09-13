// @vitest-environment happy-dom
/**
 * O contrato dos botoes do dialogo comum: js/ui/dialog_manager.js.
 *
 * O contrato e `{ label, action, type }`, e o dialogo resolve com o `action` do
 * botao clicado ('cancel' para Escape e clique fora). Em 13/09/2026 dois
 * dialogos novos foram escritos com `text`/`value`, e chegaram a tela como dois
 * botoes dizendo "undefined". Passaram por lint, tipos e 2000 testes, porque
 * nenhum deles olhava para o formato do objeto: o dialogo aceitava qualquer
 * coisa e imprimia o que viesse.
 *
 * Dois remedios, e este arquivo prova os dois:
 *
 *   - o dialogo nao imprime mais "undefined": botao sem `label` cai em `text`,
 *     depois em `action`, e deixa um erro no console apontando o objeto;
 *   - uma varredura ESTATICA do codigo do renderer: todo botao passado a
 *     showDialog tem de usar `label` e `action`, e nenhum pode usar `text` ou
 *     `value`. E o teste que teria pego o bug antes de alguem ver.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showDialog } from '../../js/ui/dialog_manager.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Todos os .js do renderer, fora do que nao e nosso. */
function arquivosDoRenderer(dir = path.join(RAIZ, 'js')) {
  const saida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'treesitter' || e.name === 'vendor') continue;
      saida.push(...arquivosDoRenderer(p));
    } else if (e.isFile() && /\.(js|ts)$/.test(e.name)) {
      saida.push(p);
    }
  }
  return saida;
}

/**
 * Os blocos `buttons: [ ... ]` que aparecem dentro de uma chamada a showDialog.
 * Casa o array por contagem de colchetes, para nao depender de indentacao.
 */
function blocosDeBotoes(fonte) {
  const blocos = [];
  let i = 0;
  for (;;) {
    const chamada = fonte.indexOf('showDialog(', i);
    if (chamada < 0) break;
    const ini = fonte.indexOf('buttons:', chamada);
    if (ini < 0) break;
    const abre = fonte.indexOf('[', ini);
    let nivel = 0;
    let fim = abre;
    for (let k = abre; k < fonte.length; k += 1) {
      if (fonte[k] === '[') nivel += 1;
      if (fonte[k] === ']') { nivel -= 1; if (nivel === 0) { fim = k; break; } }
    }
    blocos.push(fonte.slice(abre, fim + 1));
    i = fim + 1;
  }
  return blocos;
}

describe('dialogo: nenhum botao do renderer usa o contrato errado', () => {
  it('todo botao literal passado a showDialog usa label e action, nunca text ou value', () => {
    const problemas = [];
    for (const arq of arquivosDoRenderer()) {
      const fonte = fs.readFileSync(arq, 'utf8');
      if (!fonte.includes('showDialog(')) continue;
      for (const bloco of blocosDeBotoes(fonte)) {
        const rel = path.relative(RAIZ, arq).split(path.sep).join('/');
        // Botao construido por espalhamento ou funcao nao e literal; o que se
        // confere e o literal, que e onde o engano aconteceu.
        if (/\btext\s*:/.test(bloco)) problemas.push(`${rel}: botao com \`text:\` (o contrato e \`label:\`)`);
        if (/\bvalue\s*:/.test(bloco)) problemas.push(`${rel}: botao com \`value:\` (o contrato e \`action:\`)`);
        // Um bloco literal com botoes precisa ter pelo menos um label e um action.
        if (/\{\s*label/.test(bloco) && !/action\s*:/.test(bloco)) problemas.push(`${rel}: botao com label e sem action`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

describe('dialogo: o que aparece quando o botao vem sem label', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('cai em text, depois em action, e avisa no console; nunca imprime undefined', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = showDialog({
      title: 't',
      message: 'm',
      buttons: [
        { text: 'Pelo text', action: 'a' },
        { action: 'so-action' },
        { label: 'Certo', action: 'ok', type: 'primary' },
      ],
    });
    const rotulos = [...document.querySelectorAll('.confirm-btn-label')].map((n) => n.textContent.trim());

    expect(rotulos).toEqual(['Pelo text', 'so-action', 'Certo']);
    expect(rotulos.join(' ')).not.toMatch(/undefined/);
    expect(erro).toHaveBeenCalledTimes(2);

    document.querySelector('.confirm-btn[data-action="ok"]').click();
    expect(await p).toBe('ok');
    erro.mockRestore();
  });

  it('resolve com o action do botao clicado', async () => {
    const p = showDialog({
      title: 't', message: 'm',
      buttons: [
        { label: 'Nao', action: 'cancel', type: 'cancel' },
        { label: 'Sim', action: 'voltar', type: 'primary' },
      ],
    });
    document.querySelector('.confirm-btn[data-action="voltar"]').click();
    expect(await p).toBe('voltar');
  });
});
