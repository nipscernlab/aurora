/**
 * A ponte nao pode COMER campo.
 *
 * `js/app/preload.js` nao repassa o payload que recebe: ele desestrutura os
 * campos, um a um, e monta um objeto novo para o `ipcRenderer.invoke`. Um campo
 * que entra na desestruturacao e nao entra na remontagem some em silencio,
 * porque no outro lado ele so chega como `undefined` e o main trata ausente
 * como "nao foi pedido".
 *
 * Aconteceu duas vezes no mesmo metodo. `systemContext` (a separacao do prompt
 * para o cache) e `operacao` (o tipo de tarefa, que o main traduz em esforco de
 * raciocinio) tiveram de ser acrescentados nos DOIS lugares; esquecer o segundo
 * nao quebra nada, nao da erro e nao aparece em teste de comportamento: o
 * prefixo de cache simplesmente deixa de ser cortado, ou o esforco vira o da
 * interface, e o unico sintoma e a fatura de quem usa a AURORA.
 *
 * Isto e leitura do fonte, nao execucao. Nao sobe Electron nem preload: le o
 * arquivo e confere que a lista de entrada e a lista de saida batem.
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const FONTE = fs.readFileSync('js/app/preload.js', 'utf8');

/**
 * Acha `nome: ({ a, b, c }) => ipcRenderer.invoke('canal', { a, b, c })` e
 * devolve as duas listas de campos, a que entra e a que sai.
 */
function pontePor(nome) {
  const re = new RegExp(
    `\\b${nome}:\\s*\\(\\{([^}]*)\\}\\)\\s*=>[\\s\\S]{0,200}?invoke\\(\\s*['"][^'"]+['"]\\s*,\\s*\\{([^}]*)\\}`,
  );
  const m = FONTE.match(re);
  if (!m) return null;
  const campos = (s) => s
    .split(',')
    .map((p) => p.split(/[:=]/)[0].trim())
    .filter(Boolean)
    .filter((c) => !c.startsWith('//'));
  return { entra: campos(m[1]), sai: campos(m[2]) };
}

describe('o preload repassa tudo o que recebe', () => {
  // As pontes que remontam o objeto campo a campo. Uma que so repassa o
  // payload inteiro nao corre este risco e nao precisa entrar aqui.
  for (const nome of ['startChat']) {
    it(`${nome} nao perde campo entre a entrada e o invoke`, () => {
      const p = pontePor(nome);
      expect(p, `nao achei a ponte ${nome} em js/app/preload.js`).toBeTruthy();
      expect(p.entra.length).toBeGreaterThan(3);
      const perdidos = p.entra.filter((c) => !p.sai.includes(c));
      expect(perdidos, `${nome} desestrutura e nao repassa: ${perdidos.join(', ')}`).toEqual([]);
    });
  }

  it('startChat carrega os dois campos que ja foram esquecidos uma vez', () => {
    // Nomeados de proposito. Se um deles sair do preload numa refatoracao, o
    // teste acima ainda passaria (entrada e saida continuariam batendo), e o
    // cache ou o esforco morreriam calados.
    const p = pontePor('startChat');
    expect(p.sai).toContain('systemContext');
    expect(p.sai).toContain('operacao');
  });
});
