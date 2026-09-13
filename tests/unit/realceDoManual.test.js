// @vitest-environment happy-dom
/**
 * Achar a frase citada dentro da pagina do manual: main/docs/realce.js.
 *
 * O script gerado ali roda DENTRO da janela do manual, entao aqui ele e
 * executado contra um DOM de mentira que reproduz o que importa da pagina real
 * do Sphinx: texto cortado por tags no meio da frase, espacos e recuo entre as
 * tags, e uma barra lateral de navegacao que repete os titulos do corpo.
 *
 * O QUE ESTES TESTES PROTEGEM, e por que cada um existe:
 *
 * A frase atravessa tags. No manual quase toda frase passa por <code> ou <em>,
 * e o texto de uma so fica inteiro se o casamento andar por varios nos de texto
 * montando um Range entre eles. Casar no-a-no acharia so as frases curtas que
 * coubessem num paragrafo sem marcacao nenhuma, que sao as que ninguem cita.
 *
 * O espaco nao pode decidir. O lado da citacao vem do texto ja extraido, com os
 * espacos colapsados; o lado da pagina vem do HTML, com quebra de linha e recuo
 * do fonte. Se a normalizacao nao for a mesma nos dois lados, a busca falha por
 * causa de um espaco e o leitor conclui que a assistente inventou a frase.
 *
 * A barra lateral nao conta. O tema Furo repete os titulos das secoes no indice
 * lateral. Casar la levaria o clique para o indice em vez de para o texto.
 *
 * E O CASO QUE ORIGINOU TUDO: O MANUAL MUDA SOZINHO, por manifesto e sem
 * esperar release da AURORA. Frase reescrita tem de dar "nao achei", e nao um
 * casamento parcial em outro lugar da pagina: "nao achei" vira uma frase
 * honesta na tela, e um casamento errado manda a pessoa para o lugar errado
 * afirmando que e o certo.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const realce = require('../../main/docs/realce.js');

// Uma pagina como o Sphinx a entrega: recuo no fonte, tags no meio da frase, e
// o indice lateral repetindo o titulo.
const PAGINA = `
  <nav class="toc-drawer">
    <ul><li>O tipo complexo e nativo da linguagem</li></ul>
  </nav>
  <div id="furo-main-content">
    <section id="tipos">
      <h2>Tipos</h2>
      <p>
        O tipo <code>complexo</code> e nativo da linguagem,
        e por isso o identificador <em>i</em> nao serve de contador.
      </p>
      <p>Uma segunda frase, para o casamento ter onde errar.</p>
    </section>
  </div>`;

/** Roda o script gerado contra o DOM atual, como a janela do manual faria. */
function procurar(trecho) {
  // O script e uma expressao pronta para avaliar, que e como o
  // `executeJavaScript` do Electron a recebe. Avaliada aqui do mesmo jeito,
  // contra o DOM do happy-dom, para o teste exercitar o script DE VERDADE e
  // nao uma reimplementacao dele em JavaScript de teste.
  return new Function(`return ${realce.script(trecho)}`)();
}

beforeEach(() => {
  document.body.innerHTML = PAGINA;
  // O happy-dom nao traz a API de realce do CSS nem scrollIntoView; o script
  // ja os trata como opcionais, e e isso que se confirma de passagem aqui.
  for (const el of document.querySelectorAll('*')) {
    if (!el.scrollIntoView) el.scrollIntoView = () => {};
  }
});

describe('normalizar: os dois lados tem de falar a mesma lingua', () => {
  it('colapsa espaco, quebra de linha e recuo', () => {
    expect(realce.normalizar('  O tipo\n   complexo  e  nativo ')).toBe('O tipo complexo e nativo');
  });

  it('texto vazio ou ausente nao vira espaco', () => {
    expect(realce.normalizar('   ')).toBe('');
    expect(realce.normalizar(null)).toBe('');
    expect(realce.normalizar(undefined)).toBe('');
  });
});

describe('achar a frase na pagina', () => {
  it('acha a frase que atravessa <code> e <em>', () => {
    const r = procurar('O tipo complexo e nativo da linguagem, e por isso o identificador i nao serve de contador.');
    expect(r.achou, r.motivo).toBe(true);
  });

  it('casa um pedaco que so existe JUNTANDO dois nos de texto', () => {
    // Controle do teste acima. "complexo e nativo" nao existe dentro de
    // nenhum no de texto sozinho: a palavra esta no <code> e o resto no no
    // seguinte. Se o casamento fosse no-a-no, este seria impossivel, e o teste
    // anterior poderia estar passando por outro motivo.
    const r = procurar('complexo e nativo da');
    expect(r.achou, r.motivo).toBe(true);
  });

  it('acha mesmo com o espaco escrito de outro jeito', () => {
    // Este e o caso real: a citacao vem do texto extraido, a pagina vem do HTML.
    const r = procurar('  O tipo   complexo\n e nativo da linguagem  ');
    expect(r.achou, r.motivo).toBe(true);
  });

  it('realca sem inserir elemento nenhum na pagina', () => {
    const antes = document.querySelector('#furo-main-content').innerHTML;
    procurar('O tipo complexo e nativo da linguagem');
    // So o <style> do realce pode ter entrado, e ele vai no <head>.
    expect(document.querySelector('#furo-main-content').innerHTML).toBe(antes);
  });
});

describe('quando o manual mudou debaixo da citacao', () => {
  it('frase reescrita da "nao achei", e nao um casamento em outro lugar', () => {
    const r = procurar('O tipo complexo deixou de ser nativo da linguagem nesta versao.');
    expect(r.achou).toBe(false);
    expect(r.motivo).toBe('trecho-ausente');
  });

  it('pagina sem conteudo nao estoura', () => {
    document.body.innerHTML = '';
    const r = procurar('qualquer frase suficientemente longa para buscar');
    expect(r.achou).toBe(false);
  });
});

describe('o que nao vale como lugar', () => {
  it('nao casa dentro da barra lateral de navegacao', () => {
    // O titulo esta NO INDICE e nao no corpo. Casar ali levaria o clique para
    // a lista de secoes em vez de para o texto que sustenta a resposta.
    document.body.innerHTML = `
      <nav class="toc-drawer"><ul><li>Frase que existe apenas no indice lateral</li></ul></nav>
      <div id="furo-main-content"><p>Outro texto qualquer no corpo da pagina.</p></div>`;
    const r = procurar('Frase que existe apenas no indice lateral');
    expect(r.achou).toBe(false);
  });

  it('trecho curto demais nem chega a buscar', () => {
    // Dez caracteres casariam em dez pontos da pagina. Levar a pessoa ao
    // primeiro deles seria pior do que nao levar.
    const r = procurar('o tipo');
    expect(r.achou).toBe(false);
    expect(r.motivo).toBe('trecho-curto');
  });
});

describe('o script e um script', () => {
  it('o trecho vai escapado, e nao concatenado cru', () => {
    // A frase vem do manual, que tem aspas, barra e apostrofo. Concatenar cru
    // quebraria o script, e a busca falharia por sintaxe em vez de por conteudo.
    const s = realce.script('uma frase com "aspas", barra \\ e um \'apostrofo\' dentro dela');
    expect(() => new Function(`return ${s}`)).not.toThrow();
  });

  it('limpar apaga o realce anterior', () => {
    expect(realce.scriptLimpar()).toContain('delete');
  });
});
